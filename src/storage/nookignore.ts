import ignore from "ignore";
import { join } from "node:path";

export type NookIgnore = {
  readonly ignores: (relativePath: string) => boolean;
};

const IGNORE_FILES = [".gitignore", ".nookignore"] as const;

export const loadNookIgnore = async (
  projectRoot: string,
): Promise<NookIgnore> => {
  const matcher = ignore();
  for (const filename of IGNORE_FILES) {
    const file = Bun.file(join(projectRoot, filename));
    if (await file.exists()) {
      matcher.add(await file.text());
    }
  }
  return {
    ignores: (relativePath) => matcher.ignores(relativePath),
  };
};
