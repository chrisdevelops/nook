import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { GlobalConfig } from "../core/project-types.ts";
import { isErr, isOk } from "../core/result.ts";
import { FilesystemError } from "../errors/filesystem-error.ts";
import { ValidationError } from "../errors/validation-error.ts";
import { readGlobalConfig, writeGlobalConfig } from "./global-config.ts";

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
  aliases: {
    notes: { command: "obsidian {path}" },
  },
};

describe("global-config round trip", () => {
  let workdir: string;

  beforeEach(async () => {
    workdir = await mkdtemp(join(tmpdir(), "nook-config-"));
  });

  afterEach(async () => {
    await rm(workdir, { recursive: true, force: true });
  });

  test("writeGlobalConfig then readGlobalConfig returns the same config", async () => {
    const configPath = join(workdir, "nook", "config.jsonc");
    const writeResult = await writeGlobalConfig(configPath, validConfig);
    expect(isOk(writeResult)).toBe(true);

    const readResult = await readGlobalConfig(configPath);
    expect(isOk(readResult)).toBe(true);
    if (isOk(readResult)) {
      expect(readResult.value).toEqual(validConfig);
    }
  });

  test("writeGlobalConfig creates missing parent directories", async () => {
    const configPath = join(workdir, "deep", "nested", "nook", "config.jsonc");
    const result = await writeGlobalConfig(configPath, validConfig);
    expect(isOk(result)).toBe(true);

    const entries = await readdir(join(workdir, "deep", "nested", "nook"));
    expect(entries).toContain("config.jsonc");
  });

  test("config written with 2-space indentation and a trailing newline", async () => {
    const configPath = join(workdir, "config.jsonc");
    await writeGlobalConfig(configPath, validConfig);
    const text = await readFile(configPath, "utf8");
    expect(text).toBe(`${JSON.stringify(validConfig, null, 2)}\n`);
  });

  test("JSONC comments in the config file are tolerated on read", async () => {
    const configPath = join(workdir, "config.jsonc");
    const commented = `// top-level comment\n${JSON.stringify(validConfig, null, 2)}\n`;
    await writeFile(configPath, commented);

    const result = await readGlobalConfig(configPath);
    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      expect(result.value).toEqual(validConfig);
    }
  });
});

describe("readGlobalConfig errors", () => {
  let workdir: string;

  beforeEach(async () => {
    workdir = await mkdtemp(join(tmpdir(), "nook-config-read-err-"));
  });

  afterEach(async () => {
    await rm(workdir, { recursive: true, force: true });
  });

  test("returns FilesystemError when the config file is missing", async () => {
    const result = await readGlobalConfig(join(workdir, "config.jsonc"));
    expect(isErr(result)).toBe(true);
    if (isErr(result)) {
      expect(result.error).toBeInstanceOf(FilesystemError);
    }
  });

  test("returns ValidationError when the config has the wrong shape", async () => {
    const configPath = join(workdir, "config.jsonc");
    await writeFile(configPath, JSON.stringify({ root: 123 }));

    const result = await readGlobalConfig(configPath);
    expect(isErr(result)).toBe(true);
    if (isErr(result)) {
      expect(result.error).toBeInstanceOf(ValidationError);
    }
  });
});

describe("writeGlobalConfig errors", () => {
  let workdir: string;

  beforeEach(async () => {
    workdir = await mkdtemp(join(tmpdir(), "nook-config-write-err-"));
  });

  afterEach(async () => {
    await rm(workdir, { recursive: true, force: true });
  });

  test("rejects invalid config with ValidationError and does not touch disk", async () => {
    const configPath = join(workdir, "child", "config.jsonc");
    const invalid = { ...validConfig, root: "" } as GlobalConfig;

    const result = await writeGlobalConfig(configPath, invalid);
    expect(isErr(result)).toBe(true);
    if (isErr(result)) {
      expect(result.error).toBeInstanceOf(ValidationError);
    }

    const entries = await readdir(workdir);
    expect(entries).not.toContain("child");
  });
});
