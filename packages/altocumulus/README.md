# @cmls/altocumulus

`altocumulus` is the local terminal control center for Cumulus agent operations.

V3 opens from cached local state. It does not scan the current directory on
startup. Cloud inventory is read-only, and event upload is disabled until a
later explicit sync plan.

## Install

```bash
npm install -g @cmls/altocumulus
```

From this monorepo:

```bash
npm --workspace @cmls/altocumulus run build
node packages/altocumulus/dist/index.js
```

Altocumulus scan execution requires Python 3. The Python scanner is bundled in
the npm package, so no separate PyPI install is needed. Set `ALTOCUMULUS_PYTHON`
only when you need to point at a specific Python 3 executable.

## Commands

```bash
altocumulus                     # open cached local dashboard for the current folder
altocumulus ./my-project        # open the TUI for another folder
altocumulus scan . --json       # scan and print JSON
altocumulus scan ./my-project --json
altocumulus config . --json     # show storage paths
```

Storage commands:

```bash
altocumulus config set global-state ~/.cumulus/altocumulus
altocumulus config set project-state ./.cumulus/altocumulus .
```

For tests or isolated runs, set `CUMULUS_ALTOCUMULUS_HOME` to move the global store.
Relative values resolve from the current CLI working directory.

## Storage

Default global state:

```txt
~/.cumulus/altocumulus
```

Default project state:

```txt
<project>/.cumulus/altocumulus
```

The package writes JSON files only:

- `config.json`
- `projects.json`
- `latest-scan.json`
- `history.json`
- `activity.json`
- `events.jsonl`

Secret rule: `altocumulus` records environment variable names only. It never
stores values from `.env` files, and it does not scan `.env` values for API path
matches.

Scan progress is written to stderr. JSON output is written to stdout only, so it
is safe to pipe into tools such as `jq`.

When scanning, `altocumulus` ignores its resolved global state directory and project
state directory if either one lives inside the project. This includes custom
paths set with `altocumulus config set global-state` or `altocumulus config set project-state`.
It also skips common generated and dependency folders such as `.tado`, `.codex`,
`.claude`, `.agent`, `.cumulus`, `.git`, `node_modules`, `dist`, `.deps`,
`.pnpm-store`, `vendor`, `out`, `target`, caches, and virtual environment
folders.

## Development Map

- `src/index.ts`: CLI commands and binary entrypoint.
- `src/scanner.ts`: TypeScript bridge that starts the bundled Python scanner.
- `src/storage.ts`: local JSON config, registry, snapshots, and history.
- `src/tui.ts`: ANSI TUI frame renderer and keyboard navigation.
- `src/types.ts`: shared TypeScript types.
- `python/altocumulus_runtime/scan.py`: filesystem walking and scan detection.
- `src/*.test.ts`: scanner, storage, CLI, and TUI smoke tests.
