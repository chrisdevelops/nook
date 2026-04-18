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
import { handleLs } from "./ls.ts";

const NOW = 1_700_000_000_000;
const DAY_MS = 86_400_000;

const metadataFor = (overrides: Partial<ProjectMetadata>): ProjectMetadata => ({
  id: "01HZZZZZZZZZZZZZZZZZZZZZZZ",
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
  readonly renderedSections: unknown[];
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
  const renderedSections: unknown[] = [];

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
    renderProjectList: ((sections: unknown) => {
      renderedSections.push(sections);
      return "<rendered>";
    }) as unknown as UI["renderProjectList"],
    renderStatus: (() => "") as unknown as UI["renderStatus"],
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

  return { ctx, rootDir, info, renderedSections };
};

type SectionShape = {
  heading?: string;
  rows: { name: string; state: string; category: string; stale: boolean; tags: readonly string[] }[];
};

const firstSections = (bundle: Bundle): SectionShape[] =>
  bundle.renderedSections[0] as SectionShape[];

describe("handleLs", () => {
  let workdir: string;

  beforeEach(async () => {
    workdir = await mkdtemp(join(tmpdir(), "nook-ls-"));
  });

  afterEach(async () => {
    await rm(workdir, { recursive: true, force: true });
  });

  test("renders sections grouped by category, excluding archived/shipped by default", async () => {
    const bundle = await buildContext(workdir);
    await writeProject(
      bundle.rootDir,
      "work/alpha",
      metadataFor({ id: "01H00000000000000000000001", name: "alpha", category: "work" }),
    );
    await writeProject(
      bundle.rootDir,
      "work/shipped/beta",
      metadataFor({
        id: "01H00000000000000000000002",
        name: "beta",
        category: "work",
        state: "shipped",
      }),
    );
    await writeProject(
      bundle.rootDir,
      "work/archived/gamma",
      metadataFor({
        id: "01H00000000000000000000003",
        name: "gamma",
        category: "work",
        state: "archived",
      }),
    );
    await writeProject(
      bundle.rootDir,
      "lab/delta",
      metadataFor({
        id: "01H00000000000000000000004",
        name: "delta",
        category: "lab",
        state: "incubating",
      }),
    );

    const result = await handleLs({}, bundle.ctx);

    expect(result.ok).toBe(true);
    const sections = firstSections(bundle);
    const names = sections.flatMap((s) => s.rows.map((r) => r.name));
    expect(names).toContain("alpha");
    expect(names).toContain("delta");
    expect(names).not.toContain("beta");
    expect(names).not.toContain("gamma");
    const headings = sections.map((s) => s.heading);
    expect(headings).toContain("lab/");
    expect(headings).toContain("work/");
  });

  test("--all includes archived and shipped projects", async () => {
    const bundle = await buildContext(workdir);
    await writeProject(
      bundle.rootDir,
      "work/alpha",
      metadataFor({ id: "01H00000000000000000000001", name: "alpha", category: "work" }),
    );
    await writeProject(
      bundle.rootDir,
      "work/shipped/beta",
      metadataFor({
        id: "01H00000000000000000000002",
        name: "beta",
        category: "work",
        state: "shipped",
      }),
    );
    await writeProject(
      bundle.rootDir,
      "work/archived/gamma",
      metadataFor({
        id: "01H00000000000000000000003",
        name: "gamma",
        category: "work",
        state: "archived",
      }),
    );

    const result = await handleLs({ all: true }, bundle.ctx);

    expect(result.ok).toBe(true);
    const names = firstSections(bundle).flatMap((s) => s.rows.map((r) => r.name));
    expect(names).toContain("alpha");
    expect(names).toContain("beta");
    expect(names).toContain("gamma");
  });

  test("positional category argument limits listing to that category", async () => {
    const bundle = await buildContext(workdir);
    await writeProject(
      bundle.rootDir,
      "work/alpha",
      metadataFor({ id: "01H00000000000000000000001", name: "alpha", category: "work" }),
    );
    await writeProject(
      bundle.rootDir,
      "lab/delta",
      metadataFor({
        id: "01H00000000000000000000004",
        name: "delta",
        category: "lab",
        state: "incubating",
      }),
    );

    const result = await handleLs({ category: "lab" }, bundle.ctx);

    expect(result.ok).toBe(true);
    const sections = firstSections(bundle);
    const names = sections.flatMap((s) => s.rows.map((r) => r.name));
    expect(names).toEqual(["delta"]);
    expect(sections.every((s) => s.heading === undefined || s.heading === "lab/")).toBe(
      true,
    );
  });

  test("--state filters to a single state", async () => {
    const bundle = await buildContext(workdir);
    await writeProject(
      bundle.rootDir,
      "work/alpha",
      metadataFor({
        id: "01H00000000000000000000001",
        name: "alpha",
        category: "work",
        state: "active",
      }),
    );
    await writeProject(
      bundle.rootDir,
      "work/beta",
      metadataFor({
        id: "01H00000000000000000000002",
        name: "beta",
        category: "work",
        state: "paused",
      }),
    );

    const result = await handleLs({ state: "paused" }, bundle.ctx);

    expect(result.ok).toBe(true);
    const names = firstSections(bundle).flatMap((s) => s.rows.map((r) => r.name));
    expect(names).toEqual(["beta"]);
  });

  test("--state rejects unknown state with validation error", async () => {
    const bundle = await buildContext(workdir);

    const result = await handleLs({ state: "bogus" }, bundle.ctx);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("validation");
  });

  test("--stale filters to stale projects using category staleness_days", async () => {
    const bundle = await buildContext(workdir);
    await writeProject(
      bundle.rootDir,
      "work/fresh",
      metadataFor({
        id: "01H00000000000000000000001",
        name: "fresh",
        category: "work",
        created_at: NOW - 1 * DAY_MS,
      }),
    );
    await writeProject(
      bundle.rootDir,
      "work/stale",
      metadataFor({
        id: "01H00000000000000000000002",
        name: "stale",
        category: "work",
        created_at: NOW - 90 * DAY_MS,
      }),
    );
    await writeProject(
      bundle.rootDir,
      "work/paused",
      metadataFor({
        id: "01H00000000000000000000003",
        name: "paused",
        category: "work",
        state: "paused",
        created_at: NOW - 120 * DAY_MS,
        paused_until: NOW + 10 * DAY_MS,
      }),
    );

    const result = await handleLs({ stale: true }, bundle.ctx);

    expect(result.ok).toBe(true);
    const names = firstSections(bundle).flatMap((s) => s.rows.map((r) => r.name));
    expect(names).toEqual(["stale"]);
  });

  test("--maintained filters to maintained projects", async () => {
    const bundle = await buildContext(workdir);
    await writeProject(
      bundle.rootDir,
      "work/alpha",
      metadataFor({
        id: "01H00000000000000000000001",
        name: "alpha",
        category: "work",
        state: "active",
      }),
    );
    await writeProject(
      bundle.rootDir,
      "work/beta",
      metadataFor({
        id: "01H00000000000000000000002",
        name: "beta",
        category: "work",
        state: "maintained",
      }),
    );

    const result = await handleLs({ maintained: true }, bundle.ctx);

    expect(result.ok).toBe(true);
    const names = firstSections(bundle).flatMap((s) => s.rows.map((r) => r.name));
    expect(names).toEqual(["beta"]);
  });

  test("--tag filters to projects containing every tag", async () => {
    const bundle = await buildContext(workdir);
    await writeProject(
      bundle.rootDir,
      "work/alpha",
      metadataFor({
        id: "01H00000000000000000000001",
        name: "alpha",
        category: "work",
        tags: ["urgent"],
      }),
    );
    await writeProject(
      bundle.rootDir,
      "work/beta",
      metadataFor({
        id: "01H00000000000000000000002",
        name: "beta",
        category: "work",
        tags: ["urgent", "billable"],
      }),
    );

    const result = await handleLs(
      { tags: ["urgent", "billable"] },
      bundle.ctx,
    );

    expect(result.ok).toBe(true);
    const names = firstSections(bundle).flatMap((s) => s.rows.map((r) => r.name));
    expect(names).toEqual(["beta"]);
  });

  test("--sort name sorts rows alphabetically across a flat section", async () => {
    const bundle = await buildContext(workdir);
    await writeProject(
      bundle.rootDir,
      "work/charlie",
      metadataFor({ id: "01H00000000000000000000001", name: "charlie" }),
    );
    await writeProject(
      bundle.rootDir,
      "work/alpha",
      metadataFor({ id: "01H00000000000000000000002", name: "alpha" }),
    );
    await writeProject(
      bundle.rootDir,
      "work/bravo",
      metadataFor({ id: "01H00000000000000000000003", name: "bravo" }),
    );

    const result = await handleLs(
      { category: "work", sort: "name" },
      bundle.ctx,
    );

    expect(result.ok).toBe(true);
    const names = firstSections(bundle).flatMap((s) => s.rows.map((r) => r.name));
    expect(names).toEqual(["alpha", "bravo", "charlie"]);
  });

  test("--sort touched (default) sorts most-recently-touched first", async () => {
    const bundle = await buildContext(workdir);
    await writeProject(
      bundle.rootDir,
      "work/old",
      metadataFor({
        id: "01H00000000000000000000001",
        name: "old",
        created_at: NOW - 30 * DAY_MS,
      }),
    );
    await writeProject(
      bundle.rootDir,
      "work/newer",
      metadataFor({
        id: "01H00000000000000000000002",
        name: "newer",
        created_at: NOW - 1 * DAY_MS,
      }),
    );

    const result = await handleLs({ category: "work" }, bundle.ctx);

    expect(result.ok).toBe(true);
    const names = firstSections(bundle).flatMap((s) => s.rows.map((r) => r.name));
    expect(names).toEqual(["newer", "old"]);
  });

  test("--json emits a JSON array to the logger instead of rendering a table", async () => {
    const bundle = await buildContext(workdir);
    await writeProject(
      bundle.rootDir,
      "work/alpha",
      metadataFor({
        id: "01H00000000000000000000001",
        name: "alpha",
        category: "work",
        tags: ["tag1"],
      }),
    );

    const result = await handleLs({ json: true }, bundle.ctx);

    expect(result.ok).toBe(true);
    expect(bundle.renderedSections.length).toBe(0);
    expect(bundle.info.length).toBe(1);
    const parsed = JSON.parse(bundle.info[0]!);
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed).toHaveLength(1);
    expect(parsed[0].name).toBe("alpha");
    expect(parsed[0].id).toBe("01H00000000000000000000001");
    expect(parsed[0].state).toBe("active");
    expect(parsed[0].category).toBe("work");
    expect(parsed[0].tags).toEqual(["tag1"]);
    expect(typeof parsed[0].last_touched).toBe("number");
  });
});
