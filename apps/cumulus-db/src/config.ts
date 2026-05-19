// SPDX-License-Identifier: AGPL-3.0-only
import { randomBytes } from 'node:crypto';
import { resolve } from 'node:path';

export interface CumulusDbConfig {
  engine: 'jsonl' | 'postgres';
  dataDir: string;
  publicUrl: string;
  adminSecret: string | null;
  masterKey: Buffer;
  relayWebhookSecret: string | null;
  publicAgentBootstrapEnabled: boolean;
  port: number;
  postgres: {
    url: string | null;
    ssl: false | true | { rejectUnauthorized: boolean };
    autoMigrate: boolean;
  };
  embeddings: {
    baseUrl: string | null;
    apiKey: string | null;
    model: string | null;
  };
}

export type CumulusDbConfigEnv = Record<string, string | undefined>

function envValue(env: CumulusDbConfigEnv, key: string): string | undefined {
  const value = env[key]?.trim();
  return value ? value : undefined;
}

function parseEngine(raw: string | undefined): CumulusDbConfig['engine'] {
  if (!raw || raw === 'jsonl') return 'jsonl';
  if (raw === 'postgres') return 'postgres';
  throw new Error('CUMULUS_DB_ENGINE must be jsonl or postgres');
}

function parseBoolean(raw: string | undefined, fallback = false): boolean {
  if (!raw) return fallback;
  if (raw === 'true' || raw === '1' || raw === 'yes') return true;
  if (raw === 'false' || raw === '0' || raw === 'no') return false;
  throw new Error('boolean environment values must be true or false');
}

function parsePostgresSsl(raw: string | undefined): CumulusDbConfig['postgres']['ssl'] {
  if (!raw || raw === 'false' || raw === '0' || raw === 'disable') return false;
  if (raw === 'true' || raw === '1' || raw === 'require') return true;
  if (raw === 'no-verify' || raw === 'allow-invalid-cert') return { rejectUnauthorized: false };
  throw new Error('CUMULUS_DB_POSTGRES_SSL must be false, true, require, disable, or no-verify');
}

function parseMasterKey(raw: string | undefined, isProduction: boolean): Buffer {
  if (!raw) {
    if (isProduction) {
      throw new Error('CUMULUS_DB_MASTER_KEY is required in production');
    }
    return Buffer.alloc(32, 7);
  }

  const asBase64 = Buffer.from(raw, 'base64');
  if (asBase64.length === 32) return asBase64;

  const asUtf8 = Buffer.from(raw, 'utf8');
  if (asUtf8.length >= 32) return asUtf8.subarray(0, 32);

  throw new Error('CUMULUS_DB_MASTER_KEY must decode to at least 32 bytes');
}

export function randomMasterKey(): string {
  return randomBytes(32).toString('base64');
}

export function loadConfig(env: CumulusDbConfigEnv = process.env): CumulusDbConfig {
  const engine = parseEngine(envValue(env, 'CUMULUS_DB_ENGINE'));
  const dataDir = resolve(envValue(env, 'CUMULUS_DB_DATA_DIR') ?? '.cumulus-db-data');
  const publicUrl = (envValue(env, 'CUMULUS_DB_PUBLIC_URL') ?? 'http://localhost:4317').replace(/\/$/, '');
  const port = Number(envValue(env, 'CUMULUS_DB_PORT') ?? envValue(env, 'PORT') ?? '4317');
  const masterKey = envValue(env, 'CUMULUS_DB_MASTER_KEY');
  const postgresUrl = envValue(env, 'CUMULUS_DB_POSTGRES_URL') ?? null;
  const isProduction = envValue(env, 'NODE_ENV') === 'production';
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('CUMULUS_DB_PORT or PORT must be a valid TCP port');
  }
  if (engine === 'postgres' && !postgresUrl) {
    throw new Error('CUMULUS_DB_POSTGRES_URL is required when CUMULUS_DB_ENGINE=postgres');
  }

  return {
    engine,
    dataDir,
    publicUrl,
    adminSecret: masterKey ?? null,
    masterKey: parseMasterKey(masterKey, isProduction),
    relayWebhookSecret: envValue(env, 'CUMULUS_DB_RELAY_WEBHOOK_SECRET') ?? null,
    publicAgentBootstrapEnabled: envValue(env, 'CUMULUS_DB_PUBLIC_AGENT_BOOTSTRAP_ENABLED') === 'true',
    port,
    postgres: {
      url: postgresUrl,
      ssl: parsePostgresSsl(envValue(env, 'CUMULUS_DB_POSTGRES_SSL')),
      autoMigrate: parseBoolean(envValue(env, 'CUMULUS_DB_AUTO_MIGRATE'), false),
    },
    embeddings: {
      baseUrl: envValue(env, 'OPENAI_COMPAT_EMBEDDINGS_BASE_URL') ?? null,
      apiKey: envValue(env, 'OPENAI_COMPAT_EMBEDDINGS_API_KEY') ?? null,
      model: envValue(env, 'OPENAI_COMPAT_EMBEDDINGS_MODEL') ?? null,
    },
  };
}
