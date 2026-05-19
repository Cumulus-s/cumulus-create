use anyhow::{anyhow, Context, Result};
use chrono::Utc;
use ignore::WalkBuilder;
use serde::{Deserialize, Serialize};
use serde_json::json;
use std::{
    collections::{HashMap, HashSet},
    fs,
    path::{Path, PathBuf},
};

use crate::{
    chunking::chunk_text,
    models::{Edge, IndexReport, Metadata, Node, Source},
    store::KnowledgeStore,
    util,
};

#[derive(Debug, Clone, Copy, Default, Serialize, Deserialize, PartialEq, Eq)]
pub enum IndexProfile {
    Code,
    Docs,
    Facility,
    #[default]
    All,
}

impl std::fmt::Display for IndexProfile {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Code => write!(f, "code"),
            Self::Docs => write!(f, "docs"),
            Self::Facility => write!(f, "facility"),
            Self::All => write!(f, "all"),
        }
    }
}

#[derive(Debug, Clone)]
pub struct IndexOptions {
    pub profile: IndexProfile,
    pub max_file_bytes: usize,
    pub max_chunk_tokens: usize,
}

impl Default for IndexOptions {
    fn default() -> Self {
        Self {
            profile: IndexProfile::All,
            max_file_bytes: 2 * 1024 * 1024,
            max_chunk_tokens: 480,
        }
    }
}

pub struct Indexer {
    root: PathBuf,
    store: KnowledgeStore,
}

impl Indexer {
    pub fn new(root: impl AsRef<Path>) -> Result<Self> {
        let root = root
            .as_ref()
            .canonicalize()
            .unwrap_or_else(|_| root.as_ref().to_path_buf());
        let store = KnowledgeStore::open(&root)?;
        Ok(Self { root, store })
    }

    pub fn store(&self) -> &KnowledgeStore {
        &self.store
    }

    pub fn store_mut(&mut self) -> &mut KnowledgeStore {
        &mut self.store
    }

    pub fn init(&self) -> Result<()> {
        util::ensure_cumulus_dir(&self.root)?;
        self.store.init_schema()
    }

    pub fn index(&mut self, options: IndexOptions) -> Result<IndexReport> {
        self.init()?;
        self.store.clear_all()?;

        let mut skipped = Vec::new();
        let project = self.project_node();
        self.store.upsert_node(&project)?;

        let mut folder_nodes = HashMap::new();
        folder_nodes.insert(PathBuf::new(), project.id.clone());
        let mut seen_dirs = HashSet::new();

        let walker = WalkBuilder::new(&self.root)
            .hidden(false)
            .standard_filters(true)
            .build();

        for entry in walker {
            let entry = match entry {
                Ok(entry) => entry,
                Err(err) => {
                    skipped.push(err.to_string());
                    continue;
                }
            };
            let path = entry.path();
            let Ok(rel) = path.strip_prefix(&self.root) else {
                continue;
            };
            if rel.as_os_str().is_empty() || is_cumulus_path(rel) {
                continue;
            }

            if entry.file_type().map(|t| t.is_dir()).unwrap_or(false) {
                self.ensure_folder(rel, &mut folder_nodes, &mut seen_dirs)?;
                continue;
            }

            if !entry.file_type().map(|t| t.is_file()).unwrap_or(false) {
                continue;
            }

            let Some(parent) = rel.parent() else {
                continue;
            };
            self.ensure_folder(parent, &mut folder_nodes, &mut seen_dirs)?;

            if let Err(err) = self.index_file(path, rel, &folder_nodes, &options) {
                skipped.push(format!("{}: {err}", rel.display()));
            }
        }

        let manifest = self.store.write_manifest(&options.profile.to_string())?;
        let stats = self.store.stats()?;
        Ok(IndexReport {
            manifest,
            stats,
            skipped,
        })
    }

    fn project_node(&self) -> Node {
        let now = Utc::now();
        let label = self
            .root
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or("project")
            .to_string();
        Node {
            id: util::stable_id("project", self.root.display().to_string()),
            kind: "project".to_string(),
            label,
            uri: util::path_to_uri("."),
            source_id: None,
            summary: Some("Indexed Cumulus knowledge root".to_string()),
            metadata: util::metadata([("path", json!(self.root.display().to_string()))]),
            created_at: now,
            updated_at: now,
        }
    }

    fn ensure_folder(
        &self,
        rel: &Path,
        folder_nodes: &mut HashMap<PathBuf, String>,
        seen_dirs: &mut HashSet<PathBuf>,
    ) -> Result<String> {
        let rel = rel.to_path_buf();
        if let Some(id) = folder_nodes.get(&rel) {
            return Ok(id.clone());
        }
        if rel.as_os_str().is_empty() {
            return folder_nodes
                .get(&PathBuf::new())
                .cloned()
                .ok_or_else(|| anyhow!("project root node missing"));
        }
        if let Some(parent) = rel.parent() {
            self.ensure_folder(parent, folder_nodes, seen_dirs)?;
        }
        if seen_dirs.insert(rel.clone()) {
            let now = Utc::now();
            let label = rel
                .file_name()
                .and_then(|n| n.to_str())
                .unwrap_or(".")
                .to_string();
            let id = util::stable_id("folder", rel.display().to_string());
            let node = Node {
                id: id.clone(),
                kind: "folder".to_string(),
                label,
                uri: util::path_to_uri(&rel.display().to_string()),
                source_id: None,
                summary: Some(format!("Folder {}", rel.display())),
                metadata: util::metadata([("path", json!(rel.display().to_string()))]),
                created_at: now,
                updated_at: now,
            };
            self.store.upsert_node(&node)?;
            let parent_rel = rel.parent().unwrap_or_else(|| Path::new(""));
            let parent_id = self.ensure_folder(parent_rel, folder_nodes, seen_dirs)?;
            self.store
                .upsert_edge(&edge("contains", &parent_id, &id, Some("contains")))?;
            folder_nodes.insert(rel.clone(), id.clone());
            return Ok(id);
        }
        folder_nodes
            .get(&rel)
            .cloned()
            .ok_or_else(|| anyhow!("folder node missing after insertion: {}", rel.display()))
    }

    fn index_file(
        &self,
        path: &Path,
        rel: &Path,
        folder_nodes: &HashMap<PathBuf, String>,
        options: &IndexOptions,
    ) -> Result<()> {
        let meta = fs::metadata(path).with_context(|| format!("stat {}", path.display()))?;
        if meta.len() as usize > options.max_file_bytes {
            anyhow::bail!("skipped large file ({} bytes)", meta.len());
        }
        let bytes = fs::read(path).with_context(|| format!("read {}", path.display()))?;
        if !util::is_probably_text(&bytes) {
            anyhow::bail!("skipped binary file");
        }
        let text = String::from_utf8(bytes.clone()).context("file is not utf-8 text")?;
        if !profile_accepts(options.profile, rel) {
            return Ok(());
        }

        let rel_str = rel.display().to_string();
        let source_id = util::stable_id("source", &rel_str);
        let title = rel
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or(&rel_str)
            .to_string();
        let source = Source {
            id: source_id.clone(),
            path: rel_str.clone(),
            title: title.clone(),
            mime_type: util::mime_for_path(path),
            sha256: util::sha256_hex(&bytes),
            size_bytes: meta.len(),
            modified_at: util::modified_time(&meta),
            metadata: util::metadata([
                ("profile", json!(options.profile.to_string())),
                ("absolute_path", json!(path.display().to_string())),
            ]),
        };
        self.store.upsert_source(&source)?;

        let now = Utc::now();
        let file_id = util::stable_id("file", &rel_str);
        let file_node = Node {
            id: file_id.clone(),
            kind: "file".to_string(),
            label: title,
            uri: util::path_to_uri(&rel_str),
            source_id: Some(source_id.clone()),
            summary: Some(first_non_empty_line(&text).unwrap_or_else(|| rel_str.clone())),
            metadata: util::metadata([
                ("path", json!(rel_str)),
                ("mime_type", json!(source.mime_type)),
                ("sha256", json!(source.sha256)),
            ]),
            created_at: now,
            updated_at: now,
        };
        self.store.upsert_node(&file_node)?;

        let parent_id = rel
            .parent()
            .and_then(|p| folder_nodes.get(p))
            .or_else(|| folder_nodes.get(&PathBuf::new()))
            .cloned()
            .ok_or_else(|| anyhow!("parent folder missing for {}", rel.display()))?;
        self.store
            .upsert_edge(&edge("contains", &parent_id, &file_id, Some("contains")))?;

        let mut chunks = chunk_text(&source_id, &file_id, &text, options.max_chunk_tokens);
        for chunk in &mut chunks {
            chunk.node_id = chunk.id.clone();
            let chunk_node = Node {
                id: chunk.id.clone(),
                kind: "chunk".to_string(),
                label: format!("{}:{}-{}", source.path, chunk.start_line, chunk.end_line),
                uri: util::chunk_uri(&chunk.id),
                source_id: Some(source_id.clone()),
                summary: Some(
                    first_non_empty_line(&chunk.text).unwrap_or_else(|| "Text chunk".to_string()),
                ),
                metadata: util::metadata([
                    ("path", json!(source.path)),
                    ("start_line", json!(chunk.start_line)),
                    ("end_line", json!(chunk.end_line)),
                    ("token_estimate", json!(chunk.token_estimate)),
                ]),
                created_at: now,
                updated_at: now,
            };
            self.store.upsert_node(&chunk_node)?;
            self.store
                .upsert_edge(&edge("contains", &file_id, &chunk.id, Some("chunk")))?;
            self.store
                .upsert_edge(&edge("chunk_of", &chunk.id, &file_id, Some("chunk_of")))?;
            self.store.upsert_chunk(chunk)?;
        }

        for symbol in extract_symbols(&source_id, &file_id, rel, &text) {
            self.store.upsert_node(&symbol)?;
            self.store
                .upsert_edge(&edge("defines", &file_id, &symbol.id, Some("defines")))?;
        }
        for import in extract_imports(&file_id, rel, &text) {
            self.store.upsert_node(&import)?;
            self.store
                .upsert_edge(&edge("imports", &file_id, &import.id, Some("imports")))?;
        }
        for entity in extract_domain_entities(&source_id, &file_id, rel, &text) {
            self.store.upsert_node(&entity)?;
            self.store
                .upsert_edge(&edge("mentions", &file_id, &entity.id, Some("mentions")))?;
        }

        Ok(())
    }
}

fn profile_accepts(profile: IndexProfile, rel: &Path) -> bool {
    match profile {
        IndexProfile::All => true,
        IndexProfile::Facility => true,
        IndexProfile::Docs => matches!(
            rel.extension().and_then(|e| e.to_str()).unwrap_or_default(),
            "md" | "mdx" | "txt" | "rst" | "adoc" | "json" | "yaml" | "yml" | "toml"
        ),
        IndexProfile::Code => matches!(
            rel.extension().and_then(|e| e.to_str()).unwrap_or_default(),
            "rs" | "py" | "ts" | "tsx" | "js" | "jsx" | "go" | "java" | "c" | "h" | "cpp" | "hpp"
        ),
    }
}

fn is_cumulus_path(rel: &Path) -> bool {
    rel.components()
        .next()
        .and_then(|c| c.as_os_str().to_str())
        .map(|c| c == ".cumulus")
        .unwrap_or(false)
}

fn first_non_empty_line(text: &str) -> Option<String> {
    text.lines()
        .map(str::trim)
        .find(|line| !line.is_empty())
        .map(|line| line.chars().take(180).collect())
}

fn extract_symbols(source_id: &str, file_id: &str, rel: &Path, text: &str) -> Vec<Node> {
    let mut symbols = Vec::new();
    let now = Utc::now();
    let ext = rel.extension().and_then(|e| e.to_str()).unwrap_or_default();
    for (idx, line) in text.lines().enumerate() {
        if let Some((kind, name)) = parse_symbol_line(ext, line) {
            let id = util::stable_id("symbol", format!("{}:{}:{name}", rel.display(), idx + 1));
            let mut meta: Metadata = util::metadata([
                ("path", json!(rel.display().to_string())),
                ("line", json!(idx + 1)),
                ("parser", json!("heuristic")),
                ("file_node_id", json!(file_id)),
            ]);
            meta.insert("symbol_kind".to_string(), json!(kind));
            symbols.push(Node {
                id,
                kind: "symbol".to_string(),
                label: name,
                uri: format!(
                    "{}#L{}",
                    util::path_to_uri(&rel.display().to_string()),
                    idx + 1
                ),
                source_id: Some(source_id.to_string()),
                summary: Some(line.trim().chars().take(220).collect()),
                metadata: meta,
                created_at: now,
                updated_at: now,
            });
        }
    }
    symbols
}

fn parse_symbol_line(ext: &str, line: &str) -> Option<(&'static str, String)> {
    let trimmed = line.trim_start();
    let prefixes: &[(&str, &str)] = match ext {
        "rs" => &[
            ("fn ", "function"),
            ("pub fn ", "function"),
            ("struct ", "type"),
            ("pub struct ", "type"),
            ("enum ", "type"),
            ("trait ", "type"),
            ("impl ", "impl"),
        ],
        "py" => &[
            ("def ", "function"),
            ("async def ", "function"),
            ("class ", "type"),
        ],
        "ts" | "tsx" | "js" | "jsx" => &[
            ("function ", "function"),
            ("export function ", "function"),
            ("class ", "type"),
            ("export class ", "type"),
            ("interface ", "type"),
            ("export interface ", "type"),
            ("type ", "type"),
            ("export type ", "type"),
        ],
        "go" => &[("func ", "function"), ("type ", "type")],
        "java" => &[
            ("class ", "type"),
            ("interface ", "type"),
            ("enum ", "type"),
        ],
        _ => &[],
    };
    for (prefix, kind) in prefixes {
        if let Some(rest) = trimmed.strip_prefix(prefix) {
            let name = rest
                .split(|c: char| !(c.is_alphanumeric() || c == '_' || c == '-'))
                .next()
                .unwrap_or_default()
                .trim();
            if !name.is_empty() {
                return Some((kind, name.to_string()));
            }
        }
    }
    None
}

fn extract_imports(file_id: &str, rel: &Path, text: &str) -> Vec<Node> {
    let mut imports = Vec::new();
    let now = Utc::now();
    for (idx, line) in text.lines().enumerate() {
        let trimmed = line.trim();
        let target = if let Some(rest) = trimmed.strip_prefix("use ") {
            Some(rest.trim_end_matches(';').trim())
        } else if let Some(rest) = trimmed.strip_prefix("import ") {
            Some(rest.trim())
        } else if let Some(rest) = trimmed.strip_prefix("from ") {
            rest.split_whitespace().next()
        } else {
            trimmed
                .strip_prefix("require(")
                .map(|rest| rest.trim_matches(&['"', '\'', ')', ';'][..]))
        };
        let Some(target) = target else {
            continue;
        };
        if target.is_empty() || target.len() > 180 {
            continue;
        }
        let id = util::stable_id("ref", target);
        imports.push(Node {
            id,
            kind: "reference".to_string(),
            label: target.to_string(),
            uri: format!("cumulus://reference/{target}"),
            source_id: None,
            summary: Some(format!("Imported by {} at line {}", rel.display(), idx + 1)),
            metadata: util::metadata([
                ("target", json!(target)),
                ("imported_by", json!(file_id)),
                ("path", json!(rel.display().to_string())),
                ("line", json!(idx + 1)),
            ]),
            created_at: now,
            updated_at: now,
        });
    }
    imports
}

fn extract_domain_entities(source_id: &str, file_id: &str, rel: &Path, text: &str) -> Vec<Node> {
    let mut entities = Vec::new();
    let now = Utc::now();
    let path = rel.display().to_string();
    for (idx, line) in text.lines().enumerate() {
        let trimmed = line.trim().trim_matches(['-', '*', '#', ' ']);
        if trimmed.is_empty() || trimmed.len() > 240 {
            continue;
        }
        for (kind, value) in parse_domain_line(trimmed) {
            let display = display_for_domain(kind, &value);
            let id = util::stable_id("entity", format!("{kind}:{value}:{}", path));
            entities.push(Node {
                id,
                kind: kind.to_string(),
                label: value.clone(),
                uri: format!("cumulus://{kind}/{}", slug(&value)),
                source_id: Some(source_id.to_string()),
                summary: Some(trimmed.to_string()),
                metadata: util::metadata([
                    ("domain_kind", json!(kind)),
                    ("display_label", json!(display)),
                    ("path", json!(path.clone())),
                    ("line", json!(idx + 1)),
                    ("parser", json!("operations-heuristic")),
                    ("file_node_id", json!(file_id)),
                    ("confidence", json!(0.72)),
                ]),
                created_at: now,
                updated_at: now,
            });
        }
    }
    entities
}

fn parse_domain_line(line: &str) -> Vec<(&'static str, String)> {
    let lower = line.to_ascii_lowercase();
    let mut out = Vec::new();
    if let Some(value) = invoice_identifier(line) {
        out.push(("invoice", value));
    }
    if let Some(value) = after_label(line, &["draw request", "bank draw", "draw"]) {
        out.push(("bank_draw", value));
    }
    if let Some(value) = after_label(line, &["vendor", "contractor"]) {
        out.push(("vendor", value));
    }
    if let Some(value) = after_label(line, &["supplier"]) {
        out.push(("supplier", value));
    }
    if let Some(value) = after_label(line, &["client", "owner"]) {
        out.push(("client", value));
    }
    if let Some(value) = after_label_with_separator(line, &["bank", "lender"]) {
        out.push(("bank", value));
    }
    if lower.contains("shipment") || lower.contains("shipping") || lower.contains("delivery") {
        out.push(("shipment", compact_line(line)));
    }
    if lower.contains("milestone") || lower.contains("inspection") || lower.contains("phase ") {
        out.push(("milestone", compact_line(line)));
    }
    if lower.contains("material")
        || lower.contains("steel")
        || lower.contains("concrete")
        || lower.contains("fixture")
    {
        out.push(("material", compact_line(line)));
    }
    if lower.contains("risk")
        || lower.contains("delay")
        || lower.contains("overdue")
        || lower.contains("blocked")
    {
        out.push(("risk", compact_line(line)));
    }
    if lower.contains("conflict") || lower.contains("mismatch") || lower.contains("does not match")
    {
        out.push(("conflict", compact_line(line)));
    }
    out
}

fn invoice_identifier(line: &str) -> Option<String> {
    for label in ["invoice", "inv"] {
        if let Some(value) = token_after(line, label) {
            return Some(value);
        }
    }
    after_label(line, &["invoice", "inv"])
}

fn after_label(line: &str, labels: &[&str]) -> Option<String> {
    let lower = line.to_ascii_lowercase();
    for label in labels {
        if let Some(pos) = lower.find(label) {
            let rest = &line[pos + label.len()..];
            let rest = rest.trim_start_matches([' ', ':', '#', '-']);
            if !rest.is_empty() {
                return Some(compact_line(rest));
            }
        }
    }
    None
}

fn after_label_with_separator(line: &str, labels: &[&str]) -> Option<String> {
    let lower = line.to_ascii_lowercase();
    for label in labels {
        if let Some(pos) = lower.find(label) {
            let rest = &line[pos + label.len()..];
            if !rest.starts_with(':') && !rest.starts_with(" #") {
                continue;
            }
            let rest = rest.trim_start_matches([' ', ':', '#', '-']);
            if !rest.is_empty() {
                return Some(compact_line(rest));
            }
        }
    }
    None
}

fn token_after(line: &str, label: &str) -> Option<String> {
    let lower = line.to_ascii_lowercase();
    let pos = lower.find(label)?;
    let rest = line[pos + label.len()..].trim_start_matches([' ', ':', '#', '-']);
    let token = rest
        .split_whitespace()
        .next()
        .unwrap_or_default()
        .trim_matches([':', ',', '.', ';']);
    (!token.is_empty()).then(|| token.to_string())
}

fn compact_line(line: &str) -> String {
    line.trim()
        .trim_matches([':', '-', '*', '#', ' '])
        .chars()
        .take(96)
        .collect()
}

fn display_for_domain(kind: &str, value: &str) -> String {
    let prefix = match kind {
        "invoice" => "Invoice",
        "bank_draw" => "Bank Draw Request",
        "vendor" => "Vendor",
        "supplier" => "Supplier",
        "client" => "Client",
        "bank" => "Bank",
        "shipment" => "Delivery",
        "milestone" => "Milestone",
        "material" => "Material",
        "risk" => "Schedule Risk",
        "conflict" => "Conflict",
        _ => "Entity",
    };
    if matches!(kind, "invoice" | "bank_draw")
        && !value
            .to_ascii_lowercase()
            .starts_with(&prefix.to_ascii_lowercase())
    {
        return format!("{prefix} {value}");
    }
    if value
        .to_ascii_lowercase()
        .starts_with(&prefix.to_ascii_lowercase())
    {
        value.to_string()
    } else {
        format!("{prefix}: {value}")
    }
}

fn slug(value: &str) -> String {
    value
        .chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() {
                c.to_ascii_lowercase()
            } else {
                '-'
            }
        })
        .collect::<String>()
        .split('-')
        .filter(|part| !part.is_empty())
        .collect::<Vec<_>>()
        .join("-")
}

fn edge(kind: &str, from_id: &str, to_id: &str, label: Option<&str>) -> Edge {
    Edge {
        id: util::stable_id("edge", format!("{kind}:{from_id}:{to_id}")),
        kind: kind.to_string(),
        from_id: from_id.to_string(),
        to_id: to_id.to_string(),
        label: label.map(ToString::to_string),
        metadata: util::metadata([("source", json!("cumulus-indexer"))]),
        created_at: Utc::now(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    #[test]
    fn indexes_symbols_and_chunks() {
        let dir = tempfile::tempdir().unwrap();
        fs::write(
            dir.path().join("lib.py"),
            "import os\n\ndef hello():\n    return os.getcwd()\n",
        )
        .unwrap();
        let mut indexer = Indexer::new(dir.path()).unwrap();
        let report = indexer.index(IndexOptions::default()).unwrap();
        assert!(report.stats.node_count >= 4);
        let hits = indexer.store.search("hello", 10).unwrap();
        assert!(!hits.is_empty());
    }
}
