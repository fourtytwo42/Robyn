import assert from "node:assert/strict";
import test from "node:test";
import { calculateSchema19MainnetFunding, SCHEMA19_MAINNET_RESERVE_WEI } from "../lib/schema19-mainnet-funding.mjs";

const receipt = (index, phase, status = "success") => ({
  type: "receipt", phase, status,
  transactionHash: `0x${index.toString(16).padStart(64, "0")}`,
  gasUsed: "100000",
});
const deploymentLedger = { receipts: Array.from({ length: 36 }, (_, i) => receipt(i + 1, "deployment", "0x1")) };
const retirementLedger = { receipts: Array.from({ length: 9 }, (_, i) => receipt(i + 101, "retirement")) };
const lifecycleJournal = Array.from({ length: 9 }, (_, i) => receipt(i + 201, "shutdown"));
const args = { deploymentLedger, retirementLedger, lifecycleJournal, balanceWei: 30_000_000_000_000_000n, baseFeeWei: 10n, gasPriceWei: 20n, priorityFeeWei: 2n };

test("measures deployment, retirement and emergency receipts with 150 percent headroom", () => {
  const result = calculateSchema19MainnetFunding(args);
  assert.equal(result.totalTransactionCount, 54);
  assert.equal(result.totalGasUnits, 5_400_000n);
  assert.equal(result.pinnedMaxFeePerGas, 28n);
  assert.equal(result.reserveWei, SCHEMA19_MAINNET_RESERVE_WEI);
  assert.equal(result.passed, true);
});

test("reports exact shortfall without weakening reserve", () => {
  const result = calculateSchema19MainnetFunding({ ...args, balanceWei: SCHEMA19_MAINNET_RESERVE_WEI });
  assert.equal(result.passed, false);
  assert.equal(result.bridgeShortfall, result.requiredBalance - SCHEMA19_MAINNET_RESERVE_WEI);
});

test("rejects failed, missing, and reused receipt evidence", () => {
  assert.throws(() => calculateSchema19MainnetFunding({ ...args, retirementLedger: { receipts: [] } }), /count mismatch/);
  const failed = structuredClone(deploymentLedger); failed.receipts[0].status = "0x0";
  assert.throws(() => calculateSchema19MainnetFunding({ ...args, deploymentLedger: failed }), /failed receipt/);
  const reused = structuredClone(retirementLedger); reused.receipts[1].transactionHash = reused.receipts[0].transactionHash;
  assert.throws(() => calculateSchema19MainnetFunding({ ...args, retirementLedger: reused }), /invalid or reused/);
});
