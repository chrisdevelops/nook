import { describe, expect, test } from "bun:test";

import { err, isErr, isOk, ok, type Result } from "./result.ts";

describe("ok", () => {
  test("constructs a success variant carrying the value", () => {
    const result = ok(42);
    expect(result).toEqual({ ok: true, value: 42 });
  });

  test("preserves undefined as a valid value", () => {
    const result = ok(undefined);
    expect(result).toEqual({ ok: true, value: undefined });
  });
});

describe("err", () => {
  test("constructs a failure variant carrying the error", () => {
    const failure = new Error("boom");
    const result = err(failure);
    expect(result).toEqual({ ok: false, error: failure });
  });
});

describe("isOk", () => {
  test("returns true for ok results and narrows the type", () => {
    const result: Result<number, string> = ok(7);
    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      const value: number = result.value;
      expect(value).toBe(7);
    }
  });

  test("returns false for err results", () => {
    const result: Result<number, string> = err("nope");
    expect(isOk(result)).toBe(false);
  });
});

describe("isErr", () => {
  test("returns true for err results and narrows the type", () => {
    const result: Result<number, string> = err("nope");
    expect(isErr(result)).toBe(true);
    if (isErr(result)) {
      const error: string = result.error;
      expect(error).toBe("nope");
    }
  });

  test("returns false for ok results", () => {
    const result: Result<number, string> = ok(1);
    expect(isErr(result)).toBe(false);
  });
});
