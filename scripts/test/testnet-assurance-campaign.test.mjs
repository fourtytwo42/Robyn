import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
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
  graduationTopupValueWei,
  launchBasketPlan,
  minimumActionCount,
  nativeSweepReserveWei,
  plannedBuyValueWei,
  plannedTransactionValueWei,
  plannedWalletValueWei,
  MAXIMUM_GRADUATION_TOPUP_WEI,
  PLANNED_SWEEP_GAS_UNITS_PER_ACTOR,
  PRICED_TRANSACTION_COUNT,
  weightedWalletFunding,
  projectCampaignCost,
  projectKeeperFunding,
  KEEPER_MINIMUM_OPERATOR_BALANCE_WEI,
  KEEPER_MINIMUM_CAMPAIGN_TARGET_WEI,
  KEEPER_PRICED_TRANSACTION_COUNT,
  REQUIRED_RESERVE_WEI,
  REQUIRED_DISK_HEADROOM_BYTES,
  transactionGasLimit,
  V4_FEE_COLLECTION_MINIMUMS,
  ORACLE_REFRESH_NATIVE_INPUT_WEI,
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

test("eight baskets cover every schema-14 route and all route classes", () => {
  const manifest = {
    schemaVersion: 14,
    chainId: 46630,
    launchControl: { initialMode: "Paused" },
    graduationProfiles: {
      current: {
        targetGraduationNative: "10000000000000000",
        maximumCurvePurchase: "1000000000000000",
      },
    },
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
    assetRoutes: Array.from({ length: 11 }, (_, index) => ({
      address: `0x${String(index + 101).padStart(40, "0")}`,
      verification: "robyn-testnet-mock",
      routeKind: index < 10 ? "uniswap-v4" : "wrapped-native",
    })),
  };
  const baskets = launchBasketPlan(manifest);
  assert.equal(baskets.length, 8);
  assert.equal(baskets.filter((basket) => basket.shouldGraduate).length, 3);
  assert.equal(new Set(baskets.flatMap((basket) => basket.assets)).size, 11);
  assert.deepEqual(
    baskets.flatMap((basket) => basket.assets),
    Array.from(
      { length: 24 },
      (_, index) => manifest.assetRoutes[index % 11].address,
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

test("keeper funding covers the fixed workload, headroom, and safety buffer", () => {
  const funding = projectKeeperFunding({
    gasPriceWei: 10_000_000n,
    l1BaseFeeWei: 20_000_000n,
    currentBalanceWei: 13_000_000_000_000n,
  });
  assert.equal(KEEPER_PRICED_TRANSACTION_COUNT, 900);
  assert.equal(funding.executionWei, 1_350_000_000_000_000n);
  assert.equal(funding.l1DataWei, 73_728_000_000_000n);
  assert.equal(
    funding.safetyBufferWei,
    2n * KEEPER_MINIMUM_OPERATOR_BALANCE_WEI,
  );
  assert.ok(funding.targetBalanceWei > KEEPER_MINIMUM_CAMPAIGN_TARGET_WEI);
  assert.equal(
    funding.deficitWei,
    funding.targetBalanceWei - funding.currentBalanceWei,
  );
  assert.throws(
    () =>
      projectKeeperFunding({
        gasPriceWei: -1n,
        l1BaseFeeWei: 0n,
        currentBalanceWei: 0n,
      }),
    /cannot be negative/,
  );
});

test("campaign funds the keeper before distributing actor funds", () => {
  const source = readFileSync(
    new URL("../testnet-assurance-campaign.mjs", import.meta.url),
    "utf8",
  );
  const keeperFunding = source.indexOf(
    "await ensureKeeperFunding(state, manifest, project, projectClient)",
  );
  const rootFunding = source.indexOf(
    'await recordTransaction(state, "fund-root"',
  );
  assert.ok(keeperFunding >= 0);
  assert.ok(rootFunding > keeperFunding);
  assert.match(source, /totalRequiredWeiIncludingKeeper/);
});

test("native sweep reserve uses the live gas estimate with headroom", () => {
  assert.equal(nativeSweepReserveWei(10n, 21_000n), 420_000n);
  assert.equal(nativeSweepReserveWei(10n, 28_239n), 564_780n);
  assert.throws(() => nativeSweepReserveWei(-1n, 0n), /cannot be negative/);
});

test("submitted transactions use a 100 percent execution-gas margin", () => {
  assert.equal(transactionGasLimit(0n), 0n);
  assert.equal(transactionGasLimit(21_000n), 42_000n);
  assert.equal(transactionGasLimit(21_001n), 42_002n);
  assert.throws(() => transactionGasLimit(-1n), /cannot be negative/);
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

test("graduation top-up covers the remaining net reserve within fixed bounds", () => {
  assert.equal(
    graduationTopupValueWei({
      thresholdWei: 1_000n,
      raisedWei: 901n,
      feeBps: 100,
      maximumCurvePurchaseWei: 100n,
    }),
    100n,
  );
  assert.equal(
    graduationTopupValueWei({
      thresholdWei: 1_000n,
      raisedWei: 1_000n,
      feeBps: 100n,
      maximumCurvePurchaseWei: 100n,
    }),
    0n,
  );
  assert.throws(
    () =>
      graduationTopupValueWei({
        thresholdWei: 1_000n,
        raisedWei: 901n,
        feeBps: 100n,
        maximumCurvePurchaseWei: 99n,
      }),
    /fixed campaign bound/,
  );
});

test("graduation rounding dust uses a separate resumable transaction", () => {
  const source = readFileSync(
    new URL("../testnet-assurance-campaign.mjs", import.meta.url),
    "utf8",
  );
  const topup = source.indexOf("`trade-graduate-${launchIndex}`");
  const dust = source.indexOf("`trade-graduate-dust-${launchIndex}`");
  const finalClassification = source.indexOf("const graduated = []");
  assert.match(source, /const terminalDustValue = 10n/);
  assert.ok(topup >= 0 && dust > topup && finalClassification > dust);
});

test("launch-fee conversion refreshes stale observations after history matures", () => {
  assert.equal(V4_ORACLE_WINDOW_MATURITY_SECONDS, 301);
  assert.equal(ORACLE_REFRESH_NATIVE_INPUT_WEI, 100_000_000n);
  const source = readFileSync(
    new URL("../testnet-assurance-campaign.mjs", import.meta.url),
    "utf8",
  );
  assert.match(source, /async function ensureConversionOracle/);
  assert.match(source, /latestAge <= 600n/);
  assert.match(source, /`oracle-refresh-\$\{launch\.index\}-\$\{attempt\}`/);
  assert.match(source, /Oracle refresh did not record/);
  assert.doesNotMatch(source, /oracleWindowTargetTimestamp/);
});

test("canonical keeper conversions satisfy current-campaign leg coverage without replay", () => {
  const source = readFileSync(
    new URL("../testnet-assurance-campaign.mjs", import.meta.url),
    "utf8",
  );
  assert.match(source, /eventName: "LegConverted"/);
  assert.match(source, /source: "canonical-keeper"/);
  assert.match(source, /getTransactionReceipt/);
});

test("campaign recognizes a keeper conversion that wins before submission", () => {
  const source = readFileSync(
    new URL("../testnet-assurance-campaign.mjs", import.meta.url),
    "utf8",
  );
  assert.match(
    source,
    /canonical keeper conversion won the pre-submission race/g,
  );
  assert.match(source, /if \(pendingAfterRace !== 0n\) throw error/g);
});

test("tracked locker fee dust requires prior canonical conversion evidence", () => {
  const source = readFileSync(
    new URL("../testnet-assurance-campaign.mjs", import.meta.url),
    "utf8",
  );
  assert.match(source, /if \(quoted > 1_000n\) throw error/);
  assert.match(source, /eventName: "LaunchFeesConverted"/);
  assert.match(
    source,
    /getAddress\(transaction\.to\) === getAddress\(launch\.locker\)/,
  );
  assert.match(source, /state\.conversions\.queuedLockerDust/);
  assert.match(source, /state\.failedTransactions\.some/g);
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
  expected += 3n * MAXIMUM_GRADUATION_TOPUP_WEI;
  expected += 3n * 250_000_000_000n;
  expected += 3n * ORACLE_REFRESH_NATIVE_INPUT_WEI;
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

test("locker conversion fees are settled after the final harvest swap", () => {
  const source = readFileSync(
    new URL("../testnet-assurance-campaign.mjs", import.meta.url),
    "utf8",
  );
  const lockerConversion = source.indexOf(
    "`locker-convert-token-${launchIndex}`",
  );
  const postHarvestSettlement = source.indexOf(
    "`hook-settle-native-post-harvest-${launchIndex}`",
  );
  assert.ok(lockerConversion >= 0);
  assert.ok(postHarvestSettlement > lockerConversion);

  const trackedNativeFees = source.indexOf(
    'functionName: "pendingCollectedNativeFees"',
  );
  const trackedTokenFees = source.indexOf(
    'functionName: "pendingCollectedTokenFees"',
  );
  const routeNative = source.indexOf("`locker-route-native-${launchIndex}`");
  const settleBasket = source.indexOf("`basket-settle-${launch.index}`");
  const convertBasket = source.indexOf(
    "`basket-convert-${launch.index}-${legIndex}`",
  );
  assert.ok(trackedNativeFees >= 0 && trackedNativeFees < routeNative);
  assert.ok(trackedTokenFees >= 0 && trackedTokenFees < lockerConversion);
  assert.ok(settleBasket >= 0 && settleBasket < convertBasket);
  assert.doesNotMatch(source, /getBalance\(\{ address: launch\.locker \}\)/);
  assert.doesNotMatch(source, /args: \[launch\.locker\]/);
});

test("claims settle queued DAO and treasury liabilities before reward claims", () => {
  const source = readFileSync(
    new URL("../testnet-assurance-campaign.mjs", import.meta.url),
    "utf8",
  );
  const daoSettlement = source.indexOf('"dao-fee-settlement"');
  const treasurySettlement = source.indexOf('"treasury-fee-settlement"');
  const streamAccrual = source.indexOf('"one-hour reward stream accrual"');
  const holderClaim = source.indexOf("`holder-claim-${claimIndex}`");
  const daoClaim = source.indexOf("`rdao-claim-${index}`");
  assert.ok(daoSettlement >= 0);
  assert.ok(treasurySettlement > daoSettlement);
  assert.ok(streamAccrual > treasurySettlement);
  assert.ok(holderClaim > streamAccrual);
  assert.ok(daoClaim > holderClaim);
});

test("creator claims exercise direct, claim-to, batch, and batch-to paths", () => {
  const source = readFileSync(
    new URL("../testnet-assurance-campaign.mjs", import.meta.url),
    "utf8",
  );
  assert.match(source, /method = "claimCreatorFees"/);
  assert.match(source, /method = "claimCreatorFeesTo"/);
  assert.match(source, /method = "claimCreatorFeesBatch"/);
  assert.match(source, /method = "claimCreatorFeesBatchTo"/);
});

test("failed transactions are journaled and cleared for a safe retry", () => {
  const source = readFileSync(
    new URL("../testnet-assurance-campaign.mjs", import.meta.url),
    "utf8",
  );
  assert.match(source, /state\.failedTransactions \?\?= \[\]/);
  assert.match(source, /delete state\.submittedTransactions\[label\]/);
  assert.match(source, /gas: transactionGasLimit\(estimatedGas\)/);
});

test("claims reconcile pre-submission settlements won by the canonical keeper", () => {
  const source = readFileSync(
    new URL("../testnet-assurance-campaign.mjs", import.meta.url),
    "utf8",
  );
  assert.match(source, /async function settleGlobalNativeLiability/);
  assert.match(source, /if \(remaining >= liability\) throw error/);
  assert.match(source, /state\.claims\.settlementRaces/);
  assert.match(
    source,
    /canonical keeper settlement won the pre-submission race/,
  );
});
