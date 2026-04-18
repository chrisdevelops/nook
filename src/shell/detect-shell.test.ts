import { describe, expect, test } from "bun:test";

import { detectShell } from "./detect-shell.ts";

describe("detectShell", () => {
  test("returns zsh when $SHELL ends with /zsh", () => {
    expect(
      detectShell({
        platform: "darwin",
        env: { SHELL: "/bin/zsh" },
      }),
    ).toBe("zsh");
  });

  test("returns bash when $SHELL ends with /bash", () => {
    expect(
      detectShell({
        platform: "linux",
        env: { SHELL: "/usr/bin/bash" },
      }),
    ).toBe("bash");
  });

  test("returns fish when $SHELL ends with /fish", () => {
    expect(
      detectShell({
        platform: "linux",
        env: { SHELL: "/usr/local/bin/fish" },
      }),
    ).toBe("fish");
  });

  test("returns powershell on win32 when $PROFILE is set", () => {
    expect(
      detectShell({
        platform: "win32",
        env: {
          PROFILE:
            "C:\\Users\\Alex\\Documents\\PowerShell\\Microsoft.PowerShell_profile.ps1",
        },
      }),
    ).toBe("powershell");
  });

  test("returns powershell on win32 when $PSModulePath is set", () => {
    expect(
      detectShell({
        platform: "win32",
        env: {
          PSModulePath: "C:\\Program Files\\PowerShell\\Modules",
        },
      }),
    ).toBe("powershell");
  });

  test("returns null on win32 without PowerShell indicators", () => {
    expect(detectShell({ platform: "win32", env: {} })).toBe(null);
  });

  test("returns null when $SHELL is missing on non-Windows", () => {
    expect(detectShell({ platform: "linux", env: {} })).toBe(null);
  });

  test("returns null for unrecognised shells", () => {
    expect(
      detectShell({
        platform: "linux",
        env: { SHELL: "/usr/bin/tcsh" },
      }),
    ).toBe(null);
  });

  test("is case-insensitive on the shell basename", () => {
    expect(
      detectShell({
        platform: "linux",
        env: { SHELL: "/usr/bin/ZSH" },
      }),
    ).toBe("zsh");
  });

  test("prefers $SHELL over Windows PowerShell when both are set (user override)", () => {
    expect(
      detectShell({
        platform: "win32",
        env: {
          SHELL: "/usr/bin/bash",
          PSModulePath: "C:\\Program Files\\PowerShell\\Modules",
        },
      }),
    ).toBe("bash");
  });
});
