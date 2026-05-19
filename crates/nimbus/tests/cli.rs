use std::{fs, process::Command};

#[test]
fn compile_command_prints_schema_bundle() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("schema.nimbus");
    fs::write(
        &path,
        r#"
        schema "crm" {
          collection contacts {
          }
        }
        "#,
    )
    .unwrap();

    let output = Command::new(env!("CARGO_BIN_EXE_cls-nimbus"))
        .arg("compile")
        .arg(&path)
        .output()
        .unwrap();
    assert!(output.status.success());
    let stdout = String::from_utf8(output.stdout).unwrap();
    assert!(stdout.contains(r#""kind":"SchemaBundle""#));
    assert!(stdout.contains(r#""name":"crm""#));
}

