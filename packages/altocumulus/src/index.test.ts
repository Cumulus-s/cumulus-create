import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import { runCli } from "./index.js";
import { setGlobalStateDir, setProjectStateDir } from "./storage.js";

async function tempProject(name = "cli-demo") {
  const root = await mkdtemp(join(tmpdir(), "altocumulus-cli-"));
  await writeFile(
    join(root, "package.json"),
    JSON.stringify({ name, dependencies: { "@cmls/track": "^0.2.0" } }),
  );
  return root;
}

function io(cwd: string, home: string, extraEnv: NodeJS.ProcessEnv = {}) {
  let out = "";
  let err = "";
  return {
    api: {
      cwd,
      env: { ...process.env, CUMULUS_ALTOCUMULUS_HOME: home, ...extraEnv },
      stdout: { write: (chunk: string) => void (out += chunk) },
      stderr: { write: (chunk: string) => void (err += chunk) },
      stdin: process.stdin,
    },
    output: () => out,
    error: () => err,
  };
}

describe("runCli", () => {
  it("prints JSON for altocumulus scan --json", async () => {
    const root = await tempProject();
    const home = await mkdtemp(join(tmpdir(), "altocumulus-cli-home-"));
    const testIo = io(root, home);

    const code = await runCli(["scan", ".", "--json"], testIo.api);
    const parsed = JSON.parse(testIo.output()) as {
      ok: boolean;
      snapshot: { project: { name: string }; packages: Array<{ name: string }> };
    };

    expect(code).toBe(0);
    expect(parsed.ok).toBe(true);
    expect(parsed.snapshot.project.name).toBe("cli-demo");
    expect(parsed.snapshot.packages[0].name).toBe("@cmls/track");
    expect(testIo.error()).toContain("altocumulus scan: starting ");
    expect(testIo.error()).toContain("altocumulus scan: done");
  });

  it("prints JSON for an explicit scan path", async () => {
    const cwdProject = await tempProject("cwd-demo");
    const targetProject = await tempProject("scan-target-demo");
    const home = await mkdtemp(join(tmpdir(), "altocumulus-cli-home-"));
    const testIo = io(cwdProject, home);

    const code = await runCli(["scan", targetProject, "--json"], testIo.api);
    const parsed = JSON.parse(testIo.output()) as {
      snapshot: { project: { name: string; root: string } };
    };

    expect(code).toBe(0);
    expect(parsed.snapshot.project.name).toBe("scan-target-demo");
    expect(parsed.snapshot.project.root).toBe(targetProject);
    expect(testIo.error()).toContain("altocumulus scan: starting ");
  });

  it("renders one TUI frame in smoke mode", async () => {
    const root = await tempProject();
    const home = await mkdtemp(join(tmpdir(), "altocumulus-cli-home-"));
    const testIo = io(root, home);

    const code = await runCli(["--smoke", "."], testIo.api);

    expect(code).toBe(0);
    expect(testIo.output()).toContain("ALTOCUMULUS");
    expect(testIo.output()).toContain("Dashboard");
    expect(testIo.error()).toBe("");
  });

  it("uses the path after --smoke as the cached TUI target without scanning", async () => {
    const cwdProject = await tempProject("cwd-demo");
    const targetProject = await tempProject("smoke-target-demo");
    const home = await mkdtemp(join(tmpdir(), "altocumulus-cli-home-"));
    const testIo = io(cwdProject, home);

    const code = await runCli(["--smoke", targetProject], testIo.api);

    expect(code).toBe(0);
    expect(testIo.output()).toContain(targetProject);
    expect(testIo.output()).not.toContain("cwd-demo");
    expect(testIo.error()).toBe("");
  });

  it("does not scan configured global or project state folders", async () => {
    const root = await tempProject("configured-storage-demo");
    const home = await mkdtemp(join(tmpdir(), "altocumulus-cli-home-"));
    const globalState = join(root, "altocumulus-global-state");
    const projectState = join(root, "altocumulus-project-state");
    await mkdir(globalState, { recursive: true });
    await mkdir(projectState, { recursive: true });
    await writeFile(join(globalState, "leak.ts"), "import '@cumulus/global-state-leak';");
    await writeFile(join(projectState, "leak.ts"), "import '@cumulus/project-state-leak';");
    await setGlobalStateDir(globalState, { homeDir: home });
    await setProjectStateDir(root, projectState, { homeDir: home });
    const testIo = io(root, home);

    const code = await runCli(["scan", ".", "--json"], testIo.api);
    const parsed = JSON.parse(testIo.output()) as {
      snapshot: { ignored: string[] };
    };
    const serialized = JSON.stringify(parsed.snapshot);

    expect(code).toBe(0);
    expect(parsed.snapshot.ignored).toEqual(expect.arrayContaining(["altocumulus-global-state", "altocumulus-project-state"]));
    expect(serialized).not.toContain("@cumulus/global-state-leak");
    expect(serialized).not.toContain("@cumulus/project-state-leak");
    expect(testIo.error()).toContain("altocumulus scan: done");
  });

  it("uses CUMULUS_ALTOCUMULUS_HOME for tilde storage paths in injected environments", async () => {
    const root = await tempProject();
    const home = await mkdtemp(join(tmpdir(), "altocumulus-cli-home-"));
    const testIo = io(root, home);

    const code = await runCli(["config", "set", "global-state", "~/custom-altocumulus"], testIo.api);

    expect(code).toBe(0);
    expect(testIo.output()).toContain(join(home, "custom-altocumulus"));
  });

  it("prints a clear error when the configured Python executable is missing", async () => {
    const root = await tempProject();
    const home = await mkdtemp(join(tmpdir(), "altocumulus-cli-home-"));
    const testIo = io(root, home, { ALTOCUMULUS_PYTHON: join(root, "missing-python") });

    const code = await runCli(["scan", ".", "--json"], testIo.api);

    expect(code).toBe(1);
    expect(testIo.output()).toBe("");
    expect(testIo.error()).toContain("Unable to run ALTOCUMULUS_PYTHON");
    expect(testIo.error()).toContain("Python 3 executable");
  });
});
