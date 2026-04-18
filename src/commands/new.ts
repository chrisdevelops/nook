import { access, cp, mkdir, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import type { Command } from "commander";

import type { CommandContext } from "../cli/command-types.ts";
import { generateUlid } from "../core/generate-ulid.ts";
import type {
  HistoryEventCreated,
  ProjectMetadata,
  ProjectState,
} from "../core/project-types.ts";
import { err, isErr, ok, type Result } from "../core/result.ts";
import { CommandError } from "../errors/command-error.ts";
import { resolveProjectRef } from "./resolve-project-ref.ts";

const RESERVED_CATEGORIES: ReadonlySet<string> = new Set([
  "archived",
  "shipped",
]);

const VALID_NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/u;

export type CopyDir = (source: string, destination: string) => Promise<void>;

export type HandleNewDeps = {
  readonly copyDir?: CopyDir;
};

export type NewArgs = {
  readonly name: string;
  readonly category?: string;
  readonly scratch?: boolean;
  readonly template?: string;
  readonly fork?: string;
  readonly description?: string;
  readonly tags?: string;
  readonly noOpen?: boolean;
};

const defaultCopyDir: CopyDir = async (source, destination) => {
  await cp(source, destination, {
    recursive: true,
    errorOnExist: true,
    force: false,
  });
};

const pathExists = async (path: string): Promise<boolean> => {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
};

const parseTags = (raw: string | undefined): readonly string[] => {
  if (raw === undefined) return [];
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
};

export const handleNew = async (
  args: NewArgs,
  ctx: CommandContext,
  deps?: HandleNewDeps,
): Promise<Result<void, CommandError>> => {
  if (!VALID_NAME_PATTERN.test(args.name)) {
    return err(
      new CommandError(
        "validation",
        `Invalid project name '${args.name}'. Use letters, digits, dot, underscore, or hyphen; must start with a letter or digit.`,
      ),
    );
  }

  if (args.template !== undefined && args.fork !== undefined) {
    return err(
      new CommandError(
        "validation",
        "Pass either --template or --fork, not both.",
      ),
    );
  }

  const category = args.category ?? "lab";
  if (RESERVED_CATEGORIES.has(category)) {
    return err(
      new CommandError(
        "validation",
        `Category '${category}' is reserved and cannot be used.`,
      ),
    );
  }
  if (!Object.prototype.hasOwnProperty.call(ctx.config.categories, category)) {
    return err(
      new CommandError(
        "validation",
        `Unknown category '${category}'. Add it via 'nook config edit' first.`,
      ),
    );
  }

  const state: ProjectState = category === "lab" ? "incubating" : "active";
  const destination = join(ctx.config.root, category, args.name);
  if (await pathExists(destination)) {
    return err(
      new CommandError(
        "conflict",
        `Destination already exists: ${destination}.`,
      ),
    );
  }

  let forkSourcePath: string | undefined;
  if (args.fork !== undefined) {
    const resolved = await resolveProjectRef(ctx, args.fork);
    if (isErr(resolved)) {
      return resolved;
    }
    forkSourcePath = resolved.value.path;
  }

  const copyDir = deps?.copyDir ?? defaultCopyDir;

  try {
    await mkdir(join(ctx.config.root, category), { recursive: true });
  } catch (cause) {
    const message =
      cause instanceof Error
        ? cause.message
        : "Failed to ensure category directory.";
    return err(new CommandError("filesystem", message, { cause }));
  }

  if (args.template !== undefined) {
    try {
      await copyDir(resolve(args.template), destination);
    } catch (cause) {
      const message =
        cause instanceof Error
          ? cause.message
          : "Failed to copy template contents.";
      return err(new CommandError("filesystem", message, { cause }));
    }
  } else if (forkSourcePath !== undefined) {
    try {
      await copyDir(forkSourcePath, destination);
    } catch (cause) {
      const message =
        cause instanceof Error
          ? cause.message
          : "Failed to copy source project.";
      return err(new CommandError("filesystem", message, { cause }));
    }
    await rm(join(destination, ".nook"), { recursive: true, force: true });
  } else {
    try {
      await mkdir(destination, { recursive: true });
    } catch (cause) {
      const message =
        cause instanceof Error
          ? cause.message
          : "Failed to create project directory.";
      return err(new CommandError("filesystem", message, { cause }));
    }
  }

  const now = ctx.clock.now();
  const id = generateUlid({ now: () => now, random: ctx.random.next });
  const tags = parseTags(args.tags);
  const metadata: ProjectMetadata = {
    id,
    name: args.name,
    category,
    state,
    created_at: now,
    tags,
    scratch: args.scratch === true,
    ...(args.description !== undefined
      ? { description: args.description }
      : {}),
  };
  const writeResult = await ctx.storage.writeProjectMetadata(
    destination,
    metadata,
  );
  if (isErr(writeResult)) {
    return err(
      new CommandError(
        "filesystem",
        `Failed to write project metadata: ${writeResult.error.message}`,
        { cause: writeResult.error },
      ),
    );
  }

  const event: HistoryEventCreated = {
    type: "created",
    at: now,
    source: "new",
    ...(args.template !== undefined
      ? { template: resolve(args.template) }
      : {}),
    ...(forkSourcePath !== undefined ? { fork: forkSourcePath } : {}),
  };
  const appendResult = await ctx.storage.appendHistoryEvent(destination, event);
  if (isErr(appendResult)) {
    return err(
      new CommandError(
        "filesystem",
        `Failed to append history event: ${appendResult.error.message}`,
        { cause: appendResult.error },
      ),
    );
  }

  ctx.ui.logger.info(
    `Created '${args.name}' at ${destination} (${category}/${state}).`,
  );

  if (args.noOpen !== true && ctx.config.editors.default !== undefined) {
    const launchResult = await ctx.ui.launchEditor({
      editor: ctx.config.editors.default,
      projectPath: destination,
    });
    if (isErr(launchResult)) {
      ctx.ui.logger.warn(
        `Could not open editor: ${launchResult.error.message}`,
      );
    }
  }

  return ok(undefined);
};

export const registerNewCommand = (
  program: Command,
  ctx: CommandContext,
): void => {
  program
    .command("new <name>")
    .description("Create a new project")
    .option("--category <name>", "Create directly in a category folder")
    .option("--scratch", "Mark as scratch; auto-prunes after the configured window")
    .option("--template <source>", "Scaffold from a local path")
    .option("--fork <project>", "Copy an existing project as a starting point")
    .option("--description <text>", "Project description")
    .option("--tags <list>", "Comma-separated tags")
    .option("--no-open", "Do not open the project after creation")
    .action(
      async (
        name: string,
        options: {
          category?: string;
          scratch?: boolean;
          template?: string;
          fork?: string;
          description?: string;
          tags?: string;
          open?: boolean;
        },
      ) => {
        // commander inverts --no-open into `open: false`.
        const noOpen = options.open === false;
        ctx.runResult(
          await handleNew(
            {
              name,
              ...(options.category !== undefined
                ? { category: options.category }
                : {}),
              ...(options.scratch === true ? { scratch: true } : {}),
              ...(options.template !== undefined
                ? { template: options.template }
                : {}),
              ...(options.fork !== undefined ? { fork: options.fork } : {}),
              ...(options.description !== undefined
                ? { description: options.description }
                : {}),
              ...(options.tags !== undefined ? { tags: options.tags } : {}),
              ...(noOpen ? { noOpen: true } : {}),
            },
            ctx,
          ),
        );
      },
    );
};
