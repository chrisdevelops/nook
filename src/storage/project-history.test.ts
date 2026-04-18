import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type {
  HistoryEvent,
  HistoryEventCreated,
  HistoryEventStateChanged,
  HistoryEventTouched,
} from "../core/project-types.ts";
import { isErr, isOk } from "../core/result.ts";
import { FilesystemError } from "../errors/filesystem-error.ts";
import { ValidationError } from "../errors/validation-error.ts";
import {
  appendHistoryEvent,
  projectHistoryRelativePath,
  readHistoryEvents,
} from "./project-history.ts";

const createdEvent: HistoryEventCreated = {
  type: "created",
  at: 1_700_000_000_000,
  source: "new",
};

const stateChangedEvent: HistoryEventStateChanged = {
  type: "state_changed",
  at: 1_700_000_100_000,
  from: "incubating",
  to: "active",
};

const touchedEvent: HistoryEventTouched = {
  type: "touched",
  at: 1_700_000_200_000,
  reason: "edited file",
};

describe("projectHistoryRelativePath", () => {
  test("points at .nook/history.jsonl", () => {
    expect(projectHistoryRelativePath).toBe(".nook/history.jsonl");
  });
});

describe("readHistoryEvents — missing or empty", () => {
  let workdir: string;

  beforeEach(async () => {
    workdir = await mkdtemp(join(tmpdir(), "nook-hist-miss-"));
  });

  afterEach(async () => {
    await rm(workdir, { recursive: true, force: true });
  });

  test("returns ok([]) when the history file does not exist", async () => {
    const result = await readHistoryEvents(workdir);
    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      expect(result.value).toEqual([]);
    }
  });

  test("returns ok([]) when the history file is empty", async () => {
    await mkdir(join(workdir, ".nook"), { recursive: true });
    await writeFile(join(workdir, ".nook", "history.jsonl"), "");
    const result = await readHistoryEvents(workdir);
    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      expect(result.value).toEqual([]);
    }
  });
});

describe("appendHistoryEvent + readHistoryEvents round trip", () => {
  let workdir: string;

  beforeEach(async () => {
    workdir = await mkdtemp(join(tmpdir(), "nook-hist-"));
  });

  afterEach(async () => {
    await rm(workdir, { recursive: true, force: true });
  });

  test("single append then read returns the event", async () => {
    const appendResult = await appendHistoryEvent(workdir, createdEvent);
    expect(isOk(appendResult)).toBe(true);

    const readResult = await readHistoryEvents(workdir);
    expect(isOk(readResult)).toBe(true);
    if (isOk(readResult)) {
      expect(readResult.value).toEqual([createdEvent]);
    }
  });

  test("multiple appends preserve insertion order", async () => {
    await appendHistoryEvent(workdir, createdEvent);
    await appendHistoryEvent(workdir, stateChangedEvent);
    await appendHistoryEvent(workdir, touchedEvent);

    const readResult = await readHistoryEvents(workdir);
    expect(isOk(readResult)).toBe(true);
    if (isOk(readResult)) {
      expect(readResult.value).toEqual([
        createdEvent,
        stateChangedEvent,
        touchedEvent,
      ]);
    }
  });

  test("appendHistoryEvent creates the .nook directory when missing", async () => {
    const result = await appendHistoryEvent(workdir, createdEvent);
    expect(isOk(result)).toBe(true);

    const entries = await readdir(join(workdir, ".nook"));
    expect(entries).toContain("history.jsonl");
  });

  test("each event is written as one newline-terminated JSON line", async () => {
    await appendHistoryEvent(workdir, createdEvent);
    await appendHistoryEvent(workdir, touchedEvent);
    const text = await readFile(
      join(workdir, ".nook", "history.jsonl"),
      "utf8",
    );
    expect(text).toBe(
      `${JSON.stringify(createdEvent)}\n${JSON.stringify(touchedEvent)}\n`,
    );
  });
});

describe("readHistoryEvents errors", () => {
  let workdir: string;

  beforeEach(async () => {
    workdir = await mkdtemp(join(tmpdir(), "nook-hist-err-"));
  });

  afterEach(async () => {
    await rm(workdir, { recursive: true, force: true });
  });

  test("returns ValidationError when a line fails the schema", async () => {
    await mkdir(join(workdir, ".nook"), { recursive: true });
    const goodLine = JSON.stringify(createdEvent);
    const badLine = JSON.stringify({ type: "mystery", at: 0 });
    await writeFile(
      join(workdir, ".nook", "history.jsonl"),
      `${goodLine}\n${badLine}\n`,
    );

    const result = await readHistoryEvents(workdir);
    expect(isErr(result)).toBe(true);
    if (isErr(result)) {
      expect(result.error).toBeInstanceOf(ValidationError);
    }
  });

  test("returns FilesystemError when a line is not valid JSON", async () => {
    await mkdir(join(workdir, ".nook"), { recursive: true });
    await writeFile(
      join(workdir, ".nook", "history.jsonl"),
      "{not json}\n",
    );

    const result = await readHistoryEvents(workdir);
    expect(isErr(result)).toBe(true);
    if (isErr(result)) {
      expect(result.error).toBeInstanceOf(FilesystemError);
    }
  });
});

describe("appendHistoryEvent errors", () => {
  let workdir: string;

  beforeEach(async () => {
    workdir = await mkdtemp(join(tmpdir(), "nook-hist-write-err-"));
  });

  afterEach(async () => {
    await rm(workdir, { recursive: true, force: true });
  });

  test("rejects an invalid event with ValidationError and does not create the file", async () => {
    const invalid = { type: "created", at: 0 } as unknown as HistoryEvent;
    const result = await appendHistoryEvent(workdir, invalid);

    expect(isErr(result)).toBe(true);
    if (isErr(result)) {
      expect(result.error).toBeInstanceOf(ValidationError);
    }

    const entries = await readdir(workdir);
    expect(entries).not.toContain(".nook");
  });

  test("does not truncate an existing file", async () => {
    await appendHistoryEvent(workdir, createdEvent);
    const before = await stat(join(workdir, ".nook", "history.jsonl"));
    await appendHistoryEvent(workdir, touchedEvent);
    const after = await stat(join(workdir, ".nook", "history.jsonl"));

    expect(after.size).toBeGreaterThan(before.size);
  });
});
