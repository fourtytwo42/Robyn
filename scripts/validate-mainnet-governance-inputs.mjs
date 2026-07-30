#!/usr/bin/env node
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import {
  createPublicClient,
  getAddress,
  http,
  keccak256,
  parseAbi,
} from "viem";
import {
  predictChainSpecificSafe,
  safeInitializer,
  safeSaltNonce,
  validateGovernanceInputs,
} from "./lib/mainnet-governance.mjs";

const required = (name) => {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
};
const releaseSha = required("ROBYN_RELEASE_SHA");
const deploymentManifestHash = required("ROBYN_DEPLOYMENT_MANIFEST_HASH");
const deployer = getAddress(required("ROBYN_MAINNET_DEPLOYER_ADDRESS"));
const rpcUrl = required("ROBYN_MAINNET_RPC_URL");
const forkBlock = BigInt(required("ROBYN_MAINNET_FORK_BLOCK"));
const guardianPath = resolve(required("ROBYN_MAINNET_GUARDIAN_SIGNERS"));
const allocationPath = resolve(required("ROBYN_MAINNET_RDAO_ALLOCATION"));
const outputPath = resolve(required("ROBYN_MAINNET_GOVERNANCE_REPORT"));
const rehearsalConfig = JSON.parse(
  await readFile(
    new URL("../config/protocol/robinhood-mainnet-rehearsal.json", import.meta.url),
    "utf8",
  ),
);
const [guardianInput, allocationInput] = await Promise.all([
  readFile(guardianPath, "utf8").then(JSON.parse),
  readFile(allocationPath, "utf8").then(JSON.parse),
]);
const result = await validateGovernanceInputs({
  guardianInput,
  allocationInput,
  deployer,
  releaseSha,
  deploymentManifestHash,
});
if (result.failures.length > 0) {
  throw new Error(`invalid governance inputs: ${result.failures.join("; ")}`);
}

const safe = rehearsalConfig.safe;
const client = createPublicClient({ transport: http(rpcUrl) });
if ((await client.getChainId()) !== 4663) {
  throw new Error("Mainnet RPC must return chain ID 4663");
}
const codeEntries = [
  ["proxyFactory", safe.proxyFactory],
  ["singleton", safe.singleton],
  ["fallbackHandler", safe.fallbackHandler],
];
const runtimeHashes = {};
for (const [name, entry] of codeEntries) {
  const code = await client.getCode({
    address: getAddress(entry.address),
    blockNumber: forkBlock,
  });
  if (!code || code === "0x") throw new Error(`Safe ${name} has no runtime code`);
  const runtimeCodeHash = keccak256(code).toLowerCase();
  if (runtimeCodeHash !== entry.runtimeCodeHash.toLowerCase()) {
    throw new Error(`Safe ${name} runtime hash mismatch`);
  }
  runtimeHashes[name] = runtimeCodeHash;
}
const proxyCreationCode = await client.readContract({
  address: getAddress(safe.proxyFactory.address),
  abi: parseAbi(["function proxyCreationCode() view returns (bytes)"]),
  functionName: "proxyCreationCode",
  blockNumber: forkBlock,
});
const initializer = safeInitializer({
  owners: result.owners,
  fallbackHandler: safe.fallbackHandler.address,
  threshold: safe.threshold,
});
const saltNonce = safeSaltNonce({
  chainId: 4663,
  releaseSha,
  deploymentManifestHash,
  owners: result.owners,
});
const predicted = predictChainSpecificSafe({
  chainId: 4663,
  proxyFactory: safe.proxyFactory.address,
  singleton: safe.singleton.address,
  proxyCreationCode,
  initializer,
  saltNonce,
});
const report = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  chainId: 4663,
  sourceBlock: forkBlock.toString(),
  releaseSha: releaseSha.replace(/^0x/, "").toLowerCase(),
  deploymentManifestHash: deploymentManifestHash.toLowerCase(),
  deployer,
  owners: result.owners,
  threshold: safe.threshold,
  signerSetHash: result.signerSetHash,
  controlProofs: result.proofEvidence,
  allocations: result.allocations,
  safeVersion: safe.version,
  safeContracts: Object.fromEntries(
    codeEntries.map(([name, entry]) => [
      name,
      { address: getAddress(entry.address), runtimeCodeHash: runtimeHashes[name] },
    ]),
  ),
  saltNonce: saltNonce.toString(),
  initializerHash: predicted.initializerHash,
  safeSalt: predicted.salt,
  proxyCreationCodeHash: keccak256(proxyCreationCode),
  deploymentBytecodeHash: predicted.deploymentBytecodeHash,
  predictedSafe: predicted.address,
  liveTransactionAuthorized: false,
};
await mkdir(dirname(outputPath), { recursive: true, mode: 0o700 });
await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, {
  encoding: "utf8",
  flag: "wx",
  mode: 0o600,
});
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
