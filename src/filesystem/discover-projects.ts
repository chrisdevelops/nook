import { access, readdir } from "node:fs/promises";
import { join } from "node:path";

import { err, ok, type Result } from "../core/result.ts";
import { FilesystemError } from "../errors/filesystem-error.ts";

const PROJECT_MARKER: readonly [string, string] = [".nook", "project.jsonc"];

const hasProjectMarker = async (dir: string): Promise<boolean> => {
  try {
    await access(join(dir, PROJECT_MARKER[0], PROJECT_MARKER[1]));
    return true;
  } catch {
    return false;
  }
};

const toFilesystemError = (cause: unknown, path: string): FilesystemError => {
  const message =
    cause instanceof Error ? cause.message : "Failed to discover projects.";
  return new FilesystemError(message, path, { cause });
};

const walkForProjects = async (
  dir: string,
  accumulator: string[],
): Promise<void> => {
  if (await hasProjectMarker(dir)) {
    accumulator.push(dir);
    return;
  }
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.isSymbolicLink()) continue;
    if (!entry.isDirectory()) continue;
    if (entry.name.startsWith(".")) continue;
    await walkForProjects(join(dir, entry.name), accumulator);
  }
};

export const discoverProjects = async (
  rootDir: string,
): Promise<Result<readonly string[], FilesystemError>> => {
  const accumulator: string[] = [];
  try {
    const entries = await readdir(rootDir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isSymbolicLink()) continue;
      if (!entry.isDirectory()) continue;
      if (entry.name.startsWith(".")) continue;
      await walkForProjects(join(rootDir, entry.name), accumulator);
    }
  } catch (cause) {
    return err(toFilesystemError(cause, rootDir));
  }
  accumulator.sort();
  return ok(accumulator);
};
