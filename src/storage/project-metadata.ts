import { mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";

import type { ProjectMetadata } from "../core/project-types.ts";
import { err, isErr, ok, type Result } from "../core/result.ts";
import { FilesystemError } from "../errors/filesystem-error.ts";
import type { ValidationError } from "../errors/validation-error.ts";
import { validateProjectMetadata } from "./metadata-schemas.ts";
import { readJsonc } from "./read-jsonc.ts";
import { writeJsoncAtomic } from "./write-jsonc-atomic.ts";

export const projectMetadataRelativePath = ".nook/project.jsonc";

const resolveMetadataPath = (projectDir: string): string =>
  join(projectDir, ".nook", "project.jsonc");

export const readProjectMetadata = async (
  projectDir: string,
): Promise<Result<ProjectMetadata, FilesystemError | ValidationError>> => {
  const path = resolveMetadataPath(projectDir);
  const readResult = await readJsonc(path);
  if (isErr(readResult)) {
    return readResult;
  }
  return validateProjectMetadata(readResult.value);
};

export const writeProjectMetadata = async (
  projectDir: string,
  metadata: ProjectMetadata,
): Promise<Result<void, FilesystemError | ValidationError>> => {
  const validation = validateProjectMetadata(metadata);
  if (isErr(validation)) {
    return validation;
  }
  const path = resolveMetadataPath(projectDir);
  try {
    await mkdir(dirname(path), { recursive: true });
  } catch (cause) {
    const message =
      cause instanceof Error ? cause.message : "Failed to create .nook directory.";
    return err(new FilesystemError(message, dirname(path), { cause }));
  }
  return writeJsoncAtomic(path, validation.value);
};
