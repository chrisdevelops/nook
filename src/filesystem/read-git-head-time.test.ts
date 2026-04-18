import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { isErr, isOk } from "../core/result.ts";
import { FilesystemError } from "../errors/filesystem-error.ts";
import {
  readGitHeadTime,
  type GitSpawn,
  type GitSpawnOutcome,
} from "./read-git-head-time.ts";

type SpawnCall = {
  readonly args: readonly string[];
  readonly cwd: string;
};

const makeSpawn = (
  outcome: GitSpawnOutcome | Error,
): { spawn: GitSpawn; calls: SpawnCall[] } => {
  const calls: SpawnCall[] = [];
  const spawn: GitSpawn = async (args, cwd) => {
    calls.push({ args, cwd });
    if (outcome instanceof Error) {
      throw outcome;
    }
    return outcome;
  };
  return { spawn, calls };
};

describe("readGitHeadTime", () => {
  let workdir: string;

  beforeEach(async () => {
    workdir = await mkdtemp(join(tmpdir(), "nook-git-head-"));
  });

  afterEach(async () => {
    await rm(workdir, { recursive: true, force: true });
  });

  test("returns the HEAD commit time in milliseconds when git succeeds", async () => {
    const { spawn, calls } = makeSpawn({
      exitCode: 0,
      stdout: "1700000000\n",
      stderr: "",
    });

    const result = await readGitHeadTime(workdir, { spawn });
    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      expect(result.value).toBe(1_700_000_000_000);
    }
    expect(calls).toHaveLength(1);
    expect(calls[0]?.cwd).toBe(workdir);
    expect(calls[0]?.args).toEqual([
      "log",
      "-1",
      "--format=%ct",
      "HEAD",
    ]);
  });

  test("returns ok(null) when the directory is not a git repository", async () => {
    const { spawn } = makeSpawn({
      exitCode: 128,
      stdout: "",
      stderr: "fatal: not a git repository",
    });

    const result = await readGitHeadTime(workdir, { spawn });
    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      expect(result.value).toBeNull();
    }
  });

  test("returns ok(null) when stdout is empty (e.g. repo with no commits)", async () => {
    const { spawn } = makeSpawn({
      exitCode: 0,
      stdout: "\n",
      stderr: "",
    });

    const result = await readGitHeadTime(workdir, { spawn });
    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      expect(result.value).toBeNull();
    }
  });

  test("returns ok(null) when stdout is not a parseable integer", async () => {
    const { spawn } = makeSpawn({
      exitCode: 0,
      stdout: "not-a-number",
      stderr: "",
    });

    const result = await readGitHeadTime(workdir, { spawn });
    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      expect(result.value).toBeNull();
    }
  });

  test("returns FilesystemError when the spawn implementation throws", async () => {
    const { spawn } = makeSpawn(new Error("git not on PATH"));

    const result = await readGitHeadTime(workdir, { spawn });
    expect(isErr(result)).toBe(true);
    if (isErr(result)) {
      expect(result.error).toBeInstanceOf(FilesystemError);
      expect((result.error as FilesystemError).path).toBe(workdir);
    }
  });
});
