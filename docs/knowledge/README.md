# Cumulus Knowledge

`cumulus-knowledge` is a local-first knowledge graph framework for AI agents and human operators.

It provides:

- a global `cumulus knowledge` CLI
- a Rust local indexer, CLI, TUI, and local MCP/API runtime
- TypeScript hosted/no-code API helpers, browser graph UI, SDK, and MCP surface
- Python operations ingestion, graph QA, eval, and analysis helpers
- MCP-compatible tools, resources, and prompts
- compact AXI response shapes for low-token agent usage

## AXI

AXI is the public interface rule for this project:

- **Addressable:** every result has stable IDs and `cumulus://` URIs.
- **eXchangeable:** CLI, SDK, and MCP return the same compact schemas.
- **Incremental:** default responses are small; agents fetch details only when needed.

## Quick Start

```bash
cargo run -p cumulus-knowledge-cli -- knowledge index .
cargo run -p cumulus-knowledge-cli -- knowledge graph view --path . --preset finance --format json
cargo run -p cumulus-knowledge-cli -- knowledge viz export --path . --format html --output graph.html
cargo run -p cumulus-knowledge-cli -- knowledge query "README" --path . --format json
cargo run -p cumulus-knowledge-cli -- knowledge .
```

After indexing, the target folder contains:

```txt
.cumulus/
  knowledge.sqlite
  manifest.json
```

## Main Commands

```bash
cumulus knowledge init <path>
cumulus knowledge index <path> --profile code|docs|facility|all
cumulus knowledge <path>
cumulus knowledge view <path> --view human|agent|ops
cumulus knowledge query <text> --path <path>
cumulus knowledge node get <id> --path <path>
cumulus knowledge graph view --path <path> --preset source|finance|timeline|risk|full
cumulus knowledge graph expand <id> --path <path>
cumulus knowledge path explain <from> <to> --path <path>
cumulus knowledge viz export --path <path> --format json|dot|html
cumulus knowledge api serve --path <path> --bind 127.0.0.1:8787
cumulus knowledge serve mcp --path <path> --transport stdio|http
cumulus knowledge doctor --path <path>
```

Install the Rust binary from this workspace with:

```bash
cargo install --path crates/cumulus-knowledge-cli
```

That installs the global `cumulus` command.

After crates.io publishing, install it with:

```bash
cargo install cumulus-knowledge-cli
```

Install the TypeScript SDK from npm with:

```bash
npm install @cumulus_cloud/knowledge-sdk
```

The npm package can also install the Rust CLI and Python package. This is opt-in because it changes tools outside `node_modules`.

```bash
npx cumulus-knowledge-setup --all
```

For automated installs:

```bash
CUMULUS_KNOWLEDGE_INSTALL_RUNTIMES=all npm install @cumulus_cloud/knowledge-sdk
```

Useful installer options:

```bash
npx cumulus-knowledge-setup --rust
npx cumulus-knowledge-setup --python
npx cumulus-knowledge-setup --all --dry-run
CUMULUS_KNOWLEDGE_RUST_PATH=crates/cumulus-knowledge-cli npx cumulus-knowledge-setup --rust
CUMULUS_KNOWLEDGE_PYTHON_PATH=python npx cumulus-knowledge-setup --python
```

Install the Python SDK from PyPI with:

```bash
python3 -m pip install cumulus-knowledge
```

## Repository Layout

```txt
crates/cumulus-knowledge-core   Rust core index, graph, search, export (`cumulus-knowledge-core`)
crates/cumulus-knowledge-cli    Rust CLI, TUI, MCP stdio server (`cumulus-knowledge-cli`)
packages/knowledge-sdk          TypeScript SDK and lightweight MCP server
python                          Python SDK and lightweight MCP server
schemas/              Shared JSON Schemas
docs/                 Architecture and AXI docs
fixtures/             Test fixture projects
```

## Package Pillars

- **Rust:** `cumulus-knowledge-core` and `cumulus-knowledge-cli` own indexing, SQLite storage, semantic graph views, local TUI, local MCP, and local API serving.
- **TypeScript:** `@cumulus_cloud/knowledge-sdk` owns the hosted/no-code API shape, browser graph UI, Anime.js interactions, MCP Apps/web surfaces, and the main web SDK.
- **Python:** `cumulus-knowledge` owns operations ingestion helpers, enrichment experiments, graph quality audits, evals, and AI-agent analysis workflows.

## Human Graph Views

The raw `GraphSnapshot` remains the canonical storage and agent graph. It still contains files, chunks, symbols, and edges.

Human-facing tools now use `GraphView`. It hides raw `chunk_*` nodes by default and shows readable semantic nodes such as:

- `Invoice DEMO-INV-001`
- `Vendor: BrightSteel Demo Supply`
- `Steel Delivery: Batch 04`
- `Schedule Risk: Steel Delay`
- `Conflict: Beam Clearance`

Each visible node carries a label, subtitle, display kind, domain kind, importance, confidence, source count, evidence count, and a `cumulus://node/{id}` URI. Evidence chunks are still fetchable through `cumulus://chunk/{id}` when an agent or user asks for proof.

Available presets:

- `source`: folders, files, documents, and evidence chains
- `finance`: clients, banks, draw requests, invoices, vendors, suppliers, and payments
- `timeline`: milestones, shipments, materials, and date-driven dependencies
- `risk`: conflicts, missing evidence, overdue payments, delayed materials, and risk signals
- `full`: all semantic nodes, grouped and filtered by default

## No-Code API Flow

The local API mirrors the hosted API shape:

```bash
cumulus knowledge api serve --path ./demo-project --bind 127.0.0.1:8787
```

Core endpoints:

```txt
POST /v1/projects
POST /v1/projects/local/uploads
POST /v1/projects/local/index
GET  /v1/jobs/local
GET  /v1/projects/local/graph-view?preset=finance
POST /v1/projects/local/query
GET  /v1/projects/local/nodes/{node_id}
GET  /v1/projects/local/paths/explain?from=&to=
GET  /v1/projects/local/exports/html
GET  /v1/projects/local/events
```

Responses use the same AXI envelope as the CLI and SDKs.

## Current API And SDK Capabilities

The current design supports local-first and hosted-style workflows:

- Create a project record through the API.
- Upload files through the TypeScript or Rust local API using `{ files: [{ path, content }] }`.
- Index uploaded files into `.cumulus/knowledge.sqlite`.
- Fetch semantic graph views by preset.
- Query indexed knowledge with token-budgeted search.
- Fetch nodes by stable ID.
- Explain paths between semantic nodes.
- Trace evidence for a semantic node with `source_trace`.
- Stream simple graph update events over Server-Sent Events.
- Export standalone HTML graph views.
- Use the same operations graph from CLI, MCP, TypeScript SDK, and Python SDK.

The UI design system currently provides semantic lanes, readable node labels, legends with live toggles, search, selected-node evidence, HTML export, and Anime.js/Cytoscape.js browser rendering. It is ready for local demos and localhost API use. Multi-tenant hosted auth, persistent job queues, object storage, and real realtime indexing are still adapter work.

## Storage

The first implementation uses SQLite and FTS5 as the canonical local store.
The schema leaves room for LanceDB, Tantivy, DuckDB, and Kuzu adapters without requiring them.

## Current Scope

Implemented now:

- local `.cumulus/knowledge.sqlite` store
- file walking with ignore rules
- heading/code-aware chunking
- heuristic symbol/import extraction with Tree-sitter-ready metadata
- operations entity extraction for invoices, vendors, suppliers, clients, banks, shipments, milestones, materials, risks, and conflicts
- semantic `GraphView` presets with legends, layout lanes, filters, and hidden evidence
- FTS search, node fetch, graph expansion, path finding, doctor, export
- Ratatui TUI shell
- stdio MCP server, local HTTP bridge, `graph_view`, and `source_trace`
- TypeScript SDK/API/UI helpers with Cytoscape.js and Anime.js graph rendering
- Python SDK wrappers, operations helpers, MCP tools, and ops-review TUI mode

Planned adapters:

- Tree-sitter parser packs
- LanceDB vectors
- Tantivy search
- DuckDB analytics export
- optional Kuzu graph accelerator
