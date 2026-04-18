import type { Command } from "commander";

import type { CommandContext, CommandHandler } from "../cli/command-types.ts";
import { err, isErr, ok } from "../core/result.ts";
import { CommandError } from "../errors/command-error.ts";
import { findOrphanFolders } from "../filesystem/find-orphan-folders.ts";
import {
  closeIndex,
  DEFAULT_INDEX_TTL_MS,
  isIndexRowStale,
  type ProjectIndex,
  type ProjectIndexRow,
  queryProjects,
  upsertProject,
} from "../storage/project-index.ts";
import { handleAdopt } from "./adopt.ts";
import { loadAllProjects, type LoadedProject } from "./load-all-projects.ts";

export type ScanArgs = {
  readonly category?: string;
  readonly force?: boolean;
  readonly adoptOrphans?: boolean;
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

  const knownPaths = new Set<string>(
    loaded.value.projects.map((p) => p.path),
  );
  const orphans = await findOrphanFolders(ctx.config.root, knownPaths);
  const scopedOrphans =
    args.category === undefined
      ? orphans
      : orphans.filter((o) => o.category === args.category);

  if (scopedOrphans.length === 0) {
    return ok(undefined);
  }

  if (args.adoptOrphans !== true) {
    ctx.ui.logger.warn(
      `Found ${scopedOrphans.length} untracked folder${scopedOrphans.length === 1 ? "" : "s"} under the project root:`,
    );
    for (const orphan of scopedOrphans) {
      ctx.ui.logger.warn(`  ${orphan.path}`);
    }
    ctx.ui.logger.warn(
      "Run 'nook scan --adopt-orphans' to register them, or 'nook adopt <path>' individually.",
    );
    return ok(undefined);
  }

  const configuredCategories = ctx.config.categories;
  let adoptedCount = 0;
  for (const orphan of scopedOrphans) {
    if (
      !Object.prototype.hasOwnProperty.call(
        configuredCategories,
        orphan.category,
      )
    ) {
      ctx.ui.logger.warn(
        `Skipping ${orphan.path}: '${orphan.category}' is not a configured category.`,
      );
      continue;
    }
    const adoptResult = await handleAdopt({ path: orphan.path }, ctx);
    if (isErr(adoptResult)) {
      ctx.ui.logger.warn(
        `Could not adopt ${orphan.path}: ${adoptResult.error.message}`,
      );
      continue;
    }
    adoptedCount += 1;
  }

  ctx.ui.logger.info(
    `Adopted ${adoptedCount} orphan${adoptedCount === 1 ? "" : "s"}.`,
  );
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
    .option(
      "--adopt-orphans",
      "Register any untracked folders under configured categories in place",
    )
    .action(
      async (options: {
        category?: string;
        force?: boolean;
        adoptOrphans?: boolean;
      }) => {
        ctx.runResult(
          await handleScan(
            {
              ...(options.category !== undefined
                ? { category: options.category }
                : {}),
              ...(options.force === true ? { force: true } : {}),
              ...(options.adoptOrphans === true
                ? { adoptOrphans: true }
                : {}),
            },
            ctx,
          ),
        );
      },
    );
};
