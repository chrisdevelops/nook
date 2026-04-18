import {
  access,
  cp as nodeCp,
  mkdir,
  rename as nodeRename,
  rm,
} from "node:fs/promises";
import { dirname, resolve } from "node:path";

import { err, ok, type Result } from "../core/result.ts";
import { FilesystemError } from "../errors/filesystem-error.ts";

export type MoveProjectRename = (source: string, destination: string) => Promise<void>;

export type MoveProjectCopy = (
  source: string,
  destination: string,
) => Promise<void>;

export type MoveProjectInput = {
  readonly source: string;
  readonly destination: string;
  readonly rename?: MoveProjectRename;
  readonly copy?: MoveProjectCopy;
};

const isNodeError = (
  value: unknown,
): value is NodeJS.ErrnoException & { code: string } =>
  value instanceof Error && typeof (value as { code?: unknown }).code === "string";

const pathExists = async (path: string): Promise<boolean> => {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
};

const toFilesystemError = (
  cause: unknown,
  path: string,
  fallbackMessage: string,
): FilesystemError => {
  const message = cause instanceof Error ? cause.message : fallbackMessage;
  return new FilesystemError(message, path, { cause });
};

const defaultRename: MoveProjectRename = async (source, destination) => {
  await nodeRename(source, destination);
};

const defaultCopy: MoveProjectCopy = async (source, destination) => {
  await nodeCp(source, destination, {
    recursive: true,
    errorOnExist: true,
    force: false,
  });
};

export const moveProject = async (
  input: MoveProjectInput,
): Promise<Result<void, FilesystemError>> => {
  const source = resolve(input.source);
  const destination = resolve(input.destination);

  if (source === destination) {
    return ok(undefined);
  }

  if (!(await pathExists(source))) {
    return err(
      new FilesystemError("Source path does not exist.", source),
    );
  }

  if (await pathExists(destination)) {
    return err(
      new FilesystemError("Destination path already exists.", destination),
    );
  }

  try {
    await mkdir(dirname(destination), { recursive: true });
  } catch (cause) {
    return err(
      toFilesystemError(cause, dirname(destination), "Failed to create destination parent."),
    );
  }

  const renameFn = input.rename ?? defaultRename;
  try {
    await renameFn(source, destination);
    return ok(undefined);
  } catch (cause) {
    if (!isNodeError(cause) || cause.code !== "EXDEV") {
      return err(toFilesystemError(cause, source, "Failed to rename project."));
    }
  }

  const copyFn = input.copy ?? defaultCopy;
  try {
    await copyFn(source, destination);
  } catch (cause) {
    await rm(destination, { recursive: true, force: true }).catch(() => {});
    return err(
      toFilesystemError(cause, destination, "Failed to copy project."),
    );
  }

  try {
    await rm(source, { recursive: true, force: true });
  } catch (cause) {
    return err(
      toFilesystemError(cause, source, "Failed to remove original after copy."),
    );
  }

  return ok(undefined);
};
