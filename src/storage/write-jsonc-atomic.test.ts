import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { isErr, isOk } from "../core/result.ts";
import { FilesystemError } from "../errors/filesystem-error.ts";
import { readJsonc } from "./read-jsonc.ts";
import { writeJsoncAtomic } from "./write-jsonc-atomic.ts";

describe("writeJsoncAtomic", () => {
  let workdir: string;

  beforeEach(async () => {
    workdir = await mkdtemp(join(tmpdir(), "nook-writejsonc-"));
  });

  afterEach(async () => {
    await rm(workdir, { recursive: true, force: true });
  });

  test("writes a 2-space indented JSON document ending with a newline", async () => {
    const path = join(workdir, "config.jsonc");
    const value = { root: "/home/me", defaults: { staleness_days: 60 } };

    const result = await writeJsoncAtomic(path, value);
    expect(isOk(result)).toBe(true);

    const text = await readFile(path, "utf8");
    expect(text).toBe(`${JSON.stringify(value, null, 2)}\n`);
  });

  test("round-trips via readJsonc", async () => {
    const path = join(workdir, "config.jsonc");
    const value = { categories: { lab: { staleness_days: 14 } } };
    await writeJsoncAtomic(path, value);
    const read = await readJsonc(path);
    expect(isOk(read)).toBe(true);
    if (isOk(read)) {
      expect(read.value).toEqual(value);
    }
  });

  test("overwrites an existing file in place", async () => {
    const path = join(workdir, "config.jsonc");
    await writeJsoncAtomic(path, { version: 1 });
    await writeJsoncAtomic(path, { version: 2 });

    const text = await readFile(path, "utf8");
    expect(text).toBe(`${JSON.stringify({ version: 2 }, null, 2)}\n`);
  });

  test("returns FilesystemError when the target directory does not exist", async () => {
    const result = await writeJsoncAtomic(
      join(workdir, "missing-dir", "x.jsonc"),
      { a: 1 },
    );
    expect(isErr(result)).toBe(true);
    if (isErr(result)) {
      expect(result.error).toBeInstanceOf(FilesystemError);
    }
  });
});
