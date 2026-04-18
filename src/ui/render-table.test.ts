import { describe, expect, test } from "bun:test";

import { ANSI_GREEN, ANSI_RESET } from "./ansi-colors.ts";
import { renderTable } from "./render-table.ts";

describe("renderTable", () => {
  test("empty input yields an empty string", () => {
    expect(renderTable([])).toBe("");
  });

  test("single row emits one trailing newline", () => {
    expect(renderTable([["one", "two"]])).toBe("one  two\n");
  });

  test("columns are padded to the widest cell (left-aligned by default)", () => {
    const output = renderTable([
      ["name", "state"],
      ["a", "paused"],
      ["beta", "active"],
    ]);
    expect(output).toBe(["name  state ", "a     paused", "beta  active"].join("\n") + "\n");
  });

  test("respects a custom separator", () => {
    const output = renderTable(
      [
        ["a", "b"],
        ["cc", "dd"],
      ],
      { separator: " | " },
    );
    expect(output).toBe(["a  | b ", "cc | dd"].join("\n") + "\n");
  });

  test("right-aligned columns pad on the left", () => {
    const output = renderTable(
      [
        ["name", "count"],
        ["a", "3"],
        ["bb", "42"],
      ],
      { aligns: ["left", "right"] },
    );
    expect(output).toBe(["name  count", "a         3", "bb       42"].join("\n") + "\n");
  });

  test("uses visual width for wide CJK characters", () => {
    const output = renderTable([
      ["名前", "xx"],
      ["a", "yy"],
    ]);
    expect(output).toBe(["名前  xx", "a     yy"].join("\n") + "\n");
  });

  test("ignores ANSI escape codes when measuring width", () => {
    const colored = `${ANSI_GREEN}ok${ANSI_RESET}`;
    const output = renderTable([
      [colored, "done"],
      ["pending", "wait"],
    ]);
    expect(output).toBe(
      [`${colored}       done`, "pending  wait"].join("\n") + "\n",
    );
  });

  test("pads short rows when column counts differ", () => {
    const output = renderTable([
      ["a", "b", "c"],
      ["dd"],
    ]);
    expect(output).toBe(["a   b  c", "dd      "].join("\n") + "\n");
  });
});
