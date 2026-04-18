import type { Command } from "commander";

import type { CommandContext, CommandHandler } from "../cli/command-types.ts";
import { isErr, ok } from "../core/result.ts";
import { resolveProjectRef } from "./resolve-project-ref.ts";

export type CdArgs = {
  readonly project: string;
};

export const handleCd: CommandHandler<CdArgs> = async (args, ctx) => {
  const resolved = await resolveProjectRef(ctx, args.project);
  if (isErr(resolved)) {
    return resolved;
  }
  ctx.ui.logger.info(resolved.value.path);
  return ok(undefined);
};

export const registerCdCommand = (
  program: Command,
  ctx: CommandContext,
): void => {
  program
    .command("cd <project>")
    .description("Print the project's absolute path")
    .action(async (project: string) => {
      ctx.runResult(await handleCd({ project }, ctx));
    });
};
