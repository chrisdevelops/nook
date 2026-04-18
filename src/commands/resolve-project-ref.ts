import type { CommandContext } from "../cli/command-types.ts";
import type { GlobalConfig, ProjectMetadata } from "../core/project-types.ts";
import { err, isErr, ok, type Result } from "../core/result.ts";
import { CommandError } from "../errors/command-error.ts";
import { FilesystemError } from "../errors/filesystem-error.ts";

export type ResolvedProjectRef = {
  readonly path: string;
  readonly metadata: ProjectMetadata;
  readonly rootDir: string;
  readonly config: GlobalConfig;
};

const MISSING_CONFIG_MESSAGE =
  "Config file not found. Run 'nook init' to create one.";

const isMissingFileError = (error: unknown): boolean =>
  error instanceof FilesystemError &&
  error.cause !== undefined &&
  (error.cause as NodeJS.ErrnoException).code === "ENOENT";

export const resolveProjectRef = async (
  ctx: CommandContext,
  identifier: string,
): Promise<Result<ResolvedProjectRef, CommandError>> => {
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

  const findResult = await ctx.storage.findProject(config.root, identifier);
  if (isErr(findResult)) {
    return err(findResult.error);
  }
  const outcome = findResult.value;

  if (outcome.kind === "none") {
    return err(
      new CommandError(
        "not_found",
        `No project matches '${identifier}'.`,
      ),
    );
  }
  if (outcome.kind === "one") {
    return ok({
      path: outcome.project.path,
      metadata: outcome.project.metadata,
      rootDir: config.root,
      config,
    });
  }

  const choices = outcome.candidates.map((candidate) => ({
    value: candidate.path,
    name: `${candidate.metadata.name} — ${candidate.metadata.category}/${candidate.metadata.state} (${candidate.metadata.id.slice(0, 10)}…)`,
  }));
  const picked = await ctx.ui.promptSelect({
    message: `Multiple projects match '${identifier}'. Pick one:`,
    choices,
  });
  const chosen = outcome.candidates.find((c) => c.path === picked);
  if (chosen === undefined) {
    return err(
      new CommandError(
        "ambiguous_match",
        `Selection did not match any candidate for '${identifier}'.`,
      ),
    );
  }
  return ok({
    path: chosen.path,
    metadata: chosen.metadata,
    rootDir: config.root,
    config,
  });
};
