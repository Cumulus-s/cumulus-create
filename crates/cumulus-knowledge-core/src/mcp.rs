use serde_json::{json, Value};

pub fn tool_definitions() -> Vec<Value> {
    vec![
        json!({
            "name": "graph_view",
            "title": "Cumulus Graph View",
            "description": "Return a semantic presentation graph with readable display labels, legend, layout, filters, and evidence links.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "preset": {"type": "string", "enum": ["source", "finance", "timeline", "risk", "full"], "default": "full"},
                    "limit": {"type": "integer", "default": 800}
                }
            },
            "annotations": {"readOnlyHint": true, "destructiveHint": false, "openWorldHint": false}
        }),
        json!({
            "name": "search",
            "title": "Search Cumulus Knowledge",
            "description": "Search indexed nodes and chunks. Returns compact hits with IDs, snippets, scores, and cumulus:// resource URIs.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "query": {"type": "string"},
                    "limit": {"type": "integer", "default": 10}
                },
                "required": ["query"]
            },
            "annotations": {"readOnlyHint": true, "destructiveHint": false, "openWorldHint": false}
        }),
        json!({
            "name": "fetch",
            "title": "Fetch Cumulus Node Or Chunk",
            "description": "Fetch one node or chunk by stable ID.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "id": {"type": "string"}
                },
                "required": ["id"]
            },
            "annotations": {"readOnlyHint": true, "destructiveHint": false, "openWorldHint": false}
        }),
        json!({
            "name": "expand_neighbors",
            "title": "Expand Cumulus Neighbors",
            "description": "Return the local graph neighborhood for a node.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "id": {"type": "string"},
                    "depth": {"type": "integer", "default": 1}
                },
                "required": ["id"]
            },
            "annotations": {"readOnlyHint": true, "destructiveHint": false, "openWorldHint": false}
        }),
        json!({
            "name": "find_paths",
            "title": "Find Cumulus Path",
            "description": "Find a short graph path between two node IDs.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "from_id": {"type": "string"},
                    "to_id": {"type": "string"},
                    "max_depth": {"type": "integer", "default": 6}
                },
                "required": ["from_id", "to_id"]
            },
            "annotations": {"readOnlyHint": true, "destructiveHint": false, "openWorldHint": false}
        }),
        json!({
            "name": "index_status",
            "title": "Cumulus Index Status",
            "description": "Return counts and local index health.",
            "inputSchema": {"type": "object", "properties": {}},
            "annotations": {"readOnlyHint": true, "destructiveHint": false, "openWorldHint": false}
        }),
        json!({
            "name": "ingest",
            "title": "Ingest Cumulus Folder",
            "description": "Index the configured folder into the local Cumulus graph.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "profile": {"type": "string", "enum": ["code", "docs", "facility", "all"], "default": "all"}
                }
            },
            "annotations": {"readOnlyHint": false, "destructiveHint": false, "openWorldHint": false}
        }),
        json!({
            "name": "summarize_subgraph",
            "title": "Summarize Cumulus Subgraph",
            "description": "Return a compact text summary of a local graph neighborhood.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "id": {"type": "string"},
                    "depth": {"type": "integer", "default": 1}
                },
                "required": ["id"]
            },
            "annotations": {"readOnlyHint": true, "destructiveHint": false, "openWorldHint": false}
        }),
        json!({
            "name": "source_trace",
            "title": "Trace Cumulus Source Evidence",
            "description": "Return source/evidence links for a semantic graph node.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "id": {"type": "string"},
                    "preset": {"type": "string", "enum": ["source", "finance", "timeline", "risk", "full"], "default": "full"}
                },
                "required": ["id"]
            },
            "annotations": {"readOnlyHint": true, "destructiveHint": false, "openWorldHint": false}
        }),
    ]
}

pub fn prompt_definitions() -> Vec<Value> {
    vec![
        json!({"name": "summarize_neighborhood", "title": "Summarize Neighborhood", "description": "Summarize the important nodes and relationships around a Cumulus node."}),
        json!({"name": "trace_decision", "title": "Trace Decision", "description": "Trace a decision through source files, docs, and linked graph nodes."}),
        json!({"name": "explain_symbol", "title": "Explain Symbol", "description": "Explain a code symbol with nearby context and citations."}),
        json!({"name": "audit_context", "title": "Audit Context", "description": "Check whether retrieved context is complete, concise, and grounded."}),
    ]
}
