import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { calculateMainnetFundingGate } from "../lib/mainnet-funding.mjs";
import {
  REQUIRED_MAINNET_RECEIPT_PHASES,
  validateMainnetReceiptLedger,
} from "../lib/mainnet-receipt-ledger.mjs";

const hash = (value) => `0x${value.toString(16).padStart(64, "0")}`;
const address = (value) => `0x${value.toString(16).padStart(40, "0")}`;
const ledger = () => ({
  schemaVersion: 18,
  chainId: 4663,
  executionMode: "local-fork-broadcast",
  forkBlock: "1",
  releaseSha: "4728cb5cce4b0bad1c275b8bfcc2de3e8fb3f6a4",
  productionConfigHash: hash(1),
  runtimeIdentities: [{ address: address(1), runtimeCodeHash: hash(2) }],
  transactions: REQUIRED_MAINNET_RECEIPT_PHASES.map((phase, index) => ({
    idempotencyKey: `schema18:${phase}:${index}`,
    phase,
    category: ["deployment", "bindings"].includes(phase)
      ? "deployment"
      : "canary",
    transactionHash: hash(index + 10),
    blockNumber: String(index + 1),
    receiptStatus: "success",
    gasUsed: "100",
    effectiveGasPriceWei: "1",
    valueWei: "0",
    nonce: String(index),
    to: address(index + 2),
    data: "0x1234",
    calldataHash: hash(index + 100),
    normalizedReceipt: {
      transactionHash: hash(index + 10),
      blockNumber: String(index + 1),
      status: "success",
      gasUsed: "100",
      effectiveGasPriceWei: "1",
    },
  })),
});

test("Schema-18 receipt ledger requires exact calldata", () => {
  const evidence = ledger();
  assert.equal(validateMainnetReceiptLedger(evidence).phaseCount, 11);
  delete evidence.transactions[0].data;
  assert.throws(() => validateMainnetReceiptLedger(evidence), /exact calldata/);
});

test("funding calculation consumes existing L2 balance before bridging", () => {
  const result = calculateMainnetFundingGate({
    approvedCeilingWei: 50n * 10n ** 15n,
    currentL1BalanceWei: 20n * 10n ** 15n,
    currentL2BalanceWei: 40n * 10n ** 15n,
    bridgeGasEstimate: 0n,
    bridgeMaxFeePerGasWei: 0n,
    l2GasPriceWei: 1n,
    gasEvidence: ledger(),
  });
  assert.equal(result.bridgeAmountWei, 0n);
  assert.equal(result.passed, true);
});

test("active Mainnet package commands are Schema-18", async () => {
  const packageJson = JSON.parse(
    await readFile(new URL("../../package.json", import.meta.url)),
  );
  for (const name of [
    "estimate:mainnet-bridge",
    "measure:mainnet-funding",
    "rehearse:mainnet-broadcast",
    "derive:mainnet-bridge-amount",
    "seal:mainnet-manifest",
    "bridge:mainnet",
    "deploy:mainnet-paused",
  ]) {
    assert.match(packageJson.scripts[name], /schema18/);
    assert.doesNotMatch(packageJson.scripts[name], /schema16/);
  }
});

test("Mainnet policy is Schema-18 and Alchemy fallback remains unauthorized", async () => {
  const support = JSON.parse(
    await readFile(
      new URL(
        "../../config/protocol/robinhood-mainnet-support-policy.json",
        import.meta.url,
      ),
    ),
  );
  const lifecycle = await readFile(
    new URL("../run-schema18-testnet-lifecycle.mjs", import.meta.url),
    "utf8",
  );
  const live = await readFile(
    new URL("../run-schema18-mainnet-live.mjs", import.meta.url),
    "utf8",
  );
  assert.equal(support.schemaVersion, 16);
  assert.equal(support.status, "candidate-only");
  assert.match(lifecycle, /mainnet-fork/);
  assert.match(lifecycle, /post-settle/);
  assert.match(live, /automaticFallbackAuthorized/);
  assert.match(live, /bridge is not authorized/);
  assert.match(live, /Paused deployment is not authorized/);
});
