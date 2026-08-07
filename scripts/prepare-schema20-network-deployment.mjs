#!/usr/bin/env node
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getAddress, keccak256 } from "viem";
import {
  buildSchema20NetworkPlan,
  validateSchema20NetworkInput,
} from "./lib/schema20-network-deployment.mjs";

const [inputArgument, outputArgument] = process.argv.slice(2);
if (!inputArgument || !outputArgument) {
  throw new Error("usage: prepare-schema20-network-deployment.mjs <protected-input.json> <output.json>");
}
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const inputPath = path.resolve(inputArgument);
const outputPath = path.resolve(outputArgument);
if (inputPath === outputPath) throw new Error("input and output paths must differ");
const inputRaw = await readFile(inputPath, "utf8");
for (const forbidden of ["privateKey", "mnemonic", "password", "seedPhrase", "apiKey"]) {
  if (inputRaw.toLowerCase().includes(forbidden.toLowerCase())) {
    throw new Error(`deployment input contains forbidden field ${forbidden}`);
  }
}
const input = JSON.parse(inputRaw);
validateSchema20NetworkInput(input);
const plan = buildSchema20NetworkPlan(
  input,
  path.join(repoRoot, "packages/contracts/out"),
);
const transactionCommitments = plan.transactions.map((transaction) => ({
  label: transaction.label,
  nonce: transaction.nonce,
  to: transaction.to,
  value: transaction.value,
  calldataHash: keccak256(transaction.data),
  expectedContractAddress: transaction.expectedContractAddress,
}));
const prepared = {
  schemaVersion: 20,
  chainId: input.chainId,
  environment: input.chainId === 4663 ? "robyn-mainnet" : "robyn-testnet",
  contractReleaseSha: input.contractReleaseSha,
  toolingSha: input.toolingSha,
  deployment: {
    deployer: getAddress(input.deployer),
    startingNonce: input.startingNonce,
    endingNonceExclusive: plan.endingNonceExclusive,
    contracts: plan.contracts,
  },
  governance: {
    guardianSafe: getAddress(input.guardianSafe),
    daoToken: getAddress(input.daoToken),
    timelock: getAddress(input.timelock),
    governor: getAddress(input.governor),
  },
  reusedRuntimeCodeHashes: input.reusedRuntimeCodeHashes,
  external: Object.fromEntries(
    Object.entries(input.external).map(([key, value]) => [key, getAddress(value)]),
  ),
  settings: input.settings,
  sale: input.sale,
  saleOracleEvidence: input.saleOracleEvidence ?? null,
  routes: { ...plan.routes, definitions: input.routes },
  assetCatalog: input.assetCatalog,
  rpcPolicy: input.rpcPolicy,
  sourceSchema19ManifestSha256: input.sourceSchema19ManifestSha256,
  hook: plan.hook,
  transactions: plan.transactions,
  transactionCommitments,
  transactionPlanSha256: createHash("sha256")
    .update(JSON.stringify(transactionCommitments))
    .digest("hex"),
};
const serialized = `${JSON.stringify(prepared, null, 2)}\n`;
await writeFile(outputPath, serialized, { mode: 0o600, flag: "wx" });
process.stdout.write(`${JSON.stringify({
  output: outputPath,
  sha256: createHash("sha256").update(serialized).digest("hex"),
  transactionCount: prepared.transactions.length,
  endingNonceExclusive: prepared.deployment.endingNonceExclusive,
  contracts: prepared.deployment.contracts,
})}\n`);
