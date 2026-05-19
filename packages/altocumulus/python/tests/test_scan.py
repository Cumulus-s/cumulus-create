import json
import os
import subprocess
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from altocumulus_runtime import scan as scan_module
from altocumulus_runtime.scan import FileReadTimeout, scan_project


def test_detects_packages_imports_scripts_docs_and_api_paths(tmp_path: Path) -> None:
    (tmp_path / "package.json").write_text(
        json.dumps(
            {
                "name": "demo",
                "workspaces": ["apps/*"],
                "dependencies": {
                    "@cumulus/db": "^0.1.0",
                    "create-cumulus": "^0.3.1",
                },
                "scripts": {"index": "cumulus knowledge index ."},
            }
        )
    )
    src = tmp_path / "src"
    src.mkdir()
    (src / "index.ts").write_text(
        "\n".join(
            [
                "import { CumulusDbClient } from '@cumulus/db';",
                "const path = '/v1/signups';",
            ]
        )
    )
    (tmp_path / "README.md").write_text("Use @cumulus/db with create-cumulus.\n")

    snapshot = scan_project(str(tmp_path), now="2026-01-01T00:00:00.000Z")

    assert snapshot["project"]["name"] == "demo"
    assert snapshot["project"]["workspaces"] == ["apps/*"]
    assert [item["name"] for item in snapshot["packages"]] == ["@cumulus/db", "create-cumulus"]
    assert any(item["source"] == "import" and item["name"] == "@cumulus/db" for item in snapshot["codeUsage"])
    assert any(item["source"] == "script" and item["name"] == "cumulus-knowledge" for item in snapshot["codeUsage"])
    assert any(item["source"] == "docs" and item["name"] == "create-cumulus" for item in snapshot["codeUsage"])
    assert any(item["name"] == "/v1/signups" for item in snapshot["apiReferences"])


def test_records_env_names_without_env_values(tmp_path: Path) -> None:
    (tmp_path / "package.json").write_text(json.dumps({"name": "env-demo"}))
    (tmp_path / ".env.local").write_text(
        "\n".join(
            [
                "CUMULUS_DB_TOKEN=secret-token",
                "RELAY_BASE_URL=https://relay.example/v1/private",
                "UNRELATED=value",
            ]
        )
    )

    snapshot = scan_project(str(tmp_path))
    serialized = json.dumps(snapshot)

    assert sorted(item["name"] for item in snapshot["envVars"]) == ["CUMULUS_DB_TOKEN", "RELAY_BASE_URL"]
    assert snapshot["apiReferences"] == []
    assert "secret-token" not in serialized
    assert "https://relay.example" not in serialized
    assert "/v1/private" not in serialized


def test_ignores_generated_directories_and_explicit_state_paths(tmp_path: Path) -> None:
    (tmp_path / "package.json").write_text(json.dumps({"name": "ignore-demo"}))
    for folder in [
        "node_modules",
        "dist",
        "target",
        ".agent",
        ".claude",
        ".codex",
        ".cumulus",
        ".deps",
        ".pnpm-store",
        ".yarn",
        "out",
        "vendor",
        ".venv",
        ".tado",
    ]:
        leak_dir = tmp_path / folder
        leak_dir.mkdir(parents=True)
        (leak_dir / "leak.ts").write_text("import '@cumulus_cloud/leak';\n")
    global_state = tmp_path / "altocumulus-global-state"
    project_state = tmp_path / "altocumulus-project-state"
    global_state.mkdir()
    project_state.mkdir()
    (global_state / "leak.ts").write_text("import '@cumulus/global-leak';\n")
    (project_state / "leak.ts").write_text("import '@cumulus/project-leak';\n")

    snapshot = scan_project(
        str(tmp_path),
        ignore_paths=["altocumulus-global-state", str(project_state)],
    )
    serialized = json.dumps(snapshot)

    assert "node_modules" in snapshot["ignored"]
    assert "dist" in snapshot["ignored"]
    assert "target" in snapshot["ignored"]
    assert ".deps" in snapshot["ignored"]
    assert ".pnpm-store" in snapshot["ignored"]
    assert "out" in snapshot["ignored"]
    assert "vendor" in snapshot["ignored"]
    assert "altocumulus-global-state" in snapshot["ignored"]
    assert "altocumulus-project-state" in snapshot["ignored"]
    assert "@cumulus_cloud/leak" not in serialized
    assert "@cumulus/global-leak" not in serialized
    assert "@cumulus/project-leak" not in serialized


def test_detects_rust_and_python_references(tmp_path: Path) -> None:
    (tmp_path / "Cargo.toml").write_text('[dependencies]\ncumulus-knowledge-core = "0.1"\n')
    (tmp_path / "pyproject.toml").write_text('dependencies = ["cumulus-knowledge"]\n')
    (tmp_path / "worker.py").write_text("from cumulus_knowledge import CumulusKnowledge\n")

    snapshot = scan_project(str(tmp_path))
    package_names = [item["name"] for item in snapshot["packages"]]

    assert "cumulus-knowledge-core" in package_names
    assert "cumulus-knowledge" in package_names
    assert any(item["source"] == "import" and item["name"] == "cumulus_knowledge" for item in snapshot["codeUsage"])


def test_skips_files_that_timeout_while_reading(tmp_path: Path, monkeypatch) -> None:
    (tmp_path / "package.json").write_text(json.dumps({"name": "timeout-demo"}))
    (tmp_path / "stuck.md").write_text("@cumulus/db\n")
    original_read = scan_module.read_text_with_timeout

    def fake_read(path: Path) -> str:
        if path.name == "stuck.md":
            raise FileReadTimeout(str(path))
        return original_read(path)

    monkeypatch.setattr(scan_module, "read_text_with_timeout", fake_read)

    snapshot = scan_project(str(tmp_path))
    serialized = json.dumps(snapshot)

    assert "stuck.md" in snapshot["ignored"]
    assert "@cumulus/db" not in serialized


def test_cli_emits_json_to_stdout_and_progress_to_stderr(tmp_path: Path) -> None:
    (tmp_path / "package.json").write_text(json.dumps({"name": "cli-demo"}))
    env = {
        **os.environ,
        "PYTHONPATH": str(Path(__file__).resolve().parents[1]),
    }

    result = subprocess.run(
        [
            sys.executable,
            "-m",
            "altocumulus_runtime.scan",
            str(tmp_path),
            "--now",
            "2026-01-01T00:00:00.000Z",
        ],
        env=env,
        check=True,
        text=True,
        capture_output=True,
    )
    parsed = json.loads(result.stdout)

    assert parsed["project"]["name"] == "cli-demo"
    assert parsed["scannedAt"] == "2026-01-01T00:00:00.000Z"
    assert result.stderr.startswith("altocumulus scan: starting ")
    assert "altocumulus scan: done" in result.stderr
