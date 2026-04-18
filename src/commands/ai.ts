import type { Command } from "commander";

import type { CommandContext, CommandHandler } from "../cli/command-types.ts";
import { err, isErr, ok, type Result } from "../core/result.ts";
import { CommandError } from "../errors/command-error.ts";
import type { LaunchSpawn } from "../platform/launch-editor.ts";
import { launchAiTool } from "../platform/launch-ai-tool.ts";
import { resolveProjectRef } from "./resolve-project-ref.ts";

export type AiArgs = {
  readonly project: string;
};

export type HandleAiDeps = {
  readonly spawn?: LaunchSpawn;
};

export const handleAi = async (
  args: AiArgs,
  ctx: CommandContext,
  deps?: HandleAiDeps,
): Promise<Result<void, CommandError>> => {
  const resolved = await resolveProjectRef(ctx, args.project);
  if (isErr(resolved)) {
    return resolved;
  }
  const { path: projectPath, config } = resolved.value;

  const tool = config.ai.default;
  if (tool === undefined || tool.length === 0) {
    return err(
      new CommandError(
        "validation",
        "No AI tool configured. Set 'ai.default' in config.",
      ),
    );
  }

  const launch = await launchAiTool({
    tool,
    projectPath,
    ...(deps?.spawn !== undefined ? { spawn: deps.spawn } : {}),
  });
  if (isErr(launch)) {
    return err(
      new CommandError(
        "filesystem",
        `Could not launch AI tool: ${launch.error.message}`,
        { cause: launch.error },
      ),
    );
  }
  return ok(undefined);
};

export const registerAiCommand = (
  program: Command,
  ctx: CommandContext,
): void => {
  program
    .command("ai <project>")
    .description("Launch the configured AI tool at the project root")
    .action(async (project: string) => {
      ctx.runResult(await handleAi({ project }, ctx));
    });
};
