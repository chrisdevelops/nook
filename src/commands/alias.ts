import type { Command } from "commander";
import { basename } from "node:path";

import type { CommandContext, CommandHandler } from "../cli/command-types.ts";
import type { GlobalConfig } from "../core/project-types.ts";
import { err, isErr, ok, type Result } from "../core/result.ts";
import { CommandError } from "../errors/command-error.ts";
import type { LaunchSpawn } from "../platform/launch-editor.ts";
import { runAliasCommand } from "../platform/run-alias-command.ts";
import { resolveProjectRef } from "./resolve-project-ref.ts";

export const BUILTIN_COMMAND_NAMES: ReadonlySet<string> = new Set([
  "adopt",
  "ai",
  "alias",
  "archive",
  "cd",
  "code",
  "config",
  "delete",
  "doctor",
  "info",
  "init",
  "ls",
  "maintain",
  "new",
  "open",
  "pause",
  "promote",
  "reindex",
  "rename",
  "scan",
  "ship",
  "stale",
  "status",
  "unarchive",
  "unmaintain",
  "unpause",
  "unship",
]);

export type AliasListArgs = Record<never, never>;

export const handleAliasList: CommandHandler<AliasListArgs> = async (
  _args,
  ctx,
) => {
  const aliases = Object.entries(ctx.config.aliases);
  if (aliases.length === 0) {
    ctx.ui.logger.info("No aliases configured.");
    return ok(undefined);
  }
  aliases.sort(([a], [b]) => a.localeCompare(b));
  for (const [name, { command }] of aliases) {
    ctx.ui.logger.info(`${name}  ${command}`);
  }
  return ok(undefined);
};

export type RunAliasArgs = {
  readonly alias: string;
  readonly project: string;
};

export type RunAliasDeps = {
  readonly spawn?: LaunchSpawn;
  readonly platform?: NodeJS.Platform;
};

export const handleRunAlias = async (
  args: RunAliasArgs,
  ctx: CommandContext,
  deps?: RunAliasDeps,
): Promise<Result<void, CommandError>> => {
  const alias = ctx.config.aliases[args.alias];
  if (alias === undefined) {
    return err(
      new CommandError("not_found", `Alias '${args.alias}' is not configured.`),
    );
  }
  const resolved = await resolveProjectRef(ctx, args.project);
  if (isErr(resolved)) {
    return resolved;
  }
  const { path: projectPath, metadata } = resolved.value;
  const run = await runAliasCommand({
    command: alias.command,
    context: {
      path: projectPath,
      name: basename(projectPath),
      id: metadata.id,
      category: metadata.category,
    },
    ...(deps?.spawn !== undefined ? { spawn: deps.spawn } : {}),
    ...(deps?.platform !== undefined ? { platform: deps.platform } : {}),
  });
  if (isErr(run)) {
    return err(
      new CommandError(
        "filesystem",
        `Alias '${args.alias}' failed: ${run.error.message}`,
        { cause: run.error },
      ),
    );
  }
  return ok(undefined);
};

export const registerAliasCommand = (
  program: Command,
  ctx: CommandContext,
): void => {
  const alias = program
    .command("alias")
    .description("Manage user-defined project aliases")
    .action(async () => {
      ctx.runResult(await handleAliasList({}, ctx));
    });

  alias
    .command("list")
    .description("List configured aliases")
    .action(async () => {
      ctx.runResult(await handleAliasList({}, ctx));
    });
};

export const registerConfiguredAliases = (
  program: Command,
  ctx: CommandContext,
  config: GlobalConfig,
): void => {
  for (const name of Object.keys(config.aliases)) {
    if (BUILTIN_COMMAND_NAMES.has(name)) {
      continue;
    }
    program
      .command(`${name} <project>`)
      .description(`Run alias '${name}'`)
      .action(async (project: string) => {
        ctx.runResult(await handleRunAlias({ alias: name, project }, ctx));
      });
  }
};
