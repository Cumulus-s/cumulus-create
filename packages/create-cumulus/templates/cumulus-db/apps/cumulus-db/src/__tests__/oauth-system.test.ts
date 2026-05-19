// SPDX-License-Identifier: AGPL-3.0-only
import { createHash, randomBytes } from 'node:crypto';
import { createServer } from 'node:http';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { CumulusDbConfig } from '../config.js';
import { createHandler } from '../http.js';
import { CumulusDbEngine } from '../storage.js';

const cleanup: Array<() => Promise<void> | void> = [];

afterEach(async () => {
  for (const fn of cleanup.splice(0)) await fn();
});

async function testServer() {
  const dataDir = await mkdtemp(join(tmpdir(), 'cumulus-db-oauth-'));
  const config: CumulusDbConfig = {
    engine: 'jsonl',
    dataDir,
    publicUrl: 'http://127.0.0.1:4317',
    adminSecret: Buffer.alloc(32, 6).toString('base64'),
    masterKey: Buffer.alloc(32, 6),
    relayWebhookSecret: null,
    publicAgentBootstrapEnabled: false,
    port: 0,
    postgres: { url: null, ssl: false, autoMigrate: false },
    embeddings: { baseUrl: null, apiKey: null, model: null },
  };
  const engine = new CumulusDbEngine(dataDir, config.masterKey);
  const server = createServer(createHandler(engine, config));
  const baseUrl = await new Promise<URL>((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      if (!addr || typeof addr === 'string') throw new Error('invalid address');
      resolve(new URL(`http://127.0.0.1:${addr.port}`));
    });
  });
  cleanup.push(() => new Promise<void>((resolve) => server.close(() => resolve())));
  cleanup.push(() => engine.destroyAllForTests());
  return { baseUrl, engine };
}

function pkcePair() {
  const verifier = randomBytes(32).toString('base64url');
  return {
    verifier,
    challenge: createHash('sha256').update(verifier).digest('base64url'),
  };
}

async function localOAuthSession(input: {
  baseUrl: URL;
  dbId: string;
  email?: string;
  scope: string;
}): Promise<{ accessToken: string; verifier: string; code: string }> {
  const email = input.email ?? 'owner@example.com';
  const pkce = pkcePair();
  const authorize = {
    response_type: 'code',
    client_id: 'local-test-client',
    redirect_uri: 'http://localhost/callback',
    db_id: input.dbId,
    scope: input.scope,
    email,
    code_challenge: pkce.challenge,
    code_challenge_method: 'S256',
    state: 'test-state',
  };

  const start = await fetch(new URL('/oauth/authorize', input.baseUrl), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(authorize),
  });
  expect(start.status).toBe(202);
  const startBody = (await start.json()) as { emailCodeId: string; emailCode: string };

  const finish = await fetch(new URL('/oauth/authorize', input.baseUrl), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      ...authorize,
      email_code_id: startBody.emailCodeId,
      email_code: startBody.emailCode,
    }),
  });
  expect(finish.status).toBe(200);
  const finishBody = (await finish.json()) as { code: string; redirectTo: string };
  expect(finishBody.redirectTo).toContain('state=test-state');

  const token = await fetch(new URL('/oauth/token', input.baseUrl), {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      client_id: authorize.client_id,
      redirect_uri: authorize.redirect_uri,
      code: finishBody.code,
      code_verifier: pkce.verifier,
    }),
  });
  expect(token.status).toBe(200);
  const tokenBody = (await token.json()) as { access_token: string };
  return { accessToken: tokenBody.access_token, verifier: pkce.verifier, code: finishBody.code };
}

describe('OAuth and system policy HTTP API', () => {
  it('serves OIDC discovery and completes auth-code PKCE with userinfo claims', async () => {
    const { baseUrl, engine } = await testServer();
    const created = await engine.createWorkspace({ ownerAgentId: 'agent-1', humanOwnerEmail: 'owner@example.com' });

    const discovery = await fetch(new URL('/.well-known/openid-configuration', baseUrl));
    expect(discovery.status).toBe(200);
    const discoveryBody = (await discovery.json()) as { code_challenge_methods_supported: string[] };
    expect(discoveryBody.code_challenge_methods_supported).toContain('S256');

    const pkce = pkcePair();
    const authorize = {
      response_type: 'code',
      client_id: 'local-test-client',
      redirect_uri: 'http://localhost/callback',
      db_id: created.manifest.id,
      scope: 'openid email system:read org:read',
      email: 'owner@example.com',
      code_challenge: pkce.challenge,
      code_challenge_method: 'S256',
    };
    const start = await fetch(new URL('/oauth/authorize', baseUrl), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(authorize),
    });
    const startBody = (await start.json()) as { emailCodeId: string; emailCode: string };
    const finish = await fetch(new URL('/oauth/authorize', baseUrl), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...authorize,
        email_code_id: startBody.emailCodeId,
        email_code: startBody.emailCode,
      }),
    });
    const finishBody = (await finish.json()) as { code: string };

    const wrongVerifier = await fetch(new URL('/oauth/token', baseUrl), {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        client_id: authorize.client_id,
        redirect_uri: authorize.redirect_uri,
        code: finishBody.code,
        code_verifier: 'wrong-verifier',
      }),
    });
    expect(wrongVerifier.status).toBe(400);
    expect((await wrongVerifier.json()) as { error: string }).toMatchObject({ error: 'invalid_grant' });

    const token = await fetch(new URL('/oauth/token', baseUrl), {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        client_id: authorize.client_id,
        redirect_uri: authorize.redirect_uri,
        code: finishBody.code,
        code_verifier: pkce.verifier,
      }),
    });
    expect(token.status).toBe(200);
    const tokenBody = (await token.json()) as { access_token: string; id_token: string };
    expect(tokenBody.access_token).toMatch(/^cu_ses_v1_/);
    expect(tokenBody.id_token).toBeTruthy();

    const userinfo = await fetch(new URL('/oidc/userinfo', baseUrl), {
      headers: { Authorization: `Bearer ${tokenBody.access_token}` },
    });
    expect(userinfo.status).toBe(200);
    expect((await userinfo.json()) as { email: string; org_id: string; db_id: string }).toMatchObject({
      email: 'owner@example.com',
      org_id: `org_${created.manifest.id.replace(/^db_/, '')}`,
      db_id: created.manifest.id,
    });

    const state = await fetch(new URL(`/v1/system/state?dbId=${created.manifest.id}`, baseUrl), {
      headers: { Authorization: `Bearer ${tokenBody.access_token}` },
    });
    expect(state.status).toBe(200);
  });

  it('implements device authorization polling and local email-code approval', async () => {
    const { baseUrl, engine } = await testServer();
    const created = await engine.createWorkspace({ ownerAgentId: 'agent-1', humanOwnerEmail: 'device@example.com' });

    const device = await fetch(new URL('/oauth/device_authorization', baseUrl), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_id: 'device-client',
        db_id: created.manifest.id,
        scope: 'openid email system:read',
      }),
    });
    expect(device.status).toBe(200);
    const deviceBody = (await device.json()) as { device_code: string; user_code: string };

    const pending = await fetch(new URL('/oauth/token', baseUrl), {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
        client_id: 'device-client',
        device_code: deviceBody.device_code,
      }),
    });
    expect(pending.status).toBe(400);
    expect((await pending.json()) as { error: string }).toMatchObject({ error: 'authorization_pending' });

    const slowDown = await fetch(new URL('/oauth/token', baseUrl), {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
        client_id: 'device-client',
        device_code: deviceBody.device_code,
      }),
    });
    expect(slowDown.status).toBe(400);
    expect((await slowDown.json()) as { error: string }).toMatchObject({ error: 'slow_down' });

    const verifyStart = await fetch(new URL('/oauth/device_authorization/verify', baseUrl), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ user_code: deviceBody.user_code, email: 'device@example.com' }),
    });
    expect(verifyStart.status).toBe(202);
    const verifyStartBody = (await verifyStart.json()) as { emailCodeId: string; emailCode: string };

    const verifyFinish = await fetch(new URL('/oauth/device_authorization/verify', baseUrl), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        user_code: deviceBody.user_code,
        email: 'device@example.com',
        email_code_id: verifyStartBody.emailCodeId,
        email_code: verifyStartBody.emailCode,
      }),
    });
    expect(verifyFinish.status).toBe(200);

    const token = await fetch(new URL('/oauth/token', baseUrl), {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
        client_id: 'device-client',
        device_code: deviceBody.device_code,
      }),
    });
    expect(token.status).toBe(200);
    expect(((await token.json()) as { access_token: string }).access_token).toMatch(/^cu_ses_v1_/);
  });

  it('restricts OAuth token exchange to scopes already held by the subject token', async () => {
    const { baseUrl, engine } = await testServer();
    const created = await engine.createWorkspace({ ownerAgentId: 'agent-1' });

    const allowed = await fetch(new URL('/oauth/token', baseUrl), {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'urn:ietf:params:oauth:grant-type:token-exchange',
        client_id: 'exchange-client',
        db_id: created.manifest.id,
        subject_token: created.dataToken.token,
        scope: 'records:read',
      }),
    });
    expect(allowed.status).toBe(200);
    expect(((await allowed.json()) as { access_token: string }).access_token).toMatch(/^cu_xchg_v1_/);

    const escalated = await fetch(new URL('/oauth/token', baseUrl), {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'urn:ietf:params:oauth:grant-type:token-exchange',
        client_id: 'exchange-client',
        db_id: created.manifest.id,
        subject_token: created.dataToken.token,
        scope: 'secrets:reveal',
      }),
    });
    expect(escalated.status).toBe(400);
    expect((await escalated.json()) as { error: string }).toMatchObject({ error: 'invalid_scope' });
  });

  it('claims orgs, updates grants, disables agents, and rate-limits repeated bootstrap', async () => {
    const { baseUrl, engine } = await testServer();
    const created = await engine.createWorkspace({ ownerAgentId: 'agent-1' });
    const headers = {
      Authorization: `Bearer ${created.adminToken.token}`,
      'Content-Type': 'application/json',
    };

    const claim = await fetch(new URL('/v1/system/orgs/claim', baseUrl), {
      method: 'POST',
      headers,
      body: JSON.stringify({ dbId: created.manifest.id, email: 'owner@example.com' }),
    });
    expect(claim.status).toBe(200);
    const claimBody = (await claim.json()) as { principal: { id: string }; org: { status: string; humanOwnerEmail: string } };
    expect(claimBody.org).toMatchObject({ status: 'active', humanOwnerEmail: 'owner@example.com' });

    const grants = await fetch(new URL('/v1/system/grants', baseUrl), {
      method: 'POST',
      headers,
      body: JSON.stringify({ dbId: created.manifest.id, principalId: 'agent-1', grants: ['system:read', 'org:read'] }),
    });
    expect(grants.status).toBe(200);
    expect((await grants.json()) as { principal: { grants: string[] } }).toMatchObject({
      principal: { grants: ['system:read', 'org:read'] },
    });

    const grantsList = await fetch(new URL(`/v1/system/grants?dbId=${encodeURIComponent(created.manifest.id)}&principalId=agent-1`, baseUrl), {
      headers,
    });
    expect(grantsList.status).toBe(200);
    expect((await grantsList.json()) as { principals: Array<{ id: string; grants: string[] }> }).toMatchObject({
      principals: [{ id: 'agent-1', grants: ['system:read', 'org:read'] }],
    });

    const disabled = await fetch(new URL('/v1/system/agents/agent-1/disable', baseUrl), {
      method: 'POST',
      headers,
      body: JSON.stringify({ dbId: created.manifest.id }),
    });
    expect(disabled.status).toBe(200);
    expect((await disabled.json()) as { principal: { status: string }; disabledTokenIds: string[] }).toMatchObject({
      principal: { status: 'disabled' },
    });

    const revokedDataToken = await fetch(new URL(`/v1/databases/${created.manifest.id}/records`, baseUrl), {
      headers: { Authorization: `Bearer ${created.dataToken.token}` },
    });
    expect(revokedDataToken.status).toBe(401);

    for (let index = 0; index < 5; index += 1) {
      const response = await fetch(new URL('/v1/system/agents/bootstrap', baseUrl), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Cumulus-Admin-Key': Buffer.alloc(32, 6).toString('base64'),
        },
        body: JSON.stringify({ displayName: `builder-${index}` }),
      });
      expect(response.status).toBe(201);
    }
    const limited = await fetch(new URL('/v1/system/agents/bootstrap', baseUrl), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Cumulus-Admin-Key': Buffer.alloc(32, 6).toString('base64'),
      },
      body: JSON.stringify({ displayName: 'builder-limited' }),
    });
    expect(limited.status).toBe(429);
  });

  it('rotates and revokes active agent tokens through system lifecycle routes', async () => {
    const { baseUrl, engine } = await testServer();
    const bootstrap = await engine.bootstrapAgent({ displayName: 'builder-agent' });
    const operator = await engine.createToken(bootstrap.databaseId, 'operator', ['token:revoke_any', 'system:read']);
    const headers = {
      Authorization: `Bearer ${operator.token}`,
      'Content-Type': 'application/json',
    };

    const rotated = await fetch(new URL(`/v1/system/agents/${bootstrap.agentId}/rotate`, baseUrl), {
      method: 'POST',
      headers,
      body: JSON.stringify({ dbId: bootstrap.databaseId }),
    });
    expect(rotated.status).toBe(200);
    expect(((await rotated.json()) as { token: { token: string } }).token.token).toMatch(/^cu_agt_v1_/);

    const revoked = await fetch(new URL(`/v1/system/agents/${bootstrap.agentId}/revoke`, baseUrl), {
      method: 'POST',
      headers,
      body: JSON.stringify({ dbId: bootstrap.databaseId }),
    });
    expect(revoked.status).toBe(200);
    expect(((await revoked.json()) as { revokedTokenIds: string[] }).revokedTokenIds.length).toBeGreaterThan(0);

    const audit = await engine.listAudit(bootstrap.databaseId);
    expect(audit.some((event) => JSON.stringify(event).includes('system.agent_token_rotate'))).toBe(true);
    expect(audit.some((event) => JSON.stringify(event).includes('system.agent_token_revoke'))).toBe(true);
  });

  it('rate-limits claim, device login, approvals, and destructive system actions', async () => {
    const { baseUrl, engine } = await testServer();
    const created = await engine.createWorkspace({ ownerAgentId: 'agent-1' });
    const headers = {
      Authorization: `Bearer ${created.adminToken.token}`,
      'Content-Type': 'application/json',
    };

    for (let index = 0; index < 5; index += 1) {
      const response = await fetch(new URL('/v1/system/org/claim', baseUrl), {
        method: 'POST',
        headers,
        body: JSON.stringify({ dbId: created.manifest.id, email: 'owner@example.com' }),
      });
      expect(response.status).toBe(200);
    }
    const claimLimited = await fetch(new URL('/v1/system/org/claim', baseUrl), {
      method: 'POST',
      headers,
      body: JSON.stringify({ dbId: created.manifest.id, email: 'owner@example.com' }),
    });
    expect(claimLimited.status).toBe(429);

    for (let index = 0; index < 10; index += 1) {
      const response = await fetch(new URL('/oauth/device_authorization', baseUrl), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          client_id: 'device-limit-client',
          db_id: created.manifest.id,
          scope: 'openid email system:read',
        }),
      });
      expect(response.status).toBe(200);
    }
    const deviceLimited = await fetch(new URL('/oauth/device_authorization', baseUrl), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_id: 'device-limit-client',
        db_id: created.manifest.id,
        scope: 'openid email system:read',
      }),
    });
    expect(deviceLimited.status).toBe(429);

    for (let index = 0; index < 8; index += 1) {
      const response = await fetch(new URL('/v1/system/passkeys/step-up', baseUrl), {
        method: 'POST',
        headers,
        body: JSON.stringify({ dbId: created.manifest.id }),
      });
      expect(response.status).toBe(201);
    }
    const approvalLimited = await fetch(new URL('/v1/system/passkeys/step-up', baseUrl), {
      method: 'POST',
      headers,
      body: JSON.stringify({ dbId: created.manifest.id }),
    });
    expect(approvalLimited.status).toBe(429);

    for (let index = 0; index < 8; index += 1) {
      const response = await fetch(new URL('/v1/system/schema/revert', baseUrl), {
        method: 'POST',
        headers,
        body: JSON.stringify({ dbId: created.manifest.id }),
      });
      expect(response.status).toBe(400);
    }
    const destructiveLimited = await fetch(new URL('/v1/system/schema/revert', baseUrl), {
      method: 'POST',
      headers,
      body: JSON.stringify({ dbId: created.manifest.id }),
    });
    expect(destructiveLimited.status).toBe(429);
  });

  it('requires recent local passkey step-up for destructive human approvals', async () => {
    const { baseUrl, engine } = await testServer();
    const created = await engine.createWorkspace({ ownerAgentId: 'agent-1', humanOwnerEmail: 'owner@example.com' });
    const session = await localOAuthSession({
      baseUrl,
      dbId: created.manifest.id,
      scope: 'openid email member:approve schema:plan schema:apply_safe schema:apply_destructive system:read',
    });
    const headers = {
      Authorization: `Bearer ${session.accessToken}`,
      'Content-Type': 'application/json',
    };

    const initialPlan = await fetch(new URL('/v1/system/schema/plan', baseUrl), {
      method: 'POST',
      headers,
      body: JSON.stringify({
        dbId: created.manifest.id,
        source: 'namespace acme { collection notes { fields: { id: { type: "ulid" }, body: { type: "string" } } } }',
      }),
    });
    const initialPlanBody = (await initialPlan.json()) as { plan: { id: string } };
    const initialApply = await fetch(new URL('/v1/system/schema/apply', baseUrl), {
      method: 'POST',
      headers,
      body: JSON.stringify({ dbId: created.manifest.id, planId: initialPlanBody.plan.id }),
    });
    expect(initialApply.status).toBe(200);

    const destructivePlan = await fetch(new URL('/v1/system/schema/plan', baseUrl), {
      method: 'POST',
      headers,
      body: JSON.stringify({
        dbId: created.manifest.id,
        source: 'namespace acme { collection notes { fields: { id: { type: "ulid" } } } }',
      }),
    });
    const destructivePlanBody = (await destructivePlan.json()) as { plan: { id: string; riskLevel: string } };
    expect(destructivePlanBody.plan.riskLevel).toBe('destructive');

    const blockedApproval = await fetch(new URL('/v1/system/schema/approvals', baseUrl), {
      method: 'POST',
      headers,
      body: JSON.stringify({ dbId: created.manifest.id, planId: destructivePlanBody.plan.id }),
    });
    expect(blockedApproval.status).toBe(400);
    expect((await blockedApproval.json()) as { error: string }).toMatchObject({
      error: 'recent passkey step-up required for destructive approval',
    });

    const stepUp = await fetch(new URL('/v1/system/passkeys/step-up', baseUrl), {
      method: 'POST',
      headers,
      body: JSON.stringify({ dbId: created.manifest.id }),
    });
    expect(stepUp.status).toBe(201);
    const stepUpBody = (await stepUp.json()) as { stepUp: { stepUpToken: string } };

    const approval = await fetch(new URL('/v1/system/schema/approvals', baseUrl), {
      method: 'POST',
      headers,
      body: JSON.stringify({
        dbId: created.manifest.id,
        planId: destructivePlanBody.plan.id,
        stepUpToken: stepUpBody.stepUp.stepUpToken,
      }),
    });
    expect(approval.status).toBe(201);
  });
});
