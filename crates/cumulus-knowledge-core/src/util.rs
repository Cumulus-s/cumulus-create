use anyhow::{Context, Result};
use chrono::{DateTime, Utc};
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::{
    collections::BTreeMap,
    fs,
    path::{Path, PathBuf},
    time::SystemTime,
};

use crate::models::Metadata;

pub fn cumulus_dir(root: &Path) -> PathBuf {
    root.join(".cumulus")
}

pub fn db_path(root: &Path) -> PathBuf {
    cumulus_dir(root).join("knowledge.sqlite")
}

pub fn manifest_path(root: &Path) -> PathBuf {
    cumulus_dir(root).join("manifest.json")
}

pub fn ensure_cumulus_dir(root: &Path) -> Result<PathBuf> {
    let dir = cumulus_dir(root);
    fs::create_dir_all(&dir).with_context(|| format!("creating {}", dir.display()))?;
    Ok(dir)
}

pub fn stable_id(prefix: &str, input: impl AsRef<[u8]>) -> String {
    let digest = Sha256::digest(input.as_ref());
    let mut out = String::with_capacity(prefix.len() + 1 + 24);
    out.push_str(prefix);
    out.push('_');
    for b in digest.iter().take(12) {
        out.push_str(&format!("{b:02x}"));
    }
    out
}

pub fn sha256_hex(bytes: &[u8]) -> String {
    let digest = Sha256::digest(bytes);
    digest.iter().map(|b| format!("{b:02x}")).collect()
}

pub fn path_to_uri(path: &str) -> String {
    format!("cumulus://path/{}", path.replace('\\', "/"))
}

pub fn node_uri(id: &str) -> String {
    format!("cumulus://node/{id}")
}

pub fn chunk_uri(id: &str) -> String {
    format!("cumulus://chunk/{id}")
}

pub fn snapshot_uri(id: &str) -> String {
    format!("cumulus://snapshot/{id}")
}

pub fn modified_time(meta: &fs::Metadata) -> Option<DateTime<Utc>> {
    meta.modified()
        .ok()
        .and_then(|time| system_time_to_utc(time).ok())
}

fn system_time_to_utc(time: SystemTime) -> Result<DateTime<Utc>> {
    Ok(DateTime::<Utc>::from(time))
}

pub fn metadata(entries: impl IntoIterator<Item = (impl Into<String>, Value)>) -> Metadata {
    let mut out: BTreeMap<String, Value> = BTreeMap::new();
    for (k, v) in entries {
        out.insert(k.into(), v);
    }
    out
}

pub fn estimate_tokens(text: &str) -> usize {
    let words = text.split_whitespace().count();
    words.saturating_mul(4).div_ceil(3).max(1)
}

pub fn is_probably_text(bytes: &[u8]) -> bool {
    if bytes.is_empty() {
        return true;
    }
    let sample = &bytes[..bytes.len().min(8192)];
    let nul = sample.iter().filter(|b| **b == 0).count();
    if nul > 0 {
        return false;
    }
    std::str::from_utf8(sample).is_ok()
}

pub fn mime_for_path(path: &Path) -> String {
    match path
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or_default()
        .to_ascii_lowercase()
        .as_str()
    {
        "md" | "mdx" => "text/markdown",
        "json" => "application/json",
        "toml" => "application/toml",
        "yaml" | "yml" => "application/yaml",
        "rs" => "text/x-rust",
        "ts" | "tsx" => "text/typescript",
        "js" | "jsx" => "text/javascript",
        "py" => "text/x-python",
        "go" => "text/x-go",
        "java" => "text/x-java",
        "c" | "h" => "text/x-c",
        "cpp" | "cc" | "hpp" => "text/x-c++",
        "html" | "htm" => "text/html",
        "css" => "text/css",
        "txt" => "text/plain",
        _ => "text/plain",
    }
    .to_string()
}
