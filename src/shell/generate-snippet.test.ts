import { describe, expect, test } from "bun:test";

import {
  BEGIN_MARKER,
  END_MARKER,
  generateSnippet,
} from "./generate-snippet.ts";

describe("generateSnippet", () => {
  test("bash snippet defines nook-cd and nook-ai functions", () => {
    const snippet = generateSnippet("bash");
    expect(snippet).toContain("nook-cd()");
    expect(snippet).toContain("nook-ai()");
    expect(snippet).toContain(`cd "$(nook cd "$1")"`);
    expect(snippet).toContain("nook config get ai.default");
  });

  test("zsh snippet is identical to bash (POSIX-compatible functions)", () => {
    expect(generateSnippet("zsh")).toBe(generateSnippet("bash"));
  });

  test("fish snippet uses function/end blocks and $argv", () => {
    const snippet = generateSnippet("fish");
    expect(snippet).toContain("function nook-cd");
    expect(snippet).toContain("function nook-ai");
    expect(snippet).toContain("$argv[1]");
    expect(snippet).toContain("end");
  });

  test("powershell snippet uses Set-Location and $args[0]", () => {
    const snippet = generateSnippet("powershell");
    expect(snippet).toContain("function nook-cd");
    expect(snippet).toContain("function nook-ai");
    expect(snippet).toContain("Set-Location");
    expect(snippet).toContain("$args[0]");
  });

  test("every snippet starts with BEGIN_MARKER and ends with END_MARKER", () => {
    for (const shell of ["bash", "zsh", "fish", "powershell"] as const) {
      const snippet = generateSnippet(shell);
      expect(snippet.startsWith(BEGIN_MARKER)).toBe(true);
      expect(snippet.trimEnd().endsWith(END_MARKER)).toBe(true);
    }
  });

  test("every snippet ends with a single trailing newline", () => {
    for (const shell of ["bash", "zsh", "fish", "powershell"] as const) {
      const snippet = generateSnippet(shell);
      expect(snippet.endsWith("\n")).toBe(true);
      expect(snippet.endsWith("\n\n")).toBe(false);
    }
  });

  test("BEGIN_MARKER and END_MARKER are comment lines", () => {
    expect(BEGIN_MARKER.startsWith("#")).toBe(true);
    expect(END_MARKER.startsWith("#")).toBe(true);
  });

  test("snippets for different shells differ in body", () => {
    const bash = generateSnippet("bash");
    const fish = generateSnippet("fish");
    const ps = generateSnippet("powershell");
    expect(bash).not.toBe(fish);
    expect(bash).not.toBe(ps);
    expect(fish).not.toBe(ps);
  });
});
