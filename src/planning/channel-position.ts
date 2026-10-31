export function positionImmediatelyAfter(
  currentPosition: number,
  anchorPosition: number,
): number {
  return currentPosition < anchorPosition
    ? anchorPosition
    : anchorPosition + 1;
}
