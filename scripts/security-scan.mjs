import { readdir, readFile, stat } from "node:fs/promises";
import { join, relative } from "node:path";

const root = process.cwd();
const skippedDirs = new Set([
  ".git",
  ".next",
  ".pytest_cache",
  "dist",
  "node_modules",
  "target",
]);
const skippedFiles = new Set(["tsconfig.tsbuildinfo"]);

const bannedProviderNames = [
  ["supa", "base"].join(""),
  ["str", "ipe"].join(""),
  ["shop", "ify"].join(""),
];

const secretPatterns = [
  new RegExp(["sk", "live"].join("_")),
  new RegExp(["ghp", "[A-Za-z0-9_]{20,}"].join("_")),
  new RegExp(["github", "pat", "[A-Za-z0-9_]{20,}"].join("_")),
  new RegExp(`-{5}${["BEGIN", "PRIVATE", "KEY"].join(" ")}-{5}`),
];

const failures = [];

async function walk(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (entry.isDirectory() && skippedDirs.has(entry.name)) {
      continue;
    }

    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      await walk(fullPath);
      continue;
    }

    if (!entry.isFile()) {
      continue;
    }
    if (skippedFiles.has(entry.name)) {
      continue;
    }

    const info = await stat(fullPath);
    if (info.size > 5_000_000) {
      continue;
    }

    const rel = relative(root, fullPath);
    const text = await readFile(fullPath, "utf8").catch(() => null);
    if (text === null) {
      continue;
    }

    const lowerText = text.toLowerCase();
    for (const provider of bannedProviderNames) {
      if (lowerText.includes(provider)) {
        failures.push(`${rel}: contains banned provider name "${provider}"`);
      }
    }

    for (const pattern of secretPatterns) {
      if (pattern.test(text)) {
        failures.push(`${rel}: contains a high-risk secret pattern`);
      }
    }
  }
}

await walk(root);

if (failures.length > 0) {
  console.error("Security scan failed:");
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  process.exit(1);
}

console.log("Security scan passed.");
