#!/usr/bin/env node
import readline from "node:readline";
import { CumulusKnowledge } from "./index.js";

const root = process.env.CUMULUS_ROOT ?? process.cwd();
const client = new CumulusKnowledge({ root });

const tools = [
  { name: "graph_view", description: "Return a semantic graph view with readable labels, legend, layout, filters, and evidence.", inputSchema: { type: "object", properties: { preset: { type: "string" } } } },
  { name: "search", description: "Search indexed nodes and chunks.", inputSchema: { type: "object", properties: { query: { type: "string" }, limit: { type: "integer" } }, required: ["query"] } },
  { name: "fetch", description: "Fetch a node by ID.", inputSchema: { type: "object", properties: { id: { type: "string" } }, required: ["id"] } },
  { name: "expand_neighbors", description: "Expand graph neighbors.", inputSchema: { type: "object", properties: { id: { type: "string" }, depth: { type: "integer" } }, required: ["id"] } },
  { name: "find_paths", description: "Find a graph path.", inputSchema: { type: "object", properties: { from_id: { type: "string" }, to_id: { type: "string" } }, required: ["from_id", "to_id"] } },
  { name: "index_status", description: "Return local index status.", inputSchema: { type: "object", properties: {} } },
  { name: "ingest", description: "Index the configured root.", inputSchema: { type: "object", properties: { profile: { type: "string" } } } },
  { name: "source_trace", description: "Return source evidence for a semantic graph node.", inputSchema: { type: "object", properties: { id: { type: "string" }, preset: { type: "string" } }, required: ["id"] } },
];

const rl = readline.createInterface({ input: process.stdin, terminal: false });

rl.on("line", async (line) => {
  if (!line.trim()) return;
  let request: any;
  try {
    request = JSON.parse(line);
  } catch (error) {
    write({ jsonrpc: "2.0", id: null, error: { code: -32700, message: String(error) } });
    return;
  }
  const id = request.id;
  if (id === undefined) return;
  try {
    const result = await handle(request.method, request.params ?? {});
    write({ jsonrpc: "2.0", id, result });
  } catch (error) {
    write({ jsonrpc: "2.0", id, error: { code: -32603, message: error instanceof Error ? error.message : String(error) } });
  }
});

async function handle(method: string, params: any): Promise<unknown> {
  if (method === "initialize") {
    return {
      protocolVersion: "2025-06-18",
      serverInfo: { name: "cmls-knowledge", version: "0.1.0" },
      capabilities: { tools: {}, resources: {}, prompts: {} },
    };
  }
  if (method === "tools/list") return { tools };
  if (method === "resources/list") {
    return { resources: [
      { uri: "cumulus://snapshot/current", name: "Current Graph Snapshot", mimeType: "application/json" },
      { uri: "cumulus://graph-view/current", name: "Current Semantic Graph View", mimeType: "application/json" },
    ] };
  }
  if (method !== "tools/call") return {};

  const name = params.name;
  const args = params.arguments ?? {};
  if (name === "graph_view") return toolResult((await client.getGraphView(args.preset ?? "full")).data);
  if (name === "search") return toolResult((await client.query(args.query, { limit: args.limit })).data);
  if (name === "fetch") return toolResult((await client.getNode(args.id)).data);
  if (name === "expand_neighbors") return toolResult((await client.expandNeighbors(args.id, args.depth ?? 1)).data);
  if (name === "find_paths") return toolResult((await client.findPaths(args.from_id, args.to_id, args.max_depth ?? 6)).data);
  if (name === "index_status") return toolResult((await client.indexStatus()).data);
  if (name === "ingest") return toolResult((await client.index({ profile: args.profile ?? "all" })).data);
  if (name === "source_trace") {
    const view = (await client.getGraphView(args.preset ?? "full")).data;
    return toolResult({ node_id: args.id, evidence: view.evidence.filter((item) => item.node_id === args.id) });
  }
  throw new Error(`unknown tool: ${name}`);
}

function toolResult(data: unknown): unknown {
  return {
    content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
    structuredContent: data,
  };
}

function write(value: unknown): void {
  process.stdout.write(`${JSON.stringify(value)}\n`);
}
