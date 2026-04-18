import type { Command } from "commander";

import type { CommandContext, CommandHandler } from "../cli/command-types.ts";
import { err, isErr, ok, type Result } from "../core/result.ts";
import { CommandError } from "../errors/command-error.ts";
import { openInFileManager } from "../platform/open-in-file-manager.ts";
import type { LaunchSpawn } from "../platform/launch-editor.ts";
import { resolveProjectRef } from "./resolve-project-ref.ts";

export type OpenArgs = {
  readonly project: string;
};

export type HandleOpenDeps = {
  readonly spawn?: LaunchSpawn;
  readonly platform?: NodeJS.Platform;
};

export const handleOpen = async (
  args: OpenArgs,
  ctx: CommandContext,
  deps?: HandleOpenDeps,
): Promise<Result<void, CommandError>> => {
  const resolved = await resolveProjectRef(ctx, args.project);
  if (isErr(resolved)) {
    return resolved;
  }
  const projectPath = resolved.value.path;
  const launch = await openInFileManager({
    projectPath,
    ...(deps?.spawn !== undefined ? { spawn: deps.spawn } : {}),
    ...(deps?.platform !== undefined ? { platform: deps.platform } : {}),
  });
  if (isErr(launch)) {
    return err(
      new CommandError(
        "filesystem",
        `Could not open file manager: ${launch.error.message}`,
        { cause: launch.error },
      ),
    );
  }
  return ok(undefined);
};

export const registerOpenCommand = (
  program: Command,
  ctx: CommandContext,
): void => {
  program
    .command("open <project>")
    .description("Open the project folder in the OS file manager")
    .action(async (project: string) => {
      ctx.runResult(await handleOpen({ project }, ctx));
    });
};
