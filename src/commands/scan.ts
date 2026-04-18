import type { Command } from "commander";

import type { CommandContext, CommandHandler } from "../cli/command-types.ts";
import { err, isErr, ok } from "../core/result.ts";
import { CommandError } from "../errors/command-error.ts";
import {
  closeIndex,
  DEFAULT_INDEX_TTL_MS,
  isIndexRowStale,
  type ProjectIndex,
  type ProjectIndexRow,
  queryProjects,
  upsertProject,
} from "../storage/project-index.ts";
import { loadAllProjects, type LoadedProject } from "./load-all-projects.ts";

export type ScanArgs = {
  readonly category?: string;
  readonly force?: boolean;
};

const toRow = (project: LoadedProject, nowMs: number): ProjectIndexRow => ({
  id: project.metadata.id,
  name: project.metadata.name,
  path: project.path,
  category: project.metadata.category,
  state: project.metadata.state,
  last_touched: project.lastTouchedMs,
  last_scanned: nowMs,
  created_at: project.metadata.created_at,
  paused_until: project.metadata.paused_until ?? null,
  scratch: project.metadata.scratch,
});

const fetchExistingRows = (
  db: ProjectIndex,
): Map<string, ProjectIndexRow> | null => {
  const result = queryProjects(db);
  if (isErr(result)) return null;
  const map = new Map<string, ProjectIndexRow>();
  for (const row of result.value) {
    map.set(row.id, row);
  }
  return map;
};

export const handleScan: CommandHandler<ScanArgs> = async (args, ctx) => {
  const loaded = await loadAllProjects(ctx);
  if (isErr(loaded)) {
    return err(loaded.error);
  }
  const now = ctx.clock.now();
  const candidates = loaded.value.projects.filter(
    (p) =>
      args.category === undefined || p.metadata.category === args.category,
  );

  const openResult = ctx.storage.openIndex(ctx.appPaths.indexPath);
  if (isErr(openResult)) {
    return err(
      new CommandError(
        "filesystem",
        `Could not open index: ${openResult.error.message}`,
        { cause: openResult.error },
      ),
    );
  }
  const db = openResult.value;
  try {
    const existing = fetchExistingRows(db);
    if (existing === null) {
      return err(
        new CommandError(
          "filesystem",
          "Could not read existing index rows.",
        ),
      );
    }

    let updated = 0;
    for (const project of candidates) {
      const prior = existing.get(project.metadata.id);
      const stale =
        prior === undefined ||
        args.force === true ||
        isIndexRowStale(prior, now, DEFAULT_INDEX_TTL_MS);
      if (!stale) continue;
      const upsert = upsertProject(db, toRow(project, now));
      if (isErr(upsert)) {
        return err(
          new CommandError(
            "filesystem",
            `Could not update index for ${project.path}: ${upsert.error.message}`,
            { cause: upsert.error },
          ),
        );
      }
      updated += 1;
    }

    ctx.ui.logger.info(
      `Scanned ${candidates.length} project${candidates.length === 1 ? "" : "s"}; updated ${updated}.`,
    );
  } finally {
    closeIndex(db);
  }

  return ok(undefined);
};

export const registerScanCommand = (
  program: Command,
  ctx: CommandContext,
): void => {
  program
    .command("scan")
    .description("Walk project root, recompute last_touched, refresh the index")
    .option("--category <name>", "Limit scan to a single category")
    .option("--force", "Ignore TTL and rescan every project")
    .action(async (options: { category?: string; force?: boolean }) => {
      ctx.runResult(
        await handleScan(
          {
            ...(options.category !== undefined
              ? { category: options.category }
              : {}),
            ...(options.force === true ? { force: true } : {}),
          },
          ctx,
        ),
      );
    });
};
