import { homedir } from "node:os";
import { posix, win32 } from "node:path";

export type AppPaths = {
  readonly config: string;
  readonly data: string;
  readonly cache: string;
  readonly configFilePath: string;
  readonly indexPath: string;
};

export type ResolveAppPathsOptions = {
  readonly platform?: NodeJS.Platform;
  readonly env?: Readonly<Record<string, string | undefined>>;
  readonly homeDir?: string;
};

const nonEmpty = (value: string | undefined): string | null =>
  value !== undefined && value.length > 0 ? value : null;

const resolveXdgDirs = (
  env: Readonly<Record<string, string | undefined>>,
  home: string,
): { config: string; data: string; cache: string } => ({
  config: posix.join(
    nonEmpty(env["XDG_CONFIG_HOME"]) ?? posix.join(home, ".config"),
    "nook",
  ),
  data: posix.join(
    nonEmpty(env["XDG_DATA_HOME"]) ?? posix.join(home, ".local", "share"),
    "nook",
  ),
  cache: posix.join(
    nonEmpty(env["XDG_CACHE_HOME"]) ?? posix.join(home, ".cache"),
    "nook",
  ),
});

const resolveWindowsDirs = (
  env: Readonly<Record<string, string | undefined>>,
  home: string,
): { config: string; data: string; cache: string } => {
  const appdata =
    nonEmpty(env["APPDATA"]) ?? win32.join(home, "AppData", "Roaming");
  const localAppdata =
    nonEmpty(env["LOCALAPPDATA"]) ?? win32.join(home, "AppData", "Local");
  return {
    config: win32.join(appdata, "nook", "Config"),
    data: win32.join(localAppdata, "nook", "Data"),
    cache: win32.join(localAppdata, "nook", "Cache"),
  };
};

export const resolveAppPaths = (
  options: ResolveAppPathsOptions = {},
): AppPaths => {
  const platform = options.platform ?? process.platform;
  const env = options.env ?? process.env;
  const home = options.homeDir ?? homedir();

  const dirs =
    platform === "win32"
      ? resolveWindowsDirs(env, home)
      : resolveXdgDirs(env, home);

  const joiner = platform === "win32" ? win32 : posix;
  return {
    ...dirs,
    configFilePath: joiner.join(dirs.config, "config.jsonc"),
    indexPath: joiner.join(dirs.config, "state", "index.sqlite"),
  };
};
