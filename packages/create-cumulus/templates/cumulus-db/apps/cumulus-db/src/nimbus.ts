// SPDX-License-Identifier: AGPL-3.0-only
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, isAbsolute, relative, resolve } from 'node:path';
import {
  NIMBUS_API_VERSION,
  NIMBUS_IR_SCHEMA_ID,
  NIMBUS_KIND,
  nimbusIrJsonSchema,
} from './nimbus-schema.js';

export const NIMBUS_COMPILER_VERSION = '0.1.0';

type TokenType =
  | 'identifier'
  | 'string'
  | 'number'
  | 'boolean'
  | 'null'
  | 'doc'
  | '{'
  | '}'
  | '['
  | ']'
  | ':'
  | ','
  | '('
  | ')'
  | '.'
  | 'eof';

interface Token {
  type: TokenType;
  value: string;
  start: number;
  end: number;
}

export type NimbusValue =
  | string
  | number
  | boolean
  | null
  | NimbusValue[]
  | { [key: string]: NimbusValue }
  | { kind: 'envRef'; name: string }
  | { kind: 'reference'; path: string[] };

export interface NimbusDeclaration {
  type: string;
  name: string;
  docs?: string;
  fields: Record<string, NimbusValue>;
  declarations: NimbusDeclaration[];
  sourceSpan: { file: string; start: number; end: number };
}

export interface NimbusDocumentAst {
  type: 'Document';
  version: string;
  imports: Array<{ path: string; alias?: string }>;
  declarations: NimbusDeclaration[];
}

export interface NimbusIr {
  $schema: typeof NIMBUS_IR_SCHEMA_ID;
  apiVersion: typeof NIMBUS_API_VERSION;
  kind: typeof NIMBUS_KIND;
  metadata: {
    name: string;
    compilerVersion: string;
    sourceHash: string;
    docs?: string;
  };
  spec: {
    namespace: string;
    apps: NimbusNamedIr[];
    collections: NimbusCollectionIr[];
    indexes: NimbusNamedIr[];
    policies: NimbusNamedIr[];
    secrets: NimbusSecretIr[];
    backups: NimbusNamedIr[];
    approvals: NimbusNamedIr[];
  };
}

export interface NimbusNamedIr {
  name: string;
  docs?: string;
  attributes?: Record<string, unknown>;
}

export interface NimbusCollectionIr extends NimbusNamedIr {
  fields: Record<string, unknown>;
  indexes?: NimbusNamedIr[];
}

export interface NimbusSecretIr extends NimbusNamedIr {
  source: { kind: 'envRef'; name: string };
}

export interface CompileNimbusOptions {
  fileName?: string;
  allowSystemNamespace?: boolean;
  name?: string;
  resolveImports?: boolean;
  importRoot?: string;
  readImport?: (absolutePath: string) => string;
}

export interface CompileNimbusFileOptions extends Omit<CompileNimbusOptions, 'fileName' | 'resolveImports' | 'readImport'> {
  rootDir?: string;
  readFile?: (absolutePath: string) => string;
}

export interface CompileNimbusResult {
  ast: NimbusDocumentAst;
  ir: NimbusIr;
  canonicalJson: string;
  hash: string;
  schema: typeof nimbusIrJsonSchema;
}

export type NimbusDiagnosticSeverity = 'error' | 'warning';
export type NimbusDiagnosticStage = 'lex' | 'parse' | 'resolve' | 'compile' | 'check' | 'format';

export interface NimbusDiagnostic {
  code: string;
  severity: NimbusDiagnosticSeverity;
  stage: NimbusDiagnosticStage;
  message: string;
  file: string;
  start?: number;
  end?: number;
  line?: number;
  column?: number;
  related?: Array<{ file: string; message: string; line?: number; column?: number }>;
}

export interface NimbusCheckResult {
  ok: boolean;
  diagnostics: NimbusDiagnostic[];
  result?: CompileNimbusResult;
}

export class NimbusDiagnosticError extends Error {
  readonly diagnostics: NimbusDiagnostic[];

  constructor(diagnostics: NimbusDiagnostic[]) {
    super(diagnostics.map(formatNimbusDiagnostic).join('\n'));
    this.name = 'NimbusDiagnosticError';
    this.diagnostics = diagnostics;
  }
}

const DECLARATION_TYPES = new Set([
  'namespace',
  'app',
  'collection',
  'index',
  'policy',
  'secret',
  'backup',
  'approval',
]);

const RESERVED_NAMESPACES = [
  'system',
  '_system',
  '_cumulus',
  'cumulus',
];

function sha256(value: string): string {
  return `sha256:${createHash('sha256').update(value).digest('hex')}`;
}

function lineColumnFor(source: string, index: number): { line: number; column: number } {
  const safeIndex = Math.max(0, Math.min(index, source.length));
  let line = 1;
  let column = 1;
  for (let cursor = 0; cursor < safeIndex; cursor += 1) {
    if (source[cursor] === '\n') {
      line += 1;
      column = 1;
    } else {
      column += 1;
    }
  }
  return { line, column };
}

function diagnostic(input: {
  code: string;
  stage: NimbusDiagnosticStage;
  message: string;
  file: string;
  source?: string;
  start?: number;
  end?: number;
  related?: NimbusDiagnostic['related'];
}): NimbusDiagnostic {
  const position =
    input.source !== undefined && input.start !== undefined ? lineColumnFor(input.source, input.start) : {};
  return {
    code: input.code,
    severity: 'error',
    stage: input.stage,
    message: input.message,
    file: input.file,
    ...(input.start !== undefined ? { start: input.start } : {}),
    ...(input.end !== undefined ? { end: input.end } : {}),
    ...position,
    ...(input.related?.length ? { related: input.related } : {}),
  };
}

function failWithDiagnostic(input: Parameters<typeof diagnostic>[0]): never {
  throw new NimbusDiagnosticError([diagnostic(input)]);
}

export function isNimbusDiagnosticError(error: unknown): error is NimbusDiagnosticError {
  return error instanceof NimbusDiagnosticError;
}

export function toNimbusDiagnostics(
  error: unknown,
  fallback: {
    code?: string;
    stage?: NimbusDiagnosticStage;
    file?: string;
    source?: string;
  } = {},
): NimbusDiagnostic[] {
  if (isNimbusDiagnosticError(error)) return error.diagnostics;
  const message = error instanceof Error ? error.message : String(error);
  return [
    diagnostic({
      code: fallback.code ?? 'NIMBUS_UNEXPECTED_ERROR',
      stage: fallback.stage ?? 'compile',
      message,
      file: fallback.file ?? 'document.nimbus',
      source: fallback.source,
    }),
  ];
}

export function formatNimbusDiagnostic(item: NimbusDiagnostic): string {
  const location = item.line && item.column ? `${item.file}:${item.line}:${item.column}` : item.file;
  return `${location} ${item.code}: ${item.message}`;
}

function isReservedNamespace(namespace: string): boolean {
  return RESERVED_NAMESPACES.some((reserved) => namespace === reserved || namespace.startsWith(`${reserved}.`));
}

export function assertNimbusNamespaceAllowed(
  ir: NimbusIr,
  allowSystemNamespace = false,
  context: { fileName?: string; source?: string } = {},
): void {
  if (isReservedNamespace(ir.spec.namespace) && !allowSystemNamespace) {
    failWithDiagnostic({
      code: 'NIMBUS_RESERVED_NAMESPACE',
      stage: 'check',
      message: `namespace ${ir.spec.namespace} is reserved for provider-owned system documents`,
      file: context.fileName ?? '<ir>',
      source: context.source,
    });
  }
}

function tokenize(source: string, fileName: string): Token[] {
  const tokens: Token[] = [];
  let index = 0;

  const push = (type: TokenType, value: string, start: number, end: number) => {
    tokens.push({ type, value, start, end });
  };

  while (index < source.length) {
    const char = source[index] ?? '';
    const next = source[index + 1] ?? '';
    const start = index;

    if (/\s/.test(char)) {
      index += 1;
      continue;
    }

    if (char === '/' && next === '/') {
      const doc = source[index + 2] === '/';
      index += doc ? 3 : 2;
      const textStart = index;
      while (index < source.length && source[index] !== '\n') index += 1;
      if (doc) push('doc', source.slice(textStart, index).trim(), start, index);
      continue;
    }

    if ('{}[]:,().'.includes(char)) {
      push(char as TokenType, char, start, start + 1);
      index += 1;
      continue;
    }

    if (char === '"') {
      index += 1;
      let value = '';
      let closed = false;
      while (index < source.length) {
        const current = source[index] ?? '';
        if (current === '"') {
          index += 1;
          push('string', value, start, index);
          closed = true;
          break;
        }
        if (current === '\\') {
          const escaped = source[index + 1];
          if (escaped === undefined) {
            failWithDiagnostic({
              code: 'NIMBUS_LEX_UNTERMINATED_STRING',
              stage: 'lex',
              message: 'unterminated string escape',
              file: fileName,
              source,
              start,
              end: index,
            });
          }
          const map: Record<string, string> = { n: '\n', r: '\r', t: '\t', '"': '"', '\\': '\\' };
          value += map[escaped] ?? escaped;
          index += 2;
          continue;
        }
        value += current;
        index += 1;
      }
      if (!closed) {
        failWithDiagnostic({
          code: 'NIMBUS_LEX_UNTERMINATED_STRING',
          stage: 'lex',
          message: 'unterminated string literal',
          file: fileName,
          source,
          start,
          end: index,
        });
      }
      continue;
    }

    if (/[0-9-]/.test(char)) {
      index += 1;
      while (index < source.length && /[0-9._]/.test(source[index] ?? '')) index += 1;
      push('number', source.slice(start, index).replaceAll('_', ''), start, index);
      continue;
    }

    if (/[A-Za-z_]/.test(char)) {
      index += 1;
      while (index < source.length && /[A-Za-z0-9_-]/.test(source[index] ?? '')) index += 1;
      const value = source.slice(start, index);
      if (value === 'true' || value === 'false') push('boolean', value, start, index);
      else if (value === 'null') push('null', value, start, index);
      else push('identifier', value, start, index);
      continue;
    }

    failWithDiagnostic({
      code: 'NIMBUS_LEX_UNEXPECTED_CHARACTER',
      stage: 'lex',
      message: `unexpected character ${JSON.stringify(char)}`,
      file: fileName,
      source,
      start,
      end: start + 1,
    });
  }

  tokens.push({ type: 'eof', value: '', start: source.length, end: source.length });
  return tokens;
}

class Parser {
  private cursor = 0;
  private pendingDocs: string[] = [];

  constructor(
    private readonly tokens: Token[],
    private readonly fileName: string,
    private readonly source: string,
  ) {}

  parseDocument(): NimbusDocumentAst {
    let version = 'v1alpha1';
    const imports: NimbusDocumentAst['imports'] = [];
    const declarations: NimbusDeclaration[] = [];

    this.collectDocs();
    if (this.peekValue('nimbus')) {
      this.expect('identifier', 'nimbus');
      version = this.expect('string').value;
    }

    while (!this.peek('eof')) {
      this.collectDocs();
      if (this.peek('eof')) break;
      if (this.peekValue('import')) {
        this.expect('identifier', 'import');
        const path = this.expect('string').value;
        let alias: string | undefined;
        if (this.peekValue('as')) {
          this.expect('identifier', 'as');
          alias = this.expect('identifier').value;
        }
        imports.push({ path, ...(alias ? { alias } : {}) });
        continue;
      }
      declarations.push(this.parseDeclaration());
    }

    return { type: 'Document', version, imports, declarations };
  }

  private parseDeclaration(): NimbusDeclaration {
    this.collectDocs();
    const docs = this.consumeDocs();
    const start = this.current().start;
    const type = this.expect('identifier').value;
    if (!DECLARATION_TYPES.has(type)) {
      this.fail('NIMBUS_PARSE_UNKNOWN_DECLARATION', `unknown Nimbus declaration ${type}`, this.lookahead(-1));
    }
    const nameToken = this.peek('string') ? this.expect('string') : this.expect('identifier');
    this.expect('{');
    const fields: Record<string, NimbusValue> = {};
    const declarations: NimbusDeclaration[] = [];

    while (!this.peek('}')) {
      this.collectDocs();
      if (this.peek('}')) break;
      if (this.peek('identifier') && DECLARATION_TYPES.has(this.current().value) && this.lookahead(1).type !== ':') {
        declarations.push(this.parseDeclaration());
        this.optionalComma();
        continue;
      }

      const fieldName = this.expect('identifier').value;
      this.expect(':');
      fields[fieldName] = this.parseValue();
      this.optionalComma();
    }

    const end = this.expect('}').end;
    return {
      type,
      name: nameToken.value,
      ...(docs ? { docs } : {}),
      fields,
      declarations,
      sourceSpan: { file: this.fileName, start, end },
    };
  }

  private parseValue(): NimbusValue {
    const token = this.current();
    if (token.type === 'string') return this.expect('string').value;
    if (token.type === 'number') return Number(this.expect('number').value);
    if (token.type === 'boolean') return this.expect('boolean').value === 'true';
    if (token.type === 'null') {
      this.expect('null');
      return null;
    }
    if (token.type === '[') return this.parseArray();
    if (token.type === '{') return this.parseObject();
    if (token.type === 'identifier') {
      if (token.value === 'env' && this.lookahead(1).type === '(') {
        this.expect('identifier', 'env');
        this.expect('(');
        const name = this.expect('string').value;
        this.expect(')');
        return { kind: 'envRef', name };
      }
      const path = [this.expect('identifier').value];
      while (this.peek('.')) {
        this.expect('.');
        path.push(this.expect('identifier').value);
      }
      return { kind: 'reference', path };
    }
    this.fail('NIMBUS_PARSE_UNEXPECTED_VALUE', `unexpected value token ${token.type}`, token);
  }

  private parseArray(): NimbusValue[] {
    const items: NimbusValue[] = [];
    this.expect('[');
    while (!this.peek(']')) {
      items.push(this.parseValue());
      this.optionalComma();
    }
    this.expect(']');
    return items;
  }

  private parseObject(): Record<string, NimbusValue> {
    const object: Record<string, NimbusValue> = {};
    this.expect('{');
    while (!this.peek('}')) {
      const key = this.peek('string') ? this.expect('string').value : this.expect('identifier').value;
      this.expect(':');
      object[key] = this.parseValue();
      this.optionalComma();
    }
    this.expect('}');
    return object;
  }

  private collectDocs(): void {
    while (this.peek('doc')) this.pendingDocs.push(this.expect('doc').value);
  }

  private consumeDocs(): string | undefined {
    const docs = this.pendingDocs.join('\n').trim();
    this.pendingDocs = [];
    return docs || undefined;
  }

  private optionalComma(): void {
    if (this.peek(',')) this.expect(',');
  }

  private current(): Token {
    return this.tokens[this.cursor] ?? this.tokens[this.tokens.length - 1]!;
  }

  private lookahead(offset: number): Token {
    return this.tokens[this.cursor + offset] ?? this.tokens[this.tokens.length - 1]!;
  }

  private peek(type: TokenType): boolean {
    return this.current().type === type;
  }

  private peekValue(value: string): boolean {
    const token = this.current();
    return token.type === 'identifier' && token.value === value;
  }

  private expect(type: TokenType, value?: string): Token {
    const token = this.current();
    if (token.type !== type || (value !== undefined && token.value !== value)) {
      this.fail('NIMBUS_PARSE_EXPECTED_TOKEN', `expected ${value ?? type}, got ${token.value || token.type}`, token);
    }
    this.cursor += 1;
    return token;
  }

  private fail(code: string, message: string, token = this.current()): never {
    failWithDiagnostic({
      code,
      stage: 'parse',
      message,
      file: this.fileName,
      source: this.source,
      start: token.start,
      end: token.end,
    });
  }
}

interface ParsedNimbusFile {
  fileKey: string;
  displayFile: string;
  source: string;
  ast: NimbusDocumentAst;
}

interface NimbusGraph {
  ast: NimbusDocumentAst;
  sourceHashInput: string;
  sourceByFile: Map<string, string>;
}

function parseNimbusDocument(source: string, fileName: string): NimbusDocumentAst {
  return new Parser(tokenize(source, fileName), fileName, source).parseDocument();
}

export function parseNimbus(source: string, options: CompileNimbusOptions = {}): NimbusDocumentAst {
  return parseNimbusDocument(source, options.fileName ?? 'document.nimbus');
}

export function compileNimbus(source: string, options: CompileNimbusOptions = {}): CompileNimbusResult {
  const fallbackFile = options.fileName ?? 'document.nimbus';
  try {
    const graph = resolveNimbusGraph(source, options);
    const ir = astToIr(graph.ast, graph.sourceHashInput, options, graph.sourceByFile);
    const canonicalJson = canonicalStringify(ir);
    return {
      ast: graph.ast,
      ir,
      canonicalJson,
      hash: sha256(canonicalJson),
      schema: nimbusIrJsonSchema,
    };
  } catch (error) {
    throw new NimbusDiagnosticError(
      toNimbusDiagnostics(error, {
        code: 'NIMBUS_COMPILE_FAILED',
        stage: 'compile',
        file: fallbackFile,
        source,
      }),
    );
  }
}

export function compileNimbusFile(filePath: string, options: CompileNimbusFileOptions = {}): CompileNimbusResult {
  const rootDir = resolve(options.rootDir ?? (isAbsolute(filePath) ? dirname(resolve(filePath)) : process.cwd()));
  const absolutePath = isAbsolute(filePath) ? resolve(filePath) : resolve(rootDir, filePath);
  const readFile = options.readFile ?? ((path: string) => readFileSync(path, 'utf8'));
  const source = readFile(absolutePath);
  return compileNimbus(source, {
    ...options,
    fileName: absolutePath,
    importRoot: rootDir,
    resolveImports: true,
    readImport: readFile,
  });
}

export function checkNimbus(source: string, options: CompileNimbusOptions = {}): NimbusCheckResult {
  try {
    return { ok: true, diagnostics: [], result: compileNimbus(source, options) };
  } catch (error) {
    return {
      ok: false,
      diagnostics: toNimbusDiagnostics(error, {
        code: 'NIMBUS_CHECK_FAILED',
        stage: 'check',
        file: options.fileName ?? 'document.nimbus',
        source,
      }),
    };
  }
}

export function checkNimbusFile(filePath: string, options: CompileNimbusFileOptions = {}): NimbusCheckResult {
  try {
    return { ok: true, diagnostics: [], result: compileNimbusFile(filePath, options) };
  } catch (error) {
    return {
      ok: false,
      diagnostics: toNimbusDiagnostics(error, {
        code: 'NIMBUS_CHECK_FAILED',
        stage: 'check',
        file: filePath,
      }),
    };
  }
}

function resolveNimbusGraph(source: string, options: CompileNimbusOptions): NimbusGraph {
  const entryFileName = options.fileName ?? 'document.nimbus';
  const entryAbsolute = isAbsolute(entryFileName) ? resolve(entryFileName) : resolve(options.importRoot ?? process.cwd(), entryFileName);
  const importRoot = resolve(options.importRoot ?? (isAbsolute(entryFileName) ? dirname(entryAbsolute) : process.cwd()));
  const canResolveImports = options.resolveImports === true || options.readImport !== undefined;
  const readImport = options.readImport ?? ((path: string) => readFileSync(path, 'utf8'));
  const finished = new Set<string>();
  const ordered: ParsedNimbusFile[] = [];

  const visit = (
    fileKey: string,
    displayFile: string,
    fileSource: string,
    stack: Array<{ fileKey: string; displayFile: string }>,
  ): void => {
    const cycleStart = stack.findIndex((item) => item.fileKey === fileKey);
    if (cycleStart !== -1) {
      const cycle = [...stack.slice(cycleStart), { fileKey, displayFile }].map((item) => item.displayFile);
      failWithDiagnostic({
        code: 'NIMBUS_IMPORT_CYCLE',
        stage: 'resolve',
        message: `import cycle detected: ${cycle.join(' -> ')}`,
        file: displayFile,
        source: fileSource,
      });
    }
    if (finished.has(fileKey)) return;

    const ast = parseNimbusDocument(fileSource, displayFile);
    const nextStack = [...stack, { fileKey, displayFile }];
    for (const item of ast.imports) {
      if (!canResolveImports) {
        failWithDiagnostic({
          code: 'NIMBUS_IMPORTS_DISABLED',
          stage: 'resolve',
          message: 'Nimbus imports require local file import resolution',
          file: displayFile,
          source: fileSource,
        });
      }
      const resolvedImport = resolveLocalImport({
        importPath: item.path,
        fromFile: fileKey,
        fromDisplayFile: displayFile,
        importRoot,
        source: fileSource,
      });
      let importedSource: string;
      try {
        importedSource = readImport(resolvedImport.fileKey);
      } catch {
        failWithDiagnostic({
          code: 'NIMBUS_IMPORT_READ_FAILED',
          stage: 'resolve',
          message: `unable to read Nimbus import ${item.path}`,
          file: displayFile,
          source: fileSource,
        });
      }
      visit(resolvedImport.fileKey, resolvedImport.displayFile, importedSource, nextStack);
    }

    finished.add(fileKey);
    ordered.push({ fileKey, displayFile, source: fileSource, ast });
  };

  visit(entryAbsolute, displayPath(entryAbsolute, importRoot), source, []);
  return mergeNimbusFiles(ordered);
}

function resolveLocalImport(input: {
  importPath: string;
  fromFile: string;
  fromDisplayFile: string;
  importRoot: string;
  source: string;
}): { fileKey: string; displayFile: string } {
  if (
    isAbsolute(input.importPath) ||
    /^[A-Za-z][A-Za-z0-9+.-]*:/.test(input.importPath) ||
    !(input.importPath.startsWith('./') || input.importPath.startsWith('../'))
  ) {
    failWithDiagnostic({
      code: 'NIMBUS_IMPORT_LOCAL_ONLY',
      stage: 'resolve',
      message: `Nimbus import ${input.importPath} must be a relative local path`,
      file: input.fromDisplayFile,
      source: input.source,
    });
  }

  const fileKey = resolve(dirname(input.fromFile), input.importPath);
  if (!isPathInside(input.importRoot, fileKey)) {
    failWithDiagnostic({
      code: 'NIMBUS_IMPORT_OUTSIDE_ROOT',
      stage: 'resolve',
      message: `Nimbus import ${input.importPath} resolves outside the import root`,
      file: input.fromDisplayFile,
      source: input.source,
    });
  }

  return { fileKey, displayFile: displayPath(fileKey, input.importRoot) };
}

function isPathInside(root: string, candidate: string): boolean {
  const path = relative(root, candidate);
  return path === '' || (!path.startsWith('..') && !isAbsolute(path));
}

function displayPath(path: string, root: string): string {
  const pathFromRoot = relative(root, path);
  if (!pathFromRoot || pathFromRoot.startsWith('..') || isAbsolute(pathFromRoot)) return path;
  return pathFromRoot.split('\\').join('/');
}

function mergeNimbusFiles(files: ParsedNimbusFile[]): NimbusGraph {
  const root = files[files.length - 1];
  if (!root) {
    failWithDiagnostic({
      code: 'NIMBUS_EMPTY_GRAPH',
      stage: 'resolve',
      message: 'Nimbus graph is empty',
      file: 'document.nimbus',
    });
  }

  const sourceByFile = new Map(files.map((file) => [file.displayFile, file.source]));
  const importedFiles = files.slice(0, -1);
  const rootNamespace = singleNamespace(root);
  const rootNamespaceName = rootNamespace?.name ?? 'default';
  const importedDeclarations = importedFiles.flatMap((file) => {
    if (file.ast.version !== root.ast.version) {
      failWithDiagnostic({
        code: 'NIMBUS_IMPORT_VERSION_MISMATCH',
        stage: 'compile',
        message: `import ${file.displayFile} uses Nimbus ${file.ast.version}, expected ${root.ast.version}`,
        file: file.displayFile,
        source: file.source,
      });
    }
    const namespace = singleNamespace(file);
    if (namespace) {
      if (namespace.name !== rootNamespaceName) {
        failWithDiagnostic({
          code: 'NIMBUS_IMPORT_NAMESPACE_MISMATCH',
          stage: 'compile',
          message: `import ${file.displayFile} declares namespace ${namespace.name}, expected ${rootNamespaceName}`,
          file: namespace.sourceSpan.file,
          source: file.source,
          start: namespace.sourceSpan.start,
          end: namespace.sourceSpan.end,
        });
      }
      return namespace.declarations;
    }
    return file.ast.declarations;
  });

  const ast = rootNamespace
    ? {
        ...root.ast,
        declarations: [
          {
            ...rootNamespace,
            declarations: [...importedDeclarations, ...rootNamespace.declarations],
          },
        ],
      }
    : {
        ...root.ast,
        declarations: [...importedDeclarations, ...root.ast.declarations],
      };

  return {
    ast,
    sourceHashInput: files.map((file) => file.source).join('\n'),
    sourceByFile,
  };
}

function singleNamespace(file: ParsedNimbusFile): NimbusDeclaration | undefined {
  const namespaces = file.ast.declarations.filter((item) => item.type === 'namespace');
  if (namespaces.length > 1) {
    const second = namespaces[1]!;
    failWithDiagnostic({
      code: 'NIMBUS_MULTIPLE_NAMESPACES',
      stage: 'compile',
      message: 'Nimbus documents may declare only one namespace',
      file: second.sourceSpan.file,
      source: file.source,
      start: second.sourceSpan.start,
      end: second.sourceSpan.end,
    });
  }
  return namespaces[0];
}

export function canonicalStringify(value: unknown): string {
  return JSON.stringify(sortCanonical(value));
}

export function formatNimbusSource(source: string, options: Pick<CompileNimbusOptions, 'fileName'> = {}): string {
  const ast = parseNimbus(source, options);
  return `${formatDocument(ast).trim()}\n`;
}

function formatDocument(ast: NimbusDocumentAst): string {
  const lines: string[] = [];
  if (ast.version !== 'v1alpha1') {
    lines.push(`nimbus ${formatString(ast.version)}`, '');
  }
  for (const item of ast.imports) {
    lines.push(`import ${formatString(item.path)}${item.alias ? ` as ${item.alias}` : ''}`);
  }
  if (ast.imports.length) lines.push('');
  ast.declarations.forEach((item, index) => {
    if (index > 0) lines.push('');
    lines.push(...formatDeclaration(item, 0));
  });
  return lines.join('\n');
}

function formatDeclaration(declaration: NimbusDeclaration, depth: number): string[] {
  const indent = '  '.repeat(depth);
  const lines: string[] = [];
  if (declaration.docs) {
    for (const line of declaration.docs.split('\n')) lines.push(`${indent}/// ${line}`);
  }
  lines.push(`${indent}${declaration.type} ${formatName(declaration.name)} {`);
  const fieldEntries = Object.entries(declaration.fields).sort(([left], [right]) => left.localeCompare(right));
  fieldEntries.forEach(([key, value], index) => {
    if (index > 0) lines.push('');
    lines.push(...formatField(key, value, depth + 1));
  });
  declaration.declarations.forEach((child) => {
    if (fieldEntries.length || lines[lines.length - 1] !== `${indent}${declaration.type} ${formatName(declaration.name)} {`) {
      lines.push('');
    }
    lines.push(...formatDeclaration(child, depth + 1));
  });
  lines.push(`${indent}}`);
  return lines;
}

function formatField(key: string, value: NimbusValue, depth: number): string[] {
  const indent = '  '.repeat(depth);
  const formatted = formatValue(value, depth);
  if (formatted.length === 1) return [`${indent}${key}: ${formatted[0]}`];
  return [`${indent}${key}: ${formatted[0]}`, ...formatted.slice(1).map((line) => `${indent}${line}`)];
}

function formatValue(value: NimbusValue, depth: number): string[] {
  if (typeof value === 'string') return [formatString(value)];
  if (typeof value === 'number' || typeof value === 'boolean') return [String(value)];
  if (value === null) return ['null'];
  if (Array.isArray(value)) return formatArray(value, depth);
  if (isEnvRef(value)) return [`env(${formatString(value.name)})`];
  if (isReference(value)) return [value.path.join('.')];
  return formatObject(value, depth);
}

function formatArray(values: NimbusValue[], depth: number): string[] {
  if (!values.length) return ['[]'];
  if (values.every(isInlineValue)) return [`[${values.map((value) => formatValue(value, depth)[0]).join(', ')}]`];
  const indent = '  '.repeat(depth + 1);
  return ['[', ...values.flatMap((value) => formatValue(value, depth + 1).map((line) => `${indent}${line}`)), `${'  '.repeat(depth)}]`];
}

function formatObject(value: Record<string, NimbusValue>, depth: number): string[] {
  const entries = Object.entries(value).sort(([left], [right]) => left.localeCompare(right));
  if (!entries.length) return ['{}'];
  if (entries.length <= 3 && entries.every(([, entry]) => isInlineValue(entry))) {
    return [`{ ${entries.map(([key, entry]) => `${formatObjectKey(key)}: ${formatValue(entry, depth)[0]}`).join(', ')} }`];
  }
  const indent = '  '.repeat(depth + 1);
  const lines = entries.flatMap(([key, entry]) => {
    const formatted = formatValue(entry, depth + 1);
    if (formatted.length === 1) return `${indent}${formatObjectKey(key)}: ${formatted[0]}`;
    return [`${indent}${formatObjectKey(key)}: ${formatted[0]}`, ...formatted.slice(1).map((line) => `${indent}${line}`)];
  });
  return ['{', ...lines, `${'  '.repeat(depth)}}`];
}

function isInlineValue(value: NimbusValue): boolean {
  if (Array.isArray(value)) return value.every(isInlineValue) && value.length <= 4;
  if (value && typeof value === 'object') return isEnvRef(value) || isReference(value);
  return true;
}

function formatName(name: string): string {
  return /^[A-Za-z_][A-Za-z0-9_-]*$/.test(name) ? name : formatString(name);
}

function formatObjectKey(key: string): string {
  return /^[A-Za-z_][A-Za-z0-9_-]*$/.test(key) ? key : formatString(key);
}

function formatString(value: string): string {
  return JSON.stringify(value);
}

function sortCanonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortCanonical);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(([, entry]) => entry !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => [key, sortCanonical(entry)]),
  );
}

function astToIr(
  ast: NimbusDocumentAst,
  source: string,
  options: CompileNimbusOptions,
  sourceByFile: Map<string, string>,
): NimbusIr {
  const namespaces = ast.declarations.filter((item) => item.type === 'namespace');
  const namespace = namespaces[0]?.name ?? 'default';

  const rootDeclarations = namespaces[0] ? namespaces[0].declarations : ast.declarations;
  const rootFields = namespaces[0]?.fields ?? {};
  const docs = namespaces[0]?.docs;
  const metadataName =
    options.name ??
    asString(rootFields.name) ??
    (namespace === 'default' ? 'nimbus-document' : namespace.replaceAll('.', '-'));

  const collections = rootDeclarations
    .filter((item) => item.type === 'collection')
    .map((item) => collectionToIr(item));

  const indexes = rootDeclarations
    .filter((item) => item.type === 'index')
    .map((item) => namedToIr(item));

  const ir: NimbusIr = {
    $schema: NIMBUS_IR_SCHEMA_ID,
    apiVersion: NIMBUS_API_VERSION,
    kind: NIMBUS_KIND,
    metadata: {
      name: metadataName,
      compilerVersion: NIMBUS_COMPILER_VERSION,
      sourceHash: sha256(source),
      ...(docs ? { docs } : {}),
    },
    spec: {
      namespace,
      apps: rootDeclarations.filter((item) => item.type === 'app').map((item) => namedToIr(item)),
      collections,
      indexes,
      policies: rootDeclarations.filter((item) => item.type === 'policy').map((item) => namedToIr(item)),
      secrets: rootDeclarations.filter((item) => item.type === 'secret').map((item) => secretToIr(item)),
      backups: rootDeclarations.filter((item) => item.type === 'backup').map((item) => namedToIr(item)),
      approvals: rootDeclarations.filter((item) => item.type === 'approval').map((item) => namedToIr(item)),
    },
  };

  validateNimbusIr(ir, { fileName: sourceFileForNamespace(namespaces[0]), sourceByFile });
  assertNimbusNamespaceAllowed(ir, options.allowSystemNamespace, {
    fileName: sourceFileForNamespace(namespaces[0]),
    source: namespaces[0] ? sourceByFile.get(namespaces[0].sourceSpan.file) : undefined,
  });
  return ir;
}

function sourceFileForNamespace(namespace: NimbusDeclaration | undefined): string {
  return namespace?.sourceSpan.file ?? '<ir>';
}

function collectionToIr(declaration: NimbusDeclaration): NimbusCollectionIr {
  const childIndexes = declaration.declarations.filter((item) => item.type === 'index').map((item) => namedToIr(item));
  const fields = unknownRecord(declaration.fields.fields ?? {});
  if (!Object.keys(fields).length) {
    failWithDiagnostic({
      code: 'NIMBUS_COLLECTION_FIELDS_REQUIRED',
      stage: 'compile',
      message: `collection ${declaration.name} must define fields`,
      file: declaration.sourceSpan.file,
      start: declaration.sourceSpan.start,
      end: declaration.sourceSpan.end,
    });
  }
  const attributes = attributesWithout(declaration.fields, ['fields']);
  return {
    name: declaration.name,
    ...(declaration.docs ? { docs: declaration.docs } : {}),
    fields,
    ...(childIndexes.length ? { indexes: childIndexes } : {}),
    ...(Object.keys(attributes).length ? { attributes } : {}),
  };
}

function secretToIr(declaration: NimbusDeclaration): NimbusSecretIr {
  const from = declaration.fields.from ?? declaration.fields.source;
  if (!isEnvRef(from)) {
    failWithDiagnostic({
      code: 'NIMBUS_SECRET_ENV_REF_REQUIRED',
      stage: 'compile',
      message: `secret ${declaration.name} must use from: env("NAME")`,
      file: declaration.sourceSpan.file,
      start: declaration.sourceSpan.start,
      end: declaration.sourceSpan.end,
    });
  }
  const attributes = attributesWithout(declaration.fields, ['from', 'source']);
  return {
    name: declaration.name,
    ...(declaration.docs ? { docs: declaration.docs } : {}),
    source: from,
    ...(Object.keys(attributes).length ? { attributes } : {}),
  };
}

function namedToIr(declaration: NimbusDeclaration): NimbusNamedIr {
  const attributes = Object.fromEntries(
    Object.entries(declaration.fields).map(([key, value]) => [key, normalizeValue(value)]),
  );
  return {
    name: declaration.name,
    ...(declaration.docs ? { docs: declaration.docs } : {}),
    ...(Object.keys(attributes).length ? { attributes } : {}),
  };
}

function attributesWithout(fields: Record<string, NimbusValue>, skipped: string[]): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(fields)
      .filter(([key]) => !skipped.includes(key))
      .map(([key, value]) => [key, normalizeValue(value)]),
  );
}

function normalizeValue(value: NimbusValue): unknown {
  if (Array.isArray(value)) return value.map(normalizeValue);
  if (isEnvRef(value)) return value;
  if (isReference(value)) return { kind: 'reference', path: value.path.join('.') };
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, normalizeValue(entry as NimbusValue)]));
  }
  return value;
}

function unknownRecord(value: NimbusValue): Record<string, unknown> {
  const normalized = normalizeValue(value);
  if (!normalized || typeof normalized !== 'object' || Array.isArray(normalized)) {
    throw new Error('expected object value');
  }
  return normalized as Record<string, unknown>;
}

function asString(value: NimbusValue | undefined): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function isEnvRef(value: unknown): value is { kind: 'envRef'; name: string } {
  return Boolean(value && typeof value === 'object' && (value as { kind?: unknown }).kind === 'envRef');
}

function isReference(value: unknown): value is { kind: 'reference'; path: string[] } {
  return Boolean(value && typeof value === 'object' && (value as { kind?: unknown }).kind === 'reference');
}

export function validateNimbusIr(
  ir: NimbusIr,
  context: { fileName?: string; sourceByFile?: Map<string, string> } = {},
): void {
  const file = context.fileName ?? '<ir>';
  const fail = (message: string): never =>
    failWithDiagnostic({
      code: 'NIMBUS_IR_INVALID',
      stage: 'check',
      message,
      file,
      source: context.sourceByFile?.get(file),
    });
  if (ir.$schema !== NIMBUS_IR_SCHEMA_ID) fail('invalid Nimbus IR schema id');
  if (ir.apiVersion !== NIMBUS_API_VERSION) fail('invalid Nimbus IR apiVersion');
  if (ir.kind !== NIMBUS_KIND) fail('invalid Nimbus IR kind');
  if (!ir.metadata || !ir.metadata.name || !ir.metadata.compilerVersion || !ir.metadata.sourceHash) {
    fail('Nimbus IR metadata is incomplete');
  }
  if (!ir.spec || typeof ir.spec !== 'object') fail('Nimbus IR spec is required');
  if (!ir.spec.namespace) fail('Nimbus IR namespace is required');
  for (const key of ['apps', 'collections', 'indexes', 'policies', 'secrets', 'backups', 'approvals'] as const) {
    if (!Array.isArray(ir.spec[key])) fail(`Nimbus IR spec.${key} must be an array`);
  }
  for (const collection of ir.spec.collections) {
    if (!collection.name) fail('collection name is required');
    if (!collection.fields || !Object.keys(collection.fields).length) {
      fail(`collection ${collection.name} must define fields`);
    }
  }
  for (const secret of ir.spec.secrets) {
    if (!secret.source || secret.source.kind !== 'envRef' || !secret.source.name) {
      fail(`secret ${secret.name} must compile to an envRef source`);
    }
  }
}
