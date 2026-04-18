import { CommandError } from "./command-error.ts";

export type ValidationIssue = {
  readonly path: string;
  readonly message: string;
};

export class ValidationError extends CommandError {
  readonly issues: readonly ValidationIssue[];
  readonly source?: string;

  constructor(
    message: string,
    issues: readonly ValidationIssue[],
    source?: string,
  ) {
    super("validation", message);
    this.name = "ValidationError";
    this.issues = issues;
    if (source !== undefined) {
      this.source = source;
    }
  }
}
