import type { Command } from "commander";

import type { CommandContext, CommandHandler } from "../cli/command-types.ts";
import {
  projectStates,
  type ProjectState,
} from "../core/project-types.ts";
import { resolveCategoryConfig } from "../core/resolve-category-config.ts";
import { err, isErr, ok } from "../core/result.ts";
import { isStale, MS_PER_DAY } from "../core/staleness.ts";
import {
  isStatusEmpty,
  type ProjectStatusSummary,
  type StatusStateCount,
} from "../ui/render-status.ts";
import {
  loadAllProjects,
  type LoadedProject,
} from "./load-all-projects.ts";

export type StatusArgs = {
  readonly quiet?: boolean;
};

const HIDDEN_STATES: ReadonlySet<ProjectState> = new Set([
  "archived",
  "shipped",
]);

const PAUSE_EXPIRY_WINDOW_DAYS = 7;

const countByState = (
  projects: readonly LoadedProject[],
): readonly StatusStateCount[] => {
  const counts = new Map<ProjectState, number>();
  for (const p of projects) {
    counts.set(p.metadata.state, (counts.get(p.metadata.state) ?? 0) + 1);
  }
  const ordered: StatusStateCount[] = [];
  for (const state of projectStates) {
    if (HIDDEN_STATES.has(state)) continue;
    const count = counts.get(state) ?? 0;
    if (count > 0) ordered.push({ state, count });
  }
  return ordered;
};

export const handleStatus: CommandHandler<StatusArgs> = async (args, ctx) => {
  const loaded = await loadAllProjects(ctx);
  if (isErr(loaded)) {
    return err(loaded.error);
  }
  const { config, projects } = loaded.value;
  const now = ctx.clock.now();

  const visible = projects.filter(
    (p) => !HIDDEN_STATES.has(p.metadata.state),
  );

  const stateCounts = countByState(visible);

  const staleItems: string[] = [];
  for (const p of visible) {
    if (p.metadata.state === "paused") continue;
    const cat = resolveCategoryConfig(config, p.metadata.category);
    if (isStale(p.lastTouchedMs, cat.staleness_days, now)) {
      staleItems.push(`${p.metadata.name} (${p.metadata.category})`);
    }
  }

  const expiringSoon: string[] = [];
  for (const p of visible) {
    if (p.metadata.state !== "paused") continue;
    if (p.metadata.paused_until === undefined) continue;
    const delta = p.metadata.paused_until - now;
    if (delta > 0 && delta <= PAUSE_EXPIRY_WINDOW_DAYS * MS_PER_DAY) {
      expiringSoon.push(
        `${p.metadata.name} (expires ${new Date(p.metadata.paused_until).toISOString()})`,
      );
    }
  }

  const summary: ProjectStatusSummary = {
    stateCounts,
    highlights: [
      { label: "Stale projects", items: staleItems },
      { label: "Pauses expiring soon", items: expiringSoon },
    ],
  };

  if (args.quiet === true && isStatusEmpty(summary)) {
    return ok(undefined);
  }

  const rendered = ctx.ui.renderStatus(summary, { color: true });
  ctx.ui.logger.info(rendered);
  return ok(undefined);
};

export const registerStatusCommand = (
  program: Command,
  ctx: CommandContext,
): void => {
  program
    .command("status")
    .description(
      "Summary view: counts per state, stale projects, pauses expiring soon",
    )
    .option("--quiet", "Suppress output when nothing needs attention")
    .action(async (options: { quiet?: boolean }) => {
      ctx.runResult(
        await handleStatus(
          { ...(options.quiet === true ? { quiet: true } : {}) },
          ctx,
        ),
      );
    });
};
