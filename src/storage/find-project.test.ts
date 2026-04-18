import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { ProjectMetadata } from "../core/project-types.ts";
import { findProject } from "./find-project.ts";

const metadataFor = (overrides: Partial<ProjectMetadata>): ProjectMetadata => ({
  id: "01HZZZZZZZZZZZZZZZZZZZZZZZ",
  name: "placeholder",
  category: "lab",
  state: "active",
  created_at: 1_700_000_000_000,
  tags: [],
  scratch: false,
  ...overrides,
});

const writeProject = async (
  rootDir: string,
  relativePath: string,
  metadata: ProjectMetadata,
): Promise<string> => {
  const projectDir = join(rootDir, relativePath);
  await mkdir(join(projectDir, ".nook"), { recursive: true });
  await writeFile(
    join(projectDir, ".nook", "project.jsonc"),
    JSON.stringify(metadata, null, 2),
    "utf8",
  );
  return projectDir;
};

describe("findProject", () => {
  let rootDir: string;

  beforeEach(async () => {
    rootDir = await mkdtemp(join(tmpdir(), "nook-find-"));
  });

  afterEach(async () => {
    await rm(rootDir, { recursive: true, force: true });
  });

  test("returns a single project when folder name matches exactly", async () => {
    const projectPath = await writeProject(
      rootDir,
      "lab/alpha",
      metadataFor({
        id: "01HAAAAAAAAAAAAAAAAAAAAAAA",
        name: "alpha",
        category: "lab",
        state: "incubating",
      }),
    );

    const result = await findProject(rootDir, "alpha");

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.kind).toBe("one");
      if (result.value.kind === "one") {
        expect(result.value.project.path).toBe(projectPath);
        expect(result.value.project.metadata.id).toBe(
          "01HAAAAAAAAAAAAAAAAAAAAAAA",
        );
      }
    }
  });

  test("returns a single project when ULID prefix matches (case-insensitive)", async () => {
    const projectPath = await writeProject(
      rootDir,
      "active/beta",
      metadataFor({
        id: "01HBBBBBBBBBBBBBBBBBBBBBBB",
        name: "beta",
        category: "active",
      }),
    );
    await writeProject(
      rootDir,
      "active/gamma",
      metadataFor({
        id: "01HCCCCCCCCCCCCCCCCCCCCCCC",
        name: "gamma",
        category: "active",
      }),
    );

    const lower = await findProject(rootDir, "01hbbb");

    expect(lower.ok).toBe(true);
    if (lower.ok && lower.value.kind === "one") {
      expect(lower.value.project.path).toBe(projectPath);
    } else {
      expect(lower.ok && lower.value.kind).toBe("one");
    }
  });

  test("returns none when no project matches", async () => {
    await writeProject(
      rootDir,
      "lab/alpha",
      metadataFor({ id: "01HAAAAAAAAAAAAAAAAAAAAAAA", name: "alpha" }),
    );

    const result = await findProject(rootDir, "does-not-exist");

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.kind).toBe("none");
    }
  });

  test("returns many when multiple projects match a short prefix", async () => {
    await writeProject(
      rootDir,
      "active/beta",
      metadataFor({
        id: "01HBBBBBBBBBBBBBBBBBBBBBBB",
        name: "beta",
        category: "active",
      }),
    );
    await writeProject(
      rootDir,
      "active/bravo",
      metadataFor({
        id: "01HBBBAAAAAAAAAAAAAAAAAAAA",
        name: "bravo",
        category: "active",
      }),
    );

    const result = await findProject(rootDir, "01HBB");

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.kind).toBe("many");
      if (result.value.kind === "many") {
        const names = result.value.candidates.map((c) => c.metadata.name).sort();
        expect(names).toEqual(["beta", "bravo"]);
      }
    }
  });

  test("combines folder-name and ULID-prefix matches when distinct", async () => {
    // A project whose name is 'alpha' and another whose ULID starts with 'alpha'
    // is contrived (ULIDs are base32), but we do want name + id to be a union,
    // not one or the other.
    await writeProject(
      rootDir,
      "lab/alpha",
      metadataFor({
        id: "01HAAAAAAAAAAAAAAAAAAAAAAA",
        name: "alpha",
        category: "lab",
      }),
    );
    await writeProject(
      rootDir,
      "active/other",
      metadataFor({
        id: "01HXXXXXXXXXXXXXXXXXXXXXXX",
        name: "other",
        category: "active",
      }),
    );

    const result = await findProject(rootDir, "alpha");
    expect(result.ok).toBe(true);
    if (result.ok && result.value.kind === "one") {
      expect(result.value.project.metadata.name).toBe("alpha");
    } else {
      expect(result.ok && result.value.kind).toBe("one");
    }
  });

  test("ignores folders without .nook/project.jsonc", async () => {
    await mkdir(join(rootDir, "active", "not-a-project"), { recursive: true });
    await writeProject(
      rootDir,
      "active/real",
      metadataFor({
        id: "01HREALAAAAAAAAAAAAAAAAAAA",
        name: "real",
        category: "active",
      }),
    );

    const result = await findProject(rootDir, "not-a-project");

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.kind).toBe("none");
    }
  });

  test("returns a filesystem error when the root directory does not exist", async () => {
    const missing = join(rootDir, "does", "not", "exist");

    const result = await findProject(missing, "anything");

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("filesystem");
    }
  });
});
