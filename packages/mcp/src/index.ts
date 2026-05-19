#!/usr/bin/env node
import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { createInterface } from "node:readline";
import {
  createEventEmitter,
  defaultProjectLedgerPath,
  readEvents,
  toSyncPayload,
} from "@cmls/events";

type JsonRpcRequest = {
  jsonrpc?: "2.0";
  id?: string | number | null;
  method?: string;
  params?: Record<string, unknown>;
};

type ToolHandler = (args: Record<string, unknown>) => Promise<unknown>;

const tools: Record<string, { description: string; inputSchema: unknown; handler: ToolHandler }> = {
  "cumulus.list_projects": {
    description: "List projects known to the local Altocumulus registry.",
    inputSchema: { type: "object", properties: {} },
    handler: listProjects,
  },
  "cumulus.list_agent_accounts": {
    description: "Return account inventory status from local/cloud-safe metadata only.",
    inputSchema: { type: "object", properties: {} },
    handler: listAgentAccounts,
  },
  "cumulus.get_usage_summary": {
    description: "Summarize local Cumulus event ledger counts.",
    inputSchema: { type: "object", properties: { ledger_path: { type: "string" } } },
    handler: getUsageSummary,
  },
  "cumulus.scan_project": {
    description: "Run a local Altocumulus scan. Does not expose secrets; scan progress stays on stderr.",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string" },
        save: { type: "boolean" },
      },
    },
    handler: scanProject,
  },
  "cumulus.open_action_card": {
    description: "Describe a future guarded action without executing it.",
    inputSchema: {
      type: "object",
      properties: {
        action: { type: "string" },
      },
      required: ["action"],
    },
    handler: openActionCard,
  },
  "cumulus.sync_safe_events": {
    description: "Prepare safe sync payload locally. Does not upload in v3.",
    inputSchema: {
      type: "object",
      properties: {
        ledger_path: { type: "string" },
        include_tenant_visible: { type: "boolean" },
      },
    },
    handler: syncSafeEvents,
  },
};

const prompts = [
  {
    name: "summarize_agent_activity",
    description: "Summarize safe local agent activity from the Cumulus usage ledger.",
  },
  {
    name: "audit_auth_risk",
    description: "Review account metadata, stale grants, broad scopes, and failed auth events.",
  },
  {
    name: "explain_usage_cost",
    description: "Explain API, SDK, MCP, and package usage cost drivers in plain language.",
  },
  {
    name: "triage_failed_agent_actions",
    description: "Triage failed agent actions using safe status, route, and error-class metadata.",
  },
];

const resources = [
  {
    uri: "cumulus://projects",
    name: "projects",
    title: "Cumulus Projects",
    description: "Local Altocumulus project registry.",
    mimeType: "application/json",
  },
  {
    uri: "cumulus://agent/local/auth",
    name: "agent-auth",
    title: "Agent Auth Metadata",
    description: "Safe account and grant metadata. Credential values are never exposed.",
    mimeType: "application/json",
  },
  {
    uri: "cumulus://agent/local/db",
    name: "agent-db",
    title: "Agent Database Metadata",
    description: "Safe database operation metadata.",
    mimeType: "application/json",
  },
  {
    uri: "cumulus://agent/local/knowledge",
    name: "agent-knowledge",
    title: "Agent Knowledge Metadata",
    description: "Safe retrieval/source metadata.",
    mimeType: "application/json",
  },
  {
    uri: "cumulus://usage/local",
    name: "usage",
    title: "Usage Summary",
    description: "Local usage ledger summary.",
    mimeType: "application/json",
  },
];

const mcpEvents = createEventEmitter({
  sourcePackage: "@cmls/mcp",
  surface: "mcp",
  subsystem: "agent",
  ledgerPath: process.env.CUMULUS_EVENTS_LEDGER,
});

const rl = createInterface({ input: process.stdin, crlfDelay: Infinity });

rl.on("line", async (line) => {
  if (!line.trim()) return;
  let request: JsonRpcRequest;
  try {
    request = JSON.parse(line) as JsonRpcRequest;
  } catch {
    respond(null, null, { code: -32700, message: "invalid JSON" });
    return;
  }

  try {
    if (request.method === "initialize") {
      respond(request.id, {
        protocolVersion: "2025-11-25",
        serverInfo: { name: "cumulus-operations", version: "0.1.0" },
        capabilities: { tools: {}, resources: {}, prompts: {} },
      });
      return;
    }
    if (request.method === "tools/list") {
      respond(request.id, {
        tools: Object.entries(tools).map(([name, tool]) => ({
          name,
          description: tool.description,
          inputSchema: tool.inputSchema,
        })),
      });
      return;
    }
    if (request.method === "tools/call") {
      const params = request.params ?? {};
      const name = String(params.name ?? "");
      const tool = tools[name];
      if (!tool) throw new Error(`unknown tool: ${name}`);
      const started = Date.now();
      try {
        const data = await tool.handler(asRecord(params.arguments));
        await mcpEvents.emit({
          operation: "tool_call",
          status: "ok",
          durationMs: Date.now() - started,
          mcp: { toolName: name },
          privacy: { class: "creator_safe_metadata", redacted: false },
        });
        respond(request.id, { content: [{ type: "text", text: JSON.stringify(data) }] });
      } catch (error) {
        await mcpEvents.emit({
          operation: "tool_call",
          status: "error",
          durationMs: Date.now() - started,
          mcp: { toolName: name },
          privacy: { class: "creator_safe_metadata", redacted: false },
          metadata: { error_class: error instanceof Error ? error.name : "Error" },
        });
        throw error;
      }
      return;
    }
    if (request.method === "resources/list") {
      respond(request.id, { resources });
      return;
    }
    if (request.method === "resources/read") {
      const uri = String(request.params?.uri ?? "");
      const data = await readResource(uri);
      await mcpEvents.emit({
        operation: "resource_read",
        status: "ok",
        mcp: { resourceUri: uri },
        privacy: { class: "creator_safe_metadata", redacted: false },
      });
      respond(request.id, {
        contents: [{ uri, mimeType: "application/json", text: JSON.stringify(data, null, 2) }],
      });
      return;
    }
    if (request.method === "resources/templates/list") {
      respond(request.id, {
        resourceTemplates: [
          {
            uriTemplate: "cumulus://project/{id}",
            name: "project",
            title: "Cumulus Project",
            description: "Safe local project metadata by id/root hash.",
            mimeType: "application/json",
          },
        ],
      });
      return;
    }
    if (request.method === "prompts/list") {
      respond(request.id, { prompts });
      return;
    }
    if (request.method === "prompts/get") {
      const name = String(request.params?.name ?? "");
      const prompt = prompts.find((item) => item.name === name);
      if (!prompt) throw new Error(`unknown prompt: ${name}`);
      await mcpEvents.emit({
        operation: "prompt_get",
        status: "ok",
        mcp: { promptName: name },
        privacy: { class: "creator_safe_metadata", redacted: false },
      });
      respond(request.id, {
        description: prompt.description,
        messages: [
          {
            role: "user",
            content: {
              type: "text",
              text: `${prompt.description}\nUse only safe Cumulus metadata. Do not ask for or expose credential values, raw private data, or raw prompts.`,
            },
          },
        ],
      });
      return;
    }
    if (request.method === "notifications/initialized") return;
    respond(request.id, null, { code: -32601, message: `unknown method: ${request.method}` });
  } catch (error) {
    respond(request.id, null, {
      code: -32000,
      message: error instanceof Error ? error.message : String(error),
    });
  }
});

function respond(
  id: JsonRpcRequest["id"],
  result: unknown,
  error?: { code: number; message: string },
) {
  if (id === undefined) return;
  const payload = error ? { jsonrpc: "2.0", id, error } : { jsonrpc: "2.0", id, result };
  process.stdout.write(`${JSON.stringify(payload)}\n`);
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

async function listProjects() {
  return readProjectRegistry();
}

async function listAgentAccounts() {
  const authEvents = (await readDefaultEvents()).events.filter((event) => event.subsystem === "auth");
  return {
    privacy: "creator_safe_metadata",
    note: "Credential values are never exposed.",
    accounts: authEvents.slice(0, 50).map((event) => ({
      ts: event.ts,
      status: event.status,
      operation: event.operation,
      accountRef: event.refs?.accountRef ?? null,
      credentialRef: event.refs?.credentialRef ?? null,
      metadata: event.metadata ?? {},
    })),
  };
}

async function getUsageSummary(args: Record<string, unknown>) {
  const ledger = await readEvents(resolveLedgerPath(args.ledger_path));
  return summarizeEvents(ledger);
}

async function scanProject(args: Record<string, unknown>) {
  const target = typeof args.path === "string" ? args.path : ".";
  const save = args.save !== false;
  const command = process.env.ALTOCUMULUS_BIN ?? "altocumulus";
  const result = await runCommand(command, ["scan", target, "--json", ...(save ? [] : ["--no-save"])]);
  return JSON.parse(result.stdout);
}

async function openActionCard(args: Record<string, unknown>) {
  const action = String(args.action ?? "");
  if (!action.trim()) throw new Error("action is required");
  return {
    action,
    status: "disabled",
    reason: "Altocumulus v3 is read-only for cloud mutations.",
    allowedNow: ["show command", "open docs", "show required scopes", "prepare local metadata"],
    blockedNow: ["mint key", "rotate key", "open checkout", "create product", "revoke credential"],
  };
}

async function syncSafeEvents(args: Record<string, unknown>) {
  const ledger = await readEvents(resolveLedgerPath(args.ledger_path));
  const payload = toSyncPayload(ledger.events, {
    includeTenantVisible: args.include_tenant_visible === true,
  });
  return {
    status: "prepared_not_uploaded",
    reason: "Cloud event upload is disabled in v3.",
    eventCount: payload.events.length,
    malformed: ledger.malformed.length,
    payload,
  };
}

async function readResource(uri: string) {
  if (uri === "cumulus://projects") return readProjectRegistry();
  if (uri === "cumulus://usage/local") return getUsageSummary({});
  if (uri === "cumulus://agent/local/auth") return listAgentAccounts();
  if (uri === "cumulus://agent/local/db") return subsystemResource("db");
  if (uri === "cumulus://agent/local/knowledge") return subsystemResource("knowledge");
  if (uri.startsWith("cumulus://project/")) {
    const registry = await readProjectRegistry();
    const id = decodeURIComponent(uri.slice("cumulus://project/".length));
    return registry.projects.find((project: { root?: string; name?: string }) => project.root === id || project.name === id) ?? null;
  }
  throw new Error(`unknown resource: ${uri}`);
}

async function subsystemResource(subsystem: "db" | "knowledge") {
  const ledger = await readDefaultEvents();
  return {
    privacy: "creator_safe_metadata",
    events: ledger.events.filter((event) => event.subsystem === subsystem).slice(0, 50),
    malformed: ledger.malformed.length,
  };
}

async function readProjectRegistry() {
  const path = join(defaultGlobalStateDir(), "projects.json");
  try {
    const parsed = JSON.parse(await readFile(path, "utf8"));
    return parsed && typeof parsed === "object" ? parsed : { version: 1, projects: [] };
  } catch {
    return { version: 1, projects: [] };
  }
}

async function readDefaultEvents() {
  return readEvents(resolveLedgerPath(undefined));
}

function summarizeEvents(ledger: Awaited<ReturnType<typeof readEvents>>) {
  const bySubsystem: Record<string, number> = {};
  const bySurface: Record<string, number> = {};
  for (const event of ledger.events) {
    bySubsystem[event.subsystem] = (bySubsystem[event.subsystem] ?? 0) + 1;
    bySurface[event.surface] = (bySurface[event.surface] ?? 0) + 1;
  }
  return {
    eventCount: ledger.events.length,
    malformed: ledger.malformed.length,
    bySubsystem,
    bySurface,
    privacy: "creator_safe_metadata",
  };
}

function resolveLedgerPath(raw: unknown): string {
  if (typeof raw === "string" && raw.trim()) return resolve(raw);
  if (process.env.CUMULUS_EVENTS_LEDGER) return resolve(process.env.CUMULUS_EVENTS_LEDGER);
  return defaultProjectLedgerPath(join(process.cwd(), ".cumulus", "altocumulus"));
}

function defaultGlobalStateDir(): string {
  return process.env.CUMULUS_ALTOCUMULUS_HOME
    ? join(resolve(process.env.CUMULUS_ALTOCUMULUS_HOME), ".cumulus", "altocumulus")
    : join(homedir(), ".cumulus", "altocumulus");
}

function runCommand(command: string, args: string[]): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, {
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(stderr.trim() || `${command} exited with ${code}`));
        return;
      }
      resolvePromise({ stdout, stderr });
    });
  });
}
