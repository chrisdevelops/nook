import { err, ok, type Result } from "../core/result.ts";
import { FilesystemError } from "../errors/filesystem-error.ts";
import type { LaunchSpawn, LaunchSpawnOutcome } from "./launch-editor.ts";

export type OpenInFileManagerOptions = {
  readonly projectPath: string;
  readonly platform?: NodeJS.Platform;
  readonly spawn?: LaunchSpawn;
};

const defaultSpawn: LaunchSpawn = async (cmd, options) => {
  const subprocess = Bun.spawn(cmd as string[], {
    stdin: "ignore",
    stdout: "ignore",
    stderr: "ignore",
    ...(options.cwd !== undefined ? { cwd: options.cwd } : {}),
  });
  const exitCode = await subprocess.exited;
  return { exitCode };
};

const resolveOpener = (
  platform: NodeJS.Platform,
): { readonly command: string } | null => {
  switch (platform) {
    case "darwin":
      return { command: "open" };
    case "win32":
      return { command: "explorer" };
    case "linux":
      return { command: "xdg-open" };
    default:
      return null;
  }
};

export const openInFileManager = async (
  options: OpenInFileManagerOptions,
): Promise<Result<void, FilesystemError>> => {
  const platform = options.platform ?? process.platform;
  const opener = resolveOpener(platform);
  if (opener === null) {
    return err(
      new FilesystemError(
        `Unsupported platform for opening file manager: ${platform}.`,
        options.projectPath,
      ),
    );
  }

  const spawn = options.spawn ?? defaultSpawn;
  let outcome: LaunchSpawnOutcome;
  try {
    outcome = await spawn([opener.command, options.projectPath], {});
  } catch (cause) {
    const message =
      cause instanceof Error ? cause.message : "File manager spawn failed.";
    return err(
      new FilesystemError(message, options.projectPath, { cause }),
    );
  }

  if (platform === "win32") {
    return ok(undefined);
  }
  if (outcome.exitCode !== 0) {
    return err(
      new FilesystemError(
        `File manager exited with code ${outcome.exitCode}.`,
        options.projectPath,
      ),
    );
  }
  return ok(undefined);
};
