# nook — CLI Commands Reference (MVP)

Conventions used below:

- `<arg>` — required positional argument
- `[arg]` — optional positional argument
- `--flag` — boolean flag
- `--option <value>` — option that takes a value
- Project identifiers accept either the folder name or a ULID prefix; ambiguous matches prompt for disambiguation
- All destructive actions (`archive`, `delete`, `unarchive` overwrite) prompt for confirmation unless `--yes` is passed

---

## Project states

| State | Folder location | Stale checks |
|---|---|---|
| `incubating` | `lab/` | Yes — aggressive prune |
| `active` | `<category>/` | Yes |
| `paused` | `<category>/` | No, until pause expires |
| `maintained` | `<category>/` | Yes — shows in stale log as reminder |
| `shipped` | `<category>/shipped/` | No |
| `archived` | `<category>/archived/` | No |

Transitions are direct — there is no `active → shipped → maintained` chain. A project moves straight from its current state to the target state via the corresponding command.

---

## Setup and configuration

### `nook init`
First-run setup. Creates the project root, default category folders, and global config file. Safe to re-run — will not overwrite existing config.

| Option | Description |
|---|---|
| `--root <path>` | Project root directory. Defaults to `~/Projects` |
| `--categories <list>` | Comma-separated category names. Defaults to `active` |
| `--force` | Overwrite existing config if present |

### `nook config`
View or modify global configuration. With no subcommand, prints the current config.

| Subcommand | Description |
|---|---|
| `get <key>` | Print a single config value (e.g. `defaults.staleness_days`) |
| `set <key> <value>` | Update a config value |
| `edit` | Open config file in `$EDITOR` |
| `path` | Print path to config file |
| `cd` | Print the config folder path for shell integration |

Config keys use dot notation mapping to the JSONC structure (e.g. `defaults.staleness_days`, `editors.default`, `categories.client.staleness_days`, `aliases.zed.command`).

---

## Project creation

### `nook new <name>`
Create a new project. Defaults to the `lab` category.

| Option | Description |
|---|---|
| `--category <name>` | Create directly in a category folder, skipping lab |
| `--scratch` | Mark as scratch; auto-prunes after `defaults.scratch_prune_days` |
| `--template <source>` | Scaffold from a template: local path or git URL |
| `--fork <project>` | Copy an existing project as a starting point |
| `--description <text>` | Set the project description |
| `--tags <list>` | Comma-separated tags |
| `--no-open` | Do not open the project after creation (default is to open in configured editor) |

### `nook adopt <path>`
Bring an existing folder under nook management. Creates a `.nook/` directory containing `project.jsonc` and `history.jsonl`; moves the folder into the configured category if it is not already there.

If the source path is already at its canonical location inside the project root (e.g. `<root>/oss/my-project` when `oss` is a configured category), adoption happens in place: no move, no conflict error. The category and state are inferred from the folder location (`lab/` → `incubating`; `<category>/shipped/` → `shipped`; `<category>/archived/` → `archived`; otherwise `active`). Pass `--category` or `--state` to override the inference.

| Option | Description |
|---|---|
| `--category <name>` | Target category. Defaults to the inferred category or `lab` |
| `--state <state>` | Initial state. Defaults to the inferred state for the source location |
| `--description <text>` | Set the project description |
| `--tags <list>` | Comma-separated tags |
| `--in-place` | Force in-place registration even when source is outside the project root |

---

## State transitions

Each forward transition has a corresponding inverse that returns the project to `active`. All transitions update history and, where needed, move folders.

### `nook promote <project>`
Move a project from `lab` to a category. State changes from `incubating` to `active`.

| Option | Description |
|---|---|
| `--category <name>` | Target category. Prompts if omitted |

### `nook pause <project>`
Pause a project. Excluded from staleness checks until the pause expires.

| Option | Description |
|---|---|
| `--days <n>` | Pause duration. Defaults to `defaults.pause_max_days` |
| `--until <date>` | Pause until a specific ISO date |
| `--reason <text>` | Optional note recorded in history |

### `nook unpause <project>`
End a pause early. Project returns to `active`.

### `nook maintain <project>`
Mark a project as maintained (feature complete, still receiving updates). Works from any non-archived state. No folder move — maintained projects live in the category root.

| Option | Description |
|---|---|
| `--version <version>` | Record the version reached in history |

### `nook unmaintain <project>`
Return a maintained project to `active`.

### `nook ship <project>`
Mark a project as shipped (feature complete, done). Works from any non-archived state. Moves the folder to `<category>/shipped/`.

| Option | Description |
|---|---|
| `--version <version>` | Record the shipped version in history |

### `nook unship <project>`
Return a shipped project to `active`. Moves the folder back to the category root.

### `nook archive <project>`
Move a project to `<category>/archived/`.

| Option | Description |
|---|---|
| `--reason <text>` | Optional note recorded in history |
| `--yes` | Skip confirmation prompt |

### `nook unarchive <project>`
Restore an archived project to `active`.

### `nook delete <project>`
Permanently delete a project and all its contents. Requires typing the project name to confirm, even with `--yes`.

| Option | Description |
|---|---|
| `--yes` | Skip the initial confirmation prompt (name confirmation still required) |

### `nook rename <project> <new-name>`
Rename a project. Updates the folder name and the display name in metadata. The project ID does not change; history is preserved.

---

## Navigation and listing

### `nook ls [category]`
List projects. With no argument, lists all projects grouped by category. With a category, lists only that category's projects.

| Option | Description |
|---|---|
| `--state <state>` | Filter by state |
| `--stale` | Show only stale projects |
| `--maintained` | Show only maintained projects |
| `--tag <tag>` | Filter by tag (repeatable) |
| `--sort <field>` | Sort by `touched`, `created`, `name`. Defaults to `touched` |
| `--json` | Output as JSON |
| `--all` | Include archived and shipped projects (excluded by default) |

### `nook status`
Summary view: counts per state, stale projects needing action, paused projects expiring soon. Intended for shell init or daily check-in.

| Option | Description |
|---|---|
| `--quiet` | Suppress output if nothing needs attention |

### `nook stale`
List stale projects with suggested actions. Interactive by default — walks through each stale project and prompts for archive, pause, or keep.

| Option | Description |
|---|---|
| `--list` | List only; do not prompt |
| `--category <name>` | Limit to a specific category |

### `nook info <project>`
Show detailed metadata for a project: state, category, tags, description, notes, last touched, history summary.

| Option | Description |
|---|---|
| `--json` | Output as JSON |
| `--history` | Include full history log |

---

## Opening projects

### `nook open <project>`
Open the project folder in the OS file manager (Finder on macOS, Explorer on Windows, `xdg-open` on Linux).

### `nook code <project>`
Open the project in the configured editor (`editors.default`).

| Option | Description |
|---|---|
| `--with <editor>` | Override the default editor for this invocation |

### `nook ai <project>`
Open a terminal at the project root and launch the configured agentic tool (`ai.default` — e.g. `claude`, `codex`, `opencode`, `pi`).

### `nook cd <project>`
Print the project's absolute path. Shell integration (a wrapper function in `.zshrc`/`.bashrc`) uses this to perform the actual `cd`.

---

## Aliases

User-defined commands for custom open actions. Aliases are defined in config under `aliases.<name>` and invoked as `nook <name> <project>`.

### Alias definition

```jsonc
{
  "aliases": {
    "zed": {
      "command": "zed {path}"
    },
    "cursor": {
      "command": "cursor {path}"
    },
    "cc-tmux": {
      "command": "tmux new-session -d -s {name} -c {path} 'claude'"
    }
  }
}
```

### Substitution variables

| Variable | Value |
|---|---|
| `{path}` | Project absolute path |
| `{name}` | Project folder name |
| `{id}` | Project ULID |
| `{category}` | Project category |

### Rules

- Alias names cannot shadow built-in commands (`new`, `open`, `code`, `ai`, etc.)
- Aliases are invoked with a project argument; commands that do not need one should simply ignore `{path}`
- `nook alias list` prints all configured aliases
- Manage aliases via `nook config edit` or `nook config set aliases.<name>.command <value>`

---

## Maintenance

### `nook scan`
Walk the project root, recompute `last_touched` for every tracked project, and refresh the index cache. Also reports any untracked folders found under configured categories as orphan warnings, so you can bring them under management.

| Option | Description |
|---|---|
| `--category <name>` | Limit scan to a specific category |
| `--force` | Ignore TTL and rescan everything |
| `--adopt-orphans` | For each untracked folder under a configured category, register it in place with inferred category and state |

### `nook reindex`
Rebuild the index cache from scratch by reading every `.nook/project.jsonc`. Used when the cache is suspected to be corrupt or out of sync.

### `nook doctor`
Diagnose common issues: orphaned folders (no `.nook/project.jsonc`), orphaned metadata (metadata pointing at missing folder), category mismatches (metadata says `client` but folder is in `personal/`), expired scratch projects pending prune, state/folder mismatches (metadata says `shipped` but folder is in category root).

| Option | Description |
|---|---|
| `--fix` | Attempt automatic fixes for safe issues |

---

## Configuration reference

The global config lives at `<config-dir>/nook/config.jsonc` (see architecture doc for `<config-dir>` resolution per OS). Example:

```jsonc
{
  // Root directory where all projects live
  "root": "~/Projects",

  "defaults": {
    "staleness_days": 60,
    "on_stale": "prompt",
    "scratch_prune_days": 7,
    "pause_max_days": 90
  },

  "editors": {
    "default": "code"
  },

  "ai": {
    "default": "claude"
  },

  "categories": {
    "lab": {
      "staleness_days": 14,
      "on_stale": "prompt_prune"
    },
    "active": {
      // inherits defaults
    }
  },

  "aliases": {
    "zed": {
      "command": "zed {path}"
    }
  }
}
```

Per-project metadata lives at `<project>/.nook/project.jsonc` and is managed by the CLI. Direct hand-editing is supported but not expected.

---

## Global flags

Available on every command:

| Flag | Description |
|---|---|
| `--help`, `-h` | Show command help |
| `--version` | Print CLI version |
| `--quiet`, `-q` | Suppress non-essential output |
| `--verbose`, `-v` | Verbose logging |
| `--no-color` | Disable color output |
| `--root <path>` | Override configured project root for this invocation |
