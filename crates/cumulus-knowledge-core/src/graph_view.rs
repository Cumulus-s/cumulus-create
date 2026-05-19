use chrono::Utc;
use serde_json::json;
use std::collections::{BTreeMap, BTreeSet, HashMap};

use crate::{
    models::{
        Edge, GraphFilters, GraphLayout, GraphLayoutNode, GraphLegend, GraphSnapshot, GraphView,
        GraphViewEdge, GraphViewEvidence, GraphViewNode, LegendEntry, Node,
    },
    util,
};

const SOURCE_KINDS: &[&str] = &["project", "folder", "file", "document", "source_document"];
const FINANCE_KINDS: &[&str] = &[
    "client",
    "bank",
    "bank_draw",
    "invoice",
    "payment",
    "vendor",
    "supplier",
];
const TIMELINE_KINDS: &[&str] = &["milestone", "shipment", "delivery", "material", "risk"];
const RISK_KINDS: &[&str] = &[
    "risk",
    "conflict",
    "missing_evidence",
    "shipment",
    "invoice",
    "bank_draw",
];

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum GraphViewPreset {
    Source,
    Finance,
    Timeline,
    Risk,
    Full,
}

impl GraphViewPreset {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Source => "source",
            Self::Finance => "finance",
            Self::Timeline => "timeline",
            Self::Risk => "risk",
            Self::Full => "full",
        }
    }
}

impl std::str::FromStr for GraphViewPreset {
    type Err = anyhow::Error;

    fn from_str(value: &str) -> Result<Self, Self::Err> {
        match value {
            "source" => Ok(Self::Source),
            "finance" => Ok(Self::Finance),
            "timeline" => Ok(Self::Timeline),
            "risk" => Ok(Self::Risk),
            "full" | "human" | "ops" | "agent" => Ok(Self::Full),
            _ => anyhow::bail!("unknown graph view preset: {value}"),
        }
    }
}

pub fn build_graph_view(snapshot: &GraphSnapshot, preset: GraphViewPreset) -> GraphView {
    let filters = default_filters(preset);
    let visible = visible_node_ids(snapshot, &filters);
    let evidence = build_evidence(snapshot, &visible);
    let nodes = snapshot
        .nodes
        .iter()
        .filter(|node| visible.contains(&node.id))
        .map(|node| semantic_label_node(node, snapshot, &evidence))
        .collect::<Vec<_>>();
    let edges = snapshot
        .edges
        .iter()
        .filter(|edge| visible.contains(&edge.from_id) && visible.contains(&edge.to_id))
        .filter(|edge| filters.visible_edge_kinds.contains(&edge.kind))
        .map(view_edge)
        .collect::<Vec<_>>();
    let layout = layout_graph_view(&nodes, preset);
    let legend = build_legend(&nodes, &edges, &filters);
    GraphView {
        id: util::stable_id(
            "view",
            format!("{}:{}", preset.as_str(), snapshot.generated_at),
        ),
        preset: preset.as_str().to_string(),
        generated_at: Utc::now(),
        summary: format!(
            "{} graph view with {} display nodes, {} visible edges, and {} evidence links",
            title_case(preset.as_str()),
            nodes.len(),
            edges.len(),
            evidence.len()
        ),
        nodes,
        edges,
        evidence,
        legend,
        layout,
        filters,
    }
}

pub fn semantic_label_node(
    node: &Node,
    snapshot: &GraphSnapshot,
    evidence: &[GraphViewEvidence],
) -> GraphViewNode {
    let domain_kind = domain_kind(node);
    let display_label = display_label(node, &domain_kind);
    let display_subtitle = display_subtitle(node);
    let evidence_count = evidence
        .iter()
        .filter(|item| item.node_id == node.id)
        .count();
    let source_count = usize::from(node.source_id.is_some());
    let mut metadata = node.metadata.clone();
    metadata.insert("raw_kind".to_string(), json!(node.kind));
    metadata.insert("raw_label".to_string(), json!(node.label));
    GraphViewNode {
        id: node.id.clone(),
        uri: node.uri.clone(),
        display_label,
        display_subtitle,
        display_kind: display_kind(&domain_kind).to_string(),
        domain_kind,
        importance: importance(node, snapshot),
        confidence: confidence(node),
        source_count,
        evidence_count,
        metadata,
    }
}

pub fn layout_graph_view(nodes: &[GraphViewNode], preset: GraphViewPreset) -> GraphLayout {
    let lanes = lanes_for_preset(preset);
    let mut lane_counts: HashMap<String, usize> = HashMap::new();
    let mut layout_nodes = Vec::new();
    for node in nodes {
        let lane = lane_for_node(&node.domain_kind, preset).to_string();
        let row = lane_counts.entry(lane.clone()).or_insert(0);
        let lane_index = lanes.iter().position(|item| item == &lane).unwrap_or(1);
        let x = 220.0 + lane_index as f64 * 360.0;
        let y = 160.0 + *row as f64 * 150.0 + (lane_index % 2) as f64 * 46.0;
        layout_nodes.push(GraphLayoutNode {
            id: node.id.clone(),
            x,
            y,
            lane: lane.clone(),
            cluster: Some(node.domain_kind.clone()),
        });
        *row += 1;
    }
    GraphLayout {
        preset: preset.as_str().to_string(),
        nodes: layout_nodes,
        lanes,
    }
}

fn default_filters(preset: GraphViewPreset) -> GraphFilters {
    let visible_node_kinds = match preset {
        GraphViewPreset::Source => SOURCE_KINDS,
        GraphViewPreset::Finance => FINANCE_KINDS,
        GraphViewPreset::Timeline => TIMELINE_KINDS,
        GraphViewPreset::Risk => RISK_KINDS,
        GraphViewPreset::Full => &[] as &[&str],
    }
    .iter()
    .map(|kind| (*kind).to_string())
    .collect();
    GraphFilters {
        visible_node_kinds,
        visible_edge_kinds: [
            "contains",
            "mentions",
            "defines",
            "imports",
            "references",
            "depends_on",
            "conflicts_with",
            "billed_by",
            "paid_by",
            "ships",
            "delays",
            "approved_by",
            "belongs_to",
        ]
        .iter()
        .map(|kind| (*kind).to_string())
        .collect(),
        include_evidence: false,
    }
}

fn visible_node_ids(snapshot: &GraphSnapshot, filters: &GraphFilters) -> BTreeSet<String> {
    let mut visible = BTreeSet::new();
    for node in &snapshot.nodes {
        if node.kind == "chunk" {
            continue;
        }
        let kind = domain_kind(node);
        if filters.visible_node_kinds.is_empty()
            || filters.visible_node_kinds.contains(&kind)
            || filters.visible_node_kinds.contains(&node.kind)
        {
            visible.insert(node.id.clone());
        }
    }
    if visible.is_empty() {
        for node in &snapshot.nodes {
            if node.kind != "chunk" {
                visible.insert(node.id.clone());
            }
        }
    }
    visible
}

fn build_evidence(snapshot: &GraphSnapshot, visible: &BTreeSet<String>) -> Vec<GraphViewEvidence> {
    let nodes_by_id = snapshot
        .nodes
        .iter()
        .map(|node| (node.id.as_str(), node))
        .collect::<HashMap<_, _>>();
    let mut evidence = Vec::new();
    for edge in &snapshot.edges {
        let Some(from) = nodes_by_id.get(edge.from_id.as_str()) else {
            continue;
        };
        let Some(to) = nodes_by_id.get(edge.to_id.as_str()) else {
            continue;
        };
        let (display_id, evidence_node) = if visible.contains(&edge.from_id) && to.kind == "chunk" {
            (&edge.from_id, to)
        } else if visible.contains(&edge.to_id) && from.kind == "chunk" {
            (&edge.to_id, from)
        } else if visible.contains(&edge.from_id) && to.kind == "file" && from.kind != "file" {
            (&edge.from_id, to)
        } else if visible.contains(&edge.to_id) && from.kind == "file" && to.kind != "file" {
            (&edge.to_id, from)
        } else {
            continue;
        };
        let evidence_uri = if evidence_node.kind == "chunk" {
            evidence_node.uri.clone()
        } else {
            util::path_to_uri(&evidence_node.label)
        };
        evidence.push(GraphViewEvidence {
            id: util::stable_id("evidence", format!("{display_id}:{}", evidence_node.id)),
            node_id: display_id.clone(),
            source_id: evidence_node.source_id.clone(),
            chunk_id: (evidence_node.kind == "chunk").then(|| evidence_node.id.clone()),
            uri: evidence_uri,
            label: evidence_node.label.clone(),
            excerpt: evidence_node.summary.clone(),
            metadata: evidence_node.metadata.clone(),
        });
    }
    evidence
}

fn view_edge(edge: &Edge) -> GraphViewEdge {
    GraphViewEdge {
        id: edge.id.clone(),
        from_id: edge.from_id.clone(),
        to_id: edge.to_id.clone(),
        label: edge.label.clone().unwrap_or_else(|| edge.kind.clone()),
        kind: edge.kind.clone(),
        confidence: edge
            .metadata
            .get("confidence")
            .and_then(|value| value.as_f64())
            .unwrap_or(0.72),
        metadata: edge.metadata.clone(),
    }
}

fn build_legend(
    nodes: &[GraphViewNode],
    edges: &[GraphViewEdge],
    filters: &GraphFilters,
) -> GraphLegend {
    let mut node_counts: BTreeMap<String, usize> = BTreeMap::new();
    let mut edge_counts: BTreeMap<String, usize> = BTreeMap::new();
    for node in nodes {
        *node_counts.entry(node.domain_kind.clone()).or_default() += 1;
    }
    for edge in edges {
        *edge_counts.entry(edge.kind.clone()).or_default() += 1;
    }
    GraphLegend {
        node_kinds: node_counts
            .into_iter()
            .map(|(kind, count)| LegendEntry {
                label: display_kind(&kind).to_string(),
                color: color_for_kind(&kind).to_string(),
                icon: icon_for_kind(&kind).to_string(),
                visible: filters.visible_node_kinds.is_empty()
                    || filters.visible_node_kinds.contains(&kind),
                kind,
                count,
            })
            .collect(),
        edge_kinds: edge_counts
            .into_iter()
            .map(|(kind, count)| LegendEntry {
                label: title_case(&kind.replace('_', " ")),
                color: "#7dd3fc".to_string(),
                icon: "link".to_string(),
                visible: filters.visible_edge_kinds.contains(&kind),
                kind,
                count,
            })
            .collect(),
    }
}

fn domain_kind(node: &Node) -> String {
    if let Some(kind) = node
        .metadata
        .get("domain_kind")
        .and_then(|value| value.as_str())
    {
        return kind.to_string();
    }
    match node.kind.as_str() {
        "reference" => "external_reference",
        "file" => "source_document",
        other => other,
    }
    .to_string()
}

fn display_label(node: &Node, domain_kind: &str) -> String {
    if let Some(label) = node
        .metadata
        .get("display_label")
        .and_then(|value| value.as_str())
    {
        return label.to_string();
    }
    match domain_kind {
        "source_document" => {
            let raw = node
                .metadata
                .get("path")
                .and_then(|value| value.as_str())
                .unwrap_or(&node.label);
            document_title(raw, node.summary.as_deref())
        }
        "invoice" => with_prefix("Invoice", &node.label),
        "bank_draw" => with_prefix("Bank Draw Request", &node.label),
        "vendor" => with_prefix("Vendor", &node.label),
        "supplier" => with_prefix("Supplier", &node.label),
        "client" => with_prefix("Client", &node.label),
        "shipment" | "delivery" => with_prefix("Delivery", &node.label),
        "milestone" => with_prefix("Milestone", &node.label),
        "risk" => with_prefix("Schedule Risk", &node.label),
        "conflict" => with_prefix("Conflict", &node.label),
        _ => clean_label(&node.label),
    }
}

fn display_subtitle(node: &Node) -> Option<String> {
    node.metadata
        .get("path")
        .and_then(|value| value.as_str())
        .map(ToString::to_string)
        .or_else(|| node.summary.clone())
}

fn document_title(path: &str, summary: Option<&str>) -> String {
    let stem = path
        .rsplit('/')
        .next()
        .unwrap_or(path)
        .split('.')
        .next()
        .unwrap_or(path)
        .replace(['_', '-'], " ");
    let title = title_case(&stem);
    if title.trim().is_empty() {
        summary
            .map(clean_label)
            .unwrap_or_else(|| "Source Document".to_string())
    } else {
        title
    }
}

fn with_prefix(prefix: &str, label: &str) -> String {
    let clean = clean_label(label);
    if clean
        .to_ascii_lowercase()
        .starts_with(&prefix.to_ascii_lowercase())
    {
        clean
    } else {
        format!("{prefix}: {clean}")
    }
}

fn clean_label(label: &str) -> String {
    let label = label.trim().trim_matches(['#', ':', '-', '*', ' ']);
    if label.starts_with("chunk_") {
        "Evidence excerpt".to_string()
    } else {
        label.chars().take(96).collect()
    }
}

fn display_kind(kind: &str) -> &str {
    match kind {
        "bank_draw" => "Bank Draw",
        "source_document" => "Source Document",
        "external_reference" => "Reference",
        other => match other {
            "project" => "Project",
            "folder" => "Folder",
            "file" => "File",
            "invoice" => "Invoice",
            "payment" => "Payment",
            "vendor" => "Vendor",
            "supplier" => "Supplier",
            "client" => "Client",
            "bank" => "Bank",
            "shipment" => "Shipment",
            "delivery" => "Delivery",
            "material" => "Material",
            "milestone" => "Milestone",
            "risk" => "Risk",
            "conflict" => "Conflict",
            "symbol" => "Symbol",
            _ => "Node",
        },
    }
}

fn importance(node: &Node, snapshot: &GraphSnapshot) -> f64 {
    let degree = snapshot
        .edges
        .iter()
        .filter(|edge| edge.from_id == node.id || edge.to_id == node.id)
        .count();
    (0.35 + (degree as f64 / 12.0)).min(1.0)
}

fn confidence(node: &Node) -> f64 {
    node.metadata
        .get("confidence")
        .and_then(|value| value.as_f64())
        .unwrap_or_else(|| {
            if node.kind == "file" || node.kind == "project" {
                0.95
            } else {
                0.72
            }
        })
}

fn lanes_for_preset(preset: GraphViewPreset) -> Vec<String> {
    match preset {
        GraphViewPreset::Finance => ["source", "party", "finance", "outcome"],
        GraphViewPreset::Timeline => ["source", "materials", "timeline", "risk"],
        GraphViewPreset::Risk => ["source", "signal", "risk", "action"],
        GraphViewPreset::Source => ["root", "folder", "document", "evidence"],
        GraphViewPreset::Full => ["source", "entity", "relationship", "outcome"],
    }
    .iter()
    .map(|lane| (*lane).to_string())
    .collect()
}

fn lane_for_node(kind: &str, preset: GraphViewPreset) -> &'static str {
    match preset {
        GraphViewPreset::Finance => match kind {
            "client" | "bank" | "vendor" | "supplier" => "party",
            "invoice" | "bank_draw" | "payment" => "finance",
            "risk" | "conflict" => "outcome",
            _ => "source",
        },
        GraphViewPreset::Timeline => match kind {
            "shipment" | "delivery" | "material" => "materials",
            "milestone" => "timeline",
            "risk" | "conflict" => "risk",
            _ => "source",
        },
        GraphViewPreset::Risk => match kind {
            "risk" | "conflict" => "risk",
            "invoice" | "shipment" | "bank_draw" => "signal",
            _ => "source",
        },
        GraphViewPreset::Source => match kind {
            "project" => "root",
            "folder" => "folder",
            "source_document" | "file" => "document",
            _ => "evidence",
        },
        GraphViewPreset::Full => match kind {
            "project" | "folder" | "source_document" | "file" => "source",
            "risk" | "conflict" => "outcome",
            "symbol" | "external_reference" => "relationship",
            _ => "entity",
        },
    }
}

fn color_for_kind(kind: &str) -> &str {
    match kind {
        "project" => "#f8fafc",
        "folder" => "#94a3b8",
        "source_document" | "file" => "#38bdf8",
        "invoice" | "payment" => "#34d399",
        "bank" | "bank_draw" => "#a78bfa",
        "vendor" | "supplier" | "client" => "#f59e0b",
        "shipment" | "delivery" | "material" => "#22d3ee",
        "milestone" => "#60a5fa",
        "risk" | "conflict" => "#fb7185",
        _ => "#cbd5e1",
    }
}

fn icon_for_kind(kind: &str) -> &str {
    match kind {
        "invoice" | "payment" | "bank_draw" => "receipt",
        "bank" => "bank",
        "vendor" | "supplier" | "client" => "building",
        "shipment" | "delivery" | "material" => "truck",
        "milestone" => "calendar",
        "risk" | "conflict" => "alert",
        "source_document" | "file" => "file",
        "folder" => "folder",
        _ => "node",
    }
}

fn title_case(input: &str) -> String {
    input
        .split_whitespace()
        .map(|part| {
            let mut chars = part.chars();
            match chars.next() {
                Some(first) => format!("{}{}", first.to_uppercase(), chars.as_str().to_lowercase()),
                None => String::new(),
            }
        })
        .collect::<Vec<_>>()
        .join(" ")
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{IndexOptions, Indexer};
    use std::fs;

    #[test]
    fn graph_view_hides_chunks_and_labels_domain_nodes() {
        let dir = tempfile::tempdir().unwrap();
        fs::write(
            dir.path().join("finance.md"),
            "Invoice DEMO-INV-001\nVendor: BrightSteel Demo Supply\nBank: Atlas Demo Bank\n",
        )
        .unwrap();
        let mut indexer = Indexer::new(dir.path()).unwrap();
        indexer.index(IndexOptions::default()).unwrap();
        let snapshot = indexer.store().snapshot(None, 200).unwrap();
        let view = build_graph_view(&snapshot, GraphViewPreset::Full);
        assert!(view.nodes.iter().all(|node| node.domain_kind != "chunk"));
        assert!(view
            .nodes
            .iter()
            .any(|node| node.display_label.contains("Invoice")));
        assert!(!view.legend.node_kinds.is_empty());
    }
}
