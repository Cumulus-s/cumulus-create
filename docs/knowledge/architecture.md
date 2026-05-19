# Architecture

Cumulus Knowledge is local-first. The index is stored inside the target folder in `.cumulus/`.

## Pillars

- **Rust pillar:** `cls-knowledge-core` and `cls-knowledge-cli`. This is the trusted local engine. It owns indexing, SQLite storage, semantic graph construction, CLI, TUI, local MCP, and local API serving.
- **TypeScript pillar:** `@cls/knowledge`. This owns the no-code API shape, browser graph UI, Anime.js interactions, MCP Apps/web surfaces, and the main human-facing SDK.
- **Python pillar:** `cls-knowledge`. This owns operations ingestion helpers, batch enrichment, evals, and AI-agent analysis workflows.

## Components

- **Indexer:** walks files, applies ignore rules, chunks text, extracts code symbols, and records graph edges.
- **Graph Store:** stores sources, nodes, edges, chunks, and FTS rows in SQLite.
- **Graph View Builder:** converts the raw graph into readable semantic views with labels, legends, evidence, filters, and layout lanes.
- **Retriever:** combines FTS search with graph expansion and token budgeting.
- **CLI:** exposes human and machine interfaces.
- **TUI:** reads graph summaries and lets a user browse nodes without loading full text.
- **MCP:** exposes compact agent tools and resource URIs.
- **SDKs:** TypeScript and Python wrappers follow the same schemas.
- **Browser UI:** renders semantic graph views with Cytoscape.js layout and Anime.js motion.

## Default Local Store

SQLite is canonical because it is stable, portable, transactional, and easy to inspect. FTS5 powers text search. Optional stores are adapters:

- LanceDB for vectors.
- Tantivy for Rust full-text at larger scale.
- DuckDB for analytics and export.
- Kuzu for optional Cypher/property-graph acceleration only.

## Graph Model

`GraphSnapshot` is the canonical raw graph. It is optimized for agents and storage. Every indexed item is represented as a typed node:

- `project`
- `folder`
- `file`
- `chunk`
- `symbol`
- `document`
- `facility`
- `service`
- `platform`

Edges are typed:

- `contains`
- `chunk_of`
- `defines`
- `references`
- `imports`
- `related_to`
- `derived_from`

`GraphView` is the presentation graph. It is optimized for humans and low-token agent context. By default it hides raw chunk nodes and shows semantic nodes with stable IDs, readable labels, citations, and counts.

Graph view presets:

- **Source View:** folders, files, source documents, and evidence chains.
- **Finance View:** clients, banks, draw requests, invoices, vendors, suppliers, and payments.
- **Timeline View:** milestones, shipments, materials, dates, and dependency risks.
- **Risk View:** conflicts, missing evidence, overdue payments, delayed materials, and risk signals.
- **Full View:** all semantic nodes, grouped and filtered by default.

Layout lanes keep the graph understandable:

- Source documents stay on the left.
- Extracted entities stay in the center.
- Outcomes, risks, and decisions stay on the right.
- Timeline nodes are arranged by date-oriented lanes.
- Finance flow follows client to bank to draw request to invoice to vendor or supplier.

Chunks remain available through `cumulus://chunk/{id}` and source tracing. They do not appear as primary human graph nodes unless evidence mode is requested.

## API Shape

The local API uses the same shape as the intended hosted no-code API:

```txt
POST /v1/projects
POST /v1/projects/{project_id}/uploads
POST /v1/projects/{project_id}/index
GET  /v1/jobs/{job_id}
GET  /v1/projects/{project_id}/graph-view?preset=finance|timeline|risk|source|full
POST /v1/projects/{project_id}/query
GET  /v1/projects/{project_id}/nodes/{node_id}
GET  /v1/projects/{project_id}/nodes/{node_id}/source-trace?preset=full
GET  /v1/projects/{project_id}/paths/explain?from=&to=
GET  /v1/projects/{project_id}/exports/html
GET  /v1/projects/{project_id}/events
```

The local implementation uses `project_id=local` today. Hosted storage and job workers can replace that without changing the SDK method names.
