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
    // The service has safe local defaults. Missing env files are allowed.
  }
}

loadDotEnv(resolve(process.cwd(), '.env.local'));
loadDotEnv(resolve(process.cwd(), '.env'));
loadDotEnv(resolve(process.cwd(), 'apps/cumulus-db/.env'));

await import('../apps/cumulus-db/src/server.js');
