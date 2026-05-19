# Self Hosting

Self-hosted Cumulus Create means running:

- `apps/web` for the Intent Console, Agent Auth, API, docs, dashboards, and MCP routes.
- `apps/cumulus-db` for local Agent DB storage.
- `crates/cumulus-knowledge-cli` for the local Knowledge runtime.
- `packages/mcp` for the unified Auth/DB/Knowledge MCP router.

Keep `DATABASE_URL` for Agent Auth/Relay data separate from Cumulus DB storage.
Cumulus DB uses its own HTTP service, database id, and scoped tokens.
