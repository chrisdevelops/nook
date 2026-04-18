import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  access,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { isErr, isOk } from "../core/result.ts";
import { FilesystemError } from "../errors/filesystem-error.ts";
import { moveProject } from "./move-project.ts";

const exists = async (path: string): Promise<boolean> => {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
};

const populateProject = async (projectDir: string): Promise<void> => {
  await mkdir(join(projectDir, ".nook"), { recursive: true });
  await writeFile(join(projectDir, ".nook", "project.jsonc"), "{\"id\":\"x\"}");
  await writeFile(join(projectDir, "README.md"), "hello");
  await mkdir(join(projectDir, "src"), { recursive: true });
  await writeFile(join(projectDir, "src", "index.ts"), "export {}");
};

describe("moveProject", () => {
  let workdir: string;

  beforeEach(async () => {
    workdir = await mkdtemp(join(tmpdir(), "nook-move-"));
  });

  afterEach(async () => {
    await rm(workdir, { recursive: true, force: true });
  });

  test("moves the project directory tree from source to destination", async () => {
    const source = join(workdir, "project");
    const destination = join(workdir, "moved");
    await populateProject(source);

    const result = await moveProject({ source, destination });
    expect(isOk(result)).toBe(true);

    expect(await exists(source)).toBe(false);
    expect(await exists(destination)).toBe(true);
    expect(
      await readFile(join(destination, "README.md"), "utf8"),
    ).toBe("hello");
    expect(
      await readFile(join(destination, ".nook", "project.jsonc"), "utf8"),
    ).toBe("{\"id\":\"x\"}");
    expect(
      await readFile(join(destination, "src", "index.ts"), "utf8"),
    ).toBe("export {}");
  });

  test("creates missing parent directories for the destination", async () => {
    const source = join(workdir, "project");
    const destination = join(workdir, "client", "shipped", "project");
    await populateProject(source);

    const result = await moveProject({ source, destination });
    expect(isOk(result)).toBe(true);

    expect(await exists(destination)).toBe(true);
    expect(
      await readFile(join(destination, "README.md"), "utf8"),
    ).toBe("hello");
  });

  test("returns FilesystemError when the destination already exists and leaves the source in place", async () => {
    const source = join(workdir, "project");
    const destination = join(workdir, "occupied");
    await populateProject(source);
    await mkdir(destination, { recursive: true });
    await writeFile(join(destination, "keepme.txt"), "dont overwrite");

    const result = await moveProject({ source, destination });
    expect(isErr(result)).toBe(true);
    if (isErr(result)) {
      expect(result.error).toBeInstanceOf(FilesystemError);
      expect((result.error as FilesystemError).path).toBe(destination);
    }

    expect(await exists(source)).toBe(true);
    expect(
      await readFile(join(source, "README.md"), "utf8"),
    ).toBe("hello");
    expect(
      await readFile(join(destination, "keepme.txt"), "utf8"),
    ).toBe("dont overwrite");
  });

  test("returns FilesystemError when the source does not exist", async () => {
    const result = await moveProject({
      source: join(workdir, "missing"),
      destination: join(workdir, "dest"),
    });

    expect(isErr(result)).toBe(true);
    if (isErr(result)) {
      expect(result.error).toBeInstanceOf(FilesystemError);
      expect((result.error as FilesystemError).path).toBe(
        join(workdir, "missing"),
      );
    }

    expect(await exists(join(workdir, "dest"))).toBe(false);
  });

  test("is a no-op (ok) when source and destination refer to the same path", async () => {
    const source = join(workdir, "project");
    await populateProject(source);

    const result = await moveProject({ source, destination: source });
    expect(isOk(result)).toBe(true);
    expect(
      await readFile(join(source, "README.md"), "utf8"),
    ).toBe("hello");
  });

  test("rolls back partial destination when the copy fallback fails partway", async () => {
    const source = join(workdir, "project");
    const destination = join(workdir, "dest");
    await populateProject(source);

    // Simulate a cross-device rename failing, then copy failing too.
    const failingRename = async () => {
      const err = new Error("cross-device move");
      (err as NodeJS.ErrnoException).code = "EXDEV";
      throw err;
    };
    const failingCopy = async () => {
      throw new Error("disk full");
    };

    const result = await moveProject({
      source,
      destination,
      rename: failingRename,
      copy: failingCopy,
    });

    expect(isErr(result)).toBe(true);
    if (isErr(result)) {
      expect(result.error).toBeInstanceOf(FilesystemError);
    }

    expect(await exists(source)).toBe(true);
    expect(await exists(destination)).toBe(false);
  });

  test("uses the cp + rm fallback when rename reports a cross-device error", async () => {
    const source = join(workdir, "project");
    const destination = join(workdir, "moved");
    await populateProject(source);

    let renameCalls = 0;
    const failingRename = async () => {
      renameCalls += 1;
      const err = new Error("cross-device move");
      (err as NodeJS.ErrnoException).code = "EXDEV";
      throw err;
    };

    const result = await moveProject({
      source,
      destination,
      rename: failingRename,
    });

    expect(isOk(result)).toBe(true);
    expect(renameCalls).toBe(1);

    expect(await exists(source)).toBe(false);
    const entries = await readdir(destination);
    expect(entries.sort()).toEqual([".nook", "README.md", "src"]);
  });
});
