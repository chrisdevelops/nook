import { describe, expect, test } from "bun:test";

import { ValidationError } from "../errors/validation-error.ts";
import { isErr, isOk } from "./result.ts";
import { MS_PER_DAY } from "./staleness.ts";
import { isPauseExpired, resolvePauseExpiry } from "./pause-window.ts";

const now = Date.UTC(2026, 0, 15, 12, 0, 0);

describe("resolvePauseExpiry", () => {
  test("days: returns now + days * MS_PER_DAY", () => {
    const result = resolvePauseExpiry({ days: 7 }, now);
    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      expect(result.value).toBe(now + 7 * MS_PER_DAY);
    }
  });

  test("until: accepts a future ISO date string", () => {
    const until = "2026-02-01T00:00:00.000Z";
    const result = resolvePauseExpiry({ until }, now);
    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      expect(result.value).toBe(Date.parse(until));
    }
  });

  test("until: accepts a bare YYYY-MM-DD date", () => {
    const result = resolvePauseExpiry({ until: "2026-02-01" }, now);
    expect(isOk(result)).toBe(true);
  });

  test("rejects when neither days nor until is provided", () => {
    const result = resolvePauseExpiry({}, now);
    expect(isErr(result)).toBe(true);
    if (isErr(result)) {
      expect(result.error).toBeInstanceOf(ValidationError);
      expect(result.error.code).toBe("validation");
    }
  });

  test("rejects when both days and until are provided", () => {
    const result = resolvePauseExpiry(
      { days: 7, until: "2026-02-01" },
      now,
    );
    expect(isErr(result)).toBe(true);
  });

  test("rejects zero or negative days", () => {
    for (const days of [0, -1, -10]) {
      const result = resolvePauseExpiry({ days }, now);
      expect(isErr(result)).toBe(true);
    }
  });

  test("rejects non-integer days", () => {
    const result = resolvePauseExpiry({ days: 1.5 }, now);
    expect(isErr(result)).toBe(true);
  });

  test("rejects unparseable until strings", () => {
    const result = resolvePauseExpiry({ until: "not-a-date" }, now);
    expect(isErr(result)).toBe(true);
  });

  test("rejects until strings in the past", () => {
    const result = resolvePauseExpiry(
      { until: "2025-01-01T00:00:00.000Z" },
      now,
    );
    expect(isErr(result)).toBe(true);
  });

  test("rejects until strings equal to now", () => {
    const result = resolvePauseExpiry(
      { until: new Date(now).toISOString() },
      now,
    );
    expect(isErr(result)).toBe(true);
  });
});

describe("isPauseExpired", () => {
  test("pause before now has expired", () => {
    expect(isPauseExpired(now - 1, now)).toBe(true);
  });

  test("pause exactly at now has expired (inclusive)", () => {
    expect(isPauseExpired(now, now)).toBe(true);
  });

  test("pause strictly in the future has not expired", () => {
    expect(isPauseExpired(now + 1, now)).toBe(false);
  });
});
