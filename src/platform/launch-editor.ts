import { err, ok, type Result } from "../core/result.ts";
import { FilesystemError } from "../errors/filesystem-error.ts";

export type LaunchSpawnOutcome = {
  readonly exitCode: number;
};

export type LaunchSpawn = (
  cmd: readonly string[],
  options: { readonly cwd?: string | undefined },
) => Promise<LaunchSpawnOutcome>;

export type LaunchEditorOptions = {
  readonly editor: string;
  readonly projectPath: string;
  readonly cwd?: string;
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

const tokenize = (command: string): readonly string[] =>
  command
    .split(/\s+/u)
    .map((part) => part.trim())
    .filter((part) => part.length > 0);

export const launchEditor = async (
  options: LaunchEditorOptions,
): Promise<Result<void, FilesystemError>> => {
  const tokens = tokenize(options.editor);
  if (tokens.length === 0) {
    return err(
      new FilesystemError(
        "Editor command is empty.",
        options.projectPath,
      ),
    );
  }
  const spawn = options.spawn ?? defaultSpawn;
  const cwd = options.cwd ?? options.projectPath;
  let outcome: LaunchSpawnOutcome;
  try {
    outcome = await spawn([...tokens, options.projectPath], {
      cwd,
    });
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : "Editor spawn failed.";
    return err(
      new FilesystemError(message, options.projectPath, { cause }),
    );
  }
  if (outcome.exitCode !== 0) {
    return err(
      new FilesystemError(
        `Editor exited with code ${outcome.exitCode}.`,
        options.projectPath,
      ),
    );
  }
  return ok(undefined);
};
