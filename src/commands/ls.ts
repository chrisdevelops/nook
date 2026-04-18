import type { Command } from "commander";

import type { CommandContext, CommandHandler } from "../cli/command-types.ts";
import { resolveCategoryConfig } from "../core/resolve-category-config.ts";
import {
  projectStates,
  type ProjectState,
} from "../core/project-types.ts";
import { err, isErr, ok } from "../core/result.ts";
import { isStale } from "../core/staleness.ts";
import { CommandError } from "../errors/command-error.ts";
import type {
  ProjectListRow,
  ProjectListSection,
} from "../ui/render-project-list.ts";
import {
  loadAllProjects,
  type LoadedProject,
} from "./load-all-projects.ts";

export type LsSort = "touched" | "created" | "name";

export type LsArgs = {
  readonly category?: string;
  readonly state?: string;
  readonly stale?: boolean;
  readonly maintained?: boolean;
  readonly tags?: readonly string[];
  readonly sort?: string;
  readonly json?: boolean;
  readonly all?: boolean;
};

const VALID_SORTS: readonly LsSort[] = ["touched", "created", "name"];

const isProjectState = (value: string): value is ProjectState =>
  (projectStates as readonly string[]).includes(value);

const isLsSort = (value: string): value is LsSort =>
  (VALID_SORTS as readonly string[]).includes(value);

const HIDDEN_BY_DEFAULT: ReadonlySet<ProjectState> = new Set([
  "archived",
  "shipped",
]);

const formatRelative = (nowMs: number, thenMs: number): string => {
  const delta = Math.max(0, nowMs - thenMs);
  const dayMs = 86_400_000;
  const days = Math.floor(delta / dayMs);
  if (days < 1) return "today";
  if (days < 7) return `${days}d ago`;
  if (days < 30) return `${Math.floor(days / 7)}w ago`;
  if (days < 365) return `${Math.floor(days / 30)}mo ago`;
  return `${Math.floor(days / 365)}y ago`;
};

const compare = (sort: LsSort, a: LoadedProject, b: LoadedProject): number => {
  if (sort === "touched") return b.lastTouchedMs - a.lastTouchedMs;
  if (sort === "created") return b.metadata.created_at - a.metadata.created_at;
  return a.metadata.name.localeCompare(b.metadata.name);
};

const buildCategorySections = (
  projects: readonly LoadedProject[],
  rowFor: (p: LoadedProject) => ProjectListRow,
): ProjectListSection[] => {
  const byCategory = new Map<string, LoadedProject[]>();
  for (const p of projects) {
    const list = byCategory.get(p.metadata.category);
    if (list === undefined) {
      byCategory.set(p.metadata.category, [p]);
    } else {
      list.push(p);
    }
  }
  const categories = [...byCategory.keys()].sort();
  return categories.map((cat) => ({
    heading: `${cat}/`,
    rows: (byCategory.get(cat) ?? []).map(rowFor),
  }));
};

export const handleLs: CommandHandler<LsArgs> = async (args, ctx) => {
  if (args.state !== undefined && !isProjectState(args.state)) {
    return err(
      new CommandError(
        "validation",
        `--state must be one of ${projectStates.join(", ")}; got '${args.state}'.`,
      ),
    );
  }
  if (args.sort !== undefined && !isLsSort(args.sort)) {
    return err(
      new CommandError(
        "validation",
        `--sort must be one of ${VALID_SORTS.join(", ")}; got '${args.sort}'.`,
      ),
    );
  }
  const sort: LsSort =
    args.sort !== undefined && isLsSort(args.sort) ? args.sort : "touched";

  const loaded = await loadAllProjects(ctx);
  if (isErr(loaded)) {
    return err(loaded.error);
  }
  const { config, projects } = loaded.value;
  const now = ctx.clock.now();

  const staleFor = (project: LoadedProject): boolean => {
    if (project.metadata.state === "paused") return false;
    if (project.metadata.state === "shipped") return false;
    if (project.metadata.state === "archived") return false;
    const cat = resolveCategoryConfig(config, project.metadata.category);
    return isStale(project.lastTouchedMs, cat.staleness_days, now);
  };

  const desiredTags = args.tags ?? [];
  const filtered = projects.filter((p) => {
    if (args.all !== true && HIDDEN_BY_DEFAULT.has(p.metadata.state)) {
      return false;
    }
    if (args.category !== undefined && p.metadata.category !== args.category) {
      return false;
    }
    if (args.state !== undefined && p.metadata.state !== args.state) {
      return false;
    }
    if (args.maintained === true && p.metadata.state !== "maintained") {
      return false;
    }
    if (args.stale === true && !staleFor(p)) {
      return false;
    }
    for (const tag of desiredTags) {
      if (!p.metadata.tags.includes(tag)) return false;
    }
    return true;
  });

  const sorted = [...filtered].sort((a, b) => compare(sort, a, b));

  if (args.json === true) {
    const payload = sorted.map((p) => ({
      id: p.metadata.id,
      name: p.metadata.name,
      category: p.metadata.category,
      state: p.metadata.state,
      path: p.path,
      tags: p.metadata.tags,
      scratch: p.metadata.scratch,
      created_at: p.metadata.created_at,
      last_touched: p.lastTouchedMs,
      stale: staleFor(p),
      ...(p.metadata.description !== undefined
        ? { description: p.metadata.description }
        : {}),
      ...(p.metadata.paused_until !== undefined
        ? { paused_until: p.metadata.paused_until }
        : {}),
    }));
    ctx.ui.logger.info(JSON.stringify(payload, null, 2));
    return ok(undefined);
  }

  const rowFor = (p: LoadedProject): ProjectListRow => ({
    name: p.metadata.name,
    state: p.metadata.state,
    category: p.metadata.category,
    lastTouched: formatRelative(now, p.lastTouchedMs),
    tags: p.metadata.tags,
    stale: staleFor(p),
  });

  const sections: ProjectListSection[] =
    args.category !== undefined
      ? [{ rows: sorted.map(rowFor) }]
      : buildCategorySections(sorted, rowFor);

  const rendered = ctx.ui.renderProjectList(sections, { color: true });
  ctx.ui.logger.info(rendered);
  return ok(undefined);
};

export const registerLsCommand = (
  program: Command,
  ctx: CommandContext,
): void => {
  program
    .command("ls [category]")
    .description("List projects, grouped by category by default")
    .option("--state <state>", "Filter by state")
    .option("--stale", "Show only stale projects")
    .option("--maintained", "Show only maintained projects")
    .option(
      "--tag <tag>",
      "Filter by tag; repeat to require multiple tags",
      (value: string, previous: readonly string[] = []) => [...previous, value],
    )
    .option(
      "--sort <field>",
      "Sort by 'touched', 'created', or 'name' (default touched)",
    )
    .option("--json", "Output as JSON")
    .option("--all", "Include archived and shipped projects")
    .action(
      async (
        category: string | undefined,
        options: {
          state?: string;
          stale?: boolean;
          maintained?: boolean;
          tag?: readonly string[];
          sort?: string;
          json?: boolean;
          all?: boolean;
        },
      ) => {
        ctx.runResult(
          await handleLs(
            {
              ...(category !== undefined ? { category } : {}),
              ...(options.state !== undefined ? { state: options.state } : {}),
              ...(options.stale === true ? { stale: true } : {}),
              ...(options.maintained === true ? { maintained: true } : {}),
              ...(options.tag !== undefined ? { tags: options.tag } : {}),
              ...(options.sort !== undefined ? { sort: options.sort } : {}),
              ...(options.json === true ? { json: true } : {}),
              ...(options.all === true ? { all: true } : {}),
            },
            ctx,
          ),
        );
      },
    );
};
