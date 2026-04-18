import { err, ok, type Result } from "../core/result.ts";
import { FilesystemError } from "../errors/filesystem-error.ts";

export type GitSpawnOutcome = {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
};

export type GitSpawn = (
  args: readonly string[],
  cwd: string,
) => Promise<GitSpawnOutcome>;

export type ReadGitHeadTimeOptions = {
  readonly spawn?: GitSpawn;
};

const GIT_ARGS: readonly string[] = ["log", "-1", "--format=%ct", "HEAD"];

const defaultSpawn: GitSpawn = async (args, cwd) => {
  const subprocess = Bun.spawn(["git", ...args], {
    cwd,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr] = await Promise.all([
    new Response(subprocess.stdout).text(),
    new Response(subprocess.stderr).text(),
  ]);
  const exitCode = await subprocess.exited;
  return { exitCode, stdout, stderr };
};

const parseSeconds = (stdout: string): number | null => {
  const trimmed = stdout.trim();
  if (trimmed === "") return null;
  const seconds = Number.parseInt(trimmed, 10);
  if (!Number.isFinite(seconds)) return null;
  if (String(seconds) !== trimmed) return null;
  return seconds;
};

export const readGitHeadTime = async (
  projectDir: string,
  options: ReadGitHeadTimeOptions = {},
): Promise<Result<number | null, FilesystemError>> => {
  const spawn = options.spawn ?? defaultSpawn;
  let outcome: GitSpawnOutcome;
  try {
    outcome = await spawn(GIT_ARGS, projectDir);
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : "git spawn failed.";
    return err(new FilesystemError(message, projectDir, { cause }));
  }
  if (outcome.exitCode !== 0) {
    return ok(null);
  }
  const seconds = parseSeconds(outcome.stdout);
  if (seconds === null) {
    return ok(null);
  }
  return ok(seconds * 1000);
};
