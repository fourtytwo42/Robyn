import assert from "node:assert/strict";
import test from "node:test";
import {
  compareKingAwardNewestFirst,
  qualifiesForKingOfForest,
  shouldCountKingTrader,
  validateKingOfForestPolicy,
} from "../dist/king-of-forest.js";

const policy = {
  version: "forest-v1",
  activationBlock: 100,
  progressThresholdBps: 5000,
  minimumUniqueTraders: 10,
};

test("validates the immutable policy", () => {
  assert.equal(validateKingOfForestPolicy(policy), policy);
  assert.throws(() =>
    validateKingOfForestPolicy({ ...policy, progressThresholdBps: 0 }),
  );
});

test("requires a post-activation qualifying trade and both thresholds", () => {
  const base = {
    blockNumber: 100n,
    progressBps: 5000,
    uniqueTraders: 10,
    alreadyAwarded: false,
    hasQualifyingTrade: true,
  };
  assert.equal(qualifiesForKingOfForest(policy, base), true);
  assert.equal(
    qualifiesForKingOfForest(policy, { ...base, blockNumber: 99n }),
    false,
  );
  assert.equal(
    qualifiesForKingOfForest(policy, { ...base, progressBps: 4999 }),
    false,
  );
  assert.equal(
    qualifiesForKingOfForest(policy, { ...base, uniqueTraders: 9 }),
    false,
  );
  assert.equal(
    qualifiesForKingOfForest(policy, { ...base, hasQualifyingTrade: false }),
    false,
  );
  assert.equal(
    qualifiesForKingOfForest(policy, { ...base, alreadyAwarded: true }),
    false,
  );
});

test("qualifies regardless of which threshold was reached first", () => {
  const base = {
    blockNumber: 101n,
    alreadyAwarded: false,
    hasQualifyingTrade: true,
  };
  assert.equal(
    qualifiesForKingOfForest(policy, {
      ...base,
      progressBps: 6500,
      uniqueTraders: 10,
    }),
    true,
  );
  assert.equal(
    qualifiesForKingOfForest(policy, {
      ...base,
      progressBps: 5000,
      uniqueTraders: 14,
    }),
    true,
  );
});

test("does not award historical qualification without fresh activity", () => {
  assert.equal(
    qualifiesForKingOfForest(policy, {
      blockNumber: 150n,
      progressBps: 10000,
      uniqueTraders: 20,
      alreadyAwarded: false,
      hasQualifyingTrade: false,
    }),
    false,
  );
});

test("filters system accounts and normalizes addresses", () => {
  const user = "0x1111111111111111111111111111111111111111";
  assert.equal(shouldCountKingTrader(user, new Set()), true);
  assert.equal(shouldCountKingTrader(user, new Set([user])), false);
  assert.equal(shouldCountKingTrader("0x0", new Set()), false);
});

test("orders awards deterministically", () => {
  const awards = [
    { awardedBlock: 2n, transactionIndex: 0, logIndex: 1, token: "0x01" },
    { awardedBlock: 2n, transactionIndex: 1, logIndex: 0, token: "0x02" },
    { awardedBlock: 1n, transactionIndex: 9, logIndex: 9, token: "0x03" },
  ].sort(compareKingAwardNewestFirst);
  assert.deepEqual(
    awards.map((award) => award.token),
    ["0x02", "0x01", "0x03"],
  );
});
