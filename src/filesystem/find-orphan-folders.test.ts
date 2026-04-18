import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { findOrphanFolders } from "./find-orphan-folders.ts";

describe("findOrphanFolders", () => {
  let workdir: string;

  beforeEach(async () => {
    workdir = await mkdtemp(join(tmpdir(), "nook-orphans-"));
  });

  afterEach(async () => {
    await rm(workdir, { recursive: true, force: true });
  });

  const makeTracked = async (path: string): Promise<void> => {
    await mkdir(join(path, ".nook"), { recursive: true });
    await writeFile(join(path, ".nook", "project.jsonc"), "{}", "utf8");
  };

  const makeFolder = async (path: string): Promise<void> => {
    await mkdir(path, { recursive: true });
  };

  test("finds untracked folders directly under categories", async () => {
    await makeFolder(join(workdir, "oss", "orphan-one"));
    await makeFolder(join(workdir, "active", "orphan-two"));

    const orphans = await findOrphanFolders(workdir, new Set());

    expect(orphans.length).toBe(2);
    const paths = orphans.map((o) => o.path).sort();
    expect(paths).toEqual(
      [
        join(workdir, "active", "orphan-two"),
        join(workdir, "oss", "orphan-one"),
      ].sort(),
    );
    const ossOrphan = orphans.find((o) => o.category === "oss");
    expect(ossOrphan?.parentSegment).toBeNull();
  });

  test("skips folders that are already tracked", async () => {
    await makeTracked(join(workdir, "oss", "tracked-proj"));
    await makeFolder(join(workdir, "oss", "orphan-proj"));
    const tracked = new Set<string>([join(workdir, "oss", "tracked-proj")]);

    const orphans = await findOrphanFolders(workdir, tracked);

    expect(orphans.length).toBe(1);
    expect(orphans[0]?.path).toBe(join(workdir, "oss", "orphan-proj"));
  });

  test("descends into shipped/ and archived/ subfolders for non-lab categories", async () => {
    await makeFolder(join(workdir, "oss", "shipped", "shipped-orphan"));
    await makeFolder(join(workdir, "oss", "archived", "archived-orphan"));

    const orphans = await findOrphanFolders(workdir, new Set());

    expect(orphans.length).toBe(2);
    const shipped = orphans.find((o) => o.parentSegment === "shipped");
    expect(shipped?.category).toBe("oss");
    expect(shipped?.path).toBe(
      join(workdir, "oss", "shipped", "shipped-orphan"),
    );
    const archived = orphans.find((o) => o.parentSegment === "archived");
    expect(archived?.category).toBe("oss");
    expect(archived?.path).toBe(
      join(workdir, "oss", "archived", "archived-orphan"),
    );
  });

  test("does not treat shipped/ or archived/ as orphans themselves when non-lab", async () => {
    await makeFolder(join(workdir, "oss", "shipped"));
    await makeFolder(join(workdir, "oss", "archived"));

    const orphans = await findOrphanFolders(workdir, new Set());

    expect(orphans.length).toBe(0);
  });

  test("treats 'shipped' folder under lab/ as a regular orphan (lab has no shipped subfolder)", async () => {
    await makeFolder(join(workdir, "lab", "shipped"));

    const orphans = await findOrphanFolders(workdir, new Set());

    expect(orphans.length).toBe(1);
    expect(orphans[0]?.path).toBe(join(workdir, "lab", "shipped"));
    expect(orphans[0]?.category).toBe("lab");
    expect(orphans[0]?.parentSegment).toBeNull();
  });

  test("ignores dotfiles and hidden folders", async () => {
    await makeFolder(join(workdir, "oss", ".hidden"));
    await makeFolder(join(workdir, ".some-tooling"));

    const orphans = await findOrphanFolders(workdir, new Set());

    expect(orphans.length).toBe(0);
  });

  test("returns empty when root is empty", async () => {
    const orphans = await findOrphanFolders(workdir, new Set());
    expect(orphans).toEqual([]);
  });
});
