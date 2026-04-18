import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { isErr, isOk } from "../core/result.ts";
import { FilesystemError } from "../errors/filesystem-error.ts";
import { readJsonc } from "./read-jsonc.ts";

describe("readJsonc", () => {
  let workdir: string;

  beforeEach(async () => {
    workdir = await mkdtemp(join(tmpdir(), "nook-readjsonc-"));
  });

  afterEach(async () => {
    await rm(workdir, { recursive: true, force: true });
  });

  test("parses plain JSON", async () => {
    const path = join(workdir, "plain.json");
    await writeFile(path, '{"foo": 1, "bar": "baz"}');
    const result = await readJsonc(path);
    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      expect(result.value).toEqual({ foo: 1, bar: "baz" });
    }
  });

  test("parses JSONC with comments and trailing commas", async () => {
    const path = join(workdir, "with-comments.jsonc");
    await writeFile(
      path,
      `{
  // a leading comment
  "foo": 1,
  /* a block comment */
  "bar": "baz", // trailing comment
}`,
    );
    const result = await readJsonc(path);
    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      expect(result.value).toEqual({ foo: 1, bar: "baz" });
    }
  });

  test("returns FilesystemError when the file is missing", async () => {
    const result = await readJsonc(join(workdir, "nope.json"));
    expect(isErr(result)).toBe(true);
    if (isErr(result)) {
      expect(result.error).toBeInstanceOf(FilesystemError);
      expect(result.error.path).toBe(join(workdir, "nope.json"));
    }
  });

  test("returns FilesystemError when the JSON is malformed", async () => {
    const path = join(workdir, "bad.json");
    await writeFile(path, "{ invalid");
    const result = await readJsonc(path);
    expect(isErr(result)).toBe(true);
    if (isErr(result)) {
      expect(result.error).toBeInstanceOf(FilesystemError);
      expect(result.error.path).toBe(path);
    }
  });
});
