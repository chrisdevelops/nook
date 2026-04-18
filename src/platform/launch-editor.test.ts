import { describe, expect, test } from "bun:test";

import { isErr, isOk } from "../core/result.ts";
import { launchEditor, type LaunchSpawn } from "./launch-editor.ts";

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

describe("launchEditor", () => {
  test("spawns the editor with the project path and cwd", async () => {
    const { calls, spawn } = makeSpawn({ exitCode: 0 });

    const result = await launchEditor({
      editor: "code",
      projectPath: "/Users/alex/Projects/foo",
      spawn,
    });

    expect(isOk(result)).toBe(true);
    expect(calls).toEqual([
      {
        cmd: ["code", "/Users/alex/Projects/foo"],
        cwd: "/Users/alex/Projects/foo",
      },
    ]);
  });

  test("returns err when the editor exits non-zero", async () => {
    const { spawn } = makeSpawn({ exitCode: 2 });

    const result = await launchEditor({
      editor: "code",
      projectPath: "/tmp/x",
      spawn,
    });

    expect(isErr(result)).toBe(true);
    if (isErr(result)) {
      expect(result.error.message).toContain("exited with code 2");
    }
  });

  test("returns err when spawn itself throws", async () => {
    const { spawn } = makeSpawn({ throws: new Error("ENOENT: code") });

    const result = await launchEditor({
      editor: "code",
      projectPath: "/tmp/x",
      spawn,
    });

    expect(isErr(result)).toBe(true);
    if (isErr(result)) {
      expect(result.error.message).toContain("ENOENT");
    }
  });

  test("rejects empty editor strings with a validation-style error", async () => {
    const { calls, spawn } = makeSpawn({ exitCode: 0 });

    const result = await launchEditor({
      editor: "   ",
      projectPath: "/tmp/x",
      spawn,
    });

    expect(isErr(result)).toBe(true);
    expect(calls).toEqual([]);
  });

  test("explicit cwd overrides the projectPath default", async () => {
    const { calls, spawn } = makeSpawn({ exitCode: 0 });

    const result = await launchEditor({
      editor: "code",
      projectPath: "/home/alex/.config/nook/config.jsonc",
      cwd: "/home/alex/.config/nook",
      spawn,
    });

    expect(isOk(result)).toBe(true);
    expect(calls).toEqual([
      {
        cmd: ["code", "/home/alex/.config/nook/config.jsonc"],
        cwd: "/home/alex/.config/nook",
      },
    ]);
  });

  test("splits a multi-word editor command into argv", async () => {
    const { calls, spawn } = makeSpawn({ exitCode: 0 });

    const result = await launchEditor({
      editor: "code --wait",
      projectPath: "/tmp/x",
      spawn,
    });

    expect(isOk(result)).toBe(true);
    expect(calls).toEqual([
      { cmd: ["code", "--wait", "/tmp/x"], cwd: "/tmp/x" },
    ]);
  });
});
