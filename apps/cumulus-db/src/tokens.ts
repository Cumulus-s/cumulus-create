// SPDX-License-Identifier: AGPL-3.0-only
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { safeEqualHex, sha256 } from './crypto.js';
import { DEFAULT_OWNER_SYSTEM_SCOPES, LEGACY_TOKEN_SCOPES, isHardSystemScope, normalizeTokenScopes } from './system.js';
import type { TokenIssue, TokenRecord, TokenScope } from './types.js';

const DATA_SCOPES: TokenScope[] = [
  'records:read',
  'records:write',
  'search:read',
  'events:write',
  'kv:read',
  'kv:write',
  'secrets:write',
];

const ADMIN_SCOPES: TokenScope[] = [
  ...DATA_SCOPES,
  'secrets:reveal',
  'tokens:manage',
  'backups:manage',
  'database:admin',
  ...DEFAULT_OWNER_SYSTEM_SCOPES,
];

interface IssueTokenOptions {
  kind?: TokenRecord['tokenKind'];
  principalType?: TokenRecord['principalType'];
  principalId?: string;
  expiresAt?: string | null;
  rotatedFromId?: string | null;
}

function makeToken(prefix: string): { token: string; publicId: string; secret: string } {
  const publicId = randomBytes(10).toString('hex');
  const secret = randomBytes(32).toString('hex');
  return {
    publicId,
    secret,
    token: `${prefix}_v1_${publicId}_${secret}`,
  };
}

function macSecret(secret: string, key: Buffer): string {
  return createHmac('sha256', key).update(secret).digest('hex');
}

function parseToken(token: string): { publicId: string; secret: string } | null {
  const parts = token.split('_');
  if (parts.length < 5) return null;
  if (parts[parts.length - 3] !== 'v1') return null;
  const publicId = parts[parts.length - 2];
  const secret = parts[parts.length - 1];
  if (!publicId || !secret) return null;
  return { publicId, secret };
}

function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  try {
    return timingSafeEqual(Buffer.from(a), Buffer.from(b));
  } catch {
    return false;
  }
}

export function issueToken(label: string, scopes: TokenScope[], prefix: string, macKey: Buffer, options: IssueTokenOptions = {}): {
  issue: TokenIssue;
  record: TokenRecord;
} {
  const normalizedScopes = normalizeTokenScopes(scopes);
  const { token, publicId, secret } = makeToken(prefix);
  const now = new Date().toISOString();
  const id = crypto.randomUUID();
  return {
    issue: { id, token, scopes: normalizedScopes },
    record: {
      id,
      label,
      tokenPublicId: publicId,
      secretMac: macSecret(secret, macKey),
      tokenKind: options.kind,
      principalType: options.principalType,
      principalId: options.principalId,
      scopes: normalizedScopes,
      createdAt: now,
      lastUsedAt: null,
      revokedAt: null,
      expiresAt: options.expiresAt ?? null,
      rotatedFromId: options.rotatedFromId ?? null,
    },
  };
}

export function issueWorkspaceTokens(macKey: Buffer): {
  data: TokenIssue;
  admin: TokenIssue;
  records: TokenRecord[];
} {
  const data = issueToken('initial data token', DATA_SCOPES, 'cdb_data', macKey, { kind: 'data', principalType: 'agent' });
  const admin = issueToken('initial admin token', ADMIN_SCOPES, 'cdb_admin', macKey, { kind: 'admin', principalType: 'system' });
  return {
    data: data.issue,
    admin: admin.issue,
    records: [data.record, admin.record],
  };
}

export function hasScopes(token: TokenRecord, required: TokenScope[]): boolean {
  if (token.revokedAt) return false;
  if (token.expiresAt && Date.parse(token.expiresAt) <= Date.now()) return false;
  return required.every((scope) => {
    if (token.scopes.includes(scope)) return true;
    return token.scopes.includes('database:admin') && !isHardSystemScope(scope) && LEGACY_TOKEN_SCOPES.includes(scope);
  });
}

export function verifyTokenRecord(record: TokenRecord, token: string, macKey: Buffer): boolean {
  const parsed = parseToken(token);
  if (parsed && record.tokenPublicId && record.secretMac) {
    return safeEqual(record.tokenPublicId, parsed.publicId) && safeEqualHex(record.secretMac, macSecret(parsed.secret, macKey));
  }
  return Boolean(record.tokenHash && safeEqualHex(record.tokenHash, sha256(token)));
}
