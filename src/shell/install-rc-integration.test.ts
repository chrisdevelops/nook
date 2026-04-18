import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { appendFile, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { isErr, isOk } from "../core/result.ts";
import { generateSnippet } from "./generate-snippet.ts";
import { installRcIntegration } from "./install-rc-integration.ts";

describe("installRcIntegration", () => {
  let workdir: string;

  beforeEach(async () => {
    workdir = await mkdtemp(join(tmpdir(), "nook-rc-"));
  });

  afterEach(async () => {
    await rm(workdir, { recursive: true, force: true });
  });

  test("creates the rc file when it does not exist", async () => {
    const rcPath = join(workdir, ".zshrc");
    const snippet = generateSnippet("zsh");

    const result = await installRcIntegration({ rcPath, snippet });

    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      expect(result.value).toBe("installed");
    }
    const content = await readFile(rcPath, "utf8");
    expect(content).toContain(snippet);
  });

  test("appends snippet to an existing file, preserving prior contents", async () => {
    const rcPath = join(workdir, ".zshrc");
    const priorContent = "export FOO=bar\nalias ll='ls -la'\n";
    await writeFile(rcPath, priorContent, "utf8");
    const snippet = generateSnippet("zsh");

    const result = await installRcIntegration({ rcPath, snippet });

    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      expect(result.value).toBe("installed");
    }
    const content = await readFile(rcPath, "utf8");
    expect(content.startsWith(priorContent)).toBe(true);
    expect(content).toContain(snippet);
  });

  test("returns 'unchanged' when the marker block is already present", async () => {
    const rcPath = join(workdir, ".zshrc");
    const snippet = generateSnippet("zsh");
    const priorContent = `existing line\n\n${snippet}`;
    await writeFile(rcPath, priorContent, "utf8");

    const result = await installRcIntegration({ rcPath, snippet });

    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      expect(result.value).toBe("unchanged");
    }
    const content = await readFile(rcPath, "utf8");
    expect(content).toBe(priorContent);
  });

  test("leaves a drifted block alone and reports 'unchanged' (append-only is safe by design)", async () => {
    const rcPath = join(workdir, ".zshrc");
    const stale =
      "# >>> nook shell integration >>>\nold stale body\n# <<< nook shell integration <<<\n";
    const before = `before\n${stale}after\n`;
    await writeFile(rcPath, before, "utf8");
    const snippet = generateSnippet("zsh");

    const result = await installRcIntegration({ rcPath, snippet });

    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      expect(result.value).toBe("unchanged");
    }
    const content = await readFile(rcPath, "utf8");
    expect(content).toBe(before);
    expect(content).toContain("old stale body");
  });

  test("running twice in a row is idempotent and returns 'unchanged' the second time", async () => {
    const rcPath = join(workdir, ".bashrc");
    const snippet = generateSnippet("bash");

    const first = await installRcIntegration({ rcPath, snippet });
    const second = await installRcIntegration({ rcPath, snippet });

    expect(isOk(first)).toBe(true);
    if (isOk(first)) expect(first.value).toBe("installed");
    expect(isOk(second)).toBe(true);
    if (isOk(second)) expect(second.value).toBe("unchanged");

    const content = await readFile(rcPath, "utf8");
    const occurrences = content.split(snippet).length - 1;
    expect(occurrences).toBe(1);
  });

  test("returns err when the rc file's parent directory does not exist", async () => {
    const rcPath = join(workdir, "nested", "missing", ".zshrc");
    const snippet = generateSnippet("zsh");

    const result = await installRcIntegration({ rcPath, snippet });

    expect(isErr(result)).toBe(true);
  });

  test("ensures a single newline precedes the snippet when appending to a file without one", async () => {
    const rcPath = join(workdir, ".zshrc");
    await writeFile(rcPath, "last line without newline", "utf8");
    const snippet = generateSnippet("zsh");

    const result = await installRcIntegration({ rcPath, snippet });

    expect(isOk(result)).toBe(true);
    const content = await readFile(rcPath, "utf8");
    expect(content).toContain("last line without newline\n");
    expect(content).toContain(snippet);
  });

  test("preserves file inode when appending (no atomic rename / overwrite)", async () => {
    const rcPath = join(workdir, ".zshrc");
    await writeFile(rcPath, "line one\nline two\n", "utf8");
    const before = await stat(rcPath);
    const snippet = generateSnippet("zsh");

    const result = await installRcIntegration({ rcPath, snippet });
    expect(isOk(result)).toBe(true);

    const after = await stat(rcPath);
    expect(after.ino).toBe(before.ino);
  });

  test("does not lose unrelated content appended between two install runs", async () => {
    const rcPath = join(workdir, ".zshrc");
    const snippet = generateSnippet("zsh");

    const first = await installRcIntegration({ rcPath, snippet });
    expect(isOk(first)).toBe(true);

    await appendFile(rcPath, "# added by user after install\nexport LATE=1\n");

    const second = await installRcIntegration({ rcPath, snippet });
    expect(isOk(second)).toBe(true);
    if (isOk(second)) expect(second.value).toBe("unchanged");

    const content = await readFile(rcPath, "utf8");
    expect(content).toContain("# added by user after install");
    expect(content).toContain("export LATE=1");
    expect(content).toContain(snippet);
  });
});
