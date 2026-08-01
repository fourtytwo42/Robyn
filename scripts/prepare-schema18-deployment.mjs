#!/usr/bin/env node
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  concatHex,
  encodeDeployData,
  getAddress,
  isAddress,
  keccak256,
  numberToHex,
  sliceHex,
  zeroAddress,
} from "viem";
import {
  buildSchema18BootstrapCalls,
  predictSchema18Deployments,
} from "./lib/schema18-deployment.mjs";
import { buildSchema18GovernanceManifest } from "./lib/schema18-governance.mjs";

const [inputArgument, outputArgument] = process.argv.slice(2);
if (!inputArgument || !outputArgument) {
  throw new Error(
    "usage: prepare-schema18-deployment.mjs <protected-input.json> <output.json>",
  );
}
const inputPath = path.resolve(inputArgument);
const outputPath = path.resolve(outputArgument);
if (inputPath === outputPath) throw new Error("input and output paths must differ");
const inputRaw = await readFile(inputPath, "utf8");
for (const forbidden of [
  "privateKey",
  "mnemonic",
  "password",
  "seedPhrase",
  "apiKey",
]) {
  if (inputRaw.toLowerCase().includes(forbidden.toLowerCase())) {
    throw new Error(`deployment input contains forbidden field ${forbidden}`);
  }
}
const input = JSON.parse(inputRaw);
if (input.schemaVersion !== 18) throw new Error("Schema-18 input required");
if (![46630, 4663].includes(input.chainId)) throw new Error("unsupported chain");
if (!/^[0-9a-f]{40}$/.test(input.releaseSha ?? "")) {
  throw new Error("full lowercase release SHA required");
}
const routes = input.routes.map((route) => {
  if (route.canary && route.public) return route;
  if (!input.routeTemplate) {
    throw new Error(`${route.symbol ?? "route"} requires canary and public snapshots`);
  }
  const canaryMaximumNativeInput =
    route.canaryMaximumNativeInput ?? input.stockCanaryCapWei;
  const publicMaximumNativeInput =
    route.publicMaximumNativeInput ?? input.stockPublicCapWei;
  return {
    ...route,
    canary: {
      ...input.routeTemplate,
      maximumNativeInput: canaryMaximumNativeInput,
      enabled: true,
    },
    public: {
      ...input.routeTemplate,
      maximumNativeInput: publicMaximumNativeInput,
      enabled: true,
    },
  };
});
let oracleHook = input.oracleHook;
let oracleHookSalt = input.oracleHookSalt ?? null;
const provisionalPrediction = predictSchema18Deployments({
  deployer: input.deployer,
  startingNonce: input.startingNonce,
  oracleHook: isAddress(oracleHook) ? oracleHook : zeroAddress,
});
if (input.autoMineHook === true) {
  for (const key of ["poolManager", "positionManager", "create2Deployer"]) {
    if (!isAddress(input.external?.[key])) throw new Error(`missing external ${key}`);
  }
  if (!/^0x[0-9a-fA-F]{64}$/.test(input.hookDomain ?? "")) {
    throw new Error("hook domain must be bytes32");
  }
  const artifactPath = path.resolve(
    input.hookArtifact ??
      "packages/contracts/out/RobynV4FeeAndPhaseHook.sol/RobynV4FeeAndPhaseHook.json",
  );
  const artifact = JSON.parse(await readFile(artifactPath, "utf8"));
  const initCode = encodeDeployData({
    abi: artifact.abi,
    bytecode: artifact.bytecode.object,
    args: [
      getAddress(input.external.poolManager),
      provisionalPrediction.contracts.feeRouter,
      getAddress(input.deployer),
      getAddress(input.external.positionManager),
      input.hookDomain,
    ],
  });
  const initCodeHash = keccak256(initCode);
  const create2Deployer = getAddress(input.external.create2Deployer);
  const requiredFlags = BigInt(input.hookFlags ?? "0x18e4") & 0x3fffn;
  let mined;
  for (let candidate = 0; candidate < 160_444; candidate += 1) {
    const salt = numberToHex(candidate, { size: 32 });
    const digest = keccak256(concatHex(["0xff", create2Deployer, salt, initCodeHash]));
    const address = getAddress(sliceHex(digest, 12));
    if ((BigInt(address) & 0x3fffn) === requiredFlags) {
      mined = { address, salt, initCodeHash, initCode };
      break;
    }
  }
  if (!mined) throw new Error("unable to mine Schema-18 oracle hook salt");
  oracleHook = mined.address;
  oracleHookSalt = mined.salt;
  input.oracleHookInitCodeHash = mined.initCodeHash;
} else {
  if (!isAddress(oracleHook)) throw new Error("oracle hook prediction required");
  if (getAddress(oracleHook) === zeroAddress && input.provisional !== true) {
    throw new Error("final deployment input requires a nonzero oracle hook");
  }
}
const prediction = predictSchema18Deployments({
  deployer: input.deployer,
  startingNonce: input.startingNonce,
  oracleHook,
});
const [first, second] = buildSchema18BootstrapCalls({
  contracts: prediction.contracts,
  deployer: input.deployer,
  routes,
  wrappedNativeCanaryCapWei: input.wrappedNativeCanaryCapWei,
  wrappedNativePublicCapWei: input.wrappedNativePublicCapWei,
});
const governance = buildSchema18GovernanceManifest({
  schemaVersion: 18,
  chainId: input.chainId,
  releaseSha: input.releaseSha,
  deployer: input.deployer,
  guardianSafe: input.guardianSafe,
  contracts: prediction.contracts,
  bootstrap: { domain: input.bootstrapDomain, steps: [first, second] },
});
const result = {
  schemaVersion: 18,
  chainId: input.chainId,
  releaseSha: input.releaseSha,
  provisional: input.provisional === true,
  deployment: prediction,
  external: input.external ?? null,
  oracleHook: {
    address: prediction.contracts.oracleHook,
    salt: oracleHookSalt,
    initCodeHash: input.oracleHookInitCodeHash ?? null,
    domain: input.hookDomain ?? null,
  },
  governance,
  routeSymbols: routes.map((route) => route.symbol),
};
const serialized = `${JSON.stringify(result, null, 2)}\n`;
await writeFile(outputPath, serialized, { mode: 0o600, flag: "wx" });
process.stdout.write(
  `${JSON.stringify({
    output: outputPath,
    sha256: createHash("sha256").update(serialized).digest("hex"),
    timelock: prediction.contracts.timelock,
    planHashes: governance.governance.bootstrapPlanHashes,
    provisional: result.provisional,
  })}\n`,
);
