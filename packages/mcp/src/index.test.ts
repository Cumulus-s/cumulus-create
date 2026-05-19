import { spawn } from 'node:child_process';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

let child: ReturnType<typeof spawn> | undefined;

describe('@cls/mcp schema surface', () => {
  afterEach(() => {
    child?.kill();
    child = undefined;
  });

  it('lists safe Cumulus tools, resources, and prompts', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'cumulus-mcp-'));
    child = spawn(process.execPath, ['--import', 'tsx', 'src/index.ts'], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        CUMULUS_EVENTS_LEDGER: join(dir, 'events.jsonl'),
        CUMULUS_ALTOCUMULUS_HOME: dir,
      },
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    const client = rpcClient(child);
    const tools = await client.call('tools/list');
    const resources = await client.call('resources/list');
    const prompts = await client.call('prompts/list');

    expect(tools.tools.map((tool: { name: string }) => tool.name)).toEqual(
      expect.arrayContaining([
        'cumulus.list_projects',
        'cumulus.list_agent_accounts',
        'cumulus.get_usage_summary',
        'cumulus.scan_project',
        'cumulus.sync_safe_events',
      ]),
    );
    expect(resources.resources.map((resource: { uri: string }) => resource.uri)).toEqual(
      expect.arrayContaining([
        'cumulus://projects',
        'cumulus://agent/local/auth',
        'cumulus://agent/local/db',
        'cumulus://agent/local/knowledge',
        'cumulus://usage/local',
      ]),
    );
    expect(prompts.prompts.map((prompt: { name: string }) => prompt.name)).toEqual(
      expect.arrayContaining(['audit_auth_risk', 'explain_usage_cost']),
    );
  });
});

function rpcClient(processHandle: ReturnType<typeof spawn>) {
  let id = 0;
  let buffer = '';
  const waiters = new Map<number, (value: Record<string, any>) => void>();

  processHandle.stdout?.setEncoding('utf8');
  processHandle.stdout?.on('data', (chunk: string) => {
    buffer += chunk;
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() ?? '';
    for (const line of lines) {
      if (!line.trim()) continue;
      const message = JSON.parse(line) as Record<string, any>;
      if (typeof message.id === 'number') {
        waiters.get(message.id)?.(message);
        waiters.delete(message.id);
      }
    }
  });

  return {
    call(method: string, params: Record<string, unknown> = {}) {
      id += 1;
      const requestId = id;
      processHandle.stdin?.write(`${JSON.stringify({ jsonrpc: '2.0', id: requestId, method, params })}\n`);
      return new Promise<Record<string, any>>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(`MCP request timed out: ${method}`)), 5000);
        waiters.set(requestId, (message) => {
          clearTimeout(timer);
          if (message.error) {
            reject(new Error(String(message.error.message)));
            return;
          }
          resolve(message.result as Record<string, any>);
        });
      });
    },
  };
}
