import type { Command } from "commander";

const GROUPS = [
  { label: "Setup", names: ["init", "config"] },
  { label: "Create", names: ["new", "adopt", "promote"] },
  {
    label: "State transitions",
    names: [
      "pause",
      "unpause",
      "maintain",
      "unmaintain",
      "ship",
      "unship",
      "archive",
      "unarchive",
    ],
  },
  { label: "Manage", names: ["rename", "edit", "delete"] },
  { label: "Discover", names: ["ls", "info", "status", "stale"] },
  { label: "Navigate", names: ["open", "code", "ai", "cd", "alias"] },
  { label: "Maintenance", names: ["scan", "reindex", "doctor"] },
] as const;

const nameToGroup = (): ReadonlyMap<string, string> => {
  const map = new Map<string, string>();
  for (const group of GROUPS) {
    for (const name of group.names) {
      map.set(name, group.label);
    }
  }
  return map;
};

export const applyHelpGroups = (program: Command): void => {
  const lookup = nameToGroup();
  for (const child of program.commands) {
    const group = lookup.get(child.name());
    if (group !== undefined) {
      child.helpGroup(group);
    }
  }
};
