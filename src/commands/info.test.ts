import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { CommandContext, UI } from "../cli/command-types.ts";
import type {
  GlobalConfig,
  HistoryEvent,
  ProjectMetadata,
} from "../core/project-types.ts";
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
import { handleInfo } from "./info.ts";

const NOW = 1_700_000_000_000;
const DAY_MS = 86_400_000;

const metadataFor = (overrides: Partial<ProjectMetadata>): ProjectMetadata => ({
  id: "01HAAAAAAAAAAAAAAAAAAAAAAA",
  name: "alpha",
  category: "work",
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
  history?: readonly HistoryEvent[],
): Promise<string> => {
  const projectDir = join(rootDir, relativePath);
  await mkdir(join(projectDir, ".nook"), { recursive: true });
  await writeFile(
    join(projectDir, ".nook", "project.jsonc"),
    JSON.stringify(metadata, null, 2),
    "utf8",
  );
  if (history !== undefined) {
    const lines = history.map((event) => JSON.stringify(event)).join("\n");
    await writeFile(
      join(projectDir, ".nook", "history.jsonl"),
      `${lines}\n`,
      "utf8",
    );
  }
  return projectDir;
};

type Bundle = {
  readonly ctx: CommandContext;
  readonly rootDir: string;
  readonly info: string[];
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

describe("handleInfo", () => {
  let workdir: string;

  beforeEach(async () => {
    workdir = await mkdtemp(join(tmpdir(), "nook-info-"));
  });

  afterEach(async () => {
    await rm(workdir, { recursive: true, force: true });
  });

  test("prints a detail block with key fields for a project", async () => {
    const { ctx, rootDir, info } = await buildContext(workdir);
    await writeProject(
      rootDir,
      "work/alpha",
      metadataFor({
        id: "01HAAAAAAAAAAAAAAAAAAAAAAA",
        name: "alpha",
        category: "work",
        state: "active",
        tags: ["urgent", "billable"],
        description: "alpha description",
      }),
    );

    const result = await handleInfo({ project: "alpha" }, ctx);

    expect(result.ok).toBe(true);
    const output = info.join("\n");
    expect(output).toContain("alpha");
    expect(output).toContain("work");
    expect(output).toContain("active");
    expect(output).toContain("urgent, billable");
    expect(output).toContain("alpha description");
    expect(output).toContain("01HAAAAAAAAAAAAAAAAAAAAAAA");
  });

  test("--json emits a single JSON object including last_touched", async () => {
    const { ctx, rootDir, info } = await buildContext(workdir);
    await writeProject(
      rootDir,
      "work/alpha",
      metadataFor({ id: "01HAAAAAAAAAAAAAAAAAAAAAAA", name: "alpha" }),
    );

    const result = await handleInfo({ project: "alpha", json: true }, ctx);

    expect(result.ok).toBe(true);
    expect(info.length).toBe(1);
    const parsed = JSON.parse(info[0]!);
    expect(parsed.name).toBe("alpha");
    expect(parsed.id).toBe("01HAAAAAAAAAAAAAAAAAAAAAAA");
    expect(typeof parsed.last_touched).toBe("number");
    expect(parsed.history).toBeUndefined();
  });

  test("--history includes history events in default output", async () => {
    const { ctx, rootDir, info } = await buildContext(workdir);
    await writeProject(
      rootDir,
      "work/alpha",
      metadataFor({ id: "01HAAAAAAAAAAAAAAAAAAAAAAA", name: "alpha" }),
      [
        { type: "created", at: NOW - 5 * DAY_MS, source: "new" },
        {
          type: "state_changed",
          at: NOW - 2 * DAY_MS,
          from: "incubating",
          to: "active",
        },
      ],
    );

    const result = await handleInfo(
      { project: "alpha", history: true },
      ctx,
    );

    expect(result.ok).toBe(true);
    const output = info.join("\n");
    expect(output).toContain("created");
    expect(output).toContain("state_changed");
    expect(output).toContain("incubating");
    expect(output).toContain("active");
  });

  test("--history with --json nests the events in the payload", async () => {
    const { ctx, rootDir, info } = await buildContext(workdir);
    await writeProject(
      rootDir,
      "work/alpha",
      metadataFor({ id: "01HAAAAAAAAAAAAAAAAAAAAAAA", name: "alpha" }),
      [{ type: "created", at: NOW - 5 * DAY_MS, source: "new" }],
    );

    const result = await handleInfo(
      { project: "alpha", json: true, history: true },
      ctx,
    );

    expect(result.ok).toBe(true);
    const parsed = JSON.parse(info[0]!);
    expect(Array.isArray(parsed.history)).toBe(true);
    expect(parsed.history).toHaveLength(1);
    expect(parsed.history[0].type).toBe("created");
  });

  test("returns not_found when the project does not exist", async () => {
    const { ctx } = await buildContext(workdir);

    const result = await handleInfo({ project: "ghost" }, ctx);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("not_found");
  });
});
