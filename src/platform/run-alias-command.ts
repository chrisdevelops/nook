import { err, ok, type Result } from "../core/result.ts";
import { FilesystemError } from "../errors/filesystem-error.ts";
import type { LaunchSpawn, LaunchSpawnOutcome } from "./launch-editor.ts";

export type AliasContext = {
  readonly path: string;
  readonly name: string;
  readonly id: string;
  readonly category: string;
};

export type RunAliasCommandOptions = {
  readonly command: string;
  readonly context: AliasContext;
  readonly platform?: NodeJS.Platform;
  readonly spawn?: LaunchSpawn;
};

const defaultSpawn: LaunchSpawn = async (cmd, options) => {
  const subprocess = Bun.spawn(cmd as string[], {
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit",
    ...(options.cwd !== undefined ? { cwd: options.cwd } : {}),
  });
  const exitCode = await subprocess.exited;
  return { exitCode };
};

const PLACEHOLDERS: Record<string, keyof AliasContext> = {
  "{path}": "path",
  "{name}": "name",
  "{id}": "id",
  "{category}": "category",
};

export const substituteAliasCommand = (
  command: string,
  context: AliasContext,
): string => {
  let result = command;
  for (const [placeholder, key] of Object.entries(PLACEHOLDERS)) {
    result = result.split(placeholder).join(context[key]);
  }
  return result;
};

const resolveShell = (
  platform: NodeJS.Platform,
): { readonly shell: string; readonly flag: string } =>
  platform === "win32"
    ? { shell: "cmd", flag: "/c" }
    : { shell: "sh", flag: "-c" };

export const runAliasCommand = async (
  options: RunAliasCommandOptions,
): Promise<Result<void, FilesystemError>> => {
  const platform = options.platform ?? process.platform;
  const substituted = substituteAliasCommand(options.command, options.context);
  if (substituted.trim().length === 0) {
    return err(
      new FilesystemError(
        "Alias command is empty.",
        options.context.path,
      ),
    );
  }

  const { shell, flag } = resolveShell(platform);
  const spawn = options.spawn ?? defaultSpawn;

  let outcome: LaunchSpawnOutcome;
  try {
    outcome = await spawn([shell, flag, substituted], {
      cwd: options.context.path,
    });
  } catch (cause) {
    const message =
      cause instanceof Error ? cause.message : "Alias spawn failed.";
    return err(
      new FilesystemError(message, options.context.path, { cause }),
    );
  }

  if (outcome.exitCode !== 0) {
    return err(
      new FilesystemError(
        `Alias command exited with code ${outcome.exitCode}.`,
        options.context.path,
      ),
    );
  }
  return ok(undefined);
};
