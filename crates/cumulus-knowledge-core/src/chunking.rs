use crate::{models::Chunk, util};
use serde_json::json;

pub fn chunk_text(
    source_id: &str,
    file_node_id: &str,
    text: &str,
    max_tokens: usize,
) -> Vec<Chunk> {
    let mut chunks = Vec::new();
    let lines: Vec<&str> = text.lines().collect();
    if lines.is_empty() {
        return chunks;
    }

    let mut start = 0usize;
    let mut current = Vec::new();
    let mut token_count = 0usize;

    for (idx, line) in lines.iter().enumerate() {
        let line_tokens = util::estimate_tokens(line);
        let boundary = is_heading(line) && !current.is_empty();
        if boundary || (token_count + line_tokens > max_tokens && !current.is_empty()) {
            push_chunk(
                &mut chunks,
                source_id,
                file_node_id,
                &current,
                start + 1,
                idx,
            );
            current.clear();
            token_count = 0;
            start = idx;
        }
        current.push(*line);
        token_count += line_tokens;
    }

    if !current.is_empty() {
        push_chunk(
            &mut chunks,
            source_id,
            file_node_id,
            &current,
            start + 1,
            lines.len(),
        );
    }

    chunks
}

fn push_chunk(
    chunks: &mut Vec<Chunk>,
    source_id: &str,
    file_node_id: &str,
    lines: &[&str],
    start_line: usize,
    end_line: usize,
) {
    let text = lines.join("\n");
    let id = util::stable_id(
        "chunk",
        format!(
            "{source_id}:{start_line}:{end_line}:{}",
            util::sha256_hex(text.as_bytes())
        ),
    );
    let token_estimate = util::estimate_tokens(&text);
    chunks.push(Chunk {
        id,
        source_id: source_id.to_string(),
        node_id: file_node_id.to_string(),
        text,
        start_line,
        end_line,
        token_estimate,
        metadata: util::metadata([
            ("strategy", json!("heading-hybrid")),
            ("parser", json!("cumulus-v1")),
        ]),
    });
}

fn is_heading(line: &str) -> bool {
    let trimmed = line.trim();
    trimmed.starts_with('#')
        || (trimmed.len() > 3
            && trimmed.len() < 100
            && trimmed.chars().any(|c| c.is_alphabetic())
            && trimmed.chars().filter(|c| c.is_lowercase()).count() == 0)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn chunks_on_headings() {
        let chunks = chunk_text("source", "node", "# A\nhello\n# B\nworld", 200);
        assert_eq!(chunks.len(), 2);
        assert_eq!(chunks[0].start_line, 1);
        assert_eq!(chunks[1].start_line, 3);
    }
}
