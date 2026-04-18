export const shellKinds = ["bash", "zsh", "fish", "powershell"] as const;

export type Shell = (typeof shellKinds)[number];

export type DetectShellOptions = {
  readonly platform?: NodeJS.Platform;
  readonly env?: Readonly<Record<string, string | undefined>>;
};

const shellFromBasename = (path: string): Shell | null => {
  const normalized = path.replace(/\\/gu, "/");
  const basename = normalized.slice(normalized.lastIndexOf("/") + 1);
  const lower = basename.toLowerCase();
  if (lower === "bash") return "bash";
  if (lower === "zsh") return "zsh";
  if (lower === "fish") return "fish";
  return null;
};

const isNonEmpty = (value: string | undefined): value is string =>
  value !== undefined && value.length > 0;

export const detectShell = (
  options: DetectShellOptions = {},
): Shell | null => {
  const platform = options.platform ?? process.platform;
  const env = options.env ?? process.env;

  const shellEnv = env["SHELL"];
  if (isNonEmpty(shellEnv)) {
    const detected = shellFromBasename(shellEnv);
    if (detected !== null) {
      return detected;
    }
  }

  if (platform === "win32") {
    if (isNonEmpty(env["PROFILE"]) || isNonEmpty(env["PSModulePath"])) {
      return "powershell";
    }
  }

  return null;
};
