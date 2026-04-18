import { describe, expect, test } from "bun:test";

import { err, ok } from "../core/result.ts";
import { CommandError } from "../errors/command-error.ts";
import type { Logger } from "../ui/logger.ts";
import { createRunResult } from "./run-command-handler.ts";

type CapturedLogger = {
  readonly logger: Logger;
  readonly info: string[];
  readonly warn: string[];
  readonly error: string[];
  readonly debug: string[];
};

const captureLogger = (): CapturedLogger => {
  const info: string[] = [];
  const warn: string[] = [];
  const error: string[] = [];
  const debug: string[] = [];
  const logger: Logger = {
    info: (message) => {
      info.push(message);
    },
    warn: (message) => {
      warn.push(message);
    },
    error: (message) => {
      error.push(message);
    },
    debug: (message) => {
      debug.push(message);
    },
  };
  return { logger, info, warn, error, debug };
};

describe("createRunResult", () => {
  test("on ok, writes nothing to the logger and does not set an exit code", () => {
    const { logger, info, warn, error, debug } = captureLogger();
    const codes: number[] = [];
    const runResult = createRunResult({
      logger,
      verbose: false,
      setExitCode: (code) => codes.push(code),
    });

    runResult(ok(undefined));

    expect(info).toEqual([]);
    expect(warn).toEqual([]);
    expect(error).toEqual([]);
    expect(debug).toEqual([]);
    expect(codes).toEqual([]);
  });

  test("on err, logs the error message to stderr and sets exit code 1", () => {
    const { logger, error } = captureLogger();
    const codes: number[] = [];
    const runResult = createRunResult({
      logger,
      verbose: false,
      setExitCode: (code) => codes.push(code),
    });

    runResult(err(new CommandError("unknown", "it broke")));

    expect(error).toEqual(["it broke"]);
    expect(codes).toEqual([1]);
  });

  test("maps validation, not_found, and ambiguous_match errors to exit code 2", () => {
    const codes: number[] = [];
    const { logger } = captureLogger();
    const runResult = createRunResult({
      logger,
      verbose: false,
      setExitCode: (code) => codes.push(code),
    });

    runResult(err(new CommandError("validation", "bad input")));
    runResult(err(new CommandError("not_found", "missing")));
    runResult(err(new CommandError("ambiguous_match", "more than one")));

    expect(codes).toEqual([2, 2, 2]);
  });

  test("does not log the cause when verbose is false", () => {
    const { logger, debug } = captureLogger();
    const runResult = createRunResult({
      logger,
      verbose: false,
      setExitCode: () => {},
    });

    const cause = new Error("underlying");
    runResult(err(new CommandError("unknown", "top-level", { cause })));

    expect(debug).toEqual([]);
  });

  test("logs the cause via debug when verbose is true and a cause exists", () => {
    const { logger, debug } = captureLogger();
    const runResult = createRunResult({
      logger,
      verbose: true,
      setExitCode: () => {},
    });

    const cause = new Error("underlying");
    runResult(err(new CommandError("unknown", "top-level", { cause })));

    expect(debug.length).toBe(1);
    expect(debug[0]).toContain("underlying");
  });

  test("no debug output when verbose is true but no cause is attached", () => {
    const { logger, debug } = captureLogger();
    const runResult = createRunResult({
      logger,
      verbose: true,
      setExitCode: () => {},
    });

    runResult(err(new CommandError("unknown", "top-level")));

    expect(debug).toEqual([]);
  });
});
