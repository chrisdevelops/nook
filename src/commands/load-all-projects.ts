import type { CommandContext } from "../cli/command-types.ts";
import type { GlobalConfig, ProjectMetadata } from "../core/project-types.ts";
import { err, isErr, ok, type Result } from "../core/result.ts";
import { CommandError } from "../errors/command-error.ts";
import { FilesystemError } from "../errors/filesystem-error.ts";
import { computeLastTouched } from "../filesystem/compute-last-touched.ts";
import { discoverProjects } from "../filesystem/discover-projects.ts";

export type LoadedProject = {
  readonly path: string;
  readonly metadata: ProjectMetadata;
  readonly lastTouchedMs: number;
};

export type LoadAllProjectsResult = {
  readonly config: GlobalConfig;
  readonly rootDir: string;
  readonly projects: readonly LoadedProject[];
};

const MISSING_CONFIG_MESSAGE =
  "Config file not found. Run 'nook init' to create one.";

const isMissingFileError = (error: unknown): boolean =>
  error instanceof FilesystemError &&
  error.cause !== undefined &&
  (error.cause as NodeJS.ErrnoException).code === "ENOENT";

export const loadAllProjects = async (
  ctx: CommandContext,
): Promise<Result<LoadAllProjectsResult, CommandError>> => {
  const configResult = await ctx.storage.readGlobalConfig(
    ctx.appPaths.configFilePath,
  );
  if (isErr(configResult)) {
    if (isMissingFileError(configResult.error)) {
      return err(new CommandError("not_found", MISSING_CONFIG_MESSAGE));
    }
    return err(configResult.error);
  }
  const config = configResult.value;

  const discovered = await discoverProjects(config.root);
  if (isErr(discovered)) {
    return err(discovered.error);
  }

  const projects: LoadedProject[] = [];
  for (const projectPath of discovered.value) {
    const metadataResult = await ctx.storage.readProjectMetadata(projectPath);
    if (isErr(metadataResult)) {
      return err(metadataResult.error);
    }
    const metadata = metadataResult.value;

    const touchedResult = await computeLastTouched({ projectDir: projectPath });
    const lastTouchedMs =
      isErr(touchedResult) || touchedResult.value === null
        ? metadata.created_at
        : touchedResult.value;

    projects.push({ path: projectPath, metadata, lastTouchedMs });
  }

  return ok({ config, rootDir: config.root, projects });
};
