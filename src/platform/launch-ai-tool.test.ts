import { describe, expect, test } from "bun:test";

import { isErr, isOk } from "../core/result.ts";
import { launchAiTool } from "./launch-ai-tool.ts";
import type { LaunchSpawn } from "./launch-editor.ts";

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

describe("launchAiTool", () => {
  test("spawns the tool with cwd set to projectPath and no path argument", async () => {
    const { calls, spawn } = makeSpawn({ exitCode: 0 });

    const result = await launchAiTool({
      tool: "claude",
      projectPath: "/Users/alex/Projects/foo",
      spawn,
    });

    expect(isOk(result)).toBe(true);
    expect(calls).toEqual([
      { cmd: ["claude"], cwd: "/Users/alex/Projects/foo" },
    ]);
  });

  test("splits multi-word tool commands into argv", async () => {
    const { calls, spawn } = makeSpawn({ exitCode: 0 });

    const result = await launchAiTool({
      tool: "codex --safe",
      projectPath: "/tmp/x",
      spawn,
    });

    expect(isOk(result)).toBe(true);
    expect(calls).toEqual([{ cmd: ["codex", "--safe"], cwd: "/tmp/x" }]);
  });

  test("returns err when the tool exits non-zero", async () => {
    const { spawn } = makeSpawn({ exitCode: 1 });

    const result = await launchAiTool({
      tool: "claude",
      projectPath: "/tmp/x",
      spawn,
    });

    expect(isErr(result)).toBe(true);
    if (isErr(result)) {
      expect(result.error.message).toContain("exited with code 1");
    }
  });

  test("returns err when spawn throws", async () => {
    const { spawn } = makeSpawn({ throws: new Error("ENOENT: claude") });

    const result = await launchAiTool({
      tool: "claude",
      projectPath: "/tmp/x",
      spawn,
    });

    expect(isErr(result)).toBe(true);
    if (isErr(result)) {
      expect(result.error.message).toContain("ENOENT");
    }
  });

  test("rejects empty tool strings", async () => {
    const { calls, spawn } = makeSpawn({ exitCode: 0 });

    const result = await launchAiTool({
      tool: "",
      projectPath: "/tmp/x",
      spawn,
    });

    expect(isErr(result)).toBe(true);
    expect(calls).toEqual([]);
  });
});
