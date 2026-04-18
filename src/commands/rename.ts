import { dirname, join } from "node:path";
import type { Command } from "commander";

import type { CommandContext, CommandHandler } from "../cli/command-types.ts";
import type {
  HistoryEventRenamed,
  ProjectMetadata,
} from "../core/project-types.ts";
import { err, isErr, ok } from "../core/result.ts";
import { CommandError } from "../errors/command-error.ts";
import { moveProject } from "../filesystem/move-project.ts";
import { resolveProjectRef } from "./resolve-project-ref.ts";

const VALID_NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/u;

export type RenameArgs = {
  readonly project: string;
  readonly newName: string;
};

export const handleRename: CommandHandler<RenameArgs> = async (args, ctx) => {
  if (!VALID_NAME_PATTERN.test(args.newName)) {
    return err(
      new CommandError(
        "validation",
        `New name '${args.newName}' is invalid. Use letters, digits, dot, underscore, or hyphen; must start with a letter or digit.`,
      ),
    );
  }

  const resolved = await resolveProjectRef(ctx, args.project);
  if (isErr(resolved)) {
    return resolved;
  }
  const { path: projectPath, metadata } = resolved.value;

  if (args.newName === metadata.name) {
    return err(
      new CommandError(
        "validation",
        `Project '${metadata.name}' already has that name.`,
      ),
    );
  }

  const destinationPath = join(dirname(projectPath), args.newName);

  const moveResult = await moveProject({
    source: projectPath,
    destination: destinationPath,
  });
  if (isErr(moveResult)) {
    return err(
      new CommandError(
        "filesystem",
        `Failed to rename folder: ${moveResult.error.message}`,
        { cause: moveResult.error },
      ),
    );
  }

  const now = ctx.clock.now();
  const nextMetadata: ProjectMetadata = {
    ...metadata,
    name: args.newName,
  };
  const writeResult = await ctx.storage.writeProjectMetadata(
    destinationPath,
    nextMetadata,
  );
  if (isErr(writeResult)) {
    await moveProject({ source: destinationPath, destination: projectPath });
    return err(
      new CommandError(
        "filesystem",
        `Failed to write project metadata: ${writeResult.error.message}`,
        { cause: writeResult.error },
      ),
    );
  }

  const event: HistoryEventRenamed = {
    type: "renamed",
    at: now,
    from: metadata.name,
    to: args.newName,
  };
  const appendResult = await ctx.storage.appendHistoryEvent(
    destinationPath,
    event,
  );
  if (isErr(appendResult)) {
    return err(
      new CommandError(
        "filesystem",
        `Failed to append history event: ${appendResult.error.message}`,
        { cause: appendResult.error },
      ),
    );
  }

  ctx.ui.logger.info(`Renamed '${metadata.name}' to '${args.newName}'.`);
  return ok(undefined);
};

export const registerRenameCommand = (
  program: Command,
  ctx: CommandContext,
): void => {
  program
    .command("rename <project> <new-name>")
    .description(
      "Rename a project folder and its display name (ID and history are preserved)",
    )
    .action(async (project: string, newName: string) => {
      ctx.runResult(await handleRename({ project, newName }, ctx));
    });
};
