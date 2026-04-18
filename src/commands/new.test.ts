import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  access,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
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
import { handleNew, type HandleNewDeps } from "./new.ts";

const NOW = 1_700_000_000_000;
const DAY_MS = 86_400_000;

type EditorCall = {
  readonly editor: string;
  readonly projectPath: string;
};

type ContextBundle = {
  readonly ctx: CommandContext;
  readonly rootDir: string;
  readonly editorCalls: readonly EditorCall[];
  readonly info: readonly string[];
};

const buildContext = async (
  workdir: string,
  overrides?: {
    readonly editor?: string;
    readonly categories?: readonly string[];
  },
): Promise<ContextBundle> => {
  const appPaths = resolveAppPaths({
    platform: "linux",
    env: { XDG_CONFIG_HOME: join(workdir, "cfg") },
    homeDir: workdir,
  });
  const rootDir = join(workdir, "Projects");
  const categoryRecord: Record<string, {}> = { lab: {} };
  for (const name of overrides?.categories ?? ["active"]) {
    categoryRecord[name] = {};
  }
  const config: GlobalConfig = {
    root: rootDir,
    defaults: {
      staleness_days: 60,
      on_stale: "prompt",
      scratch_prune_days: 7,
      pause_max_days: 90,
    },
    editors:
      overrides?.editor !== undefined ? { default: overrides.editor } : {},
    ai: {},
    categories: categoryRecord,
    aliases: {},
  };
  await mkdir(appPaths.config, { recursive: true });
  await writeFile(
    appPaths.configFilePath,
    JSON.stringify(config, null, 2),
    "utf8",
  );
  await mkdir(rootDir, { recursive: true });
  await mkdir(join(rootDir, "lab"), { recursive: true });
  for (const name of overrides?.categories ?? ["active"]) {
    await mkdir(join(rootDir, name), { recursive: true });
  }

  const info: string[] = [];
  const editorCalls: EditorCall[] = [];

  const launchEditor: UI["launchEditor"] = async (options) => {
    editorCalls.push({
      editor: options.editor,
      projectPath: options.projectPath,
    });
    return { ok: true, value: undefined };
  };

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
    launchEditor,
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

  return { ctx, rootDir, editorCalls, info };
};

describe("handleNew", () => {
  let workdir: string;

  beforeEach(async () => {
    workdir = await mkdtemp(join(tmpdir(), "nook-new-"));
  });

  afterEach(async () => {
    await rm(workdir, { recursive: true, force: true });
  });

  test("creates an incubating project in lab by default", async () => {
    const { ctx, rootDir } = await buildContext(workdir);

    const result = await handleNew({ name: "alpha" }, ctx);

    expect(result.ok).toBe(true);
    const projectPath = join(rootDir, "lab", "alpha");
    await access(join(projectPath, ".nook", "project.jsonc"));
    const metadataRaw = await readFile(
      join(projectPath, ".nook", "project.jsonc"),
      "utf8",
    );
    const metadata = JSON.parse(metadataRaw) as ProjectMetadata;
    expect(metadata.name).toBe("alpha");
    expect(metadata.category).toBe("lab");
    expect(metadata.state).toBe("incubating");
    expect(metadata.scratch).toBe(false);
    expect(metadata.created_at).toBe(NOW);
    expect(metadata.tags).toEqual([]);
    expect(metadata.id).toHaveLength(26);

    const historyRaw = await readFile(
      join(projectPath, ".nook", "history.jsonl"),
      "utf8",
    );
    const event = JSON.parse(historyRaw.trim().split("\n")[0]!);
    expect(event.type).toBe("created");
    expect(event.source).toBe("new");
    expect(event.at).toBe(NOW);
  });

  test("creates an active project when --category is given", async () => {
    const { ctx, rootDir } = await buildContext(workdir, {
      categories: ["client"],
    });

    const result = await handleNew(
      { name: "beta", category: "client" },
      ctx,
    );

    expect(result.ok).toBe(true);
    const projectPath = join(rootDir, "client", "beta");
    await access(join(projectPath, ".nook", "project.jsonc"));
    const metadata = JSON.parse(
      await readFile(join(projectPath, ".nook", "project.jsonc"), "utf8"),
    ) as ProjectMetadata;
    expect(metadata.category).toBe("client");
    expect(metadata.state).toBe("active");
  });

  test("marks project as scratch when --scratch is passed", async () => {
    const { ctx, rootDir } = await buildContext(workdir);

    const result = await handleNew(
      { name: "throwaway", scratch: true },
      ctx,
    );

    expect(result.ok).toBe(true);
    const metadata = JSON.parse(
      await readFile(
        join(rootDir, "lab", "throwaway", ".nook", "project.jsonc"),
        "utf8",
      ),
    ) as ProjectMetadata;
    expect(metadata.scratch).toBe(true);
  });

  test("stores description and tags on metadata", async () => {
    const { ctx, rootDir } = await buildContext(workdir);

    const result = await handleNew(
      {
        name: "gamma",
        description: "a thing",
        tags: "one, two , three",
      },
      ctx,
    );

    expect(result.ok).toBe(true);
    const metadata = JSON.parse(
      await readFile(
        join(rootDir, "lab", "gamma", ".nook", "project.jsonc"),
        "utf8",
      ),
    ) as ProjectMetadata;
    expect(metadata.description).toBe("a thing");
    expect(metadata.tags).toEqual(["one", "two", "three"]);
  });

  test("opens in configured editor by default", async () => {
    const { ctx, rootDir, editorCalls } = await buildContext(workdir, {
      editor: "code",
    });

    const result = await handleNew({ name: "delta" }, ctx);

    expect(result.ok).toBe(true);
    expect(editorCalls).toHaveLength(1);
    expect(editorCalls[0]?.editor).toBe("code");
    expect(editorCalls[0]?.projectPath).toBe(join(rootDir, "lab", "delta"));
  });

  test("does not open when --no-open is passed", async () => {
    const { ctx, editorCalls } = await buildContext(workdir, {
      editor: "code",
    });

    const result = await handleNew(
      { name: "epsilon", noOpen: true },
      ctx,
    );

    expect(result.ok).toBe(true);
    expect(editorCalls).toHaveLength(0);
  });

  test("rejects creation when destination already exists", async () => {
    const { ctx, rootDir } = await buildContext(workdir);
    await mkdir(join(rootDir, "lab", "zeta"), { recursive: true });

    const result = await handleNew({ name: "zeta" }, ctx);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("conflict");
    }
  });

  test("rejects invalid project names", async () => {
    const { ctx } = await buildContext(workdir);

    const result = await handleNew({ name: "bad/name" }, ctx);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("validation");
    }
  });

  test("rejects unknown category", async () => {
    const { ctx } = await buildContext(workdir);

    const result = await handleNew(
      { name: "theta", category: "personal" },
      ctx,
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("validation");
    }
  });

  test("rejects reserved category names", async () => {
    const { ctx } = await buildContext(workdir);

    const result = await handleNew(
      { name: "iota", category: "archived" },
      ctx,
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("validation");
    }
  });

  test("copies template contents from a local path", async () => {
    const { ctx, rootDir } = await buildContext(workdir);
    const templateDir = join(workdir, "template");
    await mkdir(templateDir, { recursive: true });
    await writeFile(join(templateDir, "README.md"), "hello from template");

    const result = await handleNew(
      { name: "kappa", template: templateDir },
      ctx,
    );

    expect(result.ok).toBe(true);
    const contents = await readFile(
      join(rootDir, "lab", "kappa", "README.md"),
      "utf8",
    );
    expect(contents).toBe("hello from template");
    const historyRaw = await readFile(
      join(rootDir, "lab", "kappa", ".nook", "history.jsonl"),
      "utf8",
    );
    const event = JSON.parse(historyRaw.trim().split("\n")[0]!);
    expect(event.template).toBe(templateDir);
  });

  test("forks an existing project excluding its .nook metadata", async () => {
    const { ctx, rootDir } = await buildContext(workdir);
    const sourcePath = join(rootDir, "lab", "source");
    await mkdir(join(sourcePath, ".nook"), { recursive: true });
    await writeFile(join(sourcePath, "src.txt"), "payload");
    const sourceMetadata: ProjectMetadata = {
      id: "01HAAAAAAAAAAAAAAAAAAAAAAA",
      name: "source",
      category: "lab",
      state: "incubating",
      created_at: NOW - 10 * DAY_MS,
      tags: [],
      scratch: false,
    };
    await writeFile(
      join(sourcePath, ".nook", "project.jsonc"),
      JSON.stringify(sourceMetadata, null, 2),
      "utf8",
    );

    const result = await handleNew(
      { name: "lambda", fork: "source" },
      ctx,
    );

    expect(result.ok).toBe(true);
    const forkPath = join(rootDir, "lab", "lambda");
    const copied = await readFile(join(forkPath, "src.txt"), "utf8");
    expect(copied).toBe("payload");
    // .nook should not be copied from the source — only the new metadata
    const metadataRaw = await readFile(
      join(forkPath, ".nook", "project.jsonc"),
      "utf8",
    );
    const metadata = JSON.parse(metadataRaw) as ProjectMetadata;
    expect(metadata.id).not.toBe(sourceMetadata.id);
    expect(metadata.name).toBe("lambda");

    const historyRaw = await readFile(
      join(forkPath, ".nook", "history.jsonl"),
      "utf8",
    );
    const event = JSON.parse(historyRaw.trim().split("\n")[0]!);
    expect(event.fork).toBe(sourcePath);
  });

  test("rejects --template and --fork together", async () => {
    const { ctx } = await buildContext(workdir);

    const result = await handleNew(
      {
        name: "mu",
        template: join(workdir, "any"),
        fork: "nope",
      },
      ctx,
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("validation");
    }
  });

  test("uses injected copyDir for template (no real fs copy)", async () => {
    const { ctx, rootDir } = await buildContext(workdir);
    const calls: Array<{ source: string; destination: string }> = [];
    const deps: HandleNewDeps = {
      copyDir: async (source, destination) => {
        calls.push({ source, destination });
        await mkdir(destination, { recursive: true });
      },
    };

    const result = await handleNew(
      { name: "nu", template: "/virtual/source" },
      ctx,
      deps,
    );

    expect(result.ok).toBe(true);
    expect(calls).toEqual([
      { source: "/virtual/source", destination: join(rootDir, "lab", "nu") },
    ]);
  });
});
