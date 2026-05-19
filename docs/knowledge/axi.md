# AXI Interface Rules

AXI is a compact interface framework for AI agents.

## Addressable

Every object has:

- `id`
- `kind`
- `uri`
- `source_id`
- `metadata`

Agents can fetch details later with the ID or URI.

## eXchangeable

The same shape is used across:

- CLI JSON output
- TypeScript SDK
- Python SDK
- MCP structured content
- visualization exports

## Incremental

Default responses include:

- IDs
- labels
- kinds
- scores
- snippets
- counts
- cursors
- resource URIs

Large content is returned only through explicit fetch commands or resources.

