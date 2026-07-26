export function marketTapeRepeatCount(
  viewportWidth: number,
  marketGroupWidth: number,
) {
  if (!Number.isFinite(viewportWidth) || viewportWidth <= 0) return 1;
  if (!Number.isFinite(marketGroupWidth) || marketGroupWidth <= 0) return 1;
  return Math.max(1, Math.ceil(viewportWidth / marketGroupWidth) + 1);
}

export function marketTapeDurationSeconds(groupWidth: number) {
  if (!Number.isFinite(groupWidth) || groupWidth <= 0) return 24;
  return Math.max(18, groupWidth / 58);
}
