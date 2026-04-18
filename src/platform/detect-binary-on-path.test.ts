import { describe, expect, test } from "bun:test";

import { detectBinaryOnPath, type WhichFn } from "./detect-binary-on-path.ts";

describe("detectBinaryOnPath", () => {
  test("returns the path when the binary is on PATH", async () => {
    const which: WhichFn = (cmd) =>
      cmd === "code" ? "/usr/local/bin/code" : null;
    const result = await detectBinaryOnPath("code", { which });
    expect(result).toBe("/usr/local/bin/code");
  });

  test("returns null when the binary is not found", async () => {
    const which: WhichFn = () => null;
    const result = await detectBinaryOnPath("zed", { which });
    expect(result).toBeNull();
  });

  test("trims whitespace from the binary name before lookup", async () => {
    const calls: string[] = [];
    const which: WhichFn = (cmd) => {
      calls.push(cmd);
      return null;
    };
    await detectBinaryOnPath("  code  ", { which });
    expect(calls).toEqual(["code"]);
  });

  test("returns null for empty or whitespace-only names without calling which", async () => {
    let called = false;
    const which: WhichFn = () => {
      called = true;
      return "/bin/x";
    };
    const result = await detectBinaryOnPath("   ", { which });
    expect(result).toBeNull();
    expect(called).toBe(false);
  });
});
