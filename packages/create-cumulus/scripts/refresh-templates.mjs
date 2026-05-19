#!/usr/bin/env node
import { cpSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const packageDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const repoRoot = resolve(packageDir, '..', '..');
const webRoot = join(repoRoot, 'apps', 'web');
const cumulusDbRoot = join(repoRoot, 'apps', 'cumulus-db');
const templatesDir = join(packageDir, 'templates');

const skippedDirs = new Set([
  '.cumulus-db-data',
  '.git',
  '.next',
  '.pytest_cache',
  '.turbo',
  'coverage',
  'dist',
  'node_modules',
  'target',
]);

const skippedFiles = new Set([
  '.env',
  '.env.local',
  'tsconfig.tsbuildinfo',
]);

function projectPath(path) {
  return path.split(sep).join('/');
}

function listFiles(baseDir) {
  const files = [];

  function walk(current) {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        if (!skippedDirs.has(entry.name)) {
          walk(join(current, entry.name));
        }
        continue;
      }

      if (!entry.isFile() || skippedFiles.has(entry.name)) continue;
      files.push(projectPath(relative(baseDir, join(current, entry.name))));
    }
  }

  walk(baseDir);
  return files.sort();
}

function isTestFile(path) {
  return /\.(test|spec)\.tsx?$/.test(path);
}

function copyGroupFrom(baseDir, group, files, targetPrefix = '') {
  const targetRoot = join(templatesDir, group, targetPrefix);
  for (const file of files) {
    const from = join(baseDir, file);
    const to = join(targetRoot, file);
    mkdirSync(dirname(to), { recursive: true });
    cpSync(from, to);
  }
}

function exact(files, ...wantedFiles) {
  const wanted = new Set(wantedFiles);
  return files.filter((file) => wanted.has(file));
}

function prefix(files, ...prefixes) {
  return files.filter((file) => prefixes.some((p) => file.startsWith(p)));
}

function without(files, predicate) {
  return files.filter((file) => !predicate(file));
}

const webFiles = listFiles(webRoot);
const cumulusDbFiles = listFiles(cumulusDbRoot);

mkdirSync(templatesDir, { recursive: true });
for (const group of ['common', 'public', 'inside', 'server', 'cumulus-db', 'licenses']) {
  rmSync(join(templatesDir, group), { recursive: true, force: true });
}

copyGroupFrom(webRoot, 'common', [
  ...prefix(webFiles, 'app/components/', 'public/fonts/'),
  ...exact(
    webFiles,
    'app/fonts.ts',
    'app/globals.css',
    'app/layout.tsx',
    'app/router.ts',
    'app/theme.ts',
    'postcss.config.mjs',
    'public/.gitkeep',
    'public/favicon.ico',
  ),
]);

copyGroupFrom(webRoot, 'public', [
  ...without(prefix(webFiles, 'app/docs/'), (file) => file === 'app/docs/api/route.ts'),
  ...prefix(webFiles, 'app/legal/', 'app/partner/', 'app/pricing/'),
  ...exact(
    webFiles,
    'app/opengraph-image.tsx',
    'app/page.tsx',
    'app/robots.ts',
    'app/security/page.tsx',
    'app/sitemap.ts',
    'app/trust/page.tsx',
    'app/twitter-image.tsx',
  ),
]);

copyGroupFrom(webRoot, 'inside', [
  ...prefix(
    webFiles,
    'app/(dev)/',
    'app/(share)/',
    'app/(user)/',
    'app/cli-auth/',
    'app/dashboard/',
  ),
  ...exact(
    webFiles,
    'app/WorkspaceSwitcher.tsx',
    'app/login/page.tsx',
    'app/router.ts',
    'app/workspace-actions.ts',
  ),
]);

copyGroupFrom(webRoot, 'server', [
  ...without(prefix(webFiles, 'src/'), isTestFile),
  ...prefix(webFiles, 'migrations/', 'workflows/'),
  ...exact(
    webFiles,
    'app/.well-known/jwks.json/route.ts',
    'app/.well-known/relay.json/route.ts',
    'app/AGENTS.md/route.ts',
    'app/CLAUDE.md/route.ts',
    'app/docs/api/route.ts',
    'app/health/route.ts',
    'app/llms-full.txt/route.ts',
    'app/llms.txt/route.ts',
    'app/mcp/route.ts',
    'app/openapi.json/route.ts',
    'app/v1/[[...path]]/route.ts',
    'drizzle.config.ts',
    'instrumentation.ts',
    'scripts/apply-migration.ts',
    'scripts/apply-pending-migrations.ts',
    'scripts/check-schema.ts',
    'scripts/create-demo-accounts.ts',
    'scripts/register-cumulus-database-provider.ts',
    'scripts/register-cumulus-tenant.ts',
    'scripts/rotate-master-key.ts',
    'vercel.ts',
  ),
]);

copyGroupFrom(cumulusDbRoot, 'cumulus-db', cumulusDbFiles, 'apps/cumulus-db');

mkdirSync(join(templatesDir, 'licenses'), { recursive: true });
cpSync(join(webRoot, 'LICENSE'), join(templatesDir, 'licenses', 'AGPL-3.0-only.txt'));

console.log('create-cumulus templates refreshed from apps/web and apps/cumulus-db.');
