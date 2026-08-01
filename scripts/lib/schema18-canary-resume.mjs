export const BPS = 10_000n;

export const exactFinalBondingPurchase = ({
  nativeRaised,
  graduationThreshold,
  feeBps,
}) => {
  nativeRaised = BigInt(nativeRaised);
  graduationThreshold = BigInt(graduationThreshold);
  feeBps = BigInt(feeBps);
  if (nativeRaised >= graduationThreshold) {
    throw new Error("graduation threshold must exceed native raised");
  }
  if (feeBps < 0n || feeBps >= BPS) {
    throw new Error("curve fee basis points are invalid");
  }
  const remainingNet = graduationThreshold - nativeRaised;
  const denominator = BPS - feeBps;
  return (remainingNet * BPS + denominator - 1n) / denominator;
};

export const resumeFundingRequirement = ({
  operationalReserveWei,
  exactFinalPurchaseWei,
  measuredGas,
  maxFeePerGasWei,
}) => {
  const reserve = BigInt(operationalReserveWei);
  const purchase = BigInt(exactFinalPurchaseWei);
  const gas = BigInt(measuredGas);
  const maxFee = BigInt(maxFeePerGasWei);
  if (reserve < 0n || purchase <= 0n || gas <= 0n || maxFee <= 0n) {
    throw new Error("resume funding inputs are invalid");
  }
  const gasWithHeadroom = (gas * 3n + 1n) / 2n;
  const gasAllowanceWei = gasWithHeadroom * maxFee;
  return {
    gasWithHeadroom,
    gasAllowanceWei,
    requiredBalanceWei: reserve + purchase + gasAllowanceWei,
  };
};
