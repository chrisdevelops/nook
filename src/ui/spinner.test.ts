import { describe, expect, test } from "bun:test";

import { createSpinner } from "./spinner.ts";

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

describe("createSpinner", () => {
  test("in non-TTY mode, start writes a plain line", () => {
    const stream = capture();
    const spinner = createSpinner({ stream, isTty: false });

    spinner.start("scanning projects");
    spinner.stop();

    expect(stream.chunks).toEqual(["scanning projects\n"]);
  });

  test("in non-TTY mode, setText emits another plain line", () => {
    const stream = capture();
    const spinner = createSpinner({ stream, isTty: false });

    spinner.start("step one");
    spinner.setText("step two");
    spinner.stop();

    expect(stream.chunks).toEqual(["step one\n", "step two\n"]);
  });

  test("in non-TTY mode, stop with final text writes it", () => {
    const stream = capture();
    const spinner = createSpinner({ stream, isTty: false });

    spinner.start("working");
    spinner.stop("done");

    expect(stream.chunks).toEqual(["working\n", "done\n"]);
  });

  test("in TTY mode, start writes the first frame with carriage return", () => {
    const stream = capture();
    const spinner = createSpinner({
      stream,
      isTty: true,
      frames: ["-", "\\"],
    });

    spinner.start("loading");
    spinner.stop();

    expect(stream.chunks[0]).toBe("\r- loading");
  });

  test("in TTY mode, stop writes a clearing sequence and newline", () => {
    const stream = capture();
    const spinner = createSpinner({
      stream,
      isTty: true,
      frames: ["-"],
    });

    spinner.start("loading");
    spinner.stop();

    const combined = stream.chunks.join("");
    expect(combined).toContain("\r");
    expect(combined.endsWith("\n")).toBe(true);
  });
});
