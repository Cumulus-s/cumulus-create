use anyhow::{anyhow, Context, Result};
use chrono::{DateTime, Utc};
use rusqlite::{params, Connection, OptionalExtension, Row};
use serde_json::json;
use std::{
    collections::{HashMap, HashSet, VecDeque},
    fs,
    path::{Path, PathBuf},
};

use crate::{
    graph_view::{build_graph_view, GraphViewPreset},
    models::{
        Chunk, Edge, GraphExpansion, GraphSnapshot, GraphView, IndexManifest, IndexStats, Metadata,
        Node, PathExplanation, SearchHit, Source, VERSION,
    },
    util,
};

pub struct KnowledgeStore {
    root: PathBuf,
    db_path: PathBuf,
    conn: Connection,
}

impl KnowledgeStore {
    pub fn open(root: impl AsRef<Path>) -> Result<Self> {
        let root = root
            .as_ref()
            .canonicalize()
            .unwrap_or_else(|_| root.as_ref().to_path_buf());
        util::ensure_cumulus_dir(&root)?;
        let db_path = util::db_path(&root);
        let conn =
            Connection::open(&db_path).with_context(|| format!("opening {}", db_path.display()))?;
        let store = Self {
            root,
            db_path,
            conn,
        };
        store.init_schema()?;
        Ok(store)
    }

    pub fn root(&self) -> &Path {
        &self.root
    }

    pub fn database_path(&self) -> &Path {
        &self.db_path
    }

    pub fn init_schema(&self) -> Result<()> {
        self.conn.execute_batch(
            r#"
            PRAGMA foreign_keys = ON;
            CREATE TABLE IF NOT EXISTS meta (
              key TEXT PRIMARY KEY,
              value TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS sources (
              id TEXT PRIMARY KEY,
              path TEXT NOT NULL UNIQUE,
              title TEXT NOT NULL,
              mime_type TEXT NOT NULL,
              sha256 TEXT NOT NULL,
              size_bytes INTEGER NOT NULL,
              modified_at TEXT,
              metadata TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS nodes (
              id TEXT PRIMARY KEY,
              kind TEXT NOT NULL,
              label TEXT NOT NULL,
              uri TEXT NOT NULL,
              source_id TEXT,
              summary TEXT,
              metadata TEXT NOT NULL,
              created_at TEXT NOT NULL,
              updated_at TEXT NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_nodes_kind ON nodes(kind);
            CREATE INDEX IF NOT EXISTS idx_nodes_source ON nodes(source_id);
            CREATE TABLE IF NOT EXISTS edges (
              id TEXT PRIMARY KEY,
              kind TEXT NOT NULL,
              from_id TEXT NOT NULL,
              to_id TEXT NOT NULL,
              label TEXT,
              metadata TEXT NOT NULL,
              created_at TEXT NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_edges_from ON edges(from_id);
            CREATE INDEX IF NOT EXISTS idx_edges_to ON edges(to_id);
            CREATE UNIQUE INDEX IF NOT EXISTS idx_edges_unique ON edges(kind, from_id, to_id);
            CREATE TABLE IF NOT EXISTS chunks (
              id TEXT PRIMARY KEY,
              source_id TEXT NOT NULL,
              node_id TEXT NOT NULL,
              text TEXT NOT NULL,
              start_line INTEGER NOT NULL,
              end_line INTEGER NOT NULL,
              token_estimate INTEGER NOT NULL,
              metadata TEXT NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_chunks_source ON chunks(source_id);
            CREATE INDEX IF NOT EXISTS idx_chunks_node ON chunks(node_id);
            CREATE VIRTUAL TABLE IF NOT EXISTS chunks_fts USING fts5(
              chunk_id UNINDEXED,
              node_id UNINDEXED,
              source_id UNINDEXED,
              text
            );
            "#,
        )?;
        Ok(())
    }

    pub fn clear_all(&mut self) -> Result<()> {
        let tx = self.conn.transaction()?;
        tx.execute("DELETE FROM chunks_fts", [])?;
        tx.execute("DELETE FROM chunks", [])?;
        tx.execute("DELETE FROM edges", [])?;
        tx.execute("DELETE FROM nodes", [])?;
        tx.execute("DELETE FROM sources", [])?;
        tx.commit()?;
        Ok(())
    }

    pub fn upsert_source(&self, source: &Source) -> Result<()> {
        self.conn.execute(
            r#"
            INSERT INTO sources (id, path, title, mime_type, sha256, size_bytes, modified_at, metadata)
            VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
            ON CONFLICT(id) DO UPDATE SET
              path=excluded.path,
              title=excluded.title,
              mime_type=excluded.mime_type,
              sha256=excluded.sha256,
              size_bytes=excluded.size_bytes,
              modified_at=excluded.modified_at,
              metadata=excluded.metadata
            "#,
            params![
                source.id,
                source.path,
                source.title,
                source.mime_type,
                source.sha256,
                source.size_bytes as i64,
                source.modified_at.map(|d| d.to_rfc3339()),
                serde_json::to_string(&source.metadata)?,
            ],
        )?;
        Ok(())
    }

    pub fn upsert_node(&self, node: &Node) -> Result<()> {
        self.conn.execute(
            r#"
            INSERT INTO nodes (id, kind, label, uri, source_id, summary, metadata, created_at, updated_at)
            VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)
            ON CONFLICT(id) DO UPDATE SET
              kind=excluded.kind,
              label=excluded.label,
              uri=excluded.uri,
              source_id=excluded.source_id,
              summary=excluded.summary,
              metadata=excluded.metadata,
              updated_at=excluded.updated_at
            "#,
            params![
                node.id,
                node.kind,
                node.label,
                node.uri,
                node.source_id,
                node.summary,
                serde_json::to_string(&node.metadata)?,
                node.created_at.to_rfc3339(),
                node.updated_at.to_rfc3339(),
            ],
        )?;
        Ok(())
    }

    pub fn upsert_edge(&self, edge: &Edge) -> Result<()> {
        self.conn.execute(
            r#"
            INSERT INTO edges (id, kind, from_id, to_id, label, metadata, created_at)
            VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
            ON CONFLICT(kind, from_id, to_id) DO UPDATE SET
              label=excluded.label,
              metadata=excluded.metadata
            "#,
            params![
                edge.id,
                edge.kind,
                edge.from_id,
                edge.to_id,
                edge.label,
                serde_json::to_string(&edge.metadata)?,
                edge.created_at.to_rfc3339(),
            ],
        )?;
        Ok(())
    }

    pub fn upsert_chunk(&self, chunk: &Chunk) -> Result<()> {
        self.conn.execute(
            "DELETE FROM chunks_fts WHERE chunk_id = ?1",
            params![chunk.id],
        )?;
        self.conn.execute(
            r#"
            INSERT INTO chunks (id, source_id, node_id, text, start_line, end_line, token_estimate, metadata)
            VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
            ON CONFLICT(id) DO UPDATE SET
              source_id=excluded.source_id,
              node_id=excluded.node_id,
              text=excluded.text,
              start_line=excluded.start_line,
              end_line=excluded.end_line,
              token_estimate=excluded.token_estimate,
              metadata=excluded.metadata
            "#,
            params![
                chunk.id,
                chunk.source_id,
                chunk.node_id,
                chunk.text,
                chunk.start_line as i64,
                chunk.end_line as i64,
                chunk.token_estimate as i64,
                serde_json::to_string(&chunk.metadata)?,
            ],
        )?;
        self.conn.execute(
            "INSERT INTO chunks_fts (chunk_id, node_id, source_id, text) VALUES (?1, ?2, ?3, ?4)",
            params![chunk.id, chunk.node_id, chunk.source_id, chunk.text],
        )?;
        Ok(())
    }

    pub fn stats(&self) -> Result<IndexStats> {
        Ok(IndexStats {
            root_path: self.root.display().to_string(),
            database_path: self.db_path.display().to_string(),
            source_count: self.count("sources")?,
            node_count: self.count("nodes")?,
            edge_count: self.count("edges")?,
            chunk_count: self.count("chunks")?,
        })
    }

    fn count(&self, table: &str) -> Result<usize> {
        let sql = format!("SELECT COUNT(*) FROM {table}");
        let count: i64 = self.conn.query_row(&sql, [], |row| row.get(0))?;
        Ok(count as usize)
    }

    pub fn write_manifest(&self, profile: &str) -> Result<IndexManifest> {
        let stats = self.stats()?;
        let now = Utc::now();
        let manifest = IndexManifest {
            version: VERSION.to_string(),
            root_path: self.root.display().to_string(),
            profile: profile.to_string(),
            created_at: now,
            updated_at: now,
            source_count: stats.source_count,
            node_count: stats.node_count,
            edge_count: stats.edge_count,
            chunk_count: stats.chunk_count,
        };
        let path = util::manifest_path(&self.root);
        fs::write(&path, serde_json::to_vec_pretty(&manifest)?)
            .with_context(|| format!("writing {}", path.display()))?;
        Ok(manifest)
    }

    pub fn get_node(&self, id: &str) -> Result<Option<Node>> {
        self.conn
            .query_row(
                "SELECT id, kind, label, uri, source_id, summary, metadata, created_at, updated_at FROM nodes WHERE id = ?1",
                params![id],
                row_to_node,
            )
            .optional()
            .map_err(Into::into)
    }

    pub fn get_chunk(&self, id: &str) -> Result<Option<Chunk>> {
        self.conn
            .query_row(
                "SELECT id, source_id, node_id, text, start_line, end_line, token_estimate, metadata FROM chunks WHERE id = ?1",
                params![id],
                row_to_chunk,
            )
            .optional()
            .map_err(Into::into)
    }

    pub fn search(&self, query: &str, limit: usize) -> Result<Vec<SearchHit>> {
        let fts_query = build_fts_query(query);
        if fts_query.is_empty() {
            return Ok(Vec::new());
        }

        let result = self.search_fts(&fts_query, limit);
        match result {
            Ok(hits) => Ok(hits),
            Err(_) => self.search_like(query, limit),
        }
    }

    fn search_fts(&self, query: &str, limit: usize) -> Result<Vec<SearchHit>> {
        let mut stmt = self.conn.prepare(
            r#"
            SELECT
              n.id, n.kind, n.label, n.uri, n.source_id, n.summary, n.metadata, n.created_at, n.updated_at,
              c.id,
              bm25(chunks_fts) AS rank,
              snippet(chunks_fts, 3, '[', ']', '...', 18) AS snippet
            FROM chunks_fts
            JOIN chunks c ON chunks_fts.chunk_id = c.id
            JOIN nodes n ON c.node_id = n.id
            WHERE chunks_fts MATCH ?1
            ORDER BY rank
            LIMIT ?2
            "#,
        )?;
        let rows = stmt.query_map(params![query, limit as i64], |row| {
            let node = row_to_node(row)?;
            let chunk_id: String = row.get(9)?;
            let rank: f64 = row.get(10)?;
            let snippet: String = row.get(11)?;
            Ok(SearchHit {
                resource_uri: util::chunk_uri(&chunk_id),
                node,
                chunk_id: Some(chunk_id),
                score: 1.0 / (1.0 + rank.abs()),
                snippet,
            })
        })?;
        rows.collect::<rusqlite::Result<Vec<_>>>()
            .map_err(Into::into)
    }

    fn search_like(&self, query: &str, limit: usize) -> Result<Vec<SearchHit>> {
        let needle = format!("%{}%", query.to_ascii_lowercase());
        let mut stmt = self.conn.prepare(
            r#"
            SELECT
              n.id, n.kind, n.label, n.uri, n.source_id, n.summary, n.metadata, n.created_at, n.updated_at,
              c.id,
              c.text
            FROM chunks c
            JOIN nodes n ON c.node_id = n.id
            WHERE lower(c.text) LIKE ?1 OR lower(n.label) LIKE ?1
            LIMIT ?2
            "#,
        )?;
        let rows = stmt.query_map(params![needle, limit as i64], |row| {
            let node = row_to_node(row)?;
            let chunk_id: String = row.get(9)?;
            let text: String = row.get(10)?;
            Ok(SearchHit {
                resource_uri: util::chunk_uri(&chunk_id),
                node,
                chunk_id: Some(chunk_id),
                score: 0.5,
                snippet: make_snippet(&text, query),
            })
        })?;
        rows.collect::<rusqlite::Result<Vec<_>>>()
            .map_err(Into::into)
    }

    pub fn expand(&self, root_id: &str, depth: usize) -> Result<GraphExpansion> {
        if self.get_node(root_id)?.is_none() {
            return Err(anyhow!("node not found: {root_id}"));
        }

        let mut visited_nodes: HashSet<String> = HashSet::new();
        let mut visited_edges: HashSet<String> = HashSet::new();
        let mut queue = VecDeque::from([(root_id.to_string(), 0usize)]);
        visited_nodes.insert(root_id.to_string());

        while let Some((node_id, d)) = queue.pop_front() {
            if d >= depth {
                continue;
            }
            for edge in self.edges_for_node(&node_id)? {
                visited_edges.insert(edge.id.clone());
                for next in [&edge.from_id, &edge.to_id] {
                    if visited_nodes.insert(next.clone()) {
                        queue.push_back((next.clone(), d + 1));
                    }
                }
            }
        }

        let mut nodes = Vec::new();
        for id in visited_nodes {
            if let Some(node) = self.get_node(&id)? {
                nodes.push(node);
            }
        }
        let mut edges = Vec::new();
        for id in visited_edges {
            if let Some(edge) = self.get_edge(&id)? {
                edges.push(edge);
            }
        }
        nodes.sort_by(|a, b| a.id.cmp(&b.id));
        edges.sort_by(|a, b| a.id.cmp(&b.id));

        Ok(GraphExpansion {
            root_id: root_id.to_string(),
            depth,
            nodes,
            edges,
        })
    }

    pub fn find_path(
        &self,
        from_id: &str,
        to_id: &str,
        max_depth: usize,
    ) -> Result<Option<PathExplanation>> {
        if self.get_node(from_id)?.is_none() || self.get_node(to_id)?.is_none() {
            return Ok(None);
        }

        let mut queue = VecDeque::from([(from_id.to_string(), 0usize)]);
        let mut seen: HashSet<String> = HashSet::from([from_id.to_string()]);
        let mut prev: HashMap<String, (String, Edge)> = HashMap::new();

        while let Some((node_id, depth)) = queue.pop_front() {
            if node_id == to_id {
                break;
            }
            if depth >= max_depth {
                continue;
            }
            for edge in self.edges_for_node(&node_id)? {
                let next = if edge.from_id == node_id {
                    edge.to_id.clone()
                } else {
                    edge.from_id.clone()
                };
                if seen.insert(next.clone()) {
                    prev.insert(next.clone(), (node_id.clone(), edge));
                    queue.push_back((next, depth + 1));
                }
            }
        }

        if !seen.contains(to_id) {
            return Ok(None);
        }

        let mut node_ids = vec![to_id.to_string()];
        let mut edges = Vec::new();
        let mut cursor = to_id.to_string();
        while cursor != from_id {
            let Some((parent, edge)) = prev.get(&cursor).cloned() else {
                return Ok(None);
            };
            edges.push(edge);
            node_ids.push(parent.clone());
            cursor = parent;
        }
        node_ids.reverse();
        edges.reverse();

        let mut nodes = Vec::new();
        for id in node_ids {
            if let Some(node) = self.get_node(&id)? {
                nodes.push(node);
            }
        }

        Ok(Some(PathExplanation {
            from_id: from_id.to_string(),
            to_id: to_id.to_string(),
            nodes,
            edges,
        }))
    }

    pub fn snapshot(&self, root_id: Option<&str>, limit: usize) -> Result<GraphSnapshot> {
        if let Some(id) = root_id {
            let expanded = self.expand(id, 2)?;
            return Ok(GraphSnapshot {
                root_id: Some(id.to_string()),
                generated_at: Utc::now(),
                nodes: expanded.nodes,
                edges: expanded.edges,
            });
        }
        let mut nodes_stmt = self.conn.prepare(
            "SELECT id, kind, label, uri, source_id, summary, metadata, created_at, updated_at FROM nodes ORDER BY kind, label LIMIT ?1",
        )?;
        let nodes = nodes_stmt
            .query_map(params![limit as i64], row_to_node)?
            .collect::<rusqlite::Result<Vec<_>>>()?;

        let node_ids: HashSet<String> = nodes.iter().map(|n| n.id.clone()).collect();
        let mut edge_stmt = self.conn.prepare(
            "SELECT id, kind, from_id, to_id, label, metadata, created_at FROM edges ORDER BY kind LIMIT ?1",
        )?;
        let edges = edge_stmt
            .query_map(params![(limit * 2) as i64], row_to_edge)?
            .collect::<rusqlite::Result<Vec<_>>>()?
            .into_iter()
            .filter(|e| node_ids.contains(&e.from_id) && node_ids.contains(&e.to_id))
            .collect();

        Ok(GraphSnapshot {
            root_id: None,
            generated_at: Utc::now(),
            nodes,
            edges,
        })
    }

    pub fn graph_view(&self, preset: GraphViewPreset, limit: usize) -> Result<GraphView> {
        let snapshot = self.snapshot(None, limit)?;
        Ok(build_graph_view(&snapshot, preset))
    }

    fn edges_for_node(&self, node_id: &str) -> Result<Vec<Edge>> {
        let mut stmt = self.conn.prepare(
            "SELECT id, kind, from_id, to_id, label, metadata, created_at FROM edges WHERE from_id = ?1 OR to_id = ?1",
        )?;
        let rows = stmt.query_map(params![node_id], row_to_edge)?;
        rows.collect::<rusqlite::Result<Vec<_>>>()
            .map_err(Into::into)
    }

    fn get_edge(&self, edge_id: &str) -> Result<Option<Edge>> {
        self.conn
            .query_row(
                "SELECT id, kind, from_id, to_id, label, metadata, created_at FROM edges WHERE id = ?1",
                params![edge_id],
                row_to_edge,
            )
            .optional()
            .map_err(Into::into)
    }
}

fn build_fts_query(query: &str) -> String {
    let parts: Vec<String> = query
        .split(|c: char| !c.is_alphanumeric() && c != '_')
        .filter(|s| s.len() >= 2)
        .take(8)
        .map(|s| format!("{}*", s.to_ascii_lowercase()))
        .collect();
    parts.join(" OR ")
}

fn make_snippet(text: &str, query: &str) -> String {
    let lower = text.to_ascii_lowercase();
    let q = query.to_ascii_lowercase();
    if let Some(pos) = lower.find(&q) {
        let start = pos.saturating_sub(80);
        let end = (pos + q.len() + 120).min(text.len());
        text[start..end].replace('\n', " ")
    } else {
        text.chars()
            .take(220)
            .collect::<String>()
            .replace('\n', " ")
    }
}

fn row_to_node(row: &Row<'_>) -> rusqlite::Result<Node> {
    let metadata: String = row.get(6)?;
    let created_at: String = row.get(7)?;
    let updated_at: String = row.get(8)?;
    Ok(Node {
        id: row.get(0)?,
        kind: row.get(1)?,
        label: row.get(2)?,
        uri: row.get(3)?,
        source_id: row.get(4)?,
        summary: row.get(5)?,
        metadata: parse_metadata(&metadata),
        created_at: parse_time(&created_at),
        updated_at: parse_time(&updated_at),
    })
}

fn row_to_edge(row: &Row<'_>) -> rusqlite::Result<Edge> {
    let metadata: String = row.get(5)?;
    let created_at: String = row.get(6)?;
    Ok(Edge {
        id: row.get(0)?,
        kind: row.get(1)?,
        from_id: row.get(2)?,
        to_id: row.get(3)?,
        label: row.get(4)?,
        metadata: parse_metadata(&metadata),
        created_at: parse_time(&created_at),
    })
}

fn row_to_chunk(row: &Row<'_>) -> rusqlite::Result<Chunk> {
    let metadata: String = row.get(7)?;
    let start_line: i64 = row.get(4)?;
    let end_line: i64 = row.get(5)?;
    let token_estimate: i64 = row.get(6)?;
    Ok(Chunk {
        id: row.get(0)?,
        source_id: row.get(1)?,
        node_id: row.get(2)?,
        text: row.get(3)?,
        start_line: start_line as usize,
        end_line: end_line as usize,
        token_estimate: token_estimate as usize,
        metadata: parse_metadata(&metadata),
    })
}

fn parse_metadata(text: &str) -> Metadata {
    serde_json::from_str(text).unwrap_or_else(|_| {
        let mut meta = Metadata::new();
        meta.insert("parse_error".to_string(), json!(true));
        meta
    })
}

fn parse_time(text: &str) -> DateTime<Utc> {
    DateTime::parse_from_rfc3339(text)
        .map(|d| d.with_timezone(&Utc))
        .unwrap_or_else(|_| Utc::now())
}

#[cfg(test)]
mod tests {
    use crate::{indexer::IndexOptions, Indexer};
    use std::fs;

    #[test]
    fn indexes_and_searches() {
        let dir = tempfile::tempdir().unwrap();
        fs::write(
            dir.path().join("README.md"),
            "# Hello\nCumulus knowledge graph",
        )
        .unwrap();
        let mut indexer = Indexer::new(dir.path()).unwrap();
        indexer.index(IndexOptions::default()).unwrap();
        let hits = indexer.store().search("knowledge", 5).unwrap();
        assert!(!hits.is_empty());
    }
}
