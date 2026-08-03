import assert from "node:assert/strict";
import test from "node:test";
import {
  calculateSchema19TestnetFunding,
  validateSchema19ForgeLedger,
} from "../lib/schema19-testnet-funding.mjs";

const prepared = {
  schemaVersion: 19,
  chainId: 46630,
  deployment: {
    startingNonce: 10,
    fullEndingNonceExclusive: 12,
  },
};
const ledger = {
  transactions: [
    { hash: `0x${"01".repeat(32)}`, transaction: { nonce: "0xa" } },
    { hash: `0x${"02".repeat(32)}`, transaction: { nonce: "0xb" } },
  ],
  receipts: [
    {
      transactionHash: `0x${"01".repeat(32)}`,
      status: "0x1",
      gasUsed: "0x64",
      effectiveGasPrice: "0x2",
    },
    {
      transactionHash: `0x${"02".repeat(32)}`,
      status: "0x1",
      gasUsed: "0xc8",
      effectiveGasPrice: "0x2",
    },
  ],
};

test("funding ledger requires successful unique contiguous receipts", () => {
  assert.deepEqual(validateSchema19ForgeLedger(ledger, prepared), {
    transactionCount: 2,
    deploymentGasUsed: 300n,
  });
  assert.throws(
    () =>
      validateSchema19ForgeLedger(
        { ...ledger, receipts: [ledger.receipts[0], ledger.receipts[0]] },
        prepared,
      ),
    /reused deployment receipt hash/,
  );
  assert.throws(
    () =>
      validateSchema19ForgeLedger(
        {
          ...ledger,
          receipts: ledger.receipts.map((item, index) =>
            index ? { ...item, status: "0x0" } : item,
          ),
        },
        prepared,
      ),
    /failed deployment receipt/,
  );
});

test("funding gate preserves principal, route capital, reserve, and campaign headroom", () => {
  const passing = calculateSchema19TestnetFunding({
    ledger,
    prepared,
    balanceWei: 100_000_000_000_000_000n,
    baseFeeWei: 10n,
    gasPriceWei: 15n,
    priorityFeeWei: 2n,
  });
  assert.equal(passing.pinnedMaxFeePerGas, 28n);
  assert.equal(passing.passed, true);
  assert(passing.requiredBalance > passing.principalWei + passing.reserveWei);
  const failing = calculateSchema19TestnetFunding({
    ledger,
    prepared,
    balanceWei: passing.requiredBalance - 1n,
    baseFeeWei: 10n,
    gasPriceWei: 15n,
    priorityFeeWei: 2n,
  });
  assert.equal(failing.passed, false);
  assert.equal(failing.margin, -1n);
});
