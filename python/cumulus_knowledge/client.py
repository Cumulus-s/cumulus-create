from __future__ import annotations

import json
import os
import subprocess
from pathlib import Path
from typing import Any
from urllib import parse, request

from .models import AxiEnvelope


class CumulusKnowledge:
    def __init__(
        self,
        root: str | os.PathLike[str] = ".",
        bin: str | None = None,
        api_base_url: str | None = None,
        project_id: str = "local",
    ) -> None:
        self.root = str(root)
        self.bin = bin or os.environ.get("CUMULUS_BIN", "cls-knowledge")
        self.api_base_url = api_base_url or os.environ.get("CUMULUS_API_URL")
        self.project_id = project_id or os.environ.get("CUMULUS_PROJECT_ID", "local")

    def init(self, root: str | os.PathLike[str] | None = None) -> AxiEnvelope[Any]:
        return self._run(["knowledge", "init", str(root or self.root)])

    def index(
        self,
        profile: str = "all",
        root: str | os.PathLike[str] | None = None,
        watch: bool = False,
    ) -> AxiEnvelope[Any]:
        args = ["knowledge", "index", str(root or self.root), "--profile", profile]
        if watch:
            args.append("--watch")
        return self._run(args)

    def query(self, text: str, budget: int = 1200, limit: int = 10) -> AxiEnvelope[Any]:
        if self.api_base_url:
            return self._api_json(
                "POST",
                self._project_path("/query"),
                {"query": text, "budget": budget, "limit": limit},
            )
        return self._run(
            [
                "knowledge",
                "query",
                text,
                "--path",
                self.root,
                "--budget",
                str(budget),
                "--limit",
                str(limit),
            ]
        )

    def get_node(self, node_id: str) -> AxiEnvelope[Any]:
        if self.api_base_url:
            return self.fetch_node(node_id)
        return self._run(["knowledge", "node", "get", node_id, "--path", self.root])

    def expand_neighbors(self, node_id: str, depth: int = 1) -> AxiEnvelope[Any]:
        return self._run(["knowledge", "graph", "expand", node_id, "--path", self.root, "--depth", str(depth)])

    def find_paths(self, from_id: str, to_id: str, max_depth: int = 6) -> AxiEnvelope[Any]:
        if self.api_base_url:
            return self.explain_path(from_id, to_id)
        return self._run(
            [
                "knowledge",
                "path",
                "explain",
                from_id,
                to_id,
                "--path",
                self.root,
                "--max-depth",
                str(max_depth),
            ]
        )

    def index_status(self) -> AxiEnvelope[Any]:
        if self.api_base_url:
            return self.get_job()
        return self._run(["knowledge", "doctor", "--path", self.root])

    def get_graph_view(self, preset: str = "full") -> AxiEnvelope[Any]:
        if self.api_base_url:
            query = parse.urlencode({"preset": preset})
            return self._api_json("GET", f"{self._project_path('/graph-view')}?{query}")
        return self._run(["knowledge", "graph", "view", "--path", self.root, "--preset", preset])

    def create_project(self, data: dict[str, Any] | None = None) -> AxiEnvelope[Any]:
        return self._api_json("POST", "/v1/projects", data or {})

    def upload_folder(self, files: list[dict[str, str]]) -> AxiEnvelope[Any]:
        return self._api_json("POST", self._project_path("/uploads"), {"files": files})

    def index_project(self) -> AxiEnvelope[Any]:
        return self._api_json("POST", self._project_path("/index"), {})

    def get_job(self, job_id: str = "local") -> AxiEnvelope[Any]:
        return self._api_json("GET", f"/v1/jobs/{parse.quote(job_id)}")

    def upload_project(self, path_or_zip: str | os.PathLike[str]) -> AxiEnvelope[Any]:
        return self.init(path_or_zip)

    def fetch_node(self, node_id: str) -> AxiEnvelope[Any]:
        if self.api_base_url:
            return self._api_json("GET", self._project_path(f"/nodes/{parse.quote(node_id)}"))
        return self.get_node(node_id)

    def explain_path(self, from_id: str, to_id: str, max_depth: int = 6) -> AxiEnvelope[Any]:
        if self.api_base_url:
            query = parse.urlencode({"from": from_id, "to": to_id, "max_depth": max_depth})
            return self._api_json("GET", f"{self._project_path('/paths/explain')}?{query}")
        return self.find_paths(from_id, to_id, max_depth=max_depth)

    def source_trace(self, node_id: str, preset: str = "full") -> AxiEnvelope[Any]:
        if self.api_base_url:
            query = parse.urlencode({"preset": preset})
            return self._api_json("GET", f"{self._project_path(f'/nodes/{parse.quote(node_id)}/source-trace')}?{query}")
        view = self.get_graph_view(preset).data
        return AxiEnvelope.from_dict({
            "ok": True,
            "data": {
                "node_id": node_id,
                "evidence": [item for item in view.get("evidence", []) if item.get("node_id") == node_id],
            },
            "meta": {"command": "knowledge.source_trace"},
            "links": [],
        })

    def export_html(self) -> str:
        return self._api_text("GET", self._project_path("/exports/html"))

    def export_graph(self, output: str | os.PathLike[str], format: str = "json") -> Path:
        out = Path(output)
        self._run_raw(["knowledge", "viz", "export", "--path", self.root, "--format", format, "--output", str(out)])
        return out

    def _run(self, args: list[str]) -> AxiEnvelope[Any]:
        completed = self._run_raw([*args, "--format", "json"])
        return AxiEnvelope.from_dict(json.loads(completed.stdout))

    def _run_raw(self, args: list[str]) -> subprocess.CompletedProcess[str]:
        return subprocess.run(
            [self.bin, *args],
            text=True,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            check=True,
        )

    def _api_json(self, method: str, path: str, body: dict[str, Any] | None = None) -> AxiEnvelope[Any]:
        payload = None if body is None else json.dumps(body).encode("utf-8")
        req = request.Request(
            self._api_url(path),
            data=payload,
            method=method,
            headers={"content-type": "application/json"},
        )
        with request.urlopen(req) as response:
            return AxiEnvelope.from_dict(json.loads(response.read().decode("utf-8")))

    def _api_text(self, method: str, path: str) -> str:
        req = request.Request(self._api_url(path), method=method)
        with request.urlopen(req) as response:
            return response.read().decode("utf-8")

    def _api_url(self, path: str) -> str:
        if not self.api_base_url:
            raise RuntimeError("api_base_url is required for API calls")
        return parse.urljoin(self.api_base_url.rstrip("/") + "/", path.lstrip("/"))

    def _project_path(self, suffix: str) -> str:
        return f"/v1/projects/{parse.quote(self.project_id)}{suffix}"
