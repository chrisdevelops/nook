import { describe, expect, test } from "bun:test";

import {
  projectStates,
  type ProjectState,
} from "./project-types.ts";
import {
  allowedTargets,
  isValidTransition,
} from "./state-transitions.ts";

const cases: ReadonlyArray<
  readonly [from: ProjectState, allowed: readonly ProjectState[]]
> = [
  ["incubating", ["active", "paused", "maintained", "shipped", "archived"]],
  ["active", ["paused", "maintained", "shipped", "archived"]],
  ["paused", ["active", "maintained", "shipped", "archived"]],
  ["maintained", ["active", "paused", "shipped", "archived"]],
  ["shipped", ["active", "maintained", "archived"]],
  ["archived", ["active"]],
];

describe("allowedTargets", () => {
  for (const [from, allowed] of cases) {
    test(`${from} allows exactly ${allowed.join(", ")}`, () => {
      expect([...allowedTargets(from)].sort()).toEqual([...allowed].sort());
    });
  }

  test("covers every project state", () => {
    for (const state of projectStates) {
      expect(() => allowedTargets(state)).not.toThrow();
    }
  });

  test("never allows a self-loop", () => {
    for (const state of projectStates) {
      expect(allowedTargets(state)).not.toContain(state);
    }
  });
});

describe("isValidTransition", () => {
  test("returns true for every documented allowed transition", () => {
    for (const [from, allowed] of cases) {
      for (const to of allowed) {
        expect(isValidTransition(from, to)).toBe(true);
      }
    }
  });

  test("returns false for transitions not in the allowlist", () => {
    for (const [from, allowed] of cases) {
      for (const to of projectStates) {
        if (allowed.includes(to)) continue;
        expect(isValidTransition(from, to)).toBe(false);
      }
    }
  });

  test("rejects self-transitions for every state", () => {
    for (const state of projectStates) {
      expect(isValidTransition(state, state)).toBe(false);
    }
  });

  test("archive is a one-way trip; only unarchive returns to active", () => {
    expect(allowedTargets("archived")).toEqual(["active"]);
  });

  test("shipped cannot be directly paused — unship first", () => {
    expect(isValidTransition("shipped", "paused")).toBe(false);
  });
});
