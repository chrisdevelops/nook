import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { isErr, isOk } from "../core/result.ts";
import { FilesystemError } from "../errors/filesystem-error.ts";
import {
  closeIndex,
  DEFAULT_INDEX_TTL_MS,
  isIndexRowStale,
  markScanned,
  openIndex,
  type ProjectIndexFilters,
  type ProjectIndexRow,
  queryProjects,
  rebuildFromMetadata,
  upsertProject,
} from "./project-index.ts";

const sampleRow = (overrides: Partial<ProjectIndexRow> = {}): ProjectIndexRow => ({
  id: "01HR7N9F6C3K6V7XYZAAAAAAAA",
  name: "example",
  path: "/Users/me/Projects/active/example",
  category: "active",
  state: "active",
  last_touched: 1_700_000_000_000,
  last_scanned: 1_700_000_000_000,
  created_at: 1_699_000_000_000,
  paused_until: null,
  scratch: false,
  ...overrides,
});

describe("openIndex", () => {
  let workdir: string;

  beforeEach(async () => {
    workdir = await mkdtemp(join(tmpdir(), "nook-index-open-"));
  });

  afterEach(async () => {
    await rm(workdir, { recursive: true, force: true });
  });

  test("creates the database file at the given path", async () => {
    const dbPath = join(workdir, "index.sqlite");
    const result = openIndex(dbPath);
    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      closeIndex(result.value);
    }
    const entries = await readdir(workdir);
    expect(entries).toContain("index.sqlite");
  });

  test("creates missing parent directories", async () => {
    const dbPath = join(workdir, "deep", "nested", "state", "index.sqlite");
    const result = openIndex(dbPath);
    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      closeIndex(result.value);
    }
    const entries = await readdir(join(workdir, "deep", "nested", "state"));
    expect(entries).toContain("index.sqlite");
  });

  test("creates the projects table with expected columns", () => {
    const dbPath = join(workdir, "index.sqlite");
    const result = openIndex(dbPath);
    expect(isOk(result)).toBe(true);
    if (!isOk(result)) return;

    const columns = result.value
      .query<{ name: string; type: string; notnull: 0 | 1; pk: 0 | 1 }, []>(
        "PRAGMA table_info(projects)",
      )
      .all();

    const byName = new Map(columns.map((c) => [c.name, c] as const));
    expect(byName.get("id")?.pk).toBe(1);
    expect(byName.get("name")?.notnull).toBe(1);
    expect(byName.get("path")?.notnull).toBe(1);
    expect(byName.get("category")?.notnull).toBe(1);
    expect(byName.get("state")?.notnull).toBe(1);
    expect(byName.get("last_touched")?.notnull).toBe(1);
    expect(byName.get("last_scanned")?.notnull).toBe(1);
    expect(byName.get("created_at")?.notnull).toBe(1);
    expect(byName.has("paused_until")).toBe(true);
    expect(byName.get("scratch")?.notnull).toBe(1);

    closeIndex(result.value);
  });

  test("creates indexes on state, category, and last_touched", () => {
    const dbPath = join(workdir, "index.sqlite");
    const result = openIndex(dbPath);
    expect(isOk(result)).toBe(true);
    if (!isOk(result)) return;

    const indexes = result.value
      .query<{ name: string }, []>(
        "SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'projects'",
      )
      .all()
      .map((r) => r.name);

    expect(indexes).toContain("idx_projects_state");
    expect(indexes).toContain("idx_projects_category");
    expect(indexes).toContain("idx_projects_last_touched");

    closeIndex(result.value);
  });

  test("migrations are idempotent — opening twice preserves data", () => {
    const dbPath = join(workdir, "index.sqlite");
    const first = openIndex(dbPath);
    expect(isOk(first)).toBe(true);
    if (!isOk(first)) return;
    const upserted = upsertProject(first.value, sampleRow());
    expect(isOk(upserted)).toBe(true);
    closeIndex(first.value);

    const second = openIndex(dbPath);
    expect(isOk(second)).toBe(true);
    if (!isOk(second)) return;
    const count = second.value
      .query<{ n: number }, []>("SELECT COUNT(*) AS n FROM projects")
      .get();
    expect(count?.n).toBe(1);
    closeIndex(second.value);
  });

  test("returns FilesystemError when the db path is not writable", () => {
    // A directory that collides with the requested file path forces the open
    // to fail in a portable way (no permission assumptions).
    const dbPath = join(workdir, "index.sqlite");
    // Re-use Bun.write via node fs to make dbPath a directory.
    // We simulate collision by creating a directory at dbPath beforehand.
    // Use sync to avoid async setup in a sync test.
    const { mkdirSync } = require("node:fs") as typeof import("node:fs");
    mkdirSync(dbPath);
    const result = openIndex(dbPath);
    expect(isErr(result)).toBe(true);
    if (isErr(result)) {
      expect(result.error).toBeInstanceOf(FilesystemError);
    }
  });
});

describe("upsertProject", () => {
  let workdir: string;
  let db: Database;

  beforeEach(async () => {
    workdir = await mkdtemp(join(tmpdir(), "nook-index-upsert-"));
    const opened = openIndex(join(workdir, "index.sqlite"));
    if (!isOk(opened)) throw new Error("failed to open test db");
    db = opened.value;
  });

  afterEach(async () => {
    closeIndex(db);
    await rm(workdir, { recursive: true, force: true });
  });

  test("inserts a new row and round-trips every field", () => {
    const row = sampleRow({
      paused_until: 1_701_000_000_000,
      scratch: true,
    });
    const result = upsertProject(db, row);
    expect(isOk(result)).toBe(true);

    const loaded = db
      .query<ProjectIndexRow, [string]>("SELECT * FROM projects WHERE id = ?")
      .get(row.id);
    expect(loaded).toEqual({
      ...row,
      scratch: 1 as unknown as boolean, // SQLite stores booleans as 0/1
    });
  });

  test("replaces the row on conflicting id", () => {
    upsertProject(db, sampleRow({ state: "incubating", name: "before" }));
    const replaced = upsertProject(
      db,
      sampleRow({ state: "active", name: "after", last_touched: 1_800_000_000_000 }),
    );
    expect(isOk(replaced)).toBe(true);

    const rows = db
      .query<{ name: string; state: string; last_touched: number }, []>(
        "SELECT name, state, last_touched FROM projects",
      )
      .all();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toEqual({
      name: "after",
      state: "active",
      last_touched: 1_800_000_000_000,
    });
  });

  test("stores paused_until as NULL when not provided", () => {
    upsertProject(db, sampleRow({ paused_until: null }));
    const loaded = db
      .query<{ paused_until: number | null }, []>(
        "SELECT paused_until FROM projects",
      )
      .get();
    expect(loaded?.paused_until).toBeNull();
  });
});

const seedRows = (db: Database): readonly ProjectIndexRow[] => {
  const rows: readonly ProjectIndexRow[] = [
    sampleRow({
      id: "01HR7N9F6C3K6V7XYZAAAAAAAA",
      name: "alpha",
      category: "active",
      state: "active",
      last_touched: 1_000,
      scratch: false,
    }),
    sampleRow({
      id: "01HR7N9F6C3K6V7XYZBBBBBBBB",
      name: "beta",
      category: "lab",
      state: "incubating",
      last_touched: 2_000,
      scratch: true,
    }),
    sampleRow({
      id: "01HR7N9F6C3K6V7XYZCCCCCCCC",
      name: "gamma",
      category: "active",
      state: "paused",
      last_touched: 3_000,
      paused_until: 9_999_999_999_999,
      scratch: false,
    }),
    sampleRow({
      id: "01HR7N9F6C3K6V7XYZDDDDDDDD",
      name: "delta",
      category: "oss",
      state: "archived",
      last_touched: 4_000,
      scratch: false,
    }),
  ];
  for (const row of rows) {
    const result = upsertProject(db, row);
    if (!isOk(result)) throw new Error("seed upsert failed");
  }
  return rows;
};

describe("queryProjects", () => {
  let workdir: string;
  let db: Database;

  beforeEach(async () => {
    workdir = await mkdtemp(join(tmpdir(), "nook-index-query-"));
    const opened = openIndex(join(workdir, "index.sqlite"));
    if (!isOk(opened)) throw new Error("failed to open test db");
    db = opened.value;
    seedRows(db);
  });

  afterEach(async () => {
    closeIndex(db);
    await rm(workdir, { recursive: true, force: true });
  });

  const idsOf = (rows: readonly ProjectIndexRow[]): readonly string[] =>
    rows.map((r) => r.id).toSorted();

  test("returns all rows when no filters are given", () => {
    const result = queryProjects(db);
    expect(isOk(result)).toBe(true);
    if (!isOk(result)) return;
    expect(result.value).toHaveLength(4);
  });

  test("round-trips ProjectIndexRow shape (booleans + nullable paused_until)", () => {
    const result = queryProjects(db, { state: "incubating" });
    expect(isOk(result)).toBe(true);
    if (!isOk(result)) return;
    expect(result.value).toHaveLength(1);
    const beta = result.value[0];
    expect(beta?.scratch).toBe(true);
    expect(beta?.paused_until).toBeNull();
    expect(beta?.state).toBe("incubating");

    const paused = queryProjects(db, { state: "paused" });
    if (!isOk(paused)) return;
    expect(paused.value[0]?.paused_until).toBe(9_999_999_999_999);
    expect(paused.value[0]?.scratch).toBe(false);
  });

  test("filters by a single state", () => {
    const result = queryProjects(db, { state: "active" });
    if (!isOk(result)) return;
    expect(idsOf(result.value)).toEqual(["01HR7N9F6C3K6V7XYZAAAAAAAA"]);
  });

  test("filters by an array of states", () => {
    const result = queryProjects(db, { state: ["active", "paused"] });
    if (!isOk(result)) return;
    expect(idsOf(result.value)).toEqual([
      "01HR7N9F6C3K6V7XYZAAAAAAAA",
      "01HR7N9F6C3K6V7XYZCCCCCCCC",
    ]);
  });

  test("filters by category (single and array)", () => {
    const single = queryProjects(db, { category: "active" });
    if (!isOk(single)) return;
    expect(idsOf(single.value)).toEqual([
      "01HR7N9F6C3K6V7XYZAAAAAAAA",
      "01HR7N9F6C3K6V7XYZCCCCCCCC",
    ]);

    const multi = queryProjects(db, { category: ["lab", "oss"] });
    if (!isOk(multi)) return;
    expect(idsOf(multi.value)).toEqual([
      "01HR7N9F6C3K6V7XYZBBBBBBBB",
      "01HR7N9F6C3K6V7XYZDDDDDDDD",
    ]);
  });

  test("filters by last_touched boundaries (inclusive after, inclusive before)", () => {
    const after = queryProjects(db, { lastTouchedAfter: 3_000 });
    if (!isOk(after)) return;
    expect(idsOf(after.value)).toEqual([
      "01HR7N9F6C3K6V7XYZCCCCCCCC",
      "01HR7N9F6C3K6V7XYZDDDDDDDD",
    ]);

    const before = queryProjects(db, { lastTouchedBefore: 2_000 });
    if (!isOk(before)) return;
    expect(idsOf(before.value)).toEqual([
      "01HR7N9F6C3K6V7XYZAAAAAAAA",
      "01HR7N9F6C3K6V7XYZBBBBBBBB",
    ]);
  });

  test("combines multiple filters with AND semantics", () => {
    const filters: ProjectIndexFilters = {
      category: "active",
      state: ["active", "paused"],
      lastTouchedAfter: 2_500,
    };
    const result = queryProjects(db, filters);
    if (!isOk(result)) return;
    expect(idsOf(result.value)).toEqual(["01HR7N9F6C3K6V7XYZCCCCCCCC"]);
  });

  test("returns an empty array when an array filter is empty", () => {
    const result = queryProjects(db, { state: [] });
    if (!isOk(result)) return;
    expect(result.value).toEqual([]);
  });
});

describe("markScanned", () => {
  let workdir: string;
  let db: Database;

  beforeEach(async () => {
    workdir = await mkdtemp(join(tmpdir(), "nook-index-scanned-"));
    const opened = openIndex(join(workdir, "index.sqlite"));
    if (!isOk(opened)) throw new Error("failed to open test db");
    db = opened.value;
  });

  afterEach(async () => {
    closeIndex(db);
    await rm(workdir, { recursive: true, force: true });
  });

  test("updates last_scanned for the given id without touching other fields", () => {
    const row = sampleRow({ last_scanned: 1_000, last_touched: 500 });
    upsertProject(db, row);
    const result = markScanned(db, row.id, 9_999);
    expect(isOk(result)).toBe(true);

    const loaded = db
      .query<
        { last_scanned: number; last_touched: number; name: string },
        [string]
      >("SELECT last_scanned, last_touched, name FROM projects WHERE id = ?")
      .get(row.id);
    expect(loaded).toEqual({
      last_scanned: 9_999,
      last_touched: 500,
      name: row.name,
    });
  });

  test("is a no-op (ok) when the id is unknown", () => {
    const result = markScanned(db, "01HR7N9F6C3K6V7XYZZZZZZZZZ", 1);
    expect(isOk(result)).toBe(true);
    const count = db
      .query<{ n: number }, []>("SELECT COUNT(*) AS n FROM projects")
      .get();
    expect(count?.n).toBe(0);
  });
});

describe("rebuildFromMetadata", () => {
  let workdir: string;
  let db: Database;

  beforeEach(async () => {
    workdir = await mkdtemp(join(tmpdir(), "nook-index-rebuild-"));
    const opened = openIndex(join(workdir, "index.sqlite"));
    if (!isOk(opened)) throw new Error("failed to open test db");
    db = opened.value;
  });

  afterEach(async () => {
    closeIndex(db);
    await rm(workdir, { recursive: true, force: true });
  });

  test("wipes existing rows and replaces with the provided rows", () => {
    seedRows(db);
    const replacement: readonly ProjectIndexRow[] = [
      sampleRow({
        id: "01HR7N9F6C3K6V7XYZEEEEEEEE",
        name: "epsilon",
        category: "oss",
        state: "shipped",
      }),
    ];
    const result = rebuildFromMetadata(db, replacement);
    expect(isOk(result)).toBe(true);

    const ids = db
      .query<{ id: string }, []>("SELECT id FROM projects ORDER BY id")
      .all()
      .map((r) => r.id);
    expect(ids).toEqual(["01HR7N9F6C3K6V7XYZEEEEEEEE"]);
  });

  test("leaves the table empty when given an empty rows list", () => {
    seedRows(db);
    const result = rebuildFromMetadata(db, []);
    expect(isOk(result)).toBe(true);

    const count = db
      .query<{ n: number }, []>("SELECT COUNT(*) AS n FROM projects")
      .get();
    expect(count?.n).toBe(0);
  });

  test("TTL default is five minutes", () => {
    expect(DEFAULT_INDEX_TTL_MS).toBe(5 * 60 * 1000);
  });

  test("isIndexRowStale returns true when now - last_scanned >= ttl (inclusive boundary)", () => {
    const row = sampleRow({ last_scanned: 1_000 });
    expect(isIndexRowStale(row, 1_000 + DEFAULT_INDEX_TTL_MS, DEFAULT_INDEX_TTL_MS)).toBe(true);
  });

  test("isIndexRowStale returns false when now - last_scanned < ttl", () => {
    const row = sampleRow({ last_scanned: 1_000 });
    expect(
      isIndexRowStale(row, 1_000 + DEFAULT_INDEX_TTL_MS - 1, DEFAULT_INDEX_TTL_MS),
    ).toBe(false);
  });

  test("isIndexRowStale uses DEFAULT_INDEX_TTL_MS when ttl is omitted", () => {
    const row = sampleRow({ last_scanned: 0 });
    expect(isIndexRowStale(row, DEFAULT_INDEX_TTL_MS)).toBe(true);
    expect(isIndexRowStale(row, DEFAULT_INDEX_TTL_MS - 1)).toBe(false);
  });

  test("isIndexRowStale treats a last_scanned in the future as not stale", () => {
    const row = sampleRow({ last_scanned: 10_000 });
    expect(isIndexRowStale(row, 9_000, 1_000)).toBe(false);
  });

  test("restores prior state when an inserted row violates the schema", () => {
    const original = seedRows(db);
    const bad = {
      ...sampleRow({ id: "01HR7N9F6C3K6V7XYZFFFFFFFF" }),
      last_touched: null as unknown as number,
    };
    const result = rebuildFromMetadata(db, [bad]);
    expect(isErr(result)).toBe(true);

    const count = db
      .query<{ n: number }, []>("SELECT COUNT(*) AS n FROM projects")
      .get();
    expect(count?.n).toBe(original.length);
  });
});
