import { err, ok, type Result } from "../core/result.ts";
import { FilesystemError } from "../errors/filesystem-error.ts";
import { parseJsonc } from "./parse-jsonc.ts";

export const readJsonc = async (
  path: string,
): Promise<Result<unknown, FilesystemError>> => {
  try {
    const text = await Bun.file(path).text();
    return ok(parseJsonc(text));
  } catch (cause) {
    const message =
      cause instanceof Error ? cause.message : "Failed to read JSONC file.";
    return err(new FilesystemError(message, path, { cause }));
  }
};
