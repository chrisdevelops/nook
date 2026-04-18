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
import { handlePromote } from "./promote.ts";

const NOW = 1_700_000_000_000;
const DAY_MS = 86_400_000;

const metadataFor = (overrides: Partial<ProjectMetadata>): ProjectMetadata => ({
  id: "01HZZZZZZZZZZZZZZZZZZZZZZZ",
  name: "placeholder",
  category: "lab",
  state: "incubating",
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
  readonly selectCalls: { message: string }[];
  setSelectAnswer: (value: string) => void;
};

const buildContext = async (
  workdir: string,
  categories: readonly string[] = ["work"],
): Promise<Bundle> => {
  const appPaths = resolveAppPaths({
    platform: "linux",
    env: { XDG_CONFIG_HOME: join(workdir, "cfg") },
    homeDir: workdir,
  });
  const rootDir = join(workdir, "Projects");
  const categoryRecord: Record<string, {}> = { lab: {} };
  for (const name of categories) categoryRecord[name] = {};
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
  await writeFile(appPaths.configFilePath, JSON.stringify(config, null, 2), "utf8");
  await mkdir(rootDir, { recursive: true });

  const info: string[] = [];
  const selectCalls: { message: string }[] = [];
  let selectAnswer = "";

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
    promptSelect: (async (options: { message: string }) => {
      selectCalls.push({ message: options.message });
      return selectAnswer;
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

  return {
    ctx,
    rootDir,
    info,
    selectCalls,
    setSelectAnswer: (value: string) => {
      selectAnswer = value;
    },
  };
};

describe("handlePromote", () => {
  let workdir: string;

  beforeEach(async () => {
    workdir = await mkdtemp(join(tmpdir(), "nook-promote-"));
  });

  afterEach(async () => {
    await rm(workdir, { recursive: true, force: true });
  });

  test("promotes an incubating project from lab to a category and updates state+category", async () => {
    const { ctx, rootDir } = await buildContext(workdir);
    await writeProject(
      rootDir,
      "lab/alpha",
      metadataFor({ id: "01HAAAAAAAAAAAAAAAAAAAAAAA", name: "alpha" }),
    );

    const result = await handlePromote(
      { project: "alpha", category: "work" },
      ctx,
    );

    expect(result.ok).toBe(true);

    await expect(access(join(rootDir, "lab", "alpha"))).rejects.toThrow();
    await access(join(rootDir, "work", "alpha", ".nook", "project.jsonc"));

    const metadataRaw = await readFile(
      join(rootDir, "work", "alpha", ".nook", "project.jsonc"),
      "utf8",
    );
    const metadata = JSON.parse(metadataRaw) as ProjectMetadata;
    expect(metadata.state).toBe("active");
    expect(metadata.category).toBe("work");

    const historyRaw = await readFile(
      join(rootDir, "work", "alpha", ".nook", "history.jsonl"),
      "utf8",
    );
    const lines = historyRaw.trim().split("\n").map((l) => JSON.parse(l));
    const stateEvent = lines.find((e) => e.type === "state_changed");
    const categoryEvent = lines.find((e) => e.type === "category_changed");
    expect(stateEvent).toMatchObject({
      type: "state_changed",
      from: "incubating",
      to: "active",
      at: NOW,
    });
    expect(categoryEvent).toMatchObject({
      type: "category_changed",
      from: "lab",
      to: "work",
      at: NOW,
    });
  });

  test("prompts for category when not provided", async () => {
    const { ctx, rootDir, selectCalls, setSelectAnswer } = await buildContext(
      workdir,
      ["work", "personal"],
    );
    setSelectAnswer("personal");
    await writeProject(
      rootDir,
      "lab/alpha",
      metadataFor({ id: "01HAAAAAAAAAAAAAAAAAAAAAAA", name: "alpha" }),
    );

    const result = await handlePromote({ project: "alpha" }, ctx);

    expect(result.ok).toBe(true);
    expect(selectCalls.length).toBe(1);
    await access(join(rootDir, "personal", "alpha", ".nook", "project.jsonc"));
  });

  test("rejects a non-incubating project", async () => {
    const { ctx, rootDir } = await buildContext(workdir);
    await writeProject(
      rootDir,
      "work/alpha",
      metadataFor({
        id: "01HAAAAAAAAAAAAAAAAAAAAAAA",
        name: "alpha",
        category: "work",
        state: "active",
      }),
    );

    const result = await handlePromote(
      { project: "alpha", category: "work" },
      ctx,
    );

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("state_transition");
  });

  test("rejects unknown category", async () => {
    const { ctx, rootDir } = await buildContext(workdir);
    await writeProject(
      rootDir,
      "lab/alpha",
      metadataFor({ id: "01HAAAAAAAAAAAAAAAAAAAAAAA", name: "alpha" }),
    );

    const result = await handlePromote(
      { project: "alpha", category: "nonexistent" },
      ctx,
    );

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("validation");
  });

  test("rejects reserved category names", async () => {
    const { ctx, rootDir } = await buildContext(workdir);
    await writeProject(
      rootDir,
      "lab/alpha",
      metadataFor({ id: "01HAAAAAAAAAAAAAAAAAAAAAAA", name: "alpha" }),
    );

    const result = await handlePromote(
      { project: "alpha", category: "archived" },
      ctx,
    );

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("validation");
  });

  test("returns conflict when destination already exists", async () => {
    const { ctx, rootDir } = await buildContext(workdir);
    await writeProject(
      rootDir,
      "lab/alpha",
      metadataFor({ id: "01HAAAAAAAAAAAAAAAAAAAAAAA", name: "alpha" }),
    );
    await mkdir(join(rootDir, "work", "alpha"), { recursive: true });

    const result = await handlePromote(
      { project: "alpha", category: "work" },
      ctx,
    );

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("filesystem");
  });

  test("returns not_found when the project does not exist", async () => {
    const { ctx } = await buildContext(workdir);

    const result = await handlePromote(
      { project: "ghost", category: "work" },
      ctx,
    );

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("not_found");
  });
});
