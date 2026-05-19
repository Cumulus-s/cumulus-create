# Cumulus Package Registry Map

This repo is the source of truth for Cumulus Create, Auth, DB, Nimbus,
Altocumulus, SDKs, MCP, and Knowledge package releases.

Do not commit registry tokens. Use fresh GitHub org secrets or temporary local
environment variables. Treat any token pasted into chat as exposed and rotate
it before publishing.

## Product Split

| Product surface | Package | Registry | License | Purpose |
| --- | --- | --- | --- | --- |
| Project generator | `create-cumulus` | npm | MIT | Create a Cumulus app with Auth, DB, Knowledge, and MCP wiring. |
| Cumulus Auth SDK | `@cumulus/auth` | npm | Apache-2.0 | Public human/agent auth, webhook, session, and safe-event helpers. |
| Cumulus DB SDK | `@cumulus/db` | npm | Apache-2.0 | Public HTTP SDK for Cumulus DB. |
| Cumulus SDK | `@cumulus/sdk` | npm | Apache-2.0 | Composed Auth, DB, and system client. |
| Nimbus TS contracts | `@cumulus/nimbus` | npm | AGPL-3.0-only | Desired-state manifest contracts for agents and tools. |
| Nimbus compiler | `cumulus-nimbus` | crates.io | AGPL-3.0-only | Rust compiler/CLI for `.nimbus` source. |
| Local control center | `@cumulus_cloud/altocumulus` | npm | MIT | Local terminal control center for Cumulus projects and usage. |
| Event truth layer | `@cumulus_cloud/events` | npm | MIT | Shared event schema, redaction, and local ledger writer. |
| Cloud API client | `@cumulus_cloud/cloud-client` | npm | MIT | Read-only client for Cumulus Cloud inventory APIs. |
| Knowledge SDK | `@cumulus_cloud/knowledge-sdk` | npm | AGPL-3.0-only | TypeScript SDK and MCP helpers for Cumulus Knowledge. |
| MCP adapter | `@cumulus_cloud/mcp` | npm | MIT | MCP adapter for safe Cumulus agent operations metadata. |
| Server hooks | `@cumulus_cloud/server` | npm | MIT | Server hooks for Cumulus signups, actions, and safe events. |
| CLI | `@cumulus_cloud/cli` | npm | MIT | Command-line tools for Cumulus workflows. |
| Activation tracking | `@cumulus_cloud/track` | npm | MIT | Small activation tracker for Cumulus integrations. |
| Python Knowledge | `cumulus-knowledge` | PyPI | AGPL-3.0-only | Python SDK and MCP server for Cumulus Knowledge. |
| Rust Knowledge CLI | `cumulus-knowledge-cli` | crates.io | AGPL-3.0-only | Rust local Knowledge indexer, CLI, TUI, local MCP/API runtime. |
| Rust Knowledge core | `cumulus-knowledge-core` | crates.io | AGPL-3.0-only | Rust indexing/search/graph core used by the CLI. |

Private/non-publishable workspaces:

- `@cumulus-create/web`: hosted web app and dashboards.
- `@cumulus/database`: AGPL Cumulus DB service. Keep this private unless a
  separate AGPL service release plan says otherwise.

## Npm Release Order

Publish dependency roots first:

1. `@cumulus_cloud/events`
2. `@cumulus_cloud/cloud-client`
3. `@cumulus/auth`
4. `@cumulus/db`
5. `@cumulus/sdk`
6. `@cumulus/nimbus`
7. `@cumulus_cloud/knowledge-sdk`
8. `@cumulus_cloud/mcp`
9. `@cumulus_cloud/server`
10. `@cumulus_cloud/cli`
11. `@cumulus_cloud/track`
12. `@cumulus_cloud/altocumulus`
13. `create-cumulus`

Run first:

```bash
npm ci
npm run release:verify
npm run release:pack
```

Inspect tarballs before publishing. `npm run release:pack` performs dry-run
packing for the npm workspaces.

Publish only from a clean worktree with reviewed tarballs:

```bash
tmp_npmrc="$(mktemp)"
printf '//registry.npmjs.org/:_authToken=%s\n' "$NPM_TOKEN" > "$tmp_npmrc"
npm --userconfig "$tmp_npmrc" publish --workspace @cumulus/auth --access public --provenance
rm -f "$tmp_npmrc"
```

Repeat for each workspace in release order. Do not write `.npmrc` into the repo.

## PyPI Release

Build and check:

```bash
rm -rf python/dist
python3 -m build python
python3 -m twine check python/dist/*
```

Upload with an environment variable:

```bash
TWINE_USERNAME=__token__ TWINE_PASSWORD="$PYPI_TOKEN" python3 -m twine upload python/dist/*
```

Do not write `.pypirc` into the repo.

## Crates Release

Only publish Rust crates after the full Rust workspace passes:

```bash
cargo test --workspace
cargo package -p cumulus-nimbus
cargo package -p cumulus-knowledge-core
cargo package -p cumulus-knowledge-cli
```

Publish order:

1. `cumulus-nimbus`
2. `cumulus-knowledge-core`
3. `cumulus-knowledge-cli`

## Old Namespace Cleanup

Old Relay-branded package names should be deprecated only after the replacement
packages are published and verified:

```bash
npm owner ls @relay-cumulus/server
npm deprecate @relay-cumulus/server@"*" "Moved to Cumulus packages. See https://github.com/Cumulus-s/cumulus-create."
```

List every old package first:

```bash
npm search --json --scope=@relay-cumulus relay-cumulus
```

Delete an npm org only from npm web admin after every old package is deprecated
or transferred and no team member needs it. This repo does not contain code that
can safely delete an npm org.
