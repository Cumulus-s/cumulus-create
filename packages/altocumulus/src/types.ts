export type FindingSource =
  | "package-json"
  | "npm-workspace"
  | "script"
  | "import"
  | "cargo"
  | "python"
  | "docs"
  | "env"
  | "api";

export interface SourceLocation {
  file: string;
  line?: number;
}

export interface ScanFinding {
  source: FindingSource;
  name: string;
  value?: string;
  spec?: string;
  location: SourceLocation;
}

export interface ProjectIdentity {
  root: string;
  name: string | null;
  packageManager: "npm" | "pnpm" | "yarn" | "bun" | "unknown";
  workspaces: string[];
}

export interface ScanSummary {
  packageCount: number;
  importCount: number;
  scriptCount: number;
  envVarCount: number;
  apiReferenceCount: number;
  scannedFileCount: number;
  skippedFileCount: number;
}

export interface ScanSnapshot {
  version: 1;
  scannedAt: string;
  project: ProjectIdentity;
  summary: ScanSummary;
  packages: ScanFinding[];
  codeUsage: ScanFinding[];
  envVars: ScanFinding[];
  apiReferences: ScanFinding[];
  ignored: string[];
}

export interface AltocumulusConfig {
  version: 1;
  globalStateDir: string;
  updatedAt: string;
}

export interface RegisteredProject {
  root: string;
  name: string | null;
  stateDir: string;
  lastScanAt: string | null;
  latestSnapshotPath: string | null;
}

export interface ProjectRegistry {
  version: 1;
  updatedAt: string;
  projects: RegisteredProject[];
}

export interface ScanHistory {
  version: 1;
  events: Array<{
    scannedAt: string;
    root: string;
    name: string | null;
    summary: ScanSummary;
  }>;
}

export interface StorageResolution {
  config: AltocumulusConfig;
  defaultGlobalStateDir: string;
  defaultConfigPath: string;
  globalStateDir: string;
  projectRoot: string;
  projectStateDir: string;
}
