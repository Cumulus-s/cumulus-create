import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import {
  appendEvent,
  createCumulusEvent,
  createEventEmitter,
  hashString,
  isSyncEligible,
  readEvents,
  toSyncPayload,
} from "./index.js";

const base = {
  sourcePackage: "@cmls/events" as const,
  surface: "sdk" as const,
  subsystem: "agent" as const,
  operation: "test",
  status: "ok" as const,
  privacy: { class: "creator_safe_metadata" as const, redacted: false },
};

describe("@cmls/events", () => {
  it("creates valid events with ids and timestamps", () => {
    const event = createCumulusEvent(base);

    expect(event.id).toMatch(/[0-9a-f-]+/);
    expect(event.ts).toMatch(/T/);
    expect(event.privacy.class).toBe("creator_safe_metadata");
  });

  it("redacts secret-like keys and values", () => {
    const event = createCumulusEvent({
      ...base,
      metadata: {
        table: "agent_tasks",
        api_key: "should-not-store",
        tokenish: "Bearer abcdefghijklmnop",
        nested: { raw: "not allowed" },
      },
    });

    expect(event.metadata?.table).toBe("agent_tasks");
    expect(event.metadata?.api_key).toBe("[redacted]");
    expect(event.metadata?.tokenish).toBe("[redacted]");
    expect(event.metadata?.nested).toBe("[object]");
    expect(event.privacy.redacted).toBe(true);
  });

  it("writes append-only JSONL and recovers around malformed lines", async () => {
    const dir = await mkdtemp(join(tmpdir(), "cumulus-events-"));
    const ledger = join(dir, "events.jsonl");

    await appendEvent(ledger, base);
    await writeFile(ledger, `${await readFile(ledger, "utf8")}not-json\n`);
    await appendEvent(ledger, { ...base, operation: "after-malformed" });

    const result = await readEvents(ledger);

    expect(result.events.map((event) => event.operation)).toEqual(["test", "after-malformed"]);
    expect(result.malformed).toHaveLength(1);
  });

  it("rejects unknown source packages at runtime", () => {
    expect(() =>
      createCumulusEvent({
        ...base,
        sourcePackage: "unknown-package" as never,
      }),
    ).toThrow(/invalid sourcePackage/);
  });

  it("creates emitters that write to a ledger without throwing into hot paths", async () => {
    const dir = await mkdtemp(join(tmpdir(), "cumulus-events-"));
    const ledger = join(dir, "events.jsonl");
    const emitter = createEventEmitter({
      sourcePackage: "@cmls/db",
      surface: "sdk",
      subsystem: "db",
      ledgerPath: ledger,
    });

    const event = await emitter.emit({
      operation: "write",
      status: "ok",
      privacy: { class: "creator_safe_metadata", redacted: false },
      metadata: { table: "agent_tasks", row_count: 1 },
    });

    expect(event.sourcePackage).toBe("@cmls/db");
    expect((await readEvents(ledger)).events).toHaveLength(1);
  });

  it("only marks safe privacy classes for default sync", () => {
    const safe = createCumulusEvent(base);
    const tenant = createCumulusEvent({
      ...base,
      privacy: { class: "tenant_visible", redacted: false },
    });
    const local = createCumulusEvent({
      ...base,
      privacy: { class: "local_only", redacted: false },
    });

    expect(isSyncEligible(safe)).toBe(true);
    expect(isSyncEligible(tenant)).toBe(false);
    expect(isSyncEligible(tenant, { includeTenantVisible: true })).toBe(true);
    expect(isSyncEligible(local)).toBe(false);
    expect(toSyncPayload([safe, tenant, local]).events).toHaveLength(1);
  });

  it("hashes private values without returning the original", () => {
    const hashed = hashString("private query");

    expect(hashed).toMatch(/^sha256:/);
    expect(hashed).not.toContain("private query");
  });
});
