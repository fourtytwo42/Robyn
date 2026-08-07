import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { keccak256, parseEther, stringToHex, zeroAddress } from "viem";
import {
  buildSchema20NetworkPlan,
  validateSchema20NetworkInput,
} from "../lib/schema20-network-deployment.mjs";

const scriptsRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const artifactRoot = path.join(scriptsRoot, "packages/contracts/out");
const address = (suffix) => `0x${suffix.toString(16).padStart(40, "0")}`;
const runtime = (suffix) => `0x${suffix.toString(16).padStart(64, "0")}`;
const baseInput = (chainId = 46630) => ({
  schemaVersion: 20,
  chainId,
  contractReleaseSha: "d".repeat(40),
  toolingSha: "a".repeat(40),
  deployer: address(1),
  guardianSafe: address(2),
  daoToken: address(3),
  timelock: address(4),
  governor: address(5),
  startingNonce: 11,
  hookDomain: keccak256(stringToHex("SCHEMA20_TEST")),
  external: {
    create2Deployer: address(6),
    poolManager: address(7),
    positionManager: address(8),
    quoter: address(9),
    stateView: address(10),
    permit2: address(11),
    universalRouter: address(12),
    wrappedNative: address(13),
  },
  reusedRuntimeCodeHashes: {
    guardianSafe: runtime(1),
    daoToken: runtime(2),
    timelock: runtime(3),
    governor: runtime(4),
    create2Deployer: runtime(5),
    poolManager: runtime(6),
    positionManager: runtime(7),
    quoter: runtime(8),
    stateView: runtime(9),
    permit2: runtime(10),
    universalRouter: runtime(11),
    wrappedNative: runtime(12),
  },
  settings:
    chainId === 4663
      ? {
          rewardDuration: 3600,
          failureObservationSpacing: 86400,
          fallbackDelay: 259200,
          targetGraduationNative: parseEther("6").toString(),
          maximumCurvePurchase: parseEther("0.5").toString(),
          stakingWarmup: 86400,
          stakingRewardDuration: 3600,
          zeroSupplyRewardDuration: 604800,
          maintenanceTaskGas: 2000000,
          maintenanceCallGas: 2050000,
        }
      : {
          rewardDuration: 600,
          failureObservationSpacing: 60,
          fallbackDelay: 180,
          targetGraduationNative: parseEther("0.01").toString(),
          maximumCurvePurchase: parseEther("0.001").toString(),
          stakingWarmup: 600,
          stakingRewardDuration: 600,
          zeroSupplyRewardDuration: 3600,
          maintenanceTaskGas: 2000000,
          maintenanceCallGas: 2050000,
        },
  sale: {
    saleInventory: parseEther("150000000").toString(),
    liquidityInventory: parseEther("50000000").toString(),
    retainedStake: parseEther("800000000").toString(),
    virtualTokenReserve: parseEther("600000000").toString(),
    virtualNativeReserve: "10800000000000000",
    curvePrincipalTarget: "3600000000000000",
    deployerPayout: "2000000000000000",
    liquidityNative: "1600000000000000",
    dustWei: "0",
    maximumWethResidual: "1000000",
    maximumRdaoResidual: "1000000",
  },
  routes: [
    ...["GOOGL", "MSFT", "NVDA", "SPCX", "SPY"].map((symbol, index) => ({
      symbol,
      asset: address(20 + index),
      kind: "uniswap-v4",
      enabled: true,
      fee: 3000,
      tickSpacing: 30,
      hooks: zeroAddress,
      minimumLiquidity: "1",
      maximumNativeInput: parseEther("0.001").toString(),
      referenceTick: 0,
      maximumReferenceTickDeviation: 0,
      enforceReferencePrice: false,
      verificationClass: runtime(20 + index),
    })),
    {
      symbol: "WETH",
      asset: address(13),
      kind: "wrapped-native",
      enabled: true,
      maximumNativeInput: parseEther("0.001").toString(),
    },
  ],
});

test("builds a contiguous exact Schema-20 plan", () => {
  const input = baseInput();
  const plan = buildSchema20NetworkPlan(input, artifactRoot);
  assert.equal(plan.transactions.length, 46);
  assert.equal(plan.endingNonceExclusive, input.startingNonce + 46);
  assert.equal(
    new Set(plan.transactions.map((transaction) => transaction.nonce)).size,
    46,
  );
  assert.equal(plan.transactions.at(-1).label, "stake-retained-rdao");
  assert.equal(plan.routes.symbols.join(","), "GOOGL,MSFT,NVDA,SPCX,SPY,WETH");
  assert.match(plan.hook.address, /^0x[0-9A-Fa-f]{40}$/);
  assert.equal(BigInt(plan.hook.address) & 0x3fffn, 0x18e4n);
});

test("rejects a principal mismatch and wrong chain profile", () => {
  const principalMismatch = baseInput();
  principalMismatch.sale.dustWei = "1";
  assert.throws(
    () => validateSchema20NetworkInput(principalMismatch),
    /principal conservation/,
  );
  const wrongProfile = baseInput(4663);
  wrongProfile.settings.rewardDuration = 600;
  assert.throws(
    () => validateSchema20NetworkInput(wrongProfile),
    /rewardDuration/,
  );
});

test("rejects fewer than six routes", () => {
  const input = baseInput();
  input.routes.pop();
  assert.throws(
    () => validateSchema20NetworkInput(input),
    /six qualified routes/,
  );
});

test("Schema-20 application manifests declare the scoped v4 venue", async () => {
  const source = await readFile(
    path.join(
      scriptsRoot,
      "scripts/finalize-schema20-application-manifest.mjs",
    ),
    "utf8",
  );
  assert.match(source, /liquidityVenue: "uniswap-v4"/);
});

test("Mainnet capture requalifies routes instead of copying stale thresholds", async () => {
  const source = await readFile(
    path.join(scriptsRoot, "scripts/capture-schema20-network-input.mjs"),
    "utf8",
  );
  assert.match(source, /quoteExactInputSingle/);
  assert.match(source, /quoteExactOutputSingle/);
  assert.match(source, /entry\.amount >= 1_000_000_000_000_000n/);
  assert.match(source, /entry\.recoveryBps >= 9_500/);
  assert.match(source, /entry\.protectedImpactPassed/);
  assert.match(source, /protectedQuoteFloor/);
  assert.match(source, /idealAssetOutput/);
  assert.match(source, /minimumLiquidity = liquidity \/ 2n/);
  assert.match(
    source,
    /referenceDeviationTicks <= maximumReferenceTickDeviation/,
  );
  assert.match(source, /oraclePaused/);
  assert.match(source, /routeByAsset/);
  assert.match(source, /fee: Number\(sourceRoute\.fee\)/);
  assert.match(source, /poolId: route\.poolId/);
  assert.match(source, /catalog-candidate/);
  assert.match(source, /application-catalog-candidate/);
  assert.match(source, /candidatePools/);
  assert.match(source, /mainnetAssetPolicy\.assets/);
  assert.match(source, /tokenDecimalAdjustment/);
  assert.match(source, /routeQualificationRejections/);
  assert.match(source, /fewer than five safe Mainnet stock routes plus WETH/);
});
