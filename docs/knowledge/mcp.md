# MCP Surface

Cumulus exposes a small tool surface.

## Tools

- `search`
- `fetch`
- `expand_neighbors`
- `find_paths`
- `summarize_subgraph`
- `graph_view`
- `source_trace`
- `index_status`
- `ingest`

## Resources

- `cumulus://node/{id}`
- `cumulus://chunk/{id}`
- `cumulus://snapshot/{id}`
- `cumulus://graph-view/current`

## Prompts

- `summarize_neighborhood`
- `trace_decision`
- `explain_symbol`
- `audit_context`

The Rust CLI implements stdio MCP first and a small localhost HTTP bridge. Local HTTP validates localhost binding, rejects unsafe `Origin` headers, and is intended for development and local agent use.

`graph_view` returns the semantic presentation graph. It is the preferred MCP entry point for visual or operations agents because it hides raw chunk nodes by default and includes legends, layout lanes, evidence counts, and stable `cumulus://` URIs.

`source_trace` returns citations and evidence for one semantic node. Use it when the agent needs proof without loading the whole source file.
