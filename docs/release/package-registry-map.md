# CLS Package Registry Map

`Cumulus-s/cumulus-create` is the source of truth for public package releases.
Split repos are mirrors. Do not publish from split repos unless ownership is
changed later.

Do not commit registry tokens. The central GitHub repo needs these secrets:

- `NPM_TOKEN` for the `@cls` npm scope.
- `CARGO_REGISTRY_TOKEN` for crates.io.
- `PYPI_API_TOKEN` for PyPI.
- `MIRROR_PUSH_TOKEN` for pushing split repo mirrors.

## Public Packages

| Surface | Package | Registry | License |
| --- | --- | --- | --- |
| Project generator | `@cls/create` | npm | MIT |
| Events and local ledger | `@cls/events` | npm | MIT |
| Cloud API client | `@cls/cloud` | npm | MIT |
| Auth SDK | `@cls/auth` | npm | Apache-2.0 |
| DB SDK | `@cls/db` | npm | Apache-2.0 |
| Composed SDK | `@cls/sdk` | npm | Apache-2.0 |
| Nimbus TS contracts | `@cls/nimbus` | npm | AGPL-3.0-only |
| Cumulus DB service | `@cls/cumulus-db` | npm | AGPL-3.0-only |
| Knowledge TS SDK | `@cls/knowledge` | npm | AGPL-3.0-only |
| MCP adapter | `@cls/mcp` | npm | MIT |
| Server hooks | `@cls/server` | npm | MIT |
| CLI | `@cls/cli` | npm | MIT |
| Activation tracker | `@cls/track` | npm | MIT |
| Local control center | `@cls/altocumulus` | npm | MIT |
| Nimbus compiler | `cls-nimbus` | crates.io | AGPL-3.0-only |
| Knowledge core | `cls-knowledge-core` | crates.io | AGPL-3.0-only |
| Knowledge CLI | `cls-knowledge-cli` | crates.io | AGPL-3.0-only |
| Python Knowledge | `cls-knowledge` | PyPI | AGPL-3.0-only |

Private workspaces:

- `@cumulus-create/web`: hosted web app and dashboards.

## Release Order

1. Sync split repos with `node scripts/sync-split-repos.mjs`.
2. Run `npm run release:verify`.
3. Publish npm packages with `.github/workflows/npm-provenance.yml`.
4. Publish crates with `.github/workflows/crates-release.yml`.
5. Publish PyPI with `.github/workflows/pypi-release.yml`.
6. Smoke-test public installs.
7. Deprecate old owned names after replacements are verified.

Npm publish order is encoded in `.github/workflows/npm-provenance.yml`.
The workflow defaults to dry-run. Set `dry_run=false` only after the generated
tarballs and split repo mirrors are reviewed.

## Smoke Checks

```bash
npm view @cls/auth version license
npm view @cls/db version license
npm view @cls/sdk version license
npm view @cls/nimbus version license
npm view @cls/cumulus-db version license
npm create @cls@latest /tmp/cls-smoke -- --template agent-auth --agent-auth hosted --cumulus-db cloud --with auth,db,knowledge --no-git
cargo install cls-nimbus
python3 -m pip install cls-knowledge
```

Do not publish `@cumulus/db@0.1.0`; that npm name already exists at an unrelated
`21.3.4` version.
