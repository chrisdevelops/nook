import type { Command } from "commander";

import type { CommandContext, CommandHandler } from "../cli/command-types.ts";
import { err, isErr, ok } from "../core/result.ts";
import { CommandError } from "../errors/command-error.ts";
import {
  closeIndex,
  type ProjectIndexRow,
  rebuildFromMetadata,
} from "../storage/project-index.ts";
import { loadAllProjects } from "./load-all-projects.ts";

export type ReindexArgs = Record<never, never>;

export const handleReindex: CommandHandler<ReindexArgs> = async (_args, ctx) => {
  const loaded = await loadAllProjects(ctx);
  if (isErr(loaded)) {
    return err(loaded.error);
  }
  const now = ctx.clock.now();

  const rows: ProjectIndexRow[] = loaded.value.projects.map((p) => ({
    id: p.metadata.id,
    name: p.metadata.name,
    path: p.path,
    category: p.metadata.category,
    state: p.metadata.state,
    last_touched: p.lastTouchedMs,
    last_scanned: now,
    created_at: p.metadata.created_at,
    paused_until: p.metadata.paused_until ?? null,
    scratch: p.metadata.scratch,
  }));

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
    const rebuild = rebuildFromMetadata(db, rows);
    if (isErr(rebuild)) {
      return err(
        new CommandError(
          "filesystem",
          `Could not rebuild index: ${rebuild.error.message}`,
          { cause: rebuild.error },
        ),
      );
    }
  } finally {
    closeIndex(db);
  }

  ctx.ui.logger.info(`Reindexed ${rows.length} projects.`);
  return ok(undefined);
};

export const registerReindexCommand = (
  program: Command,
  ctx: CommandContext,
): void => {
  program
    .command("reindex")
    .description("Rebuild the project index cache from scratch")
    .action(async () => {
      ctx.runResult(await handleReindex({}, ctx));
    });
};
