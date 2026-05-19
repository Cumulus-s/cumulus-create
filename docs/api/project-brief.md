# Architecture Brief

Cumulus Relay is an agent-auth and signup platform. It gives AI agents a
standard way to discover products, sign users up, read verification email, and
invoke product actions with user consent.

This repository contains both the hosted Relay service and the self-hosted
version. A startup can either connect to hosted Relay or fork this repository
and operate its own Relay deployment.

## What Relay Does

Relay has four core jobs:

1. Publish provider metadata that agents can understand.
2. Authenticate users, developers, and agents.
3. Run signup workflows that may need email verification.
4. Dispatch signed action webhooks to integrated products.

The hosted service keeps Relay as an API business. The open-source server lets
teams audit the system, self-host it, and adapt it for their own stack.

## Stack

| Layer | Technology |
| --- | --- |
| Web app | Next.js App Router |
| API | Hono mounted at `/v1/*` |
| MCP | Streamable HTTP MCP at `/mcp` |
| Database | Postgres with Drizzle ORM |
| Agent workspace storage | Hosted or local Cumulus DB over HTTP |
| Workflows | Vercel Workflow DevKit |
| Auth | email OTP, passkeys, sessions, bearer agent tokens |
| Billing | external payment provider |
| Email | Resend outbound, SendGrid inbound parse |
| Observability | Sentry and pino |
| Tests | Vitest |

## Repository Layout

```text
app/                    Next.js pages, route handlers, dashboard, docs
src/server/             Hono API, auth, billing, providers, database
src/mcp/                MCP tools
workflows/              durable signup workflow
migrations/             SQL migrations
packages/altocumulus/   @cmls/altocumulus
packages/events/        @cmls/events
packages/cloud-client/  @cmls/cloud
packages/cli/           @cmls/cli
packages/auth/      @cmls/auth
packages/db/        @cmls/db
packages/knowledge-sdk/ @cmls/knowledge
packages/mcp/           @cmls/mcp
packages/server/        @cmls/server
packages/track-sdk/     @cmls/track
packages/create-cumulus @cmls/create project creator
packages/create-cumulus/templates/cumulus-db
                        vendored local Cumulus DB service template
docs/                   operator and contributor docs
```

## Auth Model

Relay uses separate auth paths for separate actors:

- people sign in with email OTP or passkeys
- browser sessions use signed cookies
- agents use bearer tokens scoped to a user or tenant
- integrated products receive HMAC-signed webhooks
- public keys are exposed at `/.well-known/jwks.json`

Agent tokens are shown once and stored only as hashes.

## Provider Model

Relay supports two provider types:

- built-in providers operated by the Relay deployment
- tenant-defined providers registered by startups that integrate Relay

Provider metadata includes display name, homepage, docs URL, categories,
pricing model, capabilities, and input schema. Agents use this metadata to pick
the right product for a user's request.

The hosted business can operate built-in provider integrations as cloud
services. Self-hosted operators can remove, replace, or add providers.

## Public Surfaces

Relay exposes:

- REST API under `/v1/*`
- MCP tools under `/mcp`
- OpenAPI at `/openapi.json`
- public JWKS at `/.well-known/jwks.json`
- human dashboards under `/me` and `/dev`
- package creator through `@cmls/create`

Generated `full`, `inner`, and `agent-auth` projects expose a simple Cumulus DB
UI. `full` and `inner` use `/me/database`; `agent-auth` uses `/database`.
Generated public app code accesses Cumulus DB through HTTP/token proxy routes.

## Development

```bash
npm install
cp .env.example .env
npm run typecheck
npm test
npm run build
```

For database setup, apply migrations from [migrations](../migrations) to a
Postgres database and set `DATABASE_URL`.

## Licensing

The Relay/Cumulus server is AGPL-3.0-only. Public SDK packages such as
`@cmls/auth`, `@cmls/db`, and `@cmls/sdk` are Apache-2.0. Generated
full, inner, self-hosted, and local Cumulus DB templates include AGPL services
and default to AGPL-3.0-only. Small hosted `agent-auth --cumulus-db cloud`
projects remain MIT.
