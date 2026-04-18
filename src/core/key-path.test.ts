import { describe, expect, test } from "bun:test";

import { isErr, isOk } from "./result.ts";
import {
  getAtPath,
  parseKeyPath,
  setAtPath,
} from "./key-path.ts";

describe("parseKeyPath", () => {
  test("splits a dotted key into segments", () => {
    const result = parseKeyPath("defaults.staleness_days");
    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      expect(result.value).toEqual(["defaults", "staleness_days"]);
    }
  });

  test("supports a single-segment key", () => {
    const result = parseKeyPath("root");
    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      expect(result.value).toEqual(["root"]);
    }
  });

  test("supports deeply nested keys", () => {
    const result = parseKeyPath("categories.lab.staleness_days");
    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      expect(result.value).toEqual(["categories", "lab", "staleness_days"]);
    }
  });

  test("rejects an empty key", () => {
    expect(isErr(parseKeyPath(""))).toBe(true);
  });

  test("rejects a key with an empty segment (leading dot)", () => {
    expect(isErr(parseKeyPath(".foo"))).toBe(true);
  });

  test("rejects a key with an empty segment (trailing dot)", () => {
    expect(isErr(parseKeyPath("foo."))).toBe(true);
  });

  test("rejects a key with consecutive dots", () => {
    expect(isErr(parseKeyPath("foo..bar"))).toBe(true);
  });
});

describe("getAtPath", () => {
  const tree = {
    root: "/projects",
    defaults: { staleness_days: 60 },
    categories: { lab: { staleness_days: 14 } },
  };

  test("returns the leaf value at a nested path", () => {
    expect(getAtPath(tree, ["defaults", "staleness_days"])).toBe(60);
  });

  test("returns a nested object at a partial path", () => {
    expect(getAtPath(tree, ["defaults"])).toEqual({ staleness_days: 60 });
  });

  test("returns undefined when a segment is missing at the leaf", () => {
    expect(getAtPath(tree, ["defaults", "missing"])).toBe(undefined);
  });

  test("returns undefined when a segment is missing in the middle", () => {
    expect(getAtPath(tree, ["missing", "staleness_days"])).toBe(undefined);
  });

  test("returns undefined when crossing a non-object value", () => {
    expect(getAtPath(tree, ["root", "foo"])).toBe(undefined);
  });

  test("returns undefined when the path is empty", () => {
    expect(getAtPath(tree, [])).toBe(undefined);
  });
});

describe("setAtPath", () => {
  test("overwrites an existing leaf value", () => {
    const input = { defaults: { staleness_days: 60 } };
    const result = setAtPath(input, ["defaults", "staleness_days"], 90, {
      autoCreate: false,
    });
    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      expect(result.value).toEqual({ defaults: { staleness_days: 90 } });
    }
  });

  test("does not mutate the input object", () => {
    const input = { defaults: { staleness_days: 60 } };
    const frozenCopy = structuredClone(input);
    setAtPath(input, ["defaults", "staleness_days"], 90, { autoCreate: false });
    expect(input).toEqual(frozenCopy);
  });

  test("auto-creates missing intermediates when autoCreate is true", () => {
    const input: Record<string, unknown> = { categories: {} };
    const result = setAtPath(
      input,
      ["categories", "lab", "staleness_days"],
      14,
      { autoCreate: true },
    );
    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      expect(result.value).toEqual({
        categories: { lab: { staleness_days: 14 } },
      });
    }
  });

  test("auto-create fills in missing parents all the way down", () => {
    const input: Record<string, unknown> = {};
    const result = setAtPath(input, ["a", "b", "c"], "leaf", {
      autoCreate: true,
    });
    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      expect(result.value).toEqual({ a: { b: { c: "leaf" } } });
    }
  });

  test("errors when autoCreate is false and a parent is missing", () => {
    const input: Record<string, unknown> = { defaults: { staleness_days: 60 } };
    const result = setAtPath(input, ["defualts", "staleness_days"], 90, {
      autoCreate: false,
    });
    expect(isErr(result)).toBe(true);
  });

  test("errors when a path crosses a non-object leaf", () => {
    const input: Record<string, unknown> = {
      defaults: { staleness_days: 60 },
    };
    const result = setAtPath(
      input,
      ["defaults", "staleness_days", "nested"],
      90,
      { autoCreate: true },
    );
    expect(isErr(result)).toBe(true);
  });

  test("errors on an empty path", () => {
    const input: Record<string, unknown> = { a: 1 };
    expect(
      isErr(setAtPath(input, [], "value", { autoCreate: false })),
    ).toBe(true);
  });
});
