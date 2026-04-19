import { mkdir } from "node:fs/promises";
import { join } from "node:path";

type BuildTarget = {
  readonly bunTarget: string;
  readonly outfile: string;
};

const TARGETS: readonly BuildTarget[] = [
  { bunTarget: "bun-darwin-arm64", outfile: "nook-darwin-arm64" },
  { bunTarget: "bun-darwin-x64", outfile: "nook-darwin-x64" },
  { bunTarget: "bun-linux-x64", outfile: "nook-linux-x64" },
  { bunTarget: "bun-linux-arm64", outfile: "nook-linux-arm64" },
  { bunTarget: "bun-windows-x64", outfile: "nook-windows-x64.exe" },
];

const PROJECT_ROOT = new URL("..", import.meta.url).pathname;
const DIST_DIR = join(PROJECT_ROOT, "dist");
const ENTRY = join(PROJECT_ROOT, "bin", "nook.ts");

const runBuild = async (target: BuildTarget): Promise<number> => {
  const outfile = join(DIST_DIR, target.outfile);
  const args = [
    "build",
    "--compile",
    "--minify",
    "--sourcemap",
    `--target=${target.bunTarget}`,
    ENTRY,
    "--outfile",
    outfile,
  ];
  process.stdout.write(`Building ${target.outfile}...\n`);
  const proc = Bun.spawn(["bun", ...args], {
    cwd: PROJECT_ROOT,
    stdout: "inherit",
    stderr: "inherit",
  });
  return proc.exited;
};

const main = async (): Promise<void> => {
  await mkdir(DIST_DIR, { recursive: true });
  const failed: string[] = [];
  for (const target of TARGETS) {
    const code = await runBuild(target);
    if (code !== 0) {
      failed.push(target.outfile);
    }
  }
  if (failed.length > 0) {
    process.stderr.write(`\nBuild failed for: ${failed.join(", ")}\n`);
    process.exit(1);
  }
  process.stdout.write(`\nBuilt ${TARGETS.length} binaries in ${DIST_DIR}\n`);
};

await main();
