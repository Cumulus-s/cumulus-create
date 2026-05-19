import { describe, expect, it } from "vitest";
import { CumulusSystemClient } from "./index.js";

describe("@cls/sdk", () => {
  it("calls system endpoints with bearer auth", async () => {
    const seen: Record<string, string | null> = {};
    const client = new CumulusSystemClient({
      baseUrl: "https://db.example.test/",
      token: "token",
      fetchImpl: (async (url, init) => {
        seen.url = String(url);
        seen.auth = new Headers(init?.headers).get("authorization");
        return new Response(JSON.stringify({ ok: true }));
      }) as typeof fetch,
    });
    await expect(client.me()).resolves.toEqual({ ok: true });
    expect(seen.url).toBe("https://db.example.test/v1/system/me");
    expect(seen.auth).toBe("Bearer token");
  });
});

