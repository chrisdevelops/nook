import type { Command } from "commander";

import type { CommandContext, CommandHandler } from "../cli/command-types.ts";
import type {
  HistoryEventStateChanged,
  ProjectMetadata,
} from "../core/project-types.ts";
import { err, isErr, ok } from "../core/result.ts";
import { StateTransitionError } from "../errors/state-transition-error.ts";
import { resolveProjectRef } from "./resolve-project-ref.ts";

export type UnmaintainArgs = {
  readonly project: string;
};

export const handleUnmaintain: CommandHandler<UnmaintainArgs> = async (
  args,
  ctx,
) => {
  const resolved = await resolveProjectRef(ctx, args.project);
  if (isErr(resolved)) {
    return resolved;
  }
  const { path: projectPath, metadata } = resolved.value;

  if (metadata.state !== "maintained") {
    return err(new StateTransitionError(metadata.state, "active"));
  }

  const now = ctx.clock.now();
  const nextMetadata: ProjectMetadata = {
    ...metadata,
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

  ctx.ui.logger.info(`Returned '${metadata.name}' to active.`);
  return ok(undefined);
};

export const registerUnmaintainCommand = (
  program: Command,
  ctx: CommandContext,
): void => {
  program
    .command("unmaintain <project>")
    .description("Return a maintained project to active")
    .action(async (project: string) => {
      ctx.runResult(await handleUnmaintain({ project }, ctx));
    });
};
