import { readdir, stat } from "node:fs/promises";
import { join, posix } from "node:path";

import { err, ok, type Result } from "../core/result.ts";
import { FilesystemError } from "../errors/filesystem-error.ts";

export type WalkedFile = {
  readonly path: string;
  readonly mtimeMs: number;
};

export type WalkTreeOptions = {
  readonly ignores?: (relativePath: string) => boolean;
};

const DEFAULT_SKIP_DIRS: ReadonlySet<string> = new Set([".git", ".nook"]);

const toFilesystemError = (cause: unknown, path: string): FilesystemError => {
  const message =
    cause instanceof Error ? cause.message : "Filesystem walk failed.";
  return new FilesystemError(message, path, { cause });
};

const walkInto = async (
  absoluteDir: string,
  relativeDir: string,
  options: WalkTreeOptions,
  accumulator: WalkedFile[],
): Promise<void> => {
  const entries = await readdir(absoluteDir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.isSymbolicLink()) {
      continue;
    }
    const relativePath =
      relativeDir === ""
        ? entry.name
        : `${relativeDir}${posix.sep}${entry.name}`;
    if (entry.isDirectory()) {
      if (DEFAULT_SKIP_DIRS.has(entry.name)) {
        continue;
      }
      if (options.ignores?.(relativePath)) {
        continue;
      }
      await walkInto(
        join(absoluteDir, entry.name),
        relativePath,
        options,
        accumulator,
      );
      continue;
    }
    if (!entry.isFile()) {
      continue;
    }
    if (options.ignores?.(relativePath)) {
      continue;
    }
    const stats = await stat(join(absoluteDir, entry.name));
    accumulator.push({ path: relativePath, mtimeMs: stats.mtimeMs });
  }
};

export const walkTree = async (
  rootDir: string,
  options: WalkTreeOptions = {},
): Promise<Result<readonly WalkedFile[], FilesystemError>> => {
  const accumulator: WalkedFile[] = [];
  try {
    await walkInto(rootDir, "", options, accumulator);
  } catch (cause) {
    return err(toFilesystemError(cause, rootDir));
  }
  return ok(accumulator);
};
