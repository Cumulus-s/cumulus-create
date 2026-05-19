# @cls/mcp

Safe MCP server for Cumulus agent operations metadata.

It exposes one local MCP entry point for:

- Cumulus project metadata
- Agent Auth account and credential-reference metadata
- Agent Database operation metadata
- Agent Knowledge retrieval metadata
- Usage ledger summaries
- Read-only action cards for future guarded cloud actions

Run it locally:

```bash
npx cumulus-mcp
```

Environment:

```bash
CUMULUS_AUTH_BASE_URL=http://localhost:3000
CUMULUS_AGENT_TOKEN=agt_...
CUMULUS_DB_BASE_URL=http://localhost:4317
CUMULUS_DB_ID=cdb_...
CUMULUS_DB_TOKEN=cdb_data_...
CUMULUS_KNOWLEDGE_BIN=cls-knowledge
CUMULUS_KNOWLEDGE_ROOT=.
```

The MCP server does not expose credential values, raw database rows, raw
knowledge snippets, or `.env` values as resources.
