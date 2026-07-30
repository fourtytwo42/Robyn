export const DEFAULT_MAXIMUM_PROJECTION_LAG_BLOCKS = 100n;

export function projectionCheckpointsHealthy({
  ingestionBlock,
  launchBlock,
  kingBlock,
  rewardBlock,
  requireKing,
  maximumLagBlocks = DEFAULT_MAXIMUM_PROJECTION_LAG_BLOCKS,
}: {
  ingestionBlock: bigint;
  launchBlock?: bigint | undefined;
  kingBlock?: bigint | undefined;
  rewardBlock?: bigint | undefined;
  requireKing: boolean;
  maximumLagBlocks?: bigint;
}) {
  if (ingestionBlock < 0n || maximumLagBlocks < 0n) return false;
  const required = [launchBlock, rewardBlock];
  if (requireKing) required.push(kingBlock);
  return required.every((block) => {
    if (block === undefined || block < 0n || block > ingestionBlock) {
      return false;
    }
    return ingestionBlock - block <= maximumLagBlocks;
  });
}
