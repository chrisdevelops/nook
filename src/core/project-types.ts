export const projectStates = [
  "incubating",
  "active",
  "paused",
  "maintained",
  "shipped",
  "archived",
] as const;

export type ProjectState = (typeof projectStates)[number];

export const onStaleActions = ["prompt", "prompt_prune", "silent"] as const;

export type OnStaleAction = (typeof onStaleActions)[number];

export type ProjectMetadata = {
  readonly id: string;
  readonly name: string;
  readonly category: string;
  readonly state: ProjectState;
  readonly created_at: number;
  readonly tags: readonly string[];
  readonly description?: string;
  readonly notes?: string;
  readonly scratch: boolean;
  readonly paused_until?: number;
};

export type HistoryEventCreated = {
  readonly type: "created";
  readonly at: number;
  readonly source: "new" | "adopt";
  readonly template?: string;
  readonly fork?: string;
};

export type HistoryEventStateChanged = {
  readonly type: "state_changed";
  readonly at: number;
  readonly from: ProjectState;
  readonly to: ProjectState;
  readonly reason?: string;
  readonly version?: string;
  readonly paused_until?: number;
};

export type HistoryEventRenamed = {
  readonly type: "renamed";
  readonly at: number;
  readonly from: string;
  readonly to: string;
};

export type HistoryEventCategoryChanged = {
  readonly type: "category_changed";
  readonly at: number;
  readonly from: string;
  readonly to: string;
};

export type HistoryEventTouched = {
  readonly type: "touched";
  readonly at: number;
  readonly reason?: string;
};

export type HistoryEventMetadataChanged = {
  readonly type: "metadata_changed";
  readonly at: number;
  readonly changed_fields: readonly string[];
};

export type HistoryEvent =
  | HistoryEventCreated
  | HistoryEventStateChanged
  | HistoryEventRenamed
  | HistoryEventCategoryChanged
  | HistoryEventTouched
  | HistoryEventMetadataChanged;

export type CategoryConfig = {
  readonly staleness_days?: number;
  readonly on_stale?: OnStaleAction;
  readonly scratch_prune_days?: number;
  readonly pause_max_days?: number;
};

export type GlobalDefaults = {
  readonly staleness_days: number;
  readonly on_stale: OnStaleAction;
  readonly scratch_prune_days: number;
  readonly pause_max_days: number;
};

export type EditorsConfig = {
  readonly default?: string;
};

export type AiConfig = {
  readonly default?: string;
};

export type AliasConfig = {
  readonly command: string;
};

export type GlobalConfig = {
  readonly root: string;
  readonly defaults: GlobalDefaults;
  readonly editors: EditorsConfig;
  readonly ai: AiConfig;
  readonly categories: Readonly<Record<string, CategoryConfig>>;
  readonly aliases: Readonly<Record<string, AliasConfig>>;
};
