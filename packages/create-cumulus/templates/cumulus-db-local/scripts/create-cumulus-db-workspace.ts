import { createHmac, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

function loadDotEnv(path: string): void {
  try {
    const raw = readFileSync(path, 'utf8');
    for (const line of raw.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eq = trimmed.indexOf('=');
      if (eq === -1) continue;
      const key = trimmed.slice(0, eq).trim();
      let value = trimmed.slice(eq + 1).trim();
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      if (process.env[key] === undefined) process.env[key] = value;
    }
  } catch {
    // Missing env files are fine for local smoke workflows.
  }
}

function arg(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

loadDotEnv(resolve(process.cwd(), '.env.local'));
loadDotEnv(resolve(process.cwd(), '.env'));

const baseUrl = (
  process.env.CUMULUS_DB_INTERNAL_URL ||
  process.env.CUMULUS_DB_PUBLIC_URL ||
  'http://localhost:4317'
).replace(/\/$/, '');

const email = arg('email') ?? 'local@example.com';
const agentId = arg('agent-id') ?? 'local-agent';
const body = JSON.stringify({
  kind: 'signup',
  signupId: randomUUID(),
  email,
  input: {
    email,
    agent_id: agentId,
    purpose: arg('purpose') ?? 'local project memory',
  },
  provider_slug: 'cumulus-database',
});

const headers: Record<string, string> = {
  'Content-Type': 'application/json',
};

if (process.env.CUMULUS_DB_RELAY_WEBHOOK_SECRET) {
  headers['X-Relay-Signature'] = `sha256=${createHmac(
    'sha256',
    process.env.CUMULUS_DB_RELAY_WEBHOOK_SECRET,
  )
    .update(body)
    .digest('hex')}`;
}

const response = await fetch(`${baseUrl}/v1/relay/signup`, {
  method: 'POST',
  headers,
  body,
});

const payload = (await response.json().catch(() => ({}))) as {
  error?: string;
  credentials?: {
    endpoint: string;
    database_id: string;
    data_token: string;
    admin_token: string;
  };
};

if (!response.ok || !payload.credentials) {
  throw new Error(payload.error ?? `Cumulus DB workspace create failed: ${response.status}`);
}

console.log('Cumulus DB workspace created.');
console.log('');
console.log(`CUMULUS_DB_ENDPOINT=${payload.credentials.endpoint}`);
console.log(`CUMULUS_DB_DATABASE_ID=${payload.credentials.database_id}`);
console.log(`CUMULUS_DB_DATA_TOKEN=${payload.credentials.data_token}`);
console.log(`CUMULUS_DB_ADMIN_TOKEN=${payload.credentials.admin_token}`);
