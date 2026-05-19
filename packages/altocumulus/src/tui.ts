import { join } from "node:path";
import { stdin as defaultStdin, stdout as defaultStdout } from "node:process";
import readline from "node:readline";
import type { ReadStream, WriteStream } from "node:tty";
import type { ReadEventsResult } from "@cmls/events";
import type { ProjectRegistry, ScanHistory, ScanSnapshot, StorageResolution } from "./types.js";

export const pages = [
  "Dashboard",
  "Projects",
  "Agent Auth",
  "Agent Database",
  "Agent Knowledge",
  "API/SDK Calls",
  "MCP",
  "Usage Ledger",
  "Billing Economics",
  "Packages",
  "Create-Cumulus",
  "Scanner",
  "Storage",
  "Help",
] as const;

export interface TuiState {
  snapshot: ScanSnapshot;
  storage: StorageResolution;
  registry: ProjectRegistry;
  history: ScanHistory;
  ledger: ReadEventsResult;
}

export interface RunTuiOptions {
  stdin?: ReadStream;
  stdout?: WriteStream;
}

const CLOUD_MARK = [
  "      . . . .",
  "   . . . . . . .",
  " . . . . . . . . .",
  ". . . . . . . . . .",
  ". . . . . . o . . .",
  "  . . . . . . . .",
  "    . . . . . .",
];

export async function runTui(state: TuiState, options: RunTuiOptions = {}): Promise<void> {
  const input = options.stdin ?? (defaultStdin as ReadStream);
  const output = options.stdout ?? (defaultStdout as WriteStream);
  if (!input.isTTY || !output.isTTY) {
    output.write(renderFrame(state, 0, 100, 32));
    output.write("\n");
    return;
  }

  readline.emitKeypressEvents(input);
  const wasRaw = input.isRaw;
  input.setRawMode(true);
  let selected = 0;

  const draw = () => {
    output.write("\x1b[?25l\x1b[2J\x1b[H");
    output.write(renderFrame(state, selected, output.columns || 100, output.rows || 32));
  };

  let onKeypress: ((_chunk: string, key: readline.Key) => void) | undefined;
  try {
    await new Promise<void>((resolve) => {
      onKeypress = (chunk: string, key: readline.Key) => {
        if (key.name === "q" || key.name === "escape" || (key.ctrl && key.name === "c")) {
          resolve();
          return;
        }
        if (key.name === "down" || key.name === "j") {
          selected = Math.min(selected + 1, pages.length - 1);
          draw();
          return;
        }
        if (key.name === "up" || key.name === "k") {
          selected = Math.max(selected - 1, 0);
          draw();
          return;
        }
        const n = Number(chunk);
        if (Number.isInteger(n) && n >= 1 && n <= pages.length) {
          selected = n - 1;
          draw();
        }
      };
      input.on("keypress", onKeypress);
      draw();
    });
  } finally {
    if (onKeypress) input.off("keypress", onKeypress);
    input.setRawMode(wasRaw);
    output.write("\x1b[?25h\x1b[2J\x1b[H");
  }
}

export function renderFrame(state: TuiState, selectedPage = 0, width = 100, height = 32): string {
  const safeWidth = Math.max(88, width);
  const safeHeight = Math.max(24, height);
  const sidebarWidth = 23;
  const contentWidth = safeWidth - sidebarWidth - 3;
  const page = pages[selectedPage] ?? pages[0];
  const content = contentLines(page, state).flatMap((line) => wrapLine(line, contentWidth));
  const maxRows = safeHeight - 9;
  const rows: string[] = [];

  rows.push(...headerLines(safeWidth));
  rows.push(frameLine("+", "-", "+", safeWidth));

  for (let index = 0; index < maxRows; index += 1) {
    const nav = pages[index]
      ? `${index === selectedPage ? ">" : " "} ${String(index + 1).padStart(2, "0")} ${pages[index]}`
      : "";
    const body = content[index] ?? "";
    rows.push(`${nav.padEnd(sidebarWidth)} | ${body.padEnd(contentWidth)}`.slice(0, safeWidth));
  }

  rows.push(frameLine("+", "-", "+", safeWidth));
  rows.push("j/k or arrows move. number keys jump. s = scan command shown on Scanner. q/esc exits.".padEnd(safeWidth));
  return rows.join("\n");
}

function headerLines(width: number): string[] {
  const compact = width < 110;
  const title = "ALTOCUMULUS";
  if (compact) {
    return [
      `${". . . . . . o".padEnd(18)} ${title}`,
      "local terminal control center for Cumulus agent operations",
      "cache-first dashboard. safe metadata only. no startup scan.",
    ];
  }
  const markWidth = Math.max(...CLOUD_MARK.map((line) => line.length));
  const lines = CLOUD_MARK.map((line, index) => {
    const label =
      index === 2
        ? title
        : index === 3
          ? "local terminal control center"
          : index === 4
            ? "safe metadata only"
            : "";
    return `${line.padEnd(markWidth)}   ${label}`;
  });
  lines.push("cache-first dashboard. scan only when requested.".padEnd(width));
  return lines;
}

function contentLines(page: (typeof pages)[number], state: TuiState): string[] {
  const snapshot = state.snapshot;
  const eventCounts = countEvents(state);
  if (page === "Dashboard") {
    return [
      "Agent operations control plane",
      "",
      `current target: ${state.storage.projectRoot}`,
      metric("projects", state.registry.projects.length),
      metric("ledger events", state.ledger.events.length),
      metric("malformed ledger lines", state.ledger.malformed.length),
      metric("packages found", snapshot.summary.packageCount),
      metric("api refs found", snapshot.summary.apiReferenceCount),
      metric("auth events", eventCounts.auth),
      metric("db events", eventCounts.db),
      metric("knowledge events", eventCounts.knowledge),
      metric("mcp events", eventCounts.mcp),
      "",
      "Action cards:",
      "[scan] run altocumulus scan <project> --json",
      "[cloud] read-only inventory through @cmls/cloud",
      "[sync] safe event upload is disabled until the next explicit plan",
      "",
      privacyLegend(),
    ];
  }
  if (page === "Projects") {
    return state.registry.projects.length
      ? state.registry.projects.map((project) => {
          const marker = project.root === snapshot.project.root ? "*" : " ";
          return `${marker} ${project.name ?? "(unnamed)"} | ${project.lastScanAt ?? "never"} | ${project.root}`;
        })
      : [
          "No registered projects yet.",
          "Run: altocumulus scan /path/to/project --json",
        ];
  }
  if (page === "Agent Auth") {
    return sectionFromEvents(state, "auth", [
      "Credential values are never displayed.",
      "This page shows providers, account refs, grant health, scopes, and last use when events exist.",
      "Future action cards: rotate credential, revoke grant, reconnect account, open cloud.",
    ]);
  }
  if (page === "Agent Database") {
    return sectionFromEvents(state, "db", [
      "Database events store operation, database/table refs, row counts, status, and duration.",
      "Raw rows, SQL with secrets, and connection strings are not stored.",
    ]);
  }
  if (page === "Agent Knowledge") {
    return sectionFromEvents(state, "knowledge", [
      "Knowledge events store source refs, hashes, chunk counts, status, and duration.",
      "Raw snippets stay local unless a tenant explicitly opts in later.",
    ]);
  }
  if (page === "API/SDK Calls") {
    const events = state.ledger.events.filter((event) => event.surface === "sdk" || event.surface === "api").slice(0, 30);
    return events.length ? events.map(formatEvent) : ["No SDK/API events yet."];
  }
  if (page === "MCP") {
    return sectionFromEvents(state, "agent", [
      "MCP is the agent-facing protocol surface.",
      "Safe resources: project, auth metadata, database metadata, knowledge metadata, usage summary.",
      "Safe tools: list projects, list accounts, get usage summary, scan project, open action card, prepare safe sync.",
    ]);
  }
  if (page === "Usage Ledger") {
    return state.ledger.events.length
      ? state.ledger.events.slice(0, 40).map(formatEvent)
      : ["No local ledger events yet. Scans and SDK hooks will append here."];
  }
  if (page === "Billing Economics") {
    return [
      "Local economics model",
      "",
      metric("api/sdk events", state.ledger.events.filter((event) => event.surface === "api" || event.surface === "sdk").length),
      metric("mcp/tool events", state.ledger.events.filter((event) => event.surface === "mcp").length),
      metric("package refs", snapshot.summary.packageCount),
      metric("estimated usd", estimateCost(state).toFixed(4)),
      "",
      "Cloud billing remains read-only in v3.",
      "Checkout, key mint, rotation, product creation, and package install are action cards only.",
    ];
  }
  if (page === "Packages") {
    const names = snapshot.packages.map((item) => `${item.name}${item.spec ? ` ${item.spec}` : ""} - ${formatLocation(item.location.file, item.location.line)}`);
    return names.length
      ? names
      : [
          "No Cumulus packages detected in the latest snapshot.",
          "Catalog targets: @cmls/create, @cmls/* SDKs, MCP, server, and cloud client.",
        ];
  }
  if (page === "Create-Cumulus") {
    return [
      "@cmls/create scaffolds. It does not own runtime observability.",
      "",
      "Expected generated setup:",
      "  - installs @cmls/auth, @cmls/db, @cmls/knowledge, @cmls/mcp, and @cmls/cli",
      "  - writes local Cumulus/Altocumulus manifest",
      "  - can optionally register a cloud project in a future guarded flow",
      "",
      "Current action card:",
      "  npm create @cmls@latest my-app -- --template full --agent-auth hosted",
    ];
  }
  if (page === "Scanner") {
    return [
      "Scanner is explicit. Dashboard startup never scans.",
      "",
      `Current target: ${state.storage.projectRoot}`,
      `Latest scanned: ${snapshot.scannedAt === new Date(0).toISOString() ? "never" : snapshot.scannedAt}`,
      `Files scanned: ${snapshot.summary.scannedFileCount}`,
      `Files skipped: ${snapshot.summary.skippedFileCount}`,
      "",
      "Run:",
      `  altocumulus scan ${shellPath(state.storage.projectRoot)} --json`,
      "",
      "Ignored by default:",
      "  .tado .codex .claude .agent .cumulus .git node_modules dist build target caches venvs",
      "",
      "Secret rule: .env values are never stored. Only variable names are recorded.",
    ];
  }
  if (page === "Storage") {
    return [
      `Global state: ${state.storage.globalStateDir}`,
      `Project state: ${state.storage.projectStateDir}`,
      `Project ledger: ${join(state.storage.projectStateDir, "events.jsonl")}`,
      `Default global: ${state.storage.defaultGlobalStateDir}`,
      `Default config pointer: ${state.storage.defaultConfigPath}`,
      "",
      "Change paths:",
      "  altocumulus config set global-state <path>",
      "  altocumulus config set project-state <path> [project]",
      "",
      privacyLegend(),
    ];
  }
  return [
    "altocumulus",
    "  Open cached dashboard. No startup scan.",
    "",
    "altocumulus scan . --json",
    "  Scan local Cumulus usage. JSON stdout stays clean; progress goes to stderr.",
    "",
    "altocumulus config . --json",
    "  Show storage paths.",
    "",
    "Privacy classes:",
    "  public | tenant_visible | creator_safe_metadata | local_only | secret_never_store",
  ];
}

function sectionFromEvents(state: TuiState, subsystem: string, empty: string[]): string[] {
  const events = state.ledger.events.filter((event) => event.subsystem === subsystem).slice(0, 30);
  return events.length ? events.map(formatEvent) : empty;
}

function countEvents(state: TuiState) {
  return {
    auth: state.ledger.events.filter((event) => event.subsystem === "auth").length,
    db: state.ledger.events.filter((event) => event.subsystem === "db").length,
    knowledge: state.ledger.events.filter((event) => event.subsystem === "knowledge").length,
    mcp: state.ledger.events.filter((event) => event.surface === "mcp").length,
  };
}

function estimateCost(state: TuiState): number {
  return state.ledger.events.reduce((sum, event) => sum + (event.cost?.estimatedUsd ?? 0), 0);
}

function metric(label: string, value: string | number): string {
  return `[${label.padEnd(22)}] ${value}`;
}

function formatEvent(event: TuiState["ledger"]["events"][number]): string {
  const status = event.status.padEnd(8);
  const duration = event.durationMs === undefined ? "" : ` ${event.durationMs}ms`;
  const route = event.http?.route ? ` ${event.http.method ?? "GET"} ${event.http.route}` : "";
  const privacy = event.privacy.redacted ? `${event.privacy.class}:redacted` : event.privacy.class;
  return `${event.ts} | ${status} | ${event.sourcePackage} | ${event.operation}${route}${duration} | ${privacy}`;
}

function privacyLegend(): string {
  return "Privacy: creator_safe_metadata syncable. local_only stays here. secret_never_store is rejected/redacted.";
}

function formatLocation(file: string, line?: number): string {
  return line ? `${file}:${line}` : file;
}

function shellPath(path: string): string {
  return path.includes(" ") ? `"${path.replace(/"/g, '\\"')}"` : path;
}

function wrapLine(line: string, width: number): string[] {
  if (line.length <= width) return [line];
  const out: string[] = [];
  let rest = line;
  while (rest.length > width) {
    const cut = Math.max(1, rest.lastIndexOf(" ", width));
    out.push(rest.slice(0, cut));
    rest = rest.slice(cut).trimStart();
  }
  out.push(rest);
  return out;
}

function frameLine(left: string, middle: string, right: string, width: number): string {
  return `${left}${middle.repeat(Math.max(0, width - 2))}${right}`;
}

export function historyPath(storage: StorageResolution): string {
  return join(storage.projectStateDir, "history.json");
}
