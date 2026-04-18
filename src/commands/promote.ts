import type { Command } from "commander";

import type { CommandContext, CommandHandler } from "../cli/command-types.ts";
import { isValidTransition } from "../core/state-transitions.ts";
import { err, isErr, ok } from "../core/result.ts";
import { CommandError } from "../errors/command-error.ts";
import { StateTransitionError } from "../errors/state-transition-error.ts";
import { moveAndUpdateState } from "./move-and-update-state.ts";
import { resolveProjectRef } from "./resolve-project-ref.ts";

const RESERVED_CATEGORIES: ReadonlySet<string> = new Set([
  "archived",
  "shipped",
  "lab",
]);

export type PromoteArgs = {
  readonly project: string;
  readonly category?: string;
};

export const handlePromote: CommandHandler<PromoteArgs> = async (args, ctx) => {
  const resolved = await resolveProjectRef(ctx, args.project);
  if (isErr(resolved)) {
    return resolved;
  }
  const { path: projectPath, metadata, rootDir, config } = resolved.value;

  if (!isValidTransition(metadata.state, "active")) {
    return err(new StateTransitionError(metadata.state, "active"));
  }
  if (metadata.state !== "incubating") {
    return err(new StateTransitionError(metadata.state, "active"));
  }

  const configuredCategories = Object.keys(config.categories).filter(
    (name) => !RESERVED_CATEGORIES.has(name),
  );

  let targetCategory: string;
  if (args.category !== undefined) {
    targetCategory = args.category;
  } else {
    if (configuredCategories.length === 0) {
      return err(
        new CommandError(
          "validation",
          "No non-lab categories are configured. Add one via 'nook config edit' first.",
        ),
      );
    }
    targetCategory = await ctx.ui.promptSelect({
      message: `Promote '${metadata.name}' to which category?`,
      choices: configuredCategories.map((name) => ({ value: name, name })),
    });
  }

  if (RESERVED_CATEGORIES.has(targetCategory)) {
    return err(
      new CommandError(
        "validation",
        `Category '${targetCategory}' is reserved and cannot be a promotion target.`,
      ),
    );
  }
  if (!Object.prototype.hasOwnProperty.call(config.categories, targetCategory)) {
    return err(
      new CommandError(
        "validation",
        `Unknown category '${targetCategory}'. Add it via 'nook config edit' first.`,
      ),
    );
  }

  const now = ctx.clock.now();
  const moveResult = await moveAndUpdateState({
    ctx,
    currentPath: projectPath,
    metadata,
    rootDir,
    nextState: "active",
    nextCategory: targetCategory,
    now,
  });
  if (isErr(moveResult)) {
    return err(moveResult.error);
  }

  ctx.ui.logger.info(
    `Promoted '${metadata.name}' to ${targetCategory} (active).`,
  );
  return ok(undefined);
};

export const registerPromoteCommand = (
  program: Command,
  ctx: CommandContext,
): void => {
  program
    .command("promote <project>")
    .description(
      "Promote an incubating project from lab to a category (state becomes active)",
    )
    .option("--category <name>", "Target category (prompts if omitted)")
    .action(async (project: string, options: { category?: string }) => {
      ctx.runResult(
        await handlePromote(
          {
            project,
            ...(options.category !== undefined
              ? { category: options.category }
              : {}),
          },
          ctx,
        ),
      );
    });
};
