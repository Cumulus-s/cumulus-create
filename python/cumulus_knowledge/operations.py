from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Any

from .client import CumulusKnowledge


ENTITY_PATTERNS: dict[str, re.Pattern[str]] = {
    "invoice": re.compile(r"\b(?:invoice|inv)[:#\s-]+([A-Z0-9-]{3,})", re.I),
    "bank_draw": re.compile(r"\b(?:draw request|bank draw|draw)[:#\s-]+(.+)", re.I),
    "vendor": re.compile(r"\b(?:vendor|contractor)[:\s-]+(.+)", re.I),
    "supplier": re.compile(r"\bsupplier[:\s-]+(.+)", re.I),
    "client": re.compile(r"\b(?:client|owner)[:\s-]+(.+)", re.I),
    "bank": re.compile(r"\b(?:bank|lender)\s*:\s*(.+)", re.I),
}


def upload_project(path_or_zip: str | Path, root: str | Path | None = None) -> dict[str, Any]:
    target = Path(root or path_or_zip)
    client = CumulusKnowledge(root=target)
    init = client.init()
    return {"root": str(target), "init": init.data}


def extract_operations_entities(path: str | Path) -> list[dict[str, Any]]:
    root = Path(path)
    entities: list[dict[str, Any]] = []
    for file in root.rglob("*"):
        if not file.is_file() or ".cumulus" in file.parts:
            continue
        try:
            text = file.read_text(encoding="utf-8")
        except UnicodeDecodeError:
            continue
        for line_no, line in enumerate(text.splitlines(), start=1):
            compact = line.strip().strip("-*# ")
            if not compact:
                continue
            for kind, pattern in ENTITY_PATTERNS.items():
                match = pattern.search(compact)
                if match:
                    entities.append(entity(kind, match.group(1), file, line_no, compact))
            lower = compact.lower()
            if any(term in lower for term in ("shipment", "shipping", "delivery")):
                entities.append(entity("shipment", compact, file, line_no, compact))
            if any(term in lower for term in ("milestone", "inspection", "phase ")):
                entities.append(entity("milestone", compact, file, line_no, compact))
            if any(term in lower for term in ("risk", "delay", "overdue", "blocked")):
                entities.append(entity("risk", compact, file, line_no, compact))
            if any(term in lower for term in ("conflict", "mismatch", "does not match")):
                entities.append(entity("conflict", compact, file, line_no, compact))
    return entities


def build_relationship_candidates(docs: list[dict[str, Any]]) -> list[dict[str, Any]]:
    by_path: dict[str, list[dict[str, Any]]] = {}
    for item in docs:
        by_path.setdefault(str(item.get("path")), []).append(item)
    relationships: list[dict[str, Any]] = []
    for path, items in by_path.items():
        for left in items:
            for right in items:
                if left is right or left["kind"] == right["kind"]:
                    continue
                relationships.append({
                    "from": left["id"],
                    "to": right["id"],
                    "kind": relation_kind(left["kind"], right["kind"]),
                    "path": path,
                    "confidence": 0.54,
                })
    return relationships


def score_graph_readability(graph_view: dict[str, Any]) -> dict[str, Any]:
    nodes = graph_view.get("nodes", [])
    labels = [node.get("display_label", "") for node in nodes]
    chunk_labels = [label for label in labels if str(label).startswith("chunk_")]
    long_labels = [label for label in labels if len(str(label)) > 96]
    legend_count = len(graph_view.get("legend", {}).get("node_kinds", []))
    score = 1.0
    score -= min(0.4, len(chunk_labels) * 0.08)
    score -= min(0.25, len(long_labels) * 0.04)
    if legend_count == 0:
        score -= 0.2
    return {
        "score": round(max(0.0, score), 3),
        "node_count": len(nodes),
        "chunk_label_count": len(chunk_labels),
        "long_label_count": len(long_labels),
        "legend_count": legend_count,
        "passed": score >= 0.8 and not chunk_labels,
    }


def run_agent_eval(project_id: str, graph_view: dict[str, Any] | None = None) -> dict[str, Any]:
    readability = score_graph_readability(graph_view or {"nodes": [], "legend": {"node_kinds": []}})
    return {
        "project_id": project_id,
        "passed": readability["passed"],
        "score": readability["score"],
        "checks": {
            "readability": readability,
            "citations_present": bool((graph_view or {}).get("evidence")),
        },
    }


def detect_missing_citations(graph_view: dict[str, Any]) -> list[dict[str, Any]]:
    evidence_by_node = {item.get("node_id") for item in graph_view.get("evidence", [])}
    return [
        {"node_id": node.get("id"), "label": node.get("display_label"), "issue": "missing citation"}
        for node in graph_view.get("nodes", [])
        if node.get("id") not in evidence_by_node and node.get("domain_kind") not in {"project", "folder"}
    ]


def compare_invoice_to_bank_draw(entities: list[dict[str, Any]]) -> list[dict[str, Any]]:
    invoices = [item for item in entities if item["kind"] == "invoice"]
    draws = [item for item in entities if item["kind"] == "bank_draw"]
    if invoices and not draws:
        return [{"severity": "high", "issue": "invoice without bank draw evidence", "invoice_count": len(invoices)}]
    return []


def detect_schedule_shipping_risk(entities: list[dict[str, Any]]) -> list[dict[str, Any]]:
    shipments = [item for item in entities if item["kind"] == "shipment"]
    risks = [item for item in entities if item["kind"] == "risk"]
    return [
        {"severity": "medium", "issue": "shipping item has risk language", "shipment": item["label"]}
        for item in shipments
        if any(term in item["line"].lower() for term in ("delay", "blocked", "overdue"))
    ] + [{"severity": "medium", "issue": "schedule risk found", "risk": item["label"]} for item in risks]


def entity(kind: str, label: str, file: Path, line_no: int, line: str) -> dict[str, Any]:
    clean = label.strip().strip(":#- ")
    return {
        "id": f"{kind}:{slug(clean)}:{line_no}",
        "kind": kind,
        "label": clean[:120],
        "path": str(file),
        "line_no": line_no,
        "line": line,
    }


def relation_kind(left: str, right: str) -> str:
    pair = {left, right}
    if "invoice" in pair and "vendor" in pair:
        return "billed_by"
    if "bank_draw" in pair and "bank" in pair:
        return "paid_by"
    if "shipment" in pair and "supplier" in pair:
        return "ships"
    if "risk" in pair:
        return "risks"
    return "mentions"


def slug(value: str) -> str:
    return re.sub(r"-+", "-", re.sub(r"[^a-z0-9]+", "-", value.lower())).strip("-")


def main() -> None:
    import argparse

    parser = argparse.ArgumentParser()
    parser.add_argument("path")
    args = parser.parse_args()
    entities = extract_operations_entities(args.path)
    print(json.dumps({"entities": entities, "relationships": build_relationship_candidates(entities)}, indent=2))
