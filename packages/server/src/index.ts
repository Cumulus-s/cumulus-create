import {
  createEventEmitter,
  hashString,
  type EventEmitterOptions,
  type MetadataValue,
} from "@cmls/events";

export interface CumulusServerEventsOptions
  extends Partial<Pick<EventEmitterOptions, "ledgerPath" | "tenantId" | "projectId" | "installationId" | "localProjectRoot" | "onEvent" | "onError">> {}

export interface ApiCallInput {
  route: string;
  method?: string;
  statusCode?: number;
  durationMs?: number;
  agentId?: string;
  errorClass?: string;
}

export interface SignupInput {
  provider: string;
  signupId?: string;
  accountRef?: string;
  credentialRef?: string;
  status: "ok" | "error" | "skipped" | "redacted";
  durationMs?: number;
  agentId?: string;
  errorClass?: string;
}

export interface ActionInput {
  actionSlug: string;
  requestId?: string;
  status: "ok" | "error" | "skipped" | "redacted";
  durationMs?: number;
  agentId?: string;
  errorClass?: string;
}

export function createCumulusServerEvents(options: CumulusServerEventsOptions = {}) {
  const emitter = createEventEmitter({
    sourcePackage: "@cmls/server",
    surface: "api",
    subsystem: "agent",
    ...options,
  });

  return {
    recordApiCall(input: ApiCallInput) {
      return emitter.emit({
        operation: "api_call",
        status: input.statusCode && input.statusCode >= 400 ? "error" : "ok",
        durationMs: input.durationMs,
        agent: input.agentId ? { id: input.agentId } : undefined,
        http: {
          method: input.method ?? "GET",
          route: input.route,
          statusCode: input.statusCode,
        },
        privacy: { class: "creator_safe_metadata", redacted: false },
        metadata: compactMetadata({ error_class: input.errorClass ?? null }),
      });
    },
    recordSignup(input: SignupInput) {
      return emitter.emit({
        operation: "signup",
        status: input.status,
        durationMs: input.durationMs,
        agent: input.agentId ? { id: input.agentId } : undefined,
        refs: {
          accountRef: input.accountRef,
          credentialRef: input.credentialRef,
        },
        privacy: { class: "creator_safe_metadata", redacted: false },
        metadata: compactMetadata({
          provider: input.provider,
          signup_ref: input.signupId ? hashString(input.signupId) : null,
          error_class: input.errorClass ?? null,
        }),
      });
    },
    recordAction(input: ActionInput) {
      return emitter.emit({
        operation: "action",
        status: input.status,
        durationMs: input.durationMs,
        agent: input.agentId ? { id: input.agentId } : undefined,
        privacy: { class: "creator_safe_metadata", redacted: false },
        metadata: compactMetadata({
          action_slug: input.actionSlug,
          request_ref: input.requestId ? hashString(input.requestId) : null,
          error_class: input.errorClass ?? null,
        }),
      });
    },
  };
}

function compactMetadata(input: Record<string, MetadataValue | undefined>): Record<string, MetadataValue> {
  return Object.fromEntries(Object.entries(input).filter((entry): entry is [string, MetadataValue] => entry[1] !== undefined));
}
