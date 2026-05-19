// SPDX-License-Identifier: AGPL-3.0-only
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  checkNimbus,
  compileNimbus,
  compileNimbusFile,
  isNimbusDiagnosticError,
  toNimbusDiagnostics,
} from '../nimbus.js';

const source = `
nimbus "v1alpha1"

/// Application workspace schema.
namespace acme {
  collection agents {
    fields: {
      id: { type: "ulid", required: true },
      orgId: { type: "ulid", required: true },
      status: { type: "string", enum: ["active", "disabled", "pending"], default: "pending" }
    }

    index agents_org_status {
      keys: ["orgId", "status"]
      unique: false
    }
  }

  secret backup_kek {
    from: env("CUMULUS_BACKUP_KEK")
  }
}
`;

describe('Nimbus compiler', () => {
  it('compiles source into deterministic canonical JSON IR', () => {
    const first = compileNimbus(source, { fileName: 'system.nimbus' });
    const second = compileNimbus(source, { fileName: 'system.nimbus' });

    expect(first.hash).toBe(second.hash);
    expect(first.canonicalJson).toBe(second.canonicalJson);
    expect(first.ir.apiVersion).toBe('nimbus.cumulus/v1alpha1');
    expect(first.ir.kind).toBe('NimbusDocument');
    expect(first.ir.metadata.docs).toBe('Application workspace schema.');
    expect(first.ir.spec.namespace).toBe('acme');
    expect(first.ir.spec.collections[0]?.name).toBe('agents');
    expect(first.ir.spec.collections[0]?.fields.status).toEqual({
      default: 'pending',
      enum: ['active', 'disabled', 'pending'],
      type: 'string',
    });
    expect(first.ir.spec.secrets[0]?.source).toEqual({ kind: 'envRef', name: 'CUMULUS_BACKUP_KEK' });
    expect(first.canonicalJson).not.toContain('replace-with-strong-secret');
  });

  it('rejects reserved system namespaces unless the caller is provider-owned', () => {
    expect(() =>
      compileNimbus(`
        namespace system {
          collection agents { fields: { id: { type: "ulid" } } }
        }
      `),
    ).toThrow('reserved');

    expect(
      compileNimbus(
        `
        namespace system {
          collection agents { fields: { id: { type: "ulid" } } }
        }
      `,
        { allowSystemNamespace: true },
      ).ir.spec.namespace,
    ).toBe('system');
  });

  it('requires secret declarations to compile as env references', () => {
    expect(() =>
      compileNimbus(`
        namespace acme {
          secret bad { from: "plaintext-secret" }
          collection notes { fields: { id: { type: "ulid" } } }
        }
      `),
    ).toThrow('env');
  });

  it('resolves relative local imports before compiling canonical IR', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'cumulus-nimbus-imports-'));
    await writeFile(
      join(dir, 'collections.nimbus'),
      `
        namespace acme {
          collection agents {
            fields: {
              id: { type: "ulid", required: true }
            }
          }
        }
      `,
    );
    await writeFile(
      join(dir, 'root.nimbus'),
      `
        import "./collections.nimbus"

        namespace acme {
          collection runs {
            fields: {
              id: { type: "ulid", required: true }
            }
          }
        }
      `,
    );

    const result = compileNimbusFile('root.nimbus', { rootDir: dir });

    expect(result.ast.imports).toEqual([{ path: './collections.nimbus' }]);
    expect(result.ir.spec.collections.map((collection) => collection.name)).toEqual(['agents', 'runs']);
    expect(result.ir.metadata.sourceHash).toMatch(/^sha256:[a-f0-9]{64}$/);
  });

  it('does not resolve imports unless local file resolution is explicit', () => {
    const result = checkNimbus('import "./collections.nimbus"');

    expect(result.ok).toBe(false);
    expect(result.diagnostics[0]?.code).toBe('NIMBUS_IMPORTS_DISABLED');
  });

  it('rejects non-local imports and imports outside the root', () => {
    const remote = checkNimbus('import "https://example.com/schema.nimbus"', {
      fileName: 'root.nimbus',
      resolveImports: true,
      importRoot: '/workspace',
    });
    expect(remote.ok).toBe(false);
    expect(remote.diagnostics[0]?.code).toBe('NIMBUS_IMPORT_LOCAL_ONLY');

    const outside = checkNimbus('import "../private.nimbus"', {
      fileName: '/workspace/root.nimbus',
      resolveImports: true,
      importRoot: '/workspace',
    });
    expect(outside.ok).toBe(false);
    expect(outside.diagnostics[0]?.code).toBe('NIMBUS_IMPORT_OUTSIDE_ROOT');
  });

  it('detects import cycles with stable structured diagnostics', () => {
    const files = new Map<string, string>([
      [
        '/workspace/a.nimbus',
        `
          import "./b.nimbus"
          namespace acme {
            collection a { fields: { id: { type: "ulid" } } }
          }
        `,
      ],
      [
        '/workspace/b.nimbus',
        `
          import "./a.nimbus"
          namespace acme {
            collection b { fields: { id: { type: "ulid" } } }
          }
        `,
      ],
    ]);

    try {
      compileNimbus(files.get('/workspace/a.nimbus')!, {
        fileName: '/workspace/a.nimbus',
        importRoot: '/workspace',
        resolveImports: true,
        readImport: (path) => {
          const content = files.get(path);
          if (content === undefined) throw new Error(`missing ${path}`);
          return content;
        },
      });
      throw new Error('expected cycle error');
    } catch (error) {
      expect(isNimbusDiagnosticError(error)).toBe(true);
      const diagnostics = toNimbusDiagnostics(error);
      expect(diagnostics[0]).toMatchObject({
        code: 'NIMBUS_IMPORT_CYCLE',
        stage: 'resolve',
        file: 'a.nimbus',
      });
      expect(diagnostics[0]?.message).toContain('a.nimbus -> b.nimbus -> a.nimbus');
    }
  });

  it('returns line-numbered diagnostics for parse and check failures', () => {
    const broken = checkNimbus(`
      namespace acme {
        collection notes {
          fields: { id: { type: "ulid" } }
    `);

    expect(broken.ok).toBe(false);
    expect(broken.diagnostics[0]).toMatchObject({
      code: 'NIMBUS_PARSE_EXPECTED_TOKEN',
      severity: 'error',
      stage: 'parse',
      line: 5,
    });

    const reserved = checkNimbus('namespace system { collection notes { fields: { id: { type: "ulid" } } } }');
    expect(reserved.ok).toBe(false);
    expect(reserved.diagnostics[0]?.code).toBe('NIMBUS_RESERVED_NAMESPACE');
  });
});
