import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { readEvents } from '@cls/events';
import { CumulusKnowledge } from './index.js';

const originalFetch = globalThis.fetch;

describe('@cls/knowledge event hooks', () => {
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('emits retrieval metadata without writing raw queries or snippets', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'cls-knowledge-sdk-'));
    const ledgerPath = join(dir, 'events.jsonl');
    const fetchImpl = vi.fn(async () =>
      new Response(
        JSON.stringify({
          ok: true,
          data: [
            {
              node: {
                id: 'node_1',
                kind: 'doc',
                label: 'Private Source',
                uri: 'docs/private.md',
                metadata: {},
                created_at: '2026-01-01T00:00:00.000Z',
                updated_at: '2026-01-01T00:00:00.000Z',
              },
              score: 0.9,
              snippet: 'raw private knowledge text',
              resource_uri: 'docs/private.md',
            },
          ],
          meta: {
            version: '1',
            command: 'query',
            generated_at: '2026-01-01T00:00:00.000Z',
          },
          links: [],
        }),
        { status: 200 },
      ),
    );
    globalThis.fetch = fetchImpl as unknown as typeof fetch;

    const knowledge = new CumulusKnowledge({
      apiBaseUrl: 'http://knowledge.local',
      projectId: 'kb_docs_main',
      events: { ledgerPath },
    });

    await knowledge.query('private customer question', { limit: 1, budget: 100 });

    const ledgerText = await readFile(ledgerPath, 'utf8');
    const events = await readEvents(ledgerPath);

    expect(events.events).toHaveLength(1);
    expect(events.events[0].operation).toBe('retrieve');
    expect(events.events[0].metadata?.query_hash).toMatch(/^sha256:/);
    expect(events.events[0].metadata?.retrieved_chunks).toBe(1);
    expect(ledgerText).not.toContain('private customer question');
    expect(ledgerText).not.toContain('raw private knowledge text');
    expect(ledgerText).not.toContain('Private Source');
  });
});
