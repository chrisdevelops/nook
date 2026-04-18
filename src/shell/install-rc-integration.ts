import { readFile } from "node:fs/promises";
import writeFileAtomic from "write-file-atomic";

import { err, ok, type Result } from "../core/result.ts";
import { FilesystemError } from "../errors/filesystem-error.ts";
import { BEGIN_MARKER, END_MARKER } from "./generate-snippet.ts";

export type InstallOutcome = "installed" | "updated" | "unchanged";

export type InstallRcIntegrationOptions = {
  readonly rcPath: string;
  readonly snippet: string;
};

const readIfExists = async (path: string): Promise<string | null> => {
  try {
    return await readFile(path, "utf8");
  } catch (cause) {
    if (
      cause instanceof Error &&
      (cause as NodeJS.ErrnoException).code === "ENOENT"
    ) {
      return null;
    }
    throw cause;
  }
};

const findMarkerBlock = (
  contents: string,
): { readonly start: number; readonly end: number } | null => {
  const start = contents.indexOf(BEGIN_MARKER);
  if (start === -1) {
    return null;
  }
  const endMarkerAt = contents.indexOf(END_MARKER, start);
  if (endMarkerAt === -1) {
    return null;
  }
  let end = endMarkerAt + END_MARKER.length;
  if (contents[end] === "\n") {
    end += 1;
  }
  return { start, end };
};

const ensureTrailingNewline = (value: string): string =>
  value.length === 0 || value.endsWith("\n") ? value : `${value}\n`;

const replaceBlock = (
  contents: string,
  block: { readonly start: number; readonly end: number },
  snippet: string,
): string => {
  const before = contents.slice(0, block.start);
  const after = contents.slice(block.end);
  return `${before}${snippet}${after}`;
};

export const installRcIntegration = async (
  options: InstallRcIntegrationOptions,
): Promise<Result<InstallOutcome, FilesystemError>> => {
  let existing: string | null;
  try {
    existing = await readIfExists(options.rcPath);
  } catch (cause) {
    const message =
      cause instanceof Error ? cause.message : "Failed to read rc file.";
    return err(new FilesystemError(message, options.rcPath, { cause }));
  }

  const snippet = ensureTrailingNewline(options.snippet);

  let nextContents: string;
  let outcome: InstallOutcome;

  if (existing === null) {
    nextContents = snippet;
    outcome = "installed";
  } else {
    const block = findMarkerBlock(existing);
    if (block === null) {
      const preface = ensureTrailingNewline(existing);
      nextContents = `${preface}${snippet}`;
      outcome = "installed";
    } else {
      const currentBlock = existing.slice(block.start, block.end);
      if (currentBlock === snippet) {
        return ok("unchanged");
      }
      nextContents = replaceBlock(existing, block, snippet);
      outcome = "updated";
    }
  }

  try {
    await writeFileAtomic(options.rcPath, nextContents);
  } catch (cause) {
    const message =
      cause instanceof Error ? cause.message : "Failed to write rc file.";
    return err(new FilesystemError(message, options.rcPath, { cause }));
  }

  return ok(outcome);
};
