# Publishing CLS Packages

Publishing is centralized in `Cumulus-s/cumulus-create`.

## Required Secrets

Configure these repo secrets on `Cumulus-s/cumulus-create`:

- `NPM_TOKEN`
- `CARGO_REGISTRY_TOKEN`
- `PYPI_API_TOKEN`
- `MIRROR_PUSH_TOKEN`

Do not add these secrets to split repos unless a split repo becomes an
independent release owner.

## Before Publish

```bash
npm ci
npm run release:verify
node scripts/sync-split-repos.mjs
```

Then run the manual GitHub workflows in dry-run mode:

- `sync split repos`
- `npm release`
- `crates release`
- `PyPI release`

## Public Install Commands

```bash
npm create @cls@latest my-app -- --with auth,db,knowledge
npm install @cls/auth @cls/db @cls/sdk
npm install @cls/nimbus @cls/cumulus-db
cargo install cls-nimbus
python3 -m pip install cls-knowledge
```

## Production Publish

After dry-run workflows pass and split repo READMEs point to the correct npm
packages, re-run these workflows with `dry_run=false`:

1. `sync split repos`
2. `npm release`
3. `crates release`
4. `PyPI release`

The npm workflow publishes the `@cls/*` packages in dependency order. The crates
workflow publishes `cls-nimbus`, `cls-knowledge-core`, then
`cls-knowledge-cli`. The PyPI workflow uploads `cls-knowledge`.

## After Publish

Run:

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

Then deprecate old owned names with messages that point users to `@cls/*`.
