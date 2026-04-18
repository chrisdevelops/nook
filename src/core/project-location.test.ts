import { describe, expect, test } from "bun:test";
import { join } from "node:path";

import { projectLocationFor } from "./project-location.ts";

describe("projectLocationFor", () => {
  const root = "/root";

  test("returns <root>/<category>/<name> for active state", () => {
    expect(projectLocationFor(root, "work", "active", "alpha")).toBe(
      join(root, "work", "alpha"),
    );
  });

  test("returns <root>/<category>/<name> for paused state", () => {
    expect(projectLocationFor(root, "work", "paused", "alpha")).toBe(
      join(root, "work", "alpha"),
    );
  });

  test("returns <root>/<category>/<name> for maintained state", () => {
    expect(projectLocationFor(root, "work", "maintained", "alpha")).toBe(
      join(root, "work", "alpha"),
    );
  });

  test("returns <root>/lab/<name> for incubating state when category is lab", () => {
    expect(projectLocationFor(root, "lab", "incubating", "alpha")).toBe(
      join(root, "lab", "alpha"),
    );
  });

  test("returns <root>/<category>/shipped/<name> for shipped state", () => {
    expect(projectLocationFor(root, "work", "shipped", "alpha")).toBe(
      join(root, "work", "shipped", "alpha"),
    );
  });

  test("returns <root>/<category>/archived/<name> for archived state", () => {
    expect(projectLocationFor(root, "work", "archived", "alpha")).toBe(
      join(root, "work", "archived", "alpha"),
    );
  });
});
