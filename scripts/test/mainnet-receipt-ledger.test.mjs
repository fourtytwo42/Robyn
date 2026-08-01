import assert from "node:assert/strict";
import test from "node:test";
import {
  REQUIRED_MAINNET_RECEIPT_PHASES,
  validateMainnetReceiptLedger,
} from "../lib/mainnet-receipt-ledger.mjs";

function ledger() {
  return {
    chainId: 4663,
    executionMode: "local-fork-broadcast",
    forkBlock: "24600000",
    releaseSha: "a8d54bb125d091be0cea010262a68a2baaceda30",
    productionConfigHash: `0x${"ab".repeat(32)}`,
    runtimeIdentities: [
      {
        name: "poolManager",
        address: `0x${"12".repeat(20)}`,
        runtimeCodeHash: `0x${"34".repeat(32)}`,
      },
    ],
    transactions: REQUIRED_MAINNET_RECEIPT_PHASES.map((phase, index) => {
      const transactionHash = `0x${(index + 1).toString(16).padStart(64, "0")}`;
      const gasUsed = String(100_000 + index);
      return {
        idempotencyKey: `schema16:${phase}:${index}`,
        phase,
        category: index < 2 ? "deployment" : "canary",
        transactionHash,
        blockNumber: String(24_600_001 + index),
        receiptStatus: "success",
        gasUsed,
        effectiveGasPriceWei: "20000000",
        valueWei: "0",
        nonce: String(index),
        calldataHash: `0x${(index + 100).toString(16).padStart(64, "0")}`,
        normalizedReceipt: {
          transactionHash,
          blockNumber: String(24_600_001 + index),
          status: "success",
          gasUsed,
          effectiveGasPriceWei: "20000000",
        },
      };
    }),
  };
}

test("accepts an exact complete local-fork receipt ledger", () => {
  assert.deepEqual(validateMainnetReceiptLedger(ledger()), {
    transactionCount: 11,
    phaseCount: 11,
    runtimeIdentityCount: 1,
  });
});

test("accepts an explicitly scoped postdeployment canary ledger", () => {
  const evidence = ledger();
  const requiredPhases = ["canary-activation", "canary-launch"];
  evidence.transactions = evidence.transactions.filter((transaction) =>
    requiredPhases.includes(transaction.phase),
  );
  assert.deepEqual(validateMainnetReceiptLedger(evidence, { requiredPhases }), {
    transactionCount: 2,
    phaseCount: 2,
    runtimeIdentityCount: 1,
  });
});

test("rejects wrong chain, release, and production configuration identities", () => {
  const wrongChain = ledger();
  wrongChain.chainId = 46630;
  assert.throws(() => validateMainnetReceiptLedger(wrongChain), /chain 4663/);
  assert.throws(
    () =>
      validateMainnetReceiptLedger(ledger(), { releaseSha: "b".repeat(40) }),
    /frozen release/,
  );
  assert.throws(
    () =>
      validateMainnetReceiptLedger(ledger(), {
        productionConfigHash: `0x${"cd".repeat(32)}`,
      }),
    /configuration hash mismatch/,
  );
});

test("rejects missing phases, reused hashes, failed receipts, and incomplete economics", () => {
  const missing = ledger();
  missing.transactions.pop();
  assert.throws(() => validateMainnetReceiptLedger(missing), /missing phases/);
  const reused = ledger();
  reused.transactions[1].transactionHash =
    reused.transactions[0].transactionHash;
  reused.transactions[1].normalizedReceipt.transactionHash =
    reused.transactions[0].transactionHash;
  assert.throws(
    () => validateMainnetReceiptLedger(reused),
    /duplicate or invalid transaction hash/,
  );
  const failed = ledger();
  failed.transactions[0].receiptStatus = "reverted";
  assert.throws(() => validateMainnetReceiptLedger(failed), /did not succeed/);
  const incomplete = ledger();
  delete incomplete.transactions[0].valueWei;
  assert.throws(() => validateMainnetReceiptLedger(incomplete), /valueWei/);
});

test("rejects stale or duplicate runtime identities and inconsistent receipts", () => {
  const stale = ledger();
  delete stale.runtimeIdentities[0].runtimeCodeHash;
  assert.throws(
    () => validateMainnetReceiptLedger(stale),
    /missing its code hash/,
  );
  const duplicate = ledger();
  duplicate.runtimeIdentities.push({ ...duplicate.runtimeIdentities[0] });
  assert.throws(
    () => validateMainnetReceiptLedger(duplicate),
    /duplicate address/,
  );
  const inconsistent = ledger();
  inconsistent.transactions[0].normalizedReceipt.gasUsed = "1";
  assert.throws(
    () => validateMainnetReceiptLedger(inconsistent),
    /inconsistent normalized receipt/,
  );
});
