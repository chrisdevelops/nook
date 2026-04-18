import { appendFile, open, readFile, writeFile } from "node:fs/promises";

import { err, ok, type Result } from "../core/result.ts";
import { FilesystemError } from "../errors/filesystem-error.ts";
import { BEGIN_MARKER } from "./generate-snippet.ts";

export type InstallOutcome = "installed" | "updated" | "unchanged";

export type InstallRcIntegrationOptions = {
  readonly rcPath: string;
  readonly snippet: string;
};

const isENOENT = (cause: unknown): boolean =>
  cause instanceof Error &&
  (cause as NodeJS.ErrnoException).code === "ENOENT";

const endsWithNewline = async (path: string): Promise<boolean> => {
  const handle = await open(path, "r");
  try {
    const { size } = await handle.stat();
    if (size === 0) return true;
    const buffer = Buffer.alloc(1);
    await handle.read(buffer, 0, 1, size - 1);
    return buffer[0] === 0x0a;
  } finally {
    await handle.close();
  }
};

const ensureTrailingNewline = (value: string): string =>
  value.length === 0 || value.endsWith("\n") ? value : `${value}\n`;

export const installRcIntegration = async (
  options: InstallRcIntegrationOptions,
): Promise<Result<InstallOutcome, FilesystemError>> => {
  const snippet = ensureTrailingNewline(options.snippet);

  let existing: string | null;
  try {
    existing = await readFile(options.rcPath, "utf8");
  } catch (cause) {
    if (isENOENT(cause)) {
      existing = null;
    } else {
      const message =
        cause instanceof Error ? cause.message : "Failed to read rc file.";
      return err(
        new FilesystemError(message, options.rcPath, { cause }),
      );
    }
  }

  if (existing === null) {
    try {
      await writeFile(options.rcPath, snippet, { encoding: "utf8" });
    } catch (cause) {
      const message =
        cause instanceof Error ? cause.message : "Failed to create rc file.";
      return err(
        new FilesystemError(message, options.rcPath, { cause }),
      );
    }
    return ok("installed");
  }

  if (existing.includes(BEGIN_MARKER)) {
    return ok("unchanged");
  }

  try {
    const trailingNewline = await endsWithNewline(options.rcPath);
    const payload = trailingNewline ? snippet : `\n${snippet}`;
    await appendFile(options.rcPath, payload, { encoding: "utf8" });
  } catch (cause) {
    const message =
      cause instanceof Error ? cause.message : "Failed to append to rc file.";
    return err(new FilesystemError(message, options.rcPath, { cause }));
  }

  return ok("installed");
};
