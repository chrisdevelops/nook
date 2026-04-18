import { describe, expect, test } from "bun:test";

import { buildProgram } from "./build-program.ts";

const findOption = (
  program: ReturnType<typeof buildProgram>,
  long: string,
) => program.options.find((option) => option.long === long);

describe("buildProgram", () => {
  test("sets the binary name passed in", () => {
    const program = buildProgram({ name: "nook", version: "1.2.3" });
    expect(program.name()).toBe("nook");
  });

  test("registers --version with the provided version string", () => {
    const program = buildProgram({ name: "nook", version: "1.2.3" });
    expect(program.version()).toBe("1.2.3");
  });

  test("does not bind -v to --version (reserved for --verbose)", () => {
    const program = buildProgram({ name: "nook", version: "1.2.3" });
    const versionOption = findOption(program, "--version");
    expect(versionOption).toBeDefined();
    expect(versionOption?.short).toBeUndefined();
  });

  test("registers --quiet with -q alias", () => {
    const program = buildProgram({ name: "nook", version: "1.2.3" });
    const option = findOption(program, "--quiet");
    expect(option).toBeDefined();
    expect(option?.short).toBe("-q");
  });

  test("registers --verbose with -v alias", () => {
    const program = buildProgram({ name: "nook", version: "1.2.3" });
    const option = findOption(program, "--verbose");
    expect(option).toBeDefined();
    expect(option?.short).toBe("-v");
  });

  test("registers --no-color as a negated boolean", () => {
    const program = buildProgram({ name: "nook", version: "1.2.3" });
    const option = findOption(program, "--no-color");
    expect(option).toBeDefined();
  });

  test("registers --root <path> option that takes a value", () => {
    const program = buildProgram({ name: "nook", version: "1.2.3" });
    const option = findOption(program, "--root");
    expect(option).toBeDefined();
    expect(option?.required).toBe(true);
  });

  test("parsing --quiet --verbose --no-color populates opts()", () => {
    const program = buildProgram({ name: "nook", version: "1.2.3" });
    program.parse(["--quiet", "--verbose", "--no-color"], { from: "user" });
    const opts = program.opts();
    expect(opts["quiet"]).toBe(true);
    expect(opts["verbose"]).toBe(true);
    expect(opts["color"]).toBe(false);
  });

  test("exitOverride is configured so parse errors throw instead of calling process.exit", () => {
    const program = buildProgram({ name: "nook", version: "1.2.3" });
    expect(() =>
      program.parse(["--unknown-flag"], { from: "user" }),
    ).toThrow();
  });
});
