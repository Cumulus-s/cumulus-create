# AGENTS.md

This is the canonical Cumulus Create monorepo.

Assume users may not know the codebase. Explain choices in plain language. Keep changes small and direct.

## Source Of Truth

- `README.md` describes the product flow and repo layout.
- `docs/BRAND_GUIDELINES.md` defines the Cumulus visual system.
- `apps/cumulus-db/AGENTS.md` defines stricter Agent DB rules.
- Package-level `LICENSE` files define local package license boundaries.

## Hard Rules

- New development for Auth, DB, Knowledge, Create, SDKs, MCPs, CLIs, TUIs, and docs happens in this repo.
- Do not point new code at the old split repos. They are historical source imports only.
- Do not copy secrets, local `.env` files, customer data, private dashboards, runtime data, or generated build output.
- Keep AGPL provider/runtime code in AGPL-marked areas.
- App and SDK code must talk to Agent DB through HTTP/token APIs, not direct provider imports.

## Repo Map

- `apps/web`: Intent Console, Relay/Auth UI, API routes, dashboards, docs.
- `apps/cumulus-db`: Agent DB service.
- `packages/create-cumulus`: npm bootstrapper.
- `packages/auth-sdk`: Agent Auth SDK helpers.
- `packages/db-sdk`: Agent DB HTTP SDK.
- `packages/knowledge-sdk`: TypeScript Knowledge SDK and runtime installer.
- `packages/cli`: unified `cumulus` command.
- `packages/mcp`: unified MCP router.
- `crates`: Rust Knowledge runtime.
- `python`: Python Knowledge runtime/helpers.

## Verification

Use the narrowest useful check:

```bash
npm run typecheck
npm run packages:build
npm run create-cumulus:test
npm run db:test
cargo test --workspace
python3 -m pytest python/tests
```
