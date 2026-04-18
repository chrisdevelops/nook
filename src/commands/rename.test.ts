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
import { handleRename } from "./rename.ts";

const NOW = 1_700_000_000_000;
const DAY_MS = 86_400_000;

const metadataFor = (overrides: Partial<ProjectMetadata>): ProjectMetadata => ({
  id: "01HZZZZZZZZZZZZZZZZZZZZZZZ",
  name: "placeholder",
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

describe("handleRename", () => {
  let workdir: string;

  beforeEach(async () => {
    workdir = await mkdtemp(join(tmpdir(), "nook-rename-"));
  });

  afterEach(async () => {
    await rm(workdir, { recursive: true, force: true });
  });

  test("renames folder and display name, preserves ID, records renamed event", async () => {
    const { ctx, rootDir } = await buildContext(workdir);
    const projectId = "01HAAAAAAAAAAAAAAAAAAAAAAA";
    await writeProject(
      rootDir,
      "work/alpha",
      metadataFor({ id: projectId, name: "alpha" }),
    );

    const result = await handleRename(
      { project: "alpha", newName: "beta" },
      ctx,
    );

    expect(result.ok).toBe(true);
    await expect(access(join(rootDir, "work", "alpha"))).rejects.toThrow();
    await access(join(rootDir, "work", "beta", ".nook", "project.jsonc"));

    const metadataRaw = await readFile(
      join(rootDir, "work", "beta", ".nook", "project.jsonc"),
      "utf8",
    );
    const metadata = JSON.parse(metadataRaw) as ProjectMetadata;
    expect(metadata.name).toBe("beta");
    expect(metadata.id).toBe(projectId);

    const historyRaw = await readFile(
      join(rootDir, "work", "beta", ".nook", "history.jsonl"),
      "utf8",
    );
    const event = JSON.parse(historyRaw.trim().split("\n")[0]!);
    expect(event).toMatchObject({
      type: "renamed",
      from: "alpha",
      to: "beta",
      at: NOW,
    });
  });

  test("renamed project is still findable by its ID prefix", async () => {
    const { ctx, rootDir } = await buildContext(workdir);
    const projectId = "01HAAAAAAAAAAAAAAAAAAAAAAA";
    await writeProject(
      rootDir,
      "work/alpha",
      metadataFor({ id: projectId, name: "alpha" }),
    );

    const result = await handleRename(
      { project: "alpha", newName: "beta" },
      ctx,
    );
    expect(result.ok).toBe(true);

    const lookup = await findProject(rootDir, "01HAAAAAAA");
    expect(lookup.ok).toBe(true);
    if (lookup.ok && lookup.value.kind === "one") {
      expect(lookup.value.project.metadata.name).toBe("beta");
      expect(lookup.value.project.path).toBe(join(rootDir, "work", "beta"));
    } else {
      throw new Error("expected a single matching project by ID prefix");
    }
  });

  test("renames a shipped project within its shipped/ folder", async () => {
    const { ctx, rootDir } = await buildContext(workdir);
    await writeProject(
      rootDir,
      "work/shipped/alpha",
      metadataFor({
        id: "01HAAAAAAAAAAAAAAAAAAAAAAA",
        name: "alpha",
        state: "shipped",
      }),
    );

    const result = await handleRename(
      { project: "alpha", newName: "beta" },
      ctx,
    );

    expect(result.ok).toBe(true);
    await access(
      join(rootDir, "work", "shipped", "beta", ".nook", "project.jsonc"),
    );
    await expect(
      access(join(rootDir, "work", "shipped", "alpha")),
    ).rejects.toThrow();
  });

  test("preserves prior history entries after rename", async () => {
    const { ctx, rootDir } = await buildContext(workdir);
    const projectDir = await writeProject(
      rootDir,
      "work/alpha",
      metadataFor({ id: "01HAAAAAAAAAAAAAAAAAAAAAAA", name: "alpha" }),
    );
    await writeFile(
      join(projectDir, ".nook", "history.jsonl"),
      `${JSON.stringify({ type: "created", at: NOW - 5 * DAY_MS, source: "new" })}\n`,
      "utf8",
    );

    const result = await handleRename(
      { project: "alpha", newName: "beta" },
      ctx,
    );
    expect(result.ok).toBe(true);

    const historyRaw = await readFile(
      join(rootDir, "work", "beta", ".nook", "history.jsonl"),
      "utf8",
    );
    const lines = historyRaw.trim().split("\n").map((l) => JSON.parse(l));
    expect(lines.length).toBe(2);
    expect(lines[0]).toMatchObject({ type: "created", source: "new" });
    expect(lines[1]).toMatchObject({
      type: "renamed",
      from: "alpha",
      to: "beta",
    });
  });

  test("rejects invalid new names", async () => {
    const { ctx, rootDir } = await buildContext(workdir);
    await writeProject(
      rootDir,
      "work/alpha",
      metadataFor({ id: "01HAAAAAAAAAAAAAAAAAAAAAAA", name: "alpha" }),
    );

    const result = await handleRename(
      { project: "alpha", newName: "bad/name" },
      ctx,
    );

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("validation");
  });

  test("rejects renaming to the same name", async () => {
    const { ctx, rootDir } = await buildContext(workdir);
    await writeProject(
      rootDir,
      "work/alpha",
      metadataFor({ id: "01HAAAAAAAAAAAAAAAAAAAAAAA", name: "alpha" }),
    );

    const result = await handleRename(
      { project: "alpha", newName: "alpha" },
      ctx,
    );

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("validation");
  });

  test("returns conflict when destination already exists", async () => {
    const { ctx, rootDir } = await buildContext(workdir);
    await writeProject(
      rootDir,
      "work/alpha",
      metadataFor({ id: "01HAAAAAAAAAAAAAAAAAAAAAAA", name: "alpha" }),
    );
    await mkdir(join(rootDir, "work", "beta"), { recursive: true });

    const result = await handleRename(
      { project: "alpha", newName: "beta" },
      ctx,
    );

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("filesystem");
  });

  test("returns not_found when the project does not exist", async () => {
    const { ctx } = await buildContext(workdir);

    const result = await handleRename(
      { project: "ghost", newName: "beta" },
      ctx,
    );

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("not_found");
  });
});
