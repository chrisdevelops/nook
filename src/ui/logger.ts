import { stripAnsi } from "./ansi-colors.ts";

export type LoggerWritable = {
  readonly write: (chunk: string) => void;
};

export type LoggerOptions = {
  readonly quiet: boolean;
  readonly verbose: boolean;
  readonly color: boolean;
  readonly stdout: LoggerWritable;
  readonly stderr: LoggerWritable;
};

export type Logger = {
  readonly info: (message: string) => void;
  readonly warn: (message: string) => void;
  readonly error: (message: string) => void;
  readonly debug: (message: string) => void;
};

export const createLogger = (options: LoggerOptions): Logger => {
  const format = (message: string): string => {
    const rendered = options.color ? message : stripAnsi(message);
    return `${rendered}\n`;
  };

  return {
    info: (message) => {
      if (options.quiet) {
        return;
      }
      options.stdout.write(format(message));
    },
    warn: (message) => {
      if (options.quiet) {
        return;
      }
      options.stderr.write(format(message));
    },
    error: (message) => {
      options.stderr.write(format(message));
    },
    debug: (message) => {
      if (!options.verbose) {
        return;
      }
      options.stderr.write(format(message));
    },
  };
};
