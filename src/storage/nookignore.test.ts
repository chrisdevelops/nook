import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { loadNookIgnore } from "./nookignore.ts";

describe("loadNookIgnore", () => {
  let workdir: string;

  beforeEach(async () => {
    workdir = await mkdtemp(join(tmpdir(), "nook-ignore-"));
  });

  afterEach(async () => {
    await rm(workdir, { recursive: true, force: true });
  });

  test("ignores nothing when no ignore files are present", async () => {
    const matcher = await loadNookIgnore(workdir);
    expect(matcher.ignores("anything/at/all.ts")).toBe(false);
    expect(matcher.ignores("node_modules/foo")).toBe(false);
  });

  test("respects .gitignore rules when only that file exists", async () => {
    await writeFile(join(workdir, ".gitignore"), "node_modules\ndist\n");
    const matcher = await loadNookIgnore(workdir);
    expect(matcher.ignores("node_modules/foo/bar.ts")).toBe(true);
    expect(matcher.ignores("dist/output.js")).toBe(true);
    expect(matcher.ignores("src/main.ts")).toBe(false);
  });

  test("respects .nookignore rules when only that file exists", async () => {
    await writeFile(join(workdir, ".nookignore"), "private/\n*.secret\n");
    const matcher = await loadNookIgnore(workdir);
    expect(matcher.ignores("private/stuff")).toBe(true);
    expect(matcher.ignores("credentials.secret")).toBe(true);
    expect(matcher.ignores("README.md")).toBe(false);
  });

  test("merges rules when both files are present", async () => {
    await writeFile(join(workdir, ".gitignore"), "node_modules\n");
    await writeFile(join(workdir, ".nookignore"), "*.log\n");
    const matcher = await loadNookIgnore(workdir);
    expect(matcher.ignores("node_modules/pkg")).toBe(true);
    expect(matcher.ignores("debug.log")).toBe(true);
    expect(matcher.ignores("src/index.ts")).toBe(false);
  });

  test("honors negation patterns across both files", async () => {
    await writeFile(join(workdir, ".gitignore"), "*.log\n");
    await writeFile(join(workdir, ".nookignore"), "!keep.log\n");
    const matcher = await loadNookIgnore(workdir);
    expect(matcher.ignores("debug.log")).toBe(true);
    expect(matcher.ignores("keep.log")).toBe(false);
  });
});
