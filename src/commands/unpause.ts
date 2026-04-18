import type { Command } from "commander";

import type { CommandContext, CommandHandler } from "../cli/command-types.ts";
import type {
  HistoryEventStateChanged,
  ProjectMetadata,
} from "../core/project-types.ts";
import { err, isErr, ok } from "../core/result.ts";
import { StateTransitionError } from "../errors/state-transition-error.ts";
import { resolveProjectRef } from "./resolve-project-ref.ts";

export type UnpauseArgs = {
  readonly project: string;
};

export const handleUnpause: CommandHandler<UnpauseArgs> = async (args, ctx) => {
  const resolved = await resolveProjectRef(ctx, args.project);
  if (isErr(resolved)) {
    return resolved;
  }
  const { path: projectPath, metadata } = resolved.value;

  if (metadata.state !== "paused") {
    return err(new StateTransitionError(metadata.state, "active"));
  }

  const now = ctx.clock.now();
  const { paused_until: _pausedUntil, ...rest } = metadata;
  const nextMetadata: ProjectMetadata = {
    ...rest,
    state: "active",
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
    to: "active",
  };
  const appendResult = await ctx.storage.appendHistoryEvent(projectPath, event);
  if (isErr(appendResult)) {
    return err(appendResult.error);
  }

  ctx.ui.logger.info(`Unpaused '${metadata.name}'.`);
  return ok(undefined);
};

export const registerUnpauseCommand = (
  program: Command,
  ctx: CommandContext,
): void => {
  program
    .command("unpause <project>")
    .description("End a pause early and return the project to active")
    .action(async (project: string) => {
      ctx.runResult(await handleUnpause({ project }, ctx));
    });
};
