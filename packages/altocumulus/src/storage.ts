import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { homedir } from "node:os";
import type {
  AltocumulusConfig,
  ProjectRegistry,
  RegisteredProject,
  ScanHistory,
  ScanSnapshot,
  StorageResolution,
} from "./types.js";

export interface StorageOptions {
  homeDir?: string;
}

export function homeDirFromEnv(env: NodeJS.ProcessEnv = process.env, cwd = process.cwd()): string {
  return env.CUMULUS_ALTOCUMULUS_HOME ? resolve(cwd, env.CUMULUS_ALTOCUMULUS_HOME) : homedir();
}

export function defaultGlobalStateDir(homeDir = homedir()): string {
  return join(homeDir, ".cumulus", "altocumulus");
}

export function defaultProjectStateDir(projectRoot: string): string {
  return join(projectRoot, ".cumulus", "altocumulus");
}

export async function loadConfig(options: StorageOptions = {}): Promise<AltocumulusConfig> {
  const home = options.homeDir ?? homedir();
  const defaultDir = defaultGlobalStateDir(home);
  const defaultPath = join(defaultDir, "config.json");
  const boot = normalizeConfig(await readJson<unknown>(defaultPath, defaultConfig(defaultDir)), defaultDir);
  if (boot.globalStateDir && boot.globalStateDir !== defaultDir) {
    const activePath = join(boot.globalStateDir, "config.json");
    const active = normalizeConfig(await readJson<unknown>(activePath, boot), defaultDir);
    return normalizeConfig({ ...active, globalStateDir: boot.globalStateDir }, defaultDir);
  }
  return boot;
}

export async function saveConfig(config: AltocumulusConfig, options: StorageOptions = {}): Promise<AltocumulusConfig> {
  const home = options.homeDir ?? homedir();
  const defaultDir = defaultGlobalStateDir(home);
  const normalized = normalizeConfig(config, defaultDir);
  await writeJson(join(defaultDir, "config.json"), normalized);
  if (normalized.globalStateDir !== defaultDir) {
    await writeJson(join(normalized.globalStateDir, "config.json"), normalized);
  }
  return normalized;
}

export async function setGlobalStateDir(dir: string, options: StorageOptions = {}): Promise<AltocumulusConfig> {
  const current = await loadConfig(options);
  return saveConfig({ ...current, globalStateDir: resolve(dir), updatedAt: nowIso() }, options);
}

export async function resolveStorage(projectRoot: string, options: StorageOptions = {}): Promise<StorageResolution> {
  const root = resolve(projectRoot);
  const config = await loadConfig(options);
  const registry = await loadProjectRegistry(config.globalStateDir);
  const existing = registry.projects.find((project) => project.root === root);
  const projectStateDir = existing?.stateDir ?? defaultProjectStateDir(root);
  const home = options.homeDir ?? homedir();
  const defaultDir = defaultGlobalStateDir(home);
  return {
    config,
    defaultGlobalStateDir: defaultDir,
    defaultConfigPath: join(defaultDir, "config.json"),
    globalStateDir: config.globalStateDir,
    projectRoot: root,
    projectStateDir,
  };
}

export async function setProjectStateDir(
  projectRoot: string,
  stateDir: string,
  options: StorageOptions = {},
): Promise<RegisteredProject> {
  const root = resolve(projectRoot);
  const resolvedStateDir = resolve(stateDir);
  if (resolvedStateDir === root) {
    throw new Error("Project state directory must not be the project root.");
  }
  const config = await loadConfig(options);
  const registry = await loadProjectRegistry(config.globalStateDir);
  const current = registry.projects.find((project) => project.root === root);
  const next: RegisteredProject = {
    root,
    name: current?.name ?? null,
    stateDir: resolvedStateDir,
    lastScanAt: current?.lastScanAt ?? null,
    latestSnapshotPath: current?.latestSnapshotPath ?? null,
  };
  await saveProjectRegistry(config.globalStateDir, upsertProject(registry, next));
  await writeProjectConfig(next.stateDir, root, config.globalStateDir);
  return next;
}

export async function saveScanSnapshot(
  snapshot: ScanSnapshot,
  options: StorageOptions = {},
): Promise<StorageResolution> {
  const storage = await resolveStorage(snapshot.project.root, options);
  await mkdir(storage.globalStateDir, { recursive: true, mode: 0o700 });
  await mkdir(storage.projectStateDir, { recursive: true, mode: 0o700 });

  const latestSnapshotPath = join(storage.projectStateDir, "latest-scan.json");
  await writeJson(latestSnapshotPath, snapshot);
  await writeProjectConfig(storage.projectStateDir, snapshot.project.root, storage.globalStateDir);

  const registry = await loadProjectRegistry(storage.globalStateDir);
  await saveProjectRegistry(
    storage.globalStateDir,
    upsertProject(registry, {
      root: snapshot.project.root,
      name: snapshot.project.name,
      stateDir: storage.projectStateDir,
      lastScanAt: snapshot.scannedAt,
      latestSnapshotPath,
    }),
  );

  await appendHistory(join(storage.projectStateDir, "history.json"), snapshot);
  await appendHistory(join(storage.globalStateDir, "activity.json"), snapshot);
  return storage;
}

export async function loadLatestScanSnapshot(storage: StorageResolution): Promise<ScanSnapshot | null> {
  try {
    return JSON.parse(await readFile(join(storage.projectStateDir, "latest-scan.json"), "utf8")) as ScanSnapshot;
  } catch {
    return null;
  }
}

export function emptyScanSnapshot(projectRoot: string): ScanSnapshot {
  return {
    version: 1,
    scannedAt: new Date(0).toISOString(),
    project: {
      root: resolve(projectRoot),
      name: null,
      packageManager: "unknown",
      workspaces: [],
    },
    summary: {
      packageCount: 0,
      importCount: 0,
      scriptCount: 0,
      envVarCount: 0,
      apiReferenceCount: 0,
      scannedFileCount: 0,
      skippedFileCount: 0,
    },
    packages: [],
    codeUsage: [],
    envVars: [],
    apiReferences: [],
    ignored: [],
  };
}

export async function loadProjectRegistry(globalStateDir: string): Promise<ProjectRegistry> {
  return normalizeProjectRegistry(
    await readJson<unknown>(join(globalStateDir, "projects.json"), {
      version: 1,
      updatedAt: new Date(0).toISOString(),
      projects: [],
    }),
  );
}

export async function loadScanHistory(path: string): Promise<ScanHistory> {
  return readJson<ScanHistory>(path, { version: 1, events: [] });
}

async function appendHistory(path: string, snapshot: ScanSnapshot) {
  const history = await loadScanHistory(path);
  const next: ScanHistory = {
    version: 1,
    events: [
      {
        scannedAt: snapshot.scannedAt,
        root: snapshot.project.root,
        name: snapshot.project.name,
        summary: snapshot.summary,
      },
      ...history.events,
    ].slice(0, 200),
  };
  await writeJson(path, next);
}

function upsertProject(registry: ProjectRegistry, project: RegisteredProject): ProjectRegistry {
  const projects = registry.projects.filter((item) => item.root !== project.root);
  projects.unshift(project);
  return { version: 1, updatedAt: nowIso(), projects };
}

async function saveProjectRegistry(globalStateDir: string, registry: ProjectRegistry) {
  await writeJson(join(globalStateDir, "projects.json"), registry);
}

async function writeProjectConfig(projectStateDir: string, projectRoot: string, globalStateDir: string) {
  await writeJson(join(projectStateDir, "config.json"), {
    version: 1,
    projectRoot,
    projectStateDir,
    globalStateDir,
    updatedAt: nowIso(),
  });
}

function defaultConfig(defaultDir: string): AltocumulusConfig {
  return {
    version: 1,
    globalStateDir: defaultDir,
    updatedAt: new Date(0).toISOString(),
  };
}

function normalizeConfig(config: unknown, defaultDir: string): AltocumulusConfig {
  const record = isRecord(config) ? config : {};
  const globalStateDir =
    typeof record.globalStateDir === "string" && record.globalStateDir.trim()
      ? record.globalStateDir
      : defaultDir;
  const updatedAt =
    typeof record.updatedAt === "string" && record.updatedAt.trim() ? record.updatedAt : nowIso();
  return {
    version: 1,
    globalStateDir: resolve(globalStateDir),
    updatedAt,
  };
}

function normalizeProjectRegistry(registry: unknown): ProjectRegistry {
  const record = isRecord(registry) ? registry : {};
  const projects = Array.isArray(record.projects)
    ? record.projects.flatMap((item): RegisteredProject[] => {
        if (!isRecord(item) || typeof item.root !== "string" || typeof item.stateDir !== "string") {
          return [];
        }
        return [
          {
            root: resolve(item.root),
            name: typeof item.name === "string" ? item.name : null,
            stateDir: resolve(item.stateDir),
            lastScanAt: typeof item.lastScanAt === "string" ? item.lastScanAt : null,
            latestSnapshotPath: typeof item.latestSnapshotPath === "string" ? item.latestSnapshotPath : null,
          },
        ];
      })
    : [];
  return {
    version: 1,
    updatedAt: typeof record.updatedAt === "string" ? record.updatedAt : new Date(0).toISOString(),
    projects,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

async function readJson<T>(path: string, fallback: T): Promise<T> {
  try {
    return JSON.parse(await readFile(path, "utf8")) as T;
  } catch {
    return fallback;
  }
}

async function writeJson(path: string, value: unknown) {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const tmp = `${path}.tmp-${process.pid}-${Date.now()}`;
  await writeFile(tmp, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  await rename(tmp, path);
}

function nowIso(): string {
  return new Date().toISOString();
}
