import { Command } from "commander";

export type BuildProgramOptions = {
  readonly name: string;
  readonly version: string;
};

export const buildProgram = (options: BuildProgramOptions): Command => {
  const program = new Command();
  program
    .name(options.name)
    .version(options.version, "--version", "Display the version number")
    .helpOption("-h, --help", "Display this message")
    .option("-q, --quiet", "Suppress non-essential output")
    .option("-v, --verbose", "Verbose logging")
    .option("--no-color", "Disable color output")
    .option("--root <path>", "Override the configured project root")
    .exitOverride();
  return program;
};
