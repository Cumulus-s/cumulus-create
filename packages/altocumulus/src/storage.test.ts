import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import { scanProject } from "./scanner.js";
import {
  defaultGlobalStateDir,
  defaultProjectStateDir,
  homeDirFromEnv,
  loadProjectRegistry,
  resolveStorage,
  saveScanSnapshot,
  setGlobalStateDir,
  setProjectStateDir,
} from "./storage.js";

async function tempRoot(prefix: string) {
  return mkdtemp(join(tmpdir(), prefix));
}

describe("storage", () => {
  it("resolves relative CUMULUS_ALTOCUMULUS_HOME from the provided cwd", async () => {
    const cwd = await tempRoot("altocumulus-cwd-");

    expect(homeDirFromEnv({ CUMULUS_ALTOCUMULUS_HOME: "local-home" }, cwd)).toBe(join(cwd, "local-home"));
  });

  it("uses default global and project stores", async () => {
    const home = await tempRoot("altocumulus-home-");
    const project = await tempRoot("altocumulus-project-");

    const storage = await resolveStorage(project, { homeDir: home });

    expect(storage.globalStateDir).toBe(defaultGlobalStateDir(home));
    expect(storage.projectStateDir).toBe(defaultProjectStateDir(project));
  });

  it("persists global and project storage overrides", async () => {
    const home = await tempRoot("altocumulus-home-");
    const project = await tempRoot("altocumulus-project-");
    const customGlobal = await tempRoot("altocumulus-global-");
    const customProject = await tempRoot("altocumulus-project-state-");

    await setGlobalStateDir(customGlobal, { homeDir: home });
    await setProjectStateDir(project, customProject, { homeDir: home });
    const storage = await resolveStorage(project, { homeDir: home });

    expect(storage.globalStateDir).toBe(customGlobal);
    expect(storage.projectStateDir).toBe(customProject);
  });

  it("rejects using the project root as the project state directory", async () => {
    const home = await tempRoot("altocumulus-home-");
    const project = await tempRoot("altocumulus-project-");

    await expect(setProjectStateDir(project, project, { homeDir: home })).rejects.toThrow(
      "Project state directory must not be the project root.",
    );
  });

  it("falls back when local storage JSON has an invalid shape", async () => {
    const home = await tempRoot("altocumulus-home-");
    const project = await tempRoot("altocumulus-project-");
    const globalState = defaultGlobalStateDir(home);
    await mkdir(globalState, { recursive: true });
    await writeFile(join(globalState, "config.json"), JSON.stringify({ globalStateDir: 42 }));
    await writeFile(join(globalState, "projects.json"), JSON.stringify({ projects: { root: project } }));

    const storage = await resolveStorage(project, { homeDir: home });
    const registry = await loadProjectRegistry(globalState);

    expect(storage.globalStateDir).toBe(globalState);
    expect(registry.projects).toEqual([]);
  });

  it("writes latest scan, history, and registry", async () => {
    const home = await tempRoot("altocumulus-home-");
    const project = await tempRoot("altocumulus-project-");
    await writeFile(join(project, "package.json"), JSON.stringify({ name: "stored-demo" }));

    const snapshot = await scanProject(project);
    const storage = await saveScanSnapshot(snapshot, { homeDir: home });
    const registry = await loadProjectRegistry(storage.globalStateDir);
    const latest = JSON.parse(await readFile(join(storage.projectStateDir, "latest-scan.json"), "utf8")) as {
      project: { name: string };
    };
    const history = JSON.parse(await readFile(join(storage.projectStateDir, "history.json"), "utf8")) as {
      events: unknown[];
    };

    expect(latest.project.name).toBe("stored-demo");
    expect(history.events.length).toBe(1);
    expect(registry.projects[0].root).toBe(project);
  });
});
