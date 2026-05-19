#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";

const root = process.cwd();
const releaseRoot = resolve(
  process.env.CMLS_RELEASE_REPOS_DIR ||
    (process.env.HOME === "/Users/miguel"
      ? "/Users/miguel/Documents/cumulus-release-repos"
      : ".split-repos"),
);
const push = process.env.CMLS_MIRROR_PUSH === "1";

const mirrors = [
  {
    name: "auth",
    repo: "Cumulus-s/auth",
    source: "packages/auth-sdk",
    packageName: "@cmls/auth",
    description: "Agent Auth webhook and action SDK for Cumulus apps.",
    license: "Apache-2.0",
    install: "npm install @cmls/auth",
    ci: ["npm run build", "npm run test"],
  },
  {
    name: "sdk",
    repo: "Cumulus-s/sdk",
    source: "packages/sdk",
    packageName: "@cmls/sdk",
    description: "Combined Auth, DB, and system SDK for Cumulus apps.",
    license: "Apache-2.0",
    install: "npm install @cmls/sdk",
    ci: ["npm run build", "npm run test"],
  },
  {
    name: "cumulus-db",
    repo: "Cumulus-s/cumulus-db",
    source: "apps/cumulus-db",
    packageName: "@cmls/cumulus-db",
    description: "Agent-owned database service with HTTP APIs and Nimbus contracts.",
    license: "AGPL-3.0-only",
    install: "npm install @cmls/cumulus-db",
    ci: ["npm run build", "npm run test"],
  },
  {
    name: "nimbus",
    repo: "Cumulus-s/nimbus",
    packageName: "@cmls/nimbus",
    description: "Desired-state manifest contracts and compiler tooling for Cumulus DB.",
    license: "AGPL-3.0-only",
    install: "npm install @cmls/nimbus && cargo install cmls-nimbus",
    ci: ["npm run build", "npm run test", "cargo test -p cmls-nimbus"],
    nimbus: true,
  },
];

mkdirSync(releaseRoot, { recursive: true });

for (const mirror of mirrors) {
  const dest = join(releaseRoot, mirror.name);
  if (push) ensureGitHubRepo(mirror);
  ensureWorkingCopy(mirror, dest);
  clearWorkingTree(dest);
  if (mirror.nimbus) syncNimbus(mirror, dest);
  else syncSinglePackage(mirror, dest);
  writeMirrorReadme(mirror, dest);
  writeCi(mirror, dest);
  if (push) commitAndPush(mirror, dest);
  console.log(`${mirror.repo} synced at ${dest}`);
}

function run(command, args, options = {}) {
  return execFileSync(command, args, {
    cwd: options.cwd || root,
    encoding: "utf8",
    stdio: options.stdio || "pipe",
  });
}

function ensureGitHubRepo(mirror) {
  try {
    run("gh", ["repo", "view", mirror.repo]);
    return;
  } catch {
    run("gh", [
      "repo",
      "create",
      mirror.repo,
      "--public",
      "--description",
      `${mirror.description} Source of truth: Cumulus-s/cumulus-create.`,
    ], { stdio: "inherit" });
  }
}

function ensureWorkingCopy(mirror, dest) {
  if (existsSync(join(dest, ".git"))) return;
  rmSync(dest, { recursive: true, force: true });
  if (push) {
    run("gh", ["repo", "clone", mirror.repo, dest], { stdio: "inherit" });
  } else {
    mkdirSync(dest, { recursive: true });
  }
}

function clearWorkingTree(dest) {
  mkdirSync(dest, { recursive: true });
  for (const entry of readdirSync(dest, { withFileTypes: true })) {
    if (entry.name === ".git") continue;
    rmSync(join(dest, entry.name), { recursive: true, force: true });
  }
}

function syncSinglePackage(mirror, dest) {
  cpSync(join(root, mirror.source), dest, {
    recursive: true,
    filter: (source) => !source.includes("/node_modules/") && !source.includes("/dist/"),
  });
  rewritePackageMetadata(join(dest, "package.json"), mirror);
}

function syncNimbus(mirror, dest) {
  cpSync(join(root, "packages/nimbus"), join(dest, "packages/nimbus"), {
    recursive: true,
    filter: (source) => !source.includes("/node_modules/") && !source.includes("/dist/"),
  });
  cpSync(join(root, "crates/nimbus"), join(dest, "crates/nimbus"), {
    recursive: true,
    filter: (source) => !source.includes("/target/"),
  });
  rewritePackageMetadata(join(dest, "packages/nimbus/package.json"), {
    ...mirror,
    repo: "Cumulus-s/nimbus",
    directory: "packages/nimbus",
  });
  writeFileSync(
    join(dest, "package.json"),
    `${JSON.stringify(
      {
        name: "cmls-nimbus-repo",
        private: true,
        type: "module",
        workspaces: ["packages/nimbus"],
        scripts: {
          build: "npm --workspace @cmls/nimbus run build",
          test: "npm --workspace @cmls/nimbus run test && cargo test -p cmls-nimbus",
          pack: "npm pack --workspace @cmls/nimbus --dry-run && cargo package -p cmls-nimbus",
        },
        devDependencies: {
          "@types/node": "^25.6.0",
          typescript: "^5.9.3",
          vitest: "^4.1.4",
        },
      },
      null,
      2,
    )}\n`,
  );
  writeFileSync(
    join(dest, "Cargo.toml"),
    `[workspace]
resolver = "2"
members = ["crates/nimbus"]

[workspace.package]
edition = "2021"
license = "AGPL-3.0-only"
version = "0.1.0"
authors = ["Cumulus Create contributors"]
repository = "https://github.com/Cumulus-s/nimbus"
homepage = "https://cumulush.com"

[workspace.dependencies]
anyhow = "1"
clap = { version = "4", features = ["derive"] }
serde = { version = "1", features = ["derive"] }
serde_json = "1"
sha2 = "0.10"
tempfile = "3"
thiserror = "2"
`,
  );
}

function rewritePackageMetadata(packagePath, mirror) {
  const pkg = JSON.parse(readFileSync(packagePath, "utf8"));
  pkg.repository = {
    type: "git",
    url: `git+https://github.com/${mirror.repo}.git`,
  };
  if (mirror.directory) pkg.repository.directory = mirror.directory;
  pkg.bugs = { url: `https://github.com/${mirror.repo}/issues` };
  writeFileSync(packagePath, `${JSON.stringify(pkg, null, 2)}\n`);
}

function writeMirrorReadme(mirror, dest) {
  const existingPath = mirror.nimbus ? join(dest, "packages/nimbus/README.md") : join(dest, "README.md");
  const existing = existsSync(existingPath)
    ? readFileSync(existingPath, "utf8")
    : existsSync(join(dest, "README.md"))
    ? readFileSync(join(dest, "README.md"), "utf8")
    : "";
  const header = `# ${mirror.packageName}

${mirror.description}

This repository is a public mirror. New development happens in the Cumulus
Create monorepo.

Source of truth: https://github.com/Cumulus-s/cumulus-create
Package: https://www.npmjs.com/package/${encodeURIComponent(mirror.packageName)}
License: ${mirror.license}

\`\`\`bash
${mirror.install}
\`\`\`

`;
  writeFileSync(join(dest, "README.md"), `${header}${stripMirrorReadme(existing)}`);
}

function stripFirstHeading(text) {
  return text.replace(/^# .*(?:\r?\n)+/, "");
}

function stripMirrorReadme(text) {
  return stripFirstHeading(text)
    .replace(/\n?Source of truth: .*(?:\r?\n)/g, "\n")
    .replace(/\n?Public mirror: .*(?:\r?\n)/g, "\n")
    .replace(/\n?Package: `?@cmls\/[^`\r\n]+`?(?:\r?\n)/g, "\n")
    .replace(/\n```bash\r?\nnpm install @cmls\/[^\r\n]+\r?\n```\r?\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trimStart();
}

function writeCi(mirror, dest) {
  const dir = join(dest, ".github/workflows");
  mkdirSync(dir, { recursive: true });
  const steps = mirror.ci
    .map((cmd) => `      - run: ${cmd}\n        if: steps.cmls-deps.outputs.ready == 'true'`)
    .join("\n");
  writeFileSync(
    join(dir, "ci.yml"),
    `name: CI

on:
  pull_request:
  push:
    branches: [main]
  workflow_dispatch:

permissions:
  contents: read

jobs:
  verify:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
      ${mirror.nimbus ? "- uses: dtolnay/rust-toolchain@stable\n      " : ""}- id: cmls-deps
        name: Check published CMLS dependencies
        run: |
          set -euo pipefail
          deps=$(node - <<'NODE'
          const { existsSync, readFileSync } = require('node:fs');
          const paths = [process.cwd() + '/package.json', process.cwd() + '/packages/nimbus/package.json'];
          const names = new Set();
          for (const path of paths) {
            if (!existsSync(path)) continue;
            const pkg = JSON.parse(readFileSync(path, 'utf8'));
            for (const group of ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies']) {
              for (const name of Object.keys(pkg[group] || {})) {
                if (name.startsWith('@cmls/')) names.add(name);
              }
            }
          }
          console.log([...names].join('\\n'));
          NODE
          )
          missing=0
          while IFS= read -r dep; do
            [ -z "$dep" ] && continue
            if ! npm view "$dep" version >/dev/null 2>&1; then
              echo "Waiting for $dep to be published before running mirror CI."
              missing=1
            fi
          done <<< "$deps"
          if [ "$missing" -eq 1 ]; then
            echo "ready=false" >> "$GITHUB_OUTPUT"
          else
            echo "ready=true" >> "$GITHUB_OUTPUT"
          fi
      - run: npm install
        if: steps.cmls-deps.outputs.ready == 'true'
      - run: echo "CMLS dependencies are not published yet; mirror build/test will run after publication."
        if: steps.cmls-deps.outputs.ready != 'true'
${steps}
`,
  );
}

function commitAndPush(mirror, dest) {
  run("git", ["add", "."], { cwd: dest, stdio: "inherit" });
  const status = run("git", ["status", "--short"], { cwd: dest });
  if (!status.trim()) return;
  run("git", ["commit", "-m", `chore: sync ${mirror.packageName} public mirror`], {
    cwd: dest,
    stdio: "inherit",
  });
  run("git", ["push", "origin", "HEAD:main"], { cwd: dest, stdio: "inherit" });
}
