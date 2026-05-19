# Cumulus SDKs

This repo owns the SDKs for the full Cumulus Create flow.

- `packages/auth-sdk`: Agent Auth webhook/action helpers.
- `packages/db-sdk`: Cumulus DB HTTP client. It never imports DB provider internals.
- `packages/knowledge-sdk`: TypeScript Knowledge SDK and runtime setup.
- `packages/events`: shared event schema, redaction, privacy classes, and JSONL ledger.
- `packages/cloud-client`: read-only Cumulus Cloud inventory client.
- `packages/server`: server-side signup/action/API event hooks.
- `packages/mcp`: MCP resources, tools, and prompts for safe metadata.
- `python`: Python Knowledge SDK and operations helpers.

Generated projects should use these packages instead of reaching into old repos.
