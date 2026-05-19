# CMLS Package Registry Map

`Cumulus-s/cumulus-create` is the source of truth for public package releases.
Split repos are mirrors. Do not publish from split repos unless ownership is
changed later.

Do not commit registry tokens. The central GitHub repo needs these secrets:

- `NPM_TOKEN` for the `@cmls` npm scope.
- `CARGO_REGISTRY_TOKEN` for crates.io.
- `PYPI_API_TOKEN` for PyPI.
- `MIRROR_PUSH_TOKEN` for pushing split repo mirrors.

## Public Packages

| Surface | Package | Registry | License |
| --- | --- | --- | --- |
| Project generator | `@cmls/create` | npm | MIT |
| Events and local ledger | `@cmls/events` | npm | MIT |
| Cloud API client | `@cmls/cloud` | npm | MIT |
| Auth SDK | `@cmls/auth` | npm | Apache-2.0 |
| DB SDK | `@cmls/db` | npm | Apache-2.0 |
| Composed SDK | `@cmls/sdk` | npm | Apache-2.0 |
| Nimbus TS contracts | `@cmls/nimbus` | npm | AGPL-3.0-only |
| Cumulus DB service | `@cmls/cumulus-db` | npm | AGPL-3.0-only |
| Knowledge TS SDK | `@cmls/knowledge` | npm | AGPL-3.0-only |
| MCP adapter | `@cmls/mcp` | npm | MIT |
| Server hooks | `@cmls/server` | npm | MIT |
| CLI | `@cmls/cli` | npm | MIT |
| Activation tracker | `@cmls/track` | npm | MIT |
| Local control center | `@cmls/altocumulus` | npm | MIT |
| Nimbus compiler | `cmls-nimbus` | crates.io | AGPL-3.0-only |
| Knowledge core | `cmls-knowledge-core` | crates.io | AGPL-3.0-only |
| Knowledge CLI | `cmls-knowledge-cli` | crates.io | AGPL-3.0-only |
| Python Knowledge | `cmls-knowledge` | PyPI | AGPL-3.0-only |

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
npm view @cmls/auth version license
npm view @cmls/db version license
npm view @cmls/sdk version license
npm view @cmls/nimbus version license
npm view @cmls/cumulus-db version license
npm create @cmls@latest /tmp/cmls-smoke -- --template agent-auth --agent-auth hosted --cumulus-db cloud --with auth,db,knowledge --no-git
cargo install cmls-nimbus
python3 -m pip install cmls-knowledge
```

Do not publish `@cumulus/db@0.1.0`; that npm name already exists at an unrelated
`21.3.4` version.
