import { createHash } from "node:crypto";

export const NIMBUS_LAYOUT = {
  root: "nimbus/schema.nimbus",
  collections: "nimbus/collections",
  policies: "nimbus/policies",
  lockfile: "nimbus.lock.json",
  compiled: ".cumulus/compiled",
  state: ".cumulus/state",
} as const;

export interface NimbusDiagnostic {
  code: string;
  message: string;
  line?: number;
  column?: number;
  severity?: "info" | "warning" | "error";
}

export interface NimbusCompileResult<TIr = unknown> {
  ir: TIr;
  hash: string;
  diagnostics: NimbusDiagnostic[];
}

export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortValue(value));
}

export function stableHash(value: unknown): string {
  return createHash("sha256").update(canonicalJson(value)).digest("hex");
}

function sortValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortValue);
  if (!value || typeof value !== "object") return value;
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(value as Record<string, unknown>).sort()) {
    out[key] = sortValue((value as Record<string, unknown>)[key]);
  }
  return out;
}

