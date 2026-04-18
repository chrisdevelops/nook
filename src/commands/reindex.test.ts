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
  openIndex,
  queryProjects,
} from "../storage/project-index.ts";
import {
  readProjectMetadata,
  writeProjectMetadata,
} from "../storage/project-metadata.ts";
import { handleReindex } from "./reindex.ts";

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

describe("handleReindex", () => {
  let workdir: string;

  beforeEach(async () => {
    workdir = await mkdtemp(join(tmpdir(), "nook-reindex-"));
  });

  afterEach(async () => {
    await rm(workdir, { recursive: true, force: true });
  });

  test("rebuilds the index from discovered project metadata", async () => {
    const { ctx, rootDir, info } = await buildContext(workdir);
    await writeProject(
      rootDir,
      "active/alpha",
      metadataFor({ id: "01HAAAAAAAAAAAAAAAAAAAAAAA", name: "alpha" }),
    );
    await writeProject(
      rootDir,
      "active/bravo",
      metadataFor({
        id: "01HBBBBBBBBBBBBBBBBBBBBBBB",
        name: "bravo",
        state: "paused",
        paused_until: NOW + 100,
      }),
    );

    const result = await handleReindex({}, ctx);

    expect(result.ok).toBe(true);
    expect(info).toEqual(["Reindexed 2 projects."]);

    const dbResult = openIndex(ctx.appPaths.indexPath);
    if (!dbResult.ok) throw new Error("could not open index");
    const db = dbResult.value;
    try {
      const rows = queryProjects(db);
      if (!rows.ok) throw new Error("could not query");
      expect(rows.value.length).toBe(2);
      const names = rows.value.map((r) => r.name).sort();
      expect(names).toEqual(["alpha", "bravo"]);
      const bravo = rows.value.find((r) => r.name === "bravo");
      expect(bravo?.state).toBe("paused");
      expect(bravo?.paused_until).toBe(NOW + 100);
      expect(bravo?.last_scanned).toBe(NOW);
    } finally {
      closeIndex(db);
    }
  });

  test("replaces existing index rows", async () => {
    const { ctx, rootDir } = await buildContext(workdir);
    await writeProject(
      rootDir,
      "active/alpha",
      metadataFor({ id: "01HAAAAAAAAAAAAAAAAAAAAAAA", name: "alpha" }),
    );

    const first = await handleReindex({}, ctx);
    expect(first.ok).toBe(true);

    await rm(join(rootDir, "active/alpha"), { recursive: true, force: true });
    await writeProject(
      rootDir,
      "active/bravo",
      metadataFor({ id: "01HBBBBBBBBBBBBBBBBBBBBBBB", name: "bravo" }),
    );

    const second = await handleReindex({}, ctx);
    expect(second.ok).toBe(true);

    const dbResult = openIndex(ctx.appPaths.indexPath);
    if (!dbResult.ok) throw new Error("index open");
    const db = dbResult.value;
    try {
      const rows = queryProjects(db);
      if (!rows.ok) throw new Error("index query");
      expect(rows.value.map((r) => r.name)).toEqual(["bravo"]);
    } finally {
      closeIndex(db);
    }
  });
});
