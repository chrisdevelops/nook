import { err, ok, type Result } from "../core/result.ts";
import { FilesystemError } from "../errors/filesystem-error.ts";
import type { LaunchSpawn, LaunchSpawnOutcome } from "./launch-editor.ts";

export type LaunchAiToolOptions = {
  readonly tool: string;
  readonly projectPath: string;
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

export const launchAiTool = async (
  options: LaunchAiToolOptions,
): Promise<Result<void, FilesystemError>> => {
  const tokens = tokenize(options.tool);
  if (tokens.length === 0) {
    return err(
      new FilesystemError(
        "AI tool command is empty.",
        options.projectPath,
      ),
    );
  }
  const spawn = options.spawn ?? defaultSpawn;
  let outcome: LaunchSpawnOutcome;
  try {
    outcome = await spawn(tokens, { cwd: options.projectPath });
  } catch (cause) {
    const message =
      cause instanceof Error ? cause.message : "AI tool spawn failed.";
    return err(
      new FilesystemError(message, options.projectPath, { cause }),
    );
  }
  if (outcome.exitCode !== 0) {
    return err(
      new FilesystemError(
        `AI tool exited with code ${outcome.exitCode}.`,
        options.projectPath,
      ),
    );
  }
  return ok(undefined);
};
