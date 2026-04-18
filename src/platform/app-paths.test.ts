import { describe, expect, test } from "bun:test";

import { resolveAppPaths } from "./app-paths.ts";

describe("resolveAppPaths", () => {
  test("linux uses ~/.config/nook without XDG overrides", () => {
    const paths = resolveAppPaths({
      platform: "linux",
      env: {},
      homeDir: "/home/alex",
    });
    expect(paths.config).toBe("/home/alex/.config/nook");
    expect(paths.data).toBe("/home/alex/.local/share/nook");
    expect(paths.cache).toBe("/home/alex/.cache/nook");
  });

  test("linux respects XDG_CONFIG_HOME, XDG_DATA_HOME, XDG_CACHE_HOME", () => {
    const paths = resolveAppPaths({
      platform: "linux",
      env: {
        XDG_CONFIG_HOME: "/custom/config",
        XDG_DATA_HOME: "/custom/data",
        XDG_CACHE_HOME: "/custom/cache",
      },
      homeDir: "/home/alex",
    });
    expect(paths.config).toBe("/custom/config/nook");
    expect(paths.data).toBe("/custom/data/nook");
    expect(paths.cache).toBe("/custom/cache/nook");
  });

  test("linux ignores empty XDG env values and falls back to defaults", () => {
    const paths = resolveAppPaths({
      platform: "linux",
      env: { XDG_CONFIG_HOME: "" },
      homeDir: "/home/alex",
    });
    expect(paths.config).toBe("/home/alex/.config/nook");
  });

  test("darwin overrides env-paths default to XDG-style ~/.config/nook", () => {
    const paths = resolveAppPaths({
      platform: "darwin",
      env: {},
      homeDir: "/Users/alex",
    });
    expect(paths.config).toBe("/Users/alex/.config/nook");
    expect(paths.data).toBe("/Users/alex/.local/share/nook");
    expect(paths.cache).toBe("/Users/alex/.cache/nook");
  });

  test("darwin respects XDG_CONFIG_HOME when set", () => {
    const paths = resolveAppPaths({
      platform: "darwin",
      env: { XDG_CONFIG_HOME: "/Users/alex/.cfg" },
      homeDir: "/Users/alex",
    });
    expect(paths.config).toBe("/Users/alex/.cfg/nook");
  });

  test("win32 uses APPDATA\\nook\\Config and LOCALAPPDATA for data/cache", () => {
    const paths = resolveAppPaths({
      platform: "win32",
      env: {
        APPDATA: "C:\\Users\\Alex\\AppData\\Roaming",
        LOCALAPPDATA: "C:\\Users\\Alex\\AppData\\Local",
      },
      homeDir: "C:\\Users\\Alex",
    });
    expect(paths.config).toBe(
      "C:\\Users\\Alex\\AppData\\Roaming\\nook\\Config",
    );
    expect(paths.data).toBe("C:\\Users\\Alex\\AppData\\Local\\nook\\Data");
    expect(paths.cache).toBe("C:\\Users\\Alex\\AppData\\Local\\nook\\Cache");
  });

  test("win32 falls back to homeDir-derived paths when APPDATA is missing", () => {
    const paths = resolveAppPaths({
      platform: "win32",
      env: {},
      homeDir: "C:\\Users\\Alex",
    });
    expect(paths.config).toBe(
      "C:\\Users\\Alex\\AppData\\Roaming\\nook\\Config",
    );
  });

  test("indexPath is config directory joined with state/index.sqlite", () => {
    const paths = resolveAppPaths({
      platform: "linux",
      env: {},
      homeDir: "/home/alex",
    });
    expect(paths.indexPath).toBe("/home/alex/.config/nook/state/index.sqlite");
  });

  test("configFilePath is config directory joined with config.jsonc", () => {
    const paths = resolveAppPaths({
      platform: "linux",
      env: {},
      homeDir: "/home/alex",
    });
    expect(paths.configFilePath).toBe(
      "/home/alex/.config/nook/config.jsonc",
    );
  });
});
