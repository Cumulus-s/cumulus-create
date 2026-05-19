import { spawn } from "node:child_process";
import { dirname, delimiter, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { ScanSnapshot } from "./types.js";

export interface ScanOptions {
  env?: NodeJS.ProcessEnv;
  ignorePaths?: string[];
  now?: Date;
  progress?: Pick<NodeJS.WriteStream, "write">;
}

interface PythonScanResult {
  snapshot: ScanSnapshot;
  stderr: string;
}

class PythonLaunchError extends Error {
  constructor(
    message: string,
    readonly executable: string,
    readonly missing: boolean,
  ) {
    super(message);
  }
}

export async function scanProject(projectPath: string, options: ScanOptions = {}): Promise<ScanSnapshot> {
  const env = options.env ?? process.env;
  const explicitPython = env.ALTOCUMULUS_PYTHON;
  const candidates = explicitPython ? [explicitPython] : ["python3", "python"];
  const missingCandidates: string[] = [];

  for (const candidate of candidates) {
    try {
      const result = await runPythonScanner(candidate, projectPath, options, env);
      return result.snapshot;
    } catch (error) {
      if (error instanceof PythonLaunchError && error.missing && !explicitPython) {
        missingCandidates.push(error.executable);
        continue;
      }
      throw error;
    }
  }

  throw new Error(
    `Altocumulus requires Python 3 for scanning. Tried ${missingCandidates.join(
      ", ",
    )}. Install Python 3 or set ALTOCUMULUS_PYTHON to a Python 3 executable.`,
  );
}

async function runPythonScanner(
  executable: string,
  projectPath: string,
  options: ScanOptions,
  env: NodeJS.ProcessEnv,
): Promise<PythonScanResult> {
  const runtimeRoot = resolve(packageRoot(), "python");
  const childEnv = {
    ...env,
    PYTHONPATH: env.PYTHONPATH ? `${runtimeRoot}${delimiter}${env.PYTHONPATH}` : runtimeRoot,
  };
  const args = ["-m", "altocumulus_runtime.scan", resolve(projectPath)];
  for (const ignorePath of options.ignorePaths ?? []) {
    args.push("--ignore-path", ignorePath);
  }
  if (options.now) {
    args.push("--now", options.now.toISOString());
  }

  return new Promise<PythonScanResult>((resolvePromise, reject) => {
    const child = spawn(executable, args, {
      env: childEnv,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];
    let settled = false;

    child.stdout.on("data", (chunk: Buffer) => {
      stdoutChunks.push(chunk);
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderrChunks.push(chunk);
      options.progress?.write(chunk.toString("utf8"));
    });
    child.on("error", (error: NodeJS.ErrnoException) => {
      if (settled) return;
      settled = true;
      reject(
        new PythonLaunchError(
          pythonErrorMessage(executable, error, Boolean(env.ALTOCUMULUS_PYTHON)),
          executable,
          error.code === "ENOENT",
        ),
      );
    });
    child.on("close", (code) => {
      if (settled) return;
      settled = true;
      const stdout = Buffer.concat(stdoutChunks).toString("utf8");
      const stderr = Buffer.concat(stderrChunks).toString("utf8");
      if (code !== 0) {
        reject(
          new PythonLaunchError(
            `Altocumulus Python scanner failed with exit code ${code ?? "unknown"} using ${executable}.${
              stderr ? `\n${stderr.trimEnd()}` : ""
            }`,
            executable,
            false,
          ),
        );
        return;
      }
      try {
        resolvePromise({ snapshot: JSON.parse(stdout) as ScanSnapshot, stderr });
      } catch (error) {
        reject(
          new Error(
            `Altocumulus Python scanner returned invalid JSON.${stderr ? `\n${stderr.trimEnd()}` : ""}${
              error instanceof Error ? `\n${error.message}` : ""
            }`,
          ),
        );
      }
    });
  });
}

function packageRoot(): string {
  return resolve(dirname(fileURLToPath(import.meta.url)), "..");
}

function pythonErrorMessage(executable: string, error: NodeJS.ErrnoException, explicitPython: boolean): string {
  if (error.code === "ENOENT") {
    if (explicitPython) {
      return `Unable to run ALTOCUMULUS_PYTHON at ${executable}. Set it to a Python 3 executable.`;
    }
    return `Unable to run ${executable}. Altocumulus requires Python 3 for scanning.`;
  }
  return `Unable to start Altocumulus Python scanner with ${executable}: ${error.message}`;
}
