#!/usr/bin/env node
import { installRuntimes, type RuntimeInstallOptions } from "./runtime-installer.js";

const options = parseArgs(process.argv.slice(2));
const results = installRuntimes(options);
const failed = results.filter((result) => !result.ok && !result.skipped);
for (const result of results) {
  if (result.skipped) process.stderr.write(`[cmls-knowledge] skipped ${result.runtime}: ${result.reason}\n`);
}
if (failed.length > 0) {
  for (const result of failed) process.stderr.write(`[cmls-knowledge] failed ${result.runtime}: ${result.reason}\n`);
  process.exit(1);
}

function parseArgs(args: string[]): RuntimeInstallOptions {
  const options: RuntimeInstallOptions = {};
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === "--all") {
      options.rust = true;
      options.python = true;
    } else if (arg === "--rust") {
      options.rust = true;
      options.python = false;
    } else if (arg === "--python") {
      options.rust = false;
      options.python = true;
    } else if (arg === "--dry-run") {
      options.dryRun = true;
    } else if (arg === "--force") {
      options.force = true;
    } else if (arg === "--quiet") {
      options.quiet = true;
    } else if (arg === "--no-python-user") {
      options.pythonUser = false;
    } else if (arg === "--rust-path") {
      options.rustPath = args[++i];
    } else if (arg === "--python-path") {
      options.pythonPath = args[++i];
    } else if (arg === "--help" || arg === "-h") {
      printHelp();
      process.exit(0);
    } else {
      throw new Error(`Unknown option: ${arg}`);
    }
  }
  return options;
}

function printHelp(): void {
  process.stdout.write(`Usage: cmls-knowledge-setup [--all|--rust|--python] [options]

Options:
  --all             Install Rust CLI and Python package. This is the default.
  --rust            Install only the Rust CLI package.
  --python          Install only the Python package.
  --dry-run         Print install commands without running them.
  --force           Pass --force to cargo install.
  --rust-path PATH  Install Rust CLI from a local path instead of crates.io.
  --python-path PATH Install Python package from a local path instead of PyPI.
  --no-python-user  Do not pass --user to pip outside virtual environments.
  --quiet           Reduce installer output.
`);
}
