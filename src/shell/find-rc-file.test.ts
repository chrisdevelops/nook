import { describe, expect, test } from "bun:test";

import { findRcFile } from "./find-rc-file.ts";

describe("findRcFile", () => {
  test("zsh resolves to ~/.zshrc when ZDOTDIR is unset", () => {
    expect(
      findRcFile({
        shell: "zsh",
        homeDir: "/home/alex",
        env: {},
        platform: "linux",
      }),
    ).toBe("/home/alex/.zshrc");
  });

  test("zsh respects $ZDOTDIR when set", () => {
    expect(
      findRcFile({
        shell: "zsh",
        homeDir: "/home/alex",
        env: { ZDOTDIR: "/custom/zsh" },
        platform: "linux",
      }),
    ).toBe("/custom/zsh/.zshrc");
  });

  test("zsh ignores empty $ZDOTDIR and falls back to homeDir", () => {
    expect(
      findRcFile({
        shell: "zsh",
        homeDir: "/home/alex",
        env: { ZDOTDIR: "" },
        platform: "linux",
      }),
    ).toBe("/home/alex/.zshrc");
  });

  test("bash resolves to ~/.bashrc", () => {
    expect(
      findRcFile({
        shell: "bash",
        homeDir: "/home/alex",
        env: {},
        platform: "linux",
      }),
    ).toBe("/home/alex/.bashrc");
  });

  test("fish resolves to ~/.config/fish/config.fish when XDG_CONFIG_HOME is unset", () => {
    expect(
      findRcFile({
        shell: "fish",
        homeDir: "/home/alex",
        env: {},
        platform: "linux",
      }),
    ).toBe("/home/alex/.config/fish/config.fish");
  });

  test("fish respects $XDG_CONFIG_HOME", () => {
    expect(
      findRcFile({
        shell: "fish",
        homeDir: "/home/alex",
        env: { XDG_CONFIG_HOME: "/custom/xdg" },
        platform: "linux",
      }),
    ).toBe("/custom/xdg/fish/config.fish");
  });

  test("powershell uses $PROFILE verbatim when set", () => {
    expect(
      findRcFile({
        shell: "powershell",
        homeDir: "C:\\Users\\Alex",
        env: {
          PROFILE:
            "C:\\Users\\Alex\\Documents\\PowerShell\\Microsoft.PowerShell_profile.ps1",
        },
        platform: "win32",
      }),
    ).toBe(
      "C:\\Users\\Alex\\Documents\\PowerShell\\Microsoft.PowerShell_profile.ps1",
    );
  });

  test("powershell falls back to ~\\Documents\\PowerShell when $PROFILE is missing", () => {
    expect(
      findRcFile({
        shell: "powershell",
        homeDir: "C:\\Users\\Alex",
        env: {},
        platform: "win32",
      }),
    ).toBe(
      "C:\\Users\\Alex\\Documents\\PowerShell\\Microsoft.PowerShell_profile.ps1",
    );
  });
});
