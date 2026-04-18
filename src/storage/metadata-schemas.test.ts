import { describe, expect, test } from "bun:test";

import type {
  GlobalConfig,
  HistoryEvent,
  ProjectMetadata,
} from "../core/project-types.ts";
import { isErr, isOk } from "../core/result.ts";
import { ValidationError } from "../errors/validation-error.ts";
import {
  validateGlobalConfig,
  validateHistoryEvent,
  validateProjectMetadata,
} from "./metadata-schemas.ts";

const validMetadata: ProjectMetadata = {
  id: "01HAZQG6B2F8VXTRMJ8WQPK3NR",
  name: "my-project",
  category: "active",
  state: "active",
  created_at: 1_700_000_000_000,
  tags: ["tool", "cli"],
  description: "a small project",
  scratch: false,
};

const validConfig: GlobalConfig = {
  root: "/Users/me/Projects",
  defaults: {
    staleness_days: 60,
    on_stale: "prompt",
    scratch_prune_days: 7,
    pause_max_days: 90,
  },
  editors: { default: "code" },
  ai: { default: "claude" },
  categories: {
    active: {},
    lab: { staleness_days: 14, on_stale: "prompt_prune" },
  },
  aliases: { zed: { command: "zed {path}" } },
};

describe("validateProjectMetadata", () => {
  test("accepts a fully populated valid metadata object", () => {
    const result = validateProjectMetadata(validMetadata);
    expect(isOk(result)).toBe(true);
  });

  test("accepts metadata without optional fields", () => {
    const minimal: ProjectMetadata = {
      id: "01HAZQG6B2F8VXTRMJ8WQPK3NR",
      name: "p",
      category: "active",
      state: "incubating",
      created_at: 1,
      tags: [],
      scratch: true,
    };
    expect(isOk(validateProjectMetadata(minimal))).toBe(true);
  });

  test("accepts paused metadata with paused_until set", () => {
    const paused: ProjectMetadata = {
      ...validMetadata,
      state: "paused",
      paused_until: 1_800_000_000_000,
    };
    expect(isOk(validateProjectMetadata(paused))).toBe(true);
  });

  test("rejects metadata missing a required field", () => {
    const { id: _unused, ...missing } = validMetadata;
    const result = validateProjectMetadata(missing);
    expect(isErr(result)).toBe(true);
    if (isErr(result)) {
      expect(result.error).toBeInstanceOf(ValidationError);
      expect(result.error.issues.length).toBeGreaterThan(0);
    }
  });

  test("rejects an unknown project state", () => {
    const invalid = { ...validMetadata, state: "deleted" };
    expect(isErr(validateProjectMetadata(invalid))).toBe(true);
  });

  test("rejects non-integer created_at", () => {
    const invalid = { ...validMetadata, created_at: 1.5 };
    expect(isErr(validateProjectMetadata(invalid))).toBe(true);
  });

  test("rejects a non-object input", () => {
    expect(isErr(validateProjectMetadata(null))).toBe(true);
    expect(isErr(validateProjectMetadata("not an object"))).toBe(true);
    expect(isErr(validateProjectMetadata(42))).toBe(true);
  });
});

describe("validateHistoryEvent", () => {
  const created: HistoryEvent = {
    type: "created",
    at: 1_700_000_000_000,
    source: "new",
  };
  const stateChanged: HistoryEvent = {
    type: "state_changed",
    at: 1_700_000_000_000,
    from: "active",
    to: "paused",
    paused_until: 1_800_000_000_000,
    reason: "vacation",
  };
  const renamed: HistoryEvent = {
    type: "renamed",
    at: 1_700_000_000_000,
    from: "old",
    to: "new",
  };
  const categoryChanged: HistoryEvent = {
    type: "category_changed",
    at: 1_700_000_000_000,
    from: "lab",
    to: "active",
  };
  const touched: HistoryEvent = {
    type: "touched",
    at: 1_700_000_000_000,
  };

  test.each([
    ["created", created],
    ["state_changed", stateChanged],
    ["renamed", renamed],
    ["category_changed", categoryChanged],
    ["touched", touched],
  ])("accepts a valid %s event", (_label, event) => {
    expect(isOk(validateHistoryEvent(event))).toBe(true);
  });

  test("rejects an unknown event type", () => {
    const invalid = { type: "bogus", at: 1 };
    expect(isErr(validateHistoryEvent(invalid))).toBe(true);
  });

  test("rejects a state_changed event with an invalid state", () => {
    const invalid = { ...stateChanged, to: "not-a-state" };
    expect(isErr(validateHistoryEvent(invalid))).toBe(true);
  });
});

describe("validateGlobalConfig", () => {
  test("accepts the example config shape", () => {
    expect(isOk(validateGlobalConfig(validConfig))).toBe(true);
  });

  test("accepts a config with empty categories and aliases", () => {
    const minimal: GlobalConfig = {
      root: "/root",
      defaults: {
        staleness_days: 60,
        on_stale: "prompt",
        scratch_prune_days: 7,
        pause_max_days: 90,
      },
      editors: {},
      ai: {},
      categories: {},
      aliases: {},
    };
    expect(isOk(validateGlobalConfig(minimal))).toBe(true);
  });

  test("rejects a config missing the defaults block", () => {
    const { defaults: _unused, ...missing } = validConfig;
    expect(isErr(validateGlobalConfig(missing))).toBe(true);
  });

  test("rejects an alias entry with an empty command", () => {
    const invalid = {
      ...validConfig,
      aliases: { bad: { command: "" } },
    };
    expect(isErr(validateGlobalConfig(invalid))).toBe(true);
  });

  test("rejects a category override with a non-integer staleness_days", () => {
    const invalid = {
      ...validConfig,
      categories: { ...validConfig.categories, lab: { staleness_days: 1.5 } },
    };
    expect(isErr(validateGlobalConfig(invalid))).toBe(true);
  });
});
