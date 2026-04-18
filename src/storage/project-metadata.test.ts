import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { ProjectMetadata } from "../core/project-types.ts";
import { isErr, isOk } from "../core/result.ts";
import { FilesystemError } from "../errors/filesystem-error.ts";
import { ValidationError } from "../errors/validation-error.ts";
import {
  projectMetadataRelativePath,
  readProjectMetadata,
  writeProjectMetadata,
} from "./project-metadata.ts";

const validMetadata: ProjectMetadata = {
  id: "01HAZQG6B2F8VXTRMJ8WQPK3NR",
  name: "atlas",
  category: "active",
  state: "active",
  created_at: 1_700_000_000_000,
  tags: ["cli", "tool"],
  description: "an example project",
  scratch: false,
};

describe("projectMetadataRelativePath", () => {
  test("points at .nook/project.jsonc", () => {
    expect(projectMetadataRelativePath).toBe(".nook/project.jsonc");
  });
});

describe("project-metadata round trip", () => {
  let workdir: string;

  beforeEach(async () => {
    workdir = await mkdtemp(join(tmpdir(), "nook-projmeta-"));
  });

  afterEach(async () => {
    await rm(workdir, { recursive: true, force: true });
  });

  test("writeProjectMetadata then readProjectMetadata returns the same metadata", async () => {
    const writeResult = await writeProjectMetadata(workdir, validMetadata);
    expect(isOk(writeResult)).toBe(true);

    const readResult = await readProjectMetadata(workdir);
    expect(isOk(readResult)).toBe(true);
    if (isOk(readResult)) {
      expect(readResult.value).toEqual(validMetadata);
    }
  });

  test("writeProjectMetadata creates the .nook directory when missing", async () => {
    const result = await writeProjectMetadata(workdir, validMetadata);
    expect(isOk(result)).toBe(true);

    const entries = await readdir(join(workdir, ".nook"));
    expect(entries).toContain("project.jsonc");
  });

  test("writeProjectMetadata overwrites an existing metadata file", async () => {
    await writeProjectMetadata(workdir, validMetadata);
    const updated: ProjectMetadata = { ...validMetadata, state: "paused" };
    await writeProjectMetadata(workdir, updated);

    const readResult = await readProjectMetadata(workdir);
    expect(isOk(readResult)).toBe(true);
    if (isOk(readResult)) {
      expect(readResult.value.state).toBe("paused");
    }
  });
});

describe("readProjectMetadata errors", () => {
  let workdir: string;

  beforeEach(async () => {
    workdir = await mkdtemp(join(tmpdir(), "nook-projmeta-err-"));
  });

  afterEach(async () => {
    await rm(workdir, { recursive: true, force: true });
  });

  test("returns FilesystemError when project.jsonc is missing", async () => {
    const result = await readProjectMetadata(workdir);
    expect(isErr(result)).toBe(true);
    if (isErr(result)) {
      expect(result.error).toBeInstanceOf(FilesystemError);
      expect((result.error as FilesystemError).path).toBe(
        join(workdir, ".nook", "project.jsonc"),
      );
    }
  });

  test("returns ValidationError when metadata has the wrong shape", async () => {
    await mkdir(join(workdir, ".nook"), { recursive: true });
    await writeFile(
      join(workdir, ".nook", "project.jsonc"),
      JSON.stringify({ name: "missing-id" }),
    );

    const result = await readProjectMetadata(workdir);
    expect(isErr(result)).toBe(true);
    if (isErr(result)) {
      expect(result.error).toBeInstanceOf(ValidationError);
    }
  });

  test("returns FilesystemError when the file is not parseable JSONC", async () => {
    await mkdir(join(workdir, ".nook"), { recursive: true });
    await writeFile(
      join(workdir, ".nook", "project.jsonc"),
      "{ this is not json ",
    );

    const result = await readProjectMetadata(workdir);
    expect(isErr(result)).toBe(true);
    if (isErr(result)) {
      expect(result.error).toBeInstanceOf(FilesystemError);
    }
  });
});

describe("writeProjectMetadata errors", () => {
  let workdir: string;

  beforeEach(async () => {
    workdir = await mkdtemp(join(tmpdir(), "nook-projmeta-write-err-"));
  });

  afterEach(async () => {
    await rm(workdir, { recursive: true, force: true });
  });

  test("rejects invalid metadata with ValidationError and does not create the file", async () => {
    const invalid = { ...validMetadata, id: "too-short" } as ProjectMetadata;
    const result = await writeProjectMetadata(workdir, invalid);

    expect(isErr(result)).toBe(true);
    if (isErr(result)) {
      expect(result.error).toBeInstanceOf(ValidationError);
    }

    const entries = await readdir(workdir);
    expect(entries).not.toContain(".nook");
  });
});
