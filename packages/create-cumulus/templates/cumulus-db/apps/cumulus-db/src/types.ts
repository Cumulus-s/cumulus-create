// SPDX-License-Identifier: AGPL-3.0-only
export type RecordType =
  | 'document'
  | 'note'
  | 'run'
  | 'message'
  | 'event'
  | 'kv'
  | 'tool_call'
  | 'artifact'
  | 'summary'
  | 'preference'
  | 'secret'
  | 'entity'
  | 'task'
  | 'observation';

export type TokenScope =
  | 'records:read'
  | 'records:write'
  | 'search:read'
  | 'events:write'
  | 'kv:read'
  | 'kv:write'
  | 'secrets:write'
  | 'secrets:reveal'
  | 'tokens:manage'
  | 'backups:manage'
  | 'database:admin'
  | 'system:read'
  | 'audit:read'
  | 'org:read'
  | 'org:claim'
  | 'member:invite'
  | 'member:approve'
  | 'member:revoke'
  | 'agent:create'
  | 'agent:disable'
  | 'app:create'
  | 'app:update'
  | 'token:create'
  | 'token:rotate_self'
  | 'token:revoke_any'
  | 'schema:read'
  | 'schema:plan'
  | 'schema:apply_safe'
  | 'schema:apply_destructive'
  | 'schema:revert_local'
  | 'schema:revert_cloud'
  | 'data:read'
  | 'data:write'
  | 'data:delete_soft'
  | 'data:delete_hard'
  | 'secret:read'
  | 'secret:write'
  | 'backup:create'
  | 'backup:restore'
  | 'billing:read'
  | 'billing:write'
  | 'org:destroy';

export interface WorkspaceManifest {
  id: string;
  ownerAgentId: string;
  humanOwnerEmail: string | null;
  relaySignupId: string | null;
  createdAt: string;
  updatedAt: string;
  recordCount: number;
  deletedCount: number;
  lastCompactedAt: string | null;
  activeSegment: string;
}

export interface SecretMetadata {
  recordIsSecret: boolean;
  contentEncrypted?: boolean;
  fields: string[];
  likelySecretKeys: string[];
  detectorWarnings: string[];
}

export interface StoredRecord {
  id: string;
  dbId: string;
  type: RecordType;
  key?: string;
  title?: string;
  content?: string | null;
  contentEnc?: string;
  json?: unknown;
  tags: string[];
  vector?: number[];
  metadata: Record<string, unknown>;
  secret: SecretMetadata;
  secretFieldsEnc: Record<string, string>;
  createdAt: string;
  updatedAt: string;
  deletedAt?: string;
}

export interface PublicRecord {
  id: string;
  dbId: string;
  type: RecordType;
  key?: string;
  title?: string;
  content?: string | null;
  json?: unknown;
  tags: string[];
  vector?: number[];
  metadata: Record<string, unknown>;
  secret: SecretMetadata;
  createdAt: string;
  updatedAt: string;
  deletedAt?: string;
}

export interface TokenRecord {
  id: string;
  label: string;
  tokenHash?: string;
  tokenPublicId?: string;
  secretMac?: string;
  tokenKind?: 'data' | 'admin' | 'agent' | 'pat' | 'session' | 'approval' | 'exchange';
  principalType?: 'human' | 'agent' | 'app' | 'system';
  principalId?: string;
  scopes: TokenScope[];
  createdAt: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
  expiresAt?: string | null;
  rotatedFromId?: string | null;
}

export interface TokenIssue {
  id: string;
  token: string;
  scopes: TokenScope[];
}

export interface SearchHit {
  record: PublicRecord;
  score: number;
  lexicalScore: number;
  vectorScore: number;
}

export interface EnvVariable {
  key: string;
  value: string;
  quoted: 'none' | 'single' | 'double';
  lineStart: number;
  lineEnd: number;
  isLikelySecret: boolean;
  reason: string | null;
}

export interface EnvParseResult {
  variables: EnvVariable[];
  warnings: string[];
  invalidLines: Array<{ line: number; text: string; reason: string }>;
  duplicateKeys: string[];
  suggestedSecretKeys: string[];
}
