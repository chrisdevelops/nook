import { mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import type { Command } from "commander";

import type { CommandContext, CommandHandler } from "../cli/command-types.ts";
import type {
  CategoryConfig,
  GlobalConfig,
  OnStaleAction,
} from "../core/project-types.ts";
import { err, isErr, ok, type Result } from "../core/result.ts";
import { CommandError } from "../errors/command-error.ts";
import { findRcFile } from "../shell/find-rc-file.ts";
import { generateSnippet } from "../shell/generate-snippet.ts";

type InitArgs = {
  readonly root?: string;
  readonly categories?: string;
  readonly force?: boolean;
};

const RESERVED_CATEGORIES: ReadonlySet<string> = new Set([
  "lab",
  "archived",
  "shipped",
]);

const EDITOR_CANDIDATES = [
  "code",
  "cursor",
  "zed",
  "nvim",
  "vim",
] as const;

const AI_CANDIDATES = [
  "claude",
  "codex",
  "opencode",
  "pi",
] as const;

const SKIP = "__skip";
const OTHER = "__other";

const expandHome = (path: string): string =>
  path.startsWith("~/") ? join(homedir(), path.slice(2)) : path;

const parsePositiveInt = (raw: string): number | null => {
  const trimmed = raw.trim();
  if (!/^[0-9]+$/u.test(trimmed)) return null;
  const n = Number(trimmed);
  return Number.isFinite(n) && n > 0 ? n : null;
};

const parseCategoryList = (
  raw: string,
): Result<readonly string[], CommandError> => {
  const parts = raw
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  if (parts.length === 0) {
    return err(
      new CommandError("validation", "At least one category is required."),
    );
  }
  const reserved = parts.filter((p) => RESERVED_CATEGORIES.has(p));
  if (reserved.length > 0) {
    return err(
      new CommandError(
        "validation",
        `Reserved category names cannot be used: ${reserved.join(", ")}.`,
      ),
    );
  }
  const seen = new Set<string>();
  const deduped: string[] = [];
  for (const p of parts) {
    if (!seen.has(p)) {
      seen.add(p);
      deduped.push(p);
    }
  }
  return ok(deduped);
};

const detectCandidates = async (
  ctx: CommandContext,
  names: readonly string[],
): Promise<readonly string[]> => {
  const found: string[] = [];
  for (const name of names) {
    const path = await ctx.ui.detectBinaryOnPath(name);
    if (path !== null) found.push(name);
  }
  return found;
};

const promptForLaunchTarget = async (
  ctx: CommandContext,
  options: {
    readonly label: string;
    readonly message: string;
    readonly customMessage: string;
    readonly candidates: readonly string[];
  },
): Promise<string | null> => {
  const detected = await detectCandidates(ctx, options.candidates);
  const choices = [
    ...detected.map((name) => ({ value: name, name })),
    { value: OTHER, name: "Other (enter command)" },
    { value: SKIP, name: "Skip" },
  ];
  const picked = await ctx.ui.promptSelect({
    message: options.message,
    choices,
  });
  if (picked === SKIP) return null;
  if (picked === OTHER) {
    const custom = await ctx.ui.promptInput({
      message: options.customMessage,
      required: true,
    });
    const trimmed = custom.trim();
    return trimmed.length > 0 ? trimmed : null;
  }
  return picked as string;
};

const buildConfig = (input: {
  readonly root: string;
  readonly categories: readonly string[];
  readonly stalenessDays: number;
  readonly scratchPruneDays: number;
  readonly editor: string | null;
  readonly aiTool: string | null;
}): GlobalConfig => {
  const onStale: OnStaleAction = "prompt";
  const categories: Record<string, CategoryConfig> = {
    lab: { staleness_days: 14, on_stale: "prompt_prune" },
  };
  for (const name of input.categories) {
    categories[name] = {};
  }
  return {
    root: input.root,
    defaults: {
      staleness_days: input.stalenessDays,
      on_stale: onStale,
      scratch_prune_days: input.scratchPruneDays,
      pause_max_days: 90,
    },
    editors: input.editor !== null ? { default: input.editor } : {},
    ai: input.aiTool !== null ? { default: input.aiTool } : {},
    categories,
    aliases: {},
  };
};

const summarize = (config: GlobalConfig): string =>
  JSON.stringify(config, null, 2);

export const handleInit: CommandHandler<InitArgs> = async (args, ctx) => {
  const configPath = ctx.appPaths.configFilePath;
  const existing = Bun.file(configPath);
  if ((await existing.exists()) && args.force !== true) {
    return err(
      new CommandError(
        "conflict",
        `Config already exists at ${configPath}. Re-run with --force to overwrite.`,
      ),
    );
  }

  const rawRoot = await ctx.ui.promptInput({
    message: "Project root — where your projects will live (e.g. ~/Projects).",
    default: args.root ?? "~/Projects",
    required: true,
  });
  const root = expandHome(rawRoot.trim());
  if (root.length === 0) {
    return err(new CommandError("validation", "Project root cannot be empty."));
  }

  const rawCategories = await ctx.ui.promptInput({
    message:
      "Categories — comma-separated folder names for promoted projects (e.g. active,client,oss). 'lab', 'archived', and 'shipped' are reserved.",
    default: args.categories ?? "active",
    required: true,
  });
  const catResult = parseCategoryList(rawCategories);
  if (isErr(catResult)) return catResult;

  const rawStaleness = await ctx.ui.promptInput({
    message:
      "Staleness threshold — days of no activity before a project is flagged stale.",
    default: "60",
    required: true,
  });
  const stalenessDays = parsePositiveInt(rawStaleness);
  if (stalenessDays === null) {
    return err(
      new CommandError(
        "validation",
        "Staleness threshold must be a positive integer.",
      ),
    );
  }

  const rawScratch = await ctx.ui.promptInput({
    message:
      "Scratch prune window — days before --scratch projects auto-delete.",
    default: "7",
    required: true,
  });
  const scratchPruneDays = parsePositiveInt(rawScratch);
  if (scratchPruneDays === null) {
    return err(
      new CommandError(
        "validation",
        "Scratch prune window must be a positive integer.",
      ),
    );
  }

  const editor = await promptForLaunchTarget(ctx, {
    label: "editor",
    message:
      "Default editor — used by 'nook code <project>'. Override per-invocation with --with.",
    customMessage: "Editor command (e.g. 'code', 'code --wait')",
    candidates: EDITOR_CANDIDATES,
  });

  const aiTool = await promptForLaunchTarget(ctx, {
    label: "ai tool",
    message:
      "Default AI tool — used by 'nook ai <project>'. Skip if you don't use an agentic CLI.",
    customMessage: "AI tool command (e.g. 'claude', 'codex')",
    candidates: AI_CANDIDATES,
  });

  const shell = ctx.ui.detectShell({
    env: process.env,
    platform: process.platform,
  });
  let rcPath: string | null = null;
  let rcSnippet: string | null = null;
  let installShell = false;
  if (shell !== null) {
    rcPath = findRcFile({
      shell,
      env: process.env,
      platform: process.platform,
    });
    rcSnippet = generateSnippet(shell);
    ctx.ui.logger.info("Shell integration snippet:");
    ctx.ui.logger.info(rcSnippet);
    installShell = await ctx.ui.promptConfirm({
      message: `Add this to ${rcPath}?`,
      default: true,
    });
    if (!installShell) {
      ctx.ui.logger.info(
        "Paste the snippet above into your rc file when ready.",
      );
    }
  } else {
    ctx.ui.logger.info(
      "Could not detect your shell automatically. Skipping shell integration.",
    );
  }

  const config = buildConfig({
    root,
    categories: catResult.value,
    stalenessDays,
    scratchPruneDays,
    editor,
    aiTool,
  });
  ctx.ui.logger.info("Resolved configuration:");
  ctx.ui.logger.info(summarize(config));
  const writeConfirmed = await ctx.ui.promptConfirm({
    message: "Write this config?",
    default: true,
  });
  if (!writeConfirmed) {
    ctx.ui.logger.info("Cancelled. No changes made.");
    return ok(undefined);
  }

  try {
    await mkdir(root, { recursive: true });
    await mkdir(join(root, "lab"), { recursive: true });
    for (const cat of catResult.value) {
      await mkdir(join(root, cat), { recursive: true });
    }
  } catch (cause) {
    const message =
      cause instanceof Error
        ? cause.message
        : "Failed to create project directories.";
    return err(new CommandError("filesystem", message, { cause }));
  }

  const writeResult = await ctx.storage.writeGlobalConfig(configPath, config);
  if (isErr(writeResult)) {
    return err(
      new CommandError(
        "filesystem",
        `Failed to write config: ${writeResult.error.message}`,
        { cause: writeResult.error },
      ),
    );
  }

  if (installShell && rcPath !== null && rcSnippet !== null) {
    const rcResult = await ctx.ui.installRcIntegration({
      rcPath,
      snippet: rcSnippet,
    });
    if (isErr(rcResult)) {
      ctx.ui.logger.warn(
        `Could not install shell snippet: ${rcResult.error.message}. Paste the snippet manually.`,
      );
    } else {
      ctx.ui.logger.info(`Shell integration ${rcResult.value} in ${rcPath}.`);
    }
  }

  ctx.ui.logger.info(
    "Next: 'nook new my-first-project' to create a project, or 'nook --help' for the full surface.",
  );
  return ok(undefined);
};

export const registerInitCommand = (
  program: Command,
  ctx: CommandContext,
): void => {
  program
    .command("init")
    .description(
      "First-run setup: create project root, category folders, and global config",
    )
    .option("--root <path>", "Project root directory")
    .option("--categories <list>", "Comma-separated category names")
    .option("--force", "Overwrite existing config if present")
    .action(
      async (options: {
        root?: string;
        categories?: string;
        force?: boolean;
      }) => {
        ctx.runResult(await handleInit(options, ctx));
      },
    );
};
