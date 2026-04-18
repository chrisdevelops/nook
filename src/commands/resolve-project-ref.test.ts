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
import { resolveProjectRef } from "./resolve-project-ref.ts";

type CapturedLogger = {
  readonly info: string[];
  readonly warn: string[];
  readonly error: string[];
  readonly debug: string[];
};

const captureLogger = () => {
  const info: string[] = [];
  const warn: string[] = [];
  const error: string[] = [];
  const debug: string[] = [];
  return {
    logger: {
      info: (m: string) => info.push(m),
      warn: (m: string) => warn.push(m),
      error: (m: string) => error.push(m),
      debug: (m: string) => debug.push(m),
    },
    info,
    warn,
    error,
    debug,
  } as CapturedLogger & { readonly logger: UI["logger"] };
};

const metadataFor = (overrides: Partial<ProjectMetadata>): ProjectMetadata => ({
  id: "01HZZZZZZZZZZZZZZZZZZZZZZZ",
  name: "placeholder",
  category: "active",
  state: "active",
  created_at: 1_700_000_000_000,
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
  options: {
    readonly config?: GlobalConfig | null;
    readonly selectValues?: readonly unknown[];
  } = {},
): Promise<{
  ctx: CommandContext;
  captured: ReturnType<typeof captureLogger>;
  selectCalls: unknown[];
  rootDir: string;
}> => {
  const appPaths = resolveAppPaths({
    platform: "linux",
    env: { XDG_CONFIG_HOME: join(workdir, "cfg") },
    homeDir: workdir,
  });
  const rootDir = join(workdir, "Projects");

  if (options.config !== null) {
    const config: GlobalConfig =
      options.config ??
      {
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
  }

  const captured = captureLogger();

  const selectValues = [...(options.selectValues ?? [])];
  const selectCalls: unknown[] = [];
  const promptSelect: UI["promptSelect"] = (async (opts: unknown) => {
    selectCalls.push(opts);
    if (selectValues.length === 0) {
      throw new Error("promptSelect called more times than scripted");
    }
    return selectValues.shift();
  }) as unknown as UI["promptSelect"];

  const ui: UI = {
    logger: captured.logger,
    createSpinner: (() => {
      throw new Error("unused");
    }) as unknown as UI["createSpinner"],
    promptSelect,
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
    config: {
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
    },
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
    clock: { now: () => 1_700_000_000_000 },
    random: { next: () => 0 },
    cwd: workdir,
    appPaths,
    runResult: () => {},
  };

  return { ctx, captured, selectCalls, rootDir };
};

describe("resolveProjectRef", () => {
  let workdir: string;

  beforeEach(async () => {
    workdir = await mkdtemp(join(tmpdir(), "nook-resolve-"));
  });

  afterEach(async () => {
    await rm(workdir, { recursive: true, force: true });
  });

  test("returns the project when a single candidate matches", async () => {
    const { ctx, rootDir } = await buildContext(workdir);
    const projectPath = await writeProject(
      rootDir,
      "active/alpha",
      metadataFor({
        id: "01HAAAAAAAAAAAAAAAAAAAAAAA",
        name: "alpha",
        category: "active",
      }),
    );

    const result = await resolveProjectRef(ctx, "alpha");

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.path).toBe(projectPath);
      expect(result.value.metadata.name).toBe("alpha");
      expect(result.value.config.root).toBe(rootDir);
    }
  });

  test("prompts for disambiguation when multiple projects match", async () => {
    const { ctx, rootDir, selectCalls } = await buildContext(workdir, {
      selectValues: [undefined],
    });
    const chosenPath = await writeProject(
      rootDir,
      "active/bravo",
      metadataFor({
        id: "01HBBBAAAAAAAAAAAAAAAAAAAA",
        name: "bravo",
        category: "active",
      }),
    );
    await writeProject(
      rootDir,
      "active/beta",
      metadataFor({
        id: "01HBBBBBBBBBBBBBBBBBBBBBBB",
        name: "beta",
        category: "active",
      }),
    );
    // Inject the chosen path as the first scripted answer.
    // Rebuild selectValues with the real path now that we have it.
    selectCalls.length = 0;
    // Replace the ctx.ui.promptSelect with one that returns chosenPath.
    (ctx.ui as unknown as { promptSelect: UI["promptSelect"] }).promptSelect =
      (async (opts: unknown) => {
        selectCalls.push(opts);
        return chosenPath;
      }) as unknown as UI["promptSelect"];

    const result = await resolveProjectRef(ctx, "01HBBB");

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.path).toBe(chosenPath);
      expect(result.value.metadata.name).toBe("bravo");
    }
    expect(selectCalls.length).toBe(1);
  });

  test("returns not_found when no project matches", async () => {
    const { ctx, rootDir } = await buildContext(workdir);
    await mkdir(rootDir, { recursive: true });

    const result = await resolveProjectRef(ctx, "ghost");

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("not_found");
      expect(result.error.message).toContain("ghost");
    }
  });

  test("returns not_found when the config file is missing", async () => {
    const { ctx } = await buildContext(workdir, { config: null });

    const result = await resolveProjectRef(ctx, "alpha");

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("not_found");
      expect(result.error.message).toContain("nook init");
    }
  });
});
