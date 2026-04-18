import { isErr, ok, type Result } from "../core/result.ts";
import type { FilesystemError } from "../errors/filesystem-error.ts";
import { readGitHeadTime, type GitSpawn } from "./read-git-head-time.ts";
import { walkTree } from "./walk-tree.ts";

export type ComputeLastTouchedInput = {
  readonly projectDir: string;
  readonly ignores?: (relativePath: string) => boolean;
  readonly cliTouchesMs?: readonly number[];
  readonly gitSpawn?: GitSpawn;
};

const maxOrNull = (values: readonly number[]): number | null =>
  values.length === 0 ? null : values.reduce((a, b) => (a > b ? a : b));

export const computeLastTouched = async (
  input: ComputeLastTouchedInput,
): Promise<Result<number | null, FilesystemError>> => {
  const walk = await walkTree(
    input.projectDir,
    input.ignores === undefined ? {} : { ignores: input.ignores },
  );
  if (isErr(walk)) {
    return walk;
  }

  const git = await readGitHeadTime(
    input.projectDir,
    input.gitSpawn === undefined ? {} : { spawn: input.gitSpawn },
  );
  if (isErr(git)) {
    return git;
  }

  const signals: number[] = [];
  for (const file of walk.value) {
    signals.push(file.mtimeMs);
  }
  if (git.value !== null) {
    signals.push(git.value);
  }
  if (input.cliTouchesMs) {
    for (const touch of input.cliTouchesMs) {
      signals.push(touch);
    }
  }

  return ok(maxOrNull(signals));
};
