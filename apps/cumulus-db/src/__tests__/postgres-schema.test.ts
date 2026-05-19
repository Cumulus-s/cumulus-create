// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';
import {
  POSTGRES_DATA_DDL,
  POSTGRES_DATA_SCHEMA_VERSION,
  POSTGRES_SYSTEM_DDL,
  POSTGRES_SYSTEM_SCHEMA_VERSION,
} from '../postgres-schema.js';

describe('PostgreSQL system schema contract', () => {
  it('defines the hosted v1 control-plane tables', () => {
    expect(POSTGRES_SYSTEM_SCHEMA_VERSION).toBe('system-v1');
    for (const table of [
      'orgs',
      'identities',
      'human_accounts',
      'agent_accounts',
      'org_memberships',
      'tokens',
      'audit_logs',
      'schema_versions',
      'snapshots',
      'approvals',
      'revert_runs',
    ]) {
      expect(POSTGRES_SYSTEM_DDL).toContain(`cumulus_system.${table}`);
    }
    expect(POSTGRES_SYSTEM_DDL).toContain('create extension if not exists citext');
    expect(POSTGRES_SYSTEM_DDL).toContain('token_public_id');
    expect(POSTGRES_SYSTEM_DDL).toContain('secret_mac');
  });

  it('defines the hosted v1 runtime data tables', () => {
    expect(POSTGRES_DATA_SCHEMA_VERSION).toBe('data-v1');
    for (const table of [
      'schema_migrations',
      'manifests',
      'tokens',
      'records',
      'wal_entries',
      'audit_logs',
      'system_state',
      'snapshots',
    ]) {
      expect(POSTGRES_DATA_DDL).toContain(`cumulus_data.${table}`);
    }
    expect(POSTGRES_DATA_DDL).toContain('record_json');
    expect(POSTGRES_DATA_DDL).toContain('state_json');
    expect(POSTGRES_DATA_DDL).toContain('ciphertext');
  });
});
