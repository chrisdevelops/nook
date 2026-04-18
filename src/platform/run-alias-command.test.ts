import { describe, expect, test } from "bun:test";

import { isErr, isOk } from "../core/result.ts";
import type { LaunchSpawn } from "./launch-editor.ts";
import {
  runAliasCommand,
  substituteAliasCommand,
  type AliasContext,
} from "./run-alias-command.ts";

const ctx: AliasContext = {
  path: "/Users/alex/Projects/foo",
  name: "foo",
  id: "01HXYZ",
  category: "client",
};

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

describe("substituteAliasCommand", () => {
  test("substitutes all four placeholders", () => {
    const out = substituteAliasCommand("open {path} {name} {id} {category}", ctx);
    expect(out).toBe(
      "open /Users/alex/Projects/foo foo 01HXYZ client",
    );
  });

  test("substitutes multiple occurrences of the same placeholder", () => {
    const out = substituteAliasCommand("echo {name} && cd {path} && echo {name}", ctx);
    expect(out).toBe(
      "echo foo && cd /Users/alex/Projects/foo && echo foo",
    );
  });

  test("leaves unknown placeholders untouched", () => {
    const out = substituteAliasCommand("echo {unknown} {path}", ctx);
    expect(out).toBe("echo {unknown} /Users/alex/Projects/foo");
  });

  test("returns the command unchanged when no placeholders are present", () => {
    const out = substituteAliasCommand("echo hello", ctx);
    expect(out).toBe("echo hello");
  });
});

describe("runAliasCommand", () => {
  test("spawns via sh -c on non-Windows platforms with cwd set to path", async () => {
    const { calls, spawn } = makeSpawn({ exitCode: 0 });

    const result = await runAliasCommand({
      command: "zed {path}",
      context: ctx,
      platform: "linux",
      spawn,
    });

    expect(isOk(result)).toBe(true);
    expect(calls).toEqual([
      {
        cmd: ["sh", "-c", "zed /Users/alex/Projects/foo"],
        cwd: "/Users/alex/Projects/foo",
      },
    ]);
  });

  test("spawns via cmd /c on Windows", async () => {
    const { calls, spawn } = makeSpawn({ exitCode: 0 });

    const result = await runAliasCommand({
      command: "code {path}",
      context: {
        ...ctx,
        path: "C:\\Users\\Alex\\Projects\\foo",
      },
      platform: "win32",
      spawn,
    });

    expect(isOk(result)).toBe(true);
    expect(calls).toEqual([
      {
        cmd: ["cmd", "/c", "code C:\\Users\\Alex\\Projects\\foo"],
        cwd: "C:\\Users\\Alex\\Projects\\foo",
      },
    ]);
  });

  test("substitutes {name}, {id}, and {category} in the spawned command", async () => {
    const { calls, spawn } = makeSpawn({ exitCode: 0 });

    const result = await runAliasCommand({
      command: "tmux new -s {name} -c {path} ; echo {id} {category}",
      context: ctx,
      platform: "darwin",
      spawn,
    });

    expect(isOk(result)).toBe(true);
    expect(calls[0]?.cmd).toEqual([
      "sh",
      "-c",
      "tmux new -s foo -c /Users/alex/Projects/foo ; echo 01HXYZ client",
    ]);
  });

  test("returns err when the underlying command exits non-zero", async () => {
    const { spawn } = makeSpawn({ exitCode: 7 });

    const result = await runAliasCommand({
      command: "false",
      context: ctx,
      platform: "linux",
      spawn,
    });

    expect(isErr(result)).toBe(true);
    if (isErr(result)) {
      expect(result.error.message).toContain("exited with code 7");
    }
  });

  test("returns err when spawn throws", async () => {
    const { spawn } = makeSpawn({ throws: new Error("ENOENT: sh") });

    const result = await runAliasCommand({
      command: "echo hi",
      context: ctx,
      platform: "linux",
      spawn,
    });

    expect(isErr(result)).toBe(true);
    if (isErr(result)) {
      expect(result.error.message).toContain("ENOENT");
    }
  });

  test("rejects an empty command", async () => {
    const { calls, spawn } = makeSpawn({ exitCode: 0 });

    const result = await runAliasCommand({
      command: "   ",
      context: ctx,
      platform: "linux",
      spawn,
    });

    expect(isErr(result)).toBe(true);
    expect(calls).toEqual([]);
  });
});
