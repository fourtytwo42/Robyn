#!/usr/bin/env node
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { createPublicClient, getAddress, http } from "viem";
import { mainnet } from "viem/chains";
import { calculateMainnetFundingGate, jsonMainnetFundingGate } from "./lib/mainnet-funding.mjs";

const RELEASE_SHA = "4728cb5cce4b0bad1c275b8bfcc2de3e8fb3f6a4";
const required = (name) => {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
};
const gasEvidencePath = resolve(required("ROBYN_MAINNET_GAS_EVIDENCE"));
const bridgeEstimatePath = resolve(required("ROBYN_MAINNET_BRIDGE_ESTIMATE"));
const bridgeAmountReportPath = resolve(required("ROBYN_MAINNET_BRIDGE_AMOUNT_REPORT"));
const outputPath = resolve(required("ROBYN_MAINNET_FUNDING_REPORT"));
const deployer = getAddress(required("ROBYN_MAINNET_DEPLOYER_ADDRESS"));
const ethereumRpc = required("ROBYN_ETHEREUM_MAINNET_RPC_URL");
const robinhoodRpc = required("ROBYN_MAINNET_RPC_URL");
if (!/^http:\/\/(127\.0\.0\.1|localhost):[0-9]+$/.test(robinhoodRpc)) {
  throw new Error("Robinhood Mainnet funding reads require the loopback LAN gateway");
}
const approvedCeilingWei = BigInt(process.env.ROBYN_MAINNET_FUNDING_CEILING_WEI ?? "47072920000000000");
const ethereum = createPublicClient({ chain: mainnet, transport: http(ethereumRpc, { retryCount: 0 }) });
const robinhood = createPublicClient({ transport: http(robinhoodRpc, { retryCount: 0 }) });
const [ethereumChainId, robinhoodChainId] = await Promise.all([ethereum.getChainId(), robinhood.getChainId()]);
if (ethereumChainId !== 1 || robinhoodChainId !== 4663) throw new Error("funding RPC chain mismatch");
const [gasEvidence, bridgeEstimate, bridgeAmountReport, currentL1BalanceWei, currentL2BalanceWei, liveL2GasPriceWei] = await Promise.all([
  readFile(gasEvidencePath, "utf8").then(JSON.parse),
  readFile(bridgeEstimatePath, "utf8").then(JSON.parse),
  readFile(bridgeAmountReportPath, "utf8").then(JSON.parse),
  ethereum.getBalance({ address: deployer }),
  robinhood.getBalance({ address: deployer }),
  robinhood.getGasPrice(),
]);
if (
  gasEvidence.schemaVersion !== 18 ||
  gasEvidence.releaseSha !== RELEASE_SHA ||
  bridgeAmountReport.schemaVersion !== 18 ||
  bridgeAmountReport.releaseSha !== RELEASE_SHA ||
  bridgeEstimate.schemaVersion !== 18 ||
  bridgeEstimate.receiptOrBroadcast !== false ||
  bridgeAmountReport.receiptOrBroadcast !== false ||
  getAddress(bridgeAmountReport.deployer) !== deployer ||
  BigInt(bridgeEstimate.bridgeAmountWei) !== BigInt(bridgeAmountReport.bridgeAmountWei)
) {
  throw new Error("Schema-18 funding evidence identity mismatch");
}
const l2GasPriceWei = BigInt(bridgeAmountReport.gasPriceWei);
if (l2GasPriceWei <= 0n || liveL2GasPriceWei * 10_000n > l2GasPriceWei * 12_500n) {
  throw new Error("pinned L2 gas price is missing or stale");
}
const result = calculateMainnetFundingGate({
  approvedCeilingWei,
  currentL1BalanceWei,
  currentL2BalanceWei,
  bridgeGasEstimate: bridgeEstimate.gasEstimate,
  bridgeMaxFeePerGasWei: bridgeEstimate.maxFeePerGasWei,
  l2GasPriceWei,
  gasEvidence,
});
if (BigInt(bridgeAmountReport.bridgeAmountWei) !== result.bridgeAmountWei) {
  throw new Error("derived bridge amount changed during final funding calculation");
}
const report = {
  schemaVersion: 18,
  releaseSha: RELEASE_SHA,
  generatedAt: new Date().toISOString(),
  chainIds: { ethereum: ethereumChainId, robinhood: robinhoodChainId },
  deployer,
  pinnedL2GasPriceWei: l2GasPriceWei.toString(),
  observedL2GasPriceWei: liveL2GasPriceWei.toString(),
  ...jsonMainnetFundingGate(result),
  broadcastAuthorized: false,
};
await mkdir(dirname(outputPath), { recursive: true, mode: 0o700 });
await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600, flag: "wx" });
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
if (!result.passed) process.exitCode = 2;
