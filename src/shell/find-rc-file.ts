import { homedir } from "node:os";
import { posix, win32 } from "node:path";

import type { Shell } from "./detect-shell.ts";

export type FindRcFileOptions = {
  readonly shell: Shell;
  readonly homeDir?: string;
  readonly env?: Readonly<Record<string, string | undefined>>;
  readonly platform?: NodeJS.Platform;
};

const nonEmpty = (value: string | undefined): string | null =>
  value !== undefined && value.length > 0 ? value : null;

export const findRcFile = (options: FindRcFileOptions): string => {
  const env = options.env ?? process.env;
  const home = options.homeDir ?? homedir();
  const platform = options.platform ?? process.platform;

  switch (options.shell) {
    case "zsh": {
      const zdotdir = nonEmpty(env["ZDOTDIR"]) ?? home;
      return posix.join(zdotdir, ".zshrc");
    }
    case "bash":
      return posix.join(home, ".bashrc");
    case "fish": {
      const xdg =
        nonEmpty(env["XDG_CONFIG_HOME"]) ?? posix.join(home, ".config");
      return posix.join(xdg, "fish", "config.fish");
    }
    case "powershell": {
      const profile = nonEmpty(env["PROFILE"]);
      if (profile !== null) {
        return profile;
      }
      const joiner = platform === "win32" ? win32 : posix;
      return joiner.join(
        home,
        "Documents",
        "PowerShell",
        "Microsoft.PowerShell_profile.ps1",
      );
    }
  }
};
