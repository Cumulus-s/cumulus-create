from __future__ import annotations

import json
import os
import sys
from typing import Any

from .client import CumulusKnowledge
from .operations import (
    build_relationship_candidates,
    compare_invoice_to_bank_draw,
    detect_missing_citations,
    detect_schedule_shipping_risk,
    extract_operations_entities,
    run_agent_eval,
    score_graph_readability,
)


TOOLS = [
    {"name": "graph_view", "description": "Return a semantic graph view with readable labels, legend, layout, filters, and evidence.", "inputSchema": {"type": "object", "properties": {"preset": {"type": "string"}}}},
    {"name": "search", "description": "Search indexed nodes and chunks.", "inputSchema": {"type": "object", "properties": {"query": {"type": "string"}, "limit": {"type": "integer"}}, "required": ["query"]}},
    {"name": "fetch", "description": "Fetch a node by ID.", "inputSchema": {"type": "object", "properties": {"id": {"type": "string"}}, "required": ["id"]}},
    {"name": "expand_neighbors", "description": "Expand graph neighbors.", "inputSchema": {"type": "object", "properties": {"id": {"type": "string"}, "depth": {"type": "integer"}}, "required": ["id"]}},
    {"name": "find_paths", "description": "Find a graph path.", "inputSchema": {"type": "object", "properties": {"from_id": {"type": "string"}, "to_id": {"type": "string"}}, "required": ["from_id", "to_id"]}},
    {"name": "index_status", "description": "Return local index status.", "inputSchema": {"type": "object", "properties": {}}},
    {"name": "ingest", "description": "Index the configured root.", "inputSchema": {"type": "object", "properties": {"profile": {"type": "string"}}}},
    {"name": "source_trace", "description": "Return evidence links for a semantic node.", "inputSchema": {"type": "object", "properties": {"id": {"type": "string"}, "preset": {"type": "string"}}, "required": ["id"]}},
    {"name": "extract_entities", "description": "Extract operations entities from the configured root.", "inputSchema": {"type": "object", "properties": {}}},
    {"name": "audit_graph_quality", "description": "Score graph readability and citation health.", "inputSchema": {"type": "object", "properties": {"preset": {"type": "string"}}}},
    {"name": "detect_missing_citations", "description": "Find semantic nodes without evidence.", "inputSchema": {"type": "object", "properties": {"preset": {"type": "string"}}}},
    {"name": "compare_invoice_to_bank_draw", "description": "Detect invoice and bank draw mismatches from extracted entities.", "inputSchema": {"type": "object", "properties": {}}},
    {"name": "detect_schedule_shipping_risk", "description": "Detect shipment and schedule risk language.", "inputSchema": {"type": "object", "properties": {}}},
]


def main() -> None:
    client = CumulusKnowledge(root=os.environ.get("CUMULUS_ROOT", os.getcwd()))
    for line in sys.stdin:
        if not line.strip():
            continue
        try:
            request = json.loads(line)
            if "id" not in request:
                continue
            result = handle(client, request.get("method", ""), request.get("params") or {})
            write({"jsonrpc": "2.0", "id": request["id"], "result": result})
        except Exception as exc:
            write({"jsonrpc": "2.0", "id": request.get("id") if "request" in locals() else None, "error": {"code": -32603, "message": str(exc)}})


def handle(client: CumulusKnowledge, method: str, params: dict[str, Any]) -> Any:
    if method == "initialize":
        return {
            "protocolVersion": "2025-06-18",
            "serverInfo": {"name": "cumulus-knowledge", "version": "0.1.0"},
            "capabilities": {"tools": {}, "resources": {}, "prompts": {}},
        }
    if method == "tools/list":
        return {"tools": TOOLS}
    if method == "resources/list":
        return {"resources": [{"uri": "cumulus://snapshot/current", "name": "Current Graph Snapshot", "mimeType": "application/json"}]}
    if method != "tools/call":
        return {}

    name = params.get("name")
    args = params.get("arguments") or {}
    if name == "search":
        return tool_result(client.query(args["query"], limit=args.get("limit", 10)).data)
    if name == "graph_view":
        return tool_result(client.get_graph_view(args.get("preset", "full")).data)
    if name == "fetch":
        return tool_result(client.get_node(args["id"]).data)
    if name == "expand_neighbors":
        return tool_result(client.expand_neighbors(args["id"], args.get("depth", 1)).data)
    if name == "find_paths":
        return tool_result(client.find_paths(args["from_id"], args["to_id"], args.get("max_depth", 6)).data)
    if name == "index_status":
        return tool_result(client.index_status().data)
    if name == "ingest":
        return tool_result(client.index(profile=args.get("profile", "all")).data)
    if name == "source_trace":
        view = client.get_graph_view(args.get("preset", "full")).data
        return tool_result({"node_id": args["id"], "evidence": [item for item in view.get("evidence", []) if item.get("node_id") == args["id"]]})
    if name == "extract_entities":
        entities = extract_operations_entities(client.root)
        return tool_result({"entities": entities, "relationships": build_relationship_candidates(entities)})
    if name == "audit_graph_quality":
        view = client.get_graph_view(args.get("preset", "full")).data
        return tool_result({"readability": score_graph_readability(view), "eval": run_agent_eval("local", view)})
    if name == "detect_missing_citations":
        return tool_result(detect_missing_citations(client.get_graph_view(args.get("preset", "full")).data))
    if name == "compare_invoice_to_bank_draw":
        return tool_result(compare_invoice_to_bank_draw(extract_operations_entities(client.root)))
    if name == "detect_schedule_shipping_risk":
        return tool_result(detect_schedule_shipping_risk(extract_operations_entities(client.root)))
    raise ValueError(f"unknown tool: {name}")


def tool_result(data: Any) -> dict[str, Any]:
    return {"content": [{"type": "text", "text": json.dumps(data, indent=2)}], "structuredContent": data}


def write(value: dict[str, Any]) -> None:
    sys.stdout.write(json.dumps(value) + "\n")
    sys.stdout.flush()


if __name__ == "__main__":
    main()
