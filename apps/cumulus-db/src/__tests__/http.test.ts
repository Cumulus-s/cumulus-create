// SPDX-License-Identifier: AGPL-3.0-only
import { createServer } from 'node:http';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createHandler } from '../http.js';
import { CumulusDbEngine } from '../storage.js';
import type { CumulusDbConfig } from '../config.js';
import type { RecordType } from '../types.js';

const cleanup: Array<() => Promise<void> | void> = [];

afterEach(async () => {
  for (const fn of cleanup.splice(0)) await fn();
});

async function testServer() {
  const dataDir = await mkdtemp(join(tmpdir(), 'cumulus-db-http-'));
  const config: CumulusDbConfig = {
    engine: 'jsonl',
    dataDir,
    publicUrl: 'http://127.0.0.1:0',
    adminSecret: Buffer.alloc(32, 4).toString('base64'),
    masterKey: Buffer.alloc(32, 4),
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

describe('HTTP API', () => {
  it('creates records through REST and searches them', async () => {
    const { baseUrl, engine } = await testServer();
    const created = await engine.createWorkspace({ ownerAgentId: 'agent-1' });
    const headers = {
      Authorization: `Bearer ${created.dataToken.token}`,
      'Content-Type': 'application/json',
    };

    const write = await fetch(new URL(`/v1/databases/${created.manifest.id}/records`, baseUrl), {
      method: 'POST',
      headers,
      body: JSON.stringify({ type: 'note', content: 'Hybrid search works for agents.' }),
    });
    expect(write.status).toBe(201);

    const search = await fetch(new URL(`/v1/databases/${created.manifest.id}/search`, baseUrl), {
      method: 'POST',
      headers,
      body: JSON.stringify({ query: 'hybrid agents' }),
    });
    expect(search.status).toBe(200);
    const body = (await search.json()) as { hits: unknown[] };
    expect(body.hits.length).toBe(1);
  });

  it('stores every public record type and searches by text, vector, type, and limit', async () => {
    const { baseUrl, engine } = await testServer();
    const created = await engine.createWorkspace({ ownerAgentId: 'agent-1' });
    const headers = {
      Authorization: `Bearer ${created.dataToken.token}`,
      'Content-Type': 'application/json',
    };
    const recordTypes: RecordType[] = [
      'document',
      'note',
      'run',
      'message',
      'event',
      'kv',
      'tool_call',
      'artifact',
      'summary',
      'preference',
      'secret',
      'entity',
      'task',
      'observation',
    ];
    const storedTypes = new Set<string>();

    for (const [index, type] of recordTypes.entries()) {
      const payload = {
        type,
        key: type === 'kv' ? 'evidence.key' : undefined,
        title: `Evidence ${type}`,
        content: `Cumulus API evidence record for ${type}.`,
        json: { capability: type, index },
        tags: ['cumulus-api-evidence', type],
        vector: [index + 1, index % 3, 1],
        recordIsSecret: type === 'secret',
        secrets: type === 'secret' ? { EVIDENCE_TOKEN: 'demo-secret-not-real' } : undefined,
      };

      const response =
        type === 'event'
          ? await fetch(new URL(`/v1/databases/${created.manifest.id}/events`, baseUrl), {
              method: 'POST',
              headers,
              body: JSON.stringify(payload),
            })
          : type === 'kv'
            ? await fetch(new URL(`/v1/databases/${created.manifest.id}/kv/evidence.key`, baseUrl), {
                method: 'PUT',
                headers,
                body: JSON.stringify({ value: payload.json, metadata: { evidence: true } }),
              })
            : await fetch(new URL(`/v1/databases/${created.manifest.id}/records`, baseUrl), {
                method: 'POST',
                headers,
                body: JSON.stringify(payload),
              });

      expect(response.status).toBeLessThan(300);
      const body = (await response.json()) as { record: { type: string } };
      storedTypes.add(body.record.type);
    }

    expect([...storedTypes].sort()).toEqual([...recordTypes].sort());

    const textSearch = await fetch(new URL(`/v1/databases/${created.manifest.id}/search`, baseUrl), {
      method: 'POST',
      headers,
      body: JSON.stringify({ query: 'evidence record', type: 'note', limit: 1 }),
    });
    expect(textSearch.status).toBe(200);
    const textBody = (await textSearch.json()) as { hits: Array<{ record: { type: string } }> };
    expect(textBody.hits).toHaveLength(1);
    expect(textBody.hits[0]?.record.type).toBe('note');

    const vectorSearch = await fetch(new URL(`/v1/databases/${created.manifest.id}/search`, baseUrl), {
      method: 'POST',
      headers,
      body: JSON.stringify({ vector: [8, 1, 1], type: 'artifact', limit: 1 }),
    });
    expect(vectorSearch.status).toBe(200);
    const vectorBody = (await vectorSearch.json()) as { hits: Array<{ record: { type: string }; vectorScore: number }> };
    expect(vectorBody.hits).toHaveLength(1);
    expect(vectorBody.hits[0]?.record.type).toBe('artifact');
    expect(vectorBody.hits[0]?.vectorScore).toBeGreaterThan(0);
  });

  it('implements the advertised MCP database tools', async () => {
    const { baseUrl, engine } = await testServer();
    const created = await engine.createWorkspace({ ownerAgentId: 'agent-1' });
    const secret = await engine.writeRecord(created.manifest.id, {
      type: 'secret',
      title: 'MCP secret',
      recordIsSecret: true,
      secrets: { EVIDENCE_TOKEN: 'demo-secret-not-real' },
    });

    const manifest = await fetch(new URL('/mcp', baseUrl));
    expect(manifest.status).toBe(200);
    const manifestBody = (await manifest.json()) as {
      tools: string[];
      toolSchemas: Array<{ name: string; inputSchema: { required: string[] }; dryRunFirst?: boolean }>;
    };
    expect(manifestBody.tools).toContain('cumulus_db_put_kv');
    expect(manifestBody.tools).toContain('cumulus_db_get_kv');
    expect(manifestBody.tools).toContain('cumulus_db_reveal_secret');
    expect(manifestBody.tools).toContain('cumulus.plan_schema');
    expect(manifestBody.tools).toContain('cumulus.rotate_self_token');
    expect(manifestBody.toolSchemas.find((tool) => tool.name === 'cumulus.apply_schema')?.dryRunFirst).toBe(true);
    expect(manifestBody.toolSchemas.find((tool) => tool.name === 'cumulus_db_put_kv')?.inputSchema.required).toEqual([
      'database_id',
      'token',
      'key',
      'value',
    ]);

    const put = await fetch(new URL('/mcp', baseUrl), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        tool: 'cumulus_db_put_kv',
        arguments: {
          database_id: created.manifest.id,
          token: created.dataToken.token,
          key: 'mcp.evidence',
          value: { ok: true },
        },
      }),
    });
    expect(put.status).toBe(200);

    const get = await fetch(new URL('/mcp', baseUrl), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        tool: 'cumulus_db_get_kv',
        arguments: {
          database_id: created.manifest.id,
          token: created.dataToken.token,
          key: 'mcp.evidence',
        },
      }),
    });
    expect(get.status).toBe(200);
    const getBody = (await get.json()) as { result: { json: { ok: boolean } } };
    expect(getBody.result.json.ok).toBe(true);

    const reveal = await fetch(new URL('/mcp', baseUrl), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        tool: 'cumulus_db_reveal_secret',
        arguments: {
          database_id: created.manifest.id,
          token: created.adminToken.token,
          record_id: secret.id,
          field: 'EVIDENCE_TOKEN',
        },
      }),
    });
    expect(reveal.status).toBe(200);
    const revealBody = (await reveal.json()) as { result: { value: string } };
    expect(revealBody.result.value).toBe('demo-secret-not-real');

    const missing = await fetch(new URL('/mcp', baseUrl), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tool: 'cumulus_db_put_kv', arguments: { database_id: created.manifest.id, token: created.dataToken.token } }),
    });
    expect(missing.status).toBe(400);
    expect((await missing.json()) as { error: string }).toMatchObject({ error: 'missing required MCP argument(s): key, value' });
  });

  it('does not let legacy token managers mint hard system scopes', async () => {
    const { baseUrl, engine } = await testServer();
    const created = await engine.createWorkspace({ ownerAgentId: 'agent-1' });
    const manager = await engine.createToken(created.manifest.id, 'legacy token manager', ['tokens:manage']);
    const creator = await engine.createToken(created.manifest.id, 'limited system token creator', ['token:create']);

    const blocked = await fetch(new URL(`/v1/databases/${created.manifest.id}/tokens`, baseUrl), {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${manager.token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ label: 'system reader', scopes: ['system:read'] }),
    });
    expect(blocked.status).toBe(401);

    const escalated = await fetch(new URL(`/v1/databases/${created.manifest.id}/tokens`, baseUrl), {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${creator.token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ label: 'destructive applier', scopes: ['schema:apply_destructive'] }),
    });
    expect(escalated.status).toBe(401);

    const allowed = await fetch(new URL(`/v1/databases/${created.manifest.id}/tokens`, baseUrl), {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${created.adminToken.token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ label: 'system reader', scopes: ['system:read'] }),
    });
    expect(allowed.status).toBe(201);
    const allowedBody = (await allowed.json()) as { token: { token: string } };
    expect(allowedBody.token.token).toMatch(/^cu_pat_v1_/);
  });

  it('exposes system bootstrap and schema lifecycle endpoints with hard scopes', async () => {
    const { baseUrl, engine } = await testServer();

    const bootstrap = await fetch(new URL('/v1/system/agents/bootstrap', baseUrl), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ displayName: 'builder-agent' }),
    });
    expect(bootstrap.status).toBe(401);

    const authorizedBootstrap = await fetch(new URL('/v1/system/agents/bootstrap', baseUrl), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Cumulus-Admin-Key': Buffer.alloc(32, 4).toString('base64'),
      },
      body: JSON.stringify({ displayName: 'builder-agent' }),
    });
    expect(authorizedBootstrap.status).toBe(201);
    const bootBody = (await authorizedBootstrap.json()) as {
      databaseId: string;
      token: { token: string };
    };
    expect(bootBody.token.token).toMatch(/^cu_agt_v1_/);

    const agentHeaders = {
      Authorization: `Bearer ${bootBody.token.token}`,
      'Content-Type': 'application/json',
    };
    const agentPlan = await fetch(new URL('/v1/system/schema/plan', baseUrl), {
      method: 'POST',
      headers: agentHeaders,
      body: JSON.stringify({
        dbId: bootBody.databaseId,
        source: 'namespace acme { collection notes { fields: { id: { type: "ulid" } } } }',
      }),
    });
    expect(agentPlan.status).toBe(200);
    const agentPlanBody = (await agentPlan.json()) as { plan: { id: string } };

    const agentApply = await fetch(new URL('/v1/system/schema/apply', baseUrl), {
      method: 'POST',
      headers: agentHeaders,
      body: JSON.stringify({ dbId: bootBody.databaseId, planId: agentPlanBody.plan.id }),
    });
    expect(agentApply.status).toBe(401);

    const created = await engine.createWorkspace({ ownerAgentId: 'agent-1', humanOwnerEmail: 'owner@example.com' });
    const operator = await engine.createToken(created.manifest.id, 'schema operator', [
      'system:read',
      'audit:read',
      'member:approve',
      'schema:plan',
      'schema:apply_safe',
      'schema:apply_destructive',
      'schema:revert_local',
      'backup:create',
    ]);
    const headers = {
      Authorization: `Bearer ${operator.token}`,
      'Content-Type': 'application/json',
    };

    const initialPlan = await fetch(new URL('/v1/system/schema/plan', baseUrl), {
      method: 'POST',
      headers,
      body: JSON.stringify({
        dbId: created.manifest.id,
        source: `
          namespace acme {
            collection agents {
              fields: {
                id: { type: "ulid", required: true },
                status: { type: "string" }
              }
            }
          }
        `,
      }),
    });
    expect(initialPlan.status).toBe(200);
    const initialPlanBody = (await initialPlan.json()) as { plan: { id: string; riskLevel: string } };
    expect(initialPlanBody.plan.riskLevel).toBe('low');

    const initialApply = await fetch(new URL('/v1/system/schema/apply', baseUrl), {
      method: 'POST',
      headers,
      body: JSON.stringify({ dbId: created.manifest.id, planId: initialPlanBody.plan.id }),
    });
    expect(initialApply.status).toBe(200);
    const initialApplyBody = (await initialApply.json()) as { apply: { versionId: string } };
    expect(initialApplyBody.apply.versionId).toMatch(/^ver_/);

    const destructivePlan = await fetch(new URL('/v1/system/schema/plan', baseUrl), {
      method: 'POST',
      headers,
      body: JSON.stringify({
        dbId: created.manifest.id,
        source: `
          namespace acme {
            collection agents {
              fields: { id: { type: "ulid", required: true } }
            }
          }
        `,
      }),
    });
    const destructivePlanBody = (await destructivePlan.json()) as { plan: { id: string; riskLevel: string } };
    expect(destructivePlanBody.plan.riskLevel).toBe('destructive');

    const rejectedApply = await fetch(new URL('/v1/system/schema/apply', baseUrl), {
      method: 'POST',
      headers,
      body: JSON.stringify({ dbId: created.manifest.id, planId: destructivePlanBody.plan.id }),
    });
    expect(rejectedApply.status).toBe(400);

    const approval = await fetch(new URL('/v1/system/schema/approvals', baseUrl), {
      method: 'POST',
      headers,
      body: JSON.stringify({ dbId: created.manifest.id, planId: destructivePlanBody.plan.id }),
    });
    expect(approval.status).toBe(201);
    const approvalBody = (await approval.json()) as { approval: { approvalToken: string } };

    const destructiveApply = await fetch(new URL('/v1/system/schema/apply', baseUrl), {
      method: 'POST',
      headers,
      body: JSON.stringify({
        dbId: created.manifest.id,
        planId: destructivePlanBody.plan.id,
        approvalToken: approvalBody.approval.approvalToken,
      }),
    });
    expect(destructiveApply.status).toBe(200);
    const destructiveApplyBody = (await destructiveApply.json()) as { apply: { snapshot: { id: string; path?: string; storage: string } } };
    expect(destructiveApplyBody.apply.snapshot.id).toMatch(/^snap_/);
    expect(destructiveApplyBody.apply.snapshot.storage).toBe('provider-managed');
    expect(destructiveApplyBody.apply.snapshot.path).toBeUndefined();

    const state = await fetch(new URL(`/v1/system/state?dbId=${created.manifest.id}`, baseUrl), { headers });
    const stateBody = (await state.json()) as { system: { approvals: Array<{ tokenHash?: string }>; schema: { snapshots: Array<{ path?: string }> } } };
    expect(JSON.stringify(stateBody.system.approvals)).not.toContain('tokenHash');
    expect(stateBody.system.schema.snapshots.some((snapshot) => snapshot.path)).toBe(false);

    const revertApproval = await fetch(new URL('/v1/system/schema/approvals', baseUrl), {
      method: 'POST',
      headers,
      body: JSON.stringify({ dbId: created.manifest.id, kind: 'revert', versionId: initialApplyBody.apply.versionId }),
    });
    const revertApprovalBody = (await revertApproval.json()) as { approval: { approvalToken: string } };

    const revert = await fetch(new URL('/v1/system/schema/revert', baseUrl), {
      method: 'POST',
      headers,
      body: JSON.stringify({
        dbId: created.manifest.id,
        versionId: initialApplyBody.apply.versionId,
        approvalToken: revertApprovalBody.approval.approvalToken,
      }),
    });
    expect(revert.status).toBe(200);

    const audit = await fetch(new URL(`/v1/system/audit?dbId=${created.manifest.id}`, baseUrl), { headers });
    expect(audit.status).toBe(200);
    const auditBody = (await audit.json()) as { audit: unknown[] };
    expect(JSON.stringify(auditBody.audit)).toContain('system.schema_revert');
  });
});
