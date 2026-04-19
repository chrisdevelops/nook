import { afterAll, beforeAll, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

import {
  buildBinaryOnce,
  createIsolatedEnv,
  destroyIsolatedEnv,
  runNook,
  seedConfig,
  type IsolatedEnv,
} from "./_harness.ts";

let iso: IsolatedEnv;

beforeAll(async () => {
  await buildBinaryOnce();
  iso = await createIsolatedEnv("lifecycle");
  await seedConfig(iso, { categories: { active: {} } });
});

afterAll(async () => {
  await destroyIsolatedEnv(iso);
});

const readProjectMetadata = async (): Promise<{
  state: string;
  paused_until?: number;
}> => {
  const path = join(iso.projectRoot, "active", "demo", ".nook", "project.jsonc");
  const raw = await readFile(path, "utf8");
  return JSON.parse(raw);
};

const readHistory = async (): Promise<readonly unknown[]> => {
  const path = join(iso.projectRoot, "active", "demo", ".nook", "history.jsonl");
  const raw = await readFile(path, "utf8");
  return raw
    .split("\n")
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line));
};

test("nook new creates the project folder with metadata and history", async () => {
  const result = await runNook(
    ["new", "demo", "--category", "active", "--no-open"],
    { env: iso.env },
  );
  expect(result.code).toBe(0);
  expect(result.stdout + result.stderr).toContain("Created 'demo'");

  const metadata = await readProjectMetadata();
  expect(metadata.state).toBe("active");
  const history = await readHistory();
  expect(history).toHaveLength(1);
  expect((history[0] as { type: string }).type).toBe("created");
});

test("nook ls includes the new project under its category", async () => {
  const result = await runNook(["ls"], { env: iso.env });
  expect(result.code).toBe(0);
  expect(result.stdout).toContain("demo");
  expect(result.stdout).toContain("active");
});

test("nook pause moves the project to paused and records history", async () => {
  const result = await runNook(["pause", "demo", "--days", "7"], {
    env: iso.env,
  });
  expect(result.code).toBe(0);

  const metadata = await readProjectMetadata();
  expect(metadata.state).toBe("paused");
  expect(typeof metadata.paused_until).toBe("number");

  const history = await readHistory();
  const stateChange = history.find(
    (event) => (event as { type: string }).type === "state_changed",
  ) as { from: string; to: string } | undefined;
  expect(stateChange).toBeDefined();
  expect(stateChange?.from).toBe("active");
  expect(stateChange?.to).toBe("paused");
});

test("nook unpause returns the project to active and clears paused_until", async () => {
  const result = await runNook(["unpause", "demo"], { env: iso.env });
  expect(result.code).toBe(0);

  const metadata = await readProjectMetadata();
  expect(metadata.state).toBe("active");
  expect(metadata.paused_until).toBeUndefined();
});
