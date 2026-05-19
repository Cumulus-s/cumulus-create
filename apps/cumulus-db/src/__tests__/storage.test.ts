// SPDX-License-Identifier: AGPL-3.0-only
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { CumulusDbEngine } from '../storage.js';

async function engine() {
  const dataDir = await mkdtemp(join(tmpdir(), 'cumulus-db-test-'));
  return new CumulusDbEngine(dataDir, Buffer.alloc(32, 3));
}

describe('CumulusDbEngine', () => {
  it('creates a workspace, writes records, searches, compacts, and backs up', async () => {
    const db = await engine();
    const created = await db.createWorkspace({
      ownerAgentId: 'agent-1',
      humanOwnerEmail: 'owner@example.com',
      relaySignupId: 'signup-1',
    });

    await db.authenticate(created.manifest.id, created.dataToken.token, ['records:write']);
    const record = await db.writeRecord(created.manifest.id, {
      type: 'document',
      title: 'Agent memory',
      content: 'Remember the Cumulus database launch notes.',
      tags: ['launch'],
    });

    const hits = await db.search(created.manifest.id, { query: 'launch notes' });
    expect(hits[0]?.record.id).toBe(record.id);

    const compaction = await db.compact(created.manifest.id);
    expect(compaction.records).toBe(1);

    const backup = await db.backup(created.manifest.id);
    expect(backup.records).toBe(1);
    const backupBody = JSON.parse(await readFile(backup.path, 'utf8')) as {
      crypto?: { ciphertext?: string; wrappedDek?: string };
    };
    expect(backupBody.crypto?.ciphertext).toBeTruthy();
    expect(backupBody.crypto?.wrappedDek).toBeTruthy();
    expect(JSON.stringify(backupBody)).not.toContain('Remember the Cumulus database launch notes.');

    await db.destroyAllForTests();
  });

  it('encrypts flagged secret content and enforces reveal through admin scope', async () => {
    const db = await engine();
    const created = await db.createWorkspace({ ownerAgentId: 'agent-1' });
    const record = await db.writeRecord(created.manifest.id, {
      type: 'secret',
      title: 'OpenAI key',
      content: 'sk-test-abcdefghijklmnopqrstuvwxyz',
      recordIsSecret: true,
      secrets: { OPENAI_API_KEY: 'sk-test-abcdefghijklmnopqrstuvwxyz' },
    });

    expect(record.content).toBe('[secret]');
    expect(record.secret.fields).toEqual(['OPENAI_API_KEY']);

    await expect(
      db.authenticate(created.manifest.id, created.dataToken.token, ['secrets:reveal']),
    ).rejects.toThrow('unauthorized');

    await db.authenticate(created.manifest.id, created.adminToken.token, ['secrets:reveal']);
    const revealed = await db.revealSecret(created.manifest.id, record.id, 'OPENAI_API_KEY');
    expect(revealed.value).toContain('sk-test');

    await db.destroyAllForTests();
  });
});
