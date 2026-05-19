import { createHmac } from 'node:crypto';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { readEvents } from '@cmls/events';
import { cumulus, relay } from './index.js';

describe('@cmls/auth event hooks', () => {
  it('keeps the relay export as a compatibility alias', () => {
    expect(relay).toBe(cumulus);
  });

  it('emits signup metadata without writing credential values', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'cumulus-auth-sdk-'));
    const ledgerPath = join(dir, 'events.jsonl');
    const secret = 'local-webhook-secret';
    const body = JSON.stringify({
      kind: 'signup',
      signupId: 'signup_private_123',
      email: 'person@example.test',
      input: { name: 'Private Person', plan: 'team' },
      provider_slug: 'demo-provider',
    });

    const handler = cumulus.webhook({
      secret,
      events: { ledgerPath },
      onSignup: async () => ({
        accountId: 'acct_private_123',
        apiKey: 'cmls_live_value_should_not_be_logged',
      }),
    });

    const response = await handler(
      new Request('http://local.test/relay', {
        method: 'POST',
        headers: { 'x-relay-signature': sign(secret, body) },
        body,
      }),
    );

    expect(response.status).toBe(200);
    const ledgerText = await readFile(ledgerPath, 'utf8');
    const events = await readEvents(ledgerPath);

    expect(events.events).toHaveLength(1);
    expect(events.events[0].operation).toBe('signup');
    expect(events.events[0].refs?.accountRef).toMatch(/^sha256:/);
    expect(events.events[0].refs?.credentialRef).toMatch(/^sha256:/);
    expect(ledgerText).not.toContain('cmls_live_value_should_not_be_logged');
    expect(ledgerText).not.toContain('acct_private_123');
    expect(ledgerText).not.toContain('person@example.test');
    expect(ledgerText).not.toContain('Private Person');
  });
});

function sign(secret: string, body: string): string {
  return `sha256=${createHmac('sha256', secret).update(body).digest('hex')}`;
}
