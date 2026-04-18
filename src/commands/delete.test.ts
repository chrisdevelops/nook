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
import { handleDelete } from "./delete.ts";

const NOW = 1_700_000_000_000;
const DAY_MS = 86_400_000;

const metadataFor = (overrides: Partial<ProjectMetadata>): ProjectMetadata => ({
  id: "01HZZZZZZZZZZZZZZZZZZZZZZZ",
  name: "placeholder",
  category: "work",
  state: "active",
  created_at: NOW - 30 * DAY_MS,
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
  readonly confirmCalls: { message: string }[];
  readonly inputCalls: { message: string }[];
  setConfirmAnswer: (value: boolean) => void;
  setInputAnswer: (value: string) => void;
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
    categories: { lab: {}, work: {} },
    aliases: {},
  };
  await mkdir(appPaths.config, { recursive: true });
  await writeFile(appPaths.configFilePath, JSON.stringify(config, null, 2), "utf8");
  await mkdir(rootDir, { recursive: true });

  const info: string[] = [];
  const confirmCalls: { message: string }[] = [];
  const inputCalls: { message: string }[] = [];
  let confirmAnswer = false;
  let inputAnswer = "";

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
    promptConfirm: (async (options: { message: string }) => {
      confirmCalls.push({ message: options.message });
      return confirmAnswer;
    }) as unknown as UI["promptConfirm"],
    promptInput: (async (options: { message: string }) => {
      inputCalls.push({ message: options.message });
      return inputAnswer;
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
    confirmCalls,
    inputCalls,
    setConfirmAnswer: (value: boolean) => {
      confirmAnswer = value;
    },
    setInputAnswer: (value: string) => {
      inputAnswer = value;
    },
  };
};

describe("handleDelete", () => {
  let workdir: string;

  beforeEach(async () => {
    workdir = await mkdtemp(join(tmpdir(), "nook-delete-"));
  });

  afterEach(async () => {
    await rm(workdir, { recursive: true, force: true });
  });

  test("deletes a project after initial confirm and typed name match", async () => {
    const { ctx, rootDir, confirmCalls, inputCalls, setConfirmAnswer, setInputAnswer } =
      await buildContext(workdir);
    setConfirmAnswer(true);
    setInputAnswer("alpha");
    const projectPath = await writeProject(
      rootDir,
      "work/alpha",
      metadataFor({ id: "01HAAAAAAAAAAAAAAAAAAAAAAA", name: "alpha" }),
    );

    const result = await handleDelete({ project: "alpha" }, ctx);

    expect(result.ok).toBe(true);
    expect(confirmCalls.length).toBe(1);
    expect(inputCalls.length).toBe(1);
    await expect(access(projectPath)).rejects.toThrow();
  });

  test("skips initial confirm with --yes but still requires typed name", async () => {
    const { ctx, rootDir, confirmCalls, inputCalls, setInputAnswer } =
      await buildContext(workdir);
    setInputAnswer("alpha");
    const projectPath = await writeProject(
      rootDir,
      "work/alpha",
      metadataFor({ id: "01HAAAAAAAAAAAAAAAAAAAAAAA", name: "alpha" }),
    );

    const result = await handleDelete({ project: "alpha", yes: true }, ctx);

    expect(result.ok).toBe(true);
    expect(confirmCalls.length).toBe(0);
    expect(inputCalls.length).toBe(1);
    await expect(access(projectPath)).rejects.toThrow();
  });

  test("aborts when user declines initial confirmation", async () => {
    const { ctx, rootDir, inputCalls, setConfirmAnswer } = await buildContext(
      workdir,
    );
    setConfirmAnswer(false);
    const projectPath = await writeProject(
      rootDir,
      "work/alpha",
      metadataFor({ id: "01HAAAAAAAAAAAAAAAAAAAAAAA", name: "alpha" }),
    );

    const result = await handleDelete({ project: "alpha" }, ctx);

    expect(result.ok).toBe(true);
    expect(inputCalls.length).toBe(0);
    await access(projectPath);
  });

  test("aborts when typed name does not match the project name", async () => {
    const { ctx, rootDir, setConfirmAnswer, setInputAnswer } = await buildContext(
      workdir,
    );
    setConfirmAnswer(true);
    setInputAnswer("beta");
    const projectPath = await writeProject(
      rootDir,
      "work/alpha",
      metadataFor({ id: "01HAAAAAAAAAAAAAAAAAAAAAAA", name: "alpha" }),
    );

    const result = await handleDelete({ project: "alpha" }, ctx);

    expect(result.ok).toBe(true);
    await access(projectPath);
  });

  test("aborts with --yes when typed name does not match", async () => {
    const { ctx, rootDir, setInputAnswer } = await buildContext(workdir);
    setInputAnswer("wrong");
    const projectPath = await writeProject(
      rootDir,
      "work/alpha",
      metadataFor({ id: "01HAAAAAAAAAAAAAAAAAAAAAAA", name: "alpha" }),
    );

    const result = await handleDelete({ project: "alpha", yes: true }, ctx);

    expect(result.ok).toBe(true);
    await access(projectPath);
  });

  test("deletes an archived project from <category>/archived/<name>", async () => {
    const { ctx, rootDir, setInputAnswer } = await buildContext(workdir);
    setInputAnswer("alpha");
    const projectPath = await writeProject(
      rootDir,
      "work/archived/alpha",
      metadataFor({
        id: "01HAAAAAAAAAAAAAAAAAAAAAAA",
        name: "alpha",
        state: "archived",
      }),
    );

    const result = await handleDelete({ project: "alpha", yes: true }, ctx);

    expect(result.ok).toBe(true);
    await expect(access(projectPath)).rejects.toThrow();
  });

  test("returns not_found when the project does not exist", async () => {
    const { ctx } = await buildContext(workdir);

    const result = await handleDelete({ project: "ghost", yes: true }, ctx);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("not_found");
  });
});
