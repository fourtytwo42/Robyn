#!/usr/bin/env node
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { createPublicClient, getAddress, http } from "viem";
import { summarizeMainnetGasEvidence } from "./lib/mainnet-funding.mjs";

const RELEASE_SHA = "4728cb5cce4b0bad1c275b8bfcc2de3e8fb3f6a4";
const required = (name) => {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
};
const evidencePath = resolve(required("ROBYN_MAINNET_GAS_EVIDENCE"));
const outputPath = resolve(required("ROBYN_MAINNET_BRIDGE_AMOUNT_REPORT"));
const rpcUrl = required("ROBYN_MAINNET_RPC_URL");
if (!/^http:\/\/(127\.0\.0\.1|localhost):[0-9]+$/.test(rpcUrl)) {
  throw new Error("Robinhood Mainnet balance must come from the loopback LAN gateway");
}
const deployer = getAddress(required("ROBYN_MAINNET_DEPLOYER_ADDRESS"));
const evidence = JSON.parse(await readFile(evidencePath, "utf8"));
if (evidence.schemaVersion !== 18 || evidence.releaseSha !== RELEASE_SHA) {
  throw new Error("Schema-18 receipt ledger required");
}
const client = createPublicClient({ transport: http(rpcUrl, { retryCount: 0 }) });
if ((await client.getChainId()) !== 4663) throw new Error("Robinhood RPC must return chain ID 4663");
const [balance, gasPrice, blockNumber] = await Promise.all([
  client.getBalance({ address: deployer }),
  client.getGasPrice(),
  client.getBlockNumber(),
]);
const gas = summarizeMainnetGasEvidence(evidence);
const headroom = (gas.totalGas * gasPrice * 15_000n + 9_999n) / 10_000n;
const grossRequirement = 20_000_000_000_000_000n + 10_000_000_000_000_000n + headroom;
const bridgeAmount = grossRequirement > balance ? grossRequirement - balance : 0n;
const report = {
  schemaVersion: 18,
  generatedAt: new Date().toISOString(),
  chainId: 4663,
  sourceBlock: blockNumber.toString(),
  releaseSha: RELEASE_SHA,
  deployer,
  gasEvidencePath: evidencePath,
  transactionCount: gas.transactionCount,
  measuredGas: gas.totalGas.toString(),
  gasPriceWei: gasPrice.toString(),
  l2GasWithHeadroomWei: headroom.toString(),
  existingL2BalanceWei: balance.toString(),
  l2OperationalReserveWei: "20000000000000000",
  canaryPrincipalWei: "10000000000000000",
  bridgeAmountWei: bridgeAmount.toString(),
  bridgeRequired: bridgeAmount > 0n,
  receiptOrBroadcast: false,
};
await mkdir(dirname(outputPath), { recursive: true, mode: 0o700 });
await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, {
  mode: 0o600,
  flag: "wx",
});
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
