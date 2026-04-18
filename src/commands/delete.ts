import { rm } from "node:fs/promises";
import type { Command } from "commander";

import type { CommandContext, CommandHandler } from "../cli/command-types.ts";
import { err, ok } from "../core/result.ts";
import { isErr } from "../core/result.ts";
import { CommandError } from "../errors/command-error.ts";
import { resolveProjectRef } from "./resolve-project-ref.ts";

export type DeleteArgs = {
  readonly project: string;
  readonly yes?: boolean;
};

export const handleDelete: CommandHandler<DeleteArgs> = async (args, ctx) => {
  const resolved = await resolveProjectRef(ctx, args.project);
  if (isErr(resolved)) {
    return resolved;
  }
  const { path: projectPath, metadata } = resolved.value;

  if (args.yes !== true) {
    const confirmed = await ctx.ui.promptConfirm({
      message: `Permanently delete '${metadata.name}' and all its contents? This cannot be undone.`,
      default: false,
    });
    if (!confirmed) {
      ctx.ui.logger.info("Delete cancelled.");
      return ok(undefined);
    }
  }

  const typed = await ctx.ui.promptInput({
    message: `Type the project name ('${metadata.name}') to confirm deletion`,
  });
  if (typed !== metadata.name) {
    ctx.ui.logger.info(
      `Name did not match. Delete cancelled; '${metadata.name}' was not touched.`,
    );
    return ok(undefined);
  }

  try {
    await rm(projectPath, { recursive: true, force: true });
  } catch (cause) {
    const message =
      cause instanceof Error ? cause.message : "Failed to delete project folder.";
    return err(
      new CommandError("filesystem", message, { cause }),
    );
  }

  ctx.ui.logger.info(`Deleted '${metadata.name}'.`);
  return ok(undefined);
};

export const registerDeleteCommand = (
  program: Command,
  ctx: CommandContext,
): void => {
  program
    .command("delete <project>")
    .description("Permanently delete a project and all its contents")
    .option("--yes", "Skip the initial confirmation (name confirmation still required)")
    .action(async (project: string, options: { yes?: boolean }) => {
      ctx.runResult(
        await handleDelete(
          {
            project,
            ...(options.yes === true ? { yes: true } : {}),
          },
          ctx,
        ),
      );
    });
};
