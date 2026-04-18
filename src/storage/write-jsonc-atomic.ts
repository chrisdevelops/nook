import writeFileAtomic from "write-file-atomic";

import { err, ok, type Result } from "../core/result.ts";
import { FilesystemError } from "../errors/filesystem-error.ts";

export const writeJsoncAtomic = async (
  path: string,
  value: unknown,
): Promise<Result<void, FilesystemError>> => {
  const serialized = `${JSON.stringify(value, null, 2)}\n`;
  try {
    await writeFileAtomic(path, serialized);
    return ok(undefined);
  } catch (cause) {
    const message =
      cause instanceof Error ? cause.message : "Failed to write JSONC file.";
    return err(new FilesystemError(message, path, { cause }));
  }
};
