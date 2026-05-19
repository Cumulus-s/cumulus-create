import { spawn } from "node:child_process";
import {
  createEventEmitter,
  hashString,
  type EventEmitterOptions,
} from "@cmls/events";

export type JsonValue =
  | null
  | boolean
  | number
  | string
  | JsonValue[]
  | { [key: string]: JsonValue };

export interface AxiMeta {
  version: string;
  command: string;
  generated_at: string;
  cursor?: string | null;
  count?: number | null;
  budget_tokens?: number | null;
}

export interface AxiEnvelope<T> {
  ok: boolean;
  data: T;
  meta: AxiMeta;
  links: Array<{ rel: string; uri: string; title?: string | null }>;
  error?: { code: string; message: string } | null;
}

export interface Node {
  id: string;
  kind: string;
  label: string;
  uri: string;
  source_id?: string | null;
  summary?: string | null;
  metadata: Record<string, JsonValue>;
  created_at: string;
  updated_at: string;
}

export interface Edge {
  id: string;
  kind: string;
  from_id: string;
  to_id: string;
  label?: string | null;
  metadata: Record<string, JsonValue>;
  created_at: string;
}

export interface Chunk {
  id: string;
  source_id: string;
  node_id: string;
  text: string;
  start_line: number;
  end_line: number;
  token_estimate: number;
  metadata: Record<string, JsonValue>;
}

export interface Citation {
  id: string;
  source_id: string;
  chunk_id?: string | null;
  uri: string;
  title?: string | null;
  start_line?: number | null;
  end_line?: number | null;
  metadata: Record<string, JsonValue>;
}

export interface Embedding {
  id: string;
  owner_id: string;
  model: string;
  dimensions: number;
  vector_ref: string;
  metadata: Record<string, JsonValue>;
}

export interface SearchHit {
  node: Node;
  chunk_id?: string | null;
  score: number;
  snippet: string;
  resource_uri: string;
}

export interface IndexStats {
  root_path: string;
  database_path: string;
  source_count: number;
  node_count: number;
  edge_count: number;
  chunk_count: number;
}

export interface IndexReport {
  manifest: Record<string, JsonValue>;
  stats: IndexStats;
  skipped: string[];
}

export interface GraphExpansion {
  root_id: string;
  depth: number;
  nodes: Node[];
  edges: Edge[];
}

export interface PathExplanation {
  from_id: string;
  to_id: string;
  nodes: Node[];
  edges: Edge[];
}

export interface GraphView {
  id: string;
  preset: string;
  generated_at: string;
  summary: string;
  nodes: GraphViewNode[];
  edges: GraphViewEdge[];
  evidence: GraphViewEvidence[];
  legend: GraphLegend;
  layout: GraphLayout;
  filters: GraphFilters;
}

export interface GraphViewNode {
  id: string;
  uri: string;
  display_label: string;
  display_subtitle?: string | null;
  display_kind: string;
  domain_kind: string;
  importance: number;
  confidence: number;
  source_count: number;
  evidence_count: number;
  metadata: Record<string, JsonValue>;
}

export interface GraphViewEdge {
  id: string;
  from_id: string;
  to_id: string;
  label: string;
  kind: string;
  confidence: number;
  metadata: Record<string, JsonValue>;
}

export interface GraphViewEvidence {
  id: string;
  node_id: string;
  source_id?: string | null;
  chunk_id?: string | null;
  uri: string;
  label: string;
  excerpt?: string | null;
  metadata: Record<string, JsonValue>;
}

export interface GraphLegend {
  node_kinds: LegendEntry[];
  edge_kinds: LegendEntry[];
}

export interface LegendEntry {
  kind: string;
  label: string;
  color: string;
  icon: string;
  count: number;
  visible: boolean;
}

export interface GraphLayout {
  preset: string;
  nodes: Array<{ id: string; x: number; y: number; lane: string; cluster?: string | null }>;
  lanes: string[];
}

export interface GraphFilters {
  visible_node_kinds: string[];
  visible_edge_kinds: string[];
  include_evidence: boolean;
}

export interface CumulusKnowledgeOptions {
  root?: string;
  bin?: string;
  apiBaseUrl?: string;
  projectId?: string;
  events?: Partial<Pick<EventEmitterOptions, "ledgerPath" | "tenantId" | "projectId" | "installationId" | "localProjectRoot" | "onEvent" | "onError">>;
}

export interface IndexOptions {
  profile?: "code" | "docs" | "facility" | "all";
  watch?: boolean;
}

export interface QueryOptions {
  budget?: number;
  limit?: number;
  projectId?: string;
}

export class CumulusKnowledge {
  readonly root: string;
  readonly bin: string;
  readonly apiBaseUrl?: string;
  readonly projectId: string;
  private readonly events?: ReturnType<typeof createEventEmitter>;

  constructor(options: CumulusKnowledgeOptions = {}) {
    this.root = options.root ?? ".";
    this.bin = options.bin ?? process.env.CUMULUS_BIN ?? "cmls-knowledge";
    this.apiBaseUrl = options.apiBaseUrl ?? process.env.CUMULUS_API_URL;
    this.projectId = options.projectId ?? process.env.CUMULUS_PROJECT_ID ?? "local";
    this.events = options.events
      ? createEventEmitter({
          sourcePackage: "@cmls/knowledge",
          surface: "sdk",
          subsystem: "knowledge",
          projectId: options.events.projectId ?? this.projectId,
          localProjectRoot: options.events.localProjectRoot ?? this.root,
          ...options.events,
        })
      : undefined;
  }

  init(root = this.root): Promise<AxiEnvelope<IndexStats>> {
    return this.run(["knowledge", "init", root]);
  }

  index(options: IndexOptions = {}, root = this.root): Promise<AxiEnvelope<IndexReport>> {
    const args = ["knowledge", "index", root, "--profile", options.profile ?? "all"];
    if (options.watch) args.push("--watch");
    return this.run(args);
  }

  query(text: string, options: QueryOptions = {}): Promise<AxiEnvelope<SearchHit[]>> {
    if (this.apiBaseUrl) {
      return this.request(this.projectPath(options.projectId ?? this.projectId, "/query"), {
        method: "POST",
        body: JSON.stringify({ query: text, limit: options.limit ?? 10, budget: options.budget ?? 1200 }),
      }, {
        operation: "retrieve",
        metadata: {
          query_hash: hashString(text),
          limit: options.limit ?? 10,
          budget: options.budget ?? 1200,
        },
      });
    }
    return this.run([
      "knowledge",
      "query",
      text,
      "--path",
      this.root,
      "--budget",
      String(options.budget ?? 1200),
      "--limit",
      String(options.limit ?? 10),
    ], {
      operation: "retrieve",
      metadata: {
        query_hash: hashString(text),
        limit: options.limit ?? 10,
        budget: options.budget ?? 1200,
      },
    });
  }

  getNode(id: string): Promise<AxiEnvelope<Node>> {
    if (this.apiBaseUrl) return this.fetchNode(id);
    return this.run(["knowledge", "node", "get", id, "--path", this.root]);
  }

  expandNeighbors(id: string, depth = 1): Promise<AxiEnvelope<GraphExpansion>> {
    return this.run(["knowledge", "graph", "expand", id, "--path", this.root, "--depth", String(depth)]);
  }

  findPaths(fromId: string, toId: string, maxDepth = 6): Promise<AxiEnvelope<PathExplanation | null>> {
    if (this.apiBaseUrl) return this.explainPath(fromId, toId);
    return this.run([
      "knowledge",
      "path",
      "explain",
      fromId,
      toId,
      "--path",
      this.root,
      "--max-depth",
      String(maxDepth),
    ]);
  }

  indexStatus(): Promise<AxiEnvelope<Record<string, JsonValue>>> {
    return this.run(["knowledge", "doctor", "--path", this.root]);
  }

  getGraphView(
    preset: "source" | "finance" | "timeline" | "risk" | "full" = "full",
    projectId = this.projectId,
  ): Promise<AxiEnvelope<GraphView>> {
    if (this.apiBaseUrl) {
      return this.request(`${this.projectPath(projectId, "/graph-view")}?preset=${encodeURIComponent(preset)}`);
    }
    return this.run(["knowledge", "graph", "view", "--path", this.root, "--preset", preset]);
  }

  createProject(input: Record<string, JsonValue> = {}): Promise<AxiEnvelope<Record<string, JsonValue>>> {
    return this.request("/v1/projects", { method: "POST", body: JSON.stringify(input) });
  }

  uploadFolder(files: Array<{ path: string; content: string }>, projectId = this.projectId): Promise<AxiEnvelope<Record<string, JsonValue>>> {
    return this.request(this.projectPath(projectId, "/uploads"), {
      method: "POST",
      body: JSON.stringify({ files }),
    });
  }

  indexProject(projectId = this.projectId): Promise<AxiEnvelope<IndexReport>> {
    return this.request(`/v1/projects/${encodeURIComponent(projectId)}/index`, { method: "POST", body: "{}" });
  }

  getJob(jobId = "local"): Promise<AxiEnvelope<Record<string, JsonValue>>> {
    return this.request(`/v1/jobs/${encodeURIComponent(jobId)}`);
  }

  fetchNode(id: string, projectId = this.projectId): Promise<AxiEnvelope<Node>> {
    if (this.apiBaseUrl) return this.request(this.projectPath(projectId, `/nodes/${encodeURIComponent(id)}`));
    return this.getNode(id);
  }

  explainPath(fromId: string, toId: string, projectId = this.projectId): Promise<AxiEnvelope<PathExplanation | null>> {
    if (this.apiBaseUrl) {
      return this.request(`${this.projectPath(projectId, "/paths/explain")}?from=${encodeURIComponent(fromId)}&to=${encodeURIComponent(toId)}`);
    }
    return this.findPaths(fromId, toId);
  }

  sourceTrace(id: string, preset: "source" | "finance" | "timeline" | "risk" | "full" = "full", projectId = this.projectId): Promise<AxiEnvelope<{ node_id: string; evidence: GraphViewEvidence[] }>> {
    if (this.apiBaseUrl) {
      return this.request(`${this.projectPath(projectId, `/nodes/${encodeURIComponent(id)}/source-trace`)}?preset=${encodeURIComponent(preset)}`);
    }
    return this.getGraphView(preset).then((view) => ({
      ...view,
      data: {
        node_id: id,
        evidence: view.data.evidence.filter((item) => item.node_id === id),
      },
    }));
  }

  async exportHtml(projectId = this.projectId): Promise<string> {
    if (!this.apiBaseUrl) throw new Error("apiBaseUrl is required for exportHtml");
    return this.requestText(this.projectPath(projectId, "/exports/html"));
  }

  streamGraphUpdates(onEvent: (event: MessageEvent) => void, projectId = this.projectId): EventSource {
    if (!this.apiBaseUrl) throw new Error("apiBaseUrl is required for streamGraphUpdates");
    const source = new EventSource(new URL(this.projectPath(projectId, "/events"), this.apiBaseUrl).toString());
    source.onmessage = onEvent;
    return source;
  }

  private run<T>(
    args: string[],
    event?: { operation: string; metadata?: Record<string, string | number | boolean | null> },
  ): Promise<AxiEnvelope<T>> {
    const started = Date.now();
    return new Promise((resolve, reject) => {
      const child = spawn(this.bin, [...args, "--format", "json"], {
        stdio: ["ignore", "pipe", "pipe"],
      });
      let stdout = "";
      let stderr = "";
      child.stdout.setEncoding("utf8");
      child.stderr.setEncoding("utf8");
      child.stdout.on("data", (chunk) => {
        stdout += chunk;
      });
      child.stderr.on("data", (chunk) => {
        stderr += chunk;
      });
      child.on("error", reject);
      child.on("close", (code) => {
        if (code !== 0) {
          void this.emitKnowledgeEvent(event, "error", Date.now() - started, undefined, new Error(stderr.trim() || `cumulus exited with code ${code}`));
          reject(new Error(stderr.trim() || `cumulus exited with code ${code}`));
          return;
        }
        try {
          const parsed = JSON.parse(stdout) as AxiEnvelope<T>;
          void this.emitKnowledgeEvent(event, "ok", Date.now() - started, parsed);
          resolve(parsed);
        } catch (error) {
          void this.emitKnowledgeEvent(event, "error", Date.now() - started, undefined, error);
          reject(error);
        }
      });
    });
  }

  private async request<T>(
    path: string,
    init: RequestInit = {},
    event?: { operation: string; metadata?: Record<string, string | number | boolean | null> },
  ): Promise<AxiEnvelope<T>> {
    if (!this.apiBaseUrl) throw new Error("apiBaseUrl is required for API calls");
    const started = Date.now();
    let emitted = false;
    try {
      const response = await fetch(new URL(path, this.apiBaseUrl), {
        ...init,
        headers: {
          "content-type": "application/json",
          ...(init.headers ?? {}),
        },
      });
      if (!response.ok) {
        const error = new Error(`Cumulus API ${response.status}: ${await response.text()}`);
        await this.emitKnowledgeEvent(event, "error", Date.now() - started, undefined, error, response.status);
        emitted = true;
        throw error;
      }
      const parsed = (await response.json()) as AxiEnvelope<T>;
      await this.emitKnowledgeEvent(event, "ok", Date.now() - started, parsed, undefined, response.status);
      emitted = true;
      return parsed;
    } catch (error) {
      if (!emitted) {
        await this.emitKnowledgeEvent(event, "error", Date.now() - started, undefined, error);
      }
      throw error;
    }
  }

  private async requestText(path: string, init: RequestInit = {}): Promise<string> {
    if (!this.apiBaseUrl) throw new Error("apiBaseUrl is required for API calls");
    const response = await fetch(new URL(path, this.apiBaseUrl), init);
    if (!response.ok) throw new Error(`Cumulus API ${response.status}: ${await response.text()}`);
    return response.text();
  }

  private projectPath(projectId: string, suffix: string): string {
    return `/v1/projects/${encodeURIComponent(projectId)}${suffix}`;
  }

  private async emitKnowledgeEvent<T>(
    event: { operation: string; metadata?: Record<string, string | number | boolean | null> } | undefined,
    status: "ok" | "error",
    durationMs: number,
    envelope?: AxiEnvelope<T>,
    error?: unknown,
    statusCode?: number,
  ) {
    if (!this.events || !event) return;
    const data = envelope?.data;
    const retrievedChunks = Array.isArray(data) ? data.length : null;
    await this.events.emit({
      operation: event.operation,
      status,
      durationMs,
      http: statusCode ? { statusCode } : undefined,
      refs: {
        knowledgeBaseRef: this.projectId,
      },
      privacy: { class: "creator_safe_metadata", redacted: false },
      metadata: {
        ...(event.metadata ?? {}),
        retrieved_chunks: retrievedChunks,
        error_class: error instanceof Error ? error.name : error ? "Error" : null,
      },
    });
  }
}
