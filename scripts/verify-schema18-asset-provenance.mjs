import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

const repo = resolve(dirname(new URL(import.meta.url).pathname), "..");
const policyPath = resolve(process.argv[2] ?? `${repo}/config/protocol/robinhood-mainnet-support-policy.json`);
const output = process.env.ROBYN_SCHEMA18_PROVENANCE_EVIDENCE
  ? resolve(process.env.ROBYN_SCHEMA18_PROVENANCE_EVIDENCE)
  : null;
const policy = JSON.parse(await readFile(policyPath, "utf8"));
if (policy.schemaVersion !== 18 || policy.chainId !== 4663) throw new Error("invalid Schema-18 asset policy");
const response = await fetch("https://api.robinhood.com/rhj/assets", {
  headers: { accept: "application/json", "user-agent": "sherwood-forest-asset-provenance/1" },
  signal: AbortSignal.timeout(30_000),
});
if (!response.ok) throw new Error(`Robinhood asset registry returned ${response.status}`);
const registry = await response.json();
if (!Array.isArray(registry.assets)) throw new Error("Robinhood asset registry response is malformed");
const bySymbol = new Map(registry.assets.map((asset) => [asset.tokenSymbol, asset]));
const results = [];
for (const asset of policy.assets) {
  if (asset.provenance === "robinhood-canonical-contract") {
    results.push({ symbol: asset.symbol, status: "canonical-contract-policy", address: asset.address });
    continue;
  }
  const official = bySymbol.get(asset.symbol);
  const deployment = official?.deployments?.find((item) => item.chainId === 4663);
  if (!official || !deployment) throw new Error(`${asset.symbol} is absent from the official chain-4663 registry`);
  if (deployment.contractAddress.toLowerCase() !== asset.address.toLowerCase())
    throw new Error(`${asset.symbol} canonical address changed`);
  if (!official.logoUrl || official.logoUrl !== asset.logoUrl)
    throw new Error(`${asset.symbol} official logo identity changed`);
  results.push({
    symbol: asset.symbol,
    status: "verified",
    address: deployment.contractAddress,
    tokenName: official.tokenName,
    logoUrl: official.logoUrl,
  });
}
const evidence = {
  schemaVersion: 18,
  chainId: 4663,
  policyVersion: policy.policyVersion,
  policyHash: policy.policyHash,
  source: "https://api.robinhood.com/rhj/assets",
  priceFieldsConsumed: false,
  checkedAt: new Date().toISOString(),
  results,
};
const evidenceHash = createHash("sha256").update(JSON.stringify(evidence)).digest("hex");
if (output) {
  await mkdir(dirname(output), { recursive: true, mode: 0o700 });
  await writeFile(output, `${JSON.stringify({ ...evidence, evidenceHash }, null, 2)}\n`, { mode: 0o600 });
}
process.stdout.write(`${JSON.stringify({ passed: true, assets: results.length, evidenceHash, output })}\n`);
