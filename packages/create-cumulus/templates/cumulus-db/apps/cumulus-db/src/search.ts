// SPDX-License-Identifier: AGPL-3.0-only
import type { StoredRecord } from './types.js';

interface SearchInput {
  query?: string;
  vector?: number[];
  type?: string;
  limit?: number;
}

export interface StoredSearchHit {
  record: StoredRecord;
  score: number;
  lexicalScore: number;
  vectorScore: number;
}

const WORD_RE = /[a-z0-9_:-]+/gi;

function tokens(value: string): string[] {
  return value.toLowerCase().match(WORD_RE) ?? [];
}

function recordText(record: StoredRecord): string {
  return [
    record.type,
    record.key,
    record.title,
    record.content,
    JSON.stringify(record.json ?? {}),
    record.tags.join(' '),
    JSON.stringify(record.metadata ?? {}),
  ]
    .filter(Boolean)
    .join(' ');
}

function lexicalScore(query: string | undefined, record: StoredRecord): number {
  if (!query?.trim()) return 0;
  const queryTokens = tokens(query);
  if (queryTokens.length === 0) return 0;
  const haystack = tokens(recordText(record));
  if (haystack.length === 0) return 0;
  const counts = new Map<string, number>();
  for (const token of haystack) counts.set(token, (counts.get(token) ?? 0) + 1);
  let score = 0;
  for (const token of queryTokens) {
    const exact = counts.get(token) ?? 0;
    if (exact > 0) score += 2 + Math.log1p(exact);
    for (const [candidate, count] of counts) {
      if (candidate !== token && candidate.includes(token)) {
        score += Math.min(1, count * 0.15);
      }
    }
  }
  return score;
}

function cosine(a: number[] | undefined, b: number[] | undefined): number {
  if (!a || !b || a.length !== b.length) return 0;
  let dot = 0;
  let aNorm = 0;
  let bNorm = 0;
  for (let i = 0; i < a.length; i += 1) {
    dot += a[i] * b[i];
    aNorm += a[i] ** 2;
    bNorm += b[i] ** 2;
  }
  if (aNorm === 0 || bNorm === 0) return 0;
  return dot / (Math.sqrt(aNorm) * Math.sqrt(bNorm));
}

export function searchRecords(records: StoredRecord[], input: SearchInput): StoredSearchHit[] {
  const limit = Math.min(Math.max(input.limit ?? 20, 1), 100);
  return records
    .filter((record) => !input.type || record.type === input.type)
    .map((record) => {
      const lex = lexicalScore(input.query, record);
      const vec = cosine(input.vector, record.vector);
      const score = lex + (vec > 0 ? vec * 3 : 0);
      return { record, lexicalScore: lex, vectorScore: vec, score };
    })
    .filter((hit) => hit.score > 0 || (!input.query && !input.vector))
    .sort((a, b) => b.score - a.score || b.record.updatedAt.localeCompare(a.record.updatedAt))
    .slice(0, limit);
}

export async function embedTextIfConfigured(
  text: string,
  config: { baseUrl: string | null; apiKey: string | null; model: string | null },
): Promise<number[] | undefined> {
  if (!config.baseUrl || !config.model || !text.trim()) return undefined;
  const url = `${config.baseUrl.replace(/\/$/, '')}/embeddings`;
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(config.apiKey ? { Authorization: `Bearer ${config.apiKey}` } : {}),
    },
    body: JSON.stringify({ model: config.model, input: text }),
  });
  if (!response.ok) {
    throw new Error(`embedding provider returned ${response.status}`);
  }
  const payload = (await response.json()) as { data?: Array<{ embedding?: number[] }> };
  const vector = payload.data?.[0]?.embedding;
  if (!Array.isArray(vector)) return undefined;
  return vector.map(Number);
}
