# Publishing npm Packages

Cumulus publishes Apache-2.0 SDK packages and AGPL Nimbus/provider tooling from
this repo:

The full registry map and release order live in
[`docs/release/package-registry-map.md`](../release/package-registry-map.md).

| Package | Path | Purpose |
| --- | --- | --- |
| `create-cumulus` | `packages/create-cumulus` | app generator |
| `@cumulus_cloud/altocumulus` | `packages/altocumulus` | local terminal control center |
| `@cumulus_cloud/events` | `packages/events` | event schema and local ledger |
| `@cumulus_cloud/cloud-client` | `packages/cloud-client` | read-only cloud inventory client |
| `@cumulus_cloud/cli` | `packages/cli` | command-line tools |
| `@cumulus/auth` | `packages/auth-sdk` | Cumulus Auth SDK |
| `@cumulus/db` | `packages/db-sdk` | Cumulus DB HTTP SDK |
| `@cumulus/sdk` | `packages/sdk` | composed Auth, DB, and system SDK |
| `@cumulus/nimbus` | `packages/nimbus` | Nimbus TypeScript contracts |
| `@cumulus_cloud/knowledge-sdk` | `packages/knowledge-sdk` | Knowledge TypeScript SDK |
| `@cumulus_cloud/mcp` | `packages/mcp` | safe MCP adapter |
| `@cumulus_cloud/server` | `packages/server` | server event hooks |
| `@cumulus_cloud/track` | `packages/track-sdk` | activation tracker |

Only publish from a clean worktree after tests pass.

## Authenticate

Use an npm account or automation token that has publish rights for the package:

```bash
npm login
npm whoami
```

For automation:

```bash
npm config set //registry.npmjs.org/:_authToken "$NPM_TOKEN"
```

Do not commit `.npmrc` files or tokens.
Prefer a temporary npm config for one publish:

```bash
tmp_npmrc="$(mktemp)"
printf '//registry.npmjs.org/:_authToken=%s\n' "$NPM_TOKEN" > "$tmp_npmrc"
npm --userconfig "$tmp_npmrc" publish --access public
rm -f "$tmp_npmrc"
```

## Build and Publish

From each package directory:

```bash
npm run typecheck
npm run test --if-present
npm run build
npm publish --access public --provenance
```

Before publishing `create-cumulus`, also run the root release checks and the
local Cumulus DB service checks when templates changed:

```bash
npm run release:verify
npm run release:pack
```

The package `prepublishOnly` hooks run tests or builds again where configured.

For the creator package:

```bash
cd packages/create-cumulus
npm run typecheck
npm run test
npm run build
npm publish --access public --provenance
```

## Smoke Test

After publishing `create-cumulus`:

```bash
npm view create-cumulus@latest version
npx --yes create-cumulus@latest /tmp/cumulus-smoke \
  --template agent-auth \
  --agent-auth hosted \
  --cumulus-db cloud \
  --no-install \
  --no-git
test -f /tmp/cumulus-smoke/app/api/relay-login/route.ts
test -f /tmp/cumulus-smoke/app/database/page.tsx
test ! -d /tmp/cumulus-smoke/apps/cumulus-db

npx --yes create-cumulus@latest /tmp/cumulus-smoke-full \
  --template full \
  --agent-auth hosted \
  --no-install \
  --no-git
test -f /tmp/cumulus-smoke-full/apps/cumulus-db/LICENSE
test -f '/tmp/cumulus-smoke-full/app/api/cumulus-db/databases/[id]/records/route.ts'
test -f /tmp/cumulus-smoke-full/apps/cumulus-db/src/nimbus.ts
test -f /tmp/cumulus-smoke-full/apps/cumulus-db/openapi/system-v1.openapi.json
test -f /tmp/cumulus-smoke-full/app/'(user)'/me/database/page.tsx
node -e "const pkg=require('/tmp/cumulus-smoke-full/package.json'); if (!pkg.scripts['cumulus-db:start']) process.exit(1)"
node -e "const pkg=require('/tmp/cumulus-smoke-full/package.json'); if (!pkg.scripts['cumulus-db:nimbus:check'] || !pkg.dependencies.pg) process.exit(1)"
```

`npm create cumulus@latest` is npm shorthand. It resolves to the
`create-cumulus` package:

```bash
npm create cumulus@latest /tmp/cumulus-smoke -- \
  --template outer \
  --agent-auth hosted \
  --no-install \
  --no-git
```

`outer` defaults to hosted Cumulus DB and should not include
`apps/cumulus-db` unless `--cumulus-db local` or `--cumulus-db both` is
explicitly passed.

## Versioning

Use semver. Patch releases are for fixes and docs, minor releases for new
commands/templates, and major releases for breaking template or SDK changes.

```bash
cd packages/create-cumulus
npm version patch
npm publish --access public --provenance
```

For `create-cumulus`, use package-specific git tags such as
`create-cumulus-v0.3.0`. Push the release commit and tag after npm publish
passes.
