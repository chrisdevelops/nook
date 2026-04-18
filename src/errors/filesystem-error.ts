import { CommandError } from "./command-error.ts";

export class FilesystemError extends CommandError {
  readonly path: string;

  constructor(message: string, path: string, options?: { cause?: unknown }) {
    super("filesystem", message, options);
    this.name = "FilesystemError";
    this.path = path;
  }
}
