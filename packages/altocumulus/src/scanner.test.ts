import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import { scanProject } from "./scanner.js";

async function tempProject() {
  return mkdtemp(join(tmpdir(), "altocumulus-scan-"));
}

describe("scanProject", () => {
  it("detects Cumulus packages, imports, scripts, and API paths", async () => {
    const root = await tempProject();
    await writeFile(
      join(root, "package.json"),
      JSON.stringify(
        {
          name: "demo",
          workspaces: ["apps/*"],
          dependencies: {
            "@cumulus/db": "^0.1.0",
            "create-cumulus": "^0.3.1",
          },
          scripts: {
            index: "cumulus knowledge index .",
          },
        },
        null,
        2,
      ),
    );
    await mkdir(join(root, "src"));
    await writeFile(
      join(root, "src", "index.ts"),
      [
        "import { CumulusDbClient } from '@cumulus/db';",
        "const path = '/v1/signups';",
      ].join("\n"),
    );

    const snapshot = await scanProject(root, { now: new Date("2026-01-01T00:00:00.000Z") });

    expect(snapshot.project.name).toBe("demo");
    expect(snapshot.project.workspaces).toEqual(["apps/*"]);
    expect(snapshot.packages.map((item) => item.name)).toEqual([
      "@cumulus/db",
      "create-cumulus",
    ]);
    expect(snapshot.codeUsage.some((item) => item.source === "import" && item.name === "@cumulus/db")).toBe(true);
    expect(snapshot.codeUsage.some((item) => item.source === "script" && item.name === "cumulus-knowledge")).toBe(true);
    expect(snapshot.apiReferences.some((item) => item.name === "/v1/signups")).toBe(true);
  });

  it("records Cumulus package names for workspace packages themselves", async () => {
    const root = await tempProject();
    await mkdir(join(root, "packages", "altocumulus"), { recursive: true });
    await writeFile(
      join(root, "packages", "altocumulus", "package.json"),
      JSON.stringify({ name: "@cumulus_cloud/altocumulus", version: "0.1.0" }),
    );

    const snapshot = await scanProject(root);

    expect(snapshot.packages).toContainEqual({
      source: "package-json",
      name: "@cumulus_cloud/altocumulus",
      spec: "0.1.0",
      location: { file: "packages/altocumulus/package.json" },
    });
  });

  it("does not mistake create-cumulus scripts for the cumulus CLI", async () => {
    const root = await tempProject();
    await writeFile(
      join(root, "package.json"),
      JSON.stringify({
        name: "script-demo",
        scripts: {
          create: "npx create-cumulus@latest demo",
          status: "cumulus status",
        },
      }),
    );

    const snapshot = await scanProject(root);

    expect(
      snapshot.codeUsage.some(
        (item) => item.source === "script" && item.name === "@cumulus_cloud/cli" && item.value === "create",
      ),
    ).toBe(false);
    expect(
      snapshot.codeUsage.some(
        (item) => item.source === "script" && item.name === "@cumulus_cloud/cli" && item.value === "status",
      ),
    ).toBe(true);
  });

  it("records env var names but never .env values", async () => {
    const root = await tempProject();
    await writeFile(join(root, "package.json"), JSON.stringify({ name: "env-demo" }));
    await writeFile(
      join(root, ".env"),
      ["CUMULUS_DB_TOKEN=secret-token", "RELAY_BASE_URL=https://relay.example", "UNRELATED=value"].join("\n"),
    );

    const snapshot = await scanProject(root);
    const serialized = JSON.stringify(snapshot);

    expect(snapshot.envVars.map((item) => item.name).sort()).toEqual([
      "CUMULUS_DB_TOKEN",
      "RELAY_BASE_URL",
    ]);
    expect(serialized).not.toContain("secret-token");
    expect(serialized).not.toContain("https://relay.example");
  });

  it("does not scan .env values for API references", async () => {
    const root = await tempProject();
    await writeFile(join(root, "package.json"), JSON.stringify({ name: "env-api-demo" }));
    await writeFile(
      join(root, ".env.local"),
      [
        "CUMULUS_DB_TOKEN=/v1/private-token",
        "RELAY_BASE_URL=https://relay.example/v1/private",
      ].join("\n"),
    );

    const snapshot = await scanProject(root);
    const serialized = JSON.stringify(snapshot);

    expect(snapshot.envVars.map((item) => item.name).sort()).toEqual([
      "CUMULUS_DB_TOKEN",
      "RELAY_BASE_URL",
    ]);
    expect(snapshot.apiReferences).toEqual([]);
    expect(serialized).not.toContain("/v1/private-token");
    expect(serialized).not.toContain("/v1/private");
  });

  it("ignores explicit state paths under the scanned project", async () => {
    const root = await tempProject();
    await writeFile(join(root, "package.json"), JSON.stringify({ name: "state-ignore-demo" }));
    await mkdir(join(root, "altocumulus-global-state"), { recursive: true });
    await writeFile(join(root, "altocumulus-global-state", "leak.ts"), "import '@cumulus/global-leak';");
    await mkdir(join(root, "altocumulus-project-state"), { recursive: true });
    await writeFile(join(root, "altocumulus-project-state", "leak.ts"), "import '@cumulus/project-leak';");

    const snapshot = await scanProject(root, {
      ignorePaths: ["altocumulus-global-state", join(root, "altocumulus-project-state")],
    });
    const serialized = JSON.stringify(snapshot);

    expect(snapshot.ignored).toEqual(expect.arrayContaining(["altocumulus-global-state", "altocumulus-project-state"]));
    expect(serialized).not.toContain("@cumulus/global-leak");
    expect(serialized).not.toContain("@cumulus/project-leak");
  });

  it("ignores generated and dependency directories", async () => {
    const root = await tempProject();
    await writeFile(join(root, "package.json"), JSON.stringify({ name: "ignore-demo" }));
    for (const folder of ["node_modules", "dist", "target", ".deps", ".pnpm-store", ".yarn", "out", "vendor", ".venv"]) {
      await mkdir(join(root, folder), { recursive: true });
      await writeFile(join(root, folder, "leak.ts"), "import '@cumulus_cloud/track';");
    }

    const snapshot = await scanProject(root);

    expect(snapshot.ignored).toContain("node_modules");
    expect(snapshot.ignored).toContain("dist");
    expect(snapshot.ignored).toContain("target");
    expect(snapshot.ignored).toContain(".deps");
    expect(snapshot.ignored).toContain(".pnpm-store");
    expect(snapshot.ignored).toContain("out");
    expect(snapshot.ignored).toContain("vendor");
    expect(snapshot.codeUsage.some((item) => item.location.file.includes("node_modules"))).toBe(false);
    expect(snapshot.codeUsage.some((item) => item.location.file.includes("dist"))).toBe(false);
    expect(snapshot.codeUsage.some((item) => item.location.file.includes("vendor"))).toBe(false);
  });

  it("detects Rust and Python Cumulus package references", async () => {
    const root = await tempProject();
    await writeFile(join(root, "Cargo.toml"), '[dependencies]\ncumulus-knowledge-core = "0.1"\n');
    await writeFile(join(root, "pyproject.toml"), 'dependencies = ["cumulus-knowledge"]\n');
    await writeFile(join(root, "worker.py"), "from cumulus_knowledge import CumulusKnowledge\n");

    const snapshot = await scanProject(root);
    const packageNames = snapshot.packages.map((item) => item.name);

    expect(packageNames).toContain("cumulus-knowledge-core");
    expect(packageNames).toContain("cumulus-knowledge");
    expect(snapshot.codeUsage.some((item) => item.name === "cumulus_knowledge")).toBe(true);
  });
});
