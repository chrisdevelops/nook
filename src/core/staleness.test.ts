import { describe, expect, test } from "bun:test";

import { isStale, nextStaleAtMs, MS_PER_DAY } from "./staleness.ts";

describe("MS_PER_DAY", () => {
  test("equals 86,400,000", () => {
    expect(MS_PER_DAY).toBe(86_400_000);
  });
});

describe("isStale", () => {
  const day = MS_PER_DAY;

  test("fresh activity within threshold is not stale", () => {
    const now = 100 * day;
    const lastTouched = now - 10 * day;
    expect(isStale(lastTouched, 60, now)).toBe(false);
  });

  test("activity older than threshold is stale", () => {
    const now = 100 * day;
    const lastTouched = now - 61 * day;
    expect(isStale(lastTouched, 60, now)).toBe(true);
  });

  test("activity exactly at threshold is stale (inclusive boundary)", () => {
    const now = 100 * day;
    const lastTouched = now - 60 * day;
    expect(isStale(lastTouched, 60, now)).toBe(true);
  });

  test("activity one ms short of threshold is not stale", () => {
    const now = 100 * day;
    const lastTouched = now - 60 * day + 1;
    expect(isStale(lastTouched, 60, now)).toBe(false);
  });

  test("zero-day threshold treats anything as stale", () => {
    const now = 100 * day;
    expect(isStale(now, 0, now)).toBe(true);
    expect(isStale(now - 1, 0, now)).toBe(true);
  });

  test("future last-touched is not stale", () => {
    const now = 100 * day;
    expect(isStale(now + day, 60, now)).toBe(false);
  });

  test("throws on negative threshold", () => {
    expect(() => isStale(0, -1, 0)).toThrow();
  });

  test("throws on non-integer threshold", () => {
    expect(() => isStale(0, 1.5, 0)).toThrow();
  });
});

describe("nextStaleAtMs", () => {
  test("returns last-touched plus threshold in ms", () => {
    const lastTouched = 1_000_000_000_000;
    const threshold = 60;
    expect(nextStaleAtMs(lastTouched, threshold)).toBe(
      lastTouched + threshold * MS_PER_DAY,
    );
  });

  test("throws on negative threshold", () => {
    expect(() => nextStaleAtMs(0, -1)).toThrow();
  });

  test("round-trips with isStale at the returned boundary", () => {
    const lastTouched = 10 * MS_PER_DAY;
    const threshold = 3;
    const nextStale = nextStaleAtMs(lastTouched, threshold);
    expect(isStale(lastTouched, threshold, nextStale)).toBe(true);
    expect(isStale(lastTouched, threshold, nextStale - 1)).toBe(false);
  });
});
