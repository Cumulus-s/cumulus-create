use std::{fs, path::PathBuf};

use anyhow::Context;
use clap::{Parser, Subcommand};
use cumulus_nimbus::{canonical_json, compile};

#[derive(Debug, Parser)]
#[command(name = "cmls-nimbus")]
#[command(about = "Compile Nimbus desired-state manifests to canonical JSON")]
struct Cli {
    #[command(subcommand)]
    command: Command,
}

#[derive(Debug, Subcommand)]
enum Command {
    Compile { file: PathBuf },
    Check { file: PathBuf },
}

fn main() -> anyhow::Result<()> {
    let cli = Cli::parse();
    match cli.command {
        Command::Compile { file } => {
            let source = fs::read_to_string(&file)
                .with_context(|| format!("failed to read {}", file.display()))?;
            let output = compile(&source)?;
            println!("{}", canonical_json(&output.ir));
        }
        Command::Check { file } => {
            let source = fs::read_to_string(&file)
                .with_context(|| format!("failed to read {}", file.display()))?;
            let output = compile(&source)?;
            println!(
                "{}",
                serde_json::to_string_pretty(&serde_json::json!({
                    "ok": output.diagnostics.is_empty(),
                    "hash": output.hash,
                    "diagnostics": output.diagnostics
                }))?
            );
        }
    }
    Ok(())
}

