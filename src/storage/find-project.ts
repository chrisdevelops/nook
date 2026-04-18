import { basename } from "node:path";

import type { ProjectMetadata } from "../core/project-types.ts";
import { err, isErr, ok, type Result } from "../core/result.ts";
import type { FilesystemError } from "../errors/filesystem-error.ts";
import type { ValidationError } from "../errors/validation-error.ts";
import { discoverProjects } from "../filesystem/discover-projects.ts";
import { readProjectMetadata } from "./project-metadata.ts";

export type ProjectLocation = {
  readonly path: string;
  readonly metadata: ProjectMetadata;
};

export type FindProjectOutcome =
  | { readonly kind: "none" }
  | { readonly kind: "one"; readonly project: ProjectLocation }
  | { readonly kind: "many"; readonly candidates: readonly ProjectLocation[] };

export const findProject = async (
  rootDir: string,
  identifier: string,
): Promise<Result<FindProjectOutcome, FilesystemError | ValidationError>> => {
  const discovered = await discoverProjects(rootDir);
  if (isErr(discovered)) {
    return err(discovered.error);
  }

  const normalizedId = identifier.toUpperCase();

  const matches: ProjectLocation[] = [];
  const seen = new Set<string>();

  for (const projectPath of discovered.value) {
    const readResult = await readProjectMetadata(projectPath);
    if (isErr(readResult)) {
      return err(readResult.error);
    }
    const metadata = readResult.value;
    const folderName = basename(projectPath);
    const idMatches = metadata.id.toUpperCase().startsWith(normalizedId);
    const nameMatches = folderName === identifier;
    if (nameMatches || idMatches) {
      if (!seen.has(projectPath)) {
        seen.add(projectPath);
        matches.push({ path: projectPath, metadata });
      }
    }
  }

  if (matches.length === 0) {
    return ok({ kind: "none" });
  }
  if (matches.length === 1) {
    return ok({ kind: "one", project: matches[0]! });
  }
  return ok({ kind: "many", candidates: matches });
};
