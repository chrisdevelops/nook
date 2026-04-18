## Runtime and tooling

| Concern      | Choice                                                                             | Rationale                                                                                                           |
| ------------ | ---------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| Runtime      | Bun                                                                                | Built-in JSONC reader, SQLite, test runner, TypeScript, compile-to-binary — collapses several deps into the runtime |
| Language     | TypeScript, strict mode, ES modules                                                | Matches user preferences                                                                                            |
| Tests        | `bun test`, TDD                                                                    | Zero-dep, colocated `*.test.ts`                                                                                     |
| Distribution | `bun build --compile` per OS target; npm package for `npm i -g`                    | Binary feeds package managers (Homebrew, Scoop, apt); npm serves devs                                               |
| Versioning   | Semver in `package.json` only, git tags as source of truth, `CHANGELOG.md` by hand | Matches user preferences                                                                                            |

CI build matrix produces five binaries (`darwin-arm64`, `darwin-x64`, `linux-x64`, `linux-arm64`, `windows-x64`) that feed the package managers.

---

## Dependencies

Six total. Each earns its place.

|Package|Purpose|Why we take the dep|
|---|---|---|
|`cac`|Argv parser, command registration, help generation|Argv edge cases (combined short flags, `=` vs space, `--` passthrough, subcommand routing) are a long tail of bug reports. Small, focused.|
|`@sinclair/typebox`|Schema types with runtime validation|Standard in your stack. Used for all persisted shapes.|
|`@inquirer/prompts`|Interactive select, confirm, input|Raw-mode stdin, cursor math, and Windows terminal quirks are weeks of work. One well-maintained dep.|
|`ignore`|`.gitignore` / `.nookignore` matching|gitignore semantics (negation, directory markers, globstars) are genuinely nontrivial.|
|`env-paths`|Cross-platform config/cache/data dirs|XDG vs `%APPDATA%` vs `Library/Application Support` resolution.|
|`write-file-atomic`|Crash-safe writes of metadata and config|Temp-then-rename with Windows rename quirks and cleanup on failure. Data safety for user metadata.|

### What we still build

- ANSI colors (file of constants)
- Table rendering (pad + `Bun.stringWidth()`)
- ULID (~40 lines)
- Spinner (`\r` + frames)
- JSONL append/read (trivial with `Bun.file()`)
- Relative time formatting (`2d ago`)
- Binary-on-PATH detection (unless we later add `which`)

### From Bun directly

`bun:sqlite`, `Bun.file()` (reads JSONC), `Bun.spawn()`, `Bun.stringWidth()`, `bun test`, `bun build --compile`.

---

## Project layout

Flat inside each directory. Files split at ~300 lines by responsibility. Test files colocated (`foo.ts` + `foo.test.ts`).

```
nook/
├── bin/
│   └── nook.ts                     # shebang, invokes src/main.ts
├── src/
│   ├── main.ts                     # create cac instance, register commands, parse, top-level error catch
│   │
│   ├── cli/
│   │   ├── build-cac-instance.ts   # configures the cac instance (name, version, global flags)
│   │   ├── register-commands.ts    # imports every src/commands/* and calls its register()
│   │   └── run-command-handler.ts  # wrapper: invoke handler, render Result, set exit code
│   │
│   ├── commands/                   # one file per command, each exports register() + handler
│   │   ├── init.ts
│   │   ├── new.ts
│   │   ├── adopt.ts
│   │   ├── promote.ts
│   │   ├── pause.ts
│   │   ├── unpause.ts
│   │   ├── maintain.ts
│   │   ├── unmaintain.ts
│   │   ├── ship.ts
│   │   ├── unship.ts
│   │   ├── archive.ts
│   │   ├── unarchive.ts
│   │   ├── delete.ts
│   │   ├── rename.ts
│   │   ├── ls.ts
│   │   ├── status.ts
│   │   ├── stale.ts
│   │   ├── info.ts
│   │   ├── open.ts
│   │   ├── code.ts
│   │   ├── ai.ts
│   │   ├── cd.ts
│   │   ├── scan.ts
│   │   ├── reindex.ts
│   │   ├── doctor.ts
│   │   ├── config.ts
│   │   └── alias.ts
│   │
│   ├── core/                       # pure domain — no I/O, no side effects
│   │   ├── project-types.ts
│   │   ├── state-transitions.ts    # allowed transitions + validator
│   │   ├── staleness.ts            # isStale, nextStaleAt
│   │   ├── pause-window.ts         # pause expiry computation
│   │   ├── generate-ulid.ts
│   │   ├── resolve-category-config.ts
│   │   └── result.ts               # Result<T, E> helpers
│   │
│   ├── storage/                    # reads and writes to disk
│   │   ├── write-jsonc-atomic.ts   # thin wrapper: JSON.stringify + write-file-atomic
│   │   ├── read-jsonc.ts           # thin wrapper: Bun.file().json()
│   │   ├── project-metadata.ts     # .nook/project.jsonc read/write
│   │   ├── project-history.ts      # .nook/history.jsonl append/read (plain append)
│   │   ├── global-config.ts        # config.jsonc read/write
│   │   ├── project-index.ts        # SQLite derived cache (bun:sqlite)
│   │   ├── metadata-schemas.ts     # TypeBox schemas for all stored shapes
│   │   └── nookignore.ts           # .nookignore + .gitignore merge via `ignore`
│   │
│   ├── filesystem/
│   │   ├── discover-projects.ts
│   │   ├── move-project.ts         # atomic folder move for state transitions
│   │   ├── compute-last-touched.ts # max(mtime walk, git HEAD, CLI touches)
│   │   ├── read-git-head-time.ts
│   │   └── walk-tree.ts            # ignore-aware recursive mtime scan
│   │
│   ├── ui/
│   │   ├── ansi-colors.ts
│   │   ├── render-table.ts
│   │   ├── render-project-list.ts
│   │   ├── render-status.ts
│   │   ├── prompt-select.ts        # wraps @inquirer/prompts select
│   │   ├── prompt-confirm.ts       # wraps @inquirer/prompts confirm
│   │   ├── prompt-input.ts         # wraps @inquirer/prompts input
│   │   ├── spinner.ts
│   │   └── logger.ts               # info/warn/error/debug, honors --quiet/--verbose
│   │
│   ├── shell/
│   │   ├── detect-shell.ts
│   │   ├── generate-snippet.ts
│   │   ├── find-rc-file.ts
│   │   └── install-rc-integration.ts
│   │
│   ├── platform/
│   │   ├── app-paths.ts            # env-paths('nook') — single source of truth
│   │   ├── open-in-file-manager.ts
│   │   ├── launch-editor.ts
│   │   ├── launch-ai-tool.ts
│   │   └── run-alias-command.ts    # substitutes {path} {name} {id} {category}
│   │
│   └── errors/
│       ├── command-error.ts
│       ├── state-transition-error.ts
│       ├── validation-error.ts
│       └── filesystem-error.ts
│
├── package.json
├── tsconfig.json
├── CHANGELOG.md
└── README.md
```

---

## Architecture layers

Dependencies flow in one direction. A layer may depend on layers below it, never above. `core/` depends on nothing but itself.

```
main.ts
  │
  ├── cli/         (cac instance + command registration + handler wrapper)
  │
  └── commands/    (thin handlers: validate input, call core, call storage, render via ui)
        │
        ├── core/           (pure domain — state machine, staleness, IDs, Result)
        │
        ├── storage/        (reads/writes metadata, config, index)
        │     │
        │     └── filesystem/   (tree walk, git, moves)
        │
        ├── ui/             (prompts, rendering, logging)
        │
        ├── platform/       (OS launchers, app-paths via env-paths)
        │
        ├── shell/          (rc file integration)
        │
        └── errors/         (shared error types)
```

### Command shape

Each command file exports two things: a `register` function that wires the command into cac, and a pure `handler` function that does the work and returns a `Result`. This split keeps the handler directly testable without involving cac.

```ts
// src/commands/pause.ts
import type { CAC } from 'cac';
import type { CommandContext, CommandHandler } from '../cli/command-types';
import { err, ok, type Result } from '../core/result';

type PauseArgs = {
  project: string;
  days?: number;
  until?: string;
  reason?: string;
};

export const handlePause: CommandHandler<PauseArgs> = async (args, ctx) => {
  // pure orchestration — no cac, no process.exit, no stdout
  // returns Result<void, CommandError>
};

export const registerPauseCommand = (cli: CAC, ctx: CommandContext): void => {
  cli
    .command('pause <project>', 'Pause a project')
    .option('--days <n>', 'Pause duration in days')
    .option('--until <date>', 'Pause until ISO date')
    .option('--reason <text>', 'Reason, recorded in history')
    .action(async (project, options) => {
      const result = await handlePause({ project, ...options }, ctx);
      ctx.runResult(result);  // renders Result, sets exit code
    });
};
```

`register-commands.ts` imports every `src/commands/*.ts` and calls each `register*Command(cli, ctx)` in a flat list. No dynamic discovery, no decorators.

### Command context

```ts
export type CommandContext = {
  config: GlobalConfig;
  storage: StorageFacade;
  ui: UI;
  clock: Clock;             // injectable for tests
  cwd: string;
  runResult: (result: Result<unknown, CommandError>) => void;
};
```

Only `Clock` is a real abstraction. Everything else is the concrete thing wired at startup in `main.ts`. Tests build a `CommandContext` directly with a fake clock and a temp-dir `cwd`, then call `handlePause(args, ctx)` — cac is not involved.

### `runResult` — why it exists

Keeps handlers pure. Handlers never call `process.exit` or `console.log`. `runResult` is the one place that knows how to translate a `Result` into side effects: render the error via `ui.logger`, set the exit code. Tests inject a capturing `runResult` and assert on what was captured.

---

## Data and storage model

### Per-project

```
<project>/
├── .nook/
│   ├── project.jsonc       # metadata — atomic writes
│   └── history.jsonl       # append-only log — plain append
└── .nookignore             # optional, user-managed
```

JSONC on read (via `Bun.file().json()` — strips comments and trailing commas). JSONC on write goes through `storage/write-jsonc-atomic.ts`:

```ts
// storage/write-jsonc-atomic.ts
import writeFileAtomic from 'write-file-atomic';

export const writeJsoncAtomic = async (
  path: string,
  value: unknown,
): Promise<Result<void, FilesystemError>> => {
  const serialized = JSON.stringify(value, null, 2) + '\n';
  try {
    await writeFileAtomic(path, serialized);
    return ok(undefined);
  } catch (error) {
    return err(toFilesystemError(error, path));
  }
};
```

Every JSONC write in the codebase goes through this helper. Single place that enforces atomicity. `history.jsonl` is append-only and uses plain `Bun.file().writer()` with append mode — atomic rename doesn't fit append semantics and isn't necessary for append-only logs.

### Global

```
<config-dir>/nook/
├── config.jsonc            # atomic writes
└── state/
    └── index.sqlite        # derived, rebuildable
```

`<config-dir>` resolves via `src/platform/app-paths.ts`:

- Linux: `~/.config/nook/` (from `env-paths`, respects `XDG_CONFIG_HOME`)
- Windows: `%APPDATA%\nook\Config\` (from `env-paths`)
- macOS: `~/.config/nook/` — overridden from `env-paths`'s default (`~/Library/Preferences/nook/`) for consistency with Linux and developer muscle memory

The macOS override lives in one place. If a user sets `XDG_CONFIG_HOME` on macOS, we respect it.

### Schemas

Every persisted shape has a TypeBox schema in `storage/metadata-schemas.ts`. Writes validate before serializing; reads validate after parsing. Invalid data on read returns a `Result` with a recoverable error — `doctor` can quarantine the file and report it.

### SQLite index schema

```sql
CREATE TABLE projects (
  id             TEXT PRIMARY KEY,      -- ULID
  name           TEXT NOT NULL,
  path           TEXT NOT NULL,         -- absolute
  category       TEXT NOT NULL,
  state          TEXT NOT NULL,
  last_touched   INTEGER NOT NULL,      -- epoch ms
  last_scanned   INTEGER NOT NULL,
  created_at     INTEGER NOT NULL,
  paused_until   INTEGER,
  scratch        INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX idx_projects_state ON projects(state);
CREATE INDEX idx_projects_category ON projects(category);
CREATE INDEX idx_projects_last_touched ON projects(last_touched);
```

Not authoritative. Any command that reads the index checks `last_scanned` against a TTL (default 5 minutes) and refreshes stale rows. `nook reindex` blows it away and rebuilds from the `.jsonc` files.

---

## Error handling

Mixed, per your call:

- **Domain layer** returns `Result<T, E>` for predictable failure modes — invalid state transitions, schema validation, unknown categories, missing projects.
- **I/O boundaries** (filesystem, spawn, SQLite) throw. Storage functions catch and wrap into `Result`.
- **Commands** only deal in `Result`. `main.ts` catches any escaped throw as a last resort and renders a crash message with stack behind `--verbose`.

```ts
// core/result.ts
export type Result<T, E> = { ok: true; value: T } | { ok: false; error: E };

export const ok = <T>(value: T): Result<T, never> => ({ ok: true, value });
export const err = <E>(error: E): Result<never, E> => ({ ok: false, error });
```

No `unwrap`. Callers pattern-match or pass the error up. Failures stay visible at every call site.

---

## Testing (TDD)

- **Unit tests** for everything in `core/` — pure functions, no setup.
- **Storage tests** use `bun test`'s temp dir helpers. Real filesystem, real SQLite, real `write-file-atomic`, isolated per test.
- **Command tests** call the exported `handle*` function directly with a fake `Clock`, temp `cwd`, and a capturing `runResult`. cac never enters the test. This is why handler and registration are split.
- **CLI-level tests** (a handful) exercise the whole pipeline: spawn the compiled binary in a temp dir, assert on stdout and filesystem state. Cross-platform in CI matrix (`ubuntu`, `macos`, `windows`).

Test file next to its source. Red, green, refactor.

---

## Cross-platform considerations

Three areas where OS actually matters:

1. **App paths** — `env-paths('nook')` via `src/platform/app-paths.ts`.
2. **File manager open** — `open` (macOS) / `explorer` (Windows) / `xdg-open` (Linux). Detected via `process.platform`.
3. **Shell integration** — `$SHELL` detection for zsh/bash/fish; `$env:PSModulePath` or `$PROFILE` for PowerShell. One snippet per shell.

Everything else — SQLite, JSONC read, atomic writes, file moves, process spawning — is runtime-level and identical across OS.

### `nook ai` and terminal handling

The installed shell snippet defines `nook-ai()` as `cd "$(nook cd "$1")" && $(nook config get ai.default)`. CLI doesn't spawn a new terminal — the user is already in one.

Without shell integration, `nook ai` spawns the configured AI tool as a child process with `stdio: 'inherit'` and `cwd` set to the project path. Same outcome, slightly less clean.

---

## Onboarding flow (`nook init`)

Each step is an interactive prompt with example values and a short explanation of what the setting controls. No step writes to disk until step 8 confirms the full config.

1. **Project root** — Where your projects will live.
    
    - Example: `~/Projects`, `~/code`, `~/dev`
    - Default: `~/Projects`
2. **Categories** — How you want to organize promoted projects. Keep it minimal; you can add more later via `nook config edit`.
    
    - Default: `active` (single category)
    - Explanation shown to user: "Categories are folders where promoted projects live. Start with one (`active`) and split later if you need to. Examples of categories other devs use: `client,oss,personal,products`, or `work,personal`, or just `active`."
    - Prompt accepts a comma-separated list; `lab`, `archived`, and `shipped` are reserved names.
3. **Staleness threshold** — Days of no activity before a project is flagged stale.
    
    - Example: `60` (suggests a check every two months)
    - Default: `60`
    - Explanation: "Applied globally. Can be overridden per category later. Lab projects default to 14 days separately."
4. **Scratch prune window** — Days before `--scratch` projects auto-delete.
    
    - Default: `7`
    - Explanation: "Scratch projects are one-off experiments marked at creation time with `nook new --scratch`. They delete automatically after this many days of inactivity, no prompt."
5. **Default editor** — Auto-detects `code`, `cursor`, `zed`, `nvim`, `vim` on PATH.
    
    - Presents detected editors as a select list with "Other (enter command)" fallback.
    - Explanation: "Used by `nook code <project>`. Override per-invocation with `--with`."
6. **Default AI tool** — Optional. Auto-detects `claude`, `codex`, `opencode`, `pi` on PATH.
    
    - Presents detected tools or "Skip".
    - Explanation: "Used by `nook ai <project>`. Skip this if you don't use an agentic CLI."
7. **Shell integration** — Required for `nook cd` and `nook ai` to work seamlessly.
    
    - Detects shell from `$SHELL` (or `$PROFILE` on Windows PowerShell).
    - Shows the snippet in a fenced block with an explanation of what each function does.
    - Explicit confirm: "Add this to `~/.zshrc`?" (Y/n)
    - On yes: append to rc file, print confirmation.
    - On no: print the snippet with "Paste this into your rc file when ready" and a copy-friendly format.
8. **Summary and confirm** — Shows the full resolved config, asks for final confirmation before writing.
    
    - Writes `config.jsonc` atomically.
    - Creates the project root directory if missing.
    - Creates category folders (only `active/` by default, plus `lab/`).
    - Prints next steps: `nook new my-first-project`, `nook --help`.

No destructive writes happen before step 8. Ctrl-C at any point is a clean exit.
