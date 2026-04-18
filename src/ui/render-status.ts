import { ANSI_BOLD, ANSI_RESET } from "./ansi-colors.ts";
import { renderTable } from "./render-table.ts";

export type StatusStateCount = {
  readonly state: string;
  readonly count: number;
};

export type StatusHighlight = {
  readonly label: string;
  readonly items: readonly string[];
};

export type ProjectStatusSummary = {
  readonly stateCounts: readonly StatusStateCount[];
  readonly highlights: readonly StatusHighlight[];
};

export type RenderStatusOptions = {
  readonly color: boolean;
};

export const isStatusEmpty = (summary: ProjectStatusSummary): boolean => {
  const hasCount = summary.stateCounts.some((entry) => entry.count > 0);
  const hasHighlight = summary.highlights.some(
    (highlight) => highlight.items.length > 0,
  );
  return !hasCount && !hasHighlight;
};

const boldHeading = (value: string, color: boolean): string =>
  color ? `${ANSI_BOLD}${value}${ANSI_RESET}` : value;

const renderStateBlock = (
  stateCounts: readonly StatusStateCount[],
  color: boolean,
): string | null => {
  const nonZero = stateCounts.filter((entry) => entry.count > 0);
  if (nonZero.length === 0) {
    return null;
  }
  const rows = nonZero.map((entry) => [entry.state, String(entry.count)]);
  const table = renderTable(rows, { aligns: ["left", "right"] });
  return `${boldHeading("Projects by state:", color)}\n${table}`;
};

const renderHighlightBlock = (
  highlight: StatusHighlight,
  color: boolean,
): string => {
  const heading = boldHeading(`${highlight.label}:`, color);
  const bullets = highlight.items.map((item) => `  - ${item}`).join("\n");
  return `${heading}\n${bullets}\n`;
};

export const renderStatus = (
  summary: ProjectStatusSummary,
  options: RenderStatusOptions,
): string => {
  if (isStatusEmpty(summary)) {
    return "Nothing to report.\n";
  }

  const blocks: string[] = [];
  const stateBlock = renderStateBlock(summary.stateCounts, options.color);
  if (stateBlock !== null) {
    blocks.push(stateBlock);
  }
  for (const highlight of summary.highlights) {
    if (highlight.items.length === 0) {
      continue;
    }
    blocks.push(renderHighlightBlock(highlight, options.color));
  }
  return blocks.join("\n");
};
