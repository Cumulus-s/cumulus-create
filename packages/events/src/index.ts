import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, appendFile } from "node:fs/promises";
import { dirname, join } from "node:path";

export type PrivacyClass =
  | "public"
  | "tenant_visible"
  | "creator_safe_metadata"
  | "local_only"
  | "secret_never_store";

export type SourcePackage =
  | "@cls/altocumulus"
  | "@cls/auth"
  | "@cls/db"
  | "@cls/nimbus"
  | "@cls/sdk"
  | "@cls/knowledge"
  | "@cls/mcp"
  | "@cls/server"
  | "@cls/events"
  | "@cls/cloud"
  | "@cls/cli"
  | "@cls/track"
  | "@cls/create";

export type EventSurface = "tui" | "cli" | "sdk" | "api" | "mcp" | "scanner" | "cloud";
export type EventSubsystem =
  | "auth"
  | "db"
  | "knowledge"
  | "billing"
  | "package"
  | "agent"
  | "scanner";
export type EventStatus = "ok" | "error" | "skipped" | "redacted";
export type MetadataValue = string | number | boolean | null;
export type EventMetadata = Record<string, MetadataValue>;

export interface CumulusEvent {
  id: string;
  ts: string;

  tenantId?: string;
  projectId?: string;
  installationId?: string;
  localProjectRoot?: string;

  sourcePackage: SourcePackage;
  surface: EventSurface;
  subsystem: EventSubsystem;

  operation: string;
  status: EventStatus;
  durationMs?: number;

  agent?: {
    id?: string;
    name?: string;
  };

  http?: {
    method?: string;
    route?: string;
    statusCode?: number;
  };

  mcp?: {
    toolName?: string;
    resourceUri?: string;
    promptName?: string;
  };

  cost?: {
    model?: string;
    inputTokens?: number;
    outputTokens?: number;
    estimatedUsd?: number;
  };

  refs?: {
    accountRef?: string;
    credentialRef?: string;
    databaseRef?: string;
    recordRef?: string;
    knowledgeBaseRef?: string;
    sourceRef?: string;
  };

  privacy: {
    class: PrivacyClass;
    redacted: boolean;
  };

  metadata?: EventMetadata;
}

export type CumulusEventInput = Omit<CumulusEvent, "id" | "ts"> & {
  id?: string;
  ts?: string;
};

export interface EventEmitterOptions {
  sourcePackage: SourcePackage;
  surface: EventSurface;
  subsystem: EventSubsystem;
  ledgerPath?: string;
  tenantId?: string;
  projectId?: string;
  installationId?: string;
  localProjectRoot?: string;
  onEvent?: (event: CumulusEvent) => void | Promise<void>;
  onError?: (error: Error) => void;
}

export interface ReadEventsResult {
  events: CumulusEvent[];
  malformed: Array<{ line: number; reason: string }>;
}

const SECRET_KEY_PATTERN =
  /(?:token|secret|password|passwd|pwd|private[_-]?key|api[_-]?key|authorization|cookie|credential|connection[_-]?string|database[_-]?url|dsn|refresh)/i;

const SECRET_VALUE_PATTERNS = [
  /\bBearer\s+[A-Za-z0-9._~+/=-]{12,}/i,
  /\bsk-[A-Za-z0-9_-]{12,}/,
  /\bsk-proj-[A-Za-z0-9_-]{12,}/,
  /\bnpm_[A-Za-z0-9]{12,}/,
  /\bpypi-[A-Za-z0-9_-]{12,}/,
  /\bciok[A-Za-z0-9_-]{12,}/,
  /\b[A-Za-z0-9+/]{32,}={0,2}\b/,
];

const VALID_PRIVACY_CLASSES = new Set<PrivacyClass>([
  "public",
  "tenant_visible",
  "creator_safe_metadata",
  "local_only",
  "secret_never_store",
]);

const VALID_SOURCE_PACKAGES = new Set<SourcePackage>([
  "@cls/altocumulus",
  "@cls/auth",
  "@cls/db",
  "@cls/nimbus",
  "@cls/sdk",
  "@cls/knowledge",
  "@cls/mcp",
  "@cls/server",
  "@cls/events",
  "@cls/cloud",
  "@cls/cli",
  "@cls/track",
  "@cls/create",
]);

const VALID_SURFACES = new Set<EventSurface>(["tui", "cli", "sdk", "api", "mcp", "scanner", "cloud"]);
const VALID_SUBSYSTEMS = new Set<EventSubsystem>([
  "auth",
  "db",
  "knowledge",
  "billing",
  "package",
  "agent",
  "scanner",
]);
const VALID_STATUSES = new Set<EventStatus>(["ok", "error", "skipped", "redacted"]);

export function createCumulusEvent(input: CumulusEventInput): CumulusEvent {
  const redacted = redactEvent(input);
  const event: CumulusEvent = {
    ...redacted,
    id: redacted.id ?? randomUUID(),
    ts: redacted.ts ?? new Date().toISOString(),
  };
  validateCumulusEvent(event);
  return event;
}

export function createEventEmitter(options: EventEmitterOptions) {
  return {
    async emit(input: Omit<CumulusEventInput, "sourcePackage" | "surface" | "subsystem">) {
      const event = createCumulusEvent({
        tenantId: options.tenantId,
        projectId: options.projectId,
        installationId: options.installationId,
        localProjectRoot: options.localProjectRoot,
        ...input,
        sourcePackage: options.sourcePackage,
        surface: options.surface,
        subsystem: options.subsystem,
      });
      try {
        if (options.ledgerPath) await appendEvent(options.ledgerPath, event);
        await options.onEvent?.(event);
      } catch (error) {
        options.onError?.(error instanceof Error ? error : new Error(String(error)));
      }
      return event;
    },
  };
}

export async function appendEvent(path: string, input: CumulusEventInput | CumulusEvent): Promise<CumulusEvent> {
  const event =
    typeof input.id === "string" && typeof input.ts === "string"
      ? validateAndReturn(input as CumulusEvent)
      : createCumulusEvent(input);
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  await appendFile(path, `${JSON.stringify(event)}\n`, { mode: 0o600 });
  return event;
}

export async function readEvents(path: string): Promise<ReadEventsResult> {
  let text = "";
  try {
    text = await readFile(path, "utf8");
  } catch {
    return { events: [], malformed: [] };
  }

  const events: CumulusEvent[] = [];
  const malformed: ReadEventsResult["malformed"] = [];
  const lines = text.split(/\r?\n/);
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (!line.trim()) continue;
    try {
      const parsed = JSON.parse(line) as CumulusEvent;
      events.push(validateAndReturn(parsed));
    } catch (error) {
      malformed.push({
        line: index + 1,
        reason: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return { events, malformed };
}

export function validateCumulusEvent(event: CumulusEvent): void {
  if (!event || typeof event !== "object") throw new Error("event must be an object");
  requireString(event.id, "id");
  requireString(event.ts, "ts");
  requireString(event.sourcePackage, "sourcePackage");
  if (!VALID_SOURCE_PACKAGES.has(event.sourcePackage)) throw new Error("invalid sourcePackage");
  if (!VALID_SURFACES.has(event.surface)) throw new Error("invalid surface");
  if (!VALID_SUBSYSTEMS.has(event.subsystem)) throw new Error("invalid subsystem");
  requireString(event.operation, "operation");
  if (!VALID_STATUSES.has(event.status)) throw new Error("invalid status");
  if (!event.privacy || !VALID_PRIVACY_CLASSES.has(event.privacy.class)) {
    throw new Error("invalid privacy class");
  }
  if (typeof event.privacy.redacted !== "boolean") throw new Error("privacy.redacted must be boolean");
  if (event.metadata) {
    for (const [key, value] of Object.entries(event.metadata)) {
      requireString(key, "metadata key");
      if (value !== null && !["string", "number", "boolean"].includes(typeof value)) {
        throw new Error(`metadata.${key} must be string, number, boolean, or null`);
      }
    }
  }
}

export function redactEvent<T extends CumulusEventInput>(input: T): T {
  const metadata = input.metadata ? redactMetadata(input.metadata) : undefined;
  const redacted = Boolean(input.privacy.redacted || metadata?.redacted);
  return {
    ...input,
    privacy: {
      ...input.privacy,
      redacted,
      class: input.privacy.class === "secret_never_store" ? "local_only" : input.privacy.class,
    },
    metadata: metadata?.metadata,
  };
}

export function redactMetadata(input: Record<string, unknown>): { metadata: EventMetadata; redacted: boolean } {
  const metadata: EventMetadata = {};
  let redacted = false;
  for (const [key, rawValue] of Object.entries(input)) {
    const normalizedKey = String(key);
    if (isSecretMetadataKey(normalizedKey)) {
      metadata[normalizedKey] = "[redacted]";
      redacted = true;
      continue;
    }

    if (rawValue === null || typeof rawValue === "boolean" || typeof rawValue === "number") {
      metadata[normalizedKey] = rawValue;
      continue;
    }
    if (typeof rawValue === "string") {
      const value = redactString(rawValue);
      metadata[normalizedKey] = value.value;
      redacted = redacted || value.redacted;
      continue;
    }
    metadata[normalizedKey] = `[${Array.isArray(rawValue) ? "array" : typeof rawValue}]`;
    redacted = true;
  }
  return { metadata, redacted };
}

export function isSyncEligible(
  event: CumulusEvent,
  options: { includeTenantVisible?: boolean } = {},
): boolean {
  if (event.privacy.class === "secret_never_store" || event.privacy.class === "local_only") return false;
  if (event.privacy.class === "tenant_visible" && !options.includeTenantVisible) return false;
  return event.privacy.class === "public" || event.privacy.class === "creator_safe_metadata" || event.privacy.class === "tenant_visible";
}

export function toSyncPayload(events: CumulusEvent[], options: { includeTenantVisible?: boolean } = {}) {
  return {
    version: 1,
    generatedAt: new Date().toISOString(),
    events: events.filter((event) => isSyncEligible(event, options)).map((event) => redactEvent(event)),
  };
}

export function hashString(value: string): string {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

export function defaultProjectLedgerPath(projectStateDir: string): string {
  return join(projectStateDir, "events.jsonl");
}

export function defaultGlobalLedgerPath(globalStateDir: string): string {
  return join(globalStateDir, "events.jsonl");
}

function validateAndReturn(event: CumulusEvent): CumulusEvent {
  validateCumulusEvent(event);
  return redactEvent(event);
}

function redactString(value: string): { value: string; redacted: boolean } {
  if (value.startsWith("sha256:")) {
    return { value, redacted: false };
  }
  if (SECRET_VALUE_PATTERNS.some((pattern) => pattern.test(value))) {
    return { value: "[redacted]", redacted: true };
  }
  return { value, redacted: false };
}

function isSecretMetadataKey(key: string): boolean {
  if (/(?:^|_)(count|hash|ref|fingerprint)$/i.test(key)) return false;
  if (/(?:Count|Hash|Ref|Fingerprint)$/.test(key)) return false;
  return SECRET_KEY_PATTERN.test(key);
}

function requireString(value: unknown, name: string): asserts value is string {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${name} is required`);
}
