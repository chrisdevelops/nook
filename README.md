# nook

A CLI for organizing local development projects by category and lifecycle
state. `nook` keeps folders, metadata, and history in sync so projects can
move through states (incubating, active, paused, maintained, shipped,
archived) without losing track of what you have on disk.

## Install

### npm

Requires [Bun](https://bun.sh) 1.3+ on your PATH — `nook` ships as a Bun
script to keep the published package small.

```
npm install -g nook
```

or with Bun:

```
bun add -g nook
```

### Prebuilt binary

Each GitHub release publishes statically linked binaries for macOS
(arm64 and x64), Linux (x64 and arm64), and Windows (x64). Download the
asset for your platform from the
[releases page](https://github.com/chrisdevelops/nook/releases/latest) and
place it on your PATH.

POSIX one-liner (macOS and Linux):

```
curl -L -o /usr/local/bin/nook \
  https://github.com/chrisdevelops/nook/releases/latest/download/nook-$(uname -s | tr '[:upper:]' '[:lower:]')-$(uname -m | sed s/x86_64/x64/)
chmod +x /usr/local/bin/nook
```

## Quickstart

```
nook init
```

Walks through an interactive first-run setup: project root, categories,
staleness threshold, scratch prune window, default editor and AI tool,
and optional shell integration.

```
nook new my-project
```

Creates `<root>/lab/my-project/` with `.nook/project.jsonc` and history,
and opens the project in the configured editor.

```
nook ls
```

Lists projects grouped by category. Filters include `--state`, `--stale`,
`--maintained`, `--tag`, plus `--all`, `--sort`, and `--json`.

## Command reference

`nook` provides commands for creating, organizing, inspecting, and
navigating projects:

- **Setup:** `init`, `config`
- **Create:** `new`, `adopt`
- **State transitions:** `pause`, `unpause`, `maintain`, `unmaintain`,
  `promote`, `ship`, `unship`, `archive`, `unarchive`
- **Manage:** `edit`, `rename`, `delete`
- **Discover:** `ls`, `info`, `status`, `stale`
- **Navigate:** `open`, `code`, `ai`, `cd`, `alias`
- **Maintenance:** `scan`, `reindex`, `doctor`

See [`.claude/docs/COMMANDS.md`](./.claude/docs/COMMANDS.md) for the full
specification of every command, its arguments, and its behavior.

## Shell integration

`nook init` offers to install shell integration that adds `nook-cd` and
`nook-ai` wrapper functions for bash, zsh, fish, and PowerShell. The
snippet is idempotent — re-running `nook init` leaves an existing block
untouched. To install the snippet after the fact, print it with
`nook config` or re-run `nook init`.

## License

MIT — see [LICENSE](./LICENSE).
