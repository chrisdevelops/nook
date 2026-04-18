import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";

import type { GlobalConfig } from "../core/project-types.ts";
import { err, isErr, type Result } from "../core/result.ts";
import { FilesystemError } from "../errors/filesystem-error.ts";
import type { ValidationError } from "../errors/validation-error.ts";
import { validateGlobalConfig } from "./metadata-schemas.ts";
import { readJsonc } from "./read-jsonc.ts";
import { writeJsoncAtomic } from "./write-jsonc-atomic.ts";

export const readGlobalConfig = async (
  configPath: string,
): Promise<Result<GlobalConfig, FilesystemError | ValidationError>> => {
  const readResult = await readJsonc(configPath);
  if (isErr(readResult)) {
    return readResult;
  }
  return validateGlobalConfig(readResult.value);
};

export const writeGlobalConfig = async (
  configPath: string,
  config: GlobalConfig,
): Promise<Result<void, FilesystemError | ValidationError>> => {
  const validation = validateGlobalConfig(config);
  if (isErr(validation)) {
    return validation;
  }
  try {
    await mkdir(dirname(configPath), { recursive: true });
  } catch (cause) {
    const message =
      cause instanceof Error
        ? cause.message
        : "Failed to create config directory.";
    return err(new FilesystemError(message, dirname(configPath), { cause }));
  }
  return writeJsoncAtomic(configPath, validation.value);
};
