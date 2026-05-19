#!/usr/bin/env node
import { installRuntimes, parseRuntimeSelection } from "./runtime-installer.js";

const selection = parseRuntimeSelection(process.env.CUMULUS_KNOWLEDGE_INSTALL_RUNTIMES);
if (!selection.rust && !selection.python) process.exit(0);

const results = installRuntimes({
  ...selection,
  dryRun: process.env.CUMULUS_KNOWLEDGE_INSTALL_DRY_RUN === "1",
  force: process.env.CUMULUS_KNOWLEDGE_INSTALL_FORCE === "1",
  quiet: process.env.CUMULUS_KNOWLEDGE_INSTALL_QUIET === "1",
});

const failed = results.filter((result) => !result.ok && !result.skipped);
const skipped = results.filter((result) => result.skipped);
for (const result of skipped) {
  process.stderr.write(`[cumulus-knowledge] skipped ${result.runtime}: ${result.reason}\n`);
}
for (const result of failed) {
  process.stderr.write(`[cumulus-knowledge] failed ${result.runtime}: ${result.reason}\n`);
}

if (failed.length > 0 && process.env.CUMULUS_KNOWLEDGE_INSTALL_STRICT === "1") {
  process.exit(1);
}
