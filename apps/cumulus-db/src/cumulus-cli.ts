// SPDX-License-Identifier: AGPL-3.0-only
import { readFileSync } from 'node:fs';
import { isAbsolute, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runNimbusCli, type NimbusCliIo } from './nimbus-cli.js';

export interface CumulusCliIo extends NimbusCliIo {
  env?: Record<string, string | undefined>;
  fetch?: typeof fetch;
}

type CliOptions = Map<string, string[] | true>;

interface ParsedArgs {
  positionals: string[];
  options: CliOptions;
}

interface CliContext {
  baseUrl: string;
  dbId?: string;
  token?: string;
  adminKey?: string;
  fetch: typeof fetch;
  readFile: (path: string) => string;
  cwd: string;
}

export async function runCumulusCli(argv = process.argv.slice(2), io: CumulusCliIo = {}): Promise<number> {
  const cwd = resolve(io.cwd ?? process.cwd());
  const stdout = io.stdout ?? ((text: string) => process.stdout.write(text));
  const stderr = io.stderr ?? ((text: string) => process.stderr.write(text));
  const readFile = io.readFile ?? ((path: string) => readFileSync(path, 'utf8'));

  try {
    const parsed = parseArgs(argv);
    const [area = 'help', action, subaction] = parsed.positionals;
    if (area === 'help' || area === '--help' || area === '-h') {
      stdout(usage());
      return 0;
    }
    if (area === 'nimbus') {
      return runNimbusCli(argv.slice(1), io);
    }

    const context = makeContext(parsed.options, io.env ?? process.env, {
      cwd,
      fetch: io.fetch ?? fetch,
      readFile,
    });

    if (area === 'login') {
      const result = await runLogin(context, parsed.options);
      writeJson(stdout, result);
      return 0;
    }

    if (area === 'agent' && action === 'init') {
      const result = await requestJson(context, '/v1/system/agents/bootstrap', {
        method: 'POST',
        admin: true,
        body: {
          displayName: option(parsed.options, 'display-name') ?? option(parsed.options, 'name') ?? 'cli-agent',
          humanOwnerEmail: option(parsed.options, 'email') ?? null,
        },
      });
      writeJson(stdout, result);
      return 0;
    }

    if (area === 'whoami') {
      const result = await requestJson(context, '/oidc/userinfo', { method: 'GET', auth: true });
      writeJson(stdout, result);
      return 0;
    }

    if (area === 'db' && action === 'plan') {
      const source = option(parsed.options, 'source') ?? readRequiredFile(context, option(parsed.options, 'file'));
      const result = await requestJson(context, '/v1/system/schema/plan', {
        method: 'POST',
        auth: true,
        body: { dbId: requireDbId(context), source, actorId: option(parsed.options, 'actor-id') ?? 'cli' },
      });
      writeJson(stdout, result);
      return 0;
    }

    if (area === 'db' && (action === 'approve' || action === 'approval')) {
      const result = await requestJson(context, '/v1/system/schema/approvals', {
        method: 'POST',
        auth: true,
        body: {
          dbId: requireDbId(context),
          kind: option(parsed.options, 'kind'),
          planId: option(parsed.options, 'plan-id'),
          versionId: option(parsed.options, 'version-id'),
          snapshotId: option(parsed.options, 'snapshot-id'),
          stepUpToken: option(parsed.options, 'step-up-token'),
          actorId: option(parsed.options, 'actor-id') ?? 'cli',
        },
      });
      writeJson(stdout, result);
      return 0;
    }

    if (area === 'db' && action === 'apply') {
      const result = await requestJson(context, '/v1/system/schema/apply', {
        method: 'POST',
        auth: true,
        body: {
          dbId: requireDbId(context),
          planId: requiredOption(parsed.options, 'plan-id'),
          approvalToken: option(parsed.options, 'approval-token'),
          stepUpToken: option(parsed.options, 'step-up-token'),
          actorId: option(parsed.options, 'actor-id') ?? 'cli',
        },
      });
      writeJson(stdout, result);
      return 0;
    }

    if (area === 'db' && action === 'snapshot') {
      const result = await requestJson(context, '/v1/system/snapshots', {
        method: 'POST',
        auth: true,
        body: { dbId: requireDbId(context), kind: option(parsed.options, 'kind') ?? 'manual' },
      });
      writeJson(stdout, result);
      return 0;
    }

    if (area === 'db' && action === 'revert') {
      const result = await requestJson(context, '/v1/system/schema/revert', {
        method: 'POST',
        auth: true,
        body: {
          dbId: requireDbId(context),
          versionId: option(parsed.options, 'version-id'),
          snapshotId: option(parsed.options, 'snapshot-id'),
          approvalToken: option(parsed.options, 'approval-token'),
          actorId: option(parsed.options, 'actor-id') ?? 'cli',
        },
      });
      writeJson(stdout, result);
      return 0;
    }

    if (area === 'system' && action === 'grants' && (subaction === 'ls' || subaction === 'list')) {
      const principalId = option(parsed.options, 'principal-id');
      const search = new URLSearchParams({ dbId: requireDbId(context) });
      if (principalId) search.set('principalId', principalId);
      const result = await requestJson(context, `/v1/system/grants?${search.toString()}`, {
        method: 'GET',
        auth: true,
      });
      writeJson(stdout, result);
      return 0;
    }

    if (area === 'system' && action === 'grants' && (!subaction || subaction === 'set')) {
      const result = await requestJson(context, '/v1/system/grants', {
        method: 'POST',
        auth: true,
        body: {
          dbId: requireDbId(context),
          principalId: requiredOption(parsed.options, 'principal-id'),
          grants: optionList(parsed.options, 'grant').concat(splitList(option(parsed.options, 'grants'))),
          actorId: option(parsed.options, 'actor-id') ?? 'cli',
        },
      });
      writeJson(stdout, result);
      return 0;
    }

    if (area === 'audit' && action === 'tail') {
      const limit = option(parsed.options, 'limit') ?? '50';
      const result = await requestJson(
        context,
        `/v1/system/audit?dbId=${encodeURIComponent(requireDbId(context))}&limit=${encodeURIComponent(limit)}`,
        { method: 'GET', auth: true },
      );
      writeJson(stdout, result);
      return 0;
    }

    if (area === 'tokens' && action === 'rotate') {
      const result = await requestJson(context, `/v1/databases/${encodeURIComponent(requireDbId(context))}/tokens/${encodeURIComponent(requiredOption(parsed.options, 'token-id'))}/rotate`, {
        method: 'POST',
        auth: true,
      });
      writeJson(stdout, result);
      return 0;
    }

    throw new Error(`unknown Cumulus command: ${[area, action, subaction].filter(Boolean).join(' ')}`);
  } catch (error) {
    stderr(`${error instanceof Error ? error.message : String(error)}\n`);
    return 1;
  }
}

async function runLogin(context: CliContext, options: CliOptions): Promise<unknown> {
  const clientId = option(options, 'client-id') ?? 'cumulus-cli';
  const scope = option(options, 'scope') ?? 'openid email system:read';
  const deviceCode = option(options, 'device-code');
  if (deviceCode) {
    return requestForm(context, '/oauth/token', {
      grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
      client_id: clientId,
      device_code: deviceCode,
    });
  }
  return requestJson(context, '/oauth/device_authorization', {
    method: 'POST',
    body: { client_id: clientId, db_id: requireDbId(context), scope },
  });
}

function makeContext(
  options: CliOptions,
  env: Record<string, string | undefined>,
  runtime: Pick<CliContext, 'cwd' | 'fetch' | 'readFile'>,
): CliContext {
  return {
    ...runtime,
    baseUrl: option(options, 'url') ?? env.CUMULUS_DB_URL ?? 'http://127.0.0.1:4317',
    dbId: option(options, 'db-id') ?? env.CUMULUS_DB_ID,
    token: option(options, 'token') ?? env.CUMULUS_DB_TOKEN,
    adminKey: option(options, 'admin-key') ?? env.CUMULUS_DB_ADMIN_KEY,
  };
}

async function requestJson(
  context: CliContext,
  path: string,
  options: {
    method: 'GET' | 'POST' | 'PATCH' | 'DELETE';
    body?: unknown;
    auth?: boolean;
    admin?: boolean;
  },
): Promise<unknown> {
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (options.body !== undefined) headers['Content-Type'] = 'application/json';
  if (options.auth) headers.Authorization = `Bearer ${requireToken(context)}`;
  if (options.admin) headers['X-Cumulus-Admin-Key'] = requireAdminKey(context);
  const response = await context.fetch(new URL(path, context.baseUrl), {
    method: options.method,
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  return parseResponse(response);
}

async function requestForm(context: CliContext, path: string, body: Record<string, string>): Promise<unknown> {
  const response = await context.fetch(new URL(path, context.baseUrl), {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams(body),
  });
  return parseResponse(response);
}

async function parseResponse(response: Response): Promise<unknown> {
  const text = await response.text();
  const body = text ? JSON.parse(text) as unknown : null;
  if (!response.ok) {
    const message =
      body && typeof body === 'object' && 'error' in body && typeof (body as { error?: unknown }).error === 'string'
        ? (body as { error: string }).error
        : `HTTP ${response.status}`;
    throw new Error(message);
  }
  return body;
}

function parseArgs(argv: string[]): ParsedArgs {
  const options: CliOptions = new Map();
  const positionals: string[] = [];
  for (let index = 0; index < argv.length; index += 1) {
    const item = argv[index]!;
    if (!item.startsWith('--')) {
      positionals.push(item);
      continue;
    }
    const equals = item.indexOf('=');
    const name = equals === -1 ? item.slice(2) : item.slice(2, equals);
    const inlineValue = equals === -1 ? undefined : item.slice(equals + 1);
    const next = argv[index + 1];
    const value = inlineValue ?? (next && !next.startsWith('--') ? argv[++index] : true);
    const existing = options.get(name);
    if (Array.isArray(existing)) options.set(name, [...existing, String(value)]);
    else if (existing === true) options.set(name, [String(value)]);
    else options.set(name, value === true ? true : [String(value)]);
  }
  return { positionals, options };
}

function option(options: CliOptions, name: string): string | undefined {
  const value = options.get(name);
  if (Array.isArray(value)) return value.at(-1);
  return undefined;
}

function optionList(options: CliOptions, name: string): string[] {
  const value = options.get(name);
  return Array.isArray(value) ? value.flatMap(splitList) : [];
}

function splitList(value: string | undefined): string[] {
  return (value ?? '').split(',').map((item) => item.trim()).filter(Boolean);
}

function requiredOption(options: CliOptions, name: string): string {
  const value = option(options, name);
  if (!value) throw new Error(`--${name} is required`);
  return value;
}

function requireDbId(context: CliContext): string {
  if (!context.dbId) throw new Error('--db-id or CUMULUS_DB_ID is required');
  return context.dbId;
}

function requireToken(context: CliContext): string {
  if (!context.token) throw new Error('--token or CUMULUS_DB_TOKEN is required');
  return context.token;
}

function requireAdminKey(context: CliContext): string {
  if (!context.adminKey) throw new Error('--admin-key or CUMULUS_DB_ADMIN_KEY is required');
  return context.adminKey;
}

function readRequiredFile(context: CliContext, file: string | undefined): string {
  if (!file) throw new Error('--file or --source is required');
  const absolute = isAbsolute(file) ? resolve(file) : resolve(context.cwd, file);
  return context.readFile(absolute);
}

function writeJson(stdout: (text: string) => void, body: unknown): void {
  stdout(`${JSON.stringify(body, null, 2)}\n`);
}

function usage(): string {
  return `Usage:
  cumulus login --db-id <id> [--scope "openid email system:read"]
  cumulus login --device-code <code>
  cumulus agent init --admin-key <key> [--display-name <name>]
  cumulus whoami --token <token>
  cumulus db plan --db-id <id> --token <token> --file schema.nimbus
  cumulus db approve --db-id <id> --token <token> --plan-id <id>
  cumulus db approve --db-id <id> --token <token> --kind revert (--version-id <id> | --snapshot-id <id>)
  cumulus db apply --db-id <id> --token <token> --plan-id <id> [--approval-token <token>]
  cumulus db snapshot --db-id <id> --token <token> [--kind manual]
  cumulus db revert --db-id <id> --token <token> (--version-id <id> | --snapshot-id <id>) --approval-token <token>
  cumulus system grants ls --db-id <id> --token <token> [--principal-id <id>]
  cumulus system grants set --db-id <id> --token <token> --principal-id <id> --grant system:read
  cumulus audit tail --db-id <id> --token <token> [--limit 50]
  cumulus nimbus <compile|check|fmt> ...
`;
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : '';
const modulePath = resolve(fileURLToPath(import.meta.url));

if (invokedPath === modulePath) {
  void runCumulusCli().then((code) => {
    process.exitCode = code;
  });
}
