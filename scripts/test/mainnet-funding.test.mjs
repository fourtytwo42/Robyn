import assert from "node:assert/strict";
import test from "node:test";
import {
  REQUIRED_MAINNET_GAS_PHASES,
  calculateMainnetFundingGate,
  jsonMainnetFundingGate,
  summarizeMainnetGasEvidence,
} from "../lib/mainnet-funding.mjs";

function evidence({ deploymentGas = 1_000_000n, canaryGas = 2_000_000n } = {}) {
  const canaryPhases = REQUIRED_MAINNET_GAS_PHASES.length - 2;
  return {
    chainId: 4663,
    executionMode: "local-fork-broadcast",
    forkBlock: "123456",
    releaseSha: "a".repeat(40),
    productionConfigHash: `0x${"b".repeat(64)}`,
    transactions: REQUIRED_MAINNET_GAS_PHASES.map((phase, index) => ({
      idempotencyKey: `phase-${index}`,
      transactionHash: `0x${(index + 1).toString(16).padStart(64, "0")}`,
      blockNumber: (123457 + index).toString(),
      phase,
      category: index < 2 ? "deployment" : "canary",
      gasUsed:
        index < 2
          ? (deploymentGas / 2n).toString()
          : (canaryGas / BigInt(canaryPhases)).toString(),
      receiptStatus: "success",
    })),
  };
}

test("funding gate preserves both reserves and applies the requested headroom", () => {
  const result = calculateMainnetFundingGate({
    approvedCeilingWei: 47_072_920_000_000_000n,
    currentL1BalanceWei: 47_072_920_000_000_000n,
    bridgeGasEstimate: 100_000n,
    bridgeMaxFeePerGasWei: 10_000_000_000n,
    l2GasPriceWei: 100_000_000n,
    gasEvidence: evidence(),
  });
  assert.equal(result.bridgeCostWei, 2_000_000_000_000_000n);
  assert.equal(result.deploymentCostWei, 150_000_000_000_000n);
  assert.ok(result.projectedL1RemainingWei >= 10_000_000_000_000_000n);
  assert.ok(result.bridgeAmountWei >= 30_000_000_000_000_000n);
  assert.equal(result.passed, true);
});

test("funding gate fails closed instead of reducing the reserves", () => {
  const result = calculateMainnetFundingGate({
    approvedCeilingWei: 47_072_920_000_000_000n,
    currentL1BalanceWei: 35_000_000_000_000_000n,
    bridgeGasEstimate: 100_000n,
    bridgeMaxFeePerGasWei: 20_000_000_000n,
    l2GasPriceWei: 1_000_000_000n,
    gasEvidence: evidence({
      deploymentGas: 10_000_000n,
      canaryGas: 10_000_000n,
    }),
  });
  assert.equal(result.passed, false);
  assert.ok(result.shortfallWei > 0n);
  assert.equal(result.l1EmergencyReserveWei, 10_000_000_000_000_000n);
  assert.equal(result.l2OperationalReserveWei, 20_000_000_000_000_000n);
  assert.equal(result.canaryPrincipalWei, 10_000_000_000_000_000n);
});

test("existing L2 funds reduce only the bridge amount", () => {
  const common = {
    approvedCeilingWei: 47_072_920_000_000_000n,
    currentL1BalanceWei: 47_072_920_000_000_000n,
    bridgeGasEstimate: 1n,
    bridgeMaxFeePerGasWei: 1n,
    l2GasPriceWei: 1n,
    gasEvidence: evidence(),
  };
  const withoutL2 = calculateMainnetFundingGate(common);
  const withL2 = calculateMainnetFundingGate({
    ...common,
    currentL2BalanceWei: 5_000_000_000_000_000n,
  });
  assert.equal(
    withoutL2.bridgeAmountWei - withL2.bridgeAmountWei,
    5_000_000_000_000_000n,
  );
  assert.equal(withL2.l1EmergencyReserveWei, withoutL2.l1EmergencyReserveWei);
  assert.equal(
    withL2.l2OperationalReserveWei,
    withoutL2.l2OperationalReserveWei,
  );
});

test("gas evidence requires every lifecycle phase and unique successful receipts", () => {
  const missing = evidence();
  missing.transactions.pop();
  assert.throws(() => summarizeMainnetGasEvidence(missing), /missing phases/);
  const duplicate = evidence();
  duplicate.transactions[1].idempotencyKey =
    duplicate.transactions[0].idempotencyKey;
  assert.throws(
    () => summarizeMainnetGasEvidence(duplicate),
    /duplicate or missing/,
  );
  const failed = evidence();
  failed.transactions[0].receiptStatus = "failed";
  assert.throws(() => summarizeMainnetGasEvidence(failed), /did not succeed/);
  const synthetic = evidence();
  delete synthetic.transactions[0].transactionHash;
  assert.throws(
    () => summarizeMainnetGasEvidence(synthetic),
    /missing a fork receipt identity/,
  );
});

test("funding ceiling is enforced even if more ETH reaches the wallet", () => {
  assert.throws(
    () =>
      calculateMainnetFundingGate({
        approvedCeilingWei: 47_072_920_000_000_000n,
        currentL1BalanceWei: 47_072_920_000_000_001n,
        bridgeGasEstimate: 1n,
        bridgeMaxFeePerGasWei: 1n,
        l2GasPriceWei: 1n,
        gasEvidence: evidence(),
      }),
    /exceeds the approved funding ceiling/,
  );
});

test("funding results serialize without losing wei precision", () => {
  const result = calculateMainnetFundingGate({
    approvedCeilingWei: 47_072_920_000_000_000n,
    currentL1BalanceWei: 47_072_920_000_000_000n,
    bridgeGasEstimate: 1n,
    bridgeMaxFeePerGasWei: 1n,
    l2GasPriceWei: 1n,
    gasEvidence: evidence(),
  });
  const serialized = jsonMainnetFundingGate(result);
  assert.equal(serialized.currentL1BalanceWei, "47072920000000000");
  assert.equal(typeof serialized.passed, "boolean");
});
