// SPDX-License-Identifier: AGPL-3.0-only
import { createHash, randomBytes, randomUUID } from 'node:crypto';

export interface PasskeyStepUpRecord {
  id: string;
  dbId: string;
  principalId: string;
  method: 'local-dev-passkey';
  createdAt: string;
  expiresAt: string;
  tokenHash: string;
}

export interface PasskeyStepUpIssue {
  id: string;
  stepUpToken: string;
  method: 'local-dev-passkey';
  expiresAt: string;
}

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export class LocalPasskeyStepUpStore {
  private readonly records = new Map<string, PasskeyStepUpRecord>();

  constructor(
    private readonly ttlMs = 5 * 60 * 1000,
    private readonly now: () => number = () => Date.now(),
  ) {}

  create(input: { dbId: string; principalId: string }): PasskeyStepUpIssue {
    const stepUpToken = randomBytes(32).toString('base64url');
    const createdAtMs = this.now();
    const record: PasskeyStepUpRecord = {
      id: `psu_${randomUUID().replace(/-/g, '')}`,
      dbId: input.dbId,
      principalId: input.principalId,
      method: 'local-dev-passkey',
      createdAt: new Date(createdAtMs).toISOString(),
      expiresAt: new Date(createdAtMs + this.ttlMs).toISOString(),
      tokenHash: hashToken(stepUpToken),
    };
    this.records.set(record.id, record);
    return {
      id: record.id,
      stepUpToken,
      method: record.method,
      expiresAt: record.expiresAt,
    };
  }

  verify(input: { dbId: string; principalId: string; stepUpToken: string | undefined }): boolean {
    if (!input.stepUpToken) return false;
    const tokenHash = hashToken(input.stepUpToken);
    const nowMs = this.now();
    for (const record of this.records.values()) {
      if (Date.parse(record.expiresAt) <= nowMs) {
        this.records.delete(record.id);
        continue;
      }
      if (record.dbId === input.dbId && record.principalId === input.principalId && record.tokenHash === tokenHash) {
        return true;
      }
    }
    return false;
  }
}
