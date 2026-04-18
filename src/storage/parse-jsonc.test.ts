import { describe, expect, test } from "bun:test";

import { parseJsonc } from "./parse-jsonc.ts";

describe("parseJsonc", () => {
  test("parses plain JSON", () => {
    expect(parseJsonc('{"a":1,"b":"two"}')).toEqual({ a: 1, b: "two" });
  });

  test("strips line comments", () => {
    const text = `{
  // leading comment
  "a": 1 // trailing comment
}`;
    expect(parseJsonc(text)).toEqual({ a: 1 });
  });

  test("strips block comments", () => {
    const text = '{/* block */ "a": /* mid */ 1 /* tail */}';
    expect(parseJsonc(text)).toEqual({ a: 1 });
  });

  test("strips trailing commas in objects and arrays", () => {
    const text = `{
  "a": [1, 2, 3,],
  "b": { "x": true, },
}`;
    expect(parseJsonc(text)).toEqual({ a: [1, 2, 3], b: { x: true } });
  });

  test("preserves strings that look like comments", () => {
    expect(parseJsonc('{"a": "// not a comment"}')).toEqual({
      a: "// not a comment",
    });
    expect(parseJsonc('{"a": "/* still a string */"}')).toEqual({
      a: "/* still a string */",
    });
  });

  test("preserves strings containing comma before brace literal", () => {
    expect(parseJsonc('{"a": "trailing, ]"}')).toEqual({ a: "trailing, ]" });
    expect(parseJsonc('{"a": "trailing, }"}')).toEqual({ a: "trailing, }" });
  });

  test("handles escaped quotes inside strings", () => {
    expect(parseJsonc('{"a": "he said \\"hi\\""}')).toEqual({
      a: 'he said "hi"',
    });
  });

  test("throws on structurally invalid input", () => {
    expect(() => parseJsonc("{invalid")).toThrow();
  });
});
