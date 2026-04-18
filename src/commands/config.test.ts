import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { CommandContext, UI } from "../cli/command-types.ts";
import type { GlobalConfig } from "../core/project-types.ts";
import { ok } from "../core/result.ts";
import { CommandError } from "../errors/command-error.ts";
import { resolveAppPaths } from "../platform/app-paths.ts";
import type { launchEditor } from "../platform/launch-editor.ts";
import {
  appendHistoryEvent,
  readHistoryEvents,
} from "../storage/project-history.ts";
import {
  readProjectMetadata,
  writeProjectMetadata,
} from "../storage/project-metadata.ts";
import {
  readGlobalConfig,
  writeGlobalConfig,
} from "../storage/global-config.ts";
import { findProject } from "../storage/find-project.ts";
import { openIndex } from "../storage/project-index.ts";
import type { Logger } from "../ui/logger.ts";
import {
  handleConfigCd,
  handleConfigEdit,
  handleConfigGet,
  handleConfigPath,
  handleConfigSet,
  handleConfigShow,
} from "./config.ts";

const validConfig: GlobalConfig = {
  root: "/projects",
  defaults: {
    staleness_days: 60,
    on_stale: "prompt",
    scratch_prune_days: 7,
    pause_max_days: 90,
  },
  editors: { default: "code" },
  ai: {},
  categories: {},
  aliases: {},
};

type CapturedLogger = {
  readonly logger: Logger;
  readonly info: string[];
  readonly warn: string[];
  readonly error: string[];
  readonly debug: string[];
};

const captureLogger = (): CapturedLogger => {
  const info: string[] = [];
  const warn: string[] = [];
  const error: string[] = [];
  const debug: string[] = [];
  return {
    logger: {
      info: (m) => info.push(m),
      warn: (m) => warn.push(m),
      error: (m) => error.push(m),
      debug: (m) => debug.push(m),
    },
    info,
    warn,
    error,
    debug,
  };
};

type EditorCall = Parameters<typeof launchEditor>[0];

const captureLaunchEditor = (): {
  readonly fake: typeof launchEditor;
  readonly calls: EditorCall[];
} => {
  const calls: EditorCall[] = [];
  const fake: typeof launchEditor = async (options) => {
    calls.push(options);
    return ok(undefined);
  };
  return { fake, calls };
};

const buildContext = async (
  workdir: string,
  overrides?: {
    readonly launchEditor?: typeof launchEditor;
    readonly env?: Readonly<Record<string, string | undefined>>;
  },
): Promise<{
  ctx: CommandContext;
  captured: CapturedLogger;
  appPaths: ReturnType<typeof resolveAppPaths>;
}> => {
  const appPaths = resolveAppPaths({
    platform: "linux",
    env: { XDG_CONFIG_HOME: workdir, ...(overrides?.env ?? {}) },
    homeDir: workdir,
  });
  const captured = captureLogger();
  const ui: UI = {
    logger: captured.logger,
    createSpinner: (() => {
      throw new Error("not used in config tests");
    }) as unknown as UI["createSpinner"],
    promptSelect: (() => {
      throw new Error("not used in config tests");
    }) as unknown as UI["promptSelect"],
    promptConfirm: (() => {
      throw new Error("not used in config tests");
    }) as unknown as UI["promptConfirm"],
    promptInput: (() => {
      throw new Error("not used in config tests");
    }) as unknown as UI["promptInput"],
    renderProjectList: (() => "") as unknown as UI["renderProjectList"],
    renderStatus: (() => "") as unknown as UI["renderStatus"],
    launchEditor:
      overrides?.launchEditor ?? captureLaunchEditor().fake,
    detectBinaryOnPath: (() => {
      throw new Error("not used in config tests");
    }) as unknown as UI["detectBinaryOnPath"],
    detectShell: (() => {
      throw new Error("not used in config tests");
    }) as unknown as UI["detectShell"],
    installRcIntegration: (() => {
      throw new Error("not used in config tests");
    }) as unknown as UI["installRcIntegration"],
  };
  const ctx: CommandContext = {
    config: validConfig,
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
  return { ctx, captured, appPaths };
};

const writeFixtureConfig = async (
  path: string,
  config: GlobalConfig,
): Promise<void> => {
  await mkdir(join(path, ".."), { recursive: true });
  await writeFile(path, `${JSON.stringify(config, null, 2)}\n`, "utf8");
};

describe("handleConfigPath", () => {
  let workdir: string;
  beforeEach(async () => {
    workdir = await mkdtemp(join(tmpdir(), "nook-config-cmd-"));
  });
  afterEach(async () => {
    await rm(workdir, { recursive: true, force: true });
  });

  test("logs the config file path and returns ok", async () => {
    const { ctx, captured, appPaths } = await buildContext(workdir);
    const result = await handleConfigPath({}, ctx);
    expect(result.ok).toBe(true);
    expect(captured.info).toEqual([appPaths.configFilePath]);
  });
});

describe("handleConfigCd", () => {
  let workdir: string;
  beforeEach(async () => {
    workdir = await mkdtemp(join(tmpdir(), "nook-config-cmd-"));
  });
  afterEach(async () => {
    await rm(workdir, { recursive: true, force: true });
  });

  test("logs the config folder path and returns ok", async () => {
    const { ctx, captured, appPaths } = await buildContext(workdir);
    const result = await handleConfigCd({}, ctx);
    expect(result.ok).toBe(true);
    expect(captured.info).toEqual([appPaths.config]);
  });
});

describe("handleConfigShow", () => {
  let workdir: string;
  beforeEach(async () => {
    workdir = await mkdtemp(join(tmpdir(), "nook-config-cmd-"));
  });
  afterEach(async () => {
    await rm(workdir, { recursive: true, force: true });
  });

  test("prints raw config file bytes and preserves JSONC comments", async () => {
    const { ctx, captured, appPaths } = await buildContext(workdir);
    const raw = [
      "// this is a nook config",
      '{ "root": "/projects",',
      '  "defaults": { "staleness_days": 60, "on_stale": "prompt", "scratch_prune_days": 7, "pause_max_days": 90 },',
      '  "editors": {}, "ai": {}, "categories": {}, "aliases": {} }',
    ].join("\n");
    await mkdir(appPaths.config, { recursive: true });
    await writeFile(appPaths.configFilePath, raw, "utf8");

    const result = await handleConfigShow({}, ctx);
    expect(result.ok).toBe(true);
    expect(captured.info.join("")).toBe(raw);
  });

  test("returns not_found error when config file is missing", async () => {
    const { ctx } = await buildContext(workdir);
    const result = await handleConfigShow({}, ctx);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("not_found");
      expect(result.error.message).toContain("nook init");
    }
  });
});

describe("handleConfigGet", () => {
  let workdir: string;
  beforeEach(async () => {
    workdir = await mkdtemp(join(tmpdir(), "nook-config-cmd-"));
  });
  afterEach(async () => {
    await rm(workdir, { recursive: true, force: true });
  });

  test("prints a primitive value as-is", async () => {
    const { ctx, captured, appPaths } = await buildContext(workdir);
    await writeFixtureConfig(appPaths.configFilePath, validConfig);

    const result = await handleConfigGet(
      { key: "defaults.staleness_days" },
      ctx,
    );
    expect(result.ok).toBe(true);
    expect(captured.info).toEqual(["60"]);
  });

  test("prints a nested object as JSON", async () => {
    const { ctx, captured, appPaths } = await buildContext(workdir);
    await writeFixtureConfig(appPaths.configFilePath, validConfig);

    const result = await handleConfigGet({ key: "defaults" }, ctx);
    expect(result.ok).toBe(true);
    expect(captured.info[0]).toContain("staleness_days");
    expect(captured.info[0]).toContain("60");
  });

  test("returns not_found for a missing key", async () => {
    const { ctx, appPaths } = await buildContext(workdir);
    await writeFixtureConfig(appPaths.configFilePath, validConfig);

    const result = await handleConfigGet(
      { key: "categories.missing" },
      ctx,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("not_found");
    }
  });

  test("returns error when config file does not exist", async () => {
    const { ctx } = await buildContext(workdir);
    const result = await handleConfigGet(
      { key: "defaults.staleness_days" },
      ctx,
    );
    expect(result.ok).toBe(false);
  });

  test("returns validation error for a malformed key", async () => {
    const { ctx, appPaths } = await buildContext(workdir);
    await writeFixtureConfig(appPaths.configFilePath, validConfig);

    const result = await handleConfigGet({ key: "foo..bar" }, ctx);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("validation");
    }
  });
});

describe("handleConfigSet", () => {
  let workdir: string;
  beforeEach(async () => {
    workdir = await mkdtemp(join(tmpdir(), "nook-config-cmd-"));
  });
  afterEach(async () => {
    await rm(workdir, { recursive: true, force: true });
  });

  test("coerces numeric strings to numbers", async () => {
    const { ctx, appPaths } = await buildContext(workdir);
    await writeFixtureConfig(appPaths.configFilePath, validConfig);

    const result = await handleConfigSet(
      { key: "defaults.staleness_days", value: "90" },
      ctx,
    );
    expect(result.ok).toBe(true);

    const persisted = JSON.parse(
      await readFile(appPaths.configFilePath, "utf8"),
    ) as { defaults: { staleness_days: number } };
    expect(persisted.defaults.staleness_days).toBe(90);
  });

  test("treats non-JSON values as strings", async () => {
    const { ctx, appPaths } = await buildContext(workdir);
    await writeFixtureConfig(appPaths.configFilePath, validConfig);

    const result = await handleConfigSet(
      { key: "editors.default", value: "zed" },
      ctx,
    );
    expect(result.ok).toBe(true);

    const persisted = JSON.parse(
      await readFile(appPaths.configFilePath, "utf8"),
    ) as { editors: { default: string } };
    expect(persisted.editors.default).toBe("zed");
  });

  test("auto-creates intermediate objects under categories", async () => {
    const { ctx, appPaths } = await buildContext(workdir);
    await writeFixtureConfig(appPaths.configFilePath, validConfig);

    const result = await handleConfigSet(
      { key: "categories.lab.staleness_days", value: "14" },
      ctx,
    );
    expect(result.ok).toBe(true);

    const persisted = JSON.parse(
      await readFile(appPaths.configFilePath, "utf8"),
    ) as { categories: Record<string, { staleness_days: number }> };
    expect(persisted.categories["lab"]?.staleness_days).toBe(14);
  });

  test("auto-creates intermediate objects under aliases", async () => {
    const { ctx, appPaths } = await buildContext(workdir);
    await writeFixtureConfig(appPaths.configFilePath, validConfig);

    const result = await handleConfigSet(
      { key: "aliases.zed.command", value: "zed {path}" },
      ctx,
    );
    expect(result.ok).toBe(true);

    const persisted = JSON.parse(
      await readFile(appPaths.configFilePath, "utf8"),
    ) as { aliases: Record<string, { command: string }> };
    expect(persisted.aliases["zed"]?.command).toBe("zed {path}");
  });

  test("rejects a mistyped top-level key rather than auto-creating it", async () => {
    const { ctx, appPaths } = await buildContext(workdir);
    await writeFixtureConfig(appPaths.configFilePath, validConfig);

    const result = await handleConfigSet(
      { key: "defualts.staleness_days", value: "90" },
      ctx,
    );
    expect(result.ok).toBe(false);

    const persisted = JSON.parse(
      await readFile(appPaths.configFilePath, "utf8"),
    ) as GlobalConfig;
    expect(persisted.defaults.staleness_days).toBe(60);
  });

  test("does not write the file when validation fails (e.g. wrong type)", async () => {
    const { ctx, appPaths } = await buildContext(workdir);
    await writeFixtureConfig(appPaths.configFilePath, validConfig);

    const result = await handleConfigSet(
      { key: "defaults.staleness_days", value: "not-a-number" },
      ctx,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("validation");
    }

    const persisted = JSON.parse(
      await readFile(appPaths.configFilePath, "utf8"),
    ) as GlobalConfig;
    expect(persisted.defaults.staleness_days).toBe(60);
  });
});

describe("handleConfigEdit", () => {
  let workdir: string;
  beforeEach(async () => {
    workdir = await mkdtemp(join(tmpdir(), "nook-config-cmd-"));
  });
  afterEach(async () => {
    await rm(workdir, { recursive: true, force: true });
  });

  test("spawns the editor from $EDITOR with cwd set to the config folder", async () => {
    const { fake, calls } = captureLaunchEditor();
    const { ctx, appPaths } = await buildContext(workdir, {
      launchEditor: fake,
      env: { EDITOR: "nvim" },
    });
    await writeFixtureConfig(appPaths.configFilePath, validConfig);

    const originalEnv = process.env["EDITOR"];
    process.env["EDITOR"] = "nvim";
    try {
      const result = await handleConfigEdit({}, ctx);
      expect(result.ok).toBe(true);
    } finally {
      if (originalEnv === undefined) {
        delete process.env["EDITOR"];
      } else {
        process.env["EDITOR"] = originalEnv;
      }
    }

    expect(calls.length).toBe(1);
    expect(calls[0]?.editor).toBe("nvim");
    expect(calls[0]?.projectPath).toBe(appPaths.configFilePath);
    expect(calls[0]?.cwd).toBe(appPaths.config);
  });

  test("falls back to editors.default when $EDITOR is unset", async () => {
    const { fake, calls } = captureLaunchEditor();
    const { ctx, appPaths } = await buildContext(workdir, {
      launchEditor: fake,
    });
    await writeFixtureConfig(appPaths.configFilePath, validConfig);

    const originalEnv = process.env["EDITOR"];
    delete process.env["EDITOR"];
    try {
      const result = await handleConfigEdit({}, ctx);
      expect(result.ok).toBe(true);
    } finally {
      if (originalEnv !== undefined) {
        process.env["EDITOR"] = originalEnv;
      }
    }

    expect(calls[0]?.editor).toBe("code");
  });

  test("returns validation error when neither EDITOR nor editors.default is set", async () => {
    const { fake, calls } = captureLaunchEditor();
    const noEditorConfig: GlobalConfig = {
      ...validConfig,
      editors: {},
    };
    const { ctx, appPaths } = await buildContext(workdir, {
      launchEditor: fake,
    });
    await writeFixtureConfig(appPaths.configFilePath, noEditorConfig);

    const originalEnv = process.env["EDITOR"];
    delete process.env["EDITOR"];
    try {
      const result = await handleConfigEdit({}, ctx);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe("validation");
      }
    } finally {
      if (originalEnv !== undefined) {
        process.env["EDITOR"] = originalEnv;
      }
    }

    expect(calls).toEqual([]);
  });

  test("returns not_found when config file is missing", async () => {
    const { fake, calls } = captureLaunchEditor();
    const { ctx } = await buildContext(workdir, { launchEditor: fake });

    const originalEnv = process.env["EDITOR"];
    process.env["EDITOR"] = "nvim";
    try {
      const result = await handleConfigEdit({}, ctx);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe("not_found");
      }
    } finally {
      if (originalEnv === undefined) {
        delete process.env["EDITOR"];
      } else {
        process.env["EDITOR"] = originalEnv;
      }
    }

    expect(calls).toEqual([]);
  });
});

describe("CommandError in config handlers", () => {
  test("CommandError.code discriminator still works for consumers", () => {
    const e = new CommandError("not_found", "x");
    expect(e.code).toBe("not_found");
  });
});
