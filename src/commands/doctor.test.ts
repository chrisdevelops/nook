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
  upsertProject,
} from "../storage/project-index.ts";
import {
  readProjectMetadata,
  writeProjectMetadata,
} from "../storage/project-metadata.ts";
import { handleDoctor } from "./doctor.ts";

const NOW = 1_700_000_000_000;
const DAY_MS = 86_400_000;

const metadataFor = (overrides: Partial<ProjectMetadata>): ProjectMetadata => ({
  id: "01HAAAAAAAAAAAAAAAAAAAAAAA",
  name: "alpha",
  category: "active",
  state: "active",
  created_at: NOW - 10 * DAY_MS,
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
    categories: { active: {}, lab: {} },
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

describe("handleDoctor", () => {
  let workdir: string;

  beforeEach(async () => {
    workdir = await mkdtemp(join(tmpdir(), "nook-doctor-"));
  });

  afterEach(async () => {
    await rm(workdir, { recursive: true, force: true });
  });

  test("reports all checks pass for a healthy setup", async () => {
    const { ctx, rootDir, info } = await buildContext(workdir);
    await writeProject(
      rootDir,
      "active/alpha",
      metadataFor({ name: "alpha" }),
    );

    const result = await handleDoctor({}, ctx);

    expect(result.ok).toBe(true);
    expect(info).toEqual(["All checks passed."]);
  });

  test("flags category mismatches", async () => {
    const { ctx, rootDir, info } = await buildContext(workdir);
    await writeProject(
      rootDir,
      "active/alpha",
      metadataFor({ name: "alpha", category: "client" }),
    );

    const result = await handleDoctor({}, ctx);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("validation");
    }
    expect(
      info.some((line) => line.includes("category_mismatch")),
    ).toBe(true);
  });

  test("flags state/folder mismatches when metadata says shipped but folder is category root", async () => {
    const { ctx, rootDir, info } = await buildContext(workdir);
    await writeProject(
      rootDir,
      "active/alpha",
      metadataFor({ name: "alpha", state: "shipped" }),
    );

    const result = await handleDoctor({}, ctx);

    expect(result.ok).toBe(false);
    expect(
      info.some((line) => line.includes("state_folder_mismatch")),
    ).toBe(true);
  });

  test("flags state/folder mismatches when folder is shipped/ but metadata is active", async () => {
    const { ctx, rootDir, info } = await buildContext(workdir);
    await writeProject(
      rootDir,
      "active/shipped/alpha",
      metadataFor({ name: "alpha", state: "active" }),
    );

    const result = await handleDoctor({}, ctx);

    expect(result.ok).toBe(false);
    expect(
      info.some((line) => line.includes("state_folder_mismatch")),
    ).toBe(true);
  });

  test("warns about expired scratch projects", async () => {
    const { ctx, rootDir, info } = await buildContext(workdir);
    await writeProject(
      rootDir,
      "lab/alpha",
      metadataFor({
        name: "alpha",
        category: "lab",
        state: "incubating",
        scratch: true,
        created_at: NOW - 30 * DAY_MS,
      }),
    );

    const result = await handleDoctor({}, ctx);

    // Only a warning; should still succeed
    expect(result.ok).toBe(true);
    expect(info.some((line) => line.includes("scratch_expired"))).toBe(true);
  });

  test("reports orphan folders without .nook/project.jsonc", async () => {
    const { ctx, rootDir, info } = await buildContext(workdir);
    await mkdir(join(rootDir, "active", "stray"), { recursive: true });

    const result = await handleDoctor({}, ctx);

    // Only warnings; result ok
    expect(result.ok).toBe(true);
    expect(
      info.some((line) => line.includes("orphan_folder")),
    ).toBe(true);
  });

  test("reports orphan index rows and --fix removes them", async () => {
    const { ctx, rootDir, info } = await buildContext(workdir);
    await writeProject(
      rootDir,
      "active/alpha",
      metadataFor({ id: "01HAAAAAAAAAAAAAAAAAAAAAAA", name: "alpha" }),
    );

    const dbResult = openIndex(ctx.appPaths.indexPath);
    if (!dbResult.ok) throw new Error("index open");
    upsertProject(dbResult.value, {
      id: "01HZZZZZZZZZZZZZZZZZZZZZZZ",
      name: "ghost",
      path: join(rootDir, "active", "ghost"),
      category: "active",
      state: "active",
      last_touched: NOW,
      last_scanned: NOW,
      created_at: NOW,
      paused_until: null,
      scratch: false,
    });
    closeIndex(dbResult.value);

    const firstResult = await handleDoctor({}, ctx);
    expect(firstResult.ok).toBe(true);
    expect(
      info.some((line) => line.includes("orphan_index_row")),
    ).toBe(true);
    expect(
      info.some((line) => line.includes("auto-fixed")),
    ).toBe(true);

    const fixResult = await handleDoctor({ fix: true }, ctx);
    expect(fixResult.ok).toBe(true);
    expect(info.some((line) => line.includes("Applied fixes"))).toBe(true);

    const reopened = openIndex(ctx.appPaths.indexPath);
    if (!reopened.ok) throw new Error("reopen");
    try {
      const rows = queryProjects(reopened.value);
      if (!rows.ok) throw new Error("query");
      expect(rows.value.map((r) => r.id)).not.toContain(
        "01HZZZZZZZZZZZZZZZZZZZZZZZ",
      );
    } finally {
      closeIndex(reopened.value);
    }
  });
});
