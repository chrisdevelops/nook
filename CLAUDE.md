# CLAUDE.md

You are working on **nook**, a CLI tool for organizing local development projects by category and lifecycle state.

## Source of truth

Two documents define the project. Read them before making non-trivial changes:

- `.claude/docs/ARCHITECTURE.md` — runtime, deps, layer rules, storage model, testing approach, cross-platform strategy.
- `.claude/docs/COMMANDS.md` — every CLI command, its args, options, state transitions, and behavior.

If a task conflicts with either doc, stop and ask. Do not update the docs silently as part of implementation work.

## Implementation plan

The phased build plan lives outside the repo at `~/.claude/plans/i-want-to-begin-lexical-pnueli.md`. It decomposes the initial build into 20 sequential phases (bootstrap → core → storage → filesystem → UI → platform → shell → CLI plumbing → commands → e2e/release). Read the relevant phase before starting work; phases 0–6 are complete.

## Stack

Bun (runtime, test runner, SQLite, compile-to-binary), TypeScript strict, ES modules, TDD with `bun test`. Full dep list and rationale is in ARCHITECTURE.md — do not add dependencies without approval.

## Layer rules (from ARCHITECTURE.md — non-negotiable)

```
main.ts → cli/ → commands/ → { core/, storage/, ui/, platform/, shell/ }
                 storage/ → filesystem/
```

- **`core/` is pure.** No `fs`, no `Bun.spawn`, no `Date.now()` (use injected `Clock`). Pure functions only.
- **Commands never touch the filesystem directly.** They call `storage/`.
- **`ui/` takes presentation-shaped data.** It does not know domain types.
- **Dependencies flow one direction.** Down the stack, never up.

If you find yourself importing `storage/` from `core/`, stop — the logic belongs in `commands/` instead.

## Command shape

Every command file exports two things: `register*Command(program, ctx)` for commander wiring and `handle*(args, ctx): Promise<Result<void, CommandError>>` as the pure handler. See `src/commands/pause.ts` as the canonical example. Handlers return `Result`; they never call `process.exit` or `console.log`.

## Error handling

Mixed model:

- **Domain (`core/`)** returns `Result<T, E>` for predictable failures (invalid state transitions, schema errors, missing projects).
- **I/O boundaries** may throw; `storage/` catches and wraps in `Result`.
- **Commands** only see `Result`. Pattern-match, never `unwrap`.

## Testing (TDD, strict)

- Write the failing test first. Red, green, refactor.
- Tests colocate with source: `src/core/staleness.ts` next to `src/core/staleness.test.ts`.
- `core/` tests are pure. Command tests build a `CommandContext` with a fake `Clock` and a temp-dir `cwd` — no mocks, real filesystem in temp dirs.
- Run: `bun test` (all), `bun test path/to/file.test.ts` (one file).
- Cross-platform matters. Path handling, shell integration, and file moves must work on macOS, Linux, and Windows. When in doubt, use Bun's `path` module and never concatenate paths with `/`.

## Coding style (from user preferences)

- Strict TypeScript. No `any` without a justifying comment. No enums — use `as const` objects or union types.
- Named exports. No default exports. No barrel files.
- Long descriptive names over clever short ones. Imperative mood for commits.
- Explicit error handling — `Result` types in the domain, catch at I/O boundaries.
- No emojis anywhere — not in code, comments, commit messages, or documentation.
- Flat files over deep nesting. Split files at ~300 lines by responsibility.

## When adding a new command

1. Read `src/commands/pause.ts` as the reference shape.
2. Write the failing test in `src/commands/<name>.test.ts` first.
3. Implement the pure `handle*` function.
4. Wire `register*Command` into `src/cli/register-commands.ts`.
5. Update `docs/COMMANDS.md` if the command surface changes.

## Versioning and changelog

After completing a set of changes, follow this release workflow in order:

### 1. Bump the version in `package.json`

Use semantic versioning strictly:

- **MAJOR** — breaking changes to any public API or CLI command surface (argument changes, renamed commands, removed flags, changed state-transition semantics).
- **MINOR** — new functionality that is backward compatible (new commands, new optional flags, new config keys).
- **PATCH** — bug fixes that do not change the API surface.

Treat 0.x MINOR bumps as MAJOR if they break consumers. The version lives in `package.json` only — never duplicated in source files or constants.

### 2. Update `CHANGELOG.md`

Promote entries from the `## [Unreleased]` section into a new versioned heading with today's ISO date:

```markdown
## [1.3.0] - 2026-04-17

### Added
- `nook rename` command preserves project history across folder renames

### Changed
- `nook ls` now excludes archived projects by default; use `--all` to include them

### Fixed
- Pause expiry calculation off-by-one when `--until` falls on a DST boundary
```

Rules:

- Four possible sections: `Added`, `Changed`, `Fixed`, `Removed`. Omit any that are empty.
- One line per change, written for the consumer of the CLI — not the implementer. "`nook ls` now excludes archived by default" is consumer language. "Refactored ls command to filter earlier" is implementer language.
- Breaking changes get a `BREAKING:` prefix on the line regardless of whether the version bump already signals it.
- No marketing language. No "exciting", "powerful", "seamless".
- Entries are written in the same commit as the change, not retroactively.
- Leave a fresh `## [Unreleased]` section at the top after promoting.

### 3. Commit

One commit for the full release set. Message:

- Imperative mood, matching the changelog content. Example: `Release 1.3.0: add rename command, exclude archived from ls by default`.
- No emojis.
- No `Co-Authored-By` trailer. Do not add Claude, AI, or any agent attribution to the commit message.
- No `Generated by` or similar footers.

### 4. Tag the release

Git tags are the source of truth for what shipped:

```
git tag v1.3.0
git push --tags
```

The tag matches the version in `package.json` exactly, prefixed with `v`.

## What to do when unsure

Ask. Do not guess at architecture decisions, do not introduce new dependencies, do not invent new file formats or storage locations. The specs in `docs/` are deliberate.
