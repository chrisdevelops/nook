import { Type } from "@sinclair/typebox";
import { Value } from "@sinclair/typebox/value";

import type {
  GlobalConfig,
  HistoryEvent,
  ProjectMetadata,
} from "../core/project-types.ts";
import { err, ok, type Result } from "../core/result.ts";
import {
  ValidationError,
  type ValidationIssue,
} from "../errors/validation-error.ts";

const ProjectStateSchema = Type.Union([
  Type.Literal("incubating"),
  Type.Literal("active"),
  Type.Literal("paused"),
  Type.Literal("maintained"),
  Type.Literal("shipped"),
  Type.Literal("archived"),
]);

const OnStaleActionSchema = Type.Union([
  Type.Literal("prompt"),
  Type.Literal("prompt_prune"),
  Type.Literal("silent"),
]);

export const ProjectMetadataSchema = Type.Object({
  id: Type.String({ minLength: 26, maxLength: 26 }),
  name: Type.String({ minLength: 1 }),
  category: Type.String({ minLength: 1 }),
  state: ProjectStateSchema,
  created_at: Type.Integer({ minimum: 0 }),
  tags: Type.Array(Type.String()),
  description: Type.Optional(Type.String()),
  notes: Type.Optional(Type.String()),
  scratch: Type.Boolean(),
  paused_until: Type.Optional(Type.Integer({ minimum: 0 })),
});

const HistoryEventCreatedSchema = Type.Object({
  type: Type.Literal("created"),
  at: Type.Integer({ minimum: 0 }),
  source: Type.Union([Type.Literal("new"), Type.Literal("adopt")]),
  template: Type.Optional(Type.String()),
  fork: Type.Optional(Type.String()),
});

const HistoryEventStateChangedSchema = Type.Object({
  type: Type.Literal("state_changed"),
  at: Type.Integer({ minimum: 0 }),
  from: ProjectStateSchema,
  to: ProjectStateSchema,
  reason: Type.Optional(Type.String()),
  version: Type.Optional(Type.String()),
  paused_until: Type.Optional(Type.Integer({ minimum: 0 })),
});

const HistoryEventRenamedSchema = Type.Object({
  type: Type.Literal("renamed"),
  at: Type.Integer({ minimum: 0 }),
  from: Type.String({ minLength: 1 }),
  to: Type.String({ minLength: 1 }),
});

const HistoryEventCategoryChangedSchema = Type.Object({
  type: Type.Literal("category_changed"),
  at: Type.Integer({ minimum: 0 }),
  from: Type.String({ minLength: 1 }),
  to: Type.String({ minLength: 1 }),
});

const HistoryEventTouchedSchema = Type.Object({
  type: Type.Literal("touched"),
  at: Type.Integer({ minimum: 0 }),
  reason: Type.Optional(Type.String()),
});

const HistoryEventMetadataChangedSchema = Type.Object({
  type: Type.Literal("metadata_changed"),
  at: Type.Integer({ minimum: 0 }),
  changed_fields: Type.Array(Type.String({ minLength: 1 })),
});

export const HistoryEventSchema = Type.Union([
  HistoryEventCreatedSchema,
  HistoryEventStateChangedSchema,
  HistoryEventRenamedSchema,
  HistoryEventCategoryChangedSchema,
  HistoryEventTouchedSchema,
  HistoryEventMetadataChangedSchema,
]);

const CategoryConfigSchema = Type.Object({
  staleness_days: Type.Optional(Type.Integer({ minimum: 0 })),
  on_stale: Type.Optional(OnStaleActionSchema),
  scratch_prune_days: Type.Optional(Type.Integer({ minimum: 0 })),
  pause_max_days: Type.Optional(Type.Integer({ minimum: 0 })),
});

const GlobalDefaultsSchema = Type.Object({
  staleness_days: Type.Integer({ minimum: 0 }),
  on_stale: OnStaleActionSchema,
  scratch_prune_days: Type.Integer({ minimum: 0 }),
  pause_max_days: Type.Integer({ minimum: 0 }),
});

const AliasConfigSchema = Type.Object({
  command: Type.String({ minLength: 1 }),
});

export const GlobalConfigSchema = Type.Object({
  root: Type.String({ minLength: 1 }),
  defaults: GlobalDefaultsSchema,
  editors: Type.Object({ default: Type.Optional(Type.String()) }),
  ai: Type.Object({ default: Type.Optional(Type.String()) }),
  categories: Type.Record(Type.String(), CategoryConfigSchema),
  aliases: Type.Record(Type.String(), AliasConfigSchema),
});

const validate = <T>(
  schema: Parameters<typeof Value.Check>[0],
  input: unknown,
  label: string,
): Result<T, ValidationError> => {
  if (Value.Check(schema, input)) {
    return ok(input as T);
  }
  const issues: ValidationIssue[] = [];
  for (const issue of Value.Errors(schema, input)) {
    issues.push({ path: issue.path, message: issue.message });
    if (issues.length >= 20) break;
  }
  return err(new ValidationError(`${label} is invalid.`, issues, label));
};

export const validateProjectMetadata = (
  input: unknown,
): Result<ProjectMetadata, ValidationError> =>
  validate<ProjectMetadata>(ProjectMetadataSchema, input, "project metadata");

export const validateHistoryEvent = (
  input: unknown,
): Result<HistoryEvent, ValidationError> =>
  validate<HistoryEvent>(HistoryEventSchema, input, "history event");

export const validateGlobalConfig = (
  input: unknown,
): Result<GlobalConfig, ValidationError> =>
  validate<GlobalConfig>(GlobalConfigSchema, input, "global config");
