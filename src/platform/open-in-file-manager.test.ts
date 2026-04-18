import { describe, expect, test } from "bun:test";

import { isErr, isOk } from "../core/result.ts";
import type { LaunchSpawn } from "./launch-editor.ts";
import { openInFileManager } from "./open-in-file-manager.ts";

type SpawnCall = {
  readonly cmd: readonly string[];
  readonly cwd: string | undefined;
};

const makeSpawn = (
  outcome: { exitCode: number } | { throws: Error },
): {
  calls: SpawnCall[];
  spawn: LaunchSpawn;
} => {
  const calls: SpawnCall[] = [];
  const spawn: LaunchSpawn = async (cmd, options) => {
    calls.push({ cmd, cwd: options.cwd });
    if ("throws" in outcome) {
      throw outcome.throws;
    }
    return { exitCode: outcome.exitCode };
  };
  return { calls, spawn };
};

describe("openInFileManager", () => {
  test("uses `open` on macOS", async () => {
    const { calls, spawn } = makeSpawn({ exitCode: 0 });

    const result = await openInFileManager({
      projectPath: "/Users/alex/Projects/foo",
      platform: "darwin",
      spawn,
    });

    expect(isOk(result)).toBe(true);
    expect(calls).toEqual([
      { cmd: ["open", "/Users/alex/Projects/foo"], cwd: undefined },
    ]);
  });

  test("uses `explorer` on Windows", async () => {
    const { calls, spawn } = makeSpawn({ exitCode: 0 });

    const result = await openInFileManager({
      projectPath: "C:\\Users\\Alex\\Projects\\foo",
      platform: "win32",
      spawn,
    });

    expect(isOk(result)).toBe(true);
    expect(calls).toEqual([
      { cmd: ["explorer", "C:\\Users\\Alex\\Projects\\foo"], cwd: undefined },
    ]);
  });

  test("accepts explorer's non-zero exit code on Windows as success", async () => {
    const { spawn } = makeSpawn({ exitCode: 1 });

    const result = await openInFileManager({
      projectPath: "C:\\foo",
      platform: "win32",
      spawn,
    });

    expect(isOk(result)).toBe(true);
  });

  test("uses `xdg-open` on Linux", async () => {
    const { calls, spawn } = makeSpawn({ exitCode: 0 });

    const result = await openInFileManager({
      projectPath: "/home/alex/foo",
      platform: "linux",
      spawn,
    });

    expect(isOk(result)).toBe(true);
    expect(calls).toEqual([
      { cmd: ["xdg-open", "/home/alex/foo"], cwd: undefined },
    ]);
  });

  test("returns err on unsupported platforms", async () => {
    const { calls, spawn } = makeSpawn({ exitCode: 0 });

    const result = await openInFileManager({
      projectPath: "/tmp/x",
      platform: "freebsd" as NodeJS.Platform,
      spawn,
    });

    expect(isErr(result)).toBe(true);
    if (isErr(result)) {
      expect(result.error.message).toContain("freebsd");
    }
    expect(calls).toEqual([]);
  });

  test("returns err when spawn throws (e.g. xdg-open missing)", async () => {
    const { spawn } = makeSpawn({ throws: new Error("ENOENT: xdg-open") });

    const result = await openInFileManager({
      projectPath: "/tmp/x",
      platform: "linux",
      spawn,
    });

    expect(isErr(result)).toBe(true);
    if (isErr(result)) {
      expect(result.error.message).toContain("ENOENT");
    }
  });

  test("returns err on non-Windows platforms when the opener exits non-zero", async () => {
    const { spawn } = makeSpawn({ exitCode: 2 });

    const result = await openInFileManager({
      projectPath: "/home/alex/missing",
      platform: "linux",
      spawn,
    });

    expect(isErr(result)).toBe(true);
    if (isErr(result)) {
      expect(result.error.message).toContain("exited with code 2");
    }
  });
});
