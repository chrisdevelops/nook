#!/usr/bin/env bun
import packageJson from "../package.json" with { type: "json" };
import { main } from "../src/main.ts";

const exitCode = await main(Bun.argv.slice(2), {
  packageVersion: packageJson.version,
});
process.exit(exitCode);
