import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

import { projectStates, type ProjectState } from "../core/project-types.ts";
import { err, ok, type Result } from "../core/result.ts";
import { FilesystemError } from "../errors/filesystem-error.ts";

const projectStateSet: ReadonlySet<ProjectState> = new Set(projectStates);

const isProjectState = (value: string): value is ProjectState =>
  projectStateSet.has(value as ProjectState);

export type ProjectIndex = Database;

export type ProjectIndexRow = {
  readonly id: string;
  readonly name: string;
  readonly path: string;
  readonly category: string;
  readonly state: ProjectState;
  readonly last_touched: number;
  readonly last_scanned: number;
  readonly created_at: number;
  readonly paused_until: number | null;
  readonly scratch: boolean;
};

export const DEFAULT_INDEX_TTL_MS = 5 * 60 * 1000;

export const isIndexRowStale = (
  row: Pick<ProjectIndexRow, "last_scanned">,
  nowMs: number,
  ttlMs: number = DEFAULT_INDEX_TTL_MS,
): boolean => nowMs - row.last_scanned >= ttlMs;

const SCHEMA_STATEMENTS: readonly string[] = [
  `CREATE TABLE IF NOT EXISTS projects (
    id            TEXT PRIMARY KEY,
    name          TEXT NOT NULL,
    path          TEXT NOT NULL,
    category      TEXT NOT NULL,
    state         TEXT NOT NULL,
    last_touched  INTEGER NOT NULL,
    last_scanned  INTEGER NOT NULL,
    created_at    INTEGER NOT NULL,
    paused_until  INTEGER,
    scratch       INTEGER NOT NULL DEFAULT 0
  )`,
  `CREATE INDEX IF NOT EXISTS idx_projects_state ON projects(state)`,
  `CREATE INDEX IF NOT EXISTS idx_projects_category ON projects(category)`,
  `CREATE INDEX IF NOT EXISTS idx_projects_last_touched ON projects(last_touched)`,
];

const toFilesystemError = (cause: unknown, path: string): FilesystemError => {
  const message =
    cause instanceof Error ? cause.message : "SQLite operation failed.";
  return new FilesystemError(message, path, { cause });
};

export const openIndex = (
  dbPath: string,
): Result<ProjectIndex, FilesystemError> => {
  try {
    mkdirSync(dirname(dbPath), { recursive: true });
  } catch (cause) {
    return err(toFilesystemError(cause, dirname(dbPath)));
  }
  let db: Database;
  try {
    db = new Database(dbPath, { create: true });
  } catch (cause) {
    return err(toFilesystemError(cause, dbPath));
  }
  try {
    for (const statement of SCHEMA_STATEMENTS) {
      db.exec(statement);
    }
  } catch (cause) {
    db.close();
    return err(toFilesystemError(cause, dbPath));
  }
  return ok(db);
};

export const closeIndex = (db: ProjectIndex): void => {
  db.close();
};

export type ProjectIndexFilters = {
  readonly state?: ProjectState | readonly ProjectState[];
  readonly category?: string | readonly string[];
  readonly lastTouchedAfter?: number;
  readonly lastTouchedBefore?: number;
};

type RawProjectRow = {
  id: string;
  name: string;
  path: string;
  category: string;
  state: string;
  last_touched: number;
  last_scanned: number;
  created_at: number;
  paused_until: number | null;
  scratch: number;
};

const hydrateRow = (raw: RawProjectRow): ProjectIndexRow => {
  if (!isProjectState(raw.state)) {
    throw new Error(`Invalid project state in index: ${raw.state}`);
  }
  return {
    id: raw.id,
    name: raw.name,
    path: raw.path,
    category: raw.category,
    state: raw.state,
    last_touched: raw.last_touched,
    last_scanned: raw.last_scanned,
    created_at: raw.created_at,
    paused_until: raw.paused_until,
    scratch: raw.scratch !== 0,
  };
};

const toArrayFilter = <T>(value: T | readonly T[] | undefined): readonly T[] | undefined => {
  if (value === undefined) return undefined;
  return Array.isArray(value) ? (value as readonly T[]) : [value as T];
};

export const queryProjects = (
  db: ProjectIndex,
  filters: ProjectIndexFilters = {},
): Result<readonly ProjectIndexRow[], FilesystemError> => {
  const clauses: string[] = [];
  const params: (string | number)[] = [];

  const stateValues = toArrayFilter(filters.state);
  if (stateValues !== undefined) {
    if (stateValues.length === 0) {
      return ok([]);
    }
    clauses.push(`state IN (${stateValues.map(() => "?").join(", ")})`);
    params.push(...stateValues);
  }

  const categoryValues = toArrayFilter(filters.category);
  if (categoryValues !== undefined) {
    if (categoryValues.length === 0) {
      return ok([]);
    }
    clauses.push(`category IN (${categoryValues.map(() => "?").join(", ")})`);
    params.push(...categoryValues);
  }

  if (filters.lastTouchedAfter !== undefined) {
    clauses.push("last_touched >= ?");
    params.push(filters.lastTouchedAfter);
  }

  if (filters.lastTouchedBefore !== undefined) {
    clauses.push("last_touched <= ?");
    params.push(filters.lastTouchedBefore);
  }

  const where = clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "";
  const sql = `SELECT id, name, path, category, state, last_touched, last_scanned, created_at, paused_until, scratch FROM projects ${where} ORDER BY id ASC`;

  try {
    const raw = db.query<RawProjectRow, (string | number)[]>(sql).all(...params);
    return ok(raw.map(hydrateRow));
  } catch (cause) {
    return err(toFilesystemError(cause, "(query)"));
  }
};

const upsertRow = (db: ProjectIndex, row: ProjectIndexRow): void => {
  db.query(
    `INSERT OR REPLACE INTO projects (
      id, name, path, category, state,
      last_touched, last_scanned, created_at,
      paused_until, scratch
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    row.id,
    row.name,
    row.path,
    row.category,
    row.state,
    row.last_touched,
    row.last_scanned,
    row.created_at,
    row.paused_until,
    row.scratch ? 1 : 0,
  );
};

export const upsertProject = (
  db: ProjectIndex,
  row: ProjectIndexRow,
): Result<void, FilesystemError> => {
  try {
    upsertRow(db, row);
    return ok(undefined);
  } catch (cause) {
    return err(toFilesystemError(cause, row.path));
  }
};

export const markScanned = (
  db: ProjectIndex,
  id: string,
  nowMs: number,
): Result<void, FilesystemError> => {
  try {
    db.query("UPDATE projects SET last_scanned = ? WHERE id = ?").run(nowMs, id);
    return ok(undefined);
  } catch (cause) {
    return err(toFilesystemError(cause, "(mark-scanned)"));
  }
};

export const rebuildFromMetadata = (
  db: ProjectIndex,
  rows: readonly ProjectIndexRow[],
): Result<void, FilesystemError> => {
  const rebuild = db.transaction((input: readonly ProjectIndexRow[]) => {
    db.exec("DELETE FROM projects");
    for (const row of input) {
      upsertRow(db, row);
    }
  });
  try {
    rebuild(rows);
    return ok(undefined);
  } catch (cause) {
    return err(toFilesystemError(cause, "(rebuild)"));
  }
};
