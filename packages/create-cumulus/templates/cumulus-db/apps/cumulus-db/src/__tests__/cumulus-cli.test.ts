// SPDX-License-Identifier: AGPL-3.0-only
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { runCumulusCli } from '../cumulus-cli.js';

interface FetchCall {
  url: URL;
  init?: RequestInit;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function headerValue(init: RequestInit | undefined, name: string): string | undefined {
  const headers = init?.headers as Record<string, string> | undefined;
  return headers?.[name];
}

describe('Cumulus CLI', () => {
  it('starts and polls the OAuth device login flow', async () => {
    const calls: FetchCall[] = [];
    const fetchMock: typeof fetch = async (input, init) => {
      const url = new URL(String(input));
      calls.push({ url, init });
      if (url.pathname === '/oauth/device_authorization') {
        return jsonResponse({ device_code: 'dev_123', user_code: 'ABCD-EFGH' });
      }
      return jsonResponse({ access_token: 'cu_ses_v1_public_secret' });
    };

    let stdout = '';
    const start = await runCumulusCli(['login', '--url', 'http://db.test', '--db-id', 'db_1', '--scope', 'openid email system:read'], {
      fetch: fetchMock,
      stdout: (text) => {
        stdout += text;
      },
    });
    expect(start).toBe(0);
    expect(JSON.parse(stdout)).toMatchObject({ device_code: 'dev_123' });
    expect(calls[0]?.url.pathname).toBe('/oauth/device_authorization');

    stdout = '';
    const poll = await runCumulusCli(['login', '--url', 'http://db.test', '--device-code', 'dev_123'], {
      fetch: fetchMock,
      stdout: (text) => {
        stdout += text;
      },
    });
    expect(poll).toBe(0);
    expect(JSON.parse(stdout)).toMatchObject({ access_token: 'cu_ses_v1_public_secret' });
    expect(String(calls[1]?.init?.body)).toContain('device_code=dev_123');
  });

  it('plans schema changes over HTTP using only the bearer token', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'cumulus-cli-'));
    await writeFile(join(dir, 'schema.nimbus'), 'namespace acme { collection notes { fields: { id: { type: "ulid" } } } }');
    const calls: FetchCall[] = [];
    const fetchMock: typeof fetch = async (input, init) => {
      const url = new URL(String(input));
      calls.push({ url, init });
      return jsonResponse({ plan: { id: 'plan_1', riskLevel: 'low' } });
    };

    let stdout = '';
    const code = await runCumulusCli(['db', 'plan', '--url', 'http://db.test', '--db-id', 'db_1', '--token', 'cu_pat_v1_x_y', '--file', 'schema.nimbus'], {
      cwd: dir,
      fetch: fetchMock,
      stdout: (text) => {
        stdout += text;
      },
    });

    expect(code).toBe(0);
    expect(JSON.parse(stdout)).toMatchObject({ plan: { id: 'plan_1' } });
    expect(calls[0]?.url.pathname).toBe('/v1/system/schema/plan');
    expect(headerValue(calls[0]?.init, 'Authorization')).toBe('Bearer cu_pat_v1_x_y');
    expect(headerValue(calls[0]?.init, 'X-Cumulus-Admin-Key')).toBeUndefined();
    expect(String(calls[0]?.init?.body)).toContain('namespace acme');
  });

  it('lists and updates grants through the public system API', async () => {
    const calls: FetchCall[] = [];
    const fetchMock: typeof fetch = async (input, init) => {
      const url = new URL(String(input));
      calls.push({ url, init });
      if (url.pathname === '/v1/system/grants' && init?.method === 'GET') {
        return jsonResponse({ principals: [{ id: 'agt_1', grants: ['system:read'] }] });
      }
      if (url.pathname === '/v1/system/grants') {
        return jsonResponse({ principal: { id: 'agt_1', grants: ['system:read'] } });
      }
      return jsonResponse({});
    };

    const listed = await runCumulusCli(
      [
        'system',
        'grants',
        'ls',
        '--url',
        'http://db.test',
        '--db-id',
        'db_1',
        '--token',
        'cu_pat_v1_x_y',
        '--principal-id',
        'agt_1',
      ],
      { fetch: fetchMock, stdout: () => undefined },
    );
    expect(listed).toBe(0);

    const updated = await runCumulusCli(
      [
        'system',
        'grants',
        'set',
        '--url',
        'http://db.test',
        '--db-id',
        'db_1',
        '--token',
        'cu_pat_v1_x_y',
        '--principal-id',
        'agt_1',
        '--grant',
        'system:read',
      ],
      { fetch: fetchMock, stdout: () => undefined },
    );
    expect(updated).toBe(0);

    expect(calls.map((call) => `${call.init?.method ?? 'GET'} ${call.url.pathname}`)).toEqual([
      'GET /v1/system/grants',
      'POST /v1/system/grants',
    ]);
    expect(calls[0]?.url.searchParams.get('dbId')).toBe('db_1');
    expect(calls[0]?.url.searchParams.get('principalId')).toBe('agt_1');
    expect(headerValue(calls[0]?.init, 'Authorization')).toBe('Bearer cu_pat_v1_x_y');
    expect(headerValue(calls[1]?.init, 'Authorization')).toBe('Bearer cu_pat_v1_x_y');
  });

  it('bootstraps agents through the admin system API', async () => {
    const calls: FetchCall[] = [];
    const fetchMock: typeof fetch = async (input, init) => {
      const url = new URL(String(input));
      calls.push({ url, init });
      return jsonResponse({ databaseId: 'db_1', agentId: 'agt_2' }, 201);
    };

    const init = await runCumulusCli(['agent', 'init', '--url', 'http://db.test', '--admin-key', 'admin-secret', '--display-name', 'builder'], {
      fetch: fetchMock,
      stdout: () => undefined,
    });
    expect(init).toBe(0);

    expect(calls.map((call) => call.url.pathname)).toEqual(['/v1/system/agents/bootstrap']);
    expect(headerValue(calls[0]?.init, 'X-Cumulus-Admin-Key')).toBe('admin-secret');
  });

  it('requests schema approvals over the system API', async () => {
    const calls: FetchCall[] = [];
    const fetchMock: typeof fetch = async (input, init) => {
      const url = new URL(String(input));
      calls.push({ url, init });
      return jsonResponse({ approval: { approvalToken: 'apv_secret' } }, 201);
    };

    const code = await runCumulusCli(
      ['db', 'approve', '--url', 'http://db.test', '--db-id', 'db_1', '--token', 'cu_pat_v1_x_y', '--plan-id', 'plan_1'],
      { fetch: fetchMock, stdout: () => undefined },
    );

    expect(code).toBe(0);
    expect(calls[0]?.url.pathname).toBe('/v1/system/schema/approvals');
    expect(headerValue(calls[0]?.init, 'Authorization')).toBe('Bearer cu_pat_v1_x_y');
    expect(String(calls[0]?.init?.body)).toContain('"planId":"plan_1"');
  });

  it('rotates tokens through the database token route', async () => {
    const calls: FetchCall[] = [];
    const fetchMock: typeof fetch = async (input, init) => {
      const url = new URL(String(input));
      calls.push({ url, init });
      return jsonResponse({ token: { id: 'tok_new' } });
    };

    const code = await runCumulusCli(
      ['tokens', 'rotate', '--url', 'http://db.test', '--db-id', 'db_1', '--token', 'cu_pat_v1_x_y', '--token-id', 'tok_old'],
      { fetch: fetchMock, stdout: () => undefined },
    );

    expect(code).toBe(0);
    expect(calls[0]?.url.pathname).toBe('/v1/databases/db_1/tokens/tok_old/rotate');
  });
});
