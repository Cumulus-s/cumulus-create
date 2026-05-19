// SPDX-License-Identifier: AGPL-3.0-only
import { createHmac, randomBytes, randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { assertNimbusNamespaceAllowed, compileNimbus, validateNimbusIr, type NimbusIr } from './nimbus.js';
import {
  decryptString,
  decryptStringWithWrappedDek,
  encryptString,
  encryptStringWithWrappedDek,
  type WrappedEncryptedString,
} from './crypto.js';
import { detectSecretKeys } from './secrets.js';
import { CumulusDbEngine } from './storage.js';
import {
  hasScopes,
  issueToken,
  issueWorkspaceTokens,
  verifyTokenRecord,
} from './tokens.js';
import {
  DEFAULT_AGENT_SYSTEM_SCOPES,
  buildSchemaPlan,
  isHardSystemScope,
  newSystemState,
  normalizeTokenScopes,
  stableHash,
  type SchemaPlanRecord,
  type SchemaRiskLevel,
  type SystemSnapshotRecord,
  type SystemState,
} from './system.js';
import { POSTGRES_DATA_DDL, POSTGRES_DATA_SCHEMA_VERSION, POSTGRES_RUNTIME_DDL, POSTGRES_SYSTEM_SCHEMA_VERSION } from './postgres-schema.js';
import type {
  PublicRecord,
  RecordType,
  SearchHit,
  StoredRecord,
  TokenIssue,
  TokenRecord,
  TokenScope,
  WorkspaceManifest,
} from './types.js';

type PostgresSsl = false | true | { rejectUnauthorized: boolean };

interface PgQueryResult<T> {
  rows: T[];
  rowCount: number | null;
}

interface PgClient {
  query<T = Record<string, unknown>>(text: string, values?: unknown[]): Promise<PgQueryResult<T>>;
  release(): void;
}

interface PgPool {
  query<T = Record<string, unknown>>(text: string, values?: unknown[]): Promise<PgQueryResult<T>>;
  connect(): Promise<PgClient>;
  end(): Promise<void>;
}

interface PgPoolConfig {
  connectionString: string;
  ssl?: PostgresSsl;
  max?: number;
  application_name?: string;
}

interface CreateWorkspaceInput {
  ownerAgentId: string;
  humanOwnerEmail?: string | null;
  relaySignupId?: string | null;
}

interface WriteRecordInput {
  type: RecordType;
  key?: string;
  title?: string;
  content?: string | null;
  json?: unknown;
  tags?: string[];
  vector?: number[];
  metadata?: Record<string, unknown>;
  secrets?: Record<string, string>;
  recordIsSecret?: boolean;
}

interface UpsertRecordInput extends Partial<WriteRecordInput> {
  id: string;
}

interface SearchInput {
  query?: string;
  vector?: number[];
  type?: RecordType;
  limit?: number;
}

interface AgentBootstrapInput {
  displayName?: string;
  humanOwnerEmail?: string | null;
}

interface PlanSchemaInput {
  source?: string;
  desired?: NimbusIr;
  fileName?: string;
  allowSystemNamespace?: boolean;
}

interface ApplySchemaInput {
  planId: string;
  approvalToken?: string;
  actorType?: 'human' | 'agent' | 'system';
  actorId?: string;
}

interface RevertSchemaInput {
  versionId?: string;
  snapshotId?: string;
  approvalToken?: string;
  actorType?: 'human' | 'agent' | 'system';
  actorId?: string;
}

interface CreateRevertApprovalInput {
  versionId?: string;
  snapshotId?: string;
  actorType?: 'human' | 'agent' | 'system';
  actorId?: string;
}

interface Operation {
  op: 'record_upsert' | 'record_delete' | 'compact';
  record?: StoredRecord;
  id?: string;
  at: string;
}

interface PostgresEngineOptions {
  connectionString: string;
  ssl?: PostgresSsl;
  autoMigrate?: boolean;
  masterKey: Buffer;
  dataDir?: string;
}

const require = createRequire(import.meta.url);
const { Pool } = require('pg') as { Pool: new (config: PgPoolConfig) => PgPool };

const ALL_DATA_SCOPES: TokenScope[] = [
  'records:read',
  'records:write',
  'search:read',
  'events:write',
  'kv:read',
  'kv:write',
  'secrets:write',
];

function nowIso(): string {
  return new Date().toISOString();
}

function publicRecord(record: StoredRecord): PublicRecord {
  return {
    id: record.id,
    dbId: record.dbId,
    type: record.type,
    ...(record.key ? { key: record.key } : {}),
    ...(record.title ? { title: record.title } : {}),
    content: record.secret.contentEncrypted ? '[secret]' : record.content ?? null,
    ...(record.json !== undefined ? { json: record.json } : {}),
    tags: record.tags,
    ...(record.vector ? { vector: record.vector } : {}),
    metadata: record.metadata,
    secret: record.secret,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    ...(record.deletedAt ? { deletedAt: record.deletedAt } : {}),
  };
}

function normalizeVector(vector: unknown): number[] | undefined {
  if (vector === undefined) return undefined;
  if (!Array.isArray(vector) || vector.length === 0) {
    throw new Error('vector must be a non-empty number array');
  }
  const normalized = vector.map((value) => Number(value));
  if (normalized.some((value) => !Number.isFinite(value))) {
    throw new Error('vector must contain finite numbers');
  }
  return normalized;
}

function emptyNimbusDocument(): NimbusIr {
  return {
    $schema: 'https://schemas.cumulus.sh/nimbus-ir/v1alpha1.schema.json',
    apiVersion: 'nimbus.cumulus/v1alpha1',
    kind: 'NimbusDocument',
    metadata: {
      name: 'empty',
      compilerVersion: '0.1.0',
      sourceHash: 'sha256:empty',
    },
    spec: {
      namespace: 'default',
      apps: [],
      collections: [],
      indexes: [],
      policies: [],
      secrets: [],
      backups: [],
      approvals: [],
    },
  };
}

function clampLimit(limit: number): number {
  return Math.max(1, Math.min(Number.isFinite(limit) ? Math.trunc(limit) : 100, 500));
}

function timestamp(value: string | null | undefined): string | null {
  return value ?? null;
}

export class PostgresCumulusDbEngine extends CumulusDbEngine {
  private readonly pool: PgPool;
  private readonly shouldAutoMigrate: boolean;
  private readonly pgMasterKey: Buffer;

  constructor(options: PostgresEngineOptions) {
    super(options.dataDir ?? '.cumulus-db-postgres-unused', options.masterKey);
    this.pgMasterKey = options.masterKey;
    this.shouldAutoMigrate = options.autoMigrate === true;
    this.pool = new Pool({
      connectionString: options.connectionString,
      ssl: options.ssl ?? false,
      max: 10,
      application_name: 'cumulus-db',
    });
  }

  async close(): Promise<void> {
    await this.pool.end();
  }

  async ensureRoot(): Promise<void> {
    if (this.shouldAutoMigrate) {
      await this.pgApplyRuntimeSchema();
      return;
    }

    const result = await this.pool.query<{ data_schema: string | null }>(
      "select to_regclass('cumulus_data.manifests') as data_schema",
    );
    if (!result.rows[0]?.data_schema) {
      throw new Error('Postgres schema is not initialized; set CUMULUS_DB_AUTO_MIGRATE=true or apply apps/cumulus-db/postgres/data-v1.sql');
    }
  }

  async createWorkspace(input: CreateWorkspaceInput): Promise<{
    manifest: WorkspaceManifest;
    dataToken: TokenIssue;
    adminToken: TokenIssue;
  }> {
    return this.pgTransaction(async (client) => {
      const id = `db_${randomUUID().replace(/-/g, '')}`;
      const createdAt = nowIso();
      const activeSegment = 'postgres-wal';
      const manifest: WorkspaceManifest = {
        id,
        ownerAgentId: input.ownerAgentId,
        humanOwnerEmail: input.humanOwnerEmail ?? null,
        relaySignupId: input.relaySignupId ?? null,
        createdAt,
        updatedAt: createdAt,
        recordCount: 0,
        deletedCount: 0,
        lastCompactedAt: null,
        activeSegment,
      };
      const tokens = issueWorkspaceTokens(this.pgMasterKey);
      tokens.records = tokens.records.map((token) =>
        token.tokenKind === 'data'
          ? { ...token, principalId: input.ownerAgentId }
          : token,
      );
      const systemState = newSystemState({
        dbId: id,
        ownerAgentId: input.ownerAgentId,
        humanOwnerEmail: input.humanOwnerEmail ?? null,
        createdAt,
      });

      await this.pgWriteManifest(client, manifest);
      for (const token of tokens.records) {
        await this.pgUpsertToken(client, id, token);
      }
      await this.pgWriteSystemState(client, id, systemState);
      await this.pgAppendAudit(client, id, { action: 'workspace_create', at: createdAt });

      return { manifest, dataToken: tokens.data, adminToken: tokens.admin };
    });
  }

  async listWorkspaces(): Promise<WorkspaceManifest[]> {
    const result = await this.pool.query<{ manifest_json: WorkspaceManifest }>(
      'select manifest_json from cumulus_data.manifests order by updated_at desc',
    );
    return result.rows.map((row) => row.manifest_json);
  }

  async getManifest(dbId: string): Promise<WorkspaceManifest> {
    const manifest = await this.pgGetManifest(dbId);
    if (!manifest) throw new Error('workspace not found');
    return manifest;
  }

  async authenticate(dbId: string, token: string, required: TokenScope[]): Promise<TokenRecord> {
    const tokens = await this.readTokens(dbId);
    const match = tokens.find((item) => verifyTokenRecord(item, token, this.pgMasterKey) && !item.revokedAt);
    if (!match || !hasScopes(match, required)) {
      throw new Error('unauthorized');
    }
    match.lastUsedAt = nowIso();
    await this.pgWithClient((client) => this.pgUpsertToken(client, dbId, match));
    return match;
  }

  async readTokens(dbId: string): Promise<TokenRecord[]> {
    const result = await this.pool.query<{ token_json: TokenRecord }>(
      'select token_json from cumulus_data.tokens where db_id = $1 order by created_at asc',
      [dbId],
    );
    return result.rows.map((row) => row.token_json);
  }

  async writeTokens(dbId: string, tokens: TokenRecord[]): Promise<void> {
    await this.pgTransaction(async (client) => {
      await client.query('delete from cumulus_data.tokens where db_id = $1', [dbId]);
      for (const token of tokens) {
        await this.pgUpsertToken(client, dbId, token);
      }
    });
  }

  async createToken(dbId: string, label: string, scopes: TokenScope[]): Promise<TokenIssue> {
    const normalizedScopes = scopes.length ? normalizeTokenScopes(scopes) : ALL_DATA_SCOPES;
    const systemToken = normalizedScopes.some((scope) => isHardSystemScope(scope));
    const issued = issueToken(label, normalizedScopes, systemToken ? 'cu_pat' : 'cdb_data', this.pgMasterKey, {
      kind: systemToken ? 'pat' : 'data',
    });
    await this.pgTransaction(async (client) => {
      await this.pgUpsertToken(client, dbId, issued.record);
      await this.pgAppendAudit(client, dbId, { action: 'token_create', tokenId: issued.record.id, at: nowIso() });
    });
    return issued.issue;
  }

  async rotateToken(dbId: string, tokenId: string): Promise<TokenIssue> {
    return this.pgTransaction(async (client) => {
      const tokens = await this.pgReadTokens(client, dbId);
      const current = tokens.find((token) => token.id === tokenId && !token.revokedAt);
      if (!current) throw new Error('token not found');
      current.revokedAt = nowIso();
      const issued = issueToken(
        current.label,
        current.scopes,
        current.scopes.includes('database:admin')
          ? 'cdb_admin'
          : current.tokenKind === 'agent'
            ? 'cu_agt'
            : current.tokenKind === 'pat'
              ? 'cu_pat'
              : 'cdb_data',
        this.pgMasterKey,
        {
          kind: current.tokenKind,
          principalType: current.principalType,
          principalId: current.principalId,
          expiresAt: current.expiresAt,
          rotatedFromId: current.id,
        },
      );
      await this.pgUpsertToken(client, dbId, current);
      await this.pgUpsertToken(client, dbId, issued.record);
      await this.pgAppendAudit(client, dbId, {
        action: 'token_rotate',
        oldTokenId: tokenId,
        newTokenId: issued.record.id,
        at: nowIso(),
      });
      return issued.issue;
    });
  }

  async revokeToken(dbId: string, tokenId: string): Promise<void> {
    await this.pgTransaction(async (client) => {
      const tokens = await this.pgReadTokens(client, dbId);
      const current = tokens.find((token) => token.id === tokenId);
      if (!current) throw new Error('token not found');
      current.revokedAt = current.revokedAt ?? nowIso();
      await this.pgUpsertToken(client, dbId, current);
      await this.pgAppendAudit(client, dbId, { action: 'token_revoke', tokenId, at: current.revokedAt });
    });
  }

  async bootstrapAgent(input: AgentBootstrapInput = {}): Promise<{
    databaseId: string;
    orgId: string;
    agentId: string;
    token: TokenIssue;
    scopes: TokenScope[];
  }> {
    const agentId = `agt_${randomUUID().replace(/-/g, '')}`;
    const created = await this.createWorkspace({
      ownerAgentId: agentId,
      humanOwnerEmail: input.humanOwnerEmail ?? null,
    });
    await this.revokeToken(created.manifest.id, created.dataToken.id);
    await this.revokeToken(created.manifest.id, created.adminToken.id);

    const tokenRecord = issueToken(
      input.displayName ?? 'bootstrap agent',
      DEFAULT_AGENT_SYSTEM_SCOPES,
      'cu_agt',
      this.pgMasterKey,
      { kind: 'agent', principalType: 'agent', principalId: agentId },
    );

    const state = await this.pgTransaction(async (client) => {
      await this.pgUpsertToken(client, created.manifest.id, tokenRecord.record);
      const current = await this.pgReadSystemState(client, created.manifest.id);
      current.principals = current.principals.map((principal) =>
        principal.id === agentId
          ? { ...principal, displayName: input.displayName ?? principal.displayName, grants: DEFAULT_AGENT_SYSTEM_SCOPES }
          : principal,
      );
      await this.pgWriteSystemState(client, created.manifest.id, current);
      await this.pgWriteStructuredAudit(
        client,
        created.manifest.id,
        {
          action: 'system.agent_bootstrap',
          actor: { type: 'agent', id: agentId },
          target: { type: 'agent', id: agentId },
          metadata: { scopes: DEFAULT_AGENT_SYSTEM_SCOPES },
        },
        current,
      );
      return current;
    });

    return {
      databaseId: created.manifest.id,
      orgId: state.org.id,
      agentId,
      token: tokenRecord.issue,
      scopes: DEFAULT_AGENT_SYSTEM_SCOPES,
    };
  }

  async getSystemState(dbId: string): Promise<SystemState> {
    return this.pgWithClient((client) => this.pgReadSystemState(client, dbId));
  }

  async listAudit(dbId: string, limit = 100): Promise<unknown[]> {
    const result = await this.pool.query<{ event_json: unknown }>(
      'select event_json from cumulus_data.audit_logs where db_id = $1 order by id desc limit $2',
      [dbId, clampLimit(limit)],
    );
    return result.rows.map((row) => row.event_json);
  }

  async planSchema(dbId: string, input: PlanSchemaInput): Promise<SchemaPlanRecord> {
    const compiled = input.source
      ? compileNimbus(input.source, {
          fileName: input.fileName ?? 'schema.nimbus',
          allowSystemNamespace: input.allowSystemNamespace,
        })
      : null;
    const desired = compiled?.ir ?? input.desired;
    if (!desired) throw new Error('schema plan requires Nimbus source or desired IR');
    validateNimbusIr(desired);
    assertNimbusNamespaceAllowed(desired, input.allowSystemNamespace === true);
    const desiredHash = compiled?.hash ?? stableHash(desired);

    return this.pgTransaction(async (client) => {
      const state = await this.pgReadSystemState(client, dbId);
      const plan = buildSchemaPlan({
        desired,
        desiredHash,
        live: state.schema.live,
        lastApplied: state.schema.lastApplied,
        createdAt: nowIso(),
      });
      state.schema.plans.push(plan);
      await this.pgWriteSystemState(client, dbId, state);
      await this.pgWriteStructuredAudit(
        client,
        dbId,
        {
          action: 'system.schema_plan',
          actor: { type: 'system', id: 'planner' },
          target: { type: 'schema_plan', id: plan.id },
          metadata: {
            planHash: plan.planHash,
            riskLevel: plan.riskLevel,
            operations: plan.operations.map((operation) => operation.kind),
          },
        },
        state,
      );
      return plan;
    });
  }

  async createSchemaApproval(dbId: string, planId: string, actorType: 'human' | 'agent' | 'system' = 'human', actorId = 'operator'): Promise<{
    approvalId: string;
    approvalToken: string;
    expiresAt: string;
  }> {
    return this.pgTransaction(async (client) => {
      const state = await this.pgReadSystemState(client, dbId);
      const plan = state.schema.plans.find((item) => item.id === planId);
      if (!plan) throw new Error('schema plan not found');
      const approvalToken = randomBytes(32).toString('base64url');
      const createdAt = nowIso();
      const expiresAt = new Date(Date.now() + 5 * 60 * 1000).toISOString();
      const approval = {
        id: `apv_${randomUUID().replace(/-/g, '')}`,
        tokenHash: this.pgApprovalTokenMac(approvalToken),
        planId: plan.id,
        planHash: plan.planHash,
        scope: 'schema:apply_destructive' as TokenScope,
        createdAt,
        expiresAt,
        usedAt: null,
        actorType,
        actorId,
      };
      state.approvals.push(approval);
      await this.pgWriteSystemState(client, dbId, state);
      await this.pgWriteStructuredAudit(
        client,
        dbId,
        {
          action: 'system.schema_approval_create',
          actor: { type: actorType, id: actorId },
          target: { type: 'schema_plan', id: plan.id },
          metadata: { approvalId: approval.id, planHash: plan.planHash, expiresAt },
        },
        state,
      );
      return { approvalId: approval.id, approvalToken, expiresAt };
    });
  }

  async createRevertApproval(dbId: string, input: CreateRevertApprovalInput): Promise<{
    approvalId: string;
    approvalToken: string;
    expiresAt: string;
  }> {
    if (!input.versionId && !input.snapshotId) {
      throw new Error('revert approval requires a target version or snapshot');
    }
    return this.pgTransaction(async (client) => {
      const state = await this.pgReadSystemState(client, dbId);
      if (input.versionId && !state.schema.versions.some((version) => version.id === input.versionId)) {
        throw new Error('schema revert target not found');
      }
      if (input.snapshotId && !state.schema.snapshots.some((snapshot) => snapshot.id === input.snapshotId)) {
        throw new Error('schema revert snapshot not found');
      }
      const approvalToken = randomBytes(32).toString('base64url');
      const createdAt = nowIso();
      const expiresAt = new Date(Date.now() + 5 * 60 * 1000).toISOString();
      const approval = {
        id: `apv_${randomUUID().replace(/-/g, '')}`,
        tokenHash: this.pgApprovalTokenMac(approvalToken),
        planId: 'revert',
        planHash: 'revert',
        scope: 'schema:revert_local' as TokenScope,
        createdAt,
        expiresAt,
        usedAt: null,
        actorType: input.actorType ?? 'human',
        actorId: input.actorId ?? 'operator',
        targetVersionId: input.versionId ?? null,
        targetSnapshotId: input.snapshotId ?? null,
      };
      state.approvals.push(approval);
      await this.pgWriteSystemState(client, dbId, state);
      await this.pgWriteStructuredAudit(
        client,
        dbId,
        {
          action: 'system.schema_revert_approval_create',
          actor: { type: input.actorType ?? 'human', id: input.actorId ?? 'operator' },
          target: { type: 'schema_revert', id: approval.id },
          metadata: { expiresAt, targetVersionId: input.versionId ?? null, targetSnapshotId: input.snapshotId ?? null },
        },
        state,
      );
      return { approvalId: approval.id, approvalToken, expiresAt };
    });
  }

  async applySchemaPlan(dbId: string, input: ApplySchemaInput): Promise<{
    plan: SchemaPlanRecord;
    versionId: string;
    snapshot: SystemSnapshotRecord | null;
  }> {
    return this.pgTransaction(async (client) => {
      await this.pgSchemaAdvisoryLock(client, dbId);
      const state = await this.pgReadSystemState(client, dbId);
      const plan = state.schema.plans.find((item) => item.id === input.planId);
      if (!plan) throw new Error('schema plan not found');
      if (plan.status !== 'planned') throw new Error('schema plan is not pending');
      if (state.schema.liveHash !== plan.baseLiveHash || state.schema.lastAppliedHash !== plan.baseLastAppliedHash) {
        throw new Error('schema plan is stale; re-plan against the current live state');
      }
      if (plan.approvalRequired) this.pgConsumePlanApproval(state, plan, input.approvalToken);

      const snapshot =
        plan.snapshotRequired
          ? await this.pgCreateSystemSnapshotFromState(dbId, state, 'pre_apply', input.actorType ?? 'system', input.actorId ?? 'apply', client)
          : null;

      const appliedAt = nowIso();
      plan.status = 'applied';
      plan.appliedAt = appliedAt;
      state.schema.live = plan.desired;
      state.schema.liveHash = plan.desiredHash;
      state.schema.lastApplied = plan.desired;
      state.schema.lastAppliedHash = plan.desiredHash;
      if (snapshot) state.schema.snapshots.push(snapshot);
      const version = {
        id: `ver_${randomUUID().replace(/-/g, '')}`,
        desiredHash: plan.desiredHash,
        canonicalJson: plan.desired,
        planId: plan.id,
        planHash: plan.planHash,
        riskLevel: plan.riskLevel,
        applyStatus: 'applied' as const,
        createdAt: plan.createdAt,
        appliedAt,
      };
      state.schema.versions.push(version);
      await this.pgWriteSystemState(client, dbId, state);
      await this.pgWriteStructuredAudit(
        client,
        dbId,
        {
          action: 'system.schema_apply',
          actor: { type: input.actorType ?? 'system', id: input.actorId ?? 'apply' },
          target: { type: 'schema_version', id: version.id },
          metadata: {
            planId: plan.id,
            planHash: plan.planHash,
            riskLevel: plan.riskLevel,
            snapshotId: snapshot?.id ?? null,
          },
        },
        state,
      );
      return { plan, versionId: version.id, snapshot };
    });
  }

  async revertSchema(dbId: string, input: RevertSchemaInput): Promise<{
    versionId: string;
    revertedToHash: string | null;
    snapshot: SystemSnapshotRecord;
  }> {
    if (!input.versionId && !input.snapshotId) {
      throw new Error('schema revert requires a target version or snapshot');
    }
    return this.pgTransaction(async (client) => {
      await this.pgSchemaAdvisoryLock(client, dbId);
      const state = await this.pgReadSystemState(client, dbId);
      let targetLive: NimbusIr | null = null;
      let targetHash: string | null = null;

      if (input.snapshotId) {
        const restored = await this.pgReadSystemSnapshot(client, dbId, input.snapshotId);
        targetLive = restored.schema.live;
        targetHash = restored.schema.liveHash;
      } else {
        const targetVersion = input.versionId
          ? state.schema.versions.find((version) => version.id === input.versionId)
          : state.schema.versions.at(-2);
        if (!targetVersion) throw new Error('schema revert target not found');
        targetLive = targetVersion.canonicalJson;
        targetHash = targetVersion.desiredHash;
      }

      this.pgConsumeRevertApproval(state, input.approvalToken, {
        versionId: input.versionId,
        snapshotId: input.snapshotId,
      });

      const snapshot = await this.pgCreateSystemSnapshotFromState(
        dbId,
        state,
        'revert_point',
        input.actorType ?? 'system',
        input.actorId ?? 'revert',
        client,
      );

      const revertedAt = nowIso();
      state.schema.live = targetLive;
      state.schema.liveHash = targetHash;
      state.schema.lastApplied = targetLive;
      state.schema.lastAppliedHash = targetHash;
      state.schema.snapshots.push(snapshot);
      const version = {
        id: `ver_${randomUUID().replace(/-/g, '')}`,
        desiredHash: targetHash ?? 'sha256:empty',
        canonicalJson: targetLive ?? emptyNimbusDocument(),
        planId: 'revert',
        planHash: stableHash({ revert: input.versionId ?? input.snapshotId ?? 'previous', at: revertedAt }),
        riskLevel: 'high' as SchemaRiskLevel,
        applyStatus: 'reverted' as const,
        createdAt: revertedAt,
        appliedAt: revertedAt,
        revertedAt,
      };
      state.schema.versions.push(version);
      await this.pgWriteSystemState(client, dbId, state);
      await this.pgWriteStructuredAudit(
        client,
        dbId,
        {
          action: 'system.schema_revert',
          actor: { type: input.actorType ?? 'system', id: input.actorId ?? 'revert' },
          target: { type: 'schema_version', id: version.id },
          metadata: {
            targetVersionId: input.versionId ?? null,
            targetSnapshotId: input.snapshotId ?? null,
            snapshotId: snapshot.id,
          },
        },
        state,
      );
      return { versionId: version.id, revertedToHash: targetHash, snapshot };
    });
  }

  async createSystemSnapshot(dbId: string, kind: 'manual' | 'pre_apply' | 'revert_point' = 'manual'): Promise<SystemSnapshotRecord> {
    return this.pgTransaction(async (client) => {
      const state = await this.pgReadSystemState(client, dbId);
      const snapshot = await this.pgCreateSystemSnapshotFromState(dbId, state, kind, 'system', 'manual', client);
      state.schema.snapshots.push(snapshot);
      await this.pgWriteSystemState(client, dbId, state);
      await this.pgWriteStructuredAudit(
        client,
        dbId,
        {
          action: 'system.snapshot_create',
          actor: { type: 'system', id: 'manual' },
          target: { type: 'snapshot', id: snapshot.id },
          metadata: { kind },
        },
        state,
      );
      return snapshot;
    });
  }

  async writeSystemState(dbId: string, state: SystemState): Promise<void> {
    await this.pgWithClient((client) => this.pgWriteSystemState(client, dbId, state));
  }

  async writeAudit(
    dbId: string,
    event: {
      action: string;
      actor: { type: string; id: string };
      target: { type: string; id: string };
      metadata?: Record<string, unknown>;
    },
  ): Promise<void> {
    await this.pgWithClient((client) => this.pgWriteStructuredAudit(client, dbId, event));
  }

  async writeRecord(dbId: string, input: WriteRecordInput): Promise<PublicRecord> {
    return this.pgTransaction(async (client) => {
      const manifest = await this.pgRequireManifest(client, dbId);
      const createdAt = nowIso();
      const record = this.pgBuildStoredRecord(dbId, {
        id: randomUUID(),
        ...input,
      }, createdAt, createdAt);
      await this.pgAppendWal(client, dbId, { op: 'record_upsert', record, at: createdAt });
      await this.pgUpsertRecord(client, record);
      manifest.recordCount += 1;
      manifest.updatedAt = createdAt;
      await this.pgWriteManifest(client, manifest);
      return publicRecord(record);
    });
  }

  async updateRecord(dbId: string, input: UpsertRecordInput): Promise<PublicRecord> {
    return this.pgTransaction(async (client) => {
      const current = await this.pgGetStoredRecord(client, dbId, input.id);
      if (!current) throw new Error('record not found');
      const updatedAt = nowIso();
      const merged: WriteRecordInput & { id: string } = {
        id: current.id,
        type: input.type ?? current.type,
        key: input.key ?? current.key,
        title: input.title ?? current.title,
        content: input.content ?? (current.secret.contentEncrypted ? undefined : current.content),
        json: input.json ?? current.json,
        tags: input.tags ?? current.tags,
        vector: input.vector ?? current.vector,
        metadata: { ...current.metadata, ...(input.metadata ?? {}) },
        secrets: input.secrets,
        recordIsSecret: input.recordIsSecret ?? current.secret.recordIsSecret,
      };
      const record = this.pgBuildStoredRecord(dbId, merged, current.createdAt, updatedAt);
      await this.pgAppendWal(client, dbId, { op: 'record_upsert', record, at: updatedAt });
      await this.pgUpsertRecord(client, record);
      const manifest = await this.pgRequireManifest(client, dbId);
      manifest.updatedAt = updatedAt;
      await this.pgWriteManifest(client, manifest);
      return publicRecord(record);
    });
  }

  async deleteRecord(dbId: string, recordId: string): Promise<void> {
    await this.pgTransaction(async (client) => {
      const current = await this.pgGetStoredRecord(client, dbId, recordId);
      if (!current) throw new Error('record not found');
      const at = nowIso();
      await this.pgAppendWal(client, dbId, { op: 'record_delete', id: recordId, at });
      await client.query('delete from cumulus_data.records where db_id = $1 and record_id = $2', [dbId, recordId]);
      const manifest = await this.pgRequireManifest(client, dbId);
      manifest.deletedCount += 1;
      manifest.updatedAt = at;
      await this.pgWriteManifest(client, manifest);
    });
  }

  async getRecord(dbId: string, recordId: string): Promise<PublicRecord | null> {
    const record = await this.getStoredRecord(dbId, recordId);
    return record ? publicRecord(record) : null;
  }

  async getStoredRecord(dbId: string, recordId: string): Promise<StoredRecord | null> {
    return this.pgWithClient((client) => this.pgGetStoredRecord(client, dbId, recordId));
  }

  async listRecords(dbId: string): Promise<PublicRecord[]> {
    const records = await this.pgWithClient((client) => this.pgLoadRecords(client, dbId));
    return records
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      .map(publicRecord);
  }

  async putKeyValue(dbId: string, key: string, value: unknown, metadata: Record<string, unknown> = {}): Promise<PublicRecord> {
    const existing = await this.pgWithClient((client) => this.pgFindKeyValue(client, dbId, key));
    if (existing) {
      return this.updateRecord(dbId, { id: existing.id, type: 'kv', key, json: value, metadata });
    }
    return this.writeRecord(dbId, { type: 'kv', key, json: value, metadata });
  }

  async getKeyValue(dbId: string, key: string): Promise<PublicRecord | null> {
    const record = await this.pgWithClient((client) => this.pgFindKeyValue(client, dbId, key));
    return record ? publicRecord(record) : null;
  }

  async appendEvent(dbId: string, input: Omit<WriteRecordInput, 'type'>): Promise<PublicRecord> {
    return this.writeRecord(dbId, { ...input, type: 'event' });
  }

  async revealSecret(dbId: string, recordId: string, field?: string): Promise<{ value: string; field: string }> {
    return this.pgTransaction(async (client) => {
      const record = await this.pgGetStoredRecord(client, dbId, recordId);
      if (!record) throw new Error('record not found');
      if (field) {
        const payload = record.secretFieldsEnc[field];
        if (!payload) throw new Error('secret field not found');
        await this.pgAppendAudit(client, dbId, { action: 'secret_reveal', recordId, field, at: nowIso() });
        return { field, value: decryptString(payload, this.pgMasterKey) };
      }
      if (!record.contentEnc) throw new Error('secret content not found');
      await this.pgAppendAudit(client, dbId, { action: 'secret_reveal', recordId, field: 'content', at: nowIso() });
      return { field: 'content', value: decryptString(record.contentEnc, this.pgMasterKey) };
    });
  }

  async search(dbId: string, input: SearchInput): Promise<SearchHit[]> {
    const { searchRecords } = await import('./search.js');
    const records = await this.pgWithClient((client) => this.pgLoadRecords(client, dbId));
    return searchRecords(records, input).map((hit) => ({
      ...hit,
      record: publicRecord(hit.record),
    }));
  }

  async compact(dbId: string): Promise<{ segment: string; records: number }> {
    return this.pgTransaction(async (client) => {
      const records = await this.pgLoadRecords(client, dbId);
      const at = nowIso();
      const segment = `postgres-compact-${at.replace(/[:.]/g, '-')}`;
      await this.pgAppendWal(client, dbId, { op: 'compact', at });
      const manifest = await this.pgRequireManifest(client, dbId);
      manifest.lastCompactedAt = at;
      manifest.activeSegment = segment;
      manifest.recordCount = records.length;
      manifest.updatedAt = at;
      await this.pgWriteManifest(client, manifest);
      await this.pgAppendAudit(client, dbId, { action: 'compact', segment, records: records.length, at });
      return { segment, records: records.length };
    });
  }

  async backup(dbId: string): Promise<{ path: string; records: number }> {
    return this.pgTransaction(async (client) => {
      const manifest = await this.pgRequireManifest(client, dbId);
      const records = await this.pgLoadRecords(client, dbId);
      const tokens = await this.pgReadTokens(client, dbId);
      const system = await this.pgReadSystemState(client, dbId);
      const at = nowIso();
      const id = `backup_${randomUUID().replace(/-/g, '')}`;
      const path = `postgres://cumulus_data.snapshots/${dbId}/${id}`;
      const payload = { manifest, records, tokens, system, createdAt: at };
      const crypto = encryptStringWithWrappedDek(JSON.stringify(payload), this.pgMasterKey, {
        dbId,
        kind: 'backup',
        createdAt: at,
      });
      await client.query(
        `insert into cumulus_data.snapshots
          (db_id, snapshot_id, snapshot_kind, snapshot_json, ciphertext, metadata_json, created_at)
         values ($1, $2, $3, $4, $5, $6, $7)`,
        [
          dbId,
          id,
          'backup',
          { id, kind: 'backup', createdAt: at, crypto },
          null,
          { recordCount: records.length },
          at,
        ],
      );
      await this.pgAppendAudit(client, dbId, { action: 'backup', path, records: records.length, at });
      return { path, records: records.length };
    });
  }

  async destroyAllForTests(): Promise<void> {
    await this.pool.query('drop schema if exists cumulus_data cascade');
    await this.pool.query('drop schema if exists cumulus_system cascade');
    await this.close();
  }

  private async pgApplyRuntimeSchema(): Promise<void> {
    await this.pgTransaction(async (client) => {
      await client.query("select pg_advisory_xact_lock(hashtext('cumulus-db'), hashtext('runtime-schema'))");
      await client.query(POSTGRES_RUNTIME_DDL);
      await client.query(
        'insert into cumulus_data.schema_migrations (version) values ($1), ($2) on conflict (version) do nothing',
        [POSTGRES_SYSTEM_SCHEMA_VERSION, POSTGRES_DATA_SCHEMA_VERSION],
      );
    });
  }

  private async pgWithClient<T>(fn: (client: PgClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      return await fn(client);
    } finally {
      client.release();
    }
  }

  private async pgTransaction<T>(fn: (client: PgClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('begin');
      const result = await fn(client);
      await client.query('commit');
      return result;
    } catch (err) {
      await client.query('rollback').catch(() => undefined);
      throw err;
    } finally {
      client.release();
    }
  }

  private async pgSchemaAdvisoryLock(client: PgClient, dbId: string): Promise<void> {
    await client.query('select pg_advisory_xact_lock(hashtext($1), hashtext($2))', ['cumulus-db-schema', dbId]);
  }

  private async pgGetManifest(dbId: string): Promise<WorkspaceManifest | null> {
    return this.pgWithClient((client) => this.pgReadManifest(client, dbId));
  }

  private async pgReadManifest(client: PgClient, dbId: string): Promise<WorkspaceManifest | null> {
    const result = await client.query<{ manifest_json: WorkspaceManifest }>(
      'select manifest_json from cumulus_data.manifests where db_id = $1',
      [dbId],
    );
    return result.rows[0]?.manifest_json ?? null;
  }

  private async pgRequireManifest(client: PgClient, dbId: string): Promise<WorkspaceManifest> {
    const manifest = await this.pgReadManifest(client, dbId);
    if (!manifest) throw new Error('workspace not found');
    return manifest;
  }

  private async pgWriteManifest(client: PgClient, manifest: WorkspaceManifest): Promise<void> {
    await client.query(
      `insert into cumulus_data.manifests (db_id, manifest_json, created_at, updated_at)
       values ($1, $2, $3, $4)
       on conflict (db_id) do update
       set manifest_json = excluded.manifest_json, updated_at = excluded.updated_at`,
      [manifest.id, manifest, manifest.createdAt, manifest.updatedAt],
    );
  }

  private async pgReadTokens(client: PgClient, dbId: string): Promise<TokenRecord[]> {
    const result = await client.query<{ token_json: TokenRecord }>(
      'select token_json from cumulus_data.tokens where db_id = $1 order by created_at asc',
      [dbId],
    );
    return result.rows.map((row) => row.token_json);
  }

  private async pgUpsertToken(client: PgClient, dbId: string, token: TokenRecord): Promise<void> {
    await client.query(
      `insert into cumulus_data.tokens
        (db_id, token_id, token_public_id, secret_mac, token_json, created_at, last_used_at, revoked_at)
       values ($1, $2, $3, $4, $5, $6, $7, $8)
       on conflict (db_id, token_id) do update
       set token_public_id = excluded.token_public_id,
           secret_mac = excluded.secret_mac,
           token_json = excluded.token_json,
           last_used_at = excluded.last_used_at,
           revoked_at = excluded.revoked_at`,
      [
        dbId,
        token.id,
        token.tokenPublicId ?? null,
        token.secretMac ?? null,
        token,
        token.createdAt,
        timestamp(token.lastUsedAt),
        timestamp(token.revokedAt),
      ],
    );
  }

  private async pgReadSystemState(client: PgClient, dbId: string): Promise<SystemState> {
    const result = await client.query<{ state_json: SystemState }>(
      'select state_json from cumulus_data.system_state where db_id = $1',
      [dbId],
    );
    const existing = result.rows[0]?.state_json;
    if (existing) return existing;

    const manifest = await this.pgRequireManifest(client, dbId);
    const state = newSystemState({
      dbId,
      ownerAgentId: manifest.ownerAgentId,
      humanOwnerEmail: manifest.humanOwnerEmail,
      createdAt: manifest.createdAt,
    });
    await this.pgWriteSystemState(client, dbId, state);
    return state;
  }

  private async pgWriteSystemState(client: PgClient, dbId: string, state: SystemState): Promise<void> {
    await client.query(
      `insert into cumulus_data.system_state (db_id, state_json, updated_at)
       values ($1, $2, $3)
       on conflict (db_id) do update
       set state_json = excluded.state_json, updated_at = excluded.updated_at`,
      [dbId, state, nowIso()],
    );
  }

  private async pgAppendAudit(client: PgClient, dbId: string, event: unknown): Promise<void> {
    const at =
      event && typeof event === 'object' && 'at' in event && typeof (event as { at?: unknown }).at === 'string'
        ? (event as { at: string }).at
        : nowIso();
    await client.query(
      'insert into cumulus_data.audit_logs (db_id, event_json, created_at) values ($1, $2, $3)',
      [dbId, event, at],
    );
  }

  private async pgWriteStructuredAudit(
    client: PgClient,
    dbId: string,
    event: {
      action: string;
      actor: { type: string; id: string };
      target: { type: string; id: string };
      metadata?: Record<string, unknown>;
    },
    state?: SystemState,
  ): Promise<void> {
    const currentState = state ?? await this.pgReadSystemState(client, dbId);
    await this.pgAppendAudit(client, dbId, {
      id: `aud_${randomUUID().replace(/-/g, '')}`,
      orgId: currentState.org.id,
      action: event.action,
      actorType: event.actor.type,
      actorId: event.actor.id,
      targetType: event.target.type,
      targetId: event.target.id,
      requestId: `req_${randomUUID().replace(/-/g, '')}`,
      metadata: event.metadata ?? {},
      at: nowIso(),
    });
  }

  private pgApprovalTokenMac(token: string): string {
    return createHmac('sha256', this.pgMasterKey).update(token).digest('hex');
  }

  private pgConsumePlanApproval(state: SystemState, plan: SchemaPlanRecord, approvalToken?: string): void {
    if (!approvalToken) throw new Error('approval token required for destructive schema plan');
    const approval = state.approvals.find(
      (item) =>
        item.planId === plan.id &&
        item.planHash === plan.planHash &&
        item.scope === 'schema:apply_destructive' &&
        !item.usedAt &&
        item.tokenHash === this.pgApprovalTokenMac(approvalToken),
    );
    if (!approval || Date.parse(approval.expiresAt) <= Date.now()) {
      throw new Error('valid approval token required for destructive schema plan');
    }
    approval.usedAt = nowIso();
  }

  private pgConsumeRevertApproval(
    state: SystemState,
    approvalToken: string | undefined,
    target: { versionId?: string; snapshotId?: string },
  ): void {
    if (!approvalToken) throw new Error('approval token required for schema revert');
    const approval = state.approvals.find(
      (item) =>
        item.planId === 'revert' &&
        item.scope === 'schema:revert_local' &&
        (item.targetVersionId ?? null) === (target.versionId ?? null) &&
        (item.targetSnapshotId ?? null) === (target.snapshotId ?? null) &&
        !item.usedAt &&
        item.tokenHash === this.pgApprovalTokenMac(approvalToken),
    );
    if (!approval || Date.parse(approval.expiresAt) <= Date.now()) {
      throw new Error('valid approval token required for schema revert');
    }
    approval.usedAt = nowIso();
  }

  private async pgCreateSystemSnapshotFromState(
    dbId: string,
    state: SystemState,
    kind: 'pre_apply' | 'manual' | 'revert_point',
    createdByType: 'human' | 'agent' | 'app' | 'system',
    createdById: string,
    client: PgClient,
  ): Promise<SystemSnapshotRecord> {
    const id = `snap_${randomUUID().replace(/-/g, '')}`;
    const createdAt = nowIso();
    const path = `postgres://cumulus_data.snapshots/${dbId}/${id}`;
    const manifest = await this.pgRequireManifest(client, dbId);
    const wal = await this.pgReadWalAsJsonl(client, dbId);
    const storedRecords = await this.pgLoadRecords(client, dbId);
    const payload = {
      version: 1,
      dbId,
      kind,
      createdAt,
      manifest,
      state,
      wal,
      storedRecords,
    };
    const crypto = encryptStringWithWrappedDek(JSON.stringify(payload), this.pgMasterKey, { dbId, kind, createdAt });
    const metadata = {
      recordCount: storedRecords.length,
      liveHash: state.schema.liveHash,
      lastAppliedHash: state.schema.lastAppliedHash,
    };
    await client.query(
      `insert into cumulus_data.snapshots
        (db_id, snapshot_id, snapshot_kind, snapshot_json, ciphertext, metadata_json, created_at)
       values ($1, $2, $3, $4, $5, $6, $7)`,
      [
        dbId,
        id,
        kind,
        { id, kind, createdAt, crypto },
        null,
        metadata,
        createdAt,
      ],
    );
    return {
      id,
      kind,
      path,
      createdAt,
      createdByType,
      createdById,
      metadata,
    };
  }

  private async pgReadSystemSnapshot(client: PgClient, dbId: string, snapshotId: string): Promise<SystemState> {
    const result = await client.query<{ ciphertext: string | null; snapshot_json: { crypto?: WrappedEncryptedString } | null }>(
      'select ciphertext, snapshot_json from cumulus_data.snapshots where db_id = $1 and snapshot_id = $2',
      [dbId, snapshotId],
    );
    const row = result.rows[0];
    if (!row) throw new Error('schema revert snapshot not found');
    const body = row.snapshot_json?.crypto
      ? decryptStringWithWrappedDek(row.snapshot_json.crypto, this.pgMasterKey)
      : decryptString(row.ciphertext ?? '', this.pgMasterKey);
    const payload = JSON.parse(body) as { state: SystemState };
    return payload.state;
  }

  private pgBuildStoredRecord(
    dbId: string,
    input: WriteRecordInput & { id: string },
    createdAt: string,
    updatedAt: string,
  ): StoredRecord {
    const tags = [...new Set((input.tags ?? []).map((tag) => String(tag).trim()).filter(Boolean))];
    const secretValues = input.secrets ?? {};
    const secretScan = detectSecretKeys({
      ...secretValues,
      ...(input.json && typeof input.json === 'object' && !Array.isArray(input.json)
        ? (input.json as Record<string, unknown>)
        : {}),
      ...(input.key ? { [input.key]: input.content ?? '' } : {}),
    });
    const recordIsSecret = Boolean(input.recordIsSecret);
    const content = input.content ?? null;
    const secretFieldsEnc = Object.fromEntries(
      Object.entries(secretValues).map(([key, value]) => [
        key,
        encryptString(String(value), this.pgMasterKey),
      ]),
    );

    return {
      id: input.id,
      dbId,
      type: input.type,
      ...(input.key ? { key: input.key } : {}),
      ...(input.title ? { title: input.title } : {}),
      content: recordIsSecret && content !== null ? null : content,
      ...(recordIsSecret && content !== null
        ? { contentEnc: encryptString(content, this.pgMasterKey) }
        : {}),
      ...(input.json !== undefined ? { json: input.json } : {}),
      tags,
      ...(input.vector ? { vector: normalizeVector(input.vector) } : {}),
      metadata: input.metadata ?? {},
      secret: {
        recordIsSecret,
        ...(recordIsSecret ? { contentEncrypted: true } : {}),
        fields: Object.keys(secretFieldsEnc),
        likelySecretKeys: secretScan.likelySecretKeys,
        detectorWarnings: secretScan.warnings,
      },
      secretFieldsEnc,
      createdAt,
      updatedAt,
    };
  }

  private async pgAppendWal(client: PgClient, dbId: string, op: Operation): Promise<void> {
    await client.query(
      `insert into cumulus_data.wal_entries (db_id, operation, record_id, entry_json, created_at)
       values ($1, $2, $3, $4, $5)`,
      [dbId, op.op, op.record?.id ?? op.id ?? null, op, op.at],
    );
  }

  private async pgReadWalAsJsonl(client: PgClient, dbId: string): Promise<string> {
    const result = await client.query<{ entry_json: Operation }>(
      'select entry_json from cumulus_data.wal_entries where db_id = $1 order by id asc',
      [dbId],
    );
    return result.rows.map((row) => JSON.stringify(row.entry_json)).join('\n') + (result.rows.length ? '\n' : '');
  }

  private async pgUpsertRecord(client: PgClient, record: StoredRecord): Promise<void> {
    await client.query(
      `insert into cumulus_data.records
        (db_id, record_id, record_type, record_key, record_json, created_at, updated_at)
       values ($1, $2, $3, $4, $5, $6, $7)
       on conflict (db_id, record_id) do update
       set record_type = excluded.record_type,
           record_key = excluded.record_key,
           record_json = excluded.record_json,
           updated_at = excluded.updated_at`,
      [
        record.dbId,
        record.id,
        record.type,
        record.key ?? null,
        record,
        record.createdAt,
        record.updatedAt,
      ],
    );
  }

  private async pgGetStoredRecord(client: PgClient, dbId: string, recordId: string): Promise<StoredRecord | null> {
    const result = await client.query<{ record_json: StoredRecord }>(
      'select record_json from cumulus_data.records where db_id = $1 and record_id = $2',
      [dbId, recordId],
    );
    return result.rows[0]?.record_json ?? null;
  }

  private async pgLoadRecords(client: PgClient, dbId: string): Promise<StoredRecord[]> {
    const result = await client.query<{ record_json: StoredRecord }>(
      'select record_json from cumulus_data.records where db_id = $1 order by updated_at desc',
      [dbId],
    );
    return result.rows.map((row) => row.record_json);
  }

  private async pgFindKeyValue(client: PgClient, dbId: string, key: string): Promise<StoredRecord | null> {
    const result = await client.query<{ record_json: StoredRecord }>(
      `select record_json
       from cumulus_data.records
       where db_id = $1 and record_type = 'kv' and record_key = $2
       order by updated_at desc
       limit 1`,
      [dbId, key],
    );
    return result.rows[0]?.record_json ?? null;
  }
}

export function postgresDataDdlForTests(): string {
  return POSTGRES_DATA_DDL;
}
