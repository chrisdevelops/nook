import { describe, expect, test } from "bun:test";

import { ANSI_RED, ANSI_RESET, ANSI_YELLOW } from "./ansi-colors.ts";
import { createLogger } from "./logger.ts";

type Capture = {
  readonly chunks: string[];
  readonly write: (chunk: string) => void;
};

const capture = (): Capture => {
  const chunks: string[] = [];
  return {
    chunks,
    write: (chunk) => {
      chunks.push(chunk);
    },
  };
};

describe("createLogger", () => {
  test("info writes to stdout with a trailing newline", () => {
    const stdout = capture();
    const stderr = capture();
    const logger = createLogger({
      quiet: false,
      verbose: false,
      color: true,
      stdout,
      stderr,
    });

    logger.info("hello");

    expect(stdout.chunks).toEqual(["hello\n"]);
    expect(stderr.chunks).toEqual([]);
  });

  test("warn writes to stderr in yellow with a trailing newline", () => {
    const stdout = capture();
    const stderr = capture();
    const logger = createLogger({
      quiet: false,
      verbose: false,
      color: true,
      stdout,
      stderr,
    });

    logger.warn("careful");

    expect(stdout.chunks).toEqual([]);
    expect(stderr.chunks).toEqual([`${ANSI_YELLOW}careful${ANSI_RESET}\n`]);
  });

  test("error writes to stderr in red with a trailing newline", () => {
    const stdout = capture();
    const stderr = capture();
    const logger = createLogger({
      quiet: false,
      verbose: false,
      color: true,
      stdout,
      stderr,
    });

    logger.error("boom");

    expect(stdout.chunks).toEqual([]);
    expect(stderr.chunks).toEqual([`${ANSI_RED}boom${ANSI_RESET}\n`]);
  });

  test("warn and error emit plain text when color is disabled", () => {
    const stdout = capture();
    const stderr = capture();
    const logger = createLogger({
      quiet: false,
      verbose: false,
      color: false,
      stdout,
      stderr,
    });

    logger.warn("careful");
    logger.error("boom");

    expect(stderr.chunks).toEqual(["careful\n", "boom\n"]);
  });

  test("debug is suppressed when verbose is false", () => {
    const stdout = capture();
    const stderr = capture();
    const logger = createLogger({
      quiet: false,
      verbose: false,
      color: true,
      stdout,
      stderr,
    });

    logger.debug("internals");

    expect(stdout.chunks).toEqual([]);
    expect(stderr.chunks).toEqual([]);
  });

  test("debug writes to stderr when verbose is true", () => {
    const stdout = capture();
    const stderr = capture();
    const logger = createLogger({
      quiet: false,
      verbose: true,
      color: true,
      stdout,
      stderr,
    });

    logger.debug("internals");

    expect(stdout.chunks).toEqual([]);
    expect(stderr.chunks).toEqual(["internals\n"]);
  });

  test("quiet suppresses info and warn but not error", () => {
    const stdout = capture();
    const stderr = capture();
    const logger = createLogger({
      quiet: true,
      verbose: false,
      color: true,
      stdout,
      stderr,
    });

    logger.info("chatter");
    logger.warn("hmm");
    logger.error("fatal");

    expect(stdout.chunks).toEqual([]);
    expect(stderr.chunks).toEqual([`${ANSI_RED}fatal${ANSI_RESET}\n`]);
  });

  test("quiet still lets debug through when verbose is true", () => {
    const stdout = capture();
    const stderr = capture();
    const logger = createLogger({
      quiet: true,
      verbose: true,
      color: true,
      stdout,
      stderr,
    });

    logger.debug("still here");

    expect(stderr.chunks).toEqual(["still here\n"]);
  });

  test("color false strips ANSI escapes from messages", () => {
    const stdout = capture();
    const stderr = capture();
    const logger = createLogger({
      quiet: false,
      verbose: false,
      color: false,
      stdout,
      stderr,
    });

    logger.info(`${ANSI_RED}alert${ANSI_RESET}`);
    logger.error(`${ANSI_RED}nope${ANSI_RESET}`);

    expect(stdout.chunks).toEqual(["alert\n"]);
    expect(stderr.chunks).toEqual(["nope\n"]);
  });

  test("color true preserves ANSI escapes in messages", () => {
    const stdout = capture();
    const stderr = capture();
    const logger = createLogger({
      quiet: false,
      verbose: false,
      color: true,
      stdout,
      stderr,
    });

    const payload = `${ANSI_RED}alert${ANSI_RESET}`;
    logger.info(payload);

    expect(stdout.chunks).toEqual([`${payload}\n`]);
  });
});
