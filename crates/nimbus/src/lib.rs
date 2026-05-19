use serde::{Deserialize, Serialize};
use serde_json::{json, Map, Value};
use sha2::{Digest, Sha256};
use thiserror::Error;

#[derive(Debug, Error)]
pub enum NimbusError {
    #[error("schema declaration is required")]
    MissingSchema,
    #[error("schema name must be quoted")]
    InvalidSchemaName,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Diagnostic {
    pub code: String,
    pub message: String,
    pub line: usize,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct CompileOutput {
    pub ir: Value,
    pub hash: String,
    pub diagnostics: Vec<Diagnostic>,
}

pub fn compile(source: &str) -> Result<CompileOutput, NimbusError> {
    let schema_name = parse_schema_name(source)?;
    let mut resources = Vec::new();
    let mut diagnostics = Vec::new();

    for (index, raw_line) in source.lines().enumerate() {
        let line = raw_line.trim();
        if line.starts_with("collection ") {
            let name = line
                .trim_start_matches("collection ")
                .split(|c: char| c.is_whitespace() || c == '{')
                .next()
                .unwrap_or("")
                .trim();
            if name.is_empty() {
                diagnostics.push(Diagnostic {
                    code: "NIMBUS_COLLECTION_NAME".to_string(),
                    message: "collection name is required".to_string(),
                    line: index + 1,
                });
            } else {
                resources.push(json!({
                    "kind": "collection",
                    "name": name,
                    "fields": []
                }));
            }
        }
    }

    let ir = json!({
        "$schema": "https://schemas.cumulus.sh/nimbus/v1/schema",
        "apiVersion": "nimbus.cumulus/v1alpha1",
        "kind": "SchemaBundle",
        "metadata": {
            "name": schema_name
        },
        "imports": [],
        "spec": {
            "resources": resources,
            "policies": [],
            "bindings": {
                "env": [],
                "secrets": []
            }
        }
    });
    let canonical = canonical_json(&ir);
    let hash = sha256_hex(canonical.as_bytes());
    Ok(CompileOutput {
        ir,
        hash,
        diagnostics,
    })
}

pub fn canonical_json(value: &Value) -> String {
    let sorted = sort_value(value);
    serde_json::to_string(&sorted).expect("canonical JSON serialization failed")
}

pub fn sha256_hex(bytes: &[u8]) -> String {
    let digest = Sha256::digest(bytes);
    let mut out = String::with_capacity(digest.len() * 2);
    for byte in digest {
        out.push_str(&format!("{byte:02x}"));
    }
    out
}

fn parse_schema_name(source: &str) -> Result<String, NimbusError> {
    for line in source.lines() {
        let trimmed = line.trim();
        if !trimmed.starts_with("schema ") {
            continue;
        }
        let after = trimmed.trim_start_matches("schema ").trim_start();
        if !after.starts_with('"') {
            return Err(NimbusError::InvalidSchemaName);
        }
        let rest = &after[1..];
        let Some(end) = rest.find('"') else {
            return Err(NimbusError::InvalidSchemaName);
        };
        return Ok(rest[..end].to_string());
    }
    Err(NimbusError::MissingSchema)
}

fn sort_value(value: &Value) -> Value {
    match value {
        Value::Array(items) => Value::Array(items.iter().map(sort_value).collect()),
        Value::Object(map) => {
            let mut sorted = Map::new();
            let mut keys: Vec<_> = map.keys().collect();
            keys.sort();
            for key in keys {
                sorted.insert(key.clone(), sort_value(&map[key]));
            }
            Value::Object(sorted)
        }
        _ => value.clone(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn compiles_schema_bundle() {
        let out = compile(
            r#"
            schema "crm" {
              collection contacts {
              }
            }
            "#,
        )
        .unwrap();
        assert_eq!(out.ir["metadata"]["name"], "crm");
        assert_eq!(out.ir["spec"]["resources"][0]["name"], "contacts");
        assert_eq!(out.hash.len(), 64);
    }

    #[test]
    fn canonical_json_sorts_keys() {
        let value = json!({ "b": 1, "a": { "d": 1, "c": 2 } });
        assert_eq!(canonical_json(&value), r#"{"a":{"c":2,"d":1},"b":1}"#);
    }
}

