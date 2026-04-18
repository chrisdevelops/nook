import { describe, expect, test } from "bun:test";

import { main } from "./main.ts";

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

describe("main", () => {
  test("with no args, exits 0 (commander prints help)", async () => {
    const exitCode = await main([], {
      stdout: capture(),
      stderr: capture(),
      packageVersion: "1.2.3",
    });
    expect(exitCode).toBe(0);
  });

  test("--version exits 0", async () => {
    const exitCode = await main(["--version"], {
      stdout: capture(),
      stderr: capture(),
      packageVersion: "9.9.9",
    });
    expect(exitCode).toBe(0);
  });

  test("--help exits 0", async () => {
    const exitCode = await main(["--help"], {
      stdout: capture(),
      stderr: capture(),
      packageVersion: "1.0.0",
    });
    expect(exitCode).toBe(0);
  });

  test("unknown flags do not throw", async () => {
    const exitCode = await main(["--definitely-not-a-flag"], {
      stdout: capture(),
      stderr: capture(),
      packageVersion: "1.0.0",
    });
    expect(Number.isInteger(exitCode)).toBe(true);
  });
});
