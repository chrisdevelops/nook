import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
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
import { handleUnarchive } from "./unarchive.ts";

const NOW = 1_700_000_000_000;
const DAY_MS = 86_400_000;

const metadataFor = (overrides: Partial<ProjectMetadata>): ProjectMetadata => ({
  id: "01HZZZZZZZZZZZZZZZZZZZZZZZ",
  name: "placeholder",
  category: "work",
  state: "archived",
  created_at: NOW - 90 * DAY_MS,
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
    categories: { lab: {}, work: {} },
    aliases: {},
  };
  await mkdir(appPaths.config, { recursive: true });
  await writeFile(appPaths.configFilePath, JSON.stringify(config, null, 2), "utf8");
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

describe("handleUnarchive", () => {
  let workdir: string;

  beforeEach(async () => {
    workdir = await mkdtemp(join(tmpdir(), "nook-unarchive-"));
  });

  afterEach(async () => {
    await rm(workdir, { recursive: true, force: true });
  });

  test("unarchives an archived project back to <category>/<name> as active", async () => {
    const { ctx, rootDir } = await buildContext(workdir);
    await writeProject(
      rootDir,
      "work/archived/alpha",
      metadataFor({ id: "01HAAAAAAAAAAAAAAAAAAAAAAA", name: "alpha" }),
    );

    const result = await handleUnarchive({ project: "alpha" }, ctx);

    expect(result.ok).toBe(true);
    await expect(
      access(join(rootDir, "work", "archived", "alpha", ".nook", "project.jsonc")),
    ).rejects.toThrow();
    await access(join(rootDir, "work", "alpha", ".nook", "project.jsonc"));

    const metadataRaw = await readFile(
      join(rootDir, "work", "alpha", ".nook", "project.jsonc"),
      "utf8",
    );
    const metadata = JSON.parse(metadataRaw) as ProjectMetadata;
    expect(metadata.state).toBe("active");

    const historyRaw = await readFile(
      join(rootDir, "work", "alpha", ".nook", "history.jsonl"),
      "utf8",
    );
    const event = JSON.parse(historyRaw.trim().split("\n")[0]!);
    expect(event).toMatchObject({
      type: "state_changed",
      from: "archived",
      to: "active",
      at: NOW,
    });
  });

  test("rejects unarchiving a non-archived project", async () => {
    const { ctx, rootDir } = await buildContext(workdir);
    await writeProject(
      rootDir,
      "work/alpha",
      metadataFor({
        id: "01HAAAAAAAAAAAAAAAAAAAAAAA",
        name: "alpha",
        state: "active",
      }),
    );

    const result = await handleUnarchive({ project: "alpha" }, ctx);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("state_transition");
  });

  test("returns not_found when the project does not exist", async () => {
    const { ctx } = await buildContext(workdir);

    const result = await handleUnarchive({ project: "ghost" }, ctx);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("not_found");
  });
});
