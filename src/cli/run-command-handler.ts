import type { Result } from "../core/result.ts";
import type { CommandErrorCode } from "../errors/command-error.ts";
import { CommandError } from "../errors/command-error.ts";
import type { Logger } from "../ui/logger.ts";

export type CreateRunResultOptions = {
  readonly logger: Logger;
  readonly verbose: boolean;
  readonly setExitCode: (code: number) => void;
};

export type RunResult = (
  result: Result<unknown, CommandError>,
) => void;

const exitCodeFor = (code: CommandErrorCode): number => {
  switch (code) {
    case "validation":
    case "not_found":
    case "ambiguous_match":
      return 2;
    default:
      return 1;
  }
};

const formatCause = (cause: unknown): string => {
  if (cause instanceof Error) {
    return cause.stack ?? cause.message;
  }
  return String(cause);
};

export const createRunResult = (
  options: CreateRunResultOptions,
): RunResult =>
  (result) => {
    if (result.ok) {
      return;
    }
    options.logger.error(result.error.message);
    if (options.verbose && result.error.cause !== undefined) {
      options.logger.debug(formatCause(result.error.cause));
    }
    options.setExitCode(exitCodeFor(result.error.code));
  };
