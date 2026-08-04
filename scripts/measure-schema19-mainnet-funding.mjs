#!/usr/bin/env node
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { createPublicClient, http } from "viem";
import { calculateSchema19MainnetFunding } from "./lib/schema19-mainnet-funding.mjs";

const [deploymentArg, retirementArg, lifecycleArg, outputArg] = process.argv.slice(2);
if (![deploymentArg, retirementArg, lifecycleArg, outputArg].every(Boolean)) {
  throw new Error("usage: measure-schema19-mainnet-funding.mjs <deployment-ledger> <retirement-ledger> <lifecycle-journal> <output>");
}
const rpc = process.env.ROBYN_SCHEMA19_MAINNET_RPC_URL ?? "http://127.0.0.1:18549";
const parsed = new URL(rpc);
if (!["127.0.0.1", "localhost"].includes(parsed.hostname)) throw new Error("Mainnet funding requires loopback LAN RPC");
const files = [deploymentArg, retirementArg, lifecycleArg].map(path.resolve);
const [deploymentRaw, retirementRaw, lifecycleRaw] = await Promise.all(files.map((file) => readFile(file, "utf8")));
const deploymentLedger = JSON.parse(deploymentRaw);
const retirementLedger = JSON.parse(retirementRaw);
const lifecycleJournal = lifecycleRaw.trim().split("\n").filter(Boolean).map(JSON.parse);
const client = createPublicClient({ transport: http(rpc, { retryCount: 0, timeout: 30_000 }) });
if ((await client.getChainId()) !== 4663 || (await client.request({ method: "eth_syncing" })) !== false) {
  throw new Error("Mainnet funding RPC is wrong-chain or syncing");
}
const gateway = await fetch(new URL("/health", rpc)).then(async (response) => {
  if (!response.ok) throw new Error(`gateway health ${response.status}`);
  return response.json();
});
if (gateway.status !== "ok" || gateway.activeProvider !== "primary" || gateway.providerSelection !== "operator" || gateway.fallbackTrafficAuthorized !== false) {
  throw new Error("Mainnet funding requires healthy LAN-only gateway");
}
const deployer = "0xecc5d6d032ADc9ca9E0F4042128067b8366da17A";
const block = await client.getBlock();
const [balanceWei, gasPriceWei, priorityFeeWei] = await Promise.all([
  client.getBalance({ address: deployer }),
  client.getGasPrice(),
  client.estimateMaxPriorityFeePerGas().catch(() => 0n),
]);
const calculation = calculateSchema19MainnetFunding({
  deploymentLedger, retirementLedger, lifecycleJournal, balanceWei,
  baseFeeWei: block.baseFeePerGas ?? 0n, gasPriceWei, priorityFeeWei,
});
const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const result = {
  schemaVersion: 19,
  chainId: 4663,
  generatedAt: new Date().toISOString(),
  measurementBlock: block.number.toString(),
  deploymentLedgerSha256: sha256(deploymentRaw),
  retirementLedgerSha256: sha256(retirementRaw),
  lifecycleJournalSha256: sha256(lifecycleRaw),
  ...Object.fromEntries(Object.entries(calculation).map(([key, value]) => [key, typeof value === "bigint" ? value.toString() : value])),
};
const serialized = `${JSON.stringify(result, null, 2)}\n`;
await writeFile(path.resolve(outputArg), serialized, { mode: 0o600, flag: "wx" });
process.stdout.write(`${JSON.stringify({ passed: result.passed, requiredBalance: result.requiredBalance, availableBalance: result.availableBalance, margin: result.margin, bridgeShortfall: result.bridgeShortfall, sha256: sha256(serialized) })}\n`);
if (!result.passed) process.exitCode = 2;
