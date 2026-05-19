import {
  type CumulusEvent,
  toSyncPayload,
  validateCumulusEvent,
} from "@cumulus_cloud/events";

export interface CumulusCloudClientOptions {
  baseUrl?: string;
  token?: string;
  fetchImpl?: typeof fetch;
  tenantId?: string;
}

export interface SafeSyncPayloadOptions {
  includeTenantVisible?: boolean;
}

export class CumulusCloudClient {
  private readonly baseUrl: string;
  private readonly token?: string;
  private readonly fetchImpl: typeof fetch;
  private readonly tenantId?: string;

  constructor(options: CumulusCloudClientOptions = {}) {
    this.baseUrl = (options.baseUrl ?? process.env.CUMULUS_CLOUD_URL ?? "https://relay.cumulush.com").replace(/\/+$/, "");
    this.token = options.token ?? process.env.CUMULUS_AGENT_TOKEN;
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.tenantId = options.tenantId;
  }

  whoami() {
    return this.get("/v1/whoami");
  }

  accounts() {
    return this.get("/v1/accounts");
  }

  accountApiKeys(accountId: string) {
    return this.get(`/v1/accounts/${encodeURIComponent(accountId)}/api-keys`);
  }

  devOverview() {
    return this.get("/v1/dev", { tenant: true });
  }

  products() {
    return this.get("/v1/dev/products", { tenant: true });
  }

  billingCredits() {
    return this.get("/v1/dev/billing/credits", { tenant: true });
  }

  auditLog(query: { limit?: number; offset?: number } = {}) {
    const params = new URLSearchParams();
    if (query.limit !== undefined) params.set("limit", String(query.limit));
    if (query.offset !== undefined) params.set("offset", String(query.offset));
    const suffix = params.size ? `?${params.toString()}` : "";
    return this.get(`/v1/audit-log${suffix}`);
  }

  prepareSafeSyncPayload(events: CumulusEvent[], options: SafeSyncPayloadOptions = {}) {
    for (const event of events) validateCumulusEvent(event);
    return toSyncPayload(events, options);
  }

  async syncSafeEvents(): Promise<never> {
    throw new Error("Cloud event upload is disabled in read-only Altocumulus v3.");
  }

  private async get(path: string, options: { tenant?: boolean } = {}) {
    const headers = new Headers();
    if (this.token) headers.set("authorization", `Bearer ${this.token}`);
    if (options.tenant && this.tenantId) headers.set("x-relay-tenant", this.tenantId);

    const response = await this.fetchImpl(`${this.baseUrl}${path}`, {
      method: "GET",
      headers,
    });
    const text = await response.text();
    const data = parseJson(text);
    if (!response.ok) {
      const message =
        data && typeof data === "object" && "error" in data
          ? String((data as { error: unknown }).error)
          : `${response.status} ${response.statusText}`;
      throw new Error(message);
    }
    return data;
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
