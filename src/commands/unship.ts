import type { Command } from "commander";

import type { CommandContext, CommandHandler } from "../cli/command-types.ts";
import { err, isErr, ok } from "../core/result.ts";
import { StateTransitionError } from "../errors/state-transition-error.ts";
import { moveAndUpdateState } from "./move-and-update-state.ts";
import { resolveProjectRef } from "./resolve-project-ref.ts";

export type UnshipArgs = {
  readonly project: string;
};

export const handleUnship: CommandHandler<UnshipArgs> = async (args, ctx) => {
  const resolved = await resolveProjectRef(ctx, args.project);
  if (isErr(resolved)) {
    return resolved;
  }
  const { path: projectPath, metadata, rootDir } = resolved.value;

  if (metadata.state !== "shipped") {
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

  ctx.ui.logger.info(`Unshipped '${metadata.name}'.`);
  return ok(undefined);
};

export const registerUnshipCommand = (
  program: Command,
  ctx: CommandContext,
): void => {
  program
    .command("unship <project>")
    .description("Return a shipped project to active state and category root")
    .action(async (project: string) => {
      ctx.runResult(await handleUnship({ project }, ctx));
    });
};
