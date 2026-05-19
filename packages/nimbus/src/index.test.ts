import { describe, expect, it } from "vitest";
import { canonicalJson, stableHash, NIMBUS_LAYOUT } from "./index.js";

describe("@cmls/nimbus", () => {
  it("defines the standard local project layout", () => {
    expect(NIMBUS_LAYOUT.root).toBe("nimbus/schema.nimbus");
    expect(NIMBUS_LAYOUT.compiled).toBe(".cumulus/compiled");
  });

  it("hashes canonical JSON deterministically", () => {
    const a = { b: 1, a: { d: 2, c: 3 } };
    const b = { a: { c: 3, d: 2 }, b: 1 };
    expect(canonicalJson(a)).toBe('{"a":{"c":3,"d":2},"b":1}');
    expect(stableHash(a)).toBe(stableHash(b));
  });
});

