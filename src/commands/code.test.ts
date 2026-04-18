import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { CommandContext, UI } from "../cli/command-types.ts";
import type { GlobalConfig, ProjectMetadata } from "../core/project-types.ts";
import { ok } from "../core/result.ts";
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
import { handleCode } from "./code.ts";

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

type LaunchCall = {
  editor: string;
  projectPath: string;
};

const buildContext = async (
  workdir: string,
  overrides?: { editors?: { default?: string } },
): Promise<{
  ctx: CommandContext;
  rootDir: string;
  launches: LaunchCall[];
}> => {
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
    editors: overrides?.editors ?? { default: "code" },
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

  const launches: LaunchCall[] = [];

  const ui: UI = {
    logger: {
      info: () => {},
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
    launchEditor: (async (options) => {
      launches.push({
        editor: options.editor,
        projectPath: options.projectPath,
      });
      return ok(undefined);
    }) as UI["launchEditor"],
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

  return { ctx, rootDir, launches };
};

describe("handleCode", () => {
  let workdir: string;

  beforeEach(async () => {
    workdir = await mkdtemp(join(tmpdir(), "nook-code-"));
  });

  afterEach(async () => {
    await rm(workdir, { recursive: true, force: true });
  });

  test("launches the configured default editor", async () => {
    const { ctx, rootDir, launches } = await buildContext(workdir);
    const projectPath = await writeProject(
      rootDir,
      "active/alpha",
      metadataFor({ name: "alpha" }),
    );

    const result = await handleCode({ project: "alpha" }, ctx);

    expect(result.ok).toBe(true);
    expect(launches).toEqual([{ editor: "code", projectPath }]);
  });

  test("--with overrides the configured default", async () => {
    const { ctx, rootDir, launches } = await buildContext(workdir);
    const projectPath = await writeProject(
      rootDir,
      "active/alpha",
      metadataFor({ name: "alpha" }),
    );

    const result = await handleCode(
      { project: "alpha", with: "zed" },
      ctx,
    );

    expect(result.ok).toBe(true);
    expect(launches).toEqual([{ editor: "zed", projectPath }]);
  });

  test("returns validation error when no editor is configured and --with missing", async () => {
    const { ctx, rootDir } = await buildContext(workdir, { editors: {} });
    await writeProject(
      rootDir,
      "active/alpha",
      metadataFor({ name: "alpha" }),
    );

    const result = await handleCode({ project: "alpha" }, ctx);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("validation");
    }
  });
});
