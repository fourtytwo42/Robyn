#!/usr/bin/env node
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { createPublicClient, getAddress, http } from "viem";
import { mainnet } from "viem/chains";
import {
  calculateMainnetFundingGate,
  jsonMainnetFundingGate,
} from "./lib/mainnet-funding.mjs";

const required = (name) => {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
};

const gasEvidencePath = resolve(required("ROBYN_MAINNET_GAS_EVIDENCE"));
const bridgeEstimatePath = resolve(required("ROBYN_MAINNET_BRIDGE_ESTIMATE"));
const outputPath = resolve(required("ROBYN_MAINNET_FUNDING_REPORT"));
const deployer = getAddress(required("ROBYN_MAINNET_DEPLOYER_ADDRESS"));
const ethereumRpc = required("ROBYN_ETHEREUM_MAINNET_RPC_URL");
const robinhoodRpc = required("ROBYN_MAINNET_RPC_URL");
const approvedCeilingWei = BigInt(
  process.env.ROBYN_MAINNET_FUNDING_CEILING_WEI ?? "47072920000000000",
);

const ethereum = createPublicClient({ chain: mainnet, transport: http(ethereumRpc) });
const robinhood = createPublicClient({ transport: http(robinhoodRpc) });
const [ethereumChainId, robinhoodChainId] = await Promise.all([
  ethereum.getChainId(),
  robinhood.getChainId(),
]);
if (ethereumChainId !== 1) throw new Error("Ethereum RPC must return chain ID 1");
if (robinhoodChainId !== 4663) {
  throw new Error("Robinhood RPC must return chain ID 4663");
}

const [gasEvidence, bridgeEstimate, currentL1BalanceWei, currentL2BalanceWei, l2GasPriceWei] =
  await Promise.all([
    readFile(gasEvidencePath, "utf8").then(JSON.parse),
    readFile(bridgeEstimatePath, "utf8").then(JSON.parse),
    ethereum.getBalance({ address: deployer }),
    robinhood.getBalance({ address: deployer }),
    robinhood.getGasPrice(),
  ]);
if (Number(bridgeEstimate.chainId) !== 1) {
  throw new Error("bridge estimate must be for Ethereum chain ID 1");
}
if (getAddress(bridgeEstimate.sender) !== deployer) {
  throw new Error("bridge estimate sender does not match the protected deployer");
}
if (
  getAddress(bridgeEstimate.target) !==
    getAddress("0x1A07cc4BD17E0118BdB54D70990D2158AbAD7a2D") ||
  bridgeEstimate.runtimeCodeHash?.toLowerCase() !==
    "0x69a469ef198a7f785b09fb0783fe42576faef7635e2d56426ec8746bad638e64" ||
  bridgeEstimate.method !== "depositEth()"
) {
  throw new Error("bridge estimate does not match the pinned canonical bridge");
}
if (bridgeEstimate.receiptOrBroadcast === true) {
  throw new Error("bridge estimate must be non-broadcast evidence");
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
const report = {
  schemaVersion: 16,
  generatedAt: new Date().toISOString(),
  chainIds: { ethereum: ethereumChainId, robinhood: robinhoodChainId },
  deployer,
  gasEvidencePath,
  bridgeEstimatePath,
  ...jsonMainnetFundingGate(result),
  broadcastAuthorized: false,
};
await mkdir(dirname(outputPath), { recursive: true, mode: 0o700 });
await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, {
  encoding: "utf8",
  flag: "wx",
  mode: 0o600,
});
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
if (!result.passed) process.exitCode = 2;
