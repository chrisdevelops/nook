import { ValidationError } from "../errors/validation-error.ts";
import { err, ok, type Result } from "./result.ts";
import { MS_PER_DAY } from "./staleness.ts";

export type PauseInput = {
  readonly days?: number;
  readonly until?: string;
};

export const resolvePauseExpiry = (
  input: PauseInput,
  nowMs: number,
): Result<number, ValidationError> => {
  const { days, until } = input;

  if (days === undefined && until === undefined) {
    return err(
      new ValidationError(
        "Pause requires either --days or --until.",
        [{ path: "", message: "Provide one of --days or --until." }],
      ),
    );
  }

  if (days !== undefined && until !== undefined) {
    return err(
      new ValidationError(
        "Pass either --days or --until, not both.",
        [
          { path: "days", message: "Conflicts with --until." },
          { path: "until", message: "Conflicts with --days." },
        ],
      ),
    );
  }

  if (days !== undefined) {
    if (!Number.isInteger(days) || days <= 0) {
      return err(
        new ValidationError(
          "--days must be a positive integer.",
          [{ path: "days", message: `Got ${days}.` }],
        ),
      );
    }
    return ok(nowMs + days * MS_PER_DAY);
  }

  const parsed = Date.parse(until!);
  if (Number.isNaN(parsed)) {
    return err(
      new ValidationError(
        "--until must be a parseable ISO date or datetime.",
        [{ path: "until", message: `Could not parse '${until}'.` }],
      ),
    );
  }
  if (parsed <= nowMs) {
    return err(
      new ValidationError(
        "--until must be in the future.",
        [{ path: "until", message: `Resolved to ${new Date(parsed).toISOString()}, now is ${new Date(nowMs).toISOString()}.` }],
      ),
    );
  }

  return ok(parsed);
};

export const isPauseExpired = (
  pausedUntilMs: number,
  nowMs: number,
): boolean => nowMs >= pausedUntilMs;
