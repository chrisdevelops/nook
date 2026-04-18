export const commandErrorCodes = [
  "state_transition",
  "validation",
  "filesystem",
  "not_found",
  "ambiguous_match",
  "conflict",
  "unknown",
] as const;

export type CommandErrorCode = (typeof commandErrorCodes)[number];

export class CommandError extends Error {
  readonly code: CommandErrorCode;

  constructor(
    code: CommandErrorCode,
    message: string,
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = "CommandError";
    this.code = code;
  }
}
