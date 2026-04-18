import { join } from "node:path";

import type { ProjectState } from "./project-types.ts";

export const projectLocationFor = (
  rootDir: string,
  category: string,
  state: ProjectState,
  name: string,
): string => {
  if (state === "shipped") {
    return join(rootDir, category, "shipped", name);
  }
  if (state === "archived") {
    return join(rootDir, category, "archived", name);
  }
  return join(rootDir, category, name);
};
