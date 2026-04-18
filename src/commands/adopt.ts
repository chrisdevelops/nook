import { access, stat } from "node:fs/promises";
import { basename, isAbsolute, join, relative, resolve, sep } from "node:path";
import type { Command } from "commander";

import type { CommandContext } from "../cli/command-types.ts";
import { generateUlid } from "../core/generate-ulid.ts";
import {
  projectStates,
  type HistoryEventCreated,
  type ProjectMetadata,
  type ProjectState,
} from "../core/project-types.ts";
import { err, isErr, ok, type Result } from "../core/result.ts";
import { CommandError } from "../errors/command-error.ts";
import { moveProject } from "../filesystem/move-project.ts";

const RESERVED_CATEGORIES: ReadonlySet<string> = new Set([
  "archived",
  "shipped",
]);

const VALID_NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/u;

export type AdoptArgs = {
  readonly path: string;
  readonly category?: string;
  readonly state?: string;
  readonly description?: string;
  readonly tags?: string;
  readonly inPlace?: boolean;
};

const parseTags = (raw: string | undefined): readonly string[] => {
  if (raw === undefined) return [];
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
};

const isProjectState = (value: string): value is ProjectState =>
  (projectStates as readonly string[]).includes(value);

const pathExists = async (path: string): Promise<boolean> => {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
};

export const handleAdopt = async (
  args: AdoptArgs,
  ctx: CommandContext,
): Promise<Result<void, CommandError>> => {
  const sourceAbs = isAbsolute(args.path)
    ? resolve(args.path)
    : resolve(ctx.cwd, args.path);

  if (!(await pathExists(sourceAbs))) {
    return err(
      new CommandError("not_found", `Source folder not found: ${sourceAbs}.`),
    );
  }
  const sourceStat = await stat(sourceAbs);
  if (!sourceStat.isDirectory()) {
    return err(
      new CommandError(
        "validation",
        `Source must be a directory: ${sourceAbs}.`,
      ),
    );
  }

  if (await pathExists(join(sourceAbs, ".nook", "project.jsonc"))) {
    return err(
      new CommandError(
        "conflict",
        `Folder is already a nook project: ${sourceAbs}.`,
      ),
    );
  }

  const name = basename(sourceAbs);
  if (!VALID_NAME_PATTERN.test(name)) {
    return err(
      new CommandError(
        "validation",
        `Folder name '${name}' cannot be used as a project name. Use letters, digits, dot, underscore, or hyphen; must start with a letter or digit.`,
      ),
    );
  }

  const rootRel = relative(ctx.config.root, sourceAbs);
  const isInsideRoot =
    rootRel.length > 0 && !rootRel.startsWith("..") && !isAbsolute(rootRel);
  const rootSegments = isInsideRoot ? rootRel.split(sep) : [];
  const inferredCategory =
    rootSegments.length >= 2 &&
    Object.prototype.hasOwnProperty.call(
      ctx.config.categories,
      rootSegments[0] as string,
    )
      ? (rootSegments[0] as string)
      : null;
  const inferredStateFromLocation: ProjectState | null =
    rootSegments.length === 3 && rootSegments[1] === "shipped"
      ? "shipped"
      : rootSegments.length === 3 && rootSegments[1] === "archived"
        ? "archived"
        : rootSegments.length === 2 && rootSegments[0] === "lab"
          ? "incubating"
          : null;

  const category = args.category ?? inferredCategory ?? "lab";
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

  let state: ProjectState;
  if (args.state !== undefined) {
    if (!isProjectState(args.state)) {
      return err(
        new CommandError(
          "validation",
          `Unknown state '${args.state}'. Expected one of ${projectStates.join(", ")}.`,
        ),
      );
    }
    state = args.state;
  } else if (inferredStateFromLocation !== null) {
    state = inferredStateFromLocation;
  } else {
    state = category === "lab" ? "incubating" : "active";
  }

  const canonicalDestination =
    state === "shipped"
      ? join(ctx.config.root, category, "shipped", name)
      : state === "archived"
        ? join(ctx.config.root, category, "archived", name)
        : join(ctx.config.root, category, name);

  const sourceAtCanonical = sourceAbs === canonicalDestination;
  const effectiveInPlace = args.inPlace === true || sourceAtCanonical;
  const destination = effectiveInPlace ? sourceAbs : canonicalDestination;

  if (!effectiveInPlace && (await pathExists(destination))) {
    return err(
      new CommandError(
        "conflict",
        `Destination already exists: ${destination}.`,
      ),
    );
  }

  if (!effectiveInPlace && sourceAbs !== destination) {
    const moveResult = await moveProject({
      source: sourceAbs,
      destination,
    });
    if (isErr(moveResult)) {
      return err(
        new CommandError(
          "filesystem",
          `Failed to move folder: ${moveResult.error.message}`,
          { cause: moveResult.error },
        ),
      );
    }
  }

  const now = ctx.clock.now();
  const id = generateUlid({ now: () => now, random: ctx.random.next });
  const tags = parseTags(args.tags);
  const metadata: ProjectMetadata = {
    id,
    name,
    category,
    state,
    created_at: now,
    tags,
    scratch: false,
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
    source: "adopt",
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
    `Adopted '${name}' at ${destination} (${category}/${state}).`,
  );
  return ok(undefined);
};

export const registerAdoptCommand = (
  program: Command,
  ctx: CommandContext,
): void => {
  program
    .command("adopt <path>")
    .description("Bring an existing folder under nook management")
    .option("--category <name>", "Target category (defaults to 'lab')")
    .option("--state <state>", "Initial state")
    .option("--description <text>", "Project description")
    .option("--tags <list>", "Comma-separated tags")
    .option("--in-place", "Do not move the folder; register it at its current path")
    .action(
      async (
        path: string,
        options: {
          category?: string;
          state?: string;
          description?: string;
          tags?: string;
          inPlace?: boolean;
        },
      ) => {
        ctx.runResult(
          await handleAdopt(
            {
              path,
              ...(options.category !== undefined
                ? { category: options.category }
                : {}),
              ...(options.state !== undefined
                ? { state: options.state }
                : {}),
              ...(options.description !== undefined
                ? { description: options.description }
                : {}),
              ...(options.tags !== undefined ? { tags: options.tags } : {}),
              ...(options.inPlace === true ? { inPlace: true } : {}),
            },
            ctx,
          ),
        );
      },
    );
};
