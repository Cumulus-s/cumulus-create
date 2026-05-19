// SPDX-License-Identifier: AGPL-3.0-only
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { runNimbusCli } from '../nimbus-cli.js';

async function tempWorkspace(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'cumulus-nimbus-cli-'));
}

describe('Nimbus CLI', () => {
  it('compiles a Nimbus file to canonical JSON', async () => {
    const dir = await tempWorkspace();
    await writeFile(
      join(dir, 'schema.nimbus'),
      `
        namespace acme {
          collection notes {
            fields: {
              id: { type: "ulid", required: true }
            }
          }
        }
      `,
    );

    let stdout = '';
    const code = await runNimbusCli(['compile', 'schema.nimbus', '--root', dir], {
      cwd: dir,
      stdout: (text) => {
        stdout += text;
      },
    });

    expect(code).toBe(0);
    expect(JSON.parse(stdout)).toMatchObject({
      apiVersion: 'nimbus.cumulus/v1alpha1',
      spec: { namespace: 'acme' },
    });
  });

  it('returns JSON diagnostics for failed checks', async () => {
    const dir = await tempWorkspace();
    await writeFile(join(dir, 'schema.nimbus'), 'namespace system { collection notes { fields: { id: { type: "ulid" } } } }');

    let stderr = '';
    const code = await runNimbusCli(['check', 'schema.nimbus', '--root', dir, '--json'], {
      cwd: dir,
      stderr: (text) => {
        stderr += text;
      },
    });

    expect(code).toBe(1);
    expect(JSON.parse(stderr).diagnostics[0]).toMatchObject({
      code: 'NIMBUS_RESERVED_NAMESPACE',
      stage: 'check',
    });
  });

  it('checks and writes formatted Nimbus source', async () => {
    const dir = await tempWorkspace();
    const file = join(dir, 'schema.nimbus');
    await writeFile(file, 'namespace acme { collection notes { fields: { id: { type: "ulid" } } } }');

    let stderr = '';
    const failedCheck = await runNimbusCli(['fmt', 'schema.nimbus', '--check'], {
      cwd: dir,
      stderr: (text) => {
        stderr += text;
      },
    });
    expect(failedCheck).toBe(1);
    expect(stderr).toContain('NIMBUS_FORMAT_REQUIRED');

    const formatted = await runNimbusCli(['fmt', 'schema.nimbus'], { cwd: dir, stdout: () => undefined });
    expect(formatted).toBe(0);
    expect(await readFile(file, 'utf8')).toContain('\n  collection notes {\n');
  });
});
