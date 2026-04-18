import { describe, expect, test } from "bun:test";

import type { GlobalConfig } from "./project-types.ts";
import {
  resolveCategoryConfig,
  type ResolvedCategoryConfig,
} from "./resolve-category-config.ts";

const baseConfig: GlobalConfig = {
  root: "~/Projects",
  defaults: {
    staleness_days: 60,
    on_stale: "prompt",
    scratch_prune_days: 7,
    pause_max_days: 90,
  },
  editors: { default: "code" },
  ai: { default: "claude" },
  categories: {
    lab: {
      staleness_days: 14,
      on_stale: "prompt_prune",
    },
    active: {},
    client: {
      pause_max_days: 180,
    },
  },
  aliases: {},
};

describe("resolveCategoryConfig", () => {
  test("inherits all defaults when category has an empty override", () => {
    const resolved = resolveCategoryConfig(baseConfig, "active");
    const expected: ResolvedCategoryConfig = {
      staleness_days: 60,
      on_stale: "prompt",
      scratch_prune_days: 7,
      pause_max_days: 90,
    };
    expect(resolved).toEqual(expected);
  });

  test("uses category-level override when present", () => {
    const resolved = resolveCategoryConfig(baseConfig, "lab");
    expect(resolved.staleness_days).toBe(14);
    expect(resolved.on_stale).toBe("prompt_prune");
    expect(resolved.scratch_prune_days).toBe(7);
    expect(resolved.pause_max_days).toBe(90);
  });

  test("merges partial overrides with defaults for the rest", () => {
    const resolved = resolveCategoryConfig(baseConfig, "client");
    expect(resolved.staleness_days).toBe(60);
    expect(resolved.on_stale).toBe("prompt");
    expect(resolved.scratch_prune_days).toBe(7);
    expect(resolved.pause_max_days).toBe(180);
  });

  test("falls through to defaults when the category is unknown", () => {
    const resolved = resolveCategoryConfig(baseConfig, "unknown");
    expect(resolved).toEqual({
      staleness_days: 60,
      on_stale: "prompt",
      scratch_prune_days: 7,
      pause_max_days: 90,
    });
  });

  test("does not mutate the input config", () => {
    const snapshot = JSON.stringify(baseConfig);
    resolveCategoryConfig(baseConfig, "lab");
    expect(JSON.stringify(baseConfig)).toBe(snapshot);
  });
});
