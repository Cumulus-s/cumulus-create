import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

const root = process.cwd();

const expectedPackages = [
  ["packages/create-cumulus/package.json", "@cmls/create", "MIT"],
  ["packages/events/package.json", "@cmls/events", "MIT"],
  ["packages/cloud-client/package.json", "@cmls/cloud", "MIT"],
  ["packages/auth-sdk/package.json", "@cmls/auth", "Apache-2.0"],
  ["packages/db-sdk/package.json", "@cmls/db", "Apache-2.0"],
  ["packages/sdk/package.json", "@cmls/sdk", "Apache-2.0"],
  ["packages/nimbus/package.json", "@cmls/nimbus", "AGPL-3.0-only"],
  ["apps/cumulus-db/package.json", "@cmls/cumulus-db", "AGPL-3.0-only"],
  ["packages/knowledge-sdk/package.json", "@cmls/knowledge", "AGPL-3.0-only"],
  ["packages/mcp/package.json", "@cmls/mcp", "MIT"],
  ["packages/server/package.json", "@cmls/server", "MIT"],
  ["packages/cli/package.json", "@cmls/cli", "MIT"],
  ["packages/track-sdk/package.json", "@cmls/track", "MIT"],
  ["packages/altocumulus/package.json", "@cmls/altocumulus", "MIT"],
];

const failures = [];

for (const [path, expectedName, expectedLicense] of expectedPackages) {
  const json = JSON.parse(await readFile(join(root, path), "utf8"));
  if (json.name !== expectedName) {
    failures.push(`${path}: expected name ${expectedName}, found ${json.name}`);
  }
  if (json.license !== expectedLicense) {
    failures.push(
      `${path}: expected license ${expectedLicense}, found ${json.license}`,
    );
  }
}

const licenseTextChecks = [
  ["packages/auth-sdk/LICENSE", "Apache License"],
  ["packages/db-sdk/LICENSE", "Apache License"],
  ["packages/sdk/LICENSE", "Apache License"],
  ["packages/nimbus/LICENSE", "GNU AFFERO GENERAL PUBLIC LICENSE"],
  ["apps/cumulus-db/LICENSE", "GNU AFFERO GENERAL PUBLIC LICENSE"],
  ["packages/create-cumulus/LICENSE", "MIT License"],
];

for (const [path, expectedText] of licenseTextChecks) {
  const text = await readFile(join(root, path), "utf8");
  if (!text.includes(expectedText)) {
    failures.push(`${path}: missing ${expectedText}`);
  }
}

async function walk(dir) {
  const entries = await readdir(join(root, dir), { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const rel = `${dir}/${entry.name}`;
    if (entry.isDirectory()) {
      if (entry.name === "dist" || entry.name === "node_modules") continue;
      files.push(...(await walk(rel)));
    } else if (entry.isFile()) {
      files.push(rel);
    }
  }
  return files;
}

for (const packagePath of [
  "packages/auth-sdk",
  "packages/db-sdk",
  "packages/sdk",
]) {
  const pkg = JSON.parse(await readFile(join(root, packagePath, "package.json"), "utf8"));
  const deps = {
    ...pkg.dependencies,
    ...pkg.peerDependencies,
    ...pkg.optionalDependencies,
  };
  for (const forbidden of ["@cmls/cumulus-db", "@cmls/nimbus"]) {
    if (deps[forbidden]) {
      failures.push(`${packagePath}/package.json: Apache package must not depend on AGPL ${forbidden}`);
    }
  }

  for (const file of await walk(`${packagePath}/src`)) {
    if (!/\.[cm]?[tj]sx?$/.test(file)) continue;
    const text = await readFile(join(root, file), "utf8");
    if (/(from\s+|import\()(["'])(@cmls\/cumulus-db|@cumulus\/database|.*apps\/cumulus-db|.*cumulus-db\/src)/.test(text)) {
      failures.push(`${file}: Apache package must not import Cumulus DB provider internals`);
    }
  }
}

for (const [path] of expectedPackages) {
  const pkg = JSON.parse(await readFile(join(root, path), "utf8"));
  const deps = {
    ...pkg.dependencies,
    ...pkg.peerDependencies,
    ...pkg.optionalDependencies,
  };
  for (const depName of Object.keys(deps)) {
    if (depName.startsWith("@cumulus_cloud/") || /^@cumulus\/(auth|db|sdk|nimbus|database)$/.test(depName)) {
      failures.push(`${path}: dependency ${depName} must use the @cmls namespace`);
    }
  }
}

for (const srcRoot of [
  "apps/cumulus-db/src",
  "packages/create-cumulus/templates/cumulus-db/apps/cumulus-db/src",
]) {
  for (const file of await walk(srcRoot)) {
    if (!file.endsWith(".ts")) continue;
    const firstLine = (await readFile(join(root, file), "utf8")).split("\n")[0];
    if (firstLine !== "// SPDX-License-Identifier: AGPL-3.0-only") {
      failures.push(`${file}: missing AGPL SPDX header`);
    }
  }
}

for (const requiredTemplateFile of [
  "packages/create-cumulus/templates/cumulus-db/apps/cumulus-db/src/nimbus.ts",
  "packages/create-cumulus/templates/cumulus-db/apps/cumulus-db/src/system.ts",
  "packages/create-cumulus/templates/cumulus-db/apps/cumulus-db/openapi/system-v1.openapi.json",
  "packages/create-cumulus/templates/cumulus-db/apps/cumulus-db/schemas/nimbus-ir-v1alpha1.schema.json",
  "packages/create-cumulus/templates/cumulus-db/apps/cumulus-db/postgres/data-v1.sql",
  "packages/create-cumulus/templates/cumulus-db/apps/cumulus-db/postgres/system-v1.sql",
]) {
  await readFile(join(root, requiredTemplateFile), "utf8").catch(() => {
    failures.push(`${requiredTemplateFile}: missing from generated Cumulus DB template`);
  });
}

if (failures.length > 0) {
  console.error("License check failed:");
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  process.exit(1);
}

console.log("License check passed.");
