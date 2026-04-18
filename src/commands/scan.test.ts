import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { CommandContext, UI } from "../cli/command-types.ts";
import type {
  CategoryConfig,
  GlobalConfig,
  ProjectMetadata,
} from "../core/project-types.ts";
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
import {
  closeIndex,
  DEFAULT_INDEX_TTL_MS,
  openIndex,
  queryProjects,
  upsertProject,
} from "../storage/project-index.ts";
import {
  readProjectMetadata,
  writeProjectMetadata,
} from "../storage/project-metadata.ts";
import { handleScan } from "./scan.ts";

const NOW = 1_700_000_000_000;

const metadataFor = (overrides: Partial<ProjectMetadata>): ProjectMetadata => ({
  id: "01HAAAAAAAAAAAAAAAAAAAAAAA",
  name: "alpha",
  category: "active",
  state: "active",
  created_at: NOW,
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

const buildContext = async (
  workdir: string,
  overrides?: { readonly categories?: readonly string[] },
): Promise<{
  ctx: CommandContext;
  rootDir: string;
  info: string[];
  warn: string[];
}> => {
  const appPaths = resolveAppPaths({
    platform: "linux",
    env: { XDG_CONFIG_HOME: join(workdir, "cfg") },
    homeDir: workdir,
  });
  const rootDir = join(workdir, "Projects");
  const categoryNames = overrides?.categories ?? ["active", "lab"];
  const categoryRecord: Record<string, CategoryConfig> = {};
  for (const name of categoryNames) {
    categoryRecord[name] = {};
  }
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
    categories: categoryRecord,
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
  const warn: string[] = [];
  const ui: UI = {
    logger: {
      info: (m) => info.push(m),
      warn: (m) => warn.push(m),
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

  return { ctx, rootDir, info, warn };
};

describe("handleScan", () => {
  let workdir: string;

  beforeEach(async () => {
    workdir = await mkdtemp(join(tmpdir(), "nook-scan-"));
  });

  afterEach(async () => {
    await rm(workdir, { recursive: true, force: true });
  });

  test("upserts index rows for all projects on first scan", async () => {
    const { ctx, rootDir, info } = await buildContext(workdir);
    await writeProject(
      rootDir,
      "active/alpha",
      metadataFor({ id: "01HAAAAAAAAAAAAAAAAAAAAAAA", name: "alpha" }),
    );
    await writeProject(
      rootDir,
      "lab/bravo",
      metadataFor({
        id: "01HBBBBBBBBBBBBBBBBBBBBBBB",
        name: "bravo",
        category: "lab",
        state: "incubating",
      }),
    );

    const result = await handleScan({}, ctx);

    expect(result.ok).toBe(true);
    expect(info).toEqual(["Scanned 2 projects; updated 2."]);

    const dbResult = openIndex(ctx.appPaths.indexPath);
    if (!dbResult.ok) throw new Error("index open");
    try {
      const rows = queryProjects(dbResult.value);
      if (!rows.ok) throw new Error("index query");
      expect(rows.value.length).toBe(2);
    } finally {
      closeIndex(dbResult.value);
    }
  });

  test("skips fresh rows when --force is not set", async () => {
    const { ctx, rootDir, info } = await buildContext(workdir);
    const projectPath = await writeProject(
      rootDir,
      "active/alpha",
      metadataFor({ id: "01HAAAAAAAAAAAAAAAAAAAAAAA", name: "alpha" }),
    );

    const dbResult = openIndex(ctx.appPaths.indexPath);
    if (!dbResult.ok) throw new Error("index open");
    upsertProject(dbResult.value, {
      id: "01HAAAAAAAAAAAAAAAAAAAAAAA",
      name: "alpha",
      path: projectPath,
      category: "active",
      state: "active",
      last_touched: NOW - 10,
      last_scanned: NOW - 10,
      created_at: NOW,
      paused_until: null,
      scratch: false,
    });
    closeIndex(dbResult.value);

    const result = await handleScan({}, ctx);

    expect(result.ok).toBe(true);
    expect(info).toEqual(["Scanned 1 project; updated 0."]);
  });

  test("--force refreshes rows even when fresh", async () => {
    const { ctx, rootDir, info } = await buildContext(workdir);
    const projectPath = await writeProject(
      rootDir,
      "active/alpha",
      metadataFor({ id: "01HAAAAAAAAAAAAAAAAAAAAAAA", name: "alpha" }),
    );

    const dbResult = openIndex(ctx.appPaths.indexPath);
    if (!dbResult.ok) throw new Error("index open");
    upsertProject(dbResult.value, {
      id: "01HAAAAAAAAAAAAAAAAAAAAAAA",
      name: "alpha",
      path: projectPath,
      category: "active",
      state: "active",
      last_touched: NOW - 10,
      last_scanned: NOW - 10,
      created_at: NOW,
      paused_until: null,
      scratch: false,
    });
    closeIndex(dbResult.value);

    const result = await handleScan({ force: true }, ctx);

    expect(result.ok).toBe(true);
    expect(info).toEqual(["Scanned 1 project; updated 1."]);
  });

  test("refreshes rows older than TTL", async () => {
    const { ctx, rootDir, info } = await buildContext(workdir);
    const projectPath = await writeProject(
      rootDir,
      "active/alpha",
      metadataFor({ id: "01HAAAAAAAAAAAAAAAAAAAAAAA", name: "alpha" }),
    );

    const dbResult = openIndex(ctx.appPaths.indexPath);
    if (!dbResult.ok) throw new Error("index open");
    upsertProject(dbResult.value, {
      id: "01HAAAAAAAAAAAAAAAAAAAAAAA",
      name: "alpha",
      path: projectPath,
      category: "active",
      state: "active",
      last_touched: NOW - DEFAULT_INDEX_TTL_MS - 10,
      last_scanned: NOW - DEFAULT_INDEX_TTL_MS - 10,
      created_at: NOW,
      paused_until: null,
      scratch: false,
    });
    closeIndex(dbResult.value);

    const result = await handleScan({}, ctx);

    expect(result.ok).toBe(true);
    expect(info).toEqual(["Scanned 1 project; updated 1."]);
  });

  test("reports untracked folders under configured categories as orphans", async () => {
    const { ctx, rootDir, warn } = await buildContext(workdir, {
      categories: ["oss"],
    });
    await mkdir(join(rootDir, "oss", "untracked-one"), { recursive: true });
    await mkdir(join(rootDir, "oss", "untracked-two"), { recursive: true });

    const result = await handleScan({}, ctx);

    expect(result.ok).toBe(true);
    const messages = warn.join("\n");
    expect(messages).toContain("untracked-one");
    expect(messages).toContain("untracked-two");
    expect(messages).toContain("--adopt-orphans");
  });

  test("--adopt-orphans registers untracked folders at their current path", async () => {
    const { ctx, rootDir, info } = await buildContext(workdir, {
      categories: ["oss"],
    });
    const orphanPath = join(rootDir, "oss", "freshly-adopted");
    await mkdir(orphanPath, { recursive: true });
    await writeFile(join(orphanPath, "keep.txt"), "content", "utf8");

    const result = await handleScan({ adoptOrphans: true }, ctx);

    expect(result.ok).toBe(true);
    // Preserved file contents.
    const body = await import("node:fs/promises").then((m) =>
      m.readFile(join(orphanPath, "keep.txt"), "utf8"),
    );
    expect(body).toBe("content");
    // Metadata was written in place.
    const meta = await import("node:fs/promises").then((m) =>
      m.readFile(join(orphanPath, ".nook", "project.jsonc"), "utf8"),
    );
    const parsed = JSON.parse(meta) as ProjectMetadata;
    expect(parsed.category).toBe("oss");
    expect(parsed.state).toBe("active");
    expect(parsed.name).toBe("freshly-adopted");

    const summary = info.join("\n");
    expect(summary).toContain("Adopted");
  });

  test("--adopt-orphans skips folders whose parent is not a configured category", async () => {
    const { ctx, rootDir, warn } = await buildContext(workdir, {
      categories: ["oss"],
    });
    await mkdir(join(rootDir, "oss", "good-orphan"), { recursive: true });
    await mkdir(join(rootDir, "misc", "random-folder"), { recursive: true });

    const result = await handleScan({ adoptOrphans: true }, ctx);

    expect(result.ok).toBe(true);
    // The misc/random-folder should not have .nook metadata.
    const checkMeta = await import("node:fs/promises")
      .then((m) => m.access(join(rootDir, "misc", "random-folder", ".nook")))
      .then(() => true)
      .catch(() => false);
    expect(checkMeta).toBe(false);
    // And we warned the user about it.
    expect(warn.some((w) => w.includes("random-folder"))).toBe(true);
  });

  test("--category limits the scan", async () => {
    const { ctx, rootDir, info } = await buildContext(workdir);
    await writeProject(
      rootDir,
      "active/alpha",
      metadataFor({ id: "01HAAAAAAAAAAAAAAAAAAAAAAA", name: "alpha" }),
    );
    await writeProject(
      rootDir,
      "lab/bravo",
      metadataFor({
        id: "01HBBBBBBBBBBBBBBBBBBBBBBB",
        name: "bravo",
        category: "lab",
        state: "incubating",
      }),
    );

    const result = await handleScan({ category: "active" }, ctx);

    expect(result.ok).toBe(true);
    expect(info).toEqual(["Scanned 1 project; updated 1."]);

    const dbResult = openIndex(ctx.appPaths.indexPath);
    if (!dbResult.ok) throw new Error("index open");
    try {
      const rows = queryProjects(dbResult.value);
      if (!rows.ok) throw new Error("index query");
      expect(rows.value.map((r) => r.name)).toEqual(["alpha"]);
    } finally {
      closeIndex(dbResult.value);
    }
  });
});
