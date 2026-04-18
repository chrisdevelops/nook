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
): Promise<{ ctx: CommandContext; rootDir: string; info: string[] }> => {
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
    categories: {},
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

  return { ctx, rootDir, info };
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
