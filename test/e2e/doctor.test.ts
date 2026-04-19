import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

import {
  closeIndex,
  openIndex,
  queryProjects,
  upsertProject,
} from "../../src/storage/project-index.ts";
import {
  buildBinaryOnce,
  createIsolatedEnv,
  destroyIsolatedEnv,
  runNook,
  seedConfig,
  type IsolatedEnv,
} from "./_harness.ts";

let iso: IsolatedEnv;
const ORPHAN_ID = "01HZZZZZZZZZZZZZZZZZZZZZZZ";

beforeAll(async () => {
  await buildBinaryOnce();
  iso = await createIsolatedEnv("doctor");
  await seedConfig(iso, { categories: { active: {} } });

  const sourceDir = join(iso.scratchDir, "source", "foo");
  await mkdir(sourceDir, { recursive: true });
  await writeFile(join(sourceDir, "README.md"), "hello\n");
  const adopt = await runNook(
    ["adopt", sourceDir, "--category", "active"],
    { env: iso.env },
  );
  if (adopt.code !== 0) {
    throw new Error(`adopt failed: ${adopt.stderr}`);
  }

  const indexResult = openIndex(iso.indexPath);
  if (!indexResult.ok) throw indexResult.error;
  const now = Date.now();
  const upsert = upsertProject(indexResult.value, {
    id: ORPHAN_ID,
    name: "ghost",
    path: join(iso.projectRoot, "active", "ghost"),
    category: "active",
    state: "active",
    last_touched: now,
    last_scanned: now,
    created_at: now,
    paused_until: null,
    scratch: false,
  });
  if (!upsert.ok) throw upsert.error;
  closeIndex(indexResult.value);
});

afterAll(async () => {
  await destroyIsolatedEnv(iso);
});

test("nook doctor reports the orphan index row", async () => {
  const result = await runNook(["doctor"], { env: iso.env });
  expect(result.stdout + result.stderr).toContain("orphan_index_row");
});

test("nook doctor --fix removes the orphan index row", async () => {
  const result = await runNook(["doctor", "--fix"], { env: iso.env });
  expect(result.code).toBe(0);
  expect(result.stdout + result.stderr).toContain("Applied fixes");

  const indexResult = openIndex(iso.indexPath);
  if (!indexResult.ok) throw indexResult.error;
  try {
    const rows = queryProjects(indexResult.value);
    if (!rows.ok) throw rows.error;
    const ids = rows.value.map((r) => r.id);
    expect(ids).not.toContain(ORPHAN_ID);
  } finally {
    closeIndex(indexResult.value);
  }
});
