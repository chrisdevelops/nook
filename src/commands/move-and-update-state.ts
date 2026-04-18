import type { CommandContext } from "../cli/command-types.ts";
import { projectLocationFor } from "../core/project-location.ts";
import type {
  HistoryEventCategoryChanged,
  HistoryEventStateChanged,
  ProjectMetadata,
  ProjectState,
} from "../core/project-types.ts";
import { err, isErr, ok, type Result } from "../core/result.ts";
import { CommandError } from "../errors/command-error.ts";
import { moveProject } from "../filesystem/move-project.ts";

export type MoveAndUpdateStateInput = {
  readonly ctx: CommandContext;
  readonly currentPath: string;
  readonly metadata: ProjectMetadata;
  readonly rootDir: string;
  readonly nextState: ProjectState;
  readonly nextCategory?: string;
  readonly now: number;
  readonly reason?: string;
  readonly version?: string;
};

export type MoveAndUpdateStateOutput = {
  readonly newPath: string;
};

export const moveAndUpdateState = async (
  input: MoveAndUpdateStateInput,
): Promise<Result<MoveAndUpdateStateOutput, CommandError>> => {
  const { ctx, currentPath, metadata, rootDir, nextState, now } = input;
  const nextCategory = input.nextCategory ?? metadata.category;
  const destinationPath = projectLocationFor(
    rootDir,
    nextCategory,
    nextState,
    metadata.name,
  );

  const moveNeeded = destinationPath !== currentPath;
  if (moveNeeded) {
    const moveResult = await moveProject({
      source: currentPath,
      destination: destinationPath,
    });
    if (isErr(moveResult)) {
      return err(
        new CommandError(
          "filesystem",
          `Failed to move project folder: ${moveResult.error.message}`,
          { cause: moveResult.error },
        ),
      );
    }
  }

  const { paused_until: _pausedUntil, ...rest } = metadata;
  const nextMetadata: ProjectMetadata = {
    ...rest,
    category: nextCategory,
    state: nextState,
  };
  const writeResult = await ctx.storage.writeProjectMetadata(
    destinationPath,
    nextMetadata,
  );
  if (isErr(writeResult)) {
    if (moveNeeded) {
      await moveProject({
        source: destinationPath,
        destination: currentPath,
      });
    }
    return err(
      new CommandError(
        "filesystem",
        `Failed to write project metadata: ${writeResult.error.message}`,
        { cause: writeResult.error },
      ),
    );
  }

  const stateEvent: HistoryEventStateChanged = {
    type: "state_changed",
    at: now,
    from: metadata.state,
    to: nextState,
    ...(input.reason !== undefined ? { reason: input.reason } : {}),
    ...(input.version !== undefined ? { version: input.version } : {}),
  };
  const appendStateResult = await ctx.storage.appendHistoryEvent(
    destinationPath,
    stateEvent,
  );
  if (isErr(appendStateResult)) {
    return err(
      new CommandError(
        "filesystem",
        `Failed to append history event: ${appendStateResult.error.message}`,
        { cause: appendStateResult.error },
      ),
    );
  }

  if (nextCategory !== metadata.category) {
    const categoryEvent: HistoryEventCategoryChanged = {
      type: "category_changed",
      at: now,
      from: metadata.category,
      to: nextCategory,
    };
    const appendCategoryResult = await ctx.storage.appendHistoryEvent(
      destinationPath,
      categoryEvent,
    );
    if (isErr(appendCategoryResult)) {
      return err(
        new CommandError(
          "filesystem",
          `Failed to append category change event: ${appendCategoryResult.error.message}`,
          { cause: appendCategoryResult.error },
        ),
      );
    }
  }

  return ok({ newPath: destinationPath });
};
