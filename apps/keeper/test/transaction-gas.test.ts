import { describe, expect, it } from "vitest";
import { keeperTransactionGasLimit } from "../src/transaction-gas.js";

describe("keeper transaction gas", () => {
  it("applies a 100 percent margin to every simulated write", () => {
    expect(keeperTransactionGasLimit(0n)).toBe(0n);
    expect(keeperTransactionGasLimit(193_637n)).toBe(387_274n);
    expect(keeperTransactionGasLimit(675_969n)).toBe(1_351_938n);
  });

  it("rejects an invalid negative estimate", () => {
    expect(() => keeperTransactionGasLimit(-1n)).toThrow(/cannot be negative/);
  });
});
