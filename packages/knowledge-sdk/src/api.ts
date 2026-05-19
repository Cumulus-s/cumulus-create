#!/usr/bin/env node
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join, normalize, sep } from "node:path";
import { CumulusKnowledge, type AxiEnvelope, type GraphView } from "./index.js";
import { renderGraphHtml } from "./ui.js";

const root = process.env.CUMULUS_ROOT ?? process.cwd();
const port = Number(process.env.CUMULUS_API_PORT ?? process.env.PORT ?? 8788);
const client = new CumulusKnowledge({ root });

createServer(async (request, response) => {
  try {
    if (!validateOrigin(request)) {
      return writeJson(response, 403, envelope("api.forbidden", { error: "forbidden origin" }));
    }
    await route(request, response);
  } catch (error) {
    writeJson(response, 500, {
      ok: false,
      data: null,
      meta: { version: "0.1.0", command: "api.error", generated_at: new Date().toISOString() },
      links: [],
      error: { code: "api_error", message: error instanceof Error ? error.message : String(error) },
    });
  }
}).listen(port, "127.0.0.1", () => {
  process.stderr.write(`Cumulus Knowledge API listening on http://127.0.0.1:${port}\n`);
});

async function route(request: IncomingMessage, response: ServerResponse): Promise<void> {
  const url = new URL(request.url ?? "/", "http://127.0.0.1");
  const method = request.method ?? "GET";
  const project = projectRoute(url.pathname);
  if (method === "GET" && url.pathname === "/health") return writeJson(response, 200, { ok: true });
  if (method === "POST" && url.pathname === "/v1/projects") {
    return writeJson(response, 200, envelope("api.projects.create", {
      project_id: "local",
      root_path: root,
      next: {
        upload: "/v1/projects/local/uploads",
        index: "/v1/projects/local/index",
        graph_view: "/v1/projects/local/graph-view?preset=full",
      },
    }));
  }
  if (method === "POST" && project?.suffix === "/uploads") {
    ensureLocalProject(project.projectId);
    const body = await readJson(request);
    const files = Array.isArray(body.files) ? body.files as Array<{ path: string; content: string }> : [];
    for (const file of files) {
      const target = safeJoin(root, file.path);
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, file.content ?? "", "utf8");
    }
    return writeJson(response, 200, envelope("api.projects.uploads", { project_id: project.projectId, file_count: files.length }));
  }
  if (method === "POST" && project?.suffix === "/index") {
    ensureLocalProject(project.projectId);
    return writeJson(response, 200, await client.index());
  }
  if (method === "GET" && url.pathname.startsWith("/v1/jobs/")) {
    const jobId = decodeURIComponent(url.pathname.split("/").pop() ?? "local");
    return writeJson(response, 200, envelope("api.jobs.get", { job_id: jobId, status: "complete" }));
  }
  if (method === "GET" && project?.suffix === "/graph-view") {
    ensureLocalProject(project.projectId);
    return writeJson(response, 200, await client.getGraphView((url.searchParams.get("preset") as any) ?? "full"));
  }
  if (method === "POST" && project?.suffix === "/query") {
    ensureLocalProject(project.projectId);
    const body = await readJson(request);
    return writeJson(response, 200, await client.query(String(body.query ?? ""), { limit: Number(body.limit ?? 10) }));
  }
  if (method === "GET" && project?.suffix.startsWith("/nodes/") && project.suffix.endsWith("/source-trace")) {
    ensureLocalProject(project.projectId);
    const nodeId = decodeURIComponent(project.suffix.slice("/nodes/".length, -"/source-trace".length));
    const graph = await client.getGraphView((url.searchParams.get("preset") as any) ?? "full") as AxiEnvelope<GraphView>;
    return writeJson(response, 200, envelope("api.projects.nodes.source_trace", {
      node_id: nodeId,
      evidence: graph.data.evidence.filter((item) => item.node_id === nodeId),
    }));
  }
  if (method === "GET" && project?.suffix.startsWith("/nodes/")) {
    ensureLocalProject(project.projectId);
    return writeJson(response, 200, await client.fetchNode(decodeURIComponent(project.suffix.slice("/nodes/".length))));
  }
  if (method === "GET" && project?.suffix === "/paths/explain") {
    ensureLocalProject(project.projectId);
    return writeJson(response, 200, await client.explainPath(url.searchParams.get("from") ?? "", url.searchParams.get("to") ?? ""));
  }
  if (method === "GET" && project?.suffix === "/exports/html") {
    ensureLocalProject(project.projectId);
    const graph = await client.getGraphView("full") as AxiEnvelope<GraphView>;
    response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    response.end(renderGraphHtml(graph.data));
    return;
  }
  if (method === "GET" && project?.suffix === "/events") {
    ensureLocalProject(project.projectId);
    response.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache", connection: "keep-alive" });
    response.write(`data: ${JSON.stringify({ type: "graph.ready", project_id: project.projectId })}\n\n`);
    response.end();
    return;
  }
  writeJson(response, 404, envelope("api.not_found", { path: url.pathname }));
}

function projectRoute(pathname: string): { projectId: string; suffix: string } | null {
  const match = /^\/v1\/projects\/([^/]+)(\/.*)?$/.exec(pathname);
  if (!match) return null;
  return { projectId: decodeURIComponent(match[1]), suffix: match[2] ?? "" };
}

function ensureLocalProject(projectId: string): void {
  if (projectId !== "local") throw new Error(`unknown project_id for local API: ${projectId}`);
}

async function readJson(request: IncomingMessage): Promise<any> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(Buffer.from(chunk));
  const text = Buffer.concat(chunks).toString("utf8");
  return text ? JSON.parse(text) : {};
}

function writeJson(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "access-control-allow-origin": "http://localhost",
  });
  response.end(JSON.stringify(body));
}

function envelope<T>(command: string, data: T): AxiEnvelope<T> {
  return {
    ok: true,
    data,
    meta: { version: "0.1.0", command, generated_at: new Date().toISOString(), cursor: null, count: null, budget_tokens: null },
    links: [],
    error: null,
  };
}

function safeJoin(base: string, filePath: string): string {
  const normalizedBase = normalize(base);
  const target = normalize(join(base, filePath));
  if (filePath.split(/[\\/]+/).includes(".cumulus")) {
    throw new Error(`unsafe upload path: ${filePath}`);
  }
  if (target !== normalizedBase && !target.startsWith(`${normalizedBase}${sep}`)) {
    throw new Error(`unsafe upload path: ${filePath}`);
  }
  return target;
}

function validateOrigin(request: IncomingMessage): boolean {
  const origin = request.headers.origin;
  if (!origin) return true;
  return origin.startsWith("http://localhost")
    || origin.startsWith("http://127.0.0.1")
    || origin.startsWith("http://[::1]");
}
