# Cumulus MCP

The canonical MCP entry point is `packages/mcp`, published as
`@cls/mcp`.

Run it with:

```bash
npm run mcp:build
npx cumulus-mcp
```

It exposes one safe local metadata surface for:

- project registry metadata
- Agent Auth account and credential-reference metadata
- Cumulus DB operation metadata
- Cumulus Knowledge retrieval metadata
- usage summaries from the local event ledger

It must not expose credential values, raw database rows, raw private knowledge
content, or `.env` values.

Required environment depends on the tool:

```bash
CUMULUS_AUTH_BASE_URL=http://localhost:3000
CUMULUS_AGENT_TOKEN=agt_...
CUMULUS_DB_BASE_URL=http://localhost:4317
CUMULUS_DB_ID=cdb_...
CUMULUS_DB_TOKEN=cdb_data_...
CUMULUS_KNOWLEDGE_BIN=cls-knowledge
CUMULUS_KNOWLEDGE_ROOT=.
```
