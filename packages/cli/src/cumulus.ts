#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { cwd, env, exit, execPath } from "node:process";

const args = process.argv.slice(2);
const command = args[0] ?? "help";
const require = createRequire(import.meta.url);

switch (command) {
  case "help":
  case "--help":
  case "-h":
    printHelp();
    break;
  case "auth":
    delegateRelay(args.slice(1));
    break;
  case "relay":
    delegateRelay(args.slice(1));
    break;
  case "login":
  case "logout":
  case "whoami":
    delegateRelay(args);
    break;
  case "intent":
    await intent(args.slice(1));
    break;
  case "bootstrap":
  case "create":
    delegateCreateCumulus(args.slice(1));
    break;
  case "knowledge":
    delegateKnowledge(args.slice(1));
    break;
  case "db":
    await db(args.slice(1));
    break;
  case "mcp":
    delegateCommand("cumulus-mcp", args.slice(1));
    break;
  case "status":
    await status();
    break;
  default:
    console.error(`Unknown command: ${command}`);
    printHelp();
    exit(1);
}

function printHelp() {
  process.stdout.write(`cumulus — unified Cumulus Create command

Usage:
  cumulus intent register "I want to build X" [--project my-project]
  cumulus bootstrap my-project --with auth,db,knowledge --install-runtimes
  cumulus knowledge index . --profile all
  cumulus db health
  cumulus db progress "Bootstrap finished" [--status done]
  cumulus mcp
  cumulus auth login
  cumulus status

Notes:
  auth commands delegate to the Relay/Auth CLI.
  knowledge commands delegate to the Rust Knowledge runtime.
  db commands use CUMULUS_DB_BASE_URL, CUMULUS_DB_ID, and CUMULUS_DB_TOKEN.
`);
}

function delegateRelay(relayArgs: string[]) {
  const relayBin = new URL("./index.js", import.meta.url).pathname;
  delegate(execPath, [relayBin, ...relayArgs]);
}

function delegateKnowledge(knowledgeArgs: string[]) {
  delegateCommand(env.CUMULUS_KNOWLEDGE_BIN || "cumulus-knowledge", [
    "knowledge",
    ...knowledgeArgs,
  ]);
}

function delegateCommand(bin: string, commandArgs: string[]) {
  delegate(bin, commandArgs);
}

function delegateCreateCumulus(commandArgs: string[]) {
  try {
    delegate(execPath, [require.resolve("create-cumulus"), ...commandArgs]);
  } catch {
    delegateCommand("create-cumulus", commandArgs);
  }
}

function delegate(bin: string, commandArgs: string[]) {
  const result = spawnSync(bin, commandArgs, { stdio: "inherit" });
  if (result.error) {
    console.error(result.error.message);
    exit(1);
  }
  exit(result.status ?? 1);
}

async function intent(intentArgs: string[]) {
  const subcommand = intentArgs[0] ?? "help";
  if (subcommand !== "register") {
    process.stdout.write(`Usage: cumulus intent register "I want to build X" [--project my-project]\n`);
    return;
  }

  const parsed = parseFlags(intentArgs.slice(1));
  const text = parsed.positionals.join(" ").trim();
  if (!text) {
    console.error("Intent text is required.");
    exit(1);
  }
  const project = stringFlag(parsed.flags.project) ?? slugFromIntent(text);
  const payload = {
    intent: text,
    project,
    registered_at: new Date().toISOString(),
    source: "cumulus-cli",
  };

  mkdirSync(join(cwd(), ".cumulus"), { recursive: true });
  writeFileSync(join(cwd(), ".cumulus", "intent.json"), `${JSON.stringify(payload, null, 2)}\n`);

  if (env.CUMULUS_AUTH_BASE_URL && env.CUMULUS_AGENT_TOKEN) {
    const response = await fetch(`${env.CUMULUS_AUTH_BASE_URL.replace(/\/+$/, "")}/v1/intent`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${env.CUMULUS_AGENT_TOKEN}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(payload),
    });
    process.stdout.write(
      JSON.stringify({ local: ".cumulus/intent.json", remote_status: response.status }, null, 2) +
        "\n",
    );
    return;
  }

  process.stdout.write(JSON.stringify({ local: ".cumulus/intent.json", project }, null, 2) + "\n");
}

async function db(dbArgs: string[]) {
  const subcommand = dbArgs[0] ?? "help";
  if (subcommand === "health") {
    const response = await fetch(`${dbBaseUrl()}/health`);
    process.stdout.write(JSON.stringify({ ok: response.ok, status: response.status }, null, 2) + "\n");
    return;
  }
  if (subcommand === "progress") {
    const parsed = parseFlags(dbArgs.slice(1));
    const title = parsed.positionals.join(" ").trim();
    if (!title) {
      console.error("Progress title is required.");
      exit(1);
    }
    const response = await fetch(
      `${dbBaseUrl()}/v1/databases/${encodeURIComponent(requiredEnv("CUMULUS_DB_ID"))}/records`,
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${requiredEnv("CUMULUS_DB_TOKEN")}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          type: "event",
          title,
          tags: ["project-progress", stringFlag(parsed.flags.status) ?? "progress"],
          metadata: { source: "cumulus-cli", status: stringFlag(parsed.flags.status) ?? "progress" },
        }),
      },
    );
    process.stdout.write(JSON.stringify({ ok: response.ok, status: response.status }, null, 2) + "\n");
    return;
  }
  process.stdout.write(`Usage: cumulus db health | cumulus db progress "Title" [--status done]\n`);
}

async function status() {
  const checks: Record<string, unknown> = {};
  checks.auth_configured = Boolean(env.CUMULUS_AUTH_BASE_URL && env.CUMULUS_AGENT_TOKEN);
  try {
    const response = await fetch(`${dbBaseUrl()}/health`);
    checks.db = { ok: response.ok, status: response.status };
  } catch (error) {
    checks.db = { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
  const knowledge = spawnSync(env.CUMULUS_KNOWLEDGE_BIN || "cumulus-knowledge", ["--version"], {
    encoding: "utf8",
  });
  checks.knowledge = {
    ok: knowledge.status === 0,
    version: knowledge.stdout.trim() || knowledge.stderr.trim() || null,
  };
  process.stdout.write(`${JSON.stringify(checks, null, 2)}\n`);
}

function dbBaseUrl() {
  return (env.CUMULUS_DB_BASE_URL || "http://localhost:4317").replace(/\/+$/, "");
}

function requiredEnv(key: string) {
  const value = env[key];
  if (!value) {
    console.error(`${key} is required.`);
    exit(1);
  }
  return value;
}

function parseFlags(values: string[]) {
  const flags: Record<string, string | boolean> = {};
  const positionals: string[] = [];
  for (let i = 0; i < values.length; i += 1) {
    const value = values[i];
    if (value.startsWith("--")) {
      const key = value.slice(2);
      const next = values[i + 1];
      if (next && !next.startsWith("--")) {
        flags[key] = next;
        i += 1;
      } else {
        flags[key] = true;
      }
    } else {
      positionals.push(value);
    }
  }
  return { flags, positionals };
}

function stringFlag(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function slugFromIntent(value: string) {
  return (
    value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 48) || "cumulus-project"
  );
}
