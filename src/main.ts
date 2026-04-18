import { CommanderError } from "commander";

import type { GlobalConfig } from "./core/project-types.ts";
import { buildProgram } from "./cli/build-program.ts";
import type {
  Clock,
  CommandContext,
  Random,
  StorageFacade,
  UI,
} from "./cli/command-types.ts";
import { registerCommands } from "./cli/register-commands.ts";
import { createRunResult } from "./cli/run-command-handler.ts";
import { resolveAppPaths } from "./platform/app-paths.ts";
import { detectBinaryOnPath } from "./platform/detect-binary-on-path.ts";
import { launchEditor } from "./platform/launch-editor.ts";
import { detectShell } from "./shell/detect-shell.ts";
import { installRcIntegration } from "./shell/install-rc-integration.ts";
import { findProject } from "./storage/find-project.ts";
import { readGlobalConfig, writeGlobalConfig } from "./storage/global-config.ts";
import { openIndex } from "./storage/project-index.ts";
import {
  appendHistoryEvent,
  readHistoryEvents,
} from "./storage/project-history.ts";
import {
  readProjectMetadata,
  writeProjectMetadata,
} from "./storage/project-metadata.ts";
import { createLogger, type LoggerWritable } from "./ui/logger.ts";
import { promptConfirm } from "./ui/prompt-confirm.ts";
import { promptInput } from "./ui/prompt-input.ts";
import { promptSelect } from "./ui/prompt-select.ts";
import { renderProjectList } from "./ui/render-project-list.ts";
import { renderStatus } from "./ui/render-status.ts";
import { createSpinner } from "./ui/spinner.ts";

export type MainOptions = {
  readonly stdout?: LoggerWritable;
  readonly stderr?: LoggerWritable;
  readonly cwd?: string;
  readonly packageVersion?: string;
  readonly clock?: Clock;
  readonly random?: Random;
};

const defaultStdout: LoggerWritable = {
  write(chunk) {
    process.stdout.write(chunk);
  },
};

const defaultStderr: LoggerWritable = {
  write(chunk) {
    process.stderr.write(chunk);
  },
};

const hasFlag = (argv: readonly string[], ...names: string[]): boolean =>
  argv.some((value) => names.includes(value));

type GlobalFlags = {
  readonly quiet: boolean;
  readonly verbose: boolean;
  readonly color: boolean;
};

const parseGlobalFlags = (argv: readonly string[]): GlobalFlags => ({
  quiet: hasFlag(argv, "--quiet", "-q"),
  verbose: hasFlag(argv, "--verbose", "-v"),
  color: !hasFlag(argv, "--no-color"),
});

const PLACEHOLDER_CONFIG: GlobalConfig = {
  root: "",
  defaults: {
    staleness_days: 60,
    on_stale: "prompt",
    scratch_prune_days: 7,
    pause_max_days: 90,
  },
  editors: {},
  ai: {},
  categories: {},
  aliases: {},
};

const buildStorageFacade = (): StorageFacade => ({
  readProjectMetadata,
  writeProjectMetadata,
  appendHistoryEvent,
  readHistoryEvents,
  readGlobalConfig,
  writeGlobalConfig,
  openIndex,
  findProject,
});

const buildUi = (options: {
  readonly quiet: boolean;
  readonly verbose: boolean;
  readonly color: boolean;
  readonly stdout: LoggerWritable;
  readonly stderr: LoggerWritable;
}): UI => ({
  logger: createLogger({
    quiet: options.quiet,
    verbose: options.verbose,
    color: options.color,
    stdout: options.stdout,
    stderr: options.stderr,
  }),
  createSpinner,
  promptSelect,
  promptConfirm,
  promptInput,
  renderProjectList,
  renderStatus,
  launchEditor,
  detectBinaryOnPath,
  detectShell,
  installRcIntegration,
});

export const main = async (
  argv: readonly string[],
  options: MainOptions = {},
): Promise<number> => {
  const stdout = options.stdout ?? defaultStdout;
  const stderr = options.stderr ?? defaultStderr;
  const cwd = options.cwd ?? process.cwd();
  const version = options.packageVersion ?? "0.0.0";
  const clock: Clock = options.clock ?? { now: () => Date.now() };
  const random: Random = options.random ?? { next: () => Math.random() };

  const flags = parseGlobalFlags(argv);
  const ui = buildUi({
    quiet: flags.quiet,
    verbose: flags.verbose,
    color: flags.color,
    stdout,
    stderr,
  });

  let exitCode = 0;
  const setExitCode = (code: number): void => {
    exitCode = code;
  };

  const runResult = createRunResult({
    logger: ui.logger,
    verbose: flags.verbose,
    setExitCode,
  });

  const appPaths = resolveAppPaths();

  const ctx: CommandContext = {
    config: PLACEHOLDER_CONFIG,
    storage: buildStorageFacade(),
    ui,
    clock,
    random,
    cwd,
    appPaths,
    runResult,
  };

  try {
    const program = buildProgram({ name: "nook", version });
    registerCommands(program, ctx);
    await program.parseAsync(["node", "nook", ...argv]);
  } catch (thrown) {
    if (thrown instanceof CommanderError) {
      if (
        thrown.code === "commander.helpDisplayed" ||
        thrown.code === "commander.version" ||
        thrown.code === "commander.help"
      ) {
        // commander already wrote the help/version to stdout; success.
        return 0;
      }
      // Parse errors (unknown command, excess args, missing required arg) —
      // commander has already printed the message to stderr via exitOverride's
      // outputError callback. Surface as a validation-class exit code.
      exitCode = 2;
    } else {
      const message =
        thrown instanceof Error ? thrown.message : String(thrown);
      ui.logger.error(`Unexpected error: ${message}`);
      if (flags.verbose && thrown instanceof Error && thrown.stack) {
        ui.logger.debug(thrown.stack);
      }
      exitCode = 1;
    }
  }

  return exitCode;
};
