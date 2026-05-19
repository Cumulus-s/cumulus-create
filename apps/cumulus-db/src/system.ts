// SPDX-License-Identifier: AGPL-3.0-only
import { createHash, randomUUID } from 'node:crypto';
import { canonicalStringify, type NimbusIr } from './nimbus.js';
import type { TokenScope } from './types.js';

export type PrincipalType = 'human' | 'agent' | 'app' | 'system';
export type SchemaRiskLevel = 'none' | 'low' | 'medium' | 'high' | 'destructive';

export interface SystemPrincipal {
  id: string;
  type: PrincipalType;
  displayName: string;
  status: 'active' | 'disabled' | 'pending_claim';
  createdAt: string;
  lastSeenAt: string | null;
  grants: TokenScope[];
}

export interface SystemApproval {
  id: string;
  tokenHash: string;
  planId: string;
  planHash: string;
  scope: TokenScope;
  createdAt: string;
  expiresAt: string;
  usedAt: string | null;
  actorType: PrincipalType;
  actorId: string;
  targetVersionId?: string | null;
  targetSnapshotId?: string | null;
}

export interface SchemaOperation {
  kind:
    | 'create_collection'
    | 'drop_collection'
    | 'add_field'
    | 'drop_field'
    | 'alter_field'
    | 'add_secret'
    | 'remove_secret'
    | 'add_index'
    | 'alter_index'
    | 'remove_index'
    | 'add_app'
    | 'alter_app'
    | 'remove_app'
    | 'add_policy'
    | 'alter_policy'
    | 'remove_policy'
    | 'add_backup'
    | 'alter_backup'
    | 'remove_backup'
    | 'add_approval'
    | 'alter_approval'
    | 'remove_approval'
    | 'noop';
  target: string;
  risk: SchemaRiskLevel;
  summary: string;
}

export interface SchemaPlanRecord {
  id: string;
  planHash: string;
  desiredHash: string;
  desired: NimbusIr;
  operations: SchemaOperation[];
  riskLevel: SchemaRiskLevel;
  status: 'planned' | 'applied' | 'rejected';
  createdAt: string;
  appliedAt: string | null;
  approvalRequired: boolean;
  snapshotRequired: boolean;
  baseLiveHash: string | null;
  baseLastAppliedHash: string | null;
}

export interface SchemaVersionRecord {
  id: string;
  desiredHash: string;
  canonicalJson: NimbusIr;
  planId: string;
  planHash: string;
  riskLevel: SchemaRiskLevel;
  applyStatus: 'applied' | 'failed' | 'reverted';
  createdAt: string;
  appliedAt: string;
  revertedAt?: string;
}

export interface SystemSnapshotRecord {
  id: string;
  kind: 'pre_apply' | 'manual' | 'revert_point';
  path: string;
  createdAt: string;
  createdByType: PrincipalType;
  createdById: string;
  metadata: Record<string, unknown>;
}

export interface SystemState {
  version: 1;
  org: {
    id: string;
    slug: string;
    name: string;
    status: 'active' | 'suspended' | 'pending_claim';
    humanOwnerEmail: string | null;
    createdAt: string;
    claimedAt: string | null;
  };
  principals: SystemPrincipal[];
  approvals: SystemApproval[];
  schema: {
    live: NimbusIr | null;
    liveHash: string | null;
    lastApplied: NimbusIr | null;
    lastAppliedHash: string | null;
    plans: SchemaPlanRecord[];
    versions: SchemaVersionRecord[];
    snapshots: SystemSnapshotRecord[];
  };
}

export const LEGACY_TOKEN_SCOPES: TokenScope[] = [
  'records:read',
  'records:write',
  'search:read',
  'events:write',
  'kv:read',
  'kv:write',
  'secrets:write',
  'secrets:reveal',
  'tokens:manage',
  'backups:manage',
  'database:admin',
];

export const SYSTEM_SCOPE_REGISTRY: Array<{
  scope: TokenScope;
  label: string;
  dangerous: boolean;
  approvalRequired: boolean;
}> = [
  { scope: 'system:read', label: 'View system state', dangerous: false, approvalRequired: false },
  { scope: 'audit:read', label: 'View audit logs', dangerous: false, approvalRequired: false },
  { scope: 'org:read', label: 'View organization', dangerous: false, approvalRequired: false },
  { scope: 'org:claim', label: 'Claim organization', dangerous: true, approvalRequired: true },
  { scope: 'member:invite', label: 'Invite members', dangerous: false, approvalRequired: false },
  { scope: 'member:approve', label: 'Approve members and plans', dangerous: true, approvalRequired: true },
  { scope: 'member:revoke', label: 'Revoke members', dangerous: true, approvalRequired: true },
  { scope: 'agent:create', label: 'Create agents', dangerous: false, approvalRequired: false },
  { scope: 'agent:disable', label: 'Disable agents', dangerous: true, approvalRequired: true },
  { scope: 'app:create', label: 'Create apps', dangerous: false, approvalRequired: false },
  { scope: 'app:update', label: 'Update apps', dangerous: false, approvalRequired: false },
  { scope: 'token:create', label: 'Create tokens', dangerous: false, approvalRequired: false },
  { scope: 'token:rotate_self', label: 'Rotate own token', dangerous: false, approvalRequired: false },
  { scope: 'token:revoke_any', label: 'Revoke any token', dangerous: true, approvalRequired: true },
  { scope: 'schema:read', label: 'Read schema', dangerous: false, approvalRequired: false },
  { scope: 'schema:plan', label: 'Plan schema changes', dangerous: false, approvalRequired: false },
  { scope: 'schema:apply_safe', label: 'Apply safe schema changes', dangerous: false, approvalRequired: false },
  { scope: 'schema:apply_destructive', label: 'Apply destructive schema changes', dangerous: true, approvalRequired: true },
  { scope: 'schema:revert_local', label: 'Revert local state', dangerous: true, approvalRequired: true },
  { scope: 'schema:revert_cloud', label: 'Revert cloud state', dangerous: true, approvalRequired: true },
  { scope: 'data:read', label: 'Read app data', dangerous: false, approvalRequired: false },
  { scope: 'data:write', label: 'Write app data', dangerous: false, approvalRequired: false },
  { scope: 'data:delete_soft', label: 'Soft-delete data', dangerous: true, approvalRequired: true },
  { scope: 'data:delete_hard', label: 'Hard-delete data', dangerous: true, approvalRequired: true },
  { scope: 'secret:read', label: 'Read secret handles', dangerous: true, approvalRequired: true },
  { scope: 'secret:write', label: 'Write secret handles', dangerous: true, approvalRequired: true },
  { scope: 'backup:create', label: 'Create backups', dangerous: false, approvalRequired: false },
  { scope: 'backup:restore', label: 'Restore backups', dangerous: true, approvalRequired: true },
  { scope: 'billing:read', label: 'View billing', dangerous: false, approvalRequired: false },
  { scope: 'billing:write', label: 'Update billing', dangerous: true, approvalRequired: true },
  { scope: 'org:destroy', label: 'Destroy organization', dangerous: true, approvalRequired: true },
];

export const ALL_TOKEN_SCOPES: TokenScope[] = [...LEGACY_TOKEN_SCOPES, ...SYSTEM_SCOPE_REGISTRY.map((item) => item.scope)];

export const DEFAULT_AGENT_SYSTEM_SCOPES: TokenScope[] = [
  'system:read',
  'org:read',
  'schema:read',
  'schema:plan',
  'token:rotate_self',
];

export const DEFAULT_OWNER_SYSTEM_SCOPES: TokenScope[] = [
  'system:read',
  'audit:read',
  'org:read',
  'org:claim',
  'member:invite',
  'member:approve',
  'member:revoke',
  'agent:create',
  'agent:disable',
  'app:create',
  'app:update',
  'token:create',
  'token:rotate_self',
  'token:revoke_any',
  'schema:read',
  'schema:plan',
  'schema:apply_safe',
  'schema:apply_destructive',
  'schema:revert_local',
  'data:read',
  'data:write',
  'backup:create',
  'billing:read',
];

export function normalizeTokenScopes(scopes: string[]): TokenScope[] {
  const known = new Set<TokenScope>(ALL_TOKEN_SCOPES);
  const normalized = [...new Set(scopes)].filter((scope): scope is TokenScope => known.has(scope as TokenScope));
  if (normalized.length !== scopes.length) {
    const invalid = scopes.filter((scope) => !known.has(scope as TokenScope));
    throw new Error(`unknown token scope: ${invalid.join(', ')}`);
  }
  return normalized;
}

export function isHardSystemScope(scope: TokenScope): boolean {
  return SYSTEM_SCOPE_REGISTRY.some((item) => item.scope === scope);
}

export function riskRank(risk: SchemaRiskLevel): number {
  return { none: 0, low: 1, medium: 2, high: 3, destructive: 4 }[risk];
}

export function maxRisk(operations: SchemaOperation[]): SchemaRiskLevel {
  return operations.reduce<SchemaRiskLevel>((current, operation) => {
    return riskRank(operation.risk) > riskRank(current) ? operation.risk : current;
  }, 'none');
}

export function newSystemState(input: {
  dbId: string;
  ownerAgentId: string;
  humanOwnerEmail: string | null;
  createdAt: string;
}): SystemState {
  return {
    version: 1,
    org: {
      id: `org_${input.dbId.replace(/^db_/, '')}`,
      slug: input.dbId,
      name: 'Cumulus workspace',
      status: input.humanOwnerEmail ? 'active' : 'pending_claim',
      humanOwnerEmail: input.humanOwnerEmail,
      createdAt: input.createdAt,
      claimedAt: input.humanOwnerEmail ? input.createdAt : null,
    },
    principals: [
      {
        id: input.ownerAgentId,
        type: 'agent',
        displayName: input.ownerAgentId,
        status: input.humanOwnerEmail ? 'active' : 'pending_claim',
        createdAt: input.createdAt,
        lastSeenAt: null,
        grants: DEFAULT_AGENT_SYSTEM_SCOPES,
      },
    ],
    approvals: [],
    schema: {
      live: null,
      liveHash: null,
      lastApplied: null,
      lastAppliedHash: null,
      plans: [],
      versions: [],
      snapshots: [],
    },
  };
}

export function humanPrincipalId(email: string): string {
  return `usr_${createHash('sha256').update(email.trim().toLowerCase()).digest('hex').slice(0, 24)}`;
}

export function claimSystemOrg(
  state: SystemState,
  input: {
    email: string;
    now: string;
  },
): SystemPrincipal {
  const email = input.email.trim().toLowerCase();
  if (!email) throw new Error('claim email is required');
  if (state.org.status === 'suspended') throw new Error('organization is suspended');
  if (state.org.claimedAt && state.org.humanOwnerEmail && state.org.humanOwnerEmail !== email) {
    throw new Error('organization is already claimed');
  }

  state.org.status = 'active';
  state.org.humanOwnerEmail = email;
  state.org.claimedAt = state.org.claimedAt ?? input.now;

  const id = humanPrincipalId(email);
  const existing = state.principals.find((principal) => principal.id === id);
  if (existing) {
    existing.status = 'active';
    existing.displayName = email;
    existing.grants = normalizeTokenScopes([...new Set([...existing.grants, ...DEFAULT_OWNER_SYSTEM_SCOPES])]);
    return existing;
  }

  const principal: SystemPrincipal = {
    id,
    type: 'human',
    displayName: email,
    status: 'active',
    createdAt: input.now,
    lastSeenAt: null,
    grants: DEFAULT_OWNER_SYSTEM_SCOPES,
  };
  state.principals.push(principal);
  for (const item of state.principals) {
    if (item.status === 'pending_claim') item.status = 'active';
  }
  return principal;
}

export function updateSystemPrincipalGrants(
  state: SystemState,
  input: {
    principalId: string;
    grants: TokenScope[];
  },
): SystemPrincipal {
  const principal = state.principals.find((item) => item.id === input.principalId);
  if (!principal) throw new Error('principal not found');
  principal.grants = normalizeTokenScopes(input.grants);
  return principal;
}

export function disableSystemAgent(state: SystemState, agentId: string): SystemPrincipal {
  const principal = state.principals.find((item) => item.id === agentId && item.type === 'agent');
  if (!principal) throw new Error('agent not found');
  principal.status = 'disabled';
  return principal;
}

export function buildSchemaPlan(input: {
  desired: NimbusIr;
  desiredHash: string;
  live: NimbusIr | null;
  lastApplied: NimbusIr | null;
  createdAt: string;
}): SchemaPlanRecord {
  const operations = diffNimbus(input.desired, input.live);
  const riskLevel = maxRisk(operations);
  const planHash = stableHash({
    desiredHash: input.desiredHash,
    liveHash: input.live ? stableHash(input.live) : null,
    lastAppliedHash: input.lastApplied ? stableHash(input.lastApplied) : null,
    operations,
  });
  return {
    id: `plan_${randomUUID().replace(/-/g, '')}`,
    planHash,
    desiredHash: input.desiredHash,
    desired: input.desired,
    operations,
    riskLevel,
    status: 'planned',
    createdAt: input.createdAt,
    appliedAt: null,
    approvalRequired: riskLevel === 'destructive',
    snapshotRequired: riskRank(riskLevel) >= riskRank('medium'),
    baseLiveHash: input.live ? stableHash(input.live) : null,
    baseLastAppliedHash: input.lastApplied ? stableHash(input.lastApplied) : null,
  };
}

export function stableHash(value: unknown): string {
  return `sha256:${createHash('sha256').update(canonicalStringify(value)).digest('hex')}`;
}

function diffNimbus(desired: NimbusIr, live: NimbusIr | null): SchemaOperation[] {
  const operations: SchemaOperation[] = [];
  if (!live) {
    operations.push(...desired.spec.collections.map<SchemaOperation>((collection) => ({
      kind: 'create_collection',
      target: `collection.${collection.name}`,
      risk: 'low',
      summary: `Create collection ${collection.name}`,
    })));
    for (const collection of desired.spec.collections) {
      operations.push(
        ...namedAddOperations(
          collection.indexes ?? [],
          `collection.${collection.name}.index`,
          'add_index',
          'medium',
          `Add index to ${collection.name}`,
        ),
      );
    }
    operations.push(...namedAddOperations(desired.spec.apps, 'app', 'add_app', 'low', 'Add app'));
    operations.push(...namedAddOperations(desired.spec.indexes, 'index', 'add_index', 'medium', 'Add index'));
    operations.push(...namedAddOperations(desired.spec.policies, 'policy', 'add_policy', 'medium', 'Add policy'));
    operations.push(...namedAddOperations(desired.spec.secrets, 'secret', 'add_secret', 'medium', 'Add secret handle'));
    operations.push(...namedAddOperations(desired.spec.backups, 'backup', 'add_backup', 'low', 'Add backup rule'));
    operations.push(...namedAddOperations(desired.spec.approvals, 'approval', 'add_approval', 'medium', 'Add approval rule'));
    return operations.length ? operations : [{ kind: 'noop', target: desired.spec.namespace, risk: 'none', summary: 'No schema changes' }];
  }

  const liveCollections = new Map(live.spec.collections.map((collection) => [collection.name, collection]));
  const desiredCollections = new Map(desired.spec.collections.map((collection) => [collection.name, collection]));

  for (const [name, collection] of desiredCollections) {
    const current = liveCollections.get(name);
    if (!current) {
      operations.push({ kind: 'create_collection', target: `collection.${name}`, risk: 'low', summary: `Create collection ${name}` });
      continue;
    }
    const currentFields = new Set(Object.keys(current.fields));
    const desiredFields = new Set(Object.keys(collection.fields));
    for (const field of desiredFields) {
      if (!currentFields.has(field)) {
        operations.push({ kind: 'add_field', target: `collection.${name}.field.${field}`, risk: 'low', summary: `Add field ${field} to ${name}` });
        continue;
      }
      if (canonicalStringify(current.fields[field]) !== canonicalStringify(collection.fields[field])) {
        operations.push({ kind: 'alter_field', target: `collection.${name}.field.${field}`, risk: 'medium', summary: `Change field ${field} on ${name}` });
      }
    }
    for (const field of currentFields) {
      if (!desiredFields.has(field)) {
        operations.push({ kind: 'drop_field', target: `collection.${name}.field.${field}`, risk: 'destructive', summary: `Drop field ${field} from ${name}` });
      }
    }
    diffNamedItems(operations, current.indexes ?? [], collection.indexes ?? [], {
      targetPrefix: `collection.${name}.index`,
      addKind: 'add_index',
      alterKind: 'alter_index',
      removeKind: 'remove_index',
      addRisk: 'medium',
      alterRisk: 'medium',
      removeRisk: 'high',
      label: `index on ${name}`,
    });
  }

  for (const name of liveCollections.keys()) {
    if (!desiredCollections.has(name)) {
      operations.push({ kind: 'drop_collection', target: `collection.${name}`, risk: 'destructive', summary: `Drop collection ${name}` });
    }
  }

  diffNamedItems(operations, live.spec.apps, desired.spec.apps, {
    targetPrefix: 'app',
    addKind: 'add_app',
    alterKind: 'alter_app',
    removeKind: 'remove_app',
    addRisk: 'low',
    alterRisk: 'medium',
    removeRisk: 'high',
    label: 'app',
  });
  diffNamedItems(operations, live.spec.indexes, desired.spec.indexes, {
    targetPrefix: 'index',
    addKind: 'add_index',
    alterKind: 'alter_index',
    removeKind: 'remove_index',
    addRisk: 'medium',
    alterRisk: 'medium',
    removeRisk: 'high',
    label: 'index',
  });
  diffNamedItems(operations, live.spec.policies, desired.spec.policies, {
    targetPrefix: 'policy',
    addKind: 'add_policy',
    alterKind: 'alter_policy',
    removeKind: 'remove_policy',
    addRisk: 'medium',
    alterRisk: 'high',
    removeRisk: 'destructive',
    label: 'policy',
  });
  diffNamedItems(operations, live.spec.secrets, desired.spec.secrets, {
    targetPrefix: 'secret',
    addKind: 'add_secret',
    removeKind: 'remove_secret',
    addRisk: 'medium',
    removeRisk: 'high',
    label: 'secret handle',
  });
  diffNamedItems(operations, live.spec.backups, desired.spec.backups, {
    targetPrefix: 'backup',
    addKind: 'add_backup',
    alterKind: 'alter_backup',
    removeKind: 'remove_backup',
    addRisk: 'low',
    alterRisk: 'medium',
    removeRisk: 'high',
    label: 'backup rule',
  });
  diffNamedItems(operations, live.spec.approvals, desired.spec.approvals, {
    targetPrefix: 'approval',
    addKind: 'add_approval',
    alterKind: 'alter_approval',
    removeKind: 'remove_approval',
    addRisk: 'medium',
    alterRisk: 'high',
    removeRisk: 'destructive',
    label: 'approval rule',
  });

  return operations.length ? operations : [{ kind: 'noop', target: desired.spec.namespace, risk: 'none', summary: 'No schema changes' }];
}

type NamedPlanKind = Exclude<SchemaOperation['kind'], 'create_collection' | 'drop_collection' | 'add_field' | 'drop_field' | 'alter_field' | 'noop'>;

function namedAddOperations(
  items: Array<{ name: string }>,
  targetPrefix: string,
  kind: NamedPlanKind,
  risk: SchemaRiskLevel,
  label: string,
): SchemaOperation[] {
  return items.map((item) => ({
    kind,
    target: `${targetPrefix}.${item.name}`,
    risk,
    summary: `${label} ${item.name}`,
  }));
}

function diffNamedItems(
  operations: SchemaOperation[],
  liveItems: Array<{ name: string }>,
  desiredItems: Array<{ name: string }>,
  config: {
    targetPrefix: string;
    addKind: NamedPlanKind;
    alterKind?: NamedPlanKind;
    removeKind: NamedPlanKind;
    addRisk: SchemaRiskLevel;
    alterRisk?: SchemaRiskLevel;
    removeRisk: SchemaRiskLevel;
    label: string;
  },
): void {
  const liveByName = new Map(liveItems.map((item) => [item.name, item]));
  const desiredByName = new Map(desiredItems.map((item) => [item.name, item]));
  for (const [name, desired] of desiredByName) {
    const current = liveByName.get(name);
    if (!current) {
      operations.push({
        kind: config.addKind,
        target: `${config.targetPrefix}.${name}`,
        risk: config.addRisk,
        summary: `Add ${config.label} ${name}`,
      });
      continue;
    }
    if (config.alterKind && canonicalStringify(current) !== canonicalStringify(desired)) {
      operations.push({
        kind: config.alterKind,
        target: `${config.targetPrefix}.${name}`,
        risk: config.alterRisk ?? config.addRisk,
        summary: `Change ${config.label} ${name}`,
      });
    }
  }
  for (const name of liveByName.keys()) {
    if (!desiredByName.has(name)) {
      operations.push({
        kind: config.removeKind,
        target: `${config.targetPrefix}.${name}`,
        risk: config.removeRisk,
        summary: `Remove ${config.label} ${name}`,
      });
    }
  }
}
