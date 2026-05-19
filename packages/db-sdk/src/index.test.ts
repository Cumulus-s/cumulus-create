import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { readEvents } from '@cls/events';
import { CumulusDbClient } from './index.js';

describe('@cls/db event hooks', () => {
  it('emits database operation metadata without writing row bodies or tokens', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'cumulus-db-sdk-'));
    const ledgerPath = join(dir, 'events.jsonl');
    const fetchImpl = async () =>
      new Response(JSON.stringify({ ok: true, id: 'record_private_123' }), { status: 200 });

    const db = new CumulusDbClient({
      baseUrl: 'http://db.local',
      databaseId: 'database_private_123',
      token: 'database_token_should_not_be_logged',
      fetchImpl: fetchImpl as typeof fetch,
      events: { ledgerPath },
    });

    await db.writeRecord({
      type: 'note',
      key: 'record-key-private',
      title: 'Customer title',
      content: 'raw customer row body',
      secretFields: { upstreamToken: 'nested_secret_value' },
    });

    const ledgerText = await readFile(ledgerPath, 'utf8');
    const events = await readEvents(ledgerPath);

    expect(events.events).toHaveLength(1);
    expect(events.events[0].operation).toBe('write_record');
    expect(events.events[0].refs?.databaseRef).toMatch(/^sha256:/);
    expect(events.events[0].http?.route).toBe('/v1/databases/{databaseId}/records');
    expect(events.events[0].metadata?.secret_field_count).toBe(1);
    expect(ledgerText).not.toContain('database_token_should_not_be_logged');
    expect(ledgerText).not.toContain('database_private_123');
    expect(ledgerText).not.toContain('raw customer row body');
    expect(ledgerText).not.toContain('nested_secret_value');
    expect(ledgerText).not.toContain('record-key-private');
  });
});
