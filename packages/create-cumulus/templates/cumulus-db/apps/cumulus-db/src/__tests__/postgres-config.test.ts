// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';
import { loadConfig } from '../config.js';

const masterKey = Buffer.alloc(32, 10).toString('base64');

describe('Postgres config', () => {
  it('defaults to the JSONL engine', () => {
    const config = loadConfig({ CUMULUS_DB_MASTER_KEY: masterKey });

    expect(config.engine).toBe('jsonl');
    expect(config.postgres.url).toBeNull();
    expect(config.postgres.autoMigrate).toBe(false);
  });

  it('requires a Postgres URL when the Postgres engine is selected', () => {
    expect(() =>
      loadConfig({
        CUMULUS_DB_MASTER_KEY: masterKey,
        CUMULUS_DB_ENGINE: 'postgres',
      }),
    ).toThrow('CUMULUS_DB_POSTGRES_URL is required');
  });

  it('parses Postgres SSL and auto-migration flags', () => {
    const config = loadConfig({
      CUMULUS_DB_MASTER_KEY: masterKey,
      CUMULUS_DB_ENGINE: 'postgres',
      CUMULUS_DB_POSTGRES_URL: 'postgres://postgres@127.0.0.1:5432/postgres',
      CUMULUS_DB_POSTGRES_SSL: 'no-verify',
      CUMULUS_DB_AUTO_MIGRATE: 'true',
    });

    expect(config.engine).toBe('postgres');
    expect(config.postgres.url).toBe('postgres://postgres@127.0.0.1:5432/postgres');
    expect(config.postgres.ssl).toEqual({ rejectUnauthorized: false });
    expect(config.postgres.autoMigrate).toBe(true);
  });
});
