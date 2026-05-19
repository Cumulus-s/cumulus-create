import { spawnSync } from "node:child_process";

export interface RuntimeInstallOptions {
  rust?: boolean;
  python?: boolean;
  dryRun?: boolean;
  force?: boolean;
  quiet?: boolean;
  rustPath?: string;
  pythonPath?: string;
  pythonUser?: boolean;
}

export interface RuntimeInstallResult {
  runtime: "rust" | "python";
  skipped: boolean;
  ok: boolean;
  command?: string;
  reason?: string;
}

export function parseRuntimeSelection(value: string | undefined): Pick<RuntimeInstallOptions, "rust" | "python"> {
  if (!value) return { rust: false, python: false };
  const normalized = value.toLowerCase();
  if (["1", "true", "yes", "all"].includes(normalized)) return { rust: true, python: true };
  const parts = new Set(normalized.split(",").map((part) => part.trim()).filter(Boolean));
  return { rust: parts.has("rust"), python: parts.has("python") };
}

export function installRuntimes(options: RuntimeInstallOptions = {}): RuntimeInstallResult[] {
  const wantRust = options.rust ?? true;
  const wantPython = options.python ?? true;
  const results: RuntimeInstallResult[] = [];
  if (wantRust) results.push(installRust(options));
  if (wantPython) results.push(installPython(options));
  return results;
}

function installRust(options: RuntimeInstallOptions): RuntimeInstallResult {
  const cargo = process.env.CUMULUS_KNOWLEDGE_CARGO ?? "cargo";
  if (!commandExists(cargo)) {
    return skipped("rust", "cargo was not found");
  }
  const rustPackage = process.env.CUMULUS_KNOWLEDGE_RUST_PACKAGE ?? "cmls-knowledge-cli";
  const rustPath = options.rustPath ?? process.env.CUMULUS_KNOWLEDGE_RUST_PATH;
  const args = rustPath ? ["install", "--path", rustPath] : ["install", rustPackage, "--locked"];
  if (options.force || process.env.CUMULUS_KNOWLEDGE_INSTALL_FORCE === "1") args.push("--force");
  return run("rust", cargo, args, options);
}

function installPython(options: RuntimeInstallOptions): RuntimeInstallResult {
  const python = process.env.CUMULUS_KNOWLEDGE_PYTHON ?? firstCommand(["python3", "python"]);
  if (!python) {
    return skipped("python", "python3/python was not found");
  }
  const pythonPackage = process.env.CUMULUS_KNOWLEDGE_PYTHON_PACKAGE ?? "cmls-knowledge";
  const pythonPath = options.pythonPath ?? process.env.CUMULUS_KNOWLEDGE_PYTHON_PATH;
  const target = pythonPath ?? pythonPackage;
  const useUser = options.pythonUser ?? shouldUseUserInstall();
  const args = ["-m", "pip", "install", "--upgrade"];
  if (useUser) args.push("--user");
  args.push(target);
  return run("python", python, args, options);
}

function shouldUseUserInstall(): boolean {
  if (process.env.CUMULUS_KNOWLEDGE_PIP_USER === "0") return false;
  if (process.env.VIRTUAL_ENV || process.env.CONDA_PREFIX) return false;
  return true;
}

function run(runtime: "rust" | "python", command: string, args: string[], options: RuntimeInstallOptions): RuntimeInstallResult {
  const rendered = [command, ...args].join(" ");
  if (options.dryRun) {
    if (!options.quiet) process.stderr.write(`[cmls-knowledge] dry-run: ${rendered}\n`);
    return { runtime, skipped: false, ok: true, command: rendered };
  }
  if (!options.quiet) process.stderr.write(`[cmls-knowledge] installing ${runtime}: ${rendered}\n`);
  const completed = spawnSync(command, args, { stdio: options.quiet ? "pipe" : "inherit" });
  if (completed.status === 0) return { runtime, skipped: false, ok: true, command: rendered };
  return { runtime, skipped: false, ok: false, command: rendered, reason: `${command} exited with ${completed.status ?? "unknown status"}` };
}

function skipped(runtime: "rust" | "python", reason: string): RuntimeInstallResult {
  return { runtime, skipped: true, ok: false, reason };
}

function commandExists(command: string): boolean {
  const completed = spawnSync(command, ["--version"], { stdio: "ignore" });
  return completed.status === 0;
}

function firstCommand(commands: string[]): string | undefined {
  return commands.find(commandExists);
}
