import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { isErr, isOk } from "../core/result.ts";
import { FilesystemError } from "../errors/filesystem-error.ts";
import { computeLastTouched } from "./compute-last-touched.ts";
import type { GitSpawn } from "./read-git-head-time.ts";

const setMtime = async (path: string, mtimeMs: number): Promise<void> => {
  const seconds = mtimeMs / 1000;
  await utimes(path, seconds, seconds);
};

const fakeGitSpawn = (exitCode: number, stdout: string): GitSpawn =>
  async () => ({ exitCode, stdout, stderr: "" });

const gitMissing: GitSpawn = fakeGitSpawn(128, "");

describe("computeLastTouched", () => {
  let workdir: string;

  beforeEach(async () => {
    workdir = await mkdtemp(join(tmpdir(), "nook-last-touched-"));
  });

  afterEach(async () => {
    await rm(workdir, { recursive: true, force: true });
  });

  test("returns the maximum mtime from the file walk when git and cli touches are absent", async () => {
    await writeFile(join(workdir, "a.txt"), "a");
    await writeFile(join(workdir, "b.txt"), "b");
    await setMtime(join(workdir, "a.txt"), 1_700_000_000_000);
    await setMtime(join(workdir, "b.txt"), 1_700_000_005_000);

    const result = await computeLastTouched({
      projectDir: workdir,
      gitSpawn: gitMissing,
    });

    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      expect(result.value).toBe(1_700_000_005_000);
    }
  });

  test("prefers git HEAD time when it is newer than any walked file", async () => {
    await writeFile(join(workdir, "a.txt"), "a");
    await setMtime(join(workdir, "a.txt"), 1_700_000_000_000);

    const gitSpawn = fakeGitSpawn(0, "1700000100\n");
    const result = await computeLastTouched({
      projectDir: workdir,
      gitSpawn,
    });

    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      expect(result.value).toBe(1_700_000_100_000);
    }
  });

  test("prefers the largest CLI touch when it is the newest signal", async () => {
    await writeFile(join(workdir, "a.txt"), "a");
    await setMtime(join(workdir, "a.txt"), 1_700_000_000_000);

    const result = await computeLastTouched({
      projectDir: workdir,
      gitSpawn: fakeGitSpawn(0, "1700000100"),
      cliTouchesMs: [1_700_000_050_000, 1_700_000_200_000],
    });

    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      expect(result.value).toBe(1_700_000_200_000);
    }
  });

  test("applies the ignores predicate so excluded files are not considered", async () => {
    await mkdir(join(workdir, "node_modules"), { recursive: true });
    await writeFile(join(workdir, "node_modules", "big.js"), "x");
    await setMtime(join(workdir, "node_modules", "big.js"), 1_800_000_000_000);
    await writeFile(join(workdir, "src.ts"), "y");
    await setMtime(join(workdir, "src.ts"), 1_700_000_000_000);

    const ignores = (relPath: string): boolean =>
      relPath === "node_modules" || relPath.startsWith("node_modules/");

    const result = await computeLastTouched({
      projectDir: workdir,
      gitSpawn: gitMissing,
      ignores,
    });

    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      expect(result.value).toBe(1_700_000_000_000);
    }
  });

  test("returns ok(null) when there are no mtimes, no git, and no CLI touches", async () => {
    const result = await computeLastTouched({
      projectDir: workdir,
      gitSpawn: gitMissing,
    });

    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      expect(result.value).toBeNull();
    }
  });

  test("returns a number when only CLI touches are present", async () => {
    const result = await computeLastTouched({
      projectDir: workdir,
      gitSpawn: gitMissing,
      cliTouchesMs: [1_700_000_000_000, 1_700_000_300_000],
    });

    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      expect(result.value).toBe(1_700_000_300_000);
    }
  });

  test("returns FilesystemError when the project directory cannot be walked", async () => {
    const result = await computeLastTouched({
      projectDir: join(workdir, "does-not-exist"),
      gitSpawn: gitMissing,
    });

    expect(isErr(result)).toBe(true);
    if (isErr(result)) {
      expect(result.error).toBeInstanceOf(FilesystemError);
    }
  });
});
