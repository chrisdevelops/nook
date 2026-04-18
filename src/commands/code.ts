import type { Command } from "commander";

import type { CommandContext, CommandHandler } from "../cli/command-types.ts";
import { err, isErr, ok } from "../core/result.ts";
import { CommandError } from "../errors/command-error.ts";
import { resolveProjectRef } from "./resolve-project-ref.ts";

export type CodeArgs = {
  readonly project: string;
  readonly with?: string;
};

export const handleCode: CommandHandler<CodeArgs> = async (args, ctx) => {
  const resolved = await resolveProjectRef(ctx, args.project);
  if (isErr(resolved)) {
    return resolved;
  }
  const { path: projectPath, config } = resolved.value;

  const editor = args.with ?? config.editors.default;
  if (editor === undefined || editor.length === 0) {
    return err(
      new CommandError(
        "validation",
        "No editor configured. Set 'editors.default' in config or pass --with.",
      ),
    );
  }

  const launch = await ctx.ui.launchEditor({
    editor,
    projectPath,
  });
  if (isErr(launch)) {
    return err(
      new CommandError(
        "filesystem",
        `Could not launch editor: ${launch.error.message}`,
        { cause: launch.error },
      ),
    );
  }
  return ok(undefined);
};

export const registerCodeCommand = (
  program: Command,
  ctx: CommandContext,
): void => {
  program
    .command("code <project>")
    .description("Open the project in the configured editor")
    .option("--with <editor>", "Override the default editor for this invocation")
    .action(async (project: string, options: { with?: string }) => {
      ctx.runResult(
        await handleCode(
          {
            project,
            ...(options.with !== undefined ? { with: options.with } : {}),
          },
          ctx,
        ),
      );
    });
};
