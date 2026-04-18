import { describe, expect, test } from "bun:test";

import { stripAnsi } from "./ansi-colors.ts";
import {
  isStatusEmpty,
  renderStatus,
  type ProjectStatusSummary,
} from "./render-status.ts";

const empty: ProjectStatusSummary = {
  stateCounts: [],
  highlights: [],
};

describe("isStatusEmpty", () => {
  test("returns true for a summary with no counts and no highlights", () => {
    expect(isStatusEmpty(empty)).toBe(true);
  });

  test("returns true when every state count is zero", () => {
    expect(
      isStatusEmpty({
        stateCounts: [
          { state: "active", count: 0 },
          { state: "paused", count: 0 },
        ],
        highlights: [],
      }),
    ).toBe(true);
  });

  test("returns true when highlights have no items", () => {
    expect(
      isStatusEmpty({
        stateCounts: [],
        highlights: [{ label: "Stale", items: [] }],
      }),
    ).toBe(true);
  });

  test("returns false when at least one state count is non-zero", () => {
    expect(
      isStatusEmpty({
        stateCounts: [{ state: "active", count: 1 }],
        highlights: [],
      }),
    ).toBe(false);
  });

  test("returns false when a highlight has at least one item", () => {
    expect(
      isStatusEmpty({
        stateCounts: [],
        highlights: [{ label: "Stale", items: ["alpha"] }],
      }),
    ).toBe(false);
  });
});

describe("renderStatus", () => {
  test("empty summary renders 'Nothing to report.'", () => {
    expect(renderStatus(empty, { color: false })).toBe("Nothing to report.\n");
  });

  test("renders a 'Projects by state' block with padded counts", () => {
    const output = renderStatus(
      {
        stateCounts: [
          { state: "active", count: 3 },
          { state: "paused", count: 1 },
        ],
        highlights: [],
      },
      { color: false },
    );

    const lines = output.replace(/\n$/, "").split("\n");
    expect(lines[0]).toBe("Projects by state:");
    expect(lines[1]).toBe("active  3");
    expect(lines[2]).toBe("paused  1");
  });

  test("omits zero-count states from the state block", () => {
    const output = renderStatus(
      {
        stateCounts: [
          { state: "active", count: 2 },
          { state: "paused", count: 0 },
          { state: "archived", count: 1 },
        ],
        highlights: [],
      },
      { color: false },
    );

    expect(output).not.toContain("paused");
    expect(output).toContain("active");
    expect(output).toContain("archived");
  });

  test("renders highlights with a label and bullet list", () => {
    const output = renderStatus(
      {
        stateCounts: [{ state: "active", count: 2 }],
        highlights: [
          {
            label: "Stale projects",
            items: ["alpha", "beta"],
          },
        ],
      },
      { color: false },
    );

    const lines = output.replace(/\n$/, "").split("\n");
    expect(lines).toContain("Stale projects:");
    expect(lines).toContain("  - alpha");
    expect(lines).toContain("  - beta");
  });

  test("separates the state block from each highlight with a blank line", () => {
    const output = renderStatus(
      {
        stateCounts: [{ state: "active", count: 2 }],
        highlights: [
          { label: "Stale projects", items: ["alpha"] },
          { label: "Pause expiring", items: ["beta"] },
        ],
      },
      { color: false },
    );

    const lines = output.replace(/\n$/, "").split("\n");
    const stateLineIndex = lines.indexOf("active  2");
    const staleHeadingIndex = lines.indexOf("Stale projects:");
    const pauseHeadingIndex = lines.indexOf("Pause expiring:");

    expect(stateLineIndex).toBeGreaterThanOrEqual(0);
    expect(staleHeadingIndex).toBeGreaterThan(stateLineIndex);
    expect(pauseHeadingIndex).toBeGreaterThan(staleHeadingIndex);
    expect(lines[staleHeadingIndex - 1]).toBe("");
    expect(lines[pauseHeadingIndex - 1]).toBe("");
  });

  test("skips highlights that have no items", () => {
    const output = renderStatus(
      {
        stateCounts: [{ state: "active", count: 1 }],
        highlights: [
          { label: "Stale projects", items: [] },
          { label: "Pause expiring", items: ["beta"] },
        ],
      },
      { color: false },
    );

    expect(output).not.toContain("Stale projects");
    expect(output).toContain("Pause expiring");
  });

  test("color:false produces no ANSI escapes", () => {
    const output = renderStatus(
      {
        stateCounts: [{ state: "active", count: 2 }],
        highlights: [{ label: "Stale projects", items: ["alpha"] }],
      },
      { color: false },
    );

    expect(output).toBe(stripAnsi(output));
  });

  test("color:true bolds headings", () => {
    const output = renderStatus(
      {
        stateCounts: [{ state: "active", count: 2 }],
        highlights: [{ label: "Stale projects", items: ["alpha"] }],
      },
      { color: true },
    );

    expect(output).toContain("\x1b[1mProjects by state:");
    expect(output).toContain("\x1b[1mStale projects:");
    expect(stripAnsi(output)).toContain("active  2");
    expect(stripAnsi(output)).toContain("  - alpha");
  });
});
