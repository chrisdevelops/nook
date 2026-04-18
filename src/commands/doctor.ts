import { access, readdir } from "node:fs/promises";
import { relative, sep } from "node:path";
import type { Command } from "commander";

import type { CommandContext, CommandHandler } from "../cli/command-types.ts";
import type { ProjectState } from "../core/project-types.ts";
import { resolveCategoryConfig } from "../core/resolve-category-config.ts";
import { err, isErr, ok } from "../core/result.ts";
import { CommandError } from "../errors/command-error.ts";
import { closeIndex, queryProjects } from "../storage/project-index.ts";
import {
  loadAllProjects,
  type LoadedProject,
} from "./load-all-projects.ts";

export type DoctorArgs = {
  readonly fix?: boolean;
};

type Finding = {
  readonly severity: "warn" | "error";
  readonly code: string;
  readonly message: string;
  readonly fixable: boolean;
};

const RESERVED_SUBFOLDERS: ReadonlySet<string> = new Set([
  "shipped",
  "archived",
]);

const expectedStateForLocation = (
  relSegments: readonly string[],
): ProjectState | null => {
  if (relSegments.length === 2 && relSegments[0] === "lab") {
    return "incubating";
  }
  if (relSegments.length === 3) {
    if (relSegments[1] === "shipped") return "shipped";
    if (relSegments[1] === "archived") return "archived";
  }
  return null;
};

const checkCategoryAndState = (
  rootDir: string,
  project: LoadedProject,
): Finding[] => {
  const findings: Finding[] = [];
  const rel = relative(rootDir, project.path);
  const segments = rel.split(sep);
  const folderCategory = segments[0];
  if (folderCategory !== undefined && folderCategory !== project.metadata.category) {
    findings.push({
      severity: "error",
      code: "category_mismatch",
      message: `${project.path}: metadata.category='${project.metadata.category}' but folder is under '${folderCategory}/'`,
      fixable: false,
    });
  }

  const expectedState = expectedStateForLocation(segments);
  if (expectedState !== null && project.metadata.state !== expectedState) {
    findings.push({
      severity: "error",
      code: "state_folder_mismatch",
      message: `${project.path}: folder implies state='${expectedState}' but metadata says '${project.metadata.state}'`,
      fixable: false,
    });
  } else if (
    expectedState === null &&
    (project.metadata.state === "shipped" ||
      project.metadata.state === "archived")
  ) {
    findings.push({
      severity: "error",
      code: "state_folder_mismatch",
      message: `${project.path}: metadata.state='${project.metadata.state}' but folder is not under shipped/ or archived/`,
      fixable: false,
    });
  }

  return findings;
};

const checkExpiredScratch = (
  rootDir: string,
  project: LoadedProject,
  config: Parameters<typeof resolveCategoryConfig>[0],
  nowMs: number,
): Finding[] => {
  if (!project.metadata.scratch) return [];
  const cat = resolveCategoryConfig(config, project.metadata.category);
  const ageDays = Math.floor(
    (nowMs - project.lastTouchedMs) / 86_400_000,
  );
  if (ageDays < cat.scratch_prune_days) return [];
  return [
    {
      severity: "warn",
      code: "scratch_expired",
      message: `${project.path}: scratch project idle ${ageDays}d (prune window ${cat.scratch_prune_days}d) — run 'nook delete' to prune`,
      fixable: false,
    },
  ];
};

const pathExists = async (path: string): Promise<boolean> => {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
};

const listSubdirs = async (dir: string): Promise<string[]> => {
  try {
    const entries = await readdir(dir, { withFileTypes: true });
    return entries
      .filter((e) => e.isDirectory() && !e.name.startsWith("."))
      .map((e) => e.name);
  } catch {
    return [];
  }
};

const findOrphanFolders = async (
  rootDir: string,
  knownProjectPaths: ReadonlySet<string>,
): Promise<Finding[]> => {
  const findings: Finding[] = [];
  const topDirs = await listSubdirs(rootDir);
  for (const top of topDirs) {
    const topPath = `${rootDir}${sep}${top}`;
    const children = await listSubdirs(topPath);
    for (const child of children) {
      const childPath = `${topPath}${sep}${child}`;
      if (knownProjectPaths.has(childPath)) continue;
      if (top !== "lab" && RESERVED_SUBFOLDERS.has(child)) {
        const grandchildren = await listSubdirs(childPath);
        for (const gc of grandchildren) {
          const gcPath = `${childPath}${sep}${gc}`;
          if (knownProjectPaths.has(gcPath)) continue;
          findings.push({
            severity: "warn",
            code: "orphan_folder",
            message: `${gcPath}: folder has no .nook/project.jsonc — not managed by nook`,
            fixable: false,
          });
        }
        continue;
      }
      findings.push({
        severity: "warn",
        code: "orphan_folder",
        message: `${childPath}: folder has no .nook/project.jsonc — not managed by nook`,
        fixable: false,
      });
    }
  }
  return findings;
};

const findOrphanIndexRows = async (
  ctx: CommandContext,
): Promise<{ readonly findings: Finding[]; readonly orphanIds: readonly string[] }> => {
  const openResult = ctx.storage.openIndex(ctx.appPaths.indexPath);
  if (isErr(openResult)) {
    return { findings: [], orphanIds: [] };
  }
  const db = openResult.value;
  try {
    const rows = queryProjects(db);
    if (isErr(rows)) return { findings: [], orphanIds: [] };
    const findings: Finding[] = [];
    const orphanIds: string[] = [];
    for (const row of rows.value) {
      if (!(await pathExists(row.path))) {
        findings.push({
          severity: "warn",
          code: "orphan_index_row",
          message: `index row '${row.id}' points at missing path ${row.path}`,
          fixable: true,
        });
        orphanIds.push(row.id);
      }
    }
    return { findings, orphanIds };
  } finally {
    closeIndex(db);
  }
};

const applyIndexFixes = (
  ctx: CommandContext,
  orphanIds: readonly string[],
): number => {
  if (orphanIds.length === 0) return 0;
  const openResult = ctx.storage.openIndex(ctx.appPaths.indexPath);
  if (isErr(openResult)) return 0;
  const db = openResult.value;
  let removed = 0;
  try {
    const stmt = db.query("DELETE FROM projects WHERE id = ?");
    for (const id of orphanIds) {
      const info = stmt.run(id);
      removed += Number((info as { changes: number }).changes);
    }
  } finally {
    closeIndex(db);
  }
  return removed;
};

export const handleDoctor: CommandHandler<DoctorArgs> = async (args, ctx) => {
  const loaded = await loadAllProjects(ctx);
  if (isErr(loaded)) {
    return err(loaded.error);
  }
  const { config, rootDir, projects } = loaded.value;
  const now = ctx.clock.now();

  const findings: Finding[] = [];
  const knownPaths = new Set<string>(projects.map((p) => p.path));

  for (const project of projects) {
    findings.push(...checkCategoryAndState(rootDir, project));
    findings.push(...checkExpiredScratch(rootDir, project, config, now));
  }

  findings.push(...(await findOrphanFolders(rootDir, knownPaths)));

  const { findings: indexFindings, orphanIds } =
    await findOrphanIndexRows(ctx);
  findings.push(...indexFindings);

  if (findings.length === 0) {
    ctx.ui.logger.info("All checks passed.");
    return ok(undefined);
  }

  for (const finding of findings) {
    const prefix = finding.severity === "error" ? "ERROR" : "WARN";
    ctx.ui.logger.info(
      `[${prefix}] ${finding.code}: ${finding.message}${finding.fixable ? " (fixable)" : ""}`,
    );
  }

  if (args.fix === true) {
    const removed = applyIndexFixes(ctx, orphanIds);
    ctx.ui.logger.info(
      `Applied fixes: removed ${removed} orphaned index row${removed === 1 ? "" : "s"}.`,
    );
  } else {
    const fixable = findings.filter((f) => f.fixable).length;
    if (fixable > 0) {
      ctx.ui.logger.info(
        `${fixable} issue${fixable === 1 ? "" : "s"} can be auto-fixed with --fix.`,
      );
    }
  }

  const hasErrors = findings.some((f) => f.severity === "error");
  if (hasErrors) {
    return err(
      new CommandError(
        "validation",
        `${findings.length} issue${findings.length === 1 ? "" : "s"} found.`,
      ),
    );
  }
  return ok(undefined);
};

export const registerDoctorCommand = (
  program: Command,
  ctx: CommandContext,
): void => {
  program
    .command("doctor")
    .description("Diagnose project metadata, folder, and index inconsistencies")
    .option("--fix", "Apply automatic fixes for safe issues")
    .action(async (options: { fix?: boolean }) => {
      ctx.runResult(
        await handleDoctor(
          {
            ...(options.fix === true ? { fix: true } : {}),
          },
          ctx,
        ),
      );
    });
};
