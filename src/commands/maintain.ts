import type { Command } from "commander";

import type { CommandContext, CommandHandler } from "../cli/command-types.ts";
import type {
  HistoryEventStateChanged,
  ProjectMetadata,
} from "../core/project-types.ts";
import { isValidTransition } from "../core/state-transitions.ts";
import { err, isErr, ok } from "../core/result.ts";
import { StateTransitionError } from "../errors/state-transition-error.ts";
import { resolveProjectRef } from "./resolve-project-ref.ts";

export type MaintainArgs = {
  readonly project: string;
  readonly version?: string;
};

export const handleMaintain: CommandHandler<MaintainArgs> = async (
  args,
  ctx,
) => {
  const resolved = await resolveProjectRef(ctx, args.project);
  if (isErr(resolved)) {
    return resolved;
  }
  const { path: projectPath, metadata } = resolved.value;

  if (!isValidTransition(metadata.state, "maintained")) {
    return err(new StateTransitionError(metadata.state, "maintained"));
  }

  const now = ctx.clock.now();
  const { paused_until: _pausedUntil, ...rest } = metadata;
  const nextMetadata: ProjectMetadata = {
    ...rest,
    state: "maintained",
  };
  const writeResult = await ctx.storage.writeProjectMetadata(
    projectPath,
    nextMetadata,
  );
  if (isErr(writeResult)) {
    return err(writeResult.error);
  }

  const event: HistoryEventStateChanged = {
    type: "state_changed",
    at: now,
    from: metadata.state,
    to: "maintained",
    ...(args.version !== undefined ? { version: args.version } : {}),
  };
  const appendResult = await ctx.storage.appendHistoryEvent(projectPath, event);
  if (isErr(appendResult)) {
    return err(appendResult.error);
  }

  ctx.ui.logger.info(`Marked '${metadata.name}' as maintained.`);
  return ok(undefined);
};

export const registerMaintainCommand = (
  program: Command,
  ctx: CommandContext,
): void => {
  program
    .command("maintain <project>")
    .description(
      "Mark a project as maintained (feature complete, still receiving updates)",
    )
    .option("--version <version>", "Record the version reached in history")
    .action(
      async (project: string, options: { version?: string }) => {
        ctx.runResult(
          await handleMaintain(
            {
              project,
              ...(options.version !== undefined
                ? { version: options.version }
                : {}),
            },
            ctx,
          ),
        );
      },
    );
};
