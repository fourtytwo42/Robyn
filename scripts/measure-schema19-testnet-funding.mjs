#!/usr/bin/env node
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { createPublicClient, http } from "viem";
import { calculateSchema19TestnetFunding } from "./lib/schema19-testnet-funding.mjs";

const [preparedArgument, ledgerArgument, outputArgument] = process.argv.slice(2);
if (!preparedArgument || !ledgerArgument || !outputArgument) {
  throw new Error("usage: measure-schema19-testnet-funding.mjs <prepared.json> <forge-ledger.json> <output.json>");
}
const rpcUrl = process.env.ROBYN_SCHEMA19_RPC_URL;
if (!rpcUrl) throw new Error("ROBYN_SCHEMA19_RPC_URL is required");
const parsedRpc = new URL(rpcUrl);
if (!["127.0.0.1", "localhost"].includes(parsedRpc.hostname)) {
  throw new Error("Schema-19 funding requires the loopback LAN gateway");
}
const [preparedRaw, ledgerRaw] = await Promise.all([
  readFile(path.resolve(preparedArgument), "utf8"),
  readFile(path.resolve(ledgerArgument), "utf8"),
]);
const prepared = JSON.parse(preparedRaw);
const ledger = JSON.parse(ledgerRaw);
const client = createPublicClient({ transport: http(rpcUrl, { retryCount: 0 }) });
if ((await client.getChainId()) !== 46630) throw new Error("Schema-19 funding chain mismatch");
if ((await client.request({ method: "eth_syncing", params: [] })) !== false) {
  throw new Error("Schema-19 funding RPC is syncing");
}
const block = await client.getBlock();
const [balanceWei, gasPriceWei, priorityFeeWei] = await Promise.all([
  client.getBalance({ address: prepared.deployment.deployer }),
  client.getGasPrice(),
  client.estimateMaxPriorityFeePerGas().catch(() => 0n),
]);
const calculation = calculateSchema19TestnetFunding({
  ledger,
  prepared,
  balanceWei,
  baseFeeWei: block.baseFeePerGas ?? 0n,
  gasPriceWei,
  priorityFeeWei,
});
const result = {
  schemaVersion: 19,
  chainId: 46630,
  generatedAt: new Date().toISOString(),
  measurementBlock: block.number.toString(),
  preparedManifestSha256: createHash("sha256").update(preparedRaw).digest("hex"),
  receiptLedgerSha256: createHash("sha256").update(ledgerRaw).digest("hex"),
  ...Object.fromEntries(
    Object.entries(calculation).map(([key, value]) => [
      key,
      typeof value === "bigint" ? value.toString() : value,
    ]),
  ),
};
const serialized = `${JSON.stringify(result, null, 2)}\n`;
await writeFile(path.resolve(outputArgument), serialized, { mode: 0o600, flag: "wx" });
process.stdout.write(`${JSON.stringify({ passed: result.passed, requiredBalance: result.requiredBalance, availableBalance: result.availableBalance, margin: result.margin, sha256: createHash("sha256").update(serialized).digest("hex") })}\n`);
if (!result.passed) process.exitCode = 2;
