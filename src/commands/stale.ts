import type { Command } from "commander";

import type { CommandContext, CommandHandler } from "../cli/command-types.ts";
import { resolveCategoryConfig } from "../core/resolve-category-config.ts";
import { err, isErr, ok } from "../core/result.ts";
import { isStale } from "../core/staleness.ts";
import { handleArchive } from "./archive.ts";
import {
  loadAllProjects,
  type LoadedProject,
} from "./load-all-projects.ts";
import { handlePause } from "./pause.ts";

export type StaleArgs = {
  readonly list?: boolean;
  readonly category?: string;
};

type StaleAction = "archive" | "pause" | "keep";

const actionChoices: readonly { value: StaleAction; name: string }[] = [
  { value: "archive", name: "Archive (move to <category>/archived/)" },
  { value: "pause", name: "Pause (default duration)" },
  { value: "keep", name: "Keep (no change)" },
];

const formatDays = (nowMs: number, thenMs: number): string => {
  const days = Math.max(0, Math.floor((nowMs - thenMs) / 86_400_000));
  return `${days}d`;
};

export const handleStale: CommandHandler<StaleArgs> = async (args, ctx) => {
  const loaded = await loadAllProjects(ctx);
  if (isErr(loaded)) {
    return err(loaded.error);
  }
  const { config, projects } = loaded.value;
  const now = ctx.clock.now();

  const stale: LoadedProject[] = [];
  for (const project of projects) {
    if (project.metadata.state === "paused") continue;
    if (project.metadata.state === "shipped") continue;
    if (project.metadata.state === "archived") continue;
    if (
      args.category !== undefined &&
      project.metadata.category !== args.category
    ) {
      continue;
    }
    const cat = resolveCategoryConfig(config, project.metadata.category);
    if (isStale(project.lastTouchedMs, cat.staleness_days, now)) {
      stale.push(project);
    }
  }

  if (stale.length === 0) {
    ctx.ui.logger.info("No stale projects.");
    return ok(undefined);
  }

  if (args.list === true) {
    for (const p of stale) {
      ctx.ui.logger.info(
        `${p.metadata.category}/${p.metadata.name} — untouched ${formatDays(now, p.lastTouchedMs)}`,
      );
    }
    return ok(undefined);
  }

  for (const p of stale) {
    const action = (await ctx.ui.promptSelect({
      message: `${p.metadata.category}/${p.metadata.name} — untouched ${formatDays(now, p.lastTouchedMs)}. What now?`,
      choices: actionChoices,
    })) as StaleAction;

    if (action === "archive") {
      const result = await handleArchive(
        { project: p.metadata.id, yes: true, reason: "stale" },
        ctx,
      );
      if (isErr(result)) {
        return err(result.error);
      }
    } else if (action === "pause") {
      const result = await handlePause({ project: p.metadata.id }, ctx);
      if (isErr(result)) {
        return err(result.error);
      }
    } else {
      ctx.ui.logger.info(`Kept '${p.metadata.name}'.`);
    }
  }

  return ok(undefined);
};

export const registerStaleCommand = (
  program: Command,
  ctx: CommandContext,
): void => {
  program
    .command("stale")
    .description(
      "List stale projects with suggested actions (interactive by default)",
    )
    .option("--list", "List only; do not prompt")
    .option("--category <name>", "Limit to a specific category")
    .action(async (options: { list?: boolean; category?: string }) => {
      ctx.runResult(
        await handleStale(
          {
            ...(options.list === true ? { list: true } : {}),
            ...(options.category !== undefined
              ? { category: options.category }
              : {}),
          },
          ctx,
        ),
      );
    });
};
