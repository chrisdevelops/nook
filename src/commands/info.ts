import type { Command } from "commander";

import type { CommandContext, CommandHandler } from "../cli/command-types.ts";
import { resolveCategoryConfig } from "../core/resolve-category-config.ts";
import type { HistoryEvent, ProjectMetadata } from "../core/project-types.ts";
import { err, isErr, ok } from "../core/result.ts";
import { isStale } from "../core/staleness.ts";
import { computeLastTouched } from "../filesystem/compute-last-touched.ts";
import { resolveProjectRef } from "./resolve-project-ref.ts";

export type InfoArgs = {
  readonly project: string;
  readonly json?: boolean;
  readonly history?: boolean;
};

const formatDate = (ms: number): string => new Date(ms).toISOString();

const renderDetail = (
  metadata: ProjectMetadata,
  path: string,
  lastTouchedMs: number,
  stale: boolean,
  history: readonly HistoryEvent[] | null,
): string => {
  const lines: string[] = [];
  lines.push(`Name:         ${metadata.name}`);
  lines.push(`ID:           ${metadata.id}`);
  lines.push(`Category:     ${metadata.category}`);
  lines.push(`State:        ${metadata.state}${stale ? " (stale)" : ""}`);
  lines.push(`Path:         ${path}`);
  lines.push(`Created:      ${formatDate(metadata.created_at)}`);
  lines.push(`Last touched: ${formatDate(lastTouchedMs)}`);
  lines.push(`Tags:         ${metadata.tags.length > 0 ? metadata.tags.join(", ") : "—"}`);
  lines.push(`Scratch:      ${metadata.scratch ? "yes" : "no"}`);
  if (metadata.paused_until !== undefined) {
    lines.push(`Paused until: ${formatDate(metadata.paused_until)}`);
  }
  lines.push(
    `Description:  ${metadata.description !== undefined && metadata.description.length > 0 ? metadata.description : "—"}`,
  );
  if (history !== null) {
    lines.push("");
    lines.push("History:");
    if (history.length === 0) {
      lines.push("  (no events)");
    } else {
      for (const event of history) {
        lines.push(`  ${formatDate(event.at)}  ${renderEvent(event)}`);
      }
    }
  }
  return lines.join("\n");
};

const renderEvent = (event: HistoryEvent): string => {
  switch (event.type) {
    case "created":
      return `created (source=${event.source}${event.template !== undefined ? `, template=${event.template}` : ""}${event.fork !== undefined ? `, fork=${event.fork}` : ""})`;
    case "state_changed":
      return `state_changed ${event.from} → ${event.to}${event.reason !== undefined ? ` (${event.reason})` : ""}${event.version !== undefined ? ` version=${event.version}` : ""}`;
    case "renamed":
      return `renamed ${event.from} → ${event.to}`;
    case "category_changed":
      return `category_changed ${event.from} → ${event.to}`;
    case "touched":
      return `touched${event.reason !== undefined ? ` (${event.reason})` : ""}`;
  }
};

export const handleInfo: CommandHandler<InfoArgs> = async (args, ctx) => {
  const resolved = await resolveProjectRef(ctx, args.project);
  if (isErr(resolved)) {
    return resolved;
  }
  const { path: projectPath, metadata, config } = resolved.value;

  const touchedResult = await computeLastTouched({ projectDir: projectPath });
  const lastTouchedMs =
    isErr(touchedResult) || touchedResult.value === null
      ? metadata.created_at
      : touchedResult.value;

  let history: readonly HistoryEvent[] | null = null;
  if (args.history === true) {
    const historyResult = await ctx.storage.readHistoryEvents(projectPath);
    if (isErr(historyResult)) {
      return err(historyResult.error);
    }
    history = historyResult.value;
  }

  const categoryConfig = resolveCategoryConfig(config, metadata.category);
  const notIdle =
    metadata.state !== "paused" &&
    metadata.state !== "shipped" &&
    metadata.state !== "archived";
  const stale =
    notIdle && isStale(lastTouchedMs, categoryConfig.staleness_days, ctx.clock.now());

  if (args.json === true) {
    const payload = {
      id: metadata.id,
      name: metadata.name,
      category: metadata.category,
      state: metadata.state,
      path: projectPath,
      tags: metadata.tags,
      scratch: metadata.scratch,
      created_at: metadata.created_at,
      last_touched: lastTouchedMs,
      stale,
      ...(metadata.description !== undefined
        ? { description: metadata.description }
        : {}),
      ...(metadata.paused_until !== undefined
        ? { paused_until: metadata.paused_until }
        : {}),
      ...(history !== null ? { history } : {}),
    };
    ctx.ui.logger.info(JSON.stringify(payload, null, 2));
    return ok(undefined);
  }

  ctx.ui.logger.info(
    renderDetail(metadata, projectPath, lastTouchedMs, stale, history),
  );
  return ok(undefined);
};

export const registerInfoCommand = (
  program: Command,
  ctx: CommandContext,
): void => {
  program
    .command("info <project>")
    .description("Show detailed metadata for a project")
    .option("--json", "Output as JSON")
    .option("--history", "Include the full history log")
    .action(
      async (
        project: string,
        options: { json?: boolean; history?: boolean },
      ) => {
        ctx.runResult(
          await handleInfo(
            {
              project,
              ...(options.json === true ? { json: true } : {}),
              ...(options.history === true ? { history: true } : {}),
            },
            ctx,
          ),
        );
      },
    );
};
