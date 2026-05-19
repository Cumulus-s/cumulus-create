# cmls-knowledge

Python SDK, operations ingestion helpers, graph QA helpers, MCP server, and ops-review TUI mode for Cumulus Knowledge.

The SDK uses the `cmls-knowledge` binary by default. Set `CUMULUS_BIN` to point at another binary.

```python
from cumulus_knowledge import CumulusKnowledge

knowledge = CumulusKnowledge(root="Documents/rune")
knowledge.index(profile="all")
hits = knowledge.query("auth flow", budget=800)
graph = knowledge.get_graph_view("risk")
```

Operations helpers:

```python
from cumulus_knowledge import (
    extract_operations_entities,
    build_relationship_candidates,
    score_graph_readability,
    detect_missing_citations,
)

entities = extract_operations_entities("demo-project")
relationships = build_relationship_candidates(entities)
quality = score_graph_readability(graph.data)
missing = detect_missing_citations(graph.data)
```

Ops review TUI mode:

```bash
python3 -m cumulus_knowledge.tui --ops-review ./demo-project
```

Python owns heavier document and operations workflows: invoices, vendors, bank draws, shipments, schedule risks, missing citations, and batch graph quality checks.

Hosted-style API mode:

```python
from cumulus_knowledge import CumulusKnowledge

client = CumulusKnowledge(api_base_url="http://127.0.0.1:8787")
client.create_project({"name": "Demo Operations Project"})
client.upload_folder([{"path": "invoices/demo.md", "content": "Invoice DEMO-INV-001"}])
client.index_project()
graph = client.get_graph_view("finance")
html = client.export_html()
```
