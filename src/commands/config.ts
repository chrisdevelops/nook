import type { Command } from "commander";

import type { CommandContext, CommandHandler } from "../cli/command-types.ts";
import {
  getAtPath,
  parseKeyPath,
  setAtPath,
} from "../core/key-path.ts";
import type { GlobalConfig } from "../core/project-types.ts";
import { err, isErr, ok, type Result } from "../core/result.ts";
import { CommandError } from "../errors/command-error.ts";
import { FilesystemError } from "../errors/filesystem-error.ts";

const MISSING_CONFIG_MESSAGE =
  "Config file not found. Run 'nook init' to create one.";

const AUTO_CREATE_ROOTS: ReadonlySet<string> = new Set([
  "categories",
  "aliases",
]);

const configNotFound = (): CommandError =>
  new CommandError("not_found", MISSING_CONFIG_MESSAGE);

const parseValue = (raw: string): unknown => {
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
};

const formatValue = (value: unknown): string => {
  if (value === null || typeof value !== "object") {
    return String(value);
  }
  return JSON.stringify(value, null, 2);
};

const isMissingFileError = (error: unknown): boolean =>
  error instanceof FilesystemError &&
  error.cause !== undefined &&
  (error.cause as NodeJS.ErrnoException).code === "ENOENT";

const loadConfig = async (
  ctx: CommandContext,
): Promise<Result<GlobalConfig, CommandError>> => {
  const read = await ctx.storage.readGlobalConfig(ctx.appPaths.configFilePath);
  if (isErr(read)) {
    if (isMissingFileError(read.error)) {
      return err(configNotFound());
    }
    return err(read.error);
  }
  return ok(read.value);
};

export const handleConfigPath: CommandHandler<Record<never, never>> = async (
  _args,
  ctx,
) => {
  ctx.ui.logger.info(ctx.appPaths.configFilePath);
  return ok(undefined);
};

export const handleConfigCd: CommandHandler<Record<never, never>> = async (
  _args,
  ctx,
) => {
  ctx.ui.logger.info(ctx.appPaths.config);
  return ok(undefined);
};

export const handleConfigShow: CommandHandler<Record<never, never>> = async (
  _args,
  ctx,
) => {
  const file = Bun.file(ctx.appPaths.configFilePath);
  if (!(await file.exists())) {
    return err(configNotFound());
  }
  const raw = await file.text();
  ctx.ui.logger.info(raw);
  return ok(undefined);
};

export const handleConfigGet: CommandHandler<{ readonly key: string }> =
  async (args, ctx) => {
    const pathResult = parseKeyPath(args.key);
    if (isErr(pathResult)) {
      return err(pathResult.error);
    }
    const loaded = await loadConfig(ctx);
    if (isErr(loaded)) {
      return loaded;
    }
    const value = getAtPath(loaded.value, pathResult.value);
    if (value === undefined) {
      return err(
        new CommandError("not_found", `Config key '${args.key}' is not set.`),
      );
    }
    ctx.ui.logger.info(formatValue(value));
    return ok(undefined);
  };

export const handleConfigSet: CommandHandler<{
  readonly key: string;
  readonly value: string;
}> = async (args, ctx) => {
  const pathResult = parseKeyPath(args.key);
  if (isErr(pathResult)) {
    return err(pathResult.error);
  }
  const loaded = await loadConfig(ctx);
  if (isErr(loaded)) {
    return loaded;
  }
  const parsedValue = parseValue(args.value);
  const autoCreate =
    pathResult.value.length >= 1 &&
    AUTO_CREATE_ROOTS.has(pathResult.value[0] as string);
  const nextResult = setAtPath(
    loaded.value,
    pathResult.value,
    parsedValue,
    { autoCreate },
  );
  if (isErr(nextResult)) {
    if (!autoCreate) {
      return err(
        new CommandError("not_found", nextResult.error.message),
      );
    }
    return err(nextResult.error);
  }
  const writeResult = await ctx.storage.writeGlobalConfig(
    ctx.appPaths.configFilePath,
    nextResult.value,
  );
  if (isErr(writeResult)) {
    return err(writeResult.error);
  }
  ctx.ui.logger.info(`Set ${args.key} = ${formatValue(parsedValue)}`);
  return ok(undefined);
};

export const handleConfigEdit: CommandHandler<Record<never, never>> = async (
  _args,
  ctx,
) => {
  const file = Bun.file(ctx.appPaths.configFilePath);
  if (!(await file.exists())) {
    return err(configNotFound());
  }

  const envEditor = process.env["EDITOR"];
  let editor: string | null =
    envEditor !== undefined && envEditor.length > 0 ? envEditor : null;
  if (editor === null) {
    const loaded = await loadConfig(ctx);
    if (isErr(loaded)) {
      return loaded;
    }
    const fromConfig = loaded.value.editors.default;
    if (fromConfig !== undefined && fromConfig.length > 0) {
      editor = fromConfig;
    }
  }
  if (editor === null) {
    return err(
      new CommandError(
        "validation",
        "No editor configured. Set $EDITOR or 'editors.default' in config.",
      ),
    );
  }

  const launchResult = await ctx.ui.launchEditor({
    editor,
    projectPath: ctx.appPaths.configFilePath,
    cwd: ctx.appPaths.config,
  });
  if (isErr(launchResult)) {
    return err(launchResult.error);
  }
  return ok(undefined);
};

export const registerConfigCommand = (
  program: Command,
  ctx: CommandContext,
): void => {
  const config = program
    .command("config")
    .description("View or modify configuration")
    .action(async () => {
      ctx.runResult(await handleConfigShow({}, ctx));
    });

  config
    .command("get <key>")
    .description("Print a single config value")
    .action(async (key: string) => {
      ctx.runResult(await handleConfigGet({ key }, ctx));
    });

  config
    .command("set <key> <value>")
    .description("Update a config value")
    .action(async (key: string, value: string) => {
      ctx.runResult(await handleConfigSet({ key, value }, ctx));
    });

  config
    .command("edit")
    .description("Open the config file in $EDITOR")
    .action(async () => {
      ctx.runResult(await handleConfigEdit({}, ctx));
    });

  config
    .command("path")
    .description("Print the path to the config file")
    .action(async () => {
      ctx.runResult(await handleConfigPath({}, ctx));
    });

  config
    .command("cd")
    .description("Print the config folder path")
    .action(async () => {
      ctx.runResult(await handleConfigCd({}, ctx));
    });
};
