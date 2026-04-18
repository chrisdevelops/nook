export const MS_PER_DAY = 86_400_000;

const assertValidThreshold = (thresholdDays: number): void => {
  if (!Number.isInteger(thresholdDays) || thresholdDays < 0) {
    throw new RangeError(
      `thresholdDays must be a non-negative integer; got ${thresholdDays}`,
    );
  }
};

export const isStale = (
  lastTouchedMs: number,
  thresholdDays: number,
  nowMs: number,
): boolean => {
  assertValidThreshold(thresholdDays);
  return nowMs - lastTouchedMs >= thresholdDays * MS_PER_DAY;
};

export const nextStaleAtMs = (
  lastTouchedMs: number,
  thresholdDays: number,
): number => {
  assertValidThreshold(thresholdDays);
  return lastTouchedMs + thresholdDays * MS_PER_DAY;
};
