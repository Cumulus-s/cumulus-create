# @cls/knowledge

TypeScript SDK, local API server, MCP server, and browser graph UI helpers for Cumulus Knowledge.

The npm package is now `@cls/knowledge`. The runtime binary names
stay `cls-knowledge-*` for compatibility. The SDK uses the
`cls-knowledge` binary by default. Set `CUMULUS_BIN` to point at another
binary.

Optional runtime setup:

```bash
npx cls-knowledge-setup --all
```

This installs the Rust CLI with `cargo install cls-knowledge-cli` and the Python package with `python -m pip install --upgrade cls-knowledge`. Normal `npm install` does not do this unless `CUMULUS_KNOWLEDGE_INSTALL_RUNTIMES=all` is set.

```ts
import { CumulusKnowledge } from "@cls/knowledge";

const knowledge = new CumulusKnowledge({ root: "Documents/rune" });
await knowledge.index({ profile: "all" });
const hits = await knowledge.query("auth flow", { budget: 800 });
const graph = await knowledge.getGraphView("finance");
```

For a hosted or local no-code API:

```ts
const client = new CumulusKnowledge({ apiBaseUrl: "http://127.0.0.1:8787" });
const project = await client.createProject({ name: "Demo Operations Project" });
await client.uploadFolder([{ path: "invoices/demo.md", content: "Invoice DEMO-INV-001..." }]);
await client.indexProject(project.data.project_id);
const view = await client.getGraphView("risk");
const html = await client.exportHtml();
```

Run the package API server:

```bash
CUMULUS_ROOT=./demo-project CUMULUS_API_PORT=8788 npx cls-knowledge-api
```

Render a standalone graph page from a `GraphView`:

```ts
import { renderGraphHtml } from "@cls/knowledge/ui";

const html = renderGraphHtml(graph.data);
```

The browser renderer uses Cytoscape.js for graph layout and Anime.js for readable motion, panel transitions, selected-node focus, and live legend filtering.

## Local usage ledger

Pass `events.ledgerPath` to record safe retrieval metadata into
`@cls/events`. The SDK stores query hashes, source/knowledge refs,
retrieved chunk counts, duration, status, and error class. It does not store raw
queries, raw snippets, private knowledge text, or prompts.
