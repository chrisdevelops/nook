import type { GlobalConfig, OnStaleAction } from "./project-types.ts";

export type ResolvedCategoryConfig = {
  readonly staleness_days: number;
  readonly on_stale: OnStaleAction;
  readonly scratch_prune_days: number;
  readonly pause_max_days: number;
};

export const resolveCategoryConfig = (
  config: GlobalConfig,
  categoryName: string,
): ResolvedCategoryConfig => {
  const override = config.categories[categoryName];
  const { defaults } = config;

  return {
    staleness_days: override?.staleness_days ?? defaults.staleness_days,
    on_stale: override?.on_stale ?? defaults.on_stale,
    scratch_prune_days:
      override?.scratch_prune_days ?? defaults.scratch_prune_days,
    pause_max_days: override?.pause_max_days ?? defaults.pause_max_days,
  };
};
