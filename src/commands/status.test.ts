import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { CommandContext, UI } from "../cli/command-types.ts";
import type { GlobalConfig, ProjectMetadata } from "../core/project-types.ts";
import { resolveAppPaths } from "../platform/app-paths.ts";
import { findProject } from "../storage/find-project.ts";
import {
  appendHistoryEvent,
  readHistoryEvents,
} from "../storage/project-history.ts";
import {
  readGlobalConfig,
  writeGlobalConfig,
} from "../storage/global-config.ts";
import { openIndex } from "../storage/project-index.ts";
import {
  readProjectMetadata,
  writeProjectMetadata,
} from "../storage/project-metadata.ts";
import type { ProjectStatusSummary } from "../ui/render-status.ts";
import { handleStatus } from "./status.ts";

const NOW = 1_700_000_000_000;
const DAY_MS = 86_400_000;

const metadataFor = (overrides: Partial<ProjectMetadata>): ProjectMetadata => ({
  id: "01HAAAAAAAAAAAAAAAAAAAAAAA",
  name: "placeholder",
  category: "work",
  state: "active",
  created_at: NOW - 5 * DAY_MS,
  tags: [],
  scratch: false,
  ...overrides,
});

const writeProject = async (
  rootDir: string,
  relativePath: string,
  metadata: ProjectMetadata,
): Promise<string> => {
  const projectDir = join(rootDir, relativePath);
  await mkdir(join(projectDir, ".nook"), { recursive: true });
  await writeFile(
    join(projectDir, ".nook", "project.jsonc"),
    JSON.stringify(metadata, null, 2),
    "utf8",
  );
  return projectDir;
};

type Bundle = {
  readonly ctx: CommandContext;
  readonly rootDir: string;
  readonly info: string[];
  readonly renderedSummaries: ProjectStatusSummary[];
};

const buildContext = async (workdir: string): Promise<Bundle> => {
  const appPaths = resolveAppPaths({
    platform: "linux",
    env: { XDG_CONFIG_HOME: join(workdir, "cfg") },
    homeDir: workdir,
  });
  const rootDir = join(workdir, "Projects");
  const config: GlobalConfig = {
    root: rootDir,
    defaults: {
      staleness_days: 60,
      on_stale: "prompt",
      scratch_prune_days: 7,
      pause_max_days: 90,
    },
    editors: {},
    ai: {},
    categories: { lab: { staleness_days: 14 }, work: {} },
    aliases: {},
  };
  await mkdir(appPaths.config, { recursive: true });
  await writeFile(
    appPaths.configFilePath,
    JSON.stringify(config, null, 2),
    "utf8",
  );
  await mkdir(rootDir, { recursive: true });

  const info: string[] = [];
  const renderedSummaries: ProjectStatusSummary[] = [];

  const ui: UI = {
    logger: {
      info: (m) => info.push(m),
      warn: () => {},
      error: () => {},
      debug: () => {},
    },
    createSpinner: (() => {
      throw new Error("unused");
    }) as unknown as UI["createSpinner"],
    promptSelect: (() => {
      throw new Error("unused");
    }) as unknown as UI["promptSelect"],
    promptConfirm: (() => {
      throw new Error("unused");
    }) as unknown as UI["promptConfirm"],
    promptInput: (() => {
      throw new Error("unused");
    }) as unknown as UI["promptInput"],
    renderProjectList: (() => "") as unknown as UI["renderProjectList"],
    renderStatus: ((summary: ProjectStatusSummary) => {
      renderedSummaries.push(summary);
      return "<rendered>";
    }) as unknown as UI["renderStatus"],
    launchEditor: (() => {
      throw new Error("unused");
    }) as unknown as UI["launchEditor"],
    detectBinaryOnPath: (async () => null) as UI["detectBinaryOnPath"],
    detectShell: (() => null) as UI["detectShell"],
    installRcIntegration: (() => {
      throw new Error("unused");
    }) as unknown as UI["installRcIntegration"],
  };

  const ctx: CommandContext = {
    config,
    storage: {
      readProjectMetadata,
      writeProjectMetadata,
      appendHistoryEvent,
      readHistoryEvents,
      readGlobalConfig,
      writeGlobalConfig,
      openIndex,
      findProject,
    },
    ui,
    clock: { now: () => NOW },
    random: { next: () => 0 },
    cwd: workdir,
    appPaths,
    runResult: () => {},
  };

  return { ctx, rootDir, info, renderedSummaries };
};

describe("handleStatus", () => {
  let workdir: string;

  beforeEach(async () => {
    workdir = await mkdtemp(join(tmpdir(), "nook-status-"));
  });

  afterEach(async () => {
    await rm(workdir, { recursive: true, force: true });
  });

  test("summarizes counts per state excluding archived/shipped", async () => {
    const bundle = await buildContext(workdir);
    await writeProject(
      bundle.rootDir,
      "work/a",
      metadataFor({ id: "01H00000000000000000000001", name: "a", state: "active" }),
    );
    await writeProject(
      bundle.rootDir,
      "work/b",
      metadataFor({ id: "01H00000000000000000000002", name: "b", state: "active" }),
    );
    await writeProject(
      bundle.rootDir,
      "work/c",
      metadataFor({
        id: "01H00000000000000000000003",
        name: "c",
        state: "paused",
        paused_until: NOW + 10 * DAY_MS,
      }),
    );
    await writeProject(
      bundle.rootDir,
      "work/shipped/d",
      metadataFor({ id: "01H00000000000000000000004", name: "d", state: "shipped" }),
    );
    await writeProject(
      bundle.rootDir,
      "work/archived/e",
      metadataFor({
        id: "01H00000000000000000000005",
        name: "e",
        state: "archived",
      }),
    );

    const result = await handleStatus({}, bundle.ctx);

    expect(result.ok).toBe(true);
    expect(bundle.renderedSummaries.length).toBe(1);
    const summary = bundle.renderedSummaries[0]!;
    const byState = Object.fromEntries(
      summary.stateCounts.map((c) => [c.state, c.count]),
    );
    expect(byState["active"]).toBe(2);
    expect(byState["paused"]).toBe(1);
    expect(byState["shipped"]).toBeUndefined();
    expect(byState["archived"]).toBeUndefined();
  });

  test("surfaces stale projects in the highlights block", async () => {
    const bundle = await buildContext(workdir);
    await writeProject(
      bundle.rootDir,
      "work/fresh",
      metadataFor({
        id: "01H00000000000000000000001",
        name: "fresh",
        created_at: NOW - 1 * DAY_MS,
      }),
    );
    await writeProject(
      bundle.rootDir,
      "work/stale",
      metadataFor({
        id: "01H00000000000000000000002",
        name: "stale",
        created_at: NOW - 90 * DAY_MS,
      }),
    );

    const result = await handleStatus({}, bundle.ctx);

    expect(result.ok).toBe(true);
    const summary = bundle.renderedSummaries[0]!;
    const stale = summary.highlights.find((h) => h.label.toLowerCase().includes("stale"));
    expect(stale).toBeDefined();
    expect(stale!.items.some((item) => item.includes("stale"))).toBe(true);
    expect(stale!.items.some((item) => item.includes("fresh"))).toBe(false);
  });

  test("surfaces pauses expiring within 7 days", async () => {
    const bundle = await buildContext(workdir);
    await writeProject(
      bundle.rootDir,
      "work/soon",
      metadataFor({
        id: "01H00000000000000000000001",
        name: "soon",
        state: "paused",
        paused_until: NOW + 3 * DAY_MS,
      }),
    );
    await writeProject(
      bundle.rootDir,
      "work/later",
      metadataFor({
        id: "01H00000000000000000000002",
        name: "later",
        state: "paused",
        paused_until: NOW + 40 * DAY_MS,
      }),
    );

    const result = await handleStatus({}, bundle.ctx);

    expect(result.ok).toBe(true);
    const summary = bundle.renderedSummaries[0]!;
    const expiring = summary.highlights.find((h) =>
      h.label.toLowerCase().includes("pause"),
    );
    expect(expiring).toBeDefined();
    expect(expiring!.items.some((item) => item.includes("soon"))).toBe(true);
    expect(expiring!.items.some((item) => item.includes("later"))).toBe(false);
  });

  test("--quiet suppresses output when nothing needs attention", async () => {
    const bundle = await buildContext(workdir);

    const result = await handleStatus({ quiet: true }, bundle.ctx);

    expect(result.ok).toBe(true);
    expect(bundle.renderedSummaries.length).toBe(0);
    expect(bundle.info.length).toBe(0);
  });

  test("--quiet still renders when there are projects to report", async () => {
    const bundle = await buildContext(workdir);
    await writeProject(
      bundle.rootDir,
      "work/a",
      metadataFor({ id: "01H00000000000000000000001", name: "a" }),
    );

    const result = await handleStatus({ quiet: true }, bundle.ctx);

    expect(result.ok).toBe(true);
    expect(bundle.renderedSummaries.length).toBe(1);
  });
});
