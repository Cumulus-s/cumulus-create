// SPDX-License-Identifier: AGPL-3.0-only
import { createHmac, randomBytes, randomUUID } from 'node:crypto';
import { mkdir, open, readFile, rename, rm, unlink, writeFile } from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import { dirname, join } from 'node:path';
import { assertNimbusNamespaceAllowed, compileNimbus, validateNimbusIr, type NimbusIr } from './nimbus.js';
import {
  decryptString,
  decryptStringWithWrappedDek,
  encryptString,
  encryptStringWithWrappedDek,
  type WrappedEncryptedString,
} from './crypto.js';
import { detectSecretKeys } from './secrets.js';
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
  op: 'record_upsert' | 'record_delete';
  record?: StoredRecord;
  id?: string;
  at: string;
}

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

function safeId(id: string): string {
  if (!/^[A-Za-z0-9_-]+$/.test(id)) {
    throw new Error('invalid id');
  }
  return id;
}

async function readJson<T>(path: string, fallback: T): Promise<T> {
  try {
    return JSON.parse(await readFile(path, 'utf8')) as T;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return fallback;
    throw err;
  }
}

async function atomicWrite(path: string, body: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const tmp = `${path}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(tmp, body, 'utf8');
  await rename(tmp, path);
}

async function appendJsonLine(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await new Promise<void>((resolve, reject) => {
    const stream = createWriteStream(path, { flags: 'a' });
    stream.on('error', reject);
    stream.end(`${JSON.stringify(value)}\n`, () => resolve());
  });
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

export class CumulusDbEngine {
  constructor(
    private readonly dataDir: string,
    private readonly masterKey: Buffer,
  ) {}

  private workspaceDir(dbId: string): string {
    return join(this.dataDir, 'databases', safeId(dbId));
  }

  private manifestPath(dbId: string): string {
    return join(this.workspaceDir(dbId), 'manifest.json');
  }

  private tokensPath(dbId: string): string {
    return join(this.workspaceDir(dbId), 'tokens.json');
  }

  private walPath(dbId: string): string {
    return join(this.workspaceDir(dbId), 'wal.jsonl');
  }

  private segmentPath(dbId: string, segment: string): string {
    return join(this.workspaceDir(dbId), 'segments', segment);
  }

  private auditPath(dbId: string): string {
    return join(this.workspaceDir(dbId), 'audit.jsonl');
  }

  private systemStatePath(dbId: string): string {
    return join(this.workspaceDir(dbId), 'system', 'state.json');
  }

  private systemSnapshotDir(dbId: string): string {
    return join(this.workspaceDir(dbId), 'system', 'snapshots');
  }

  private systemLockPath(dbId: string): string {
    return join(this.workspaceDir(dbId), 'system', 'apply.lock');
  }

  async ensureRoot(): Promise<void> {
    await mkdir(join(this.dataDir, 'databases'), { recursive: true });
  }

  async createWorkspace(input: CreateWorkspaceInput): Promise<{
    manifest: WorkspaceManifest;
    dataToken: TokenIssue;
    adminToken: TokenIssue;
  }> {
    await this.ensureRoot();
    const id = `db_${randomUUID().replace(/-/g, '')}`;
    const createdAt = nowIso();
    const activeSegment = 'segment-000001.jsonl';
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
    const tokens = issueWorkspaceTokens(this.masterKey);
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

    await mkdir(join(this.workspaceDir(id), 'segments'), { recursive: true });
    await mkdir(join(this.workspaceDir(id), 'backups'), { recursive: true });
    await mkdir(this.systemSnapshotDir(id), { recursive: true });
    await atomicWrite(this.manifestPath(id), `${JSON.stringify(manifest, null, 2)}\n`);
    await atomicWrite(this.tokensPath(id), `${JSON.stringify(tokens.records, null, 2)}\n`);
    await atomicWrite(this.systemStatePath(id), `${JSON.stringify(systemState, null, 2)}\n`);
    await atomicWrite(this.walPath(id), '');
    await atomicWrite(this.segmentPath(id, activeSegment), '');
    await appendJsonLine(this.auditPath(id), { action: 'workspace_create', at: createdAt });

    return { manifest, dataToken: tokens.data, adminToken: tokens.admin };
  }

  async listWorkspaces(): Promise<WorkspaceManifest[]> {
    await this.ensureRoot();
    const { readdir } = await import('node:fs/promises');
    const dbRoot = join(this.dataDir, 'databases');
    const entries = await readdir(dbRoot, { withFileTypes: true });
    const manifests: WorkspaceManifest[] = [];
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      manifests.push(await this.getManifest(entry.name));
    }
    return manifests.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  async getManifest(dbId: string): Promise<WorkspaceManifest> {
    return readJson<WorkspaceManifest>(this.manifestPath(dbId), null as never);
  }

  async authenticate(dbId: string, token: string, required: TokenScope[]): Promise<TokenRecord> {
    const tokens = await this.readTokens(dbId);
    const match = tokens.find((item) => verifyTokenRecord(item, token, this.masterKey) && !item.revokedAt);
    if (!match || !hasScopes(match, required)) {
      throw new Error('unauthorized');
    }
    match.lastUsedAt = nowIso();
    await this.writeTokens(dbId, tokens);
    return match;
  }

  async readTokens(dbId: string): Promise<TokenRecord[]> {
    return readJson<TokenRecord[]>(this.tokensPath(dbId), []);
  }

  async writeTokens(dbId: string, tokens: TokenRecord[]): Promise<void> {
    await atomicWrite(this.tokensPath(dbId), `${JSON.stringify(tokens, null, 2)}\n`);
  }

  async createToken(dbId: string, label: string, scopes: TokenScope[]): Promise<TokenIssue> {
    const tokens = await this.readTokens(dbId);
    const normalizedScopes = scopes.length ? normalizeTokenScopes(scopes) : ALL_DATA_SCOPES;
    const systemToken = normalizedScopes.some((scope) => isHardSystemScope(scope));
    const issued = issueToken(label, normalizedScopes, systemToken ? 'cu_pat' : 'cdb_data', this.masterKey, {
      kind: systemToken ? 'pat' : 'data',
    });
    tokens.push(issued.record);
    await this.writeTokens(dbId, tokens);
    await appendJsonLine(this.auditPath(dbId), { action: 'token_create', tokenId: issued.record.id, at: nowIso() });
    return issued.issue;
  }

  async rotateToken(dbId: string, tokenId: string): Promise<TokenIssue> {
    const tokens = await this.readTokens(dbId);
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
      this.masterKey,
      {
        kind: current.tokenKind,
        principalType: current.principalType,
        principalId: current.principalId,
        expiresAt: current.expiresAt,
        rotatedFromId: current.id,
      },
    );
    tokens.push(issued.record);
    await this.writeTokens(dbId, tokens);
    await appendJsonLine(this.auditPath(dbId), { action: 'token_rotate', oldTokenId: tokenId, newTokenId: issued.record.id, at: nowIso() });
    return issued.issue;
  }

  async revokeToken(dbId: string, tokenId: string): Promise<void> {
    const tokens = await this.readTokens(dbId);
    const current = tokens.find((token) => token.id === tokenId);
    if (!current) throw new Error('token not found');
    current.revokedAt = current.revokedAt ?? nowIso();
    await this.writeTokens(dbId, tokens);
    await appendJsonLine(this.auditPath(dbId), { action: 'token_revoke', tokenId, at: current.revokedAt });
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
      this.masterKey,
      { kind: 'agent', principalType: 'agent', principalId: agentId },
    );
    const tokens = await this.readTokens(created.manifest.id);
    tokens.push(tokenRecord.record);
    await this.writeTokens(created.manifest.id, tokens);

    const state = await this.readSystemState(created.manifest.id);
    state.principals = state.principals.map((principal) =>
      principal.id === agentId
        ? { ...principal, displayName: input.displayName ?? principal.displayName, grants: DEFAULT_AGENT_SYSTEM_SCOPES }
        : principal,
    );
    await this.writeSystemState(created.manifest.id, state);
    await this.writeAudit(created.manifest.id, {
      action: 'system.agent_bootstrap',
      actor: { type: 'agent', id: agentId },
      target: { type: 'agent', id: agentId },
      metadata: { scopes: DEFAULT_AGENT_SYSTEM_SCOPES },
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
    return this.readSystemState(dbId);
  }

  async listAudit(dbId: string, limit = 100): Promise<unknown[]> {
    const raw = await readFile(this.auditPath(dbId), 'utf8').catch((err: NodeJS.ErrnoException) => {
      if (err.code === 'ENOENT') return '';
      throw err;
    });
    return raw
      .split('\n')
      .filter((line) => line.trim())
      .map((line) => JSON.parse(line) as unknown)
      .slice(-Math.max(1, Math.min(limit, 500)))
      .reverse();
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
    const state = await this.readSystemState(dbId);
    const plan = buildSchemaPlan({
      desired,
      desiredHash,
      live: state.schema.live,
      lastApplied: state.schema.lastApplied,
      createdAt: nowIso(),
    });
    state.schema.plans.push(plan);
    await this.writeSystemState(dbId, state);
    await this.writeAudit(dbId, {
      action: 'system.schema_plan',
      actor: { type: 'system', id: 'planner' },
      target: { type: 'schema_plan', id: plan.id },
      metadata: {
        planHash: plan.planHash,
        riskLevel: plan.riskLevel,
        operations: plan.operations.map((operation) => operation.kind),
      },
    });
    return plan;
  }

  async createSchemaApproval(dbId: string, planId: string, actorType: 'human' | 'agent' | 'system' = 'human', actorId = 'operator'): Promise<{
    approvalId: string;
    approvalToken: string;
    expiresAt: string;
  }> {
    const state = await this.readSystemState(dbId);
    const plan = state.schema.plans.find((item) => item.id === planId);
    if (!plan) throw new Error('schema plan not found');
    const approvalToken = randomBytes(32).toString('base64url');
    const createdAt = nowIso();
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000).toISOString();
    const approval = {
      id: `apv_${randomUUID().replace(/-/g, '')}`,
      tokenHash: this.approvalTokenMac(approvalToken),
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
    await this.writeSystemState(dbId, state);
    await this.writeAudit(dbId, {
      action: 'system.schema_approval_create',
      actor: { type: actorType, id: actorId },
      target: { type: 'schema_plan', id: plan.id },
      metadata: { approvalId: approval.id, planHash: plan.planHash, expiresAt },
    });
    return { approvalId: approval.id, approvalToken, expiresAt };
  }

  async createRevertApproval(dbId: string, input: CreateRevertApprovalInput): Promise<{
    approvalId: string;
    approvalToken: string;
    expiresAt: string;
  }> {
    if (!input.versionId && !input.snapshotId) {
      throw new Error('revert approval requires a target version or snapshot');
    }
    const state = await this.readSystemState(dbId);
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
      tokenHash: this.approvalTokenMac(approvalToken),
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
    await this.writeSystemState(dbId, state);
    await this.writeAudit(dbId, {
      action: 'system.schema_revert_approval_create',
      actor: { type: input.actorType ?? 'human', id: input.actorId ?? 'operator' },
      target: { type: 'schema_revert', id: approval.id },
      metadata: { expiresAt, targetVersionId: input.versionId ?? null, targetSnapshotId: input.snapshotId ?? null },
    });
    return { approvalId: approval.id, approvalToken, expiresAt };
  }

  async applySchemaPlan(dbId: string, input: ApplySchemaInput): Promise<{
    plan: SchemaPlanRecord;
    versionId: string;
    snapshot: SystemSnapshotRecord | null;
  }> {
    return this.withSystemLock(dbId, async () => this.applySchemaPlanLocked(dbId, input));
  }

  private async applySchemaPlanLocked(dbId: string, input: ApplySchemaInput): Promise<{
    plan: SchemaPlanRecord;
    versionId: string;
    snapshot: SystemSnapshotRecord | null;
  }> {
    const state = await this.readSystemState(dbId);
    const plan = state.schema.plans.find((item) => item.id === input.planId);
    if (!plan) throw new Error('schema plan not found');
    if (plan.status !== 'planned') throw new Error('schema plan is not pending');
    if (state.schema.liveHash !== plan.baseLiveHash || state.schema.lastAppliedHash !== plan.baseLastAppliedHash) {
      throw new Error('schema plan is stale; re-plan against the current live state');
    }
    if (plan.approvalRequired) this.consumePlanApproval(state, plan, input.approvalToken);

    const snapshot =
      plan.snapshotRequired
        ? await this.createSystemSnapshotFromState(dbId, state, 'pre_apply', input.actorType ?? 'system', input.actorId ?? 'apply')
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
    await this.writeSystemState(dbId, state);
    await this.writeAudit(dbId, {
      action: 'system.schema_apply',
      actor: { type: input.actorType ?? 'system', id: input.actorId ?? 'apply' },
      target: { type: 'schema_version', id: version.id },
      metadata: {
        planId: plan.id,
        planHash: plan.planHash,
        riskLevel: plan.riskLevel,
        snapshotId: snapshot?.id ?? null,
      },
    });
    return { plan, versionId: version.id, snapshot };
  }

  async revertSchema(dbId: string, input: RevertSchemaInput): Promise<{
    versionId: string;
    revertedToHash: string | null;
    snapshot: SystemSnapshotRecord;
  }> {
    return this.withSystemLock(dbId, async () => this.revertSchemaLocked(dbId, input));
  }

  private async revertSchemaLocked(dbId: string, input: RevertSchemaInput): Promise<{
    versionId: string;
    revertedToHash: string | null;
    snapshot: SystemSnapshotRecord;
  }> {
    if (!input.versionId && !input.snapshotId) {
      throw new Error('schema revert requires a target version or snapshot');
    }
    const state = await this.readSystemState(dbId);
    let targetLive: NimbusIr | null = null;
    let targetHash: string | null = null;

    if (input.snapshotId) {
      const restored = await this.readSystemSnapshot(dbId, input.snapshotId);
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

    this.consumeRevertApproval(state, input.approvalToken, {
      versionId: input.versionId,
      snapshotId: input.snapshotId,
    });

    const snapshot = await this.createSystemSnapshotFromState(
      dbId,
      state,
      'revert_point',
      input.actorType ?? 'system',
      input.actorId ?? 'revert',
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
    await this.writeSystemState(dbId, state);
    await this.writeAudit(dbId, {
      action: 'system.schema_revert',
      actor: { type: input.actorType ?? 'system', id: input.actorId ?? 'revert' },
      target: { type: 'schema_version', id: version.id },
      metadata: {
        targetVersionId: input.versionId ?? null,
        targetSnapshotId: input.snapshotId ?? null,
        snapshotId: snapshot.id,
      },
    });
    return { versionId: version.id, revertedToHash: targetHash, snapshot };
  }

  private async withSystemLock<T>(dbId: string, fn: () => Promise<T>): Promise<T> {
    const lockPath = this.systemLockPath(dbId);
    await mkdir(dirname(lockPath), { recursive: true });
    let handle: Awaited<ReturnType<typeof open>> | undefined;
    try {
      handle = await open(lockPath, 'wx');
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'EEXIST') {
        throw new Error('schema operation already in progress');
      }
      throw err;
    }
    try {
      await handle.writeFile(`${JSON.stringify({ pid: process.pid, createdAt: nowIso() })}\n`, 'utf8');
      return await fn();
    } finally {
      await handle.close().catch(() => undefined);
      await unlink(lockPath).catch(() => undefined);
    }
  }

  async createSystemSnapshot(dbId: string, kind: 'manual' | 'pre_apply' | 'revert_point' = 'manual'): Promise<SystemSnapshotRecord> {
    const state = await this.readSystemState(dbId);
    const snapshot = await this.createSystemSnapshotFromState(dbId, state, kind, 'system', 'manual');
    state.schema.snapshots.push(snapshot);
    await this.writeSystemState(dbId, state);
    await this.writeAudit(dbId, {
      action: 'system.snapshot_create',
      actor: { type: 'system', id: 'manual' },
      target: { type: 'snapshot', id: snapshot.id },
      metadata: { kind },
    });
    return snapshot;
  }

  async writeRecord(dbId: string, input: WriteRecordInput): Promise<PublicRecord> {
    const manifest = await this.getManifest(dbId);
    const createdAt = nowIso();
    const record = this.buildStoredRecord(dbId, {
      id: randomUUID(),
      ...input,
    }, createdAt, createdAt);
    await this.appendOperation(dbId, { op: 'record_upsert', record, at: createdAt });
    await appendJsonLine(this.segmentPath(dbId, manifest.activeSegment), record);
    await this.updateManifest(dbId, (draft) => {
      draft.recordCount += 1;
      draft.updatedAt = createdAt;
    });
    return publicRecord(record);
  }

  async updateRecord(dbId: string, input: UpsertRecordInput): Promise<PublicRecord> {
    const current = await this.getStoredRecord(dbId, input.id);
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
    const record = this.buildStoredRecord(dbId, merged, current.createdAt, updatedAt);
    await this.appendOperation(dbId, { op: 'record_upsert', record, at: updatedAt });
    await appendJsonLine(this.segmentPath(dbId, (await this.getManifest(dbId)).activeSegment), record);
    await this.updateManifest(dbId, (draft) => {
      draft.updatedAt = updatedAt;
    });
    return publicRecord(record);
  }

  private buildStoredRecord(
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
        encryptString(String(value), this.masterKey),
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
        ? { contentEnc: encryptString(content, this.masterKey) }
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

  async deleteRecord(dbId: string, recordId: string): Promise<void> {
    const current = await this.getStoredRecord(dbId, recordId);
    if (!current) throw new Error('record not found');
    const at = nowIso();
    await this.appendOperation(dbId, {
      op: 'record_delete',
      id: recordId,
      at,
    });
    await this.updateManifest(dbId, (draft) => {
      draft.deletedCount += 1;
      draft.updatedAt = at;
    });
  }

  async getRecord(dbId: string, recordId: string): Promise<PublicRecord | null> {
    const record = await this.getStoredRecord(dbId, recordId);
    return record ? publicRecord(record) : null;
  }

  async getStoredRecord(dbId: string, recordId: string): Promise<StoredRecord | null> {
    const records = await this.loadRecords(dbId);
    return records.get(recordId) ?? null;
  }

  async listRecords(dbId: string): Promise<PublicRecord[]> {
    const records = await this.loadRecords(dbId);
    return [...records.values()]
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      .map(publicRecord);
  }

  async putKeyValue(dbId: string, key: string, value: unknown, metadata: Record<string, unknown> = {}): Promise<PublicRecord> {
    const existing = [...(await this.loadRecords(dbId)).values()].find((record) => record.type === 'kv' && record.key === key);
    if (existing) {
      return this.updateRecord(dbId, { id: existing.id, type: 'kv', key, json: value, metadata });
    }
    return this.writeRecord(dbId, { type: 'kv', key, json: value, metadata });
  }

  async getKeyValue(dbId: string, key: string): Promise<PublicRecord | null> {
    const records = await this.loadRecords(dbId);
    const record = [...records.values()].find((item) => item.type === 'kv' && item.key === key);
    return record ? publicRecord(record) : null;
  }

  async appendEvent(dbId: string, input: Omit<WriteRecordInput, 'type'>): Promise<PublicRecord> {
    return this.writeRecord(dbId, { ...input, type: 'event' });
  }

  async revealSecret(dbId: string, recordId: string, field?: string): Promise<{ value: string; field: string }> {
    const record = await this.getStoredRecord(dbId, recordId);
    if (!record) throw new Error('record not found');
    if (field) {
      const payload = record.secretFieldsEnc[field];
      if (!payload) throw new Error('secret field not found');
      await appendJsonLine(this.auditPath(dbId), { action: 'secret_reveal', recordId, field, at: nowIso() });
      return { field, value: decryptString(payload, this.masterKey) };
    }
    if (!record.contentEnc) throw new Error('secret content not found');
    await appendJsonLine(this.auditPath(dbId), { action: 'secret_reveal', recordId, field: 'content', at: nowIso() });
    return { field: 'content', value: decryptString(record.contentEnc, this.masterKey) };
  }

  async search(dbId: string, input: SearchInput): Promise<SearchHit[]> {
    const { searchRecords } = await import('./search.js');
    return searchRecords([...(await this.loadRecords(dbId)).values()], input).map((hit) => ({
      ...hit,
      record: publicRecord(hit.record),
    }));
  }

  async compact(dbId: string): Promise<{ segment: string; records: number }> {
    const records = [...(await this.loadRecords(dbId)).values()];
    const at = nowIso();
    const segment = `compact-${at.replace(/[:.]/g, '-')}.jsonl`;
    await atomicWrite(
      this.segmentPath(dbId, segment),
      records.map((record) => JSON.stringify(record)).join('\n') + (records.length ? '\n' : ''),
    );
    await atomicWrite(
      this.walPath(dbId),
      records.map((record) => JSON.stringify({ op: 'record_upsert', record, at })).join('\n') +
        (records.length ? '\n' : ''),
    );
    await this.updateManifest(dbId, (draft) => {
      draft.lastCompactedAt = at;
      draft.activeSegment = segment;
      draft.recordCount = records.length;
      draft.updatedAt = at;
    });
    await appendJsonLine(this.auditPath(dbId), { action: 'compact', segment, records: records.length, at });
    return { segment, records: records.length };
  }

  async backup(dbId: string): Promise<{ path: string; records: number }> {
    const manifest = await this.getManifest(dbId);
    const records = [...(await this.loadRecords(dbId)).values()];
    const tokens = await this.readTokens(dbId);
    const system = await this.readSystemState(dbId);
    const at = nowIso();
    const path = join(this.workspaceDir(dbId), 'backups', `snapshot-${at.replace(/[:.]/g, '-')}.json`);
    const payload = { manifest, records, tokens, system, createdAt: at };
    await atomicWrite(
      path,
      `${JSON.stringify(
        {
          version: 1,
          kind: 'backup',
          createdAt: at,
          crypto: encryptStringWithWrappedDek(JSON.stringify(payload), this.masterKey, {
            dbId,
            kind: 'backup',
            createdAt: at,
          }),
        },
        null,
        2,
      )}\n`,
    );
    await appendJsonLine(this.auditPath(dbId), { action: 'backup', path, records: records.length, at });
    return { path, records: records.length };
  }

  async destroyAllForTests(): Promise<void> {
    await rm(this.dataDir, { recursive: true, force: true });
  }

  private async appendOperation(dbId: string, op: Operation): Promise<void> {
    await appendJsonLine(this.walPath(dbId), op);
  }

  private async readSystemState(dbId: string): Promise<SystemState> {
    const existing = await readJson<SystemState | null>(this.systemStatePath(dbId), null);
    if (existing) return existing;
    const manifest = await this.getManifest(dbId);
    const state = newSystemState({
      dbId,
      ownerAgentId: manifest.ownerAgentId,
      humanOwnerEmail: manifest.humanOwnerEmail,
      createdAt: manifest.createdAt,
    });
    await this.writeSystemState(dbId, state);
    return state;
  }

  async writeSystemState(dbId: string, state: SystemState): Promise<void> {
    await atomicWrite(this.systemStatePath(dbId), `${JSON.stringify(state, null, 2)}\n`);
  }

  private approvalTokenMac(token: string): string {
    return createHmac('sha256', this.masterKey).update(token).digest('hex');
  }

  private consumePlanApproval(state: SystemState, plan: SchemaPlanRecord, approvalToken?: string): void {
    if (!approvalToken) throw new Error('approval token required for destructive schema plan');
    const approval = state.approvals.find(
      (item) =>
        item.planId === plan.id &&
        item.planHash === plan.planHash &&
        item.scope === 'schema:apply_destructive' &&
        !item.usedAt &&
        item.tokenHash === this.approvalTokenMac(approvalToken),
    );
    if (!approval || Date.parse(approval.expiresAt) <= Date.now()) {
      throw new Error('valid approval token required for destructive schema plan');
    }
    approval.usedAt = nowIso();
  }

  private consumeRevertApproval(
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
        item.tokenHash === this.approvalTokenMac(approvalToken),
    );
    if (!approval || Date.parse(approval.expiresAt) <= Date.now()) {
      throw new Error('valid approval token required for schema revert');
    }
    approval.usedAt = nowIso();
  }

  private async createSystemSnapshotFromState(
    dbId: string,
    state: SystemState,
    kind: 'pre_apply' | 'manual' | 'revert_point',
    createdByType: 'human' | 'agent' | 'app' | 'system',
    createdById: string,
  ): Promise<SystemSnapshotRecord> {
    const id = `snap_${randomUUID().replace(/-/g, '')}`;
    const createdAt = nowIso();
    const path = join(this.systemSnapshotDir(dbId), `${id}.json`);
    const manifest = await this.getManifest(dbId);
    const wal = await readFile(this.walPath(dbId), 'utf8').catch((err: NodeJS.ErrnoException) => {
      if (err.code === 'ENOENT') return '';
      throw err;
    });
    const storedRecords = [...(await this.loadRecords(dbId)).values()];
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
    await atomicWrite(
      path,
      `${JSON.stringify(
        {
          id,
          kind,
          createdAt,
          aad: { dbId, kind, createdAt },
          crypto: encryptStringWithWrappedDek(JSON.stringify(payload), this.masterKey, { dbId, kind, createdAt }),
        },
        null,
        2,
      )}\n`,
    );
    return {
      id,
      kind,
      path,
      createdAt,
      createdByType,
      createdById,
      metadata: {
        recordCount: storedRecords.length,
        liveHash: state.schema.liveHash,
        lastAppliedHash: state.schema.lastAppliedHash,
      },
    };
  }

  private async readSystemSnapshot(dbId: string, snapshotId: string): Promise<SystemState> {
    const snapshot = await readJson<{ ciphertext?: string; crypto?: WrappedEncryptedString }>(
      join(this.systemSnapshotDir(dbId), safeId(snapshotId) + '.json'),
      null as never,
    );
    const body = snapshot.crypto
      ? decryptStringWithWrappedDek(snapshot.crypto, this.masterKey)
      : decryptString(snapshot.ciphertext ?? '', this.masterKey);
    const payload = JSON.parse(body) as { state: SystemState };
    return payload.state;
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
    await appendJsonLine(this.auditPath(dbId), {
      id: `aud_${randomUUID().replace(/-/g, '')}`,
      orgId: (await this.readSystemState(dbId)).org.id,
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

  private async loadRecords(dbId: string): Promise<Map<string, StoredRecord>> {
    const wal = await readFile(this.walPath(dbId), 'utf8').catch((err: NodeJS.ErrnoException) => {
      if (err.code === 'ENOENT') return '';
      throw err;
    });
    const records = new Map<string, StoredRecord>();
    for (const line of wal.split('\n')) {
      if (!line.trim()) continue;
      const op = JSON.parse(line) as Operation;
      if (op.op === 'record_upsert' && op.record) {
        records.set(op.record.id, op.record);
      }
      if (op.op === 'record_delete' && op.id) {
        records.delete(op.id);
      }
    }
    return records;
  }

  private async updateManifest(dbId: string, mutate: (draft: WorkspaceManifest) => void): Promise<void> {
    const manifest = await this.getManifest(dbId);
    mutate(manifest);
    await atomicWrite(this.manifestPath(dbId), `${JSON.stringify(manifest, null, 2)}\n`);
  }
}
