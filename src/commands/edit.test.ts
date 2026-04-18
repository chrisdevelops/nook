import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { CommandContext, UI } from "../cli/command-types.ts";
import type {
  GlobalConfig,
  HistoryEventMetadataChanged,
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
import { handleEdit } from "./edit.ts";

const NOW = 1_700_000_000_000;

const metadataFor = (overrides: Partial<ProjectMetadata>): ProjectMetadata => ({
  id: "01HZZZZZZZZZZZZZZZZZZZZZZZ",
  name: "alpha",
  category: "active",
  state: "active",
  created_at: NOW,
  tags: ["old"],
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
    categories: { active: {} },
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

const readMetadata = async (projectDir: string): Promise<ProjectMetadata> => {
  const raw = await readFile(
    join(projectDir, ".nook", "project.jsonc"),
    "utf8",
  );
  return JSON.parse(raw) as ProjectMetadata;
};

const readLastEvent = async (
  projectDir: string,
): Promise<HistoryEventMetadataChanged> => {
  const raw = await readFile(
    join(projectDir, ".nook", "history.jsonl"),
    "utf8",
  );
  const lines = raw.trim().split("\n").filter((l) => l.length > 0);
  return JSON.parse(lines[lines.length - 1]!) as HistoryEventMetadataChanged;
};

describe("handleEdit", () => {
  let workdir: string;

  beforeEach(async () => {
    workdir = await mkdtemp(join(tmpdir(), "nook-edit-"));
  });

  afterEach(async () => {
    await rm(workdir, { recursive: true, force: true });
  });

  test("updates description and records a metadata_changed history event", async () => {
    const { ctx, rootDir } = await buildContext(workdir);
    const projectPath = await writeProject(
      rootDir,
      "active/alpha",
      metadataFor({ name: "alpha" }),
    );

    const result = await handleEdit(
      { project: "alpha", description: "new desc" },
      ctx,
    );

    expect(result.ok).toBe(true);
    const meta = await readMetadata(projectPath);
    expect(meta.description).toBe("new desc");

    const event = await readLastEvent(projectPath);
    expect(event.type).toBe("metadata_changed");
    expect(event.at).toBe(NOW);
    expect(event.changed_fields).toEqual(["description"]);
  });

  test("clears description when passed an empty string", async () => {
    const { ctx, rootDir } = await buildContext(workdir);
    const projectPath = await writeProject(
      rootDir,
      "active/alpha",
      metadataFor({ description: "old" }),
    );

    const result = await handleEdit(
      { project: "alpha", description: "" },
      ctx,
    );

    expect(result.ok).toBe(true);
    const meta = await readMetadata(projectPath);
    expect(meta.description).toBeUndefined();
  });

  test("adds and removes tags cumulatively", async () => {
    const { ctx, rootDir } = await buildContext(workdir);
    const projectPath = await writeProject(
      rootDir,
      "active/alpha",
      metadataFor({ tags: ["keep", "drop"] }),
    );

    const result = await handleEdit(
      {
        project: "alpha",
        addTags: ["foo", "bar"],
        removeTags: ["drop"],
      },
      ctx,
    );

    expect(result.ok).toBe(true);
    const meta = await readMetadata(projectPath);
    expect([...meta.tags].sort()).toEqual(["bar", "foo", "keep"]);

    const event = await readLastEvent(projectPath);
    expect(event.changed_fields).toEqual(["tags"]);
  });

  test("deduplicates tags on add (idempotent)", async () => {
    const { ctx, rootDir } = await buildContext(workdir);
    const projectPath = await writeProject(
      rootDir,
      "active/alpha",
      metadataFor({ tags: ["one"] }),
    );

    const result = await handleEdit(
      { project: "alpha", addTags: ["one", "two"] },
      ctx,
    );
    expect(result.ok).toBe(true);
    const meta = await readMetadata(projectPath);
    expect([...meta.tags].sort()).toEqual(["one", "two"]);
  });

  test("sets and clears notes", async () => {
    const { ctx, rootDir } = await buildContext(workdir);
    const projectPath = await writeProject(
      rootDir,
      "active/alpha",
      metadataFor({}),
    );

    const firstResult = await handleEdit(
      { project: "alpha", notes: "remember to update deps" },
      ctx,
    );
    expect(firstResult.ok).toBe(true);
    const afterSet = await readMetadata(projectPath);
    expect(afterSet.notes).toBe("remember to update deps");

    const secondResult = await handleEdit(
      { project: "alpha", clearNotes: true },
      ctx,
    );
    expect(secondResult.ok).toBe(true);
    const afterClear = await readMetadata(projectPath);
    expect(afterClear.notes).toBeUndefined();
  });

  test("records multiple changed fields in a single event", async () => {
    const { ctx, rootDir } = await buildContext(workdir);
    const projectPath = await writeProject(
      rootDir,
      "active/alpha",
      metadataFor({}),
    );

    const result = await handleEdit(
      {
        project: "alpha",
        description: "combined",
        addTags: ["t1"],
        notes: "notes body",
      },
      ctx,
    );
    expect(result.ok).toBe(true);

    const event = await readLastEvent(projectPath);
    expect([...event.changed_fields].sort()).toEqual([
      "description",
      "notes",
      "tags",
    ]);
  });

  test("rejects when no flags are supplied", async () => {
    const { ctx, rootDir } = await buildContext(workdir);
    await writeProject(rootDir, "active/alpha", metadataFor({}));

    const result = await handleEdit({ project: "alpha" }, ctx);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("validation");
    }
  });

  test("rejects --notes together with --clear-notes", async () => {
    const { ctx, rootDir } = await buildContext(workdir);
    await writeProject(rootDir, "active/alpha", metadataFor({}));

    const result = await handleEdit(
      { project: "alpha", notes: "x", clearNotes: true },
      ctx,
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("validation");
    }
  });

  test("fails with not_found for unknown project", async () => {
    const { ctx } = await buildContext(workdir);

    const result = await handleEdit(
      { project: "ghost", description: "x" },
      ctx,
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("not_found");
    }
  });

  test("skips writing and skips event when nothing effectively changes", async () => {
    const { ctx, rootDir, info } = await buildContext(workdir);
    const projectPath = await writeProject(
      rootDir,
      "active/alpha",
      metadataFor({ tags: ["one"] }),
    );

    const result = await handleEdit(
      { project: "alpha", addTags: ["one"], removeTags: ["not-present"] },
      ctx,
    );

    expect(result.ok).toBe(true);
    // No history event was written.
    let historyExists = true;
    try {
      await readFile(join(projectPath, ".nook", "history.jsonl"), "utf8");
    } catch {
      historyExists = false;
    }
    expect(historyExists).toBe(false);
    expect(info.some((m) => m.toLowerCase().includes("no changes"))).toBe(true);
  });
});
