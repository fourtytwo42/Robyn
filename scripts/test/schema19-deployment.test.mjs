import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import {
  decodeFunctionData,
  getContractAddress,
  getCreate2Address,
  parseAbi,
} from "viem";
import {
  buildSchema19RouteConfiguration,
  predictSchema19Deployments,
  SCHEMA19_DEPLOYMENT_SEQUENCE,
} from "../lib/schema19-deployment.mjs";

const repo = path.resolve(new URL("../..", import.meta.url).pathname);
const address = (value) => `0x${value.toString(16).padStart(40, "0")}`;
const verificationClass = `0x${"19".repeat(32)}`;
const routeAbi = parseAbi([
  "function configureRoute(address asset,(uint24 fee,int24 tickSpacing,address hooks,uint128 minimumLiquidity,uint128 maximumNativeInput,int24 referenceTick,uint24 maximumReferenceTickDeviation,bool enforceReferencePrice,bytes32 verificationClass,bool enabled) route)",
  "function configureWrappedNativeRoute(uint128 maximumNativeInput,bool enabled)",
]);

test("deployment prediction accounts for CREATE2 and pre-coordinator bindings", () => {
  const deployer = address(1);
  const oracleHook = address(2);
  const result = predictSchema19Deployments({
    deployer,
    startingNonce: 41,
    oracleHook,
  });
  assert.equal(SCHEMA19_DEPLOYMENT_SEQUENCE.length, 19);
  assert.equal(result.contracts.oracleHook, oracleHook);
  assert.equal(result.endingNonceExclusive, 60);
  assert.equal(result.fullEndingNonceExclusive(6), 77);
  assert.equal(
    result.contracts.coordinator,
    getContractAddress({ from: deployer, nonce: 59n }),
  );
  assert.deepEqual(
    result.transactions.slice(15, 18).map((entry) => entry.predictedAddress),
    [null, null, null],
  );
});

test("route configuration seals one enabled WETH route and five v4 routes", () => {
  const wrappedNative = address(100);
  const routes = [
    ...Array.from({ length: 5 }, (_, index) => ({
      symbol: `ASSET${index}`,
      asset: address(index + 10),
      kind: "uniswap-v4",
      fee: 3000,
      tickSpacing: 60,
      hooks: address(0),
      minimumLiquidity: "1",
      maximumNativeInput: "1000000000000000",
      referenceTick: 0,
      maximumReferenceTickDeviation: 198,
      enforceReferencePrice: true,
      verificationClass,
      enabled: true,
    })),
    {
      symbol: "WETH",
      asset: wrappedNative,
      kind: "wrapped-native",
      maximumNativeInput: "1000000000000000",
      enabled: true,
    },
  ];
  const result = buildSchema19RouteConfiguration(routes, wrappedNative);
  assert.equal(result.assets.length, 6);
  assert.equal(result.configurationCalldata.length, 6);
  assert.equal(
    decodeFunctionData({ abi: routeAbi, data: result.configurationCalldata[0] })
      .functionName,
    "configureRoute",
  );
  assert.equal(
    decodeFunctionData({ abi: routeAbi, data: result.configurationCalldata[5] })
      .functionName,
    "configureWrappedNativeRoute",
  );
});

test("route configuration rejects partial and duplicate active sets", () => {
  const wrappedNative = address(100);
  assert.throws(
    () => buildSchema19RouteConfiguration([], wrappedNative),
    /six routes required/,
  );
  const duplicate = Array.from({ length: 6 }, () => ({
    symbol: "WETH",
    asset: wrappedNative,
    kind: "wrapped-native",
    maximumNativeInput: "1",
    enabled: true,
  }));
  assert.throws(
    () => buildSchema19RouteConfiguration(duplicate, wrappedNative),
    /duplicate route/,
  );
});

test("preparer is secret rejecting and chain-profile bound", async () => {
  const source = await readFile(
    path.join(repo, "scripts/prepare-schema19-deployment.mjs"),
    "utf8",
  );
  assert.match(source, /Schema-19 input required/);
  assert.match(source, /deployment input contains forbidden field/);
  assert.match(source, /rewardDuration: 600/);
  assert.match(source, /rewardDuration: 3600/);
  assert.match(source, /fallbackDelay: 1200/);
  assert.match(source, /fallbackDelay: 259200/);
  assert.match(source, /unqualified maintenance gas policy/);
  assert.match(source, /oracle hook CREATE2 prediction mismatch/);
});

test("preparer emits an exact accelerated Testnet deployment input", async () => {
  const temporary = await mkdtemp(path.join(os.tmpdir(), "schema19-prepare-"));
  try {
    const inputPath = path.join(temporary, "input.json");
    const outputPath = path.join(temporary, "output.json");
    const create2Deployer = address(6);
    const hookSalt = `0x${"22".repeat(32)}`;
    const hookInitCodeHash = `0x${"11".repeat(32)}`;
    const oracleHook = getCreate2Address({
      from: create2Deployer,
      salt: hookSalt,
      bytecodeHash: hookInitCodeHash,
    });
    const routes = [
      ...Array.from({ length: 5 }, (_, index) => ({
        symbol: `ASSET${index}`,
        asset: address(index + 20),
        kind: "uniswap-v4",
        fee: 3000,
        tickSpacing: 60,
        hooks: address(0),
        minimumLiquidity: "1",
        maximumNativeInput: "1000000000000000",
        referenceTick: 0,
        maximumReferenceTickDeviation: 198,
        enforceReferencePrice: true,
        verificationClass,
        enabled: true,
      })),
      {
        symbol: "WETH",
        asset: address(12),
        kind: "wrapped-native",
        maximumNativeInput: "1000000000000000",
        enabled: true,
      },
    ];
    await writeFile(
      inputPath,
      JSON.stringify({
        schemaVersion: 19,
        chainId: 46630,
        contractReleaseSha: "4a39cf470f0870c1757b2ead8730bf0209eabbc4",
        toolingSha: "acf65fdd6eea6b287f22827776b9708507ba5854",
        reusedRuntimeCodeHashes: Object.fromEntries(
          [
            "guardianSafe",
            "daoToken",
            "timelock",
            "governor",
            "create2Deployer",
            "poolManager",
            "positionManager",
            "quoter",
            "stateView",
            "permit2",
            "wrappedNative",
          ].map((field, index) => [
            field,
            `0x${(index + 1).toString(16).padStart(64, "0")}`,
          ]),
        ),
        deployer: address(1),
        guardianSafe: address(2),
        daoToken: address(3),
        timelock: address(4),
        governor: address(5),
        startingNonce: 7,
        external: {
          create2Deployer,
          poolManager: address(7),
          positionManager: address(8),
          quoter: address(9),
          stateView: address(10),
          permit2: address(11),
          wrappedNative: address(12),
        },
        oracleHook,
        hookSalt,
        hookInitCodeHash,
        hookDomain: `0x${"33".repeat(32)}`,
        settings: {
          rewardDuration: 600,
          failureObservationSpacing: 300,
          fallbackDelay: 1200,
          targetGraduationNative: "10000000000000000",
          maximumCurvePurchase: "1000000000000000",
          maintenanceTaskGas: 1500000,
          maintenanceCallGas: 1550000,
        },
        routes,
      }),
    );
    const run = spawnSync(
      process.execPath,
      [
        path.join(repo, "scripts/prepare-schema19-deployment.mjs"),
        inputPath,
        outputPath,
      ],
      { encoding: "utf8" },
    );
    assert.equal(run.status, 0, run.stderr);
    const result = JSON.parse(await readFile(outputPath, "utf8"));
    assert.equal(result.schemaVersion, 19);
    assert.equal(result.chainId, 46630);
    assert.equal(result.deployment.contracts.oracleHook, oracleHook);
    assert.equal(result.routes.configurationCalldata.length, 6);
    assert.equal(result.settings.rewardDuration, 600);
    assert.equal(result.deployment.endingNonceExclusive, 26);
    assert.equal(result.deployment.fullEndingNonceExclusive, 43);
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
});
