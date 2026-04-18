import type { Command } from "commander";

import type { CommandContext, CommandHandler } from "../cli/command-types.ts";
import { err, isErr, ok } from "../core/result.ts";
import { StateTransitionError } from "../errors/state-transition-error.ts";
import { moveAndUpdateState } from "./move-and-update-state.ts";
import { resolveProjectRef } from "./resolve-project-ref.ts";

export type UnarchiveArgs = {
  readonly project: string;
};

export const handleUnarchive: CommandHandler<UnarchiveArgs> = async (
  args,
  ctx,
) => {
  const resolved = await resolveProjectRef(ctx, args.project);
  if (isErr(resolved)) {
    return resolved;
  }
  const { path: projectPath, metadata, rootDir } = resolved.value;

  if (metadata.state !== "archived") {
    return err(new StateTransitionError(metadata.state, "active"));
  }

  const now = ctx.clock.now();
  const moveResult = await moveAndUpdateState({
    ctx,
    currentPath: projectPath,
    metadata,
    rootDir,
    nextState: "active",
    now,
  });
  if (isErr(moveResult)) {
    return err(moveResult.error);
  }

  ctx.ui.logger.info(`Unarchived '${metadata.name}'.`);
  return ok(undefined);
};

export const registerUnarchiveCommand = (
  program: Command,
  ctx: CommandContext,
): void => {
  program
    .command("unarchive <project>")
    .description("Restore an archived project to active state")
    .action(async (project: string) => {
      ctx.runResult(await handleUnarchive({ project }, ctx));
    });
};
