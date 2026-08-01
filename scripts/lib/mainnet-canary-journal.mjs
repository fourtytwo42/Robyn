export function classifyCanaryJournal(records, logicalKey) {
  const matching = records.filter((record) => record.logicalKey === logicalKey);
  const receipts = matching.filter((record) => record.type === "receipt");
  if (receipts.length > 1)
    throw new Error(`${logicalKey} has duplicate receipts`);
  const intents = matching.filter((record) => record.type === "intent");
  const rejected = new Set(
    matching
      .filter((record) => record.type === "submission-rejected")
      .map((record) => record.idempotencyKey),
  );
  const active = intents.filter(
    (record) => !rejected.has(record.idempotencyKey),
  );
  if (active.length > 1)
    throw new Error(`${logicalKey} has multiple unresolved intents`);
  return {
    receipt: receipts[0],
    activeIntent: active[0],
    attempt: intents.length + 1,
    rejectedAttempts: rejected.size,
  };
}
