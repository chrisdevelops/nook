export const ANSI_RESET = "\x1b[0m";

export const ANSI_BOLD = "\x1b[1m";
export const ANSI_DIM = "\x1b[2m";
export const ANSI_ITALIC = "\x1b[3m";
export const ANSI_UNDERLINE = "\x1b[4m";

export const ANSI_BLACK = "\x1b[30m";
export const ANSI_RED = "\x1b[31m";
export const ANSI_GREEN = "\x1b[32m";
export const ANSI_YELLOW = "\x1b[33m";
export const ANSI_BLUE = "\x1b[34m";
export const ANSI_MAGENTA = "\x1b[35m";
export const ANSI_CYAN = "\x1b[36m";
export const ANSI_WHITE = "\x1b[37m";
export const ANSI_GRAY = "\x1b[90m";

export const ANSI_BRIGHT_RED = "\x1b[91m";
export const ANSI_BRIGHT_GREEN = "\x1b[92m";
export const ANSI_BRIGHT_YELLOW = "\x1b[93m";
export const ANSI_BRIGHT_BLUE = "\x1b[94m";
export const ANSI_BRIGHT_MAGENTA = "\x1b[95m";
export const ANSI_BRIGHT_CYAN = "\x1b[96m";
export const ANSI_BRIGHT_WHITE = "\x1b[97m";

const ANSI_ESCAPE_PATTERN = /\x1b\[[0-9;]*m/g;

export const stripAnsi = (value: string): string =>
  value.replace(ANSI_ESCAPE_PATTERN, "");

export const colorize = (
  value: string,
  color: string,
  enabled: boolean,
): string => (enabled ? `${color}${value}${ANSI_RESET}` : value);

export const stateColors: Readonly<Record<string, string>> = {
  active: ANSI_GREEN,
  incubating: ANSI_CYAN,
  paused: ANSI_YELLOW,
  maintained: ANSI_BLUE,
  shipped: ANSI_MAGENTA,
  archived: ANSI_GRAY,
};

export const colorForState = (state: string): string =>
  stateColors[state] ?? "";
