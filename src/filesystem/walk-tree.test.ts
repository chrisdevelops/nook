import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  mkdir,
  mkdtemp,
  rm,
  symlink,
  utimes,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { isErr, isOk } from "../core/result.ts";
import { FilesystemError } from "../errors/filesystem-error.ts";
import { walkTree } from "./walk-tree.ts";

const setMtime = async (path: string, mtimeMs: number): Promise<void> => {
  const seconds = mtimeMs / 1000;
  await utimes(path, seconds, seconds);
};

describe("walkTree", () => {
  let workdir: string;

  beforeEach(async () => {
    workdir = await mkdtemp(join(tmpdir(), "nook-walk-"));
  });

  afterEach(async () => {
    await rm(workdir, { recursive: true, force: true });
  });

  test("returns empty list for an empty directory", async () => {
    const result = await walkTree(workdir);
    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      expect(result.value).toEqual([]);
    }
  });

  test("returns relative paths and mtimes for files in a flat tree", async () => {
    await writeFile(join(workdir, "a.txt"), "a");
    await writeFile(join(workdir, "b.txt"), "b");
    await setMtime(join(workdir, "a.txt"), 1_700_000_000_000);
    await setMtime(join(workdir, "b.txt"), 1_700_000_001_000);

    const result = await walkTree(workdir);
    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      const byPath = new Map(result.value.map((f) => [f.path, f.mtimeMs]));
      expect(byPath.get("a.txt")).toBe(1_700_000_000_000);
      expect(byPath.get("b.txt")).toBe(1_700_000_001_000);
      expect(byPath.size).toBe(2);
    }
  });

  test("recurses into subdirectories with forward-slash relative paths", async () => {
    await mkdir(join(workdir, "src", "nested"), { recursive: true });
    await writeFile(join(workdir, "src", "a.ts"), "a");
    await writeFile(join(workdir, "src", "nested", "b.ts"), "b");

    const result = await walkTree(workdir);
    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      const paths = result.value.map((f) => f.path).sort();
      expect(paths).toEqual(["src/a.ts", "src/nested/b.ts"]);
    }
  });

  test("skips the .git directory by default", async () => {
    await mkdir(join(workdir, ".git", "objects"), { recursive: true });
    await writeFile(join(workdir, ".git", "HEAD"), "ref: refs/heads/main");
    await writeFile(join(workdir, ".git", "objects", "pack"), "binary");
    await writeFile(join(workdir, "src.ts"), "src");

    const result = await walkTree(workdir);
    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      const paths = result.value.map((f) => f.path);
      expect(paths).toEqual(["src.ts"]);
    }
  });

  test("skips the .nook directory by default", async () => {
    await mkdir(join(workdir, ".nook"), { recursive: true });
    await writeFile(join(workdir, ".nook", "project.jsonc"), "{}");
    await writeFile(join(workdir, "README.md"), "hi");

    const result = await walkTree(workdir);
    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      const paths = result.value.map((f) => f.path);
      expect(paths).toEqual(["README.md"]);
    }
  });

  test("applies the ignores predicate to skip files and directories", async () => {
    await mkdir(join(workdir, "node_modules", "pkg"), { recursive: true });
    await writeFile(join(workdir, "node_modules", "pkg", "index.js"), "x");
    await writeFile(join(workdir, "src.ts"), "y");
    await writeFile(join(workdir, "ignore-me.log"), "z");

    const ignores = (relativePath: string): boolean =>
      relativePath === "node_modules" ||
      relativePath.startsWith("node_modules/") ||
      relativePath.endsWith(".log");

    const result = await walkTree(workdir, { ignores });
    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      const paths = result.value.map((f) => f.path);
      expect(paths).toEqual(["src.ts"]);
    }
  });

  test("does not follow symlinks (neither files nor directories)", async () => {
    await mkdir(join(workdir, "real"), { recursive: true });
    await writeFile(join(workdir, "real", "inside.txt"), "x");
    await writeFile(join(workdir, "actual.txt"), "y");
    await symlink(join(workdir, "actual.txt"), join(workdir, "link.txt"));
    await symlink(join(workdir, "real"), join(workdir, "linkdir"));

    const result = await walkTree(workdir);
    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      const paths = result.value.map((f) => f.path).sort();
      expect(paths).toEqual(["actual.txt", "real/inside.txt"]);
    }
  });

  test("returns FilesystemError when the root does not exist", async () => {
    const result = await walkTree(join(workdir, "does-not-exist"));
    expect(isErr(result)).toBe(true);
    if (isErr(result)) {
      expect(result.error).toBeInstanceOf(FilesystemError);
      expect((result.error as FilesystemError).path).toBe(
        join(workdir, "does-not-exist"),
      );
    }
  });
});
