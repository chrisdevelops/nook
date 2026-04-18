import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { CommandContext, UI } from "../cli/command-types.ts";
import type { GlobalConfig, ProjectMetadata } from "../core/project-types.ts";
import { resolveAppPaths } from "../platform/app-paths.ts";
import type { LaunchSpawn } from "../platform/launch-editor.ts";
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
import { handleAliasList, handleRunAlias } from "./alias.ts";

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
  aliases: Record<string, { command: string }> = {},
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
    aliases,
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

describe("handleAliasList", () => {
  let workdir: string;

  beforeEach(async () => {
    workdir = await mkdtemp(join(tmpdir(), "nook-alias-"));
  });

  afterEach(async () => {
    await rm(workdir, { recursive: true, force: true });
  });

  test("prints configured aliases sorted by name", async () => {
    const { ctx, info } = await buildContext(workdir, {
      zed: { command: "zed {path}" },
      cursor: { command: "cursor {path}" },
    });

    const result = await handleAliasList({}, ctx);

    expect(result.ok).toBe(true);
    expect(info).toEqual(["cursor  cursor {path}", "zed  zed {path}"]);
  });

  test("reports when no aliases are configured", async () => {
    const { ctx, info } = await buildContext(workdir, {});

    const result = await handleAliasList({}, ctx);

    expect(result.ok).toBe(true);
    expect(info).toEqual(["No aliases configured."]);
  });
});

describe("handleRunAlias", () => {
  let workdir: string;

  beforeEach(async () => {
    workdir = await mkdtemp(join(tmpdir(), "nook-alias-run-"));
  });

  afterEach(async () => {
    await rm(workdir, { recursive: true, force: true });
  });

  test("substitutes {path}, {name}, {id}, {category} and spawns the shell", async () => {
    const { ctx, rootDir } = await buildContext(workdir, {
      demo: {
        command: "echo {name}:{id}:{category}:{path}",
      },
    });
    const projectPath = await writeProject(
      rootDir,
      "active/alpha",
      metadataFor({
        id: "01HBBBBBBBBBBBBBBBBBBBBBBB",
        name: "alpha",
        category: "active",
      }),
    );

    const calls: Array<{ cmd: readonly string[]; cwd: string | undefined }> = [];
    const spawn: LaunchSpawn = async (cmd, options) => {
      calls.push({ cmd, cwd: options.cwd });
      return { exitCode: 0 };
    };

    const result = await handleRunAlias(
      { alias: "demo", project: "alpha" },
      ctx,
      { spawn, platform: "linux" },
    );

    expect(result.ok).toBe(true);
    expect(calls).toEqual([
      {
        cmd: [
          "sh",
          "-c",
          `echo alpha:01HBBBBBBBBBBBBBBBBBBBBBBB:active:${projectPath}`,
        ],
        cwd: projectPath,
      },
    ]);
  });

  test("returns not_found when alias is not configured", async () => {
    const { ctx, rootDir } = await buildContext(workdir, {});
    await writeProject(
      rootDir,
      "active/alpha",
      metadataFor({ name: "alpha" }),
    );

    const result = await handleRunAlias(
      { alias: "ghost", project: "alpha" },
      ctx,
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("not_found");
    }
  });
});
