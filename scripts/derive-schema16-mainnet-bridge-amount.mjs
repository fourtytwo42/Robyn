#!/usr/bin/env node
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { createPublicClient, getAddress, http } from "viem";
import { summarizeMainnetGasEvidence } from "./lib/mainnet-funding.mjs";

const required = (name) => {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
};
const evidencePath = resolve(required("ROBYN_MAINNET_GAS_EVIDENCE"));
const outputPath = resolve(required("ROBYN_MAINNET_BRIDGE_AMOUNT_REPORT"));
const rpcUrl = required("ROBYN_MAINNET_RPC_URL");
const deployer = getAddress(required("ROBYN_MAINNET_DEPLOYER_ADDRESS"));
const evidence = JSON.parse(await readFile(evidencePath, "utf8"));
const client = createPublicClient({ transport: http(rpcUrl) });
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
if (bridgeAmount === 0n) throw new Error("calculated bridge amount must be positive");
const report = {
  schemaVersion: 16,
  generatedAt: new Date().toISOString(),
  chainId: 4663,
  sourceBlock: blockNumber.toString(),
  releaseSha: evidence.releaseSha,
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
  receiptOrBroadcast: false,
};
await mkdir(dirname(outputPath), { recursive: true, mode: 0o700 });
await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, {
  mode: 0o600,
  flag: "wx",
});
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
