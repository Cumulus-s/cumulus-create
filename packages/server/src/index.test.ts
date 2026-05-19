import { mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import { readEvents } from "@cls/events";
import { createCumulusServerEvents } from "./index.js";

describe("@cls/server", () => {
  it("records server API metadata without request bodies or credentials", async () => {
    const dir = await mkdtemp(join(tmpdir(), "cumulus-server-"));
    const ledger = join(dir, "events.jsonl");
    const events = createCumulusServerEvents({ ledgerPath: ledger });

    await events.recordApiCall({
      route: "/v1/signups",
      method: "POST",
      statusCode: 202,
      durationMs: 41,
      agentId: "agent_1",
    });

    const read = await readEvents(ledger);

    expect(read.events).toHaveLength(1);
    expect(read.events[0].http?.route).toBe("/v1/signups");
    expect(JSON.stringify(read.events[0])).not.toContain("credential");
  });
});
