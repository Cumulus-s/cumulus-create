#!/usr/bin/env node
import { realpathSync } from "node:fs";
import { join, resolve } from "node:path";
import { env, exit, stdin, stdout, stderr } from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  appendEvent,
  defaultProjectLedgerPath,
  readEvents,
} from "@cumulus_cloud/events";
import { scanProject } from "./scanner.js";
import {
  emptyScanSnapshot,
  homeDirFromEnv,
  loadLatestScanSnapshot,
  loadScanHistory,
  loadProjectRegistry,
  resolveStorage,
  saveScanSnapshot,
  setGlobalStateDir,
  setProjectStateDir,
  type StorageOptions,
} from "./storage.js";
import { historyPath, renderFrame, runTui, type TuiState } from "./tui.js";
import type { StorageResolution } from "./types.js";

interface CliIo {
  cwd: string;
  env: NodeJS.ProcessEnv;
  stdout: Pick<NodeJS.WriteStream, "write">;
  stderr: Pick<NodeJS.WriteStream, "write">;
  stdin: NodeJS.ReadStream;
}

interface ParsedArgs {
  positionals: string[];
  flags: Record<string, string | boolean>;
}

const booleanFlags = new Set(["h", "help", "json", "no-save", "smoke"]);

const defaultIo: CliIo = {
  cwd: process.cwd(),
  env,
  stdout,
  stderr,
  stdin,
};

export async function runCli(argv = process.argv.slice(2), io: CliIo = defaultIo): Promise<number> {
  const args = parseArgs(argv);
  const command = args.positionals[0] ?? "";
  const storageOptions: StorageOptions = { homeDir: homeDirFromEnv(io.env, io.cwd) };

  try {
    if (command === "help" || args.flags.help || args.flags.h) {
      io.stdout.write(helpText());
      return 0;
    }
    if (command === "scan") {
      return await commandScan(args, io, storageOptions);
    }
    if (command === "config") {
      return await commandConfig(args, io, storageOptions);
    }
    if (command && command.startsWith("-") && !args.flags.smoke) {
      io.stderr.write(`Unknown flag: ${command}\n`);
      return 1;
    }
    return await commandTui(args, io, storageOptions);
  } catch (error) {
    io.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    return 1;
  }
}

async function commandScan(args: ParsedArgs, io: CliIo, storageOptions: StorageOptions): Promise<number> {
  const target = resolveTarget(args.positionals[1], io.cwd, storageOptions.homeDir);
  let storage = await resolveStorage(target, storageOptions);
  const snapshot = await scanProject(target, {
    env: io.env,
    ignorePaths: storageIgnorePaths(storage),
    progress: io.stderr,
  });
  if (!args.flags["no-save"]) {
    storage = await saveScanSnapshot(snapshot, storageOptions);
    await recordScanEvent(storage, snapshot, io);
  }
  if (args.flags.json) {
    io.stdout.write(`${JSON.stringify({ ok: true, snapshot, storage }, null, 2)}\n`);
    return 0;
  }
  io.stdout.write(humanScanSummary(snapshot, storage.projectStateDir));
  return 0;
}

async function commandConfig(args: ParsedArgs, io: CliIo, storageOptions: StorageOptions): Promise<number> {
  const sub = args.positionals[1];
  if (sub === "set") {
    const key = args.positionals[2];
    const value = args.positionals[3];
    if (!key || !value) {
      io.stderr.write("Usage: altocumulus config set global-state <path> | altocumulus config set project-state <path> [project]\n");
      return 1;
    }
    if (key === "global-state") {
      const config = await setGlobalStateDir(resolveTarget(value, io.cwd, storageOptions.homeDir), storageOptions);
      io.stdout.write(`Global state set to ${config.globalStateDir}\n`);
      return 0;
    }
    if (key === "project-state") {
      const projectRoot = resolveTarget(args.positionals[4], io.cwd, storageOptions.homeDir);
      const project = await setProjectStateDir(
        projectRoot,
        resolveTarget(value, io.cwd, storageOptions.homeDir),
        storageOptions,
      );
      io.stdout.write(`Project state for ${project.root} set to ${project.stateDir}\n`);
      return 0;
    }
    io.stderr.write(`Unknown config key: ${key}\n`);
    return 1;
  }

  const target = resolveTarget(args.positionals[1], io.cwd, storageOptions.homeDir);
  const storage = await resolveStorage(target, storageOptions);
  const registry = await loadProjectRegistry(storage.globalStateDir);
  const data = { storage, registry };
  if (args.flags.json) {
    io.stdout.write(`${JSON.stringify(data, null, 2)}\n`);
    return 0;
  }
  io.stdout.write(
    [
      "altocumulus storage",
      `  global state:  ${storage.globalStateDir}`,
      `  project state: ${storage.projectStateDir}`,
      `  project root:  ${storage.projectRoot}`,
      `  projects:      ${registry.projects.length}`,
      "",
    ].join("\n"),
  );
  return 0;
}

async function commandTui(args: ParsedArgs, io: CliIo, storageOptions: StorageOptions): Promise<number> {
  const target = resolveTarget(args.positionals[0], io.cwd, storageOptions.homeDir);
  const storage = await resolveStorage(target, storageOptions);
  const snapshot = (await loadLatestScanSnapshot(storage)) ?? emptyScanSnapshot(target);
  const registry = await loadProjectRegistry(storage.globalStateDir);
  const history = await loadScanHistory(historyPath(storage));
  const ledger = await readEvents(defaultProjectLedgerPath(storage.projectStateDir));
  const state: TuiState = { snapshot, storage, registry, history, ledger };
  if (args.flags.smoke) {
    io.stdout.write(`${renderFrame(state, 0, 100, 32)}\n`);
    return 0;
  }
  await runTui(state, { stdin: io.stdin as never, stdout: io.stdout as never });
  return 0;
}

function humanScanSummary(snapshot: Awaited<ReturnType<typeof scanProject>>, projectStateDir: string): string {
  return [
    `Scanned ${snapshot.project.name ?? snapshot.project.root}`,
    `  root:        ${snapshot.project.root}`,
    `  state:       ${projectStateDir}`,
    `  packages:    ${snapshot.summary.packageCount}`,
    `  imports:     ${snapshot.summary.importCount}`,
    `  scripts:     ${snapshot.summary.scriptCount}`,
    `  env names:   ${snapshot.summary.envVarCount}`,
    `  api refs:    ${snapshot.summary.apiReferenceCount}`,
    `  files:       ${snapshot.summary.scannedFileCount} scanned, ${snapshot.summary.skippedFileCount} skipped`,
    "",
  ].join("\n");
}

async function recordScanEvent(
  storage: StorageResolution,
  snapshot: Awaited<ReturnType<typeof scanProject>>,
  io: CliIo,
) {
  try {
    await appendEvent(defaultProjectLedgerPath(storage.projectStateDir), {
      sourcePackage: "@cumulus_cloud/altocumulus",
      surface: "scanner",
      subsystem: "scanner",
      operation: "scan",
      status: "ok",
      localProjectRoot: snapshot.project.root,
      privacy: { class: "creator_safe_metadata", redacted: false },
      metadata: {
        packages: snapshot.summary.packageCount,
        imports: snapshot.summary.importCount,
        scripts: snapshot.summary.scriptCount,
        env_var_names: snapshot.summary.envVarCount,
        api_refs: snapshot.summary.apiReferenceCount,
        scanned_files: snapshot.summary.scannedFileCount,
        skipped_files: snapshot.summary.skippedFileCount,
      },
    });
  } catch (error) {
    io.stderr.write(`altocumulus ledger: skipped scan event (${error instanceof Error ? error.message : String(error)})\n`);
  }
}

function parseArgs(values: string[]): ParsedArgs {
  const flags: Record<string, string | boolean> = {};
  const positionals: string[] = [];
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    if (value.startsWith("--")) {
      const eq = value.indexOf("=");
      if (eq > 2) {
        const key = value.slice(2, eq);
        const rawFlagValue = value.slice(eq + 1);
        flags[key] = booleanFlags.has(key) ? rawFlagValue !== "false" : rawFlagValue;
        continue;
      }
      const key = value.slice(2);
      if (booleanFlags.has(key)) {
        flags[key] = true;
        continue;
      }
      const next = values[index + 1];
      if (next && !next.startsWith("-")) {
        flags[key] = next;
        index += 1;
      } else {
        flags[key] = true;
      }
      continue;
    }
    if (value.startsWith("-") && value.length > 1) {
      for (const key of value.slice(1)) flags[key] = true;
      continue;
    }
    positionals.push(value);
  }
  return { positionals, flags };
}

function resolveTarget(raw: string | undefined, cwd: string, homeDir = homeDirFromEnv(env)): string {
  if (!raw || raw === ".") return resolve(cwd);
  if (raw === "~") {
    return resolve(homeDir);
  }
  if (raw.startsWith("~/")) {
    return resolve(join(homeDir, raw.slice(2)));
  }
  return resolve(cwd, raw);
}

function storageIgnorePaths(storage: StorageResolution): string[] {
  return [storage.globalStateDir, storage.projectStateDir];
}

function helpText(): string {
  return `altocumulus - local Cumulus control TUI

Usage:
  altocumulus [path]                         Open the cached local dashboard
  altocumulus --smoke [path]                 Render one non-interactive TUI frame
  altocumulus scan [path] [--json]           Scan local Cumulus usage
  altocumulus config [path] [--json]         Show storage paths
  altocumulus config set global-state <path>
  altocumulus config set project-state <path> [project]

V3 opens from cache and never scans on startup. Use scan when you want a fresh snapshot.
`;
}

function isDirectRun(): boolean {
  if (!process.argv[1]) return false;
  try {
    return realpathSync(fileURLToPath(import.meta.url)) === realpathSync(process.argv[1]);
  } catch {
    return import.meta.url === pathToFileURL(process.argv[1]).href;
  }
}

if (isDirectRun()) {
  runCli()
    .then((code) => {
      if (code !== 0) exit(code);
    })
    .catch((error) => {
      stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
      exit(1);
    });
}
