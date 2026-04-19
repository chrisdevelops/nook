import { mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import type { GlobalConfig } from "../../src/core/project-types.ts";
import { resolveAppPaths } from "../../src/platform/app-paths.ts";

const PROJECT_ROOT = new URL("../..", import.meta.url).pathname;
const ENTRY_POINT = join(PROJECT_ROOT, "bin", "nook.ts");

type Invocation = {
  readonly command: string;
  readonly prefixArgs: readonly string[];
};

let cachedInvocation: Invocation | null = null;

const resolveInvocation = (): Invocation => {
  if (cachedInvocation !== null) return cachedInvocation;
  const override = process.env["NOOK_E2E_BINARY"];
  if (override !== undefined && override.length > 0) {
    cachedInvocation = { command: override, prefixArgs: [] };
    return cachedInvocation;
  }
  // Running bin/nook.ts via bun keeps the harness portable: bun's own
  // compiled binaries cannot be ad-hoc codesigned on recent macOS, so a
  // build-and-run flow fails locally. Pointing NOOK_E2E_BINARY at a
  // prebuilt binary switches this harness to exercising that artifact.
  cachedInvocation = {
    command: process.execPath,
    prefixArgs: [ENTRY_POINT],
  };
  return cachedInvocation;
};

export const buildBinaryOnce = async (): Promise<string> => {
  return resolveInvocation().command;
};

export type IsolatedEnv = {
  readonly scratchDir: string;
  readonly home: string;
  readonly projectRoot: string;
  readonly configFilePath: string;
  readonly indexPath: string;
  readonly env: Record<string, string>;
};

export const createIsolatedEnv = async (
  label: string,
): Promise<IsolatedEnv> => {
  const stamp = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const scratchDir = join(tmpdir(), `nook-e2e-${label}-${stamp}`);
  const home = join(scratchDir, "home");
  const projectRoot = join(scratchDir, "projects");
  await mkdir(home, { recursive: true });
  await mkdir(projectRoot, { recursive: true });

  const envOverrides: Record<string, string> =
    process.platform === "win32"
      ? {
          USERPROFILE: home,
          APPDATA: join(home, "AppData", "Roaming"),
          LOCALAPPDATA: join(home, "AppData", "Local"),
        }
      : {
          HOME: home,
          XDG_CONFIG_HOME: join(home, ".config"),
          XDG_DATA_HOME: join(home, ".local", "share"),
          XDG_CACHE_HOME: join(home, ".cache"),
        };

  const appPaths = resolveAppPaths({
    platform: process.platform,
    env: envOverrides,
    homeDir: home,
  });

  const baseEnv: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined) baseEnv[key] = value;
  }
  const env = { ...baseEnv, ...envOverrides };

  return {
    scratchDir,
    home,
    projectRoot,
    configFilePath: appPaths.configFilePath,
    indexPath: appPaths.indexPath,
    env,
  };
};

export const destroyIsolatedEnv = async (iso: IsolatedEnv): Promise<void> => {
  await rm(iso.scratchDir, { recursive: true, force: true });
};

export type SeedConfigOverrides = {
  readonly categories?: Record<string, Record<string, unknown>>;
  readonly defaults?: Partial<GlobalConfig["defaults"]>;
  readonly editors?: GlobalConfig["editors"];
  readonly ai?: GlobalConfig["ai"];
  readonly aliases?: GlobalConfig["aliases"];
};

export const seedConfig = async (
  iso: IsolatedEnv,
  overrides: SeedConfigOverrides = {},
): Promise<GlobalConfig> => {
  const config: GlobalConfig = {
    root: iso.projectRoot,
    defaults: {
      staleness_days: 60,
      on_stale: "prompt",
      scratch_prune_days: 7,
      pause_max_days: 90,
      ...overrides.defaults,
    },
    editors: overrides.editors ?? {},
    ai: overrides.ai ?? {},
    categories: (overrides.categories as GlobalConfig["categories"]) ?? {
      active: {},
    },
    aliases: overrides.aliases ?? {},
  };
  await mkdir(dirname(iso.configFilePath), { recursive: true });
  await writeFile(iso.configFilePath, JSON.stringify(config, null, 2) + "\n");
  for (const category of Object.keys(config.categories)) {
    await mkdir(join(iso.projectRoot, category), { recursive: true });
  }
  await mkdir(join(iso.projectRoot, "lab"), { recursive: true });
  return config;
};

export type RunOptions = {
  readonly env: Record<string, string>;
  readonly cwd?: string;
  readonly stdin?: string;
  readonly timeoutMs?: number;
};

export type RunResult = {
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
};

export const runNook = async (
  args: readonly string[],
  options: RunOptions,
): Promise<RunResult> => {
  const invocation = resolveInvocation();
  const proc = Bun.spawn([invocation.command, ...invocation.prefixArgs, ...args], {
    cwd: options.cwd ?? process.cwd(),
    env: options.env,
    stdin: options.stdin === undefined ? "ignore" : "pipe",
    stdout: "pipe",
    stderr: "pipe",
  });
  if (options.stdin !== undefined && proc.stdin !== undefined) {
    const writer = proc.stdin as unknown as {
      write(chunk: string): void;
      end(): void;
    };
    writer.write(options.stdin);
    writer.end();
  }
  const timeoutMs = options.timeoutMs ?? 30_000;
  const timeoutHandle = setTimeout(() => {
    proc.kill();
  }, timeoutMs);
  try {
    const [code, stdout, stderr] = await Promise.all([
      proc.exited,
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
    ]);
    return { code, stdout, stderr };
  } finally {
    clearTimeout(timeoutHandle);
  }
};
