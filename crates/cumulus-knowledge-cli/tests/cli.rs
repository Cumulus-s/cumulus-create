use serde_json::Value;
use std::{fs, process::Command};

fn bin() -> &'static str {
    env!("CARGO_BIN_EXE_cumulus-knowledge")
}

#[test]
fn index_query_and_expand_emit_axi_json() {
    let dir = tempfile::tempdir().unwrap();
    fs::create_dir_all(dir.path().join("src")).unwrap();
    fs::write(
        dir.path().join("README.md"),
        "# Cumulus\nKnowledge graph for agents.",
    )
    .unwrap();
    fs::write(
        dir.path().join("src/app.py"),
        "import os\n\nclass Runner:\n    pass\n\ndef hello():\n    return os.getcwd()\n",
    )
    .unwrap();

    let index = Command::new(bin())
        .args(["knowledge", "index"])
        .arg(dir.path())
        .args(["--format", "json"])
        .output()
        .unwrap();
    assert!(
        index.status.success(),
        "{}",
        String::from_utf8_lossy(&index.stderr)
    );
    let index_json: Value = serde_json::from_slice(&index.stdout).unwrap();
    assert_eq!(index_json["ok"], true);
    assert!(index_json["data"]["stats"]["node_count"].as_u64().unwrap() > 0);

    let query = Command::new(bin())
        .args(["knowledge", "query", "hello", "--path"])
        .arg(dir.path())
        .args(["--format", "json"])
        .output()
        .unwrap();
    assert!(
        query.status.success(),
        "{}",
        String::from_utf8_lossy(&query.stderr)
    );
    let query_json: Value = serde_json::from_slice(&query.stdout).unwrap();
    assert_eq!(query_json["ok"], true);
    let node_id = query_json["data"][0]["node"]["id"].as_str().unwrap();

    let expand = Command::new(bin())
        .args(["knowledge", "graph", "expand", node_id, "--path"])
        .arg(dir.path())
        .args(["--depth", "1", "--format", "json"])
        .output()
        .unwrap();
    assert!(
        expand.status.success(),
        "{}",
        String::from_utf8_lossy(&expand.stderr)
    );
    let expand_json: Value = serde_json::from_slice(&expand.stdout).unwrap();
    assert_eq!(expand_json["ok"], true);
    assert!(!expand_json["data"]["nodes"].as_array().unwrap().is_empty());

    fs::write(
        dir.path().join("ops.md"),
        "\
# Demo Operations

Client: Atlas Demo Client
Bank: Atlas Demo Bank
Draw Request: Bank Draw Request #2
Invoice DEMO-INV-001 for Vendor: BrightSteel Demo Supply
Shipment: Steel Delivery Batch 04
Risk: Steel Delay
Conflict: Beam Clearance
",
    )
    .unwrap();

    let reindex = Command::new(bin())
        .args(["knowledge", "index"])
        .arg(dir.path())
        .args(["--format", "json"])
        .output()
        .unwrap();
    assert!(
        reindex.status.success(),
        "{}",
        String::from_utf8_lossy(&reindex.stderr)
    );

    let graph_view = Command::new(bin())
        .args(["knowledge", "graph", "view", "--path"])
        .arg(dir.path())
        .args(["--preset", "finance", "--format", "json"])
        .output()
        .unwrap();
    assert!(
        graph_view.status.success(),
        "{}",
        String::from_utf8_lossy(&graph_view.stderr)
    );
    let graph_view_json: Value = serde_json::from_slice(&graph_view.stdout).unwrap();
    assert_eq!(graph_view_json["ok"], true);
    let nodes = graph_view_json["data"]["nodes"].as_array().unwrap();
    assert!(nodes.iter().any(|node| node["display_label"]
        .as_str()
        .unwrap_or_default()
        .contains("Invoice DEMO-INV-001")));
    assert!(nodes.iter().all(|node| node["display_kind"] != "chunk"));
    assert!(nodes.iter().all(|node| !node["display_label"]
        .as_str()
        .unwrap_or_default()
        .starts_with("chunk_")));
}
