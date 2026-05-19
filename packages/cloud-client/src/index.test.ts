import { describe, expect, it } from "vitest";
import { CumulusCloudClient } from "./index.js";
import { createCumulusEvent } from "@cmls/events";

function response(body: unknown, init: ResponseInit = {}) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
    ...init,
  });
}

describe("@cmls/cloud", () => {
  it("uses GET for read-only inventory calls", async () => {
    const calls: Array<{ url: string; method?: string }> = [];
    const client = new CumulusCloudClient({
      baseUrl: "https://cloud.example",
      token: "agt_test",
      fetchImpl: (async (url, init) => {
        calls.push({ url: String(url), method: init?.method });
        return response({ ok: true });
      }) as typeof fetch,
    });

    await client.whoami();
    await client.accounts();
    await client.accountApiKeys("acc_123");
    await client.devOverview();
    await client.products();
    await client.billingCredits();
    await client.auditLog({ limit: 10 });

    expect(calls).toHaveLength(7);
    expect(calls.every((call) => call.method === "GET")).toBe(true);
  });

  it("prepares only sync-eligible safe events", () => {
    const client = new CumulusCloudClient();
    const safe = createCumulusEvent({
      sourcePackage: "@cmls/cloud",
      surface: "cloud",
      subsystem: "agent",
      operation: "prepare",
      status: "ok",
      privacy: { class: "creator_safe_metadata", redacted: false },
    });
    const local = createCumulusEvent({
      ...safe,
      id: undefined,
      ts: undefined,
      privacy: { class: "local_only", redacted: false },
    });

    const payload = client.prepareSafeSyncPayload([safe, local]);

    expect(payload.events).toHaveLength(1);
    expect(payload.events[0].operation).toBe("prepare");
  });

  it("keeps upload disabled in read-only mode", async () => {
    const client = new CumulusCloudClient();

    await expect(client.syncSafeEvents()).rejects.toThrow("disabled");
  });
});
