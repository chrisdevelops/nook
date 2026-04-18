export type WhichFn = (cmd: string) => string | null;

const defaultWhich: WhichFn = (cmd) => Bun.which(cmd);

export type DetectBinaryOnPathOptions = {
  readonly which?: WhichFn;
};

export const detectBinaryOnPath = async (
  name: string,
  options: DetectBinaryOnPathOptions = {},
): Promise<string | null> => {
  const trimmed = name.trim();
  if (trimmed.length === 0) {
    return null;
  }
  const which = options.which ?? defaultWhich;
  return which(trimmed);
};
