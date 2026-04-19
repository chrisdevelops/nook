import { afterAll, beforeAll, expect, test } from "bun:test";
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

import {
  buildBinaryOnce,
  createIsolatedEnv,
  destroyIsolatedEnv,
  runNook,
  seedConfig,
  type IsolatedEnv,
} from "./_harness.ts";

let iso: IsolatedEnv;
let sourceDir: string;

beforeAll(async () => {
  await buildBinaryOnce();
  iso = await createIsolatedEnv("adopt-archive");
  await seedConfig(iso, { categories: { active: {} } });

  sourceDir = join(iso.scratchDir, "source", "legacy");
  await mkdir(sourceDir, { recursive: true });
  await writeFile(join(sourceDir, "README.md"), "pre-existing content\n");
});

afterAll(async () => {
  await destroyIsolatedEnv(iso);
});

const pathExists = async (path: string): Promise<boolean> => {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
};

test("nook adopt moves the source folder under the chosen category", async () => {
  const result = await runNook(
    ["adopt", sourceDir, "--category", "active"],
    { env: iso.env },
  );
  expect(result.code).toBe(0);
  expect(result.stdout + result.stderr).toContain("Adopted 'legacy'");

  const destination = join(iso.projectRoot, "active", "legacy");
  expect(await pathExists(destination)).toBe(true);
  expect(await pathExists(sourceDir)).toBe(false);
  expect(await pathExists(join(destination, "README.md"))).toBe(true);
  expect(await pathExists(join(destination, ".nook", "project.jsonc"))).toBe(
    true,
  );
});

test("nook archive --yes moves the project under archived/ and updates state", async () => {
  const result = await runNook(["archive", "legacy", "--yes"], {
    env: iso.env,
  });
  expect(result.code).toBe(0);
  expect(result.stdout + result.stderr).toContain("Archived 'legacy'");

  const archivedPath = join(iso.projectRoot, "active", "archived", "legacy");
  const originalPath = join(iso.projectRoot, "active", "legacy");
  expect(await pathExists(archivedPath)).toBe(true);
  expect(await pathExists(originalPath)).toBe(false);

  const metadata = JSON.parse(
    await readFile(join(archivedPath, ".nook", "project.jsonc"), "utf8"),
  );
  expect(metadata.state).toBe("archived");
});
