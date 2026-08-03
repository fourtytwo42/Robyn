#!/usr/bin/env node
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  concatHex,
  encodeDeployData,
  getAddress,
  getCreate2Address,
  isAddress,
  keccak256,
  numberToHex,
  sliceHex,
} from "viem";
import {
  buildSchema19RouteConfiguration,
  predictSchema19Deployments,
} from "./lib/schema19-deployment.mjs";

const [inputArgument, outputArgument] = process.argv.slice(2);
if (!inputArgument || !outputArgument) {
  throw new Error(
    "usage: prepare-schema19-deployment.mjs <protected-input.json> <output.json>",
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
if (input.schemaVersion !== 19) throw new Error("Schema-19 input required");
if (![46630, 4663].includes(input.chainId)) throw new Error("unsupported chain");
for (const field of ["contractReleaseSha", "toolingSha"]) {
  if (!/^[0-9a-f]{40}$/.test(input[field] ?? "")) {
    throw new Error(`full lowercase ${field} required`);
  }
}
for (const field of ["deployer", "guardianSafe", "daoToken", "timelock", "governor"]) {
  if (!isAddress(input[field])) throw new Error(`invalid ${field}`);
}
for (const field of [
  "create2Deployer",
  "poolManager",
  "positionManager",
  "quoter",
  "stateView",
  "permit2",
  "wrappedNative",
]) {
  if (!isAddress(input.external?.[field])) throw new Error(`missing external ${field}`);
}
const settings = {
  rewardDuration: Number(input.settings?.rewardDuration),
  failureObservationSpacing: Number(input.settings?.failureObservationSpacing),
  fallbackDelay: Number(input.settings?.fallbackDelay),
  targetGraduationNative: String(input.settings?.targetGraduationNative ?? ""),
  maximumCurvePurchase: String(input.settings?.maximumCurvePurchase ?? ""),
  maintenanceTaskGas: Number(input.settings?.maintenanceTaskGas),
  maintenanceCallGas: Number(input.settings?.maintenanceCallGas),
};
const expected =
  input.chainId === 4663
    ? {
        rewardDuration: 3600,
        failureObservationSpacing: 86400,
        fallbackDelay: 259200,
        targetGraduationNative: "6000000000000000000",
        maximumCurvePurchase: "500000000000000000",
      }
    : {
        rewardDuration: 600,
        failureObservationSpacing: 300,
        fallbackDelay: 1200,
        targetGraduationNative: "10000000000000000",
        maximumCurvePurchase: "1000000000000000",
      };
for (const [key, value] of Object.entries(expected)) {
  if (settings[key] !== value) throw new Error(`${key} does not match chain profile`);
}
if (settings.maintenanceTaskGas !== 1_500_000 || settings.maintenanceCallGas !== 1_550_000) {
  throw new Error("unqualified maintenance gas policy");
}
if (!Number.isSafeInteger(input.startingNonce) || input.startingNonce < 0) {
  throw new Error("invalid starting nonce");
}
if (!/^0x[0-9a-fA-F]{64}$/.test(input.hookDomain ?? "")) {
  throw new Error("hook domain must be bytes32");
}
let oracleHook = input.oracleHook;
let hookSalt = input.hookSalt;
let hookInitCodeHash = input.hookInitCodeHash;
const provisional = predictSchema19Deployments({
  deployer: input.deployer,
  startingNonce: input.startingNonce,
  oracleHook: isAddress(oracleHook)
    ? oracleHook
    : "0x0000000000000000000000000000000000000000",
});
if (input.autoMineHook === true) {
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
      provisional.contracts.feeRouter,
      getAddress(input.deployer),
      getAddress(input.external.positionManager),
      input.hookDomain,
    ],
  });
  hookInitCodeHash = keccak256(initCode);
  const create2Deployer = getAddress(input.external.create2Deployer);
  const requiredFlags = BigInt(input.hookFlags ?? "0x18e4") & 0x3fffn;
  for (let candidate = 0; candidate < 160_444; candidate += 1) {
    const salt = numberToHex(candidate, { size: 32 });
    const digest = keccak256(
      concatHex(["0xff", create2Deployer, salt, hookInitCodeHash]),
    );
    const address = getAddress(sliceHex(digest, 12));
    if ((BigInt(address) & 0x3fffn) === requiredFlags) {
      oracleHook = address;
      hookSalt = salt;
      break;
    }
  }
  if (!isAddress(oracleHook)) throw new Error("unable to mine Schema-19 hook salt");
} else {
  if (!/^0x[0-9a-fA-F]{64}$/.test(hookSalt ?? "")) throw new Error("hook salt required");
  if (!/^0x[0-9a-fA-F]{64}$/.test(hookInitCodeHash ?? "")) {
    throw new Error("hook init code hash required");
  }
  const computed = getCreate2Address({
    from: getAddress(input.external.create2Deployer),
    salt: hookSalt,
    bytecodeHash: hookInitCodeHash,
  });
  if (!isAddress(oracleHook) || getAddress(oracleHook) !== computed) {
    throw new Error("oracle hook CREATE2 prediction mismatch");
  }
}
const deployment = predictSchema19Deployments({
  deployer: input.deployer,
  startingNonce: input.startingNonce,
  oracleHook,
});
const routes = buildSchema19RouteConfiguration(
  input.routes,
  input.external.wrappedNative,
);
const result = {
  schemaVersion: 19,
  chainId: input.chainId,
  provisional: false,
  contractReleaseSha: input.contractReleaseSha,
  toolingSha: input.toolingSha,
  deployment,
  governance: {
    guardianSafe: getAddress(input.guardianSafe),
    daoToken: getAddress(input.daoToken),
    timelock: getAddress(input.timelock),
    governor: getAddress(input.governor),
  },
  external: Object.fromEntries(
    Object.entries(input.external).map(([key, value]) => [key, getAddress(value)]),
  ),
  oracleHook: {
    address: deployment.contracts.oracleHook,
    salt: hookSalt,
    initCodeHash: hookInitCodeHash,
    domain: input.hookDomain,
  },
  settings,
  routes: {
    symbols: input.routes.map((route) => route.symbol),
    assets: routes.assets,
    configurationCalldata: routes.configurationCalldata,
  },
};
const serialized = `${JSON.stringify(result, null, 2)}\n`;
await writeFile(outputPath, serialized, { mode: 0o600, flag: "wx" });
process.stdout.write(
  `${JSON.stringify({
    output: outputPath,
    sha256: createHash("sha256").update(serialized).digest("hex"),
    endingNonceExclusive: deployment.endingNonceExclusive,
    contracts: deployment.contracts,
  })}\n`,
);
