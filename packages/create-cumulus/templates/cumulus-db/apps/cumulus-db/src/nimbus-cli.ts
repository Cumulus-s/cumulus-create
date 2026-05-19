// SPDX-License-Identifier: AGPL-3.0-only
import { readFileSync, writeFileSync } from 'node:fs';
import { isAbsolute, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  checkNimbusFile,
  compileNimbusFile,
  formatNimbusDiagnostic,
  formatNimbusSource,
  toNimbusDiagnostics,
  type NimbusDiagnostic,
} from './nimbus.js';

export interface NimbusCliIo {
  cwd?: string;
  stdout?: (text: string) => void;
  stderr?: (text: string) => void;
  readFile?: (absolutePath: string) => string;
  writeFile?: (absolutePath: string, content: string) => void;
}

interface ParsedArgs {
  command: string;
  files: string[];
  json: boolean;
  check: boolean;
  out?: string;
  rootDir?: string;
  allowSystemNamespace: boolean;
}

export async function runNimbusCli(argv = process.argv.slice(2), io: NimbusCliIo = {}): Promise<number> {
  const cwd = resolve(io.cwd ?? process.cwd());
  const stdout = io.stdout ?? ((text: string) => process.stdout.write(text));
  const stderr = io.stderr ?? ((text: string) => process.stderr.write(text));
  const readFile = io.readFile ?? ((path: string) => readFileSync(path, 'utf8'));
  const writeFile = io.writeFile ?? ((path: string, content: string) => writeFileSync(path, content));

  try {
    const parsed = parseArgs(argv, cwd);
    if (parsed.command === 'help' || parsed.command === '--help' || parsed.command === '-h') {
      stdout(usage());
      return 0;
    }

    if (parsed.command === 'compile') {
      if (parsed.files.length !== 1) throw new Error('nimbus compile expects exactly one file');
      const filePath = absolutePath(cwd, parsed.files[0]!);
      const result = compileNimbusFile(filePath, {
        rootDir: parsed.rootDir ?? cwd,
        allowSystemNamespace: parsed.allowSystemNamespace,
        readFile,
      });
      const output = `${result.canonicalJson}\n`;
      if (parsed.out) writeFile(absolutePath(cwd, parsed.out), output);
      else stdout(output);
      return 0;
    }

    if (parsed.command === 'check') {
      if (!parsed.files.length) throw new Error('nimbus check expects at least one file');
      const diagnostics = parsed.files.flatMap((file) => {
        const result = checkNimbusFile(absolutePath(cwd, file), {
          rootDir: parsed.rootDir ?? cwd,
          allowSystemNamespace: parsed.allowSystemNamespace,
          readFile,
        });
        return result.diagnostics;
      });
      if (diagnostics.length) {
        writeDiagnostics(stderr, diagnostics, parsed.json);
        return 1;
      }
      stdout(parsed.json ? JSON.stringify({ ok: true, files: parsed.files.length }) + '\n' : `Nimbus check passed (${parsed.files.length} file(s)).\n`);
      return 0;
    }

    if (parsed.command === 'fmt') {
      if (!parsed.files.length) throw new Error('nimbus fmt expects at least one file');
      const diagnostics: NimbusDiagnostic[] = [];
      for (const file of parsed.files) {
        const filePath = absolutePath(cwd, file);
        const source = readFile(filePath);
        const formatted = formatNimbusSource(source, { fileName: file });
        if (source !== formatted) {
          if (parsed.check) {
            diagnostics.push({
              code: 'NIMBUS_FORMAT_REQUIRED',
              severity: 'error',
              stage: 'format',
              message: 'Nimbus source is not formatted',
              file,
            });
          } else {
            writeFile(filePath, formatted);
          }
        }
      }
      if (diagnostics.length) {
        writeDiagnostics(stderr, diagnostics, parsed.json);
        return 1;
      }
      stdout(
        parsed.json
          ? JSON.stringify({ ok: true, files: parsed.files.length, changed: parsed.check ? 0 : undefined }) + '\n'
          : `Nimbus format ${parsed.check ? 'check ' : ''}passed (${parsed.files.length} file(s)).\n`,
      );
      return 0;
    }

    throw new Error(`unknown Nimbus command: ${parsed.command}`);
  } catch (error) {
    const diagnostics = toNimbusDiagnostics(error, {
      code: 'NIMBUS_CLI_ERROR',
      stage: 'check',
      file: 'nimbus',
    });
    writeDiagnostics(stderr, diagnostics, argv.includes('--json'));
    return 1;
  }
}

function parseArgs(argv: string[], cwd: string): ParsedArgs {
  const [command = 'help', ...rest] = argv;
  const parsed: ParsedArgs = {
    command,
    files: [],
    json: false,
    check: false,
    allowSystemNamespace: false,
  };

  for (let index = 0; index < rest.length; index += 1) {
    const item = rest[index]!;
    if (item === '--json') parsed.json = true;
    else if (item === '--check') parsed.check = true;
    else if (item === '--allow-system-namespace') parsed.allowSystemNamespace = true;
    else if (item === '--out') parsed.out = rest[++index];
    else if (item === '--root') parsed.rootDir = absolutePath(cwd, rest[++index] ?? '');
    else parsed.files.push(item);
  }

  return parsed;
}

function absolutePath(cwd: string, path: string): string {
  return isAbsolute(path) ? resolve(path) : resolve(cwd, path);
}

function writeDiagnostics(write: (text: string) => void, diagnostics: NimbusDiagnostic[], json: boolean): void {
  if (json) {
    write(`${JSON.stringify({ ok: false, diagnostics })}\n`);
    return;
  }
  write(`${diagnostics.map(formatNimbusDiagnostic).join('\n')}\n`);
}

function usage(): string {
  return `Usage:
  nimbus compile <file> [--out <file>] [--root <dir>] [--json]
  nimbus check <file...> [--root <dir>] [--json]
  nimbus fmt <file...> [--check] [--json]
`;
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : '';
const modulePath = resolve(fileURLToPath(import.meta.url));

if (invokedPath === modulePath) {
  void runNimbusCli().then((code) => {
    process.exitCode = code;
  });
}
