import { readdir } from "node:fs/promises";
import { join } from "node:path";

export type OrphanFolder = {
  readonly path: string;
  readonly category: string;
  readonly parentSegment: "shipped" | "archived" | null;
};

const RESERVED_SUBFOLDERS: ReadonlySet<string> = new Set([
  "shipped",
  "archived",
]);

const listSubdirs = async (dir: string): Promise<string[]> => {
  try {
    const entries = await readdir(dir, { withFileTypes: true });
    return entries
      .filter((e) => e.isDirectory() && !e.name.startsWith("."))
      .map((e) => e.name);
  } catch {
    return [];
  }
};

export const findOrphanFolders = async (
  rootDir: string,
  knownProjectPaths: ReadonlySet<string>,
): Promise<readonly OrphanFolder[]> => {
  const orphans: OrphanFolder[] = [];
  const topDirs = await listSubdirs(rootDir);
  for (const top of topDirs) {
    const topPath = join(rootDir, top);
    const children = await listSubdirs(topPath);
    for (const child of children) {
      const childPath = join(topPath, child);
      if (top !== "lab" && RESERVED_SUBFOLDERS.has(child)) {
        const grandchildren = await listSubdirs(childPath);
        for (const gc of grandchildren) {
          const gcPath = join(childPath, gc);
          if (knownProjectPaths.has(gcPath)) continue;
          orphans.push({
            path: gcPath,
            category: top,
            parentSegment: child as "shipped" | "archived",
          });
        }
        continue;
      }
      if (knownProjectPaths.has(childPath)) continue;
      orphans.push({
        path: childPath,
        category: top,
        parentSegment: null,
      });
    }
  }
  return orphans;
};
