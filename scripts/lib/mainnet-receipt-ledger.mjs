const HASH = /^0x[0-9a-f]{64}$/i;
const SHA = /^(?:0x)?[0-9a-f]{40}$/i;
const UINT = /^(?:0|[1-9][0-9]*)$/;

export const REQUIRED_MAINNET_RECEIPT_PHASES = Object.freeze([
  "deployment",
  "bindings",
  "canary-activation",
  "canary-launch",
  "bonding-graduation",
  "post-graduation-trades",
  "fee-settlement",
  "reward-claims",
  "profile-governance",
  "canary-unwind",
  "post-unwind-settlement",
]);

function requireUint(value, label, { positive = false } = {}) {
  const text = String(value ?? "");
  if (!UINT.test(text) || (positive && BigInt(text) === 0n)) {
    throw new Error(
      `${label} must be ${positive ? "a positive" : "an"} integer`,
    );
  }
  return text;
}

export function validateMainnetReceiptLedger(evidence, expected = {}) {
  if (Number(evidence?.chainId) !== 4663) {
    throw new Error("receipt ledger must be for Robinhood Mainnet chain 4663");
  }
  if (evidence?.executionMode !== "local-fork-broadcast") {
    throw new Error("receipt ledger must use local-fork-broadcast execution");
  }
  requireUint(evidence?.forkBlock, "forkBlock", { positive: true });
  if (!SHA.test(String(evidence?.releaseSha ?? ""))) {
    throw new Error("receipt ledger release SHA is invalid");
  }
  if (!HASH.test(String(evidence?.productionConfigHash ?? ""))) {
    throw new Error("receipt ledger production configuration hash is invalid");
  }
  if (
    expected.releaseSha &&
    String(evidence.releaseSha).replace(/^0x/, "").toLowerCase() !==
      String(expected.releaseSha).replace(/^0x/, "").toLowerCase()
  ) {
    throw new Error(
      "receipt ledger release SHA does not match the frozen release",
    );
  }
  if (
    expected.productionConfigHash &&
    evidence.productionConfigHash.toLowerCase() !==
      expected.productionConfigHash.toLowerCase()
  ) {
    throw new Error("receipt ledger production configuration hash mismatch");
  }
  if (
    !Array.isArray(evidence?.runtimeIdentities) ||
    evidence.runtimeIdentities.length === 0
  ) {
    throw new Error("receipt ledger must include verified runtime identities");
  }
  const runtimeAddresses = new Set();
  for (const [index, identity] of evidence.runtimeIdentities.entries()) {
    const address = String(identity?.address ?? "").toLowerCase();
    if (!/^0x[0-9a-f]{40}$/.test(address) || runtimeAddresses.has(address)) {
      throw new Error(
        `runtime identity ${index} has an invalid or duplicate address`,
      );
    }
    runtimeAddresses.add(address);
    if (!HASH.test(String(identity?.runtimeCodeHash ?? ""))) {
      throw new Error(`runtime identity ${index} is missing its code hash`);
    }
  }
  if (
    !Array.isArray(evidence?.transactions) ||
    evidence.transactions.length === 0
  ) {
    throw new Error("receipt ledger must contain transactions");
  }
  const keys = new Set();
  const hashes = new Set();
  const phases = new Set();
  for (const [index, transaction] of evidence.transactions.entries()) {
    const key = String(transaction?.idempotencyKey ?? "");
    if (!/^[A-Za-z0-9._:-]{8,256}$/.test(key) || keys.has(key)) {
      throw new Error(
        `transaction ${index} has a duplicate or invalid idempotency key`,
      );
    }
    keys.add(key);
    const hash = String(transaction?.transactionHash ?? "").toLowerCase();
    if (!HASH.test(hash) || hashes.has(hash)) {
      throw new Error(
        `transaction ${key} has a duplicate or invalid transaction hash`,
      );
    }
    hashes.add(hash);
    const phase = String(transaction?.phase ?? "");
    if (!REQUIRED_MAINNET_RECEIPT_PHASES.includes(phase)) {
      throw new Error(`transaction ${key} has an invalid phase`);
    }
    phases.add(phase);
    if (!["deployment", "canary"].includes(transaction?.category)) {
      throw new Error(`transaction ${key} has an invalid category`);
    }
    if (transaction?.receiptStatus !== "success") {
      throw new Error(`transaction ${key} did not succeed`);
    }
    requireUint(transaction.blockNumber, `${key}.blockNumber`, {
      positive: true,
    });
    requireUint(transaction.gasUsed, `${key}.gasUsed`, { positive: true });
    requireUint(
      transaction.effectiveGasPriceWei,
      `${key}.effectiveGasPriceWei`,
      {
        positive: true,
      },
    );
    requireUint(transaction.valueWei, `${key}.valueWei`);
    requireUint(transaction.nonce, `${key}.nonce`);
    if (!HASH.test(String(transaction.calldataHash ?? ""))) {
      throw new Error(`transaction ${key} is missing its calldata hash`);
    }
    const receipt = transaction.normalizedReceipt;
    if (
      receipt?.transactionHash?.toLowerCase() !== hash ||
      String(receipt?.blockNumber) !== String(transaction.blockNumber) ||
      receipt?.status !== "success" ||
      String(receipt?.gasUsed) !== String(transaction.gasUsed) ||
      String(receipt?.effectiveGasPriceWei) !==
        String(transaction.effectiveGasPriceWei)
    ) {
      throw new Error(
        `transaction ${key} has an inconsistent normalized receipt`,
      );
    }
  }
  const missing = REQUIRED_MAINNET_RECEIPT_PHASES.filter(
    (phase) => !phases.has(phase),
  );
  if (missing.length > 0) {
    throw new Error(`receipt ledger is missing phases: ${missing.join(", ")}`);
  }
  return {
    transactionCount: evidence.transactions.length,
    phaseCount: phases.size,
    runtimeIdentityCount: runtimeAddresses.size,
  };
}
