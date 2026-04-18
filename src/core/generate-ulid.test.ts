import { describe, expect, test } from "bun:test";

import { generateUlid, ULID_ALPHABET } from "./generate-ulid.ts";

const fixedNow = () => 1_700_000_000_000;
const zeroRandom = () => 0;
const maxRandom = () => 0.9999999;

describe("generateUlid", () => {
  test("produces a 26-character string", () => {
    const ulid = generateUlid({ now: fixedNow, random: zeroRandom });
    expect(ulid.length).toBe(26);
  });

  test("uses only Crockford base32 characters", () => {
    const ulid = generateUlid({ now: Date.now, random: Math.random });
    for (const char of ulid) {
      expect(ULID_ALPHABET).toContain(char);
    }
  });

  test("encodes timestamp deterministically for a fixed now", () => {
    const a = generateUlid({ now: fixedNow, random: zeroRandom });
    const b = generateUlid({ now: fixedNow, random: zeroRandom });
    expect(a).toBe(b);
  });

  test("timestamp portion sorts lexicographically with time", () => {
    const earlier = generateUlid({ now: () => 1_700_000_000_000, random: zeroRandom });
    const later = generateUlid({ now: () => 1_700_000_001_000, random: zeroRandom });
    expect(later > earlier).toBe(true);
    expect(later.slice(0, 10) > earlier.slice(0, 10)).toBe(true);
  });

  test("random portion is all zero-char when random returns 0", () => {
    const ulid = generateUlid({ now: fixedNow, random: zeroRandom });
    expect(ulid.slice(10)).toBe("0".repeat(16));
  });

  test("random portion is all Z-char when random returns near 1", () => {
    const ulid = generateUlid({ now: fixedNow, random: maxRandom });
    expect(ulid.slice(10)).toBe("Z".repeat(16));
  });

  test("differs across two calls with different random streams", () => {
    const a = generateUlid({ now: fixedNow, random: zeroRandom });
    const b = generateUlid({ now: fixedNow, random: () => 0.5 });
    expect(a).not.toBe(b);
    expect(a.slice(0, 10)).toBe(b.slice(0, 10));
  });

  test("throws on negative timestamps", () => {
    expect(() =>
      generateUlid({ now: () => -1, random: zeroRandom }),
    ).toThrow();
  });

  test("throws on non-finite timestamps", () => {
    expect(() =>
      generateUlid({ now: () => Number.POSITIVE_INFINITY, random: zeroRandom }),
    ).toThrow();
    expect(() =>
      generateUlid({ now: () => Number.NaN, random: zeroRandom }),
    ).toThrow();
  });

  test("throws when timestamp exceeds 48-bit ULID maximum", () => {
    expect(() =>
      generateUlid({ now: () => 2 ** 48, random: zeroRandom }),
    ).toThrow();
  });
});
