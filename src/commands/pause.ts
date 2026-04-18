import type { Command } from "commander";

import type { CommandContext, CommandHandler } from "../cli/command-types.ts";
import { resolvePauseExpiry } from "../core/pause-window.ts";
import type {
  HistoryEventStateChanged,
  ProjectMetadata,
} from "../core/project-types.ts";
import { isValidTransition } from "../core/state-transitions.ts";
import { err, isErr, ok } from "../core/result.ts";
import { CommandError } from "../errors/command-error.ts";
import { StateTransitionError } from "../errors/state-transition-error.ts";
import { resolveProjectRef } from "./resolve-project-ref.ts";

export type PauseArgs = {
  readonly project: string;
  readonly days?: number;
  readonly until?: string;
  readonly reason?: string;
};

export const handlePause: CommandHandler<PauseArgs> = async (args, ctx) => {
  const resolved = await resolveProjectRef(ctx, args.project);
  if (isErr(resolved)) {
    return resolved;
  }
  const { path: projectPath, metadata, config } = resolved.value;

  if (!isValidTransition(metadata.state, "paused")) {
    return err(new StateTransitionError(metadata.state, "paused"));
  }

  const now = ctx.clock.now();
  const effectiveDays =
    args.days ??
    (args.until === undefined ? config.defaults.pause_max_days : undefined);
  const expiryResult = resolvePauseExpiry(
    {
      ...(effectiveDays !== undefined ? { days: effectiveDays } : {}),
      ...(args.until !== undefined ? { until: args.until } : {}),
    },
    now,
  );
  if (isErr(expiryResult)) {
    return err(expiryResult.error);
  }
  const expiry = expiryResult.value;

  const nextMetadata: ProjectMetadata = {
    ...metadata,
    state: "paused",
    paused_until: expiry,
  };
  const writeResult = await ctx.storage.writeProjectMetadata(
    projectPath,
    nextMetadata,
  );
  if (isErr(writeResult)) {
    return err(writeResult.error);
  }

  const event: HistoryEventStateChanged = {
    type: "state_changed",
    at: now,
    from: metadata.state,
    to: "paused",
    paused_until: expiry,
    ...(args.reason !== undefined ? { reason: args.reason } : {}),
  };
  const appendResult = await ctx.storage.appendHistoryEvent(projectPath, event);
  if (isErr(appendResult)) {
    return err(appendResult.error);
  }

  ctx.ui.logger.info(
    `Paused '${metadata.name}' until ${new Date(expiry).toISOString()}.`,
  );
  return ok(undefined);
};

export const registerPauseCommand = (
  program: Command,
  ctx: CommandContext,
): void => {
  program
    .command("pause <project>")
    .description("Pause a project (excluded from staleness checks until expiry)")
    .option("--days <n>", "Pause duration in days")
    .option("--until <date>", "Pause until an ISO date or datetime")
    .option("--reason <text>", "Reason recorded in project history")
    .action(
      async (
        project: string,
        options: { days?: string; until?: string; reason?: string },
      ) => {
        const parsedDays =
          options.days !== undefined ? Number(options.days) : undefined;
        if (parsedDays !== undefined && !Number.isFinite(parsedDays)) {
          ctx.runResult(
            err(
              new CommandError(
                "validation",
                `--days must be a number, got '${options.days}'.`,
              ),
            ),
          );
          return;
        }
        ctx.runResult(
          await handlePause(
            {
              project,
              ...(parsedDays !== undefined ? { days: parsedDays } : {}),
              ...(options.until !== undefined ? { until: options.until } : {}),
              ...(options.reason !== undefined
                ? { reason: options.reason }
                : {}),
            },
            ctx,
          ),
        );
      },
    );
};
