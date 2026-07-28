export interface RewardConservationResult {
  conserved: boolean;
  uncheckpointedRoundingDust: bigint;
}

// Launch and DAO supplies are both below the contracts' 2^128 reward
// magnitude, so one mulDiv checkpoint can leave at most one base unit waiting
// to be folded into the onchain queue by the next state-changing checkpoint.
export function rewardStreamConservation(
  received: bigint,
  queued: bigint,
  streaming: bigint,
  vested: bigint,
  maximumUncheckpointedRoundingDust = 1n,
): RewardConservationResult {
  const uncheckpointedRoundingDust = received - queued - streaming - vested;
  return {
    conserved:
      uncheckpointedRoundingDust >= 0n &&
      uncheckpointedRoundingDust <= maximumUncheckpointedRoundingDust,
    uncheckpointedRoundingDust,
  };
}
