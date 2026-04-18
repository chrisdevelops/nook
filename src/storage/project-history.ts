import { appendFile, mkdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import type { HistoryEvent } from "../core/project-types.ts";
import { err, isErr, ok, type Result } from "../core/result.ts";
import { FilesystemError } from "../errors/filesystem-error.ts";
import type { ValidationError } from "../errors/validation-error.ts";
import { validateHistoryEvent } from "./metadata-schemas.ts";

export const projectHistoryRelativePath = ".nook/history.jsonl";

const resolveHistoryPath = (projectDir: string): string =>
  join(projectDir, ".nook", "history.jsonl");

const isMissingFile = (cause: unknown): boolean =>
  typeof cause === "object" &&
  cause !== null &&
  "code" in cause &&
  (cause as { code?: string }).code === "ENOENT";

export const appendHistoryEvent = async (
  projectDir: string,
  event: HistoryEvent,
): Promise<Result<void, FilesystemError | ValidationError>> => {
  const validation = validateHistoryEvent(event);
  if (isErr(validation)) {
    return validation;
  }
  const path = resolveHistoryPath(projectDir);
  try {
    await mkdir(dirname(path), { recursive: true });
  } catch (cause) {
    const message =
      cause instanceof Error
        ? cause.message
        : "Failed to create .nook directory.";
    return err(new FilesystemError(message, dirname(path), { cause }));
  }
  try {
    await appendFile(path, `${JSON.stringify(validation.value)}\n`, "utf8");
    return ok(undefined);
  } catch (cause) {
    const message =
      cause instanceof Error
        ? cause.message
        : "Failed to append history event.";
    return err(new FilesystemError(message, path, { cause }));
  }
};

export const readHistoryEvents = async (
  projectDir: string,
): Promise<Result<readonly HistoryEvent[], FilesystemError | ValidationError>> => {
  const path = resolveHistoryPath(projectDir);
  let text: string;
  try {
    text = await readFile(path, "utf8");
  } catch (cause) {
    if (isMissingFile(cause)) {
      return ok([]);
    }
    const message =
      cause instanceof Error ? cause.message : "Failed to read history file.";
    return err(new FilesystemError(message, path, { cause }));
  }

  if (text.length === 0) {
    return ok([]);
  }

  const trimmed = text.endsWith("\n") ? text.slice(0, -1) : text;
  const lines = trimmed.split("\n");
  const events: HistoryEvent[] = [];
  for (const line of lines) {
    if (line.length === 0) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch (cause) {
      const message =
        cause instanceof Error
          ? cause.message
          : "Failed to parse history line.";
      return err(new FilesystemError(message, path, { cause }));
    }
    const validation = validateHistoryEvent(parsed);
    if (isErr(validation)) {
      return validation;
    }
    events.push(validation.value);
  }
  return ok(events);
};
