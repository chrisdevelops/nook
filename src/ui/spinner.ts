export type SpinnerWritable = {
  readonly write: (chunk: string) => void;
};

export type SpinnerOptions = {
  readonly stream: SpinnerWritable;
  readonly isTty: boolean;
  readonly frames?: readonly string[];
  readonly intervalMs?: number;
};

export type Spinner = {
  readonly start: (text: string) => void;
  readonly setText: (text: string) => void;
  readonly stop: (finalText?: string) => void;
};

const DEFAULT_FRAMES = [
  "⠋",
  "⠙",
  "⠹",
  "⠸",
  "⠼",
  "⠴",
  "⠦",
  "⠧",
  "⠇",
  "⠏",
] as const;
const DEFAULT_INTERVAL_MS = 80;
const CLEAR_LINE = "\r\x1b[K";

export const createSpinner = (options: SpinnerOptions): Spinner => {
  const frames = options.frames ?? DEFAULT_FRAMES;
  const intervalMs = options.intervalMs ?? DEFAULT_INTERVAL_MS;

  let currentText = "";
  let frameIndex = 0;
  let timer: ReturnType<typeof setInterval> | null = null;
  let running = false;

  const paintTtyFrame = (): void => {
    const frame = frames[frameIndex % frames.length] ?? "";
    options.stream.write(`\r${frame} ${currentText}`);
  };

  const clearTty = (): void => {
    options.stream.write(CLEAR_LINE);
  };

  const start = (text: string): void => {
    if (running) {
      return;
    }
    running = true;
    currentText = text;
    frameIndex = 0;

    if (!options.isTty) {
      options.stream.write(`${text}\n`);
      return;
    }

    paintTtyFrame();
    timer = setInterval(() => {
      frameIndex += 1;
      paintTtyFrame();
    }, intervalMs);
  };

  const setText = (text: string): void => {
    currentText = text;
    if (!running) {
      return;
    }
    if (!options.isTty) {
      options.stream.write(`${text}\n`);
      return;
    }
    paintTtyFrame();
  };

  const stop = (finalText?: string): void => {
    if (!running) {
      if (finalText !== undefined && !options.isTty) {
        options.stream.write(`${finalText}\n`);
      }
      return;
    }
    running = false;

    if (timer !== null) {
      clearInterval(timer);
      timer = null;
    }

    if (!options.isTty) {
      if (finalText !== undefined) {
        options.stream.write(`${finalText}\n`);
      }
      return;
    }

    clearTty();
    if (finalText !== undefined) {
      options.stream.write(`${finalText}\n`);
    } else {
      options.stream.write("\n");
    }
  };

  return { start, setText, stop };
};
