import { describe, expect, test } from "bun:test";

import { stripAnsi } from "./ansi-colors.ts";
import {
  renderProjectList,
  type ProjectListSection,
} from "./render-project-list.ts";

const sampleSection = (
  heading: string | undefined,
  rows: ProjectListSection["rows"],
): ProjectListSection => ({ heading, rows });

describe("renderProjectList", () => {
  test("empty sections yields a 'No projects.' message", () => {
    expect(renderProjectList([], { color: false })).toBe("No projects.\n");
  });

  test("sections with only empty rows also yield 'No projects.'", () => {
    const output = renderProjectList(
      [sampleSection("client/", []), sampleSection("oss/", [])],
      { color: false },
    );
    expect(output).toBe("No projects.\n");
  });

  test("renders a flat list with header row when heading is omitted", () => {
    const output = renderProjectList(
      [
        sampleSection(undefined, [
          {
            name: "alpha",
            state: "active",
            category: "client",
            lastTouched: "2d ago",
            tags: ["urgent"],
            stale: false,
          },
          {
            name: "beta",
            state: "paused",
            category: "oss",
            lastTouched: "3w ago",
            tags: [],
            stale: false,
          },
        ]),
      ],
      { color: false },
    );

    const lines = output.replace(/\n$/, "").split("\n");
    expect(lines[0]).toBe("NAME   STATE   CATEGORY  LAST    TAGS  ");
    expect(lines[1]).toBe("alpha  active  client    2d ago  urgent");
    expect(lines[2]).toBe("beta   paused  oss       3w ago        ");
  });

  test("renders multiple sections with headings and blank-line separators", () => {
    const output = renderProjectList(
      [
        sampleSection("client/", [
          {
            name: "a",
            state: "active",
            category: "client",
            lastTouched: "1d ago",
            tags: [],
            stale: false,
          },
        ]),
        sampleSection("oss/", [
          {
            name: "b",
            state: "active",
            category: "oss",
            lastTouched: "5d ago",
            tags: [],
            stale: false,
          },
        ]),
      ],
      { color: false },
    );

    const lines = output.replace(/\n$/, "").split("\n");
    expect(lines[0]).toBe("client/");
    expect(lines[1]).toBe("NAME  STATE   CATEGORY  LAST    TAGS");
    expect(lines[2]).toBe("a     active  client    1d ago      ");
    expect(lines[3]).toBe("");
    expect(lines[4]).toBe("oss/");
    expect(lines[5]).toBe("NAME  STATE   CATEGORY  LAST    TAGS");
    expect(lines[6]).toBe("b     active  oss       5d ago      ");
  });

  test("skips sections whose rows are empty", () => {
    const output = renderProjectList(
      [
        sampleSection("client/", [
          {
            name: "a",
            state: "active",
            category: "client",
            lastTouched: "1d ago",
            tags: [],
            stale: false,
          },
        ]),
        sampleSection("oss/", []),
      ],
      { color: false },
    );

    const lines = output.replace(/\n$/, "").split("\n");
    expect(lines.includes("oss/")).toBe(false);
    expect(lines[0]).toBe("client/");
  });

  test("joins multiple tags with commas", () => {
    const output = renderProjectList(
      [
        sampleSection(undefined, [
          {
            name: "a",
            state: "active",
            category: "client",
            lastTouched: "1d ago",
            tags: ["urgent", "billable"],
            stale: false,
          },
        ]),
      ],
      { color: false },
    );

    expect(output).toContain("urgent, billable");
  });

  test("color:false produces no ANSI escape sequences", () => {
    const output = renderProjectList(
      [
        sampleSection(undefined, [
          {
            name: "alpha",
            state: "active",
            category: "client",
            lastTouched: "2d ago",
            tags: [],
            stale: true,
          },
        ]),
      ],
      { color: false },
    );

    expect(output).toBe(stripAnsi(output));
  });

  test("color:true colors stale rows' state column and headings are bold", () => {
    const output = renderProjectList(
      [
        sampleSection("client/", [
          {
            name: "alpha",
            state: "active",
            category: "client",
            lastTouched: "90d ago",
            tags: [],
            stale: true,
          },
        ]),
      ],
      { color: true },
    );

    expect(output).toContain("\x1b[1m");
    expect(output).toContain("client/");
    expect(output).toContain("\x1b[33m");
    expect(stripAnsi(output)).toContain("alpha");
    expect(stripAnsi(output)).toContain("active");
  });

  test("color:true does not color non-stale rows", () => {
    const output = renderProjectList(
      [
        sampleSection(undefined, [
          {
            name: "alpha",
            state: "active",
            category: "client",
            lastTouched: "1d ago",
            tags: [],
            stale: false,
          },
        ]),
      ],
      { color: true },
    );

    expect(output).not.toContain("\x1b[33m");
  });
});
