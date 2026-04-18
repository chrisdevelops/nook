import type { ProjectState } from "./project-types.ts";

const transitions: Readonly<Record<ProjectState, readonly ProjectState[]>> = {
  incubating: ["active", "paused", "maintained", "shipped", "archived"],
  active: ["paused", "maintained", "shipped", "archived"],
  paused: ["active", "maintained", "shipped", "archived"],
  maintained: ["active", "paused", "shipped", "archived"],
  shipped: ["active", "maintained", "archived"],
  archived: ["active"],
};

export const allowedTargets = (from: ProjectState): readonly ProjectState[] =>
  transitions[from];

export const isValidTransition = (
  from: ProjectState,
  to: ProjectState,
): boolean => transitions[from].includes(to);
