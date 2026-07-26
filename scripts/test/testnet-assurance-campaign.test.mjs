import assert from "node:assert/strict";
import test from "node:test";
import {
  decryptCampaignRoot,
  deriveCampaignAccounts,
  encryptCampaignRoot,
  fundingTreeTransfers,
  weightedFundingTreeTransfers,
} from "../lib/campaign-wallets.mjs";
import { parseCastDecryptedPrivateKey } from "../lib/campaign-keystore.mjs";
import {
  applyHeadroom,
  basketConversionActorIndex,
  graduationActorIndex,
  launchBasketPlan,
  minimumActionCount,
  nativeSweepReserveWei,
  plannedBuyValueWei,
  plannedTransactionValueWei,
  plannedWalletValueWei,
  PLANNED_SWEEP_GAS_UNITS_PER_ACTOR,
  PRICED_TRANSACTION_COUNT,
  weightedWalletFunding,
  projectCampaignCost,
  REQUIRED_RESERVE_WEI,
  REQUIRED_DISK_HEADROOM_BYTES,
  V4_FEE_COLLECTION_MINIMUMS,
  V4_ORACLE_WINDOW_MATURITY_SECONDS,
} from "../lib/campaign-plan.mjs";

const root = Buffer.from(
  "000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f",
  "hex",
);

test("Foundry keystore output yields exactly one validated private key", () => {
  const key = `0x${"ab".repeat(32)}`;
  assert.equal(
    parseCastDecryptedPrivateKey(
      `deployment wallet's private key is: ${key}\n`,
    ),
    key,
  );
  assert.throws(
    () => parseCastDecryptedPrivateKey("no private key here"),
    /exactly one private key/,
  );
  assert.throws(
    () => parseCastDecryptedPrivateKey(`${key}\n${key}`),
    /exactly one private key/,
  );
});

test("wallet derivation is deterministic, unique, and address-only evidence is safe", () => {
  const first = deriveCampaignAccounts(root, "schema8-assurance", 100);
  const second = deriveCampaignAccounts(root, "schema8-assurance", 100);
  assert.deepEqual(first, second);
  assert.equal(new Set(first.map((account) => account.address)).size, 100);
  assert.notEqual(first[0].privateKey, first[1].privateKey);
});

test("encrypted campaign root authenticates and rejects a wrong passphrase", () => {
  const encrypted = encryptCampaignRoot(
    root,
    "correct horse battery staple campaign",
  );
  assert.deepEqual(
    decryptCampaignRoot(encrypted, "correct horse battery staple campaign"),
    root,
  );
  assert.throws(
    () =>
      decryptCampaignRoot(encrypted, "incorrect horse battery staple campaign"),
    /authenticate|Unsupported state/i,
  );
});

test("binary funding tree conserves per-wallet budgets plus one cost per edge", () => {
  const plan = fundingTreeTransfers(100, 10_000n, 21n);
  assert.equal(plan.transfers.length, 99);
  assert.equal(plan.rootFundingWei, 100n * 10_000n + 99n * 21n);
  for (let child = 1; child < 100; child += 1) {
    assert.equal(
      plan.transfers.filter((transfer) => transfer.child === child).length,
      1,
    );
  }
});

test("weighted funding tree preserves distinct wallet budgets and edge costs", () => {
  const plan = weightedFundingTreeTransfers([10n, 20n, 30n, 40n], 2n);
  assert.equal(plan.rootFundingWei, 106n);
  assert.deepEqual(
    plan.transfers.map((entry) => entry.amountWei),
    [62n, 30n, 40n],
  );
});

test("eight baskets cover every route exactly once", () => {
  const manifest = {
    schemaVersion: 9,
    chainId: 46630,
    governanceProfile: "robinhood-testnet-short-assurance",
    dao: {
      governance: {
        votingDelaySeconds: 600,
        votingPeriodSeconds: 1800,
        timelockSeconds: 600,
      },
    },
    contracts: Object.fromEntries(
      [
        "atomicLaunchCoordinator",
        "launchFactory",
        "marketFactory",
        "protocolFeeRouter",
        "oracleHook",
        "assetRouter",
        "quoter",
        "universalRouter",
        "permit2",
        "daoToken",
        "governor",
        "timelock",
        "guardian",
      ].map((key, index) => [key, `0x${String(index + 1).padStart(40, "0")}`]),
    ),
    assetRoutes: Array.from({ length: 24 }, (_, index) => ({
      address: `0x${String(index + 101).padStart(40, "0")}`,
      verification:
        index < 5 ? "robinhood-testnet-faucet-stock" : "robyn-testnet-mock",
    })),
  };
  const baskets = launchBasketPlan(manifest);
  assert.equal(baskets.length, 8);
  assert.equal(baskets.filter((basket) => basket.shouldGraduate).length, 3);
  assert.equal(new Set(baskets.flatMap((basket) => basket.assets)).size, 24);
  assert.deepEqual(
    baskets.map((basket) => basket.assets),
    [
      ...Array.from({ length: 6 }, (_, index) =>
        manifest.assetRoutes
          .slice(index * 3 + 5, index * 3 + 8)
          .map((route) => route.address),
      ),
      manifest.assetRoutes.slice(0, 3).map((route) => route.address),
      [
        ...manifest.assetRoutes.slice(3, 5).map((route) => route.address),
        manifest.assetRoutes[23].address,
      ],
    ],
  );
  assert.ok(
    baskets
      .slice(0, 3)
      .every((basket) =>
        basket.assets.every((address) =>
          manifest.assetRoutes
            .slice(5)
            .some((route) => route.address === address),
        ),
      ),
  );
});

test("cost projection includes Nitro L1 data, 25 percent headroom, and hard reserve", () => {
  assert.equal(REQUIRED_DISK_HEADROOM_BYTES, 5n * 1024n * 1024n * 1024n);
  assert.equal(applyHeadroom(100n), 125n);
  const cost = projectCampaignCost({
    gasPriceWei: 2n,
    l1BaseFeeWei: 3n,
    averageGasPerWrite: 100n,
    averageCalldataBytes: 10n,
    successfulWrites: 2,
    transactionValueWei: 5n,
  });
  assert.equal(cost.executionWei, 400n);
  assert.equal(cost.l1DataWei, 960n);
  assert.equal(cost.baseWei, 1_365n);
  assert.equal(cost.withHeadroomWei, 1_707n);
  assert.equal(cost.totalRequiredWei, 1_707n + REQUIRED_RESERVE_WEI);
});

test("native sweep reserve uses the live gas estimate with headroom", () => {
  assert.equal(nativeSweepReserveWei(10n, 21_000n), 262_500n);
  assert.equal(nativeSweepReserveWei(10n, 28_239n), 352_990n);
  assert.throws(() => nativeSweepReserveWei(-1n, 0n), /cannot be negative/);
});

test("fixed action inventory exceeds the 1,500-write gate before optional retries", () => {
  assert.ok(minimumActionCount() >= 1_500);
  assert.ok(PRICED_TRANSACTION_COUNT >= 2_500);
  assert.equal(PLANNED_SWEEP_GAS_UNITS_PER_ACTOR, 1_600_000n);
});

test("v4 fee collection accepts every nonnegative amount owed", () => {
  assert.deepEqual(V4_FEE_COLLECTION_MINIMUMS, [0n, 0n]);
});

test("graduated launches reuse their deliberately funded terminal actors", () => {
  assert.deepEqual([0, 1, 2].map(graduationActorIndex), [96, 97, 98]);
  assert.throws(
    () => graduationActorIndex(3),
    /outside the fixed campaign plan/,
  );
});

test("launch-fee conversion waits beyond the complete five-minute oracle window", () => {
  assert.equal(V4_ORACLE_WINDOW_MATURITY_SECONDS, 301);
});

test("basket conversions are balanced across the three funded keeper actors", () => {
  const actors = Array.from({ length: 8 }, (_, launchIndex) =>
    Array.from({ length: 3 }, (_, legIndex) =>
      basketConversionActorIndex(launchIndex, legIndex),
    ),
  ).flat();
  assert.deepEqual(
    [96, 97, 98].map(
      (actor) => actors.filter((candidate) => candidate === actor).length,
    ),
    [8, 8, 8],
  );
  assert.throws(
    () => basketConversionActorIndex(8, 0),
    /outside the fixed campaign plan/,
  );
});

test("campaign value projection includes every planned payable user action", () => {
  let expected = 0n;
  for (let index = 0; index < 900; index += 1) {
    expected += plannedBuyValueWei(index);
  }
  expected += 3n * 250_000_000_000n;
  expected += 2n * 20_000_000_000n;
  expected += 100_000_000_000n + 250_000_000_000_000n;
  expected += 10n * 200_000_000_000n;
  assert.equal(plannedTransactionValueWei(), expected);
  assert.ok(expected > 3n * 1_400_000_000_000_000n);
  assert.equal(plannedBuyValueWei(896), 250_000_000_000_000n);
  assert.equal(plannedBuyValueWei(888), 11_000_000_000_000n);
  const distributed = Array.from({ length: 100 }, (_, index) =>
    plannedWalletValueWei(index),
  ).reduce((total, value) => total + value, 0n);
  assert.equal(distributed, plannedTransactionValueWei());
});

test("weighted wallet funding preserves the total while funding creator gas skew", () => {
  const funding = weightedWalletFunding(12_000n, [
    { index: 0, amountWei: 800n },
    { index: 96, amountWei: 800n },
  ]);
  assert.equal(funding.basePerWalletWei, 104n);
  assert.equal(funding.topupTotalWei, 1_600n);
  assert.equal(funding.allocatedWei, 12_000n);
  assert.equal(
    funding.walletBudgetsWei.reduce((total, value) => total + value, 0n),
    12_000n,
  );
  assert.ok(funding.basePerWalletWei + funding.topups[0].amountWei > 800n);
  assert.throws(
    () => weightedWalletFunding(1_000n, [{ index: 0, amountWei: 1_000n }]),
    /complete campaign budget/,
  );
});
