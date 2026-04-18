import type { Command } from "commander";

import type { CommandContext, CommandHandler } from "../cli/command-types.ts";
import { isValidTransition } from "../core/state-transitions.ts";
import { err, isErr, ok } from "../core/result.ts";
import { StateTransitionError } from "../errors/state-transition-error.ts";
import { moveAndUpdateState } from "./move-and-update-state.ts";
import { resolveProjectRef } from "./resolve-project-ref.ts";

export type ArchiveArgs = {
  readonly project: string;
  readonly reason?: string;
  readonly yes?: boolean;
};

export const handleArchive: CommandHandler<ArchiveArgs> = async (args, ctx) => {
  const resolved = await resolveProjectRef(ctx, args.project);
  if (isErr(resolved)) {
    return resolved;
  }
  const { path: projectPath, metadata, rootDir } = resolved.value;

  if (!isValidTransition(metadata.state, "archived")) {
    return err(new StateTransitionError(metadata.state, "archived"));
  }

  if (args.yes !== true) {
    const confirmed = await ctx.ui.promptConfirm({
      message: `Archive '${metadata.name}' (${metadata.category}/${metadata.state})?`,
      default: false,
    });
    if (!confirmed) {
      ctx.ui.logger.info("Archive cancelled.");
      return ok(undefined);
    }
  }

  const now = ctx.clock.now();
  const moveResult = await moveAndUpdateState({
    ctx,
    currentPath: projectPath,
    metadata,
    rootDir,
    nextState: "archived",
    now,
    ...(args.reason !== undefined ? { reason: args.reason } : {}),
  });
  if (isErr(moveResult)) {
    return err(moveResult.error);
  }

  ctx.ui.logger.info(`Archived '${metadata.name}'.`);
  return ok(undefined);
};

export const registerArchiveCommand = (
  program: Command,
  ctx: CommandContext,
): void => {
  program
    .command("archive <project>")
    .description(
      "Archive a project (moves folder to <category>/archived/, no stale checks)",
    )
    .option("--reason <text>", "Reason recorded in project history")
    .option("--yes", "Skip the confirmation prompt")
    .action(
      async (
        project: string,
        options: { reason?: string; yes?: boolean },
      ) => {
        ctx.runResult(
          await handleArchive(
            {
              project,
              ...(options.reason !== undefined ? { reason: options.reason } : {}),
              ...(options.yes === true ? { yes: true } : {}),
            },
            ctx,
          ),
        );
      },
    );
};
