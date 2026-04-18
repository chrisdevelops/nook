import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { access, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
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
import { handleStale } from "./stale.ts";

const NOW = 1_700_000_000_000;
const DAY_MS = 86_400_000;

const metadataFor = (overrides: Partial<ProjectMetadata>): ProjectMetadata => ({
  id: "01HAAAAAAAAAAAAAAAAAAAAAAA",
  name: "placeholder",
  category: "work",
  state: "active",
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

type SelectCall = {
  readonly message: string;
  readonly choiceValues: readonly string[];
};

type Bundle = {
  readonly ctx: CommandContext;
  readonly rootDir: string;
  readonly info: string[];
  readonly selectCalls: SelectCall[];
  setSelectAnswers: (values: readonly string[]) => void;
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
  const selectCalls: SelectCall[] = [];
  let selectAnswers: readonly string[] = [];
  let nextSelectIndex = 0;

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
    promptSelect: (async (options: {
      message: string;
      choices: readonly (
        | { value: string }
        | string
      )[];
    }) => {
      const choiceValues = options.choices.map((c) =>
        typeof c === "string" ? c : c.value,
      );
      selectCalls.push({ message: options.message, choiceValues });
      const answer = selectAnswers[nextSelectIndex] ?? "keep";
      nextSelectIndex += 1;
      return answer;
    }) as unknown as UI["promptSelect"],
    promptConfirm: (async () => true) as unknown as UI["promptConfirm"],
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

  return {
    ctx,
    rootDir,
    info,
    selectCalls,
    setSelectAnswers: (values) => {
      selectAnswers = values;
      nextSelectIndex = 0;
    },
  };
};

describe("handleStale", () => {
  let workdir: string;

  beforeEach(async () => {
    workdir = await mkdtemp(join(tmpdir(), "nook-stale-"));
  });

  afterEach(async () => {
    await rm(workdir, { recursive: true, force: true });
  });

  test("--list prints stale projects and does not prompt", async () => {
    const { ctx, rootDir, info, selectCalls } = await buildContext(workdir);
    await writeProject(
      rootDir,
      "work/fresh",
      metadataFor({
        id: "01H00000000000000000000001",
        name: "fresh",
        created_at: NOW - 1 * DAY_MS,
      }),
    );
    await writeProject(
      rootDir,
      "work/stale",
      metadataFor({
        id: "01H00000000000000000000002",
        name: "stale",
        created_at: NOW - 90 * DAY_MS,
      }),
    );

    const result = await handleStale({ list: true }, ctx);

    expect(result.ok).toBe(true);
    expect(selectCalls.length).toBe(0);
    const output = info.join("\n");
    expect(output).toContain("stale");
    expect(output).not.toContain("fresh");
  });

  test("interactive: selecting 'archive' archives the project", async () => {
    const bundle = await buildContext(workdir);
    const { ctx, rootDir } = bundle;
    const projectPath = await writeProject(
      rootDir,
      "work/stale",
      metadataFor({
        id: "01H00000000000000000000001",
        name: "stale",
        created_at: NOW - 90 * DAY_MS,
      }),
    );
    bundle.setSelectAnswers(["archive"]);

    const result = await handleStale({}, ctx);

    expect(result.ok).toBe(true);
    await expect(access(projectPath)).rejects.toThrow();
    await access(join(rootDir, "work/archived/stale/.nook/project.jsonc"));
  });

  test("interactive: selecting 'pause' pauses the project", async () => {
    const bundle = await buildContext(workdir);
    const { ctx, rootDir } = bundle;
    await writeProject(
      rootDir,
      "work/stale",
      metadataFor({
        id: "01H00000000000000000000001",
        name: "stale",
        created_at: NOW - 90 * DAY_MS,
      }),
    );
    bundle.setSelectAnswers(["pause"]);

    const result = await handleStale({}, ctx);

    expect(result.ok).toBe(true);
    const after = await readProjectMetadata(join(rootDir, "work/stale"));
    expect(after.ok).toBe(true);
    if (after.ok) {
      expect(after.value.state).toBe("paused");
      expect(after.value.paused_until).toBeDefined();
    }
  });

  test("interactive: selecting 'keep' leaves the project unchanged", async () => {
    const bundle = await buildContext(workdir);
    const { ctx, rootDir } = bundle;
    const projectPath = await writeProject(
      rootDir,
      "work/stale",
      metadataFor({
        id: "01H00000000000000000000001",
        name: "stale",
        created_at: NOW - 90 * DAY_MS,
      }),
    );
    bundle.setSelectAnswers(["keep"]);

    const result = await handleStale({}, ctx);

    expect(result.ok).toBe(true);
    const after = await readProjectMetadata(projectPath);
    expect(after.ok).toBe(true);
    if (after.ok) {
      expect(after.value.state).toBe("active");
    }
  });

  test("--category limits to a specific category", async () => {
    const bundle = await buildContext(workdir);
    const { ctx, rootDir, selectCalls } = bundle;
    await writeProject(
      rootDir,
      "work/work-stale",
      metadataFor({
        id: "01H00000000000000000000001",
        name: "work-stale",
        category: "work",
        created_at: NOW - 90 * DAY_MS,
      }),
    );
    await writeProject(
      rootDir,
      "lab/lab-stale",
      metadataFor({
        id: "01H00000000000000000000002",
        name: "lab-stale",
        category: "lab",
        state: "incubating",
        created_at: NOW - 90 * DAY_MS,
      }),
    );
    bundle.setSelectAnswers(["keep"]);

    const result = await handleStale({ category: "work" }, ctx);

    expect(result.ok).toBe(true);
    expect(selectCalls.length).toBe(1);
    expect(selectCalls[0]!.message).toContain("work-stale");
  });

  test("reports nothing to do when there are no stale projects", async () => {
    const { ctx, rootDir, info, selectCalls } = await buildContext(workdir);
    await writeProject(
      rootDir,
      "work/fresh",
      metadataFor({
        id: "01H00000000000000000000001",
        name: "fresh",
        created_at: NOW - 1 * DAY_MS,
      }),
    );

    const result = await handleStale({}, ctx);

    expect(result.ok).toBe(true);
    expect(selectCalls.length).toBe(0);
    expect(info.some((line) => line.toLowerCase().includes("no stale"))).toBe(
      true,
    );
  });
});
