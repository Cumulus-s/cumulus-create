# Cumulus Create

Cumulus Create is the new canonical monorepo for the Cumulus project bootstrap stack.

It centralizes the working systems that used to live in separate projects:

- Agent Auth API/UI from `Documents/api`
- Agent DB from `Documents/cumulus/site/cumulus/apps/cumulus-db`
- Agent Knowledge from `Documents/knowledge`
- the `@cls/create` npm package
- shared SDKs, MCPs, CLI/TUI surfaces, schemas, and public docs

The old repos are source imports only. New development should happen here.

## Product Flow

The core use case is:

1. User says: "I want to build X."
2. Agent signs up to Cumulus through Agent Auth.
3. Agent registers the project intent and core metadata.
4. Agent runs `npm create @cls`.
5. Bootstrap installs npm packages, Rust crates, and Python libraries when requested.
6. Generated code includes Auth, DB, Knowledge, SDK, API, MCP, CLI, and TUI wiring.
7. Agent indexes the project into Cumulus Knowledge.
8. Agent uses MCP as the project second brain.
9. Agent writes core data and progress to Cumulus DB through APIs.
10. The Intent Console shows what the agent is doing, what it knows, and what changed.

## Layout

```txt
apps/web                 Intent console, docs, dashboards, and Cumulus Auth API
apps/cumulus-db          Agent DB service
packages/create-cumulus  `@cls/create` npm bootstrapper
packages/altocumulus     Local terminal control center
packages/events          Shared event schema, redaction, and JSONL ledger
packages/cloud-client    Read-only Cumulus Cloud inventory client
packages/auth-sdk        Agent Auth webhook/action SDK
packages/db-sdk          Cumulus DB HTTP SDK
packages/knowledge-sdk   TypeScript Knowledge SDK and setup tools
packages/server          Server-side signup/action/API event hooks
packages/cli             Non-TUI command surface
packages/mcp             Safe MCP metadata adapter
packages/track-sdk       Activation tracking helper
crates/                  Rust Knowledge core and local CLI/TUI/MCP runtime
python/                  Python Knowledge SDK, ops helpers, TUI, MCP server
docs/                    API, SDK, MCP, CLI, TUI, self-hosting, licensing docs
schemas/                 Auth, DB, Knowledge, and project schemas
```

See `docs/agent-operations-control-plane.md` for the current Cumulus Cloud,
Altocumulus, SDK, MCP, and privacy-boundary architecture.
See `docs/release/package-registry-map.md` for the npm, PyPI, and crates package
map and release order.

## Common Commands

```bash
npm install
npm run web:dev
npm run packages:build
npm run create-cumulus:test
npm run db:test
npm run knowledge:test
```

Rust checks:

```bash
cargo test --workspace
```

Python checks:

```bash
python3 -m pytest python/tests
```

## Runtime Install

The generated bootstrap command can install extra runtimes:

```bash
npm create @cls@latest my-project -- --with auth,db,knowledge --install-runtimes
```

`--install-runtimes` delegates to the Knowledge setup installer. It can install:

- the Rust Knowledge runtime through Cargo
- the Python Knowledge package through pip
- npm workspace dependencies through the selected package manager

## License Boundaries

This monorepo contains packages with different licenses.

- Full web app/server, local Agent DB, local Knowledge runtime, Nimbus provider tooling, and self-hosted templates are AGPL-3.0-only.
- Public SDK/auth helper packages are Apache-2.0 unless their package file states a stricter license.
- App-side DB integration must use HTTP/token APIs. Do not import Agent DB provider internals into permissive packages.
