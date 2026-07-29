export function keeperTransactionGasLimit(estimatedGas: bigint): bigint {
  if (estimatedGas < 0n) {
    throw new Error("Estimated keeper transaction gas cannot be negative");
  }
  return estimatedGas * 2n;
}
