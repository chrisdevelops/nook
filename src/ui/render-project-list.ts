import {
  ANSI_BOLD,
  ANSI_RESET,
  ANSI_YELLOW,
  colorize,
} from "./ansi-colors.ts";
import { renderTable } from "./render-table.ts";

export type ProjectListRow = {
  readonly name: string;
  readonly state: string;
  readonly category: string;
  readonly lastTouched: string;
  readonly tags: readonly string[];
  readonly stale: boolean;
};

export type ProjectListSection = {
  readonly heading?: string | undefined;
  readonly rows: readonly ProjectListRow[];
};

export type RenderProjectListOptions = {
  readonly color: boolean;
};

const HEADER_ROW = ["NAME", "STATE", "CATEGORY", "LAST", "TAGS"] as const;

const rowToCells = (
  row: ProjectListRow,
  color: boolean,
): readonly string[] => [
  row.name,
  colorize(row.state, ANSI_YELLOW, color && row.stale),
  row.category,
  row.lastTouched,
  row.tags.join(", "),
];

const renderSection = (
  section: ProjectListSection,
  color: boolean,
): string => {
  const cells = section.rows.map((row) => rowToCells(row, color));
  const table = renderTable([HEADER_ROW, ...cells]);
  if (section.heading === undefined) {
    return table;
  }
  const heading = color
    ? `${ANSI_BOLD}${section.heading}${ANSI_RESET}`
    : section.heading;
  return `${heading}\n${table}`;
};

export const renderProjectList = (
  sections: readonly ProjectListSection[],
  options: RenderProjectListOptions,
): string => {
  const populated = sections.filter((section) => section.rows.length > 0);
  if (populated.length === 0) {
    return "No projects.\n";
  }
  return populated
    .map((section) => renderSection(section, options.color))
    .join("\n");
};
