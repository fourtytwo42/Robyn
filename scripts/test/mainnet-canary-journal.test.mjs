import assert from "node:assert/strict";
import test from "node:test";
import { classifyCanaryJournal } from "../lib/mainnet-canary-journal.mjs";

const key = "schema16-canary:routes:GOOGL-buy";
const intent = (id) => ({
  type: "intent",
  logicalKey: key,
  idempotencyKey: id,
  transactionHash: `0x${id.padStart(64, "0")}`,
});

test("classifies a fresh, pending, confirmed, and rejected journal", () => {
  assert.deepEqual(classifyCanaryJournal([], key), {
    receipt: undefined,
    activeIntent: undefined,
    attempt: 1,
    rejectedAttempts: 0,
  });
  const first = intent("1");
  assert.equal(classifyCanaryJournal([first], key).activeIntent, first);
  const receipt = { type: "receipt", logicalKey: key, idempotencyKey: "1" };
  assert.equal(classifyCanaryJournal([first, receipt], key).receipt, receipt);
  const rejection = {
    type: "submission-rejected",
    logicalKey: key,
    idempotencyKey: "1",
  };
  const result = classifyCanaryJournal([first, rejection], key);
  assert.equal(result.activeIntent, undefined);
  assert.equal(result.attempt, 2);
  assert.equal(result.rejectedAttempts, 1);
});

test("fails closed on duplicate receipts or unresolved intents", () => {
  assert.throws(
    () =>
      classifyCanaryJournal(
        [
          { type: "receipt", logicalKey: key },
          { type: "receipt", logicalKey: key },
        ],
        key,
      ),
    /duplicate receipts/,
  );
  assert.throws(
    () => classifyCanaryJournal([intent("1"), intent("2")], key),
    /multiple unresolved intents/,
  );
});
