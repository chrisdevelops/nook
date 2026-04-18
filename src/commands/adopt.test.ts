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
import { handleAdopt } from "./adopt.ts";

const NOW = 1_700_000_000_000;

type ContextBundle = {
  readonly ctx: CommandContext;
  readonly rootDir: string;
  readonly info: readonly string[];
};

const buildContext = async (
  workdir: string,
  overrides?: { readonly categories?: readonly string[] },
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
    editors: {},
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

describe("handleAdopt", () => {
  let workdir: string;

  beforeEach(async () => {
    workdir = await mkdtemp(join(tmpdir(), "nook-adopt-"));
  });

  afterEach(async () => {
    await rm(workdir, { recursive: true, force: true });
  });

  test("moves an external folder into lab by default and writes metadata", async () => {
    const { ctx, rootDir } = await buildContext(workdir);
    const externalPath = join(workdir, "external", "alpha");
    await mkdir(externalPath, { recursive: true });
    await writeFile(join(externalPath, "README.md"), "hello");

    const result = await handleAdopt({ path: externalPath }, ctx);

    expect(result.ok).toBe(true);
    const adoptedPath = join(rootDir, "lab", "alpha");
    await access(join(adoptedPath, "README.md"));
    await access(join(adoptedPath, ".nook", "project.jsonc"));

    // The original source should no longer exist.
    let sourceExists = true;
    try {
      await access(externalPath);
    } catch {
      sourceExists = false;
    }
    expect(sourceExists).toBe(false);

    const metadata = JSON.parse(
      await readFile(join(adoptedPath, ".nook", "project.jsonc"), "utf8"),
    ) as ProjectMetadata;
    expect(metadata.name).toBe("alpha");
    expect(metadata.category).toBe("lab");
    expect(metadata.state).toBe("incubating");
    expect(metadata.created_at).toBe(NOW);

    const historyRaw = await readFile(
      join(adoptedPath, ".nook", "history.jsonl"),
      "utf8",
    );
    const event = JSON.parse(historyRaw.trim().split("\n")[0]!);
    expect(event.type).toBe("created");
    expect(event.source).toBe("adopt");
    expect(event.at).toBe(NOW);
  });

  test("defaults state to active when category is not lab", async () => {
    const { ctx, rootDir } = await buildContext(workdir, {
      categories: ["client"],
    });
    const externalPath = join(workdir, "external", "beta");
    await mkdir(externalPath, { recursive: true });

    const result = await handleAdopt(
      { path: externalPath, category: "client" },
      ctx,
    );

    expect(result.ok).toBe(true);
    const metadata = JSON.parse(
      await readFile(
        join(rootDir, "client", "beta", ".nook", "project.jsonc"),
        "utf8",
      ),
    ) as ProjectMetadata;
    expect(metadata.category).toBe("client");
    expect(metadata.state).toBe("active");
  });

  test("honors --state override", async () => {
    const { ctx, rootDir } = await buildContext(workdir);
    const externalPath = join(workdir, "external", "gamma");
    await mkdir(externalPath, { recursive: true });

    const result = await handleAdopt(
      { path: externalPath, state: "maintained" },
      ctx,
    );

    expect(result.ok).toBe(true);
    const metadata = JSON.parse(
      await readFile(
        join(rootDir, "lab", "gamma", ".nook", "project.jsonc"),
        "utf8",
      ),
    ) as ProjectMetadata;
    expect(metadata.state).toBe("maintained");
  });

  test("--in-place registers at current path without moving", async () => {
    const { ctx } = await buildContext(workdir);
    const externalPath = join(workdir, "external", "delta");
    await mkdir(externalPath, { recursive: true });
    await writeFile(join(externalPath, "src.txt"), "payload");

    const result = await handleAdopt(
      { path: externalPath, inPlace: true },
      ctx,
    );

    expect(result.ok).toBe(true);
    await access(join(externalPath, ".nook", "project.jsonc"));
    // Source still has its original contents.
    const contents = await readFile(join(externalPath, "src.txt"), "utf8");
    expect(contents).toBe("payload");
  });

  test("rejects adopting a folder that is already a nook project", async () => {
    const { ctx } = await buildContext(workdir);
    const externalPath = join(workdir, "external", "epsilon");
    await mkdir(join(externalPath, ".nook"), { recursive: true });
    await writeFile(
      join(externalPath, ".nook", "project.jsonc"),
      JSON.stringify(
        {
          id: "01HAAAAAAAAAAAAAAAAAAAAAAA",
          name: "epsilon",
          category: "lab",
          state: "incubating",
          created_at: NOW,
          tags: [],
          scratch: false,
        },
        null,
        2,
      ),
      "utf8",
    );

    const result = await handleAdopt(
      { path: externalPath, inPlace: true },
      ctx,
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("conflict");
    }
  });

  test("returns not_found when source does not exist", async () => {
    const { ctx } = await buildContext(workdir);

    const result = await handleAdopt(
      { path: join(workdir, "missing") },
      ctx,
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("not_found");
    }
  });

  test("rejects reserved category", async () => {
    const { ctx } = await buildContext(workdir);
    const externalPath = join(workdir, "external", "zeta");
    await mkdir(externalPath, { recursive: true });

    const result = await handleAdopt(
      { path: externalPath, category: "archived" },
      ctx,
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("validation");
    }
  });

  test("rejects unknown category", async () => {
    const { ctx } = await buildContext(workdir);
    const externalPath = join(workdir, "external", "eta");
    await mkdir(externalPath, { recursive: true });

    const result = await handleAdopt(
      { path: externalPath, category: "personal" },
      ctx,
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("validation");
    }
  });

  test("rejects invalid --state value", async () => {
    const { ctx } = await buildContext(workdir);
    const externalPath = join(workdir, "external", "theta");
    await mkdir(externalPath, { recursive: true });

    const result = await handleAdopt(
      { path: externalPath, state: "bogus" },
      ctx,
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("validation");
    }
  });

  test("rejects adoption when destination already exists", async () => {
    const { ctx, rootDir } = await buildContext(workdir);
    const externalPath = join(workdir, "external", "iota");
    await mkdir(externalPath, { recursive: true });
    await mkdir(join(rootDir, "lab", "iota"), { recursive: true });

    const result = await handleAdopt({ path: externalPath }, ctx);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("conflict");
    }
  });

  test("applies description and tags", async () => {
    const { ctx, rootDir } = await buildContext(workdir);
    const externalPath = join(workdir, "external", "kappa");
    await mkdir(externalPath, { recursive: true });

    const result = await handleAdopt(
      {
        path: externalPath,
        description: "adopted",
        tags: "alpha, beta",
      },
      ctx,
    );

    expect(result.ok).toBe(true);
    const metadata = JSON.parse(
      await readFile(
        join(rootDir, "lab", "kappa", ".nook", "project.jsonc"),
        "utf8",
      ),
    ) as ProjectMetadata;
    expect(metadata.description).toBe("adopted");
    expect(metadata.tags).toEqual(["alpha", "beta"]);
  });
});
