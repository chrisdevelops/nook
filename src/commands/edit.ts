import type { Command } from "commander";

import type { CommandContext, CommandHandler } from "../cli/command-types.ts";
import type {
  HistoryEventMetadataChanged,
  ProjectMetadata,
} from "../core/project-types.ts";
import { err, isErr, ok } from "../core/result.ts";
import { CommandError } from "../errors/command-error.ts";
import { resolveProjectRef } from "./resolve-project-ref.ts";

export type EditArgs = {
  readonly project: string;
  readonly description?: string;
  readonly addTags?: readonly string[];
  readonly removeTags?: readonly string[];
  readonly notes?: string;
  readonly clearNotes?: boolean;
};

const dedupe = (values: readonly string[]): string[] => {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const v of values) {
    if (seen.has(v)) continue;
    seen.add(v);
    out.push(v);
  }
  return out;
};

const sameStringArray = (
  a: readonly string[],
  b: readonly string[],
): boolean => {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] !== b[i]) return false;
  }
  return true;
};

export const handleEdit: CommandHandler<EditArgs> = async (args, ctx) => {
  const hasAnyFlag =
    args.description !== undefined ||
    (args.addTags !== undefined && args.addTags.length > 0) ||
    (args.removeTags !== undefined && args.removeTags.length > 0) ||
    args.notes !== undefined ||
    args.clearNotes === true;
  if (!hasAnyFlag) {
    return err(
      new CommandError(
        "validation",
        "Nothing to edit. Pass at least one of --description, --add-tag, --remove-tag, --notes, --clear-notes.",
      ),
    );
  }
  if (args.notes !== undefined && args.clearNotes === true) {
    return err(
      new CommandError(
        "validation",
        "--notes and --clear-notes cannot be combined.",
      ),
    );
  }

  const resolved = await resolveProjectRef(ctx, args.project);
  if (isErr(resolved)) return resolved;
  const { path: projectPath, metadata } = resolved.value;

  const changedFields: string[] = [];
  const next: ProjectMetadata = { ...metadata };

  if (args.description !== undefined) {
    const trimmed = args.description;
    if (trimmed.length === 0) {
      if (metadata.description !== undefined) {
        delete (next as { description?: string }).description;
        changedFields.push("description");
      }
    } else if (metadata.description !== trimmed) {
      (next as { description?: string }).description = trimmed;
      changedFields.push("description");
    }
  }

  if (args.notes !== undefined) {
    if (args.notes.length === 0) {
      if (metadata.notes !== undefined) {
        delete (next as { notes?: string }).notes;
        changedFields.push("notes");
      }
    } else if (metadata.notes !== args.notes) {
      (next as { notes?: string }).notes = args.notes;
      changedFields.push("notes");
    }
  }

  if (args.clearNotes === true) {
    if (metadata.notes !== undefined) {
      delete (next as { notes?: string }).notes;
      changedFields.push("notes");
    }
  }

  const needsTagEdit =
    (args.addTags !== undefined && args.addTags.length > 0) ||
    (args.removeTags !== undefined && args.removeTags.length > 0);
  if (needsTagEdit) {
    const remove = new Set(args.removeTags ?? []);
    const afterRemove = metadata.tags.filter((t) => !remove.has(t));
    const combined = dedupe([...afterRemove, ...(args.addTags ?? [])]);
    if (!sameStringArray(combined, metadata.tags)) {
      (next as { tags: readonly string[] }).tags = combined;
      changedFields.push("tags");
    }
  }

  if (changedFields.length === 0) {
    ctx.ui.logger.info(`No changes to apply to '${metadata.name}'.`);
    return ok(undefined);
  }

  const writeResult = await ctx.storage.writeProjectMetadata(projectPath, next);
  if (isErr(writeResult)) {
    return err(writeResult.error);
  }

  const event: HistoryEventMetadataChanged = {
    type: "metadata_changed",
    at: ctx.clock.now(),
    changed_fields: changedFields,
  };
  const appendResult = await ctx.storage.appendHistoryEvent(
    projectPath,
    event,
  );
  if (isErr(appendResult)) {
    return err(appendResult.error);
  }

  ctx.ui.logger.info(
    `Updated '${metadata.name}' (${changedFields.join(", ")}).`,
  );
  return ok(undefined);
};

export const registerEditCommand = (
  program: Command,
  ctx: CommandContext,
): void => {
  program
    .command("edit <project>")
    .description("Edit project metadata (description, tags, notes)")
    .option("--description <text>", "Replace description (pass '' to clear)")
    .option(
      "--add-tag <tag>",
      "Add a tag (repeat to add multiple)",
      (value: string, previous: string[] = []) => [...previous, value],
    )
    .option(
      "--remove-tag <tag>",
      "Remove a tag (repeat to remove multiple)",
      (value: string, previous: string[] = []) => [...previous, value],
    )
    .option("--notes <text>", "Set notes (pass '' to clear)")
    .option("--clear-notes", "Clear the notes field")
    .action(
      async (
        project: string,
        options: {
          description?: string;
          addTag?: string[];
          removeTag?: string[];
          notes?: string;
          clearNotes?: boolean;
        },
      ) => {
        ctx.runResult(
          await handleEdit(
            {
              project,
              ...(options.description !== undefined
                ? { description: options.description }
                : {}),
              ...(options.addTag !== undefined && options.addTag.length > 0
                ? { addTags: options.addTag }
                : {}),
              ...(options.removeTag !== undefined &&
              options.removeTag.length > 0
                ? { removeTags: options.removeTag }
                : {}),
              ...(options.notes !== undefined ? { notes: options.notes } : {}),
              ...(options.clearNotes === true ? { clearNotes: true } : {}),
            },
            ctx,
          ),
        );
      },
    );
};
