# Contributing To Cumulus Relay

Thanks for contributing.

Cumulus Relay is open source. The full app/server is licensed under AGPLv3.
Creator, template, SDK, helper, and example packages may carry their own MIT
license files.

## Development

```bash
git clone https://github.com/Cumulus-s/cumulus-create.git
cd cumulus-create
npm install
cp .env.example .env.local
npm run dev
```

Before opening a change:

```bash
npm run typecheck
npm run test
npm run build
```

## Repo Layout

```text
app/                        Next.js UI and route handlers
src/server/                 REST API, auth, billing, providers, database
src/mcp/                    MCP tools and transport
workflows/                  Durable signup workflows
migrations/                 Database migrations
scripts/                    Maintenance, smoke, and migration helpers
packages/create-cumulus/    npm creator package
packages/create-cumulus/templates/cumulus-db/
                            vendored local Cumulus DB service template
packages/auth-sdk/          webhook helper source
packages/cli/               relay CLI source
packages/track-sdk/         activation tracking helper
examples/                   integration examples
docs/                       public operator and architecture docs
```

## Pull Requests

- Use a short imperative title.
- Explain what changed and why.
- Include verification commands.
- Update docs when behavior, env vars, APIs, or setup change.
- Do not include secrets, private strategy notes, local worktree notes, personal
  filesystem paths, or generated `.env` files.

## Cumulus DB Templates

`packages/create-cumulus/templates/cumulus-db` is copied from the public
Cumulus DB service. Preserve its AGPL-3.0-only license files, NOTICE file,
tests, and smoke script when refreshing it.

Generated app code must talk to Cumulus DB through HTTP/token APIs. Do not
import `apps/cumulus-db` source into MIT generated app code.

## Migrations

When schema changes:

```bash
npx drizzle-kit generate
DATABASE_URL="postgres://..." npx tsx scripts/apply-pending-migrations.ts
```

Keep migrations deterministic and review generated SQL before committing.

## Security

Report vulnerabilities privately through the process in `SECURITY.md`.
