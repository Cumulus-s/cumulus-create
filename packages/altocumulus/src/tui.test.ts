import { describe, expect, it } from "vitest";
import { renderFrame, type TuiState } from "./tui.js";

describe("renderFrame", () => {
  it("renders a static frame without raw terminal mode", () => {
    const state: TuiState = {
      snapshot: {
        version: 1,
        scannedAt: "2026-01-01T00:00:00.000Z",
        project: {
          root: "/tmp/demo",
          name: "demo",
          packageManager: "npm",
          workspaces: [],
        },
        summary: {
          packageCount: 1,
          importCount: 1,
          scriptCount: 0,
          envVarCount: 1,
          apiReferenceCount: 1,
          scannedFileCount: 2,
          skippedFileCount: 0,
        },
        packages: [
          {
            source: "package-json",
            name: "@cls/db",
            location: { file: "package.json" },
          },
        ],
        codeUsage: [],
        envVars: [],
        apiReferences: [],
        ignored: [],
      },
      storage: {
        config: {
          version: 1,
          globalStateDir: "/tmp/home/.cumulus/altocumulus",
          updatedAt: "2026-01-01T00:00:00.000Z",
        },
        defaultGlobalStateDir: "/tmp/home/.cumulus/altocumulus",
        defaultConfigPath: "/tmp/home/.cumulus/altocumulus/config.json",
        globalStateDir: "/tmp/home/.cumulus/altocumulus",
        projectRoot: "/tmp/demo",
        projectStateDir: "/tmp/demo/.cumulus/altocumulus",
      },
      registry: {
        version: 1,
        updatedAt: "2026-01-01T00:00:00.000Z",
        projects: [],
      },
      history: {
        version: 1,
        events: [],
      },
      ledger: {
        events: [],
        malformed: [],
      },
    };

    const frame = renderFrame(state, 12, 90, 24);

    expect(frame).toContain("ALTOCUMULUS");
    expect(frame).toContain("Global state:");
    expect(frame).toContain("Project state:");
  });

  it("renders the cache-first dashboard", () => {
    const state: TuiState = {
      snapshot: {
        version: 1,
        scannedAt: "1970-01-01T00:00:00.000Z",
        project: { root: "/tmp/demo", name: null, packageManager: "unknown", workspaces: [] },
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
      },
      storage: {
        config: { version: 1, globalStateDir: "/tmp/home/.cumulus/altocumulus", updatedAt: "2026-01-01T00:00:00.000Z" },
        defaultGlobalStateDir: "/tmp/home/.cumulus/altocumulus",
        defaultConfigPath: "/tmp/home/.cumulus/altocumulus/config.json",
        globalStateDir: "/tmp/home/.cumulus/altocumulus",
        projectRoot: "/tmp/demo",
        projectStateDir: "/tmp/demo/.cumulus/altocumulus",
      },
      registry: { version: 1, updatedAt: "2026-01-01T00:00:00.000Z", projects: [] },
      history: { version: 1, events: [] },
      ledger: { events: [], malformed: [] },
    };

    const frame = renderFrame(state, 0, 100, 28);

    expect(frame).toContain("cache-first dashboard");
    expect(frame).toContain("[scan] run altocumulus scan");
  });
});
