# `altocumulus` Local Cumulus Control Center

`altocumulus` is the Cumulus-owned local terminal control center for agent
operations. It shows local project inventory, SDK/API/MCP usage metadata, scan
history, storage, action cards, and the local append-only usage ledger.

It is not generated app code. It is not part of `apps/web`. It is a distributable
tool in `packages/altocumulus`.

## V3 Rule

V3 is cache-first and cloud-read-only.

It does not:

- scan the current directory on startup,
- upload local events to Cumulus Cloud,
- mutate hosted accounts, keys, billing, products, or projects,
- show credential values,
- store `.env` values.

Cloud-backed sync and mutation actions can be designed later behind explicit
action cards and confirmation rules.

## What It Scans

`altocumulus scan` detects:

- npm workspaces,
- `@cumulus_cloud/*`, legacy `@cumulus/*`, `@cumulus-create/*`,
  `create-cumulus`, and `cumulus-knowledge`,
- Rust `Cargo.toml` Cumulus crate references,
- Python `cumulus-knowledge` / `cumulus_knowledge` references,
- TypeScript, JavaScript, and Python imports,
- package scripts that call Cumulus tools,
- docs references,
- Cumulus and Relay environment variable names,
- local Cumulus-style API path references such as `/v1/signups`.

It ignores generated and dependency directories such as `.tado`, `.codex`,
`.claude`, `.agent`, `.cumulus`, `.git`, `node_modules`, `dist`, `.next`,
`.deps`, `.pnpm-store`, `vendor`, `out`, `target`, caches, and virtual
environment folders.

The npm package owns the terminal UI and command routing. Scan execution runs in
a bundled Python 3 runtime at `packages/altocumulus/python/altocumulus_runtime`.
The CLI uses `ALTOCUMULUS_PYTHON` when set, then falls back to `python3` and
`python`.

Scan progress is printed to stderr. JSON scan output is printed to stdout only.

## Secret Rule

`altocumulus` records environment variable names only.

For `.env` files, it stores keys like `CUMULUS_DB_TOKEN` or `RELAY_BASE_URL`.
It never stores the value after `=`, and `.env` values are not scanned for API
path matches.

## Storage Model

Default global state:

```txt
~/.cumulus/altocumulus
```

Default project state:

```txt
<project>/.cumulus/altocumulus
```

Users can change both:

```bash
altocumulus config set global-state <path>
altocumulus config set project-state <path> [project]
```

JSON files:

- `config.json`
- `projects.json`
- `latest-scan.json`
- `history.json`
- `activity.json`
- `events.jsonl`

`CUMULUS_ALTOCUMULUS_HOME` can redirect the global store for tests or isolated runs.
Relative `CUMULUS_ALTOCUMULUS_HOME` values resolve from the current CLI working
directory.

During a scan, `altocumulus` ignores its resolved global state directory and project
state directory when they live inside the scanned project. This prevents custom
state folders from being scanned back into later snapshots.

## Package Boundary

`@cumulus_cloud/altocumulus` follows the small-package MIT pattern.

It must not import AGPL provider internals from `apps/cumulus-db` or `apps/web`.
Future hosted integration should use HTTP APIs or SDK boundaries, not direct
server imports.

`@cumulus_cloud/events` is the shared ledger dependency. SDKs can import events.
Events must not import the TUI, SDKs, app code, or AGPL provider internals.

## Development Brief

Code lives in `packages/altocumulus`.

- `src/index.ts`: CLI entrypoint. It parses commands, resolves the target
  project, records scanner events, connects scanner/storage/TUI modules, and
  exposes the `altocumulus` binary.
- `src/scanner.ts`: TypeScript bridge. It starts the bundled Python runtime,
  forwards progress to stderr, and parses JSON from stdout.
- `python/altocumulus_runtime/scan.py`: scanner backend. It walks files,
  ignores generated folders and Altocumulus state folders, detects Cumulus
  packages/imports/API references, and records environment variable names
  without values.
- `src/storage.ts`: local JSON persistence. It owns global state, per-project
  state, project registry, latest scan snapshots, and scan history files.
- `src/tui.ts`: dependency-light ANSI renderer and keyboard loop. It can render
  one frame for smoke tests without entering raw terminal mode.
- `src/types.ts`: shared scan, registry, storage, and finding types.
- `src/*.test.ts`: focused tests for CLI behavior, scanner security rules,
  storage path handling, and TUI smoke rendering.

The root `package.json` wires this package into the monorepo through
`packages/altocumulus`, `altocumulus:build`, `altocumulus:test`,
`altocumulus:python-test`, and `packages:build`.

## Decision Log

- V3 starts from cache so startup is fast and predictable.
- The TUI uses a dependency-light ANSI renderer.
- Scan execution moved to bundled Python to match the AI/backend development
  surface while keeping npm as the install path.
- Scanner, storage, and renderer are separate modules so the UI can change
  without replacing the local data model.
- Billing, key rotation, checkout, and product creation appear as disabled
  action cards until a later plan defines safe cloud mutation behavior.
