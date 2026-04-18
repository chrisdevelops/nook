import type { Command } from "commander";

import type { CommandContext, CommandHandler } from "../cli/command-types.ts";
import { isValidTransition } from "../core/state-transitions.ts";
import { err, isErr, ok } from "../core/result.ts";
import { StateTransitionError } from "../errors/state-transition-error.ts";
import { moveAndUpdateState } from "./move-and-update-state.ts";
import { resolveProjectRef } from "./resolve-project-ref.ts";

export type ShipArgs = {
  readonly project: string;
  readonly version?: string;
};

export const handleShip: CommandHandler<ShipArgs> = async (args, ctx) => {
  const resolved = await resolveProjectRef(ctx, args.project);
  if (isErr(resolved)) {
    return resolved;
  }
  const { path: projectPath, metadata, rootDir } = resolved.value;

  if (!isValidTransition(metadata.state, "shipped")) {
    return err(new StateTransitionError(metadata.state, "shipped"));
  }

  const now = ctx.clock.now();
  const moveResult = await moveAndUpdateState({
    ctx,
    currentPath: projectPath,
    metadata,
    rootDir,
    nextState: "shipped",
    now,
    ...(args.version !== undefined ? { version: args.version } : {}),
  });
  if (isErr(moveResult)) {
    return err(moveResult.error);
  }

  ctx.ui.logger.info(`Shipped '${metadata.name}'.`);
  return ok(undefined);
};

export const registerShipCommand = (
  program: Command,
  ctx: CommandContext,
): void => {
  program
    .command("ship <project>")
    .description(
      "Mark a project as shipped and move the folder to <category>/shipped/",
    )
    .option("--version <version>", "Record the shipped version in history")
    .action(async (project: string, options: { version?: string }) => {
      ctx.runResult(
        await handleShip(
          {
            project,
            ...(options.version !== undefined
              ? { version: options.version }
              : {}),
          },
          ctx,
        ),
      );
    });
};
