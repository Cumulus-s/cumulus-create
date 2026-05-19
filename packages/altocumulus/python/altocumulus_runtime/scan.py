from __future__ import annotations

import argparse
import json
import os
import re
import signal
import sys
import threading
import time
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable

MAX_TEXT_FILE_BYTES = 1024 * 1024
READ_TIMEOUT_SECONDS = 2.0

IGNORED_DIR_NAMES = {
    ".git",
    ".hg",
    ".svn",
    ".next",
    ".turbo",
    ".vercel",
    ".cache",
    ".claude",
    ".codex",
    ".cumulus",
    ".agent",
    ".deps",
    ".nox",
    ".npm",
    ".pnpm-store",
    ".tox",
    ".tado",
    ".venv",
    ".yarn",
    "coverage",
    "dist",
    "build",
    "env",
    "node_modules",
    "out",
    "pnpm-store",
    "target",
    "temp",
    "tmp",
    "vendor",
    "venv",
    "__pycache__",
}

IGNORED_FILE_NAMES = {
    "package-lock.json",
    "pnpm-lock.yaml",
    "yarn.lock",
    "bun.lockb",
    "Cargo.lock",
}

TEXT_EXTENSIONS = {
    ".cjs",
    ".css",
    ".env",
    ".example",
    ".js",
    ".json",
    ".jsx",
    ".md",
    ".mjs",
    ".py",
    ".rs",
    ".toml",
    ".ts",
    ".tsx",
    ".txt",
    ".yaml",
    ".yml",
}

CUMULUS_NAME_PATTERN = re.compile(
    r"(@cls/[A-Za-z0-9._-]+|@cumulus/[A-Za-z0-9._-]+|@cumulus_cloud/[A-Za-z0-9._-]+|"
    r"@cumulus-create/[A-Za-z0-9._-]+|create-cumulus|cls-knowledge(?:-[A-Za-z0-9._-]+)?|"
    r"cumulus_knowledge)"
)
CUMULUS_CLI_COMMAND_PATTERN = re.compile(r"(?:^|[\s;&|()])cumulus(?:\s|$)")
CUMULUS_KNOWLEDGE_COMMAND_PATTERN = re.compile(r"(?:^|[\s;&|()])cumulus\s+knowledge(?:\s|$)")
IMPORT_SPECIFIER_PATTERN = re.compile(r"""(?:from\s+|import\s*\(\s*|require\(\s*)["']([^"']+)["']""")
SIDE_EFFECT_IMPORT_PATTERN = re.compile(r"""^\s*import\s+["']([^"']+)["']""")
PYTHON_IMPORT_PATTERN = re.compile(r"^\s*(?:from|import)\s+(cumulus_knowledge)\b")
API_REFERENCE_PATTERN = re.compile(r"/v1/[A-Za-z0-9_./{}\[\]-]+|/mcp\b|/openapi\.json\b|/health\b")
ENV_REFERENCE_PATTERN = re.compile(r"\b(?:CUMULUS|RELAY)_[A-Z0-9_]+\b")
ENV_FILE_KEY_PATTERN = re.compile(r"^\s*(?:export\s+)?([A-Z][A-Z0-9_]*)(?:\s*=|$)")


@dataclass
class Counters:
    scanned_files: int = 0
    skipped_files: int = 0
    directories: int = 0


class ProgressReporter:
    def __init__(self, emit: Callable[[str], None] | None, interval: int = 100) -> None:
        self.emit = emit
        self.interval = max(interval, 1)
        self.last_total = 0
        self.last_emit = 0.0

    def start(self, root: Path) -> None:
        self._write(f"altocumulus scan: starting {root}")

    def directory(self, rel: str, counters: Counters) -> None:
        counters.directories += 1
        if counters.directories == 1 or counters.directories % 50 == 0:
            self._write(f"altocumulus scan: walking {rel}")

    def tick(self, rel: str, counters: Counters) -> None:
        total = counters.scanned_files + counters.skipped_files
        if total - self.last_total >= self.interval:
            self.last_total = total
            self._write(
                "altocumulus scan: "
                f"scanned {counters.scanned_files}, skipped {counters.skipped_files}, current {rel}"
            )

    def current_file(self, rel: str, counters: Counters) -> None:
        if time.monotonic() - self.last_emit >= 2:
            self._write(
                "altocumulus scan: "
                f"scanned {counters.scanned_files}, skipped {counters.skipped_files}, current {rel}"
            )

    def done(self, counters: Counters) -> None:
        self._write(
            "altocumulus scan: "
            f"done, scanned {counters.scanned_files}, skipped {counters.skipped_files}"
        )

    def _write(self, message: str) -> None:
        if self.emit:
            self.emit(f"{message}\n")
            self.last_emit = time.monotonic()


def scan_project(
    project_path: str,
    *,
    ignore_paths: list[str] | None = None,
    now: str | None = None,
    progress: Callable[[str], None] | None = None,
    progress_interval: int = 100,
) -> dict[str, Any]:
    root = absolute_path(project_path)
    ignored_paths = normalize_ignored_paths(root, ignore_paths or [])
    reporter = ProgressReporter(progress, progress_interval)
    counters = Counters()
    ignored: list[str] = []
    packages: list[dict[str, Any]] = []
    code_usage: list[dict[str, Any]] = []
    env_vars: list[dict[str, Any]] = []
    api_references: list[dict[str, Any]] = []

    reporter.start(root)
    for file_path in walk_files(root, root, ignored, ignored_paths, counters, reporter):
        rel = to_project_path(root, file_path)
        reporter.current_file(rel, counters)
        try:
            info = file_path.stat()
            if info.st_size > MAX_TEXT_FILE_BYTES or not is_text_like(file_path):
                counters.skipped_files += 1
                ignored.append(rel)
                reporter.tick(rel, counters)
                continue
            text = read_text_with_timeout(file_path)
        except (FileReadTimeout, OSError, UnicodeDecodeError):
            counters.skipped_files += 1
            ignored.append(rel)
            reporter.tick(rel, counters)
            continue

        counters.scanned_files += 1
        name = file_path.name
        if is_env_file_name(name):
            scan_env_names(text, rel, env_vars)
            reporter.tick(rel, counters)
            continue
        if name == "package.json":
            scan_package_json(text, rel, packages, code_usage)
        elif name == "Cargo.toml":
            scan_cargo_toml(text, rel, packages)
        elif name in {"pyproject.toml", "requirements.txt"}:
            scan_python_package_file(text, rel, packages)
        scan_imports_and_references(text, rel, code_usage, api_references)
        scan_env_names(text, rel, env_vars)
        if file_path.suffix == ".md":
            scan_docs(text, rel, code_usage)
        reporter.tick(rel, counters)

    deduped_packages = sort_findings(dedupe_findings(packages))
    deduped_code_usage = sort_findings(dedupe_findings(code_usage))
    deduped_env_vars = sort_findings(dedupe_findings(env_vars))
    deduped_api_references = sort_findings(dedupe_findings(api_references))
    identity = get_project_identity(root)
    reporter.done(counters)

    return {
        "version": 1,
        "scannedAt": now or datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z"),
        "project": identity,
        "summary": {
            "packageCount": unique_finding_count(deduped_packages),
            "importCount": sum(1 for item in deduped_code_usage if item["source"] == "import"),
            "scriptCount": sum(1 for item in deduped_code_usage if item["source"] == "script"),
            "envVarCount": unique_finding_count(deduped_env_vars),
            "apiReferenceCount": unique_finding_count(deduped_api_references),
            "scannedFileCount": counters.scanned_files,
            "skippedFileCount": counters.skipped_files,
        },
        "packages": deduped_packages,
        "codeUsage": deduped_code_usage,
        "envVars": deduped_env_vars,
        "apiReferences": deduped_api_references,
        "ignored": sorted(set(ignored)),
    }


def walk_files(
    root: Path,
    current: Path,
    ignored: list[str],
    ignored_paths: list[Path],
    counters: Counters,
    reporter: ProgressReporter,
):
    rel = to_project_path(root, current)
    reporter.directory(rel, counters)
    try:
        entries = sorted(os.scandir(current), key=lambda item: item.name)
    except OSError:
        counters.skipped_files += 1
        ignored.append(rel)
        reporter.tick(rel, counters)
        return

    for entry in entries:
        path = Path(entry.path)
        item_rel = to_project_path(root, path)
        if is_ignored_path(path, ignored_paths):
            counters.skipped_files += 1
            ignored.append(item_rel)
            reporter.tick(item_rel, counters)
            continue
        try:
            if entry.is_dir(follow_symlinks=False):
                if entry.name in IGNORED_DIR_NAMES:
                    counters.skipped_files += 1
                    ignored.append(item_rel)
                    reporter.tick(item_rel, counters)
                    continue
                yield from walk_files(root, path, ignored, ignored_paths, counters, reporter)
                continue
            if not entry.is_file(follow_symlinks=False):
                continue
        except OSError:
            counters.skipped_files += 1
            ignored.append(item_rel)
            reporter.tick(item_rel, counters)
            continue
        if entry.name in IGNORED_FILE_NAMES:
            counters.skipped_files += 1
            ignored.append(item_rel)
            reporter.tick(item_rel, counters)
            continue
        yield path


def get_project_identity(root: Path) -> dict[str, Any]:
    name: str | None = root.name
    workspaces: list[str] = []
    try:
        parsed = json.loads((root / "package.json").read_text(encoding="utf-8"))
        if isinstance(parsed.get("name"), str) and parsed["name"].strip():
            name = parsed["name"]
        workspaces = parse_workspaces(parsed.get("workspaces"))
    except (OSError, UnicodeDecodeError, json.JSONDecodeError):
        pass
    return {
        "root": str(root),
        "name": name,
        "packageManager": detect_package_manager(root),
        "workspaces": workspaces,
    }


def parse_workspaces(value: Any) -> list[str]:
    if isinstance(value, list):
        return [item for item in value if isinstance(item, str)]
    if isinstance(value, dict) and isinstance(value.get("packages"), list):
        return [item for item in value["packages"] if isinstance(item, str)]
    return []


def detect_package_manager(root: Path) -> str:
    candidates = [
        ("pnpm-lock.yaml", "pnpm"),
        ("yarn.lock", "yarn"),
        ("bun.lockb", "bun"),
        ("package-lock.json", "npm"),
    ]
    for file_name, manager in candidates:
        if (root / file_name).exists():
            return manager
    return "unknown"


def scan_package_json(
    text: str,
    file: str,
    packages: list[dict[str, Any]],
    code_usage: list[dict[str, Any]],
) -> None:
    try:
        parsed = json.loads(text)
    except json.JSONDecodeError:
        return
    if not isinstance(parsed, dict):
        return
    name = parsed.get("name")
    if isinstance(name, str) and is_cumulus_package_name(name):
        packages.append(
            {
                "source": "package-json",
                "name": name,
                "spec": parsed.get("version") if isinstance(parsed.get("version"), str) else "self",
                "location": {"file": file},
            }
        )
    for group_name in ("dependencies", "devDependencies", "peerDependencies", "optionalDependencies"):
        group = parsed.get(group_name)
        if not isinstance(group, dict):
            continue
        for dep_name, spec in group.items():
            if isinstance(dep_name, str) and is_cumulus_package_name(dep_name):
                packages.append(
                    {
                        "source": "package-json",
                        "name": dep_name,
                        "spec": spec if isinstance(spec, str) else str(spec),
                        "location": {"file": file},
                    }
                )
    for workspace in parse_workspaces(parsed.get("workspaces")):
        code_usage.append({"source": "npm-workspace", "name": workspace, "location": {"file": file}})
    scripts = parsed.get("scripts")
    if not isinstance(scripts, dict):
        return
    for script_name, script in scripts.items():
        if not isinstance(script_name, str) or not isinstance(script, str):
            continue
        for match in CUMULUS_NAME_PATTERN.finditer(script):
            code_usage.append(
                {
                    "source": "script",
                    "name": normalize_cumulus_name(match.group(1)),
                    "value": script_name,
                    "location": {"file": file},
                }
            )
        if CUMULUS_KNOWLEDGE_COMMAND_PATTERN.search(script):
            code_usage.append(
                {
                    "source": "script",
                    "name": "cls-knowledge",
                    "value": script_name,
                    "location": {"file": file},
                }
            )
        elif CUMULUS_CLI_COMMAND_PATTERN.search(script):
            code_usage.append(
                {
                    "source": "script",
                    "name": "@cls/cli",
                    "value": script_name,
                    "location": {"file": file},
                }
            )


def scan_cargo_toml(text: str, file: str, packages: list[dict[str, Any]]) -> None:
    for line_number, line in enumerate(text.splitlines(), 1):
        match = re.match(
            r"^\s*((?:[A-Za-z0-9_-]*cumulus|cls-knowledge|cls-nimbus)[A-Za-z0-9_-]*)\s*=",
            line,
            re.IGNORECASE,
        )
        if match:
            packages.append(
                {"source": "cargo", "name": match.group(1), "location": {"file": file, "line": line_number}}
            )


def scan_python_package_file(text: str, file: str, packages: list[dict[str, Any]]) -> None:
    for line_number, line in enumerate(text.splitlines(), 1):
        for match in re.finditer(r"(cls-knowledge|cumulus_knowledge)", line):
            packages.append(
                {"source": "python", "name": match.group(1), "location": {"file": file, "line": line_number}}
            )


def scan_imports_and_references(
    text: str,
    file: str,
    code_usage: list[dict[str, Any]],
    api_references: list[dict[str, Any]],
) -> None:
    for line_number, line in enumerate(text.splitlines(), 1):
        import_specifiers = [
            *IMPORT_SPECIFIER_PATTERN.finditer(line),
            *SIDE_EFFECT_IMPORT_PATTERN.finditer(line),
        ]
        for match in import_specifiers:
            package_name = package_name_from_specifier(match.group(1))
            if package_name and is_cumulus_package_name(package_name):
                code_usage.append(
                    {
                        "source": "import",
                        "name": package_name,
                        "value": match.group(1),
                        "location": {"file": file, "line": line_number},
                    }
                )
        python_import = PYTHON_IMPORT_PATTERN.match(line)
        if python_import:
            code_usage.append(
                {
                    "source": "import",
                    "name": python_import.group(1),
                    "location": {"file": file, "line": line_number},
                }
            )
        for match in API_REFERENCE_PATTERN.finditer(line):
            api_references.append(
                {"source": "api", "name": match.group(0), "location": {"file": file, "line": line_number}}
            )


def scan_env_names(text: str, file: str, env_vars: list[dict[str, Any]]) -> None:
    is_env_file = is_env_file_name(Path(file).name)
    for line_number, line in enumerate(text.splitlines(), 1):
        if is_env_file:
            key = ENV_FILE_KEY_PATTERN.match(line)
            if key and is_cumulus_env_name(key.group(1)):
                env_vars.append({"source": "env", "name": key.group(1), "location": {"file": file, "line": line_number}})
            continue
        for match in ENV_REFERENCE_PATTERN.finditer(line):
            env_vars.append({"source": "env", "name": match.group(0), "location": {"file": file, "line": line_number}})


def scan_docs(text: str, file: str, code_usage: list[dict[str, Any]]) -> None:
    for line_number, line in enumerate(text.splitlines(), 1):
        for match in CUMULUS_NAME_PATTERN.finditer(line):
            code_usage.append(
                {
                    "source": "docs",
                    "name": normalize_cumulus_name(match.group(1)),
                    "location": {"file": file, "line": line_number},
                }
            )


def normalize_cumulus_name(name: str) -> str:
    return name.rstrip(".,;:!?)]}")


def is_cumulus_package_name(name: str) -> bool:
    return (
        name in {"create-cumulus", "@cls/create", "cls-knowledge", "cumulus_knowledge"}
        or name.startswith("@cls/")
        or name.startswith("@cumulus/")
        or name.startswith("@cumulus_cloud/")
        or name.startswith("@cumulus-create/")
    )


def is_cumulus_env_name(name: str) -> bool:
    return name.startswith("CUMULUS_") or name.startswith("RELAY_")


def package_name_from_specifier(specifier: str) -> str | None:
    if specifier.startswith((".", "/", "node:")):
        return None
    parts = specifier.split("/")
    if specifier.startswith("@"):
        return f"{parts[0]}/{parts[1]}" if len(parts) >= 2 else specifier
    return parts[0] if parts else None


def is_text_like(file: Path) -> bool:
    name = file.name
    if is_env_file_name(name):
        return True
    if name in {"AGENTS.md", "README.md"}:
        return True
    return file.suffix in TEXT_EXTENSIONS


class FileReadTimeout(TimeoutError):
    pass


def read_text_with_timeout(file_path: Path) -> str:
    if not hasattr(signal, "SIGALRM") or threading.current_thread() is not threading.main_thread():
        return file_path.read_text(encoding="utf-8")

    def timeout_handler(_signum: int, _frame: Any) -> None:
        raise FileReadTimeout(str(file_path))

    previous_handler = signal.getsignal(signal.SIGALRM)
    signal.signal(signal.SIGALRM, timeout_handler)
    signal.siginterrupt(signal.SIGALRM, True)
    signal.setitimer(signal.ITIMER_REAL, READ_TIMEOUT_SECONDS)
    try:
        return file_path.read_text(encoding="utf-8")
    finally:
        signal.setitimer(signal.ITIMER_REAL, 0)
        signal.signal(signal.SIGALRM, previous_handler)


def is_env_file_name(name: str) -> bool:
    return name == ".env" or name.startswith(".env.") or name.endswith(".env") or ".env." in name


def to_project_path(root: Path, file: Path) -> str:
    try:
        rel = file.relative_to(root)
    except ValueError:
        return str(file)
    rel_text = rel.as_posix()
    return rel_text or "."


def normalize_ignored_paths(root: Path, paths: list[str]) -> list[Path]:
    out: list[Path] = []
    seen: set[str] = set()
    for raw_path in paths:
        path = Path(raw_path).expanduser()
        resolved = absolute_path(path) if path.is_absolute() else absolute_path(path, root)
        key = str(resolved)
        if key in seen or resolved == root or not is_path_inside(root, resolved):
            continue
        seen.add(key)
        out.append(resolved)
    return out


def is_ignored_path(path: Path, ignored_paths: list[Path]) -> bool:
    resolved = absolute_path(path)
    return any(resolved == ignored_path or is_path_inside(ignored_path, resolved) for ignored_path in ignored_paths)


def is_path_inside(parent: Path, child: Path) -> bool:
    try:
        child.relative_to(parent)
        return child != parent
    except ValueError:
        return False


def absolute_path(path: str | Path, base: Path | None = None) -> Path:
    raw_path = Path(path).expanduser()
    if raw_path.is_absolute():
        return Path(os.path.abspath(raw_path))
    return Path(os.path.abspath((base or Path.cwd()) / raw_path))


def dedupe_findings(findings: list[dict[str, Any]]) -> list[dict[str, Any]]:
    seen: set[tuple[Any, ...]] = set()
    out: list[dict[str, Any]] = []
    for item in findings:
        location = item.get("location", {})
        key = (
            item.get("source"),
            item.get("name"),
            item.get("value", ""),
            item.get("spec", ""),
            location.get("file"),
            location.get("line", ""),
        )
        if key in seen:
            continue
        seen.add(key)
        out.append(item)
    return out


def unique_finding_count(findings: list[dict[str, Any]]) -> int:
    return len({item["name"] for item in findings})


def sort_findings(findings: list[dict[str, Any]]) -> list[dict[str, Any]]:
    return sorted(
        findings,
        key=lambda item: (
            item.get("location", {}).get("file", ""),
            item.get("location", {}).get("line", 0),
            item.get("name", ""),
        ),
    )


def parse_args(argv: list[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Altocumulus Python scanner")
    parser.add_argument("path")
    parser.add_argument("--ignore-path", action="append", default=[])
    parser.add_argument("--now")
    parser.add_argument("--progress-interval", type=int, default=100)
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv or sys.argv[1:])
    snapshot = scan_project(
        args.path,
        ignore_paths=args.ignore_path,
        now=args.now,
        progress=sys.stderr.write,
        progress_interval=args.progress_interval,
    )
    json.dump(snapshot, sys.stdout, indent=2)
    sys.stdout.write("\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
