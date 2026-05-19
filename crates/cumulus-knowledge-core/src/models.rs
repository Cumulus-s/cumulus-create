use chrono::{DateTime, Utc};
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::BTreeMap;

pub const VERSION: &str = env!("CARGO_PKG_VERSION");

pub type Metadata = BTreeMap<String, Value>;

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq)]
pub struct Link {
    pub rel: String,
    pub uri: String,
    pub title: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq)]
pub struct AxiMeta {
    pub version: String,
    pub command: String,
    pub generated_at: DateTime<Utc>,
    pub cursor: Option<String>,
    pub count: Option<usize>,
    pub budget_tokens: Option<usize>,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq)]
pub struct AxiError {
    pub code: String,
    pub message: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq)]
pub struct AxiEnvelope<T>
where
    T: Serialize,
{
    pub ok: bool,
    pub data: T,
    pub meta: AxiMeta,
    pub links: Vec<Link>,
    pub error: Option<AxiError>,
}

impl<T> AxiEnvelope<T>
where
    T: Serialize,
{
    pub fn ok(command: impl Into<String>, data: T) -> Self {
        Self {
            ok: true,
            data,
            meta: AxiMeta {
                version: VERSION.to_string(),
                command: command.into(),
                generated_at: Utc::now(),
                cursor: None,
                count: None,
                budget_tokens: None,
            },
            links: Vec::new(),
            error: None,
        }
    }

    pub fn with_count(mut self, count: usize) -> Self {
        self.meta.count = Some(count);
        self
    }

    pub fn with_budget(mut self, budget_tokens: usize) -> Self {
        self.meta.budget_tokens = Some(budget_tokens);
        self
    }

    pub fn with_link(
        mut self,
        rel: impl Into<String>,
        uri: impl Into<String>,
        title: Option<String>,
    ) -> Self {
        self.links.push(Link {
            rel: rel.into(),
            uri: uri.into(),
            title,
        });
        self
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq)]
pub struct Source {
    pub id: String,
    pub path: String,
    pub title: String,
    pub mime_type: String,
    pub sha256: String,
    pub size_bytes: u64,
    pub modified_at: Option<DateTime<Utc>>,
    pub metadata: Metadata,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq)]
pub struct Node {
    pub id: String,
    pub kind: String,
    pub label: String,
    pub uri: String,
    pub source_id: Option<String>,
    pub summary: Option<String>,
    pub metadata: Metadata,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq)]
pub struct Edge {
    pub id: String,
    pub kind: String,
    pub from_id: String,
    pub to_id: String,
    pub label: Option<String>,
    pub metadata: Metadata,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq)]
pub struct Chunk {
    pub id: String,
    pub source_id: String,
    pub node_id: String,
    pub text: String,
    pub start_line: usize,
    pub end_line: usize,
    pub token_estimate: usize,
    pub metadata: Metadata,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq)]
pub struct Citation {
    pub id: String,
    pub source_id: String,
    pub chunk_id: Option<String>,
    pub uri: String,
    pub title: Option<String>,
    pub start_line: Option<usize>,
    pub end_line: Option<usize>,
    pub metadata: Metadata,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq)]
pub struct Embedding {
    pub id: String,
    pub owner_id: String,
    pub model: String,
    pub dimensions: usize,
    pub vector_ref: String,
    pub metadata: Metadata,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq)]
pub struct SearchHit {
    pub node: Node,
    pub chunk_id: Option<String>,
    pub score: f64,
    pub snippet: String,
    pub resource_uri: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq)]
pub struct GraphSnapshot {
    pub root_id: Option<String>,
    pub generated_at: DateTime<Utc>,
    pub nodes: Vec<Node>,
    pub edges: Vec<Edge>,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq)]
pub struct GraphView {
    pub id: String,
    pub preset: String,
    pub generated_at: DateTime<Utc>,
    pub summary: String,
    pub nodes: Vec<GraphViewNode>,
    pub edges: Vec<GraphViewEdge>,
    pub evidence: Vec<GraphViewEvidence>,
    pub legend: GraphLegend,
    pub layout: GraphLayout,
    pub filters: GraphFilters,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq)]
pub struct GraphViewNode {
    pub id: String,
    pub uri: String,
    pub display_label: String,
    pub display_subtitle: Option<String>,
    pub display_kind: String,
    pub domain_kind: String,
    pub importance: f64,
    pub confidence: f64,
    pub source_count: usize,
    pub evidence_count: usize,
    pub metadata: Metadata,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq)]
pub struct GraphViewEdge {
    pub id: String,
    pub from_id: String,
    pub to_id: String,
    pub label: String,
    pub kind: String,
    pub confidence: f64,
    pub metadata: Metadata,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq)]
pub struct GraphViewEvidence {
    pub id: String,
    pub node_id: String,
    pub source_id: Option<String>,
    pub chunk_id: Option<String>,
    pub uri: String,
    pub label: String,
    pub excerpt: Option<String>,
    pub metadata: Metadata,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq)]
pub struct GraphLegend {
    pub node_kinds: Vec<LegendEntry>,
    pub edge_kinds: Vec<LegendEntry>,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq)]
pub struct LegendEntry {
    pub kind: String,
    pub label: String,
    pub color: String,
    pub icon: String,
    pub count: usize,
    pub visible: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq)]
pub struct GraphLayout {
    pub preset: String,
    pub nodes: Vec<GraphLayoutNode>,
    pub lanes: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq)]
pub struct GraphLayoutNode {
    pub id: String,
    pub x: f64,
    pub y: f64,
    pub lane: String,
    pub cluster: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq)]
pub struct GraphFilters {
    pub visible_node_kinds: Vec<String>,
    pub visible_edge_kinds: Vec<String>,
    pub include_evidence: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq)]
pub struct GraphExpansion {
    pub root_id: String,
    pub depth: usize,
    pub nodes: Vec<Node>,
    pub edges: Vec<Edge>,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq)]
pub struct PathExplanation {
    pub from_id: String,
    pub to_id: String,
    pub nodes: Vec<Node>,
    pub edges: Vec<Edge>,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq)]
pub struct IndexManifest {
    pub version: String,
    pub root_path: String,
    pub profile: String,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
    pub source_count: usize,
    pub node_count: usize,
    pub edge_count: usize,
    pub chunk_count: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq)]
pub struct IndexStats {
    pub root_path: String,
    pub database_path: String,
    pub source_count: usize,
    pub node_count: usize,
    pub edge_count: usize,
    pub chunk_count: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq)]
pub struct IndexReport {
    pub manifest: IndexManifest,
    pub stats: IndexStats,
    pub skipped: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq)]
pub struct DoctorReport {
    pub ok: bool,
    pub root_path: String,
    pub database_exists: bool,
    pub manifest_exists: bool,
    pub stats: Option<IndexStats>,
    pub warnings: Vec<String>,
}
