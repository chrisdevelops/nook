import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { isErr, isOk } from "../core/result.ts";
import { FilesystemError } from "../errors/filesystem-error.ts";
import { discoverProjects } from "./discover-projects.ts";

const makeProject = async (
  projectDir: string,
  metadata: Record<string, unknown> = {},
): Promise<void> => {
  await mkdir(join(projectDir, ".nook"), { recursive: true });
  await writeFile(
    join(projectDir, ".nook", "project.jsonc"),
    JSON.stringify(metadata),
  );
};

describe("discoverProjects", () => {
  let workdir: string;

  beforeEach(async () => {
    workdir = await mkdtemp(join(tmpdir(), "nook-discover-"));
  });

  afterEach(async () => {
    await rm(workdir, { recursive: true, force: true });
  });

  test("returns an empty list for an empty root", async () => {
    const result = await discoverProjects(workdir);
    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      expect(result.value).toEqual([]);
    }
  });

  test("returns sorted absolute paths of direct-child projects", async () => {
    await makeProject(join(workdir, "beta"));
    await makeProject(join(workdir, "alpha"));

    const result = await discoverProjects(workdir);
    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      expect(result.value).toEqual([
        join(workdir, "alpha"),
        join(workdir, "beta"),
      ]);
    }
  });

  test("discovers projects nested inside category folders", async () => {
    await makeProject(join(workdir, "lab", "spike"));
    await makeProject(join(workdir, "client", "atlas"));
    await makeProject(join(workdir, "client", "shipped", "old-site"));
    await makeProject(join(workdir, "oss", "archived", "retired"));

    const result = await discoverProjects(workdir);
    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      expect(result.value).toEqual([
        join(workdir, "client", "atlas"),
        join(workdir, "client", "shipped", "old-site"),
        join(workdir, "lab", "spike"),
        join(workdir, "oss", "archived", "retired"),
      ]);
    }
  });

  test("does not descend into a project to look for nested projects", async () => {
    await makeProject(join(workdir, "outer"));
    await makeProject(join(workdir, "outer", "inner"));

    const result = await discoverProjects(workdir);
    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      expect(result.value).toEqual([join(workdir, "outer")]);
    }
  });

  test("skips hidden directories (names starting with a dot)", async () => {
    await makeProject(join(workdir, "visible"));
    await mkdir(join(workdir, ".Trashes"), { recursive: true });
    await writeFile(join(workdir, ".Trashes", "junk"), "x");
    await mkdir(join(workdir, ".local", "share"), { recursive: true });

    const result = await discoverProjects(workdir);
    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      expect(result.value).toEqual([join(workdir, "visible")]);
    }
  });

  test("skips symlinked directories to avoid cycles", async () => {
    await makeProject(join(workdir, "real"));
    await symlink(join(workdir, "real"), join(workdir, "loop"));

    const result = await discoverProjects(workdir);
    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      expect(result.value).toEqual([join(workdir, "real")]);
    }
  });

  test("returns FilesystemError when the root does not exist", async () => {
    const result = await discoverProjects(join(workdir, "nope"));
    expect(isErr(result)).toBe(true);
    if (isErr(result)) {
      expect(result.error).toBeInstanceOf(FilesystemError);
      expect((result.error as FilesystemError).path).toBe(
        join(workdir, "nope"),
      );
    }
  });
});
