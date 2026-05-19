import {
  createEventEmitter,
  hashString,
  type EventEmitterOptions,
} from "@cls/events";

export type CumulusRecordType =
  | "document"
  | "note"
  | "run"
  | "message"
  | "event"
  | "kv"
  | "tool_call"
  | "artifact"
  | "summary"
  | "preference"
  | "secret"
  | "entity"
  | "task"
  | "observation";

export interface CumulusDbClientOptions {
  baseUrl: string;
  databaseId?: string;
  token?: string;
  fetchImpl?: typeof fetch;
  events?: Partial<Pick<EventEmitterOptions, "ledgerPath" | "tenantId" | "projectId" | "installationId" | "localProjectRoot" | "onEvent" | "onError">>;
}

export interface WriteRecordInput {
  type: CumulusRecordType;
  key?: string;
  title?: string;
  content?: string | null;
  json?: unknown;
  tags?: string[];
  vector?: number[];
  metadata?: Record<string, unknown>;
  secretFields?: Record<string, string>;
}

export interface SearchInput {
  query?: string;
  vector?: number[];
  type?: CumulusRecordType;
  limit?: number;
}

export interface ProjectProgressInput {
  title: string;
  content?: string;
  status?: string;
  milestone?: string;
  metadata?: Record<string, unknown>;
}

export class CumulusDbClient {
  private readonly baseUrl: string;
  private readonly databaseId?: string;
  private readonly token?: string;
  private readonly fetchImpl: typeof fetch;
  private readonly events?: ReturnType<typeof createEventEmitter>;

  constructor(options: CumulusDbClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, "");
    this.databaseId = options.databaseId;
    this.token = options.token;
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.events = options.events
      ? createEventEmitter({
          sourcePackage: "@cls/db",
          surface: "sdk",
          subsystem: "db",
          ...options.events,
        })
      : undefined;
  }

  health() {
    return this.request("/health", { auth: false, event: { operation: "health" } });
  }

  listDatabases() {
    return this.request("/v1/databases", { event: { operation: "list_databases" } });
  }

  writeRecord(input: WriteRecordInput, databaseId = this.requireDatabaseId()) {
    return this.request(`/v1/databases/${encodeURIComponent(databaseId)}/records`, {
      method: "POST",
      body: input,
      event: {
        operation: "write_record",
        databaseRef: hashString(databaseId),
        metadata: {
          record_type: input.type,
          key_hash: input.key ? hashString(input.key) : null,
          tag_count: input.tags?.length ?? 0,
          vector_dimensions: input.vector?.length ?? 0,
          secret_field_count: input.secretFields ? Object.keys(input.secretFields).length : 0,
        },
      },
    });
  }

  writeProgress(input: ProjectProgressInput, databaseId = this.requireDatabaseId()) {
    return this.writeRecord(
      {
        type: "event",
        title: input.title,
        content: input.content ?? null,
        tags: ["project-progress", input.status ?? "progress"].filter(Boolean),
        metadata: {
          status: input.status ?? "progress",
          milestone: input.milestone ?? null,
          ...(input.metadata ?? {}),
        },
      },
      databaseId,
    );
  }

  search(input: SearchInput, databaseId = this.requireDatabaseId()) {
    return this.request(`/v1/databases/${encodeURIComponent(databaseId)}/search`, {
      method: "POST",
      body: input,
      event: {
        operation: "search",
        databaseRef: hashString(databaseId),
        metadata: {
          query_hash: input.query ? hashString(input.query) : null,
          has_vector: Boolean(input.vector),
          vector_dimensions: input.vector?.length ?? 0,
          type: input.type ?? null,
          limit: input.limit ?? null,
        },
      },
    });
  }

  putKv(key: string, value: unknown, databaseId = this.requireDatabaseId()) {
    return this.request(
      `/v1/databases/${encodeURIComponent(databaseId)}/kv/${encodeURIComponent(key)}`,
      {
        method: "PUT",
        body: { value },
        event: {
          operation: "put_kv",
          databaseRef: hashString(databaseId),
          metadata: {
            key_hash: hashString(key),
            value_type: value === null ? "null" : Array.isArray(value) ? "array" : typeof value,
          },
        },
      },
    );
  }

  revealSecret(recordId: string, field: string, databaseId = this.requireDatabaseId()) {
    return this.request(`/v1/databases/${encodeURIComponent(databaseId)}/secrets/reveal`, {
      method: "POST",
      body: { recordId, field },
      event: {
        operation: "reveal_secret",
        databaseRef: hashString(databaseId),
        recordRef: hashString(recordId),
        metadata: {
          field_hash: hashString(field),
        },
      },
    });
  }

  private requireDatabaseId(): string {
    if (!this.databaseId) throw new Error("databaseId is required for this operation");
    return this.databaseId;
  }

  private async request(
    path: string,
    options: {
      method?: string;
      body?: unknown;
      auth?: boolean;
      event?: {
        operation: string;
        databaseRef?: string;
        recordRef?: string;
        metadata?: Record<string, string | number | boolean | null>;
      };
    } = {},
  ) {
    const started = Date.now();
    const headers = new Headers();
    if (options.body !== undefined) headers.set("content-type", "application/json");
    if (options.auth !== false) {
      if (!this.token) throw new Error("token is required for this operation");
      headers.set("authorization", `Bearer ${this.token}`);
    }

    let emitted = false;
    try {
      const response = await this.fetchImpl(`${this.baseUrl}${path}`, {
        method: options.method ?? "GET",
        headers,
        body: options.body === undefined ? undefined : JSON.stringify(options.body),
      });
      const text = await response.text();
      const data = parseJson(text);
      await this.emitRequestEvent(path, options, response.status, Date.now() - started);
      emitted = true;
      if (!response.ok) {
        const message =
          data && typeof data === "object" && "error" in data
            ? String((data as { error: unknown }).error)
            : `${response.status} ${response.statusText}`;
        throw new Error(message);
      }
      return data;
    } catch (error) {
      if (!emitted) {
        await this.emitRequestEvent(path, options, undefined, Date.now() - started, error);
      }
      throw error;
    }
  }

  private async emitRequestEvent(
    path: string,
    options: {
      method?: string;
      event?: {
        operation: string;
        databaseRef?: string;
        recordRef?: string;
        metadata?: Record<string, string | number | boolean | null>;
      };
    },
    statusCode: number | undefined,
    durationMs: number,
    error?: unknown,
  ) {
    if (!this.events || !options.event) return;
    await this.events.emit({
      operation: options.event.operation,
      status: error || (statusCode !== undefined && statusCode >= 400) ? "error" : "ok",
      durationMs,
      http: {
        method: options.method ?? "GET",
        route: redactRoute(path),
        statusCode,
      },
      refs: {
        databaseRef: options.event.databaseRef,
        recordRef: options.event.recordRef,
      },
      privacy: { class: "creator_safe_metadata", redacted: false },
      metadata: {
        ...(options.event.metadata ?? {}),
        error_class: error instanceof Error ? error.name : error ? "Error" : null,
      },
    });
  }
}

function parseJson(text: string): unknown {
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function redactRoute(path: string): string {
  return path
    .replace(/\/v1\/databases\/[^/]+/g, "/v1/databases/{databaseId}")
    .replace(/\/kv\/[^/]+/g, "/kv/{key}");
}
