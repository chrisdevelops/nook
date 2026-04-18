import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { CommandContext, UI } from "../cli/command-types.ts";
import type { GlobalConfig } from "../core/project-types.ts";
import { ok } from "../core/result.ts";
import { resolveAppPaths } from "../platform/app-paths.ts";
import type { detectBinaryOnPath } from "../platform/detect-binary-on-path.ts";
import type { detectShell } from "../shell/detect-shell.ts";
import type { installRcIntegration } from "../shell/install-rc-integration.ts";
import { findProject } from "../storage/find-project.ts";
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
import { openIndex } from "../storage/project-index.ts";
import type { Logger } from "../ui/logger.ts";
import { handleInit } from "./init.ts";

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

type Scripted = {
  readonly inputs?: readonly string[];
  readonly selects?: readonly unknown[];
  readonly confirms?: readonly boolean[];
};

const makePromptStubs = (scripted: Scripted) => {
  const inputs = [...(scripted.inputs ?? [])];
  const selects = [...(scripted.selects ?? [])];
  const confirms = [...(scripted.confirms ?? [])];
  const inputCalls: unknown[] = [];
  const selectCalls: unknown[] = [];
  const confirmCalls: unknown[] = [];
  return {
    inputCalls,
    selectCalls,
    confirmCalls,
    promptInput: (async (options: unknown) => {
      inputCalls.push(options);
      if (inputs.length === 0) {
        throw new Error("promptInput called more times than scripted");
      }
      return inputs.shift();
    }) as unknown as UI["promptInput"],
    promptSelect: (async (options: unknown) => {
      selectCalls.push(options);
      if (selects.length === 0) {
        throw new Error("promptSelect called more times than scripted");
      }
      return selects.shift();
    }) as unknown as UI["promptSelect"],
    promptConfirm: (async (options: unknown) => {
      confirmCalls.push(options);
      if (confirms.length === 0) {
        throw new Error("promptConfirm called more times than scripted");
      }
      return confirms.shift();
    }) as unknown as UI["promptConfirm"],
  };
};

type BuildContextOverrides = {
  readonly scripted?: Scripted;
  readonly detectBinaryOnPath?: typeof detectBinaryOnPath;
  readonly detectShell?: typeof detectShell;
  readonly installRcIntegration?: typeof installRcIntegration;
};

const buildContext = async (
  workdir: string,
  overrides: BuildContextOverrides = {},
): Promise<{
  ctx: CommandContext;
  captured: CapturedLogger;
  appPaths: ReturnType<typeof resolveAppPaths>;
  stubs: ReturnType<typeof makePromptStubs>;
  rcCalls: Parameters<typeof installRcIntegration>[0][];
}> => {
  const appPaths = resolveAppPaths({
    platform: "linux",
    env: { XDG_CONFIG_HOME: join(workdir, "cfg") },
    homeDir: workdir,
  });
  const captured = captureLogger();
  const stubs = makePromptStubs(overrides.scripted ?? {});

  const rcCalls: Parameters<typeof installRcIntegration>[0][] = [];
  const defaultInstallRc: typeof installRcIntegration = async (options) => {
    rcCalls.push(options);
    await writeFile(options.rcPath, options.snippet, "utf8");
    return ok("installed");
  };

  const defaultDetectBinary: typeof detectBinaryOnPath = async () => null;
  const defaultDetectShell: typeof detectShell = () => "zsh";

  const ui: UI = {
    logger: captured.logger,
    createSpinner: (() => {
      throw new Error("not used in init tests");
    }) as unknown as UI["createSpinner"],
    promptSelect: stubs.promptSelect,
    promptConfirm: stubs.promptConfirm,
    promptInput: stubs.promptInput,
    renderProjectList: (() => "") as unknown as UI["renderProjectList"],
    renderStatus: (() => "") as unknown as UI["renderStatus"],
    launchEditor: (() => {
      throw new Error("not used in init tests");
    }) as unknown as UI["launchEditor"],
    detectBinaryOnPath:
      overrides.detectBinaryOnPath ?? defaultDetectBinary,
    detectShell: overrides.detectShell ?? defaultDetectShell,
    installRcIntegration:
      overrides.installRcIntegration ?? defaultInstallRc,
  };

  const placeholderConfig: GlobalConfig = {
    root: "",
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

  const ctx: CommandContext = {
    config: placeholderConfig,
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

  return { ctx, captured, appPaths, stubs, rcCalls };
};

describe("handleInit — happy path", () => {
  let workdir: string;

  beforeEach(async () => {
    workdir = await mkdtemp(join(tmpdir(), "nook-init-"));
  });

  afterEach(async () => {
    await rm(workdir, { recursive: true, force: true });
  });

  test("writes config, creates root + category folders, installs rc snippet", async () => {
    const projectsDir = join(workdir, "Projects");

    const { ctx, captured, appPaths, rcCalls } = await buildContext(workdir, {
      scripted: {
        inputs: [
          projectsDir,
          "active,client",
          "60",
          "7",
        ],
        selects: ["__skip", "__skip"],
        confirms: [true, true],
      },
    });

    const result = await handleInit({}, ctx);

    expect(result.ok).toBe(true);

    const configRaw = await readFile(appPaths.configFilePath, "utf8");
    const parsed = JSON.parse(configRaw) as GlobalConfig;
    expect(parsed.root).toBe(projectsDir);
    expect(parsed.defaults.staleness_days).toBe(60);
    expect(parsed.defaults.scratch_prune_days).toBe(7);
    expect(parsed.defaults.on_stale).toBe("prompt");
    expect(parsed.defaults.pause_max_days).toBe(90);
    expect(parsed.editors).toEqual({});
    expect(parsed.ai).toEqual({});
    expect(Object.keys(parsed.categories).sort()).toEqual([
      "active",
      "client",
      "lab",
    ]);
    expect(parsed.categories["lab"]?.staleness_days).toBe(14);
    expect(parsed.categories["lab"]?.on_stale).toBe("prompt_prune");
    expect(parsed.aliases).toEqual({});

    expect((await stat(projectsDir)).isDirectory()).toBe(true);
    expect((await stat(join(projectsDir, "lab"))).isDirectory()).toBe(true);
    expect((await stat(join(projectsDir, "active"))).isDirectory()).toBe(true);
    expect((await stat(join(projectsDir, "client"))).isDirectory()).toBe(true);

    expect(rcCalls.length).toBe(1);
    expect(rcCalls[0]?.snippet).toContain("nook-cd");

    expect(captured.info.some((l) => l.includes("nook new"))).toBe(true);
  });

  test("writes nothing when user declines at the summary prompt", async () => {
    const projectsDir = join(workdir, "Projects");
    const { ctx, appPaths, rcCalls } = await buildContext(workdir, {
      scripted: {
        inputs: [projectsDir, "active", "60", "7"],
        selects: ["__skip", "__skip"],
        confirms: [true, false],
      },
    });

    const result = await handleInit({}, ctx);

    expect(result.ok).toBe(true);

    const { access } = await import("node:fs/promises");
    await expect(access(appPaths.configFilePath)).rejects.toBeDefined();
    await expect(access(projectsDir)).rejects.toBeDefined();
    expect(rcCalls).toEqual([]);
  });
});

describe("handleInit — existing config", () => {
  let workdir: string;

  beforeEach(async () => {
    workdir = await mkdtemp(join(tmpdir(), "nook-init-"));
  });

  afterEach(async () => {
    await rm(workdir, { recursive: true, force: true });
  });

  test("returns conflict error when config exists and --force is not set", async () => {
    const { ctx, appPaths } = await buildContext(workdir);
    const { mkdir: nodeMkdir } = await import("node:fs/promises");
    await nodeMkdir(appPaths.config, { recursive: true });
    await writeFile(appPaths.configFilePath, "{}", "utf8");

    const result = await handleInit({}, ctx);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("conflict");
      expect(result.error.message).toContain("--force");
    }
    const raw = await readFile(appPaths.configFilePath, "utf8");
    expect(raw).toBe("{}");
  });

  test("overwrites existing config when --force is set", async () => {
    const projectsDir = join(workdir, "Projects");
    const { ctx, appPaths } = await buildContext(workdir, {
      scripted: {
        inputs: [projectsDir, "active", "60", "7"],
        selects: ["__skip", "__skip"],
        confirms: [false, true],
      },
    });

    const { mkdir: nodeMkdir } = await import("node:fs/promises");
    await nodeMkdir(appPaths.config, { recursive: true });
    await writeFile(appPaths.configFilePath, '{"stale":true}', "utf8");

    const result = await handleInit({ force: true }, ctx);

    expect(result.ok).toBe(true);
    const raw = await readFile(appPaths.configFilePath, "utf8");
    const parsed = JSON.parse(raw) as GlobalConfig;
    expect(parsed.root).toBe(projectsDir);
    expect(parsed.defaults.staleness_days).toBe(60);
  });
});

describe("handleInit — validation", () => {
  let workdir: string;

  beforeEach(async () => {
    workdir = await mkdtemp(join(tmpdir(), "nook-init-"));
  });

  afterEach(async () => {
    await rm(workdir, { recursive: true, force: true });
  });

  test("rejects reserved category names (lab, archived, shipped)", async () => {
    const projectsDir = join(workdir, "Projects");
    const { ctx, appPaths } = await buildContext(workdir, {
      scripted: {
        inputs: [projectsDir, "active,shipped,client"],
      },
    });

    const result = await handleInit({}, ctx);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("validation");
      expect(result.error.message).toContain("shipped");
    }
    const { access } = await import("node:fs/promises");
    await expect(access(appPaths.configFilePath)).rejects.toBeDefined();
  });

  test("rejects non-numeric staleness threshold", async () => {
    const projectsDir = join(workdir, "Projects");
    const { ctx } = await buildContext(workdir, {
      scripted: {
        inputs: [projectsDir, "active", "not-a-number"],
      },
    });

    const result = await handleInit({}, ctx);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("validation");
      expect(result.error.message.toLowerCase()).toContain("staleness");
    }
  });
});

describe("handleInit — shell integration", () => {
  let workdir: string;

  beforeEach(async () => {
    workdir = await mkdtemp(join(tmpdir(), "nook-init-"));
  });

  afterEach(async () => {
    await rm(workdir, { recursive: true, force: true });
  });

  test("when user declines rc install, prints snippet and does not call installer", async () => {
    const projectsDir = join(workdir, "Projects");
    const { ctx, captured, rcCalls } = await buildContext(workdir, {
      scripted: {
        inputs: [projectsDir, "active", "60", "7"],
        selects: ["__skip", "__skip"],
        confirms: [false, true],
      },
    });

    const result = await handleInit({}, ctx);

    expect(result.ok).toBe(true);
    expect(rcCalls).toEqual([]);
    expect(
      captured.info.some((l) => l.includes("Paste the snippet above")),
    ).toBe(true);
  });

  test("when detectShell returns null, skips shell step gracefully", async () => {
    const projectsDir = join(workdir, "Projects");
    const { ctx, captured, rcCalls } = await buildContext(workdir, {
      detectShell: () => null,
      scripted: {
        inputs: [projectsDir, "active", "60", "7"],
        selects: ["__skip", "__skip"],
        confirms: [true],
      },
    });

    const result = await handleInit({}, ctx);

    expect(result.ok).toBe(true);
    expect(rcCalls).toEqual([]);
    expect(
      captured.info.some((l) => l.toLowerCase().includes("detect your shell")),
    ).toBe(true);
  });
});

describe("handleInit — editor and AI tool detection", () => {
  let workdir: string;

  beforeEach(async () => {
    workdir = await mkdtemp(join(tmpdir(), "nook-init-"));
  });

  afterEach(async () => {
    await rm(workdir, { recursive: true, force: true });
  });

  test("surfaces detected editors and writes chosen value to editors.default", async () => {
    const projectsDir = join(workdir, "Projects");
    const detectCalls: string[] = [];
    const { ctx, appPaths, stubs } = await buildContext(workdir, {
      detectBinaryOnPath: async (name) => {
        detectCalls.push(name);
        if (name === "code" || name === "cursor") {
          return `/usr/local/bin/${name}`;
        }
        if (name === "claude") {
          return "/usr/local/bin/claude";
        }
        return null;
      },
      scripted: {
        inputs: [projectsDir, "active", "60", "7"],
        selects: ["cursor", "claude"],
        confirms: [false, true],
      },
    });

    const result = await handleInit({}, ctx);
    expect(result.ok).toBe(true);

    const raw = await readFile(appPaths.configFilePath, "utf8");
    const parsed = JSON.parse(raw) as GlobalConfig;
    expect(parsed.editors.default).toBe("cursor");
    expect(parsed.ai.default).toBe("claude");

    expect(detectCalls).toContain("code");
    expect(detectCalls).toContain("cursor");
    expect(detectCalls).toContain("claude");

    const editorChoices = (
      stubs.selectCalls[0] as { choices: readonly { value: string }[] }
    ).choices.map((c) => c.value);
    expect(editorChoices).toEqual(["code", "cursor", "__other", "__skip"]);
  });
});
