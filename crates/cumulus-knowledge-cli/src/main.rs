use anyhow::{anyhow, Context, Result};
use clap::{Args, Parser, Subcommand, ValueEnum};
use crossterm::event::{self, Event, KeyCode};
use cumulus_core::{
    export,
    graph_view::GraphViewPreset,
    indexer::{IndexOptions, IndexProfile, Indexer},
    mcp,
    models::{AxiEnvelope, DoctorReport, GraphSnapshot, IndexStats, SearchHit},
    util, KnowledgeStore,
};
use ratatui::{
    backend::CrosstermBackend,
    layout::{Constraint, Direction, Layout},
    style::{Color, Modifier, Style},
    text::{Line, Span},
    widgets::{Block, Borders, List, ListItem, Paragraph, Wrap},
    Terminal,
};
use serde::Serialize;
use serde_json::{json, Value};
use std::{
    fs,
    io::{self, BufRead, BufReader, Read, Write},
    net::{TcpListener, TcpStream},
    path::{Component, Path, PathBuf},
    time::Duration,
};

#[derive(Debug, Parser)]
#[command(
    name = "cumulus-knowledge",
    version,
    about = "Local-first knowledge graph tools for AI agents"
)]
struct Cli {
    #[arg(
        long,
        global = true,
        value_enum,
        default_value_t = OutputFormat::Human,
        help = "Output mode. dot/html are only valid for knowledge viz export"
    )]
    format: OutputFormat,
    #[arg(
        long,
        global = true,
        help = "Select a simple JSON path, such as data.nodes"
    )]
    jq: Option<String>,
    #[arg(short, long, global = true, help = "Write command output to a file")]
    output: Option<PathBuf>,
    #[command(subcommand)]
    command: TopCommand,
}

#[derive(Debug, Clone, Copy, ValueEnum, PartialEq, Eq)]
enum OutputFormat {
    Human,
    Json,
    Jsonl,
    Pretty,
    Dot,
    Html,
}

#[derive(Debug, Subcommand)]
enum TopCommand {
    Knowledge(KnowledgeArgs),
}

#[derive(Debug, Args)]
struct KnowledgeArgs {
    #[arg(value_name = "PATH", help = "Open the TUI for this indexed folder")]
    path: Option<PathBuf>,
    #[command(subcommand)]
    command: Option<KnowledgeCommand>,
}

#[derive(Debug, Subcommand)]
enum KnowledgeCommand {
    Init {
        path: PathBuf,
    },
    Index {
        path: PathBuf,
        #[arg(long, value_enum, default_value_t = ProfileArg::All)]
        profile: ProfileArg,
        #[arg(
            long,
            help = "Re-index once now, then watch is planned for a later adapter"
        )]
        watch: bool,
    },
    Query {
        #[arg(required = true)]
        text: Vec<String>,
        #[arg(long, default_value = ".")]
        path: PathBuf,
        #[arg(long, default_value_t = 1200)]
        budget: usize,
        #[arg(long, default_value_t = 10)]
        limit: usize,
    },
    View {
        path: PathBuf,
        #[arg(long, value_enum, default_value_t = ViewMode::Human)]
        view: ViewMode,
    },
    Node {
        #[command(subcommand)]
        command: NodeCommand,
    },
    Graph {
        #[command(subcommand)]
        command: GraphCommand,
    },
    Path {
        #[command(subcommand)]
        command: PathCommand,
    },
    Viz {
        #[command(subcommand)]
        command: VizCommand,
    },
    Serve {
        #[command(subcommand)]
        command: ServeCommand,
    },
    Api {
        #[command(subcommand)]
        command: ApiCommand,
    },
    Doctor {
        #[arg(long, default_value = ".")]
        path: PathBuf,
    },
}

#[derive(Debug, Subcommand)]
enum NodeCommand {
    Get {
        id: String,
        #[arg(long, default_value = ".")]
        path: PathBuf,
    },
}

#[derive(Debug, Subcommand)]
enum GraphCommand {
    Expand {
        id: String,
        #[arg(long, default_value = ".")]
        path: PathBuf,
        #[arg(long, default_value_t = 1)]
        depth: usize,
    },
    View {
        #[arg(long, default_value = ".")]
        path: PathBuf,
        #[arg(long, value_enum, default_value_t = PresetArg::Full)]
        preset: PresetArg,
        #[arg(long, default_value_t = 800)]
        limit: usize,
    },
}

#[derive(Debug, Subcommand)]
enum PathCommand {
    Explain {
        from: String,
        to: String,
        #[arg(long, default_value = ".")]
        path: PathBuf,
        #[arg(long, default_value_t = 6)]
        max_depth: usize,
    },
}

#[derive(Debug, Subcommand)]
enum VizCommand {
    Export {
        #[arg(long, default_value = ".")]
        path: PathBuf,
        #[arg(short, long)]
        output: Option<PathBuf>,
        #[arg(long)]
        root_id: Option<String>,
        #[arg(long, default_value_t = 500)]
        limit: usize,
    },
}

#[derive(Debug, Subcommand)]
enum ServeCommand {
    Mcp {
        #[arg(long, default_value = ".")]
        path: PathBuf,
        #[arg(long, value_enum, default_value_t = Transport::Stdio)]
        transport: Transport,
        #[arg(long, default_value = "127.0.0.1:8787")]
        bind: String,
    },
}

#[derive(Debug, Subcommand)]
enum ApiCommand {
    Serve {
        #[arg(long, default_value = ".")]
        path: PathBuf,
        #[arg(long, default_value = "127.0.0.1:8787")]
        bind: String,
    },
}

#[derive(Debug, Clone, Copy, ValueEnum, PartialEq, Eq)]
enum Transport {
    Stdio,
    Http,
}

#[derive(Debug, Clone, Copy, ValueEnum)]
enum ProfileArg {
    Code,
    Docs,
    Facility,
    All,
}

#[derive(Debug, Clone, Copy, ValueEnum)]
enum ViewMode {
    Human,
    Agent,
    Ops,
}

#[derive(Debug, Clone, Copy, ValueEnum)]
enum PresetArg {
    Source,
    Finance,
    Timeline,
    Risk,
    Full,
}

impl From<ProfileArg> for IndexProfile {
    fn from(value: ProfileArg) -> Self {
        match value {
            ProfileArg::Code => Self::Code,
            ProfileArg::Docs => Self::Docs,
            ProfileArg::Facility => Self::Facility,
            ProfileArg::All => Self::All,
        }
    }
}

impl From<PresetArg> for GraphViewPreset {
    fn from(value: PresetArg) -> Self {
        match value {
            PresetArg::Source => Self::Source,
            PresetArg::Finance => Self::Finance,
            PresetArg::Timeline => Self::Timeline,
            PresetArg::Risk => Self::Risk,
            PresetArg::Full => Self::Full,
        }
    }
}

impl From<ViewMode> for GraphViewPreset {
    fn from(value: ViewMode) -> Self {
        match value {
            ViewMode::Human | ViewMode::Agent => Self::Full,
            ViewMode::Ops => Self::Risk,
        }
    }
}

fn main() {
    let cli = Cli::parse();
    if let Err(err) = run(cli) {
        eprintln!("error: {err:#}");
        std::process::exit(1);
    }
}

fn run(cli: Cli) -> Result<()> {
    match cli.command {
        TopCommand::Knowledge(args) => {
            run_knowledge(args, cli.format, cli.jq.as_deref(), cli.output.as_deref())
        }
    }
}

fn run_knowledge(
    args: KnowledgeArgs,
    format: OutputFormat,
    jq: Option<&str>,
    output: Option<&Path>,
) -> Result<()> {
    match args.command {
        None => {
            let path = args.path.unwrap_or_else(|| PathBuf::from("."));
            run_tui(&path)
        }
        Some(KnowledgeCommand::Init { path }) => {
            let indexer = Indexer::new(&path)?;
            indexer.init()?;
            let store = indexer.store();
            let stats = store.stats()?;
            emit(format, jq, output, "knowledge.init", stats, |stats| {
                format!(
                    "Initialized Cumulus knowledge at {}\nDatabase: {}",
                    stats.root_path, stats.database_path
                )
            })
        }
        Some(KnowledgeCommand::Index {
            path,
            profile,
            watch,
        }) => {
            let mut indexer = Indexer::new(&path)?;
            let report = indexer.index(IndexOptions {
                profile: profile.into(),
                ..IndexOptions::default()
            })?;
            if watch {
                eprintln!("watch mode is not persistent yet; completed one index pass");
            }
            emit(format, jq, output, "knowledge.index", report, |report| {
                format!(
                    "Indexed {}\nSources: {}  Nodes: {}  Edges: {}  Chunks: {}\nSkipped: {}",
                    report.manifest.root_path,
                    report.stats.source_count,
                    report.stats.node_count,
                    report.stats.edge_count,
                    report.stats.chunk_count,
                    report.skipped.len()
                )
            })
        }
        Some(KnowledgeCommand::Query {
            text,
            path,
            budget,
            limit,
        }) => {
            let query = text.join(" ");
            let store = KnowledgeStore::open(path)?;
            let mut hits = store.search(&query, limit)?;
            hits.truncate(limit);
            emit_with_envelope(
                format,
                jq,
                output,
                AxiEnvelope::ok("knowledge.query", hits.clone())
                    .with_count(hits.len())
                    .with_budget(budget),
                |hits| human_hits(&query, hits),
            )
        }
        Some(KnowledgeCommand::View { path, view }) => {
            let store = KnowledgeStore::open(path)?;
            let graph_view = store.graph_view(view.into(), 800)?;
            emit(format, jq, output, "knowledge.view", graph_view, |view| {
                format!(
                    "{}\nPreset: {}\nDisplay nodes: {}\nVisible edges: {}\nEvidence links: {}",
                    view.summary,
                    view.preset,
                    view.nodes.len(),
                    view.edges.len(),
                    view.evidence.len()
                )
            })
        }
        Some(KnowledgeCommand::Node { command }) => match command {
            NodeCommand::Get { id, path } => {
                let store = KnowledgeStore::open(path)?;
                let node = store
                    .get_node(&id)?
                    .ok_or_else(|| anyhow!("node not found: {id}"))?;
                emit(format, jq, output, "knowledge.node.get", node, |node| {
                    format!(
                        "{} [{}]\nID: {}\nURI: {}\n{}",
                        node.label,
                        node.kind,
                        node.id,
                        node.uri,
                        node.summary.clone().unwrap_or_default()
                    )
                })
            }
        },
        Some(KnowledgeCommand::Graph { command }) => match command {
            GraphCommand::Expand { id, path, depth } => {
                let store = KnowledgeStore::open(path)?;
                let expansion = store.expand(&id, depth)?;
                emit(
                    format,
                    jq,
                    output,
                    "knowledge.graph.expand",
                    expansion,
                    |expansion| {
                        let mut out = format!(
                            "Expanded {} to depth {}\nNodes: {}  Edges: {}",
                            expansion.root_id,
                            expansion.depth,
                            expansion.nodes.len(),
                            expansion.edges.len()
                        );
                        for node in expansion.nodes.iter().take(20) {
                            out.push_str(&format!(
                                "\n- {} [{}] {}",
                                node.id, node.kind, node.label
                            ));
                        }
                        out
                    },
                )
            }
            GraphCommand::View {
                path,
                preset,
                limit,
            } => {
                let store = KnowledgeStore::open(path)?;
                let graph_view = store.graph_view(preset.into(), limit)?;
                emit(
                    format,
                    jq,
                    output,
                    "knowledge.graph.view",
                    graph_view,
                    |view| {
                        format!(
                            "{}\nLegend: {} node kinds, {} edge kinds",
                            view.summary,
                            view.legend.node_kinds.len(),
                            view.legend.edge_kinds.len()
                        )
                    },
                )
            }
        },
        Some(KnowledgeCommand::Path { command }) => match command {
            PathCommand::Explain {
                from,
                to,
                path,
                max_depth,
            } => {
                let store = KnowledgeStore::open(path)?;
                let explanation = store.find_path(&from, &to, max_depth)?;
                emit(
                    format,
                    jq,
                    output,
                    "knowledge.path.explain",
                    explanation,
                    |explanation| match explanation {
                        Some(path) => {
                            let labels = path
                                .nodes
                                .iter()
                                .map(|node| format!("{} [{}]", node.label, node.kind))
                                .collect::<Vec<_>>()
                                .join(" -> ");
                            format!("Path found:\n{labels}")
                        }
                        None => "No path found".to_string(),
                    },
                )
            }
        },
        Some(KnowledgeCommand::Viz { command }) => match command {
            VizCommand::Export {
                path,
                output: viz_output,
                root_id,
                limit,
            } => {
                let store = KnowledgeStore::open(path)?;
                let snapshot = store.snapshot(root_id.as_deref(), limit)?;
                let text = match format {
                    OutputFormat::Dot => export::to_dot(&snapshot),
                    OutputFormat::Html => {
                        let view = store.graph_view(GraphViewPreset::Full, limit)?;
                        export::graph_view_to_html(&view)?
                    }
                    OutputFormat::Jsonl => {
                        let mut line = serde_json::to_string(&snapshot)?;
                        line.push('\n');
                        line
                    }
                    OutputFormat::Human | OutputFormat::Json | OutputFormat::Pretty => {
                        serde_json::to_string_pretty(&snapshot)?
                    }
                };
                if let Some(path) = viz_output.or_else(|| output.map(Path::to_path_buf)) {
                    fs::write(&path, text)
                        .with_context(|| format!("writing {}", path.display()))?;
                    eprintln!("wrote {}", path.display());
                    return Ok(());
                }
                println!("{text}");
                Ok(())
            }
        },
        Some(KnowledgeCommand::Serve { command }) => match command {
            ServeCommand::Mcp {
                path,
                transport,
                bind,
            } => match transport {
                Transport::Stdio => run_mcp_stdio(&path),
                Transport::Http => run_mcp_http(&path, &bind),
            },
        },
        Some(KnowledgeCommand::Api { command }) => match command {
            ApiCommand::Serve { path, bind } => run_api_http(&path, &bind),
        },
        Some(KnowledgeCommand::Doctor { path }) => {
            let report = doctor(&path)?;
            emit(format, jq, output, "knowledge.doctor", report, |report| {
                let mut out = if report.ok {
                    "OK".to_string()
                } else {
                    "Needs attention".to_string()
                };
                out.push_str(&format!(
                    "\nRoot: {}\nDatabase: {}\nManifest: {}",
                    report.root_path, report.database_exists, report.manifest_exists
                ));
                for warning in &report.warnings {
                    out.push_str(&format!("\nwarning: {warning}"));
                }
                out
            })
        }
    }
}

fn emit<T, F>(
    format: OutputFormat,
    jq: Option<&str>,
    output: Option<&Path>,
    command: &str,
    data: T,
    human: F,
) -> Result<()>
where
    T: Serialize,
    F: FnOnce(&T) -> String,
{
    emit_with_envelope(format, jq, output, AxiEnvelope::ok(command, data), human)
}

fn emit_with_envelope<T, F>(
    format: OutputFormat,
    jq: Option<&str>,
    output: Option<&Path>,
    envelope: AxiEnvelope<T>,
    human: F,
) -> Result<()>
where
    T: Serialize,
    F: FnOnce(&T) -> String,
{
    let text = match format {
        OutputFormat::Human if jq.is_none() => human(&envelope.data),
        OutputFormat::Json | OutputFormat::Jsonl | OutputFormat::Human => {
            let value = apply_json_path(serde_json::to_value(&envelope)?, jq)?;
            let mut line = serde_json::to_string(&value)?;
            if format == OutputFormat::Jsonl {
                line.push('\n');
            }
            line
        }
        OutputFormat::Pretty => {
            let value = apply_json_path(serde_json::to_value(&envelope)?, jq)?;
            serde_json::to_string_pretty(&value)?
        }
        OutputFormat::Dot | OutputFormat::Html => {
            anyhow::bail!("--format dot|html is only supported by knowledge viz export")
        }
    };
    if let Some(path) = output {
        fs::write(path, text).with_context(|| format!("writing {}", path.display()))?;
        eprintln!("wrote {}", path.display());
    } else {
        println!("{text}");
    }
    Ok(())
}

fn apply_json_path(mut value: Value, jq: Option<&str>) -> Result<Value> {
    let Some(path) = jq else {
        return Ok(value);
    };
    if path.trim().is_empty() || path == "." {
        return Ok(value);
    }
    for part in path.trim_start_matches('.').split('.') {
        if part.is_empty() {
            continue;
        }
        value = match value {
            Value::Object(map) => map
                .get(part)
                .cloned()
                .ok_or_else(|| anyhow!("json path not found: {path}"))?,
            Value::Array(items) => {
                let index: usize = part
                    .parse()
                    .with_context(|| format!("array index expected in --jq at {part}"))?;
                items
                    .get(index)
                    .cloned()
                    .ok_or_else(|| anyhow!("array index out of range in --jq: {part}"))?
            }
            _ => {
                return Err(anyhow!(
                    "cannot select {part} from non-container JSON value"
                ))
            }
        };
    }
    Ok(value)
}

fn human_hits(query: &str, hits: &[SearchHit]) -> String {
    if hits.is_empty() {
        return format!("No hits for {query}");
    }
    let mut out = format!("Hits for {query}:");
    for hit in hits {
        out.push_str(&format!(
            "\n- {} [{}] score {:.3}\n  {}\n  {}",
            hit.node.label, hit.node.kind, hit.score, hit.snippet, hit.resource_uri
        ));
    }
    out
}

fn doctor(path: &Path) -> Result<DoctorReport> {
    let root = path.canonicalize().unwrap_or_else(|_| path.to_path_buf());
    let db_path = util::db_path(&root);
    let manifest_path = util::manifest_path(&root);
    let database_exists = db_path.exists();
    let manifest_exists = manifest_path.exists();
    let mut warnings = Vec::new();
    if !database_exists {
        warnings.push("database is missing; run cumulus knowledge index <path>".to_string());
    }
    if !manifest_exists {
        warnings.push("manifest is missing; run cumulus knowledge index <path>".to_string());
    }
    let stats = if database_exists {
        Some(KnowledgeStore::open(&root)?.stats()?)
    } else {
        None
    };
    Ok(DoctorReport {
        ok: warnings.is_empty(),
        root_path: root.display().to_string(),
        database_exists,
        manifest_exists,
        stats,
        warnings,
    })
}

fn run_tui(path: &Path) -> Result<()> {
    let store = KnowledgeStore::open(path)?;
    let stats = store.stats()?;
    let snapshot = store.snapshot(None, 300)?;
    let mut terminal = setup_terminal()?;
    let result = tui_loop(&mut terminal, &stats, &snapshot);
    restore_terminal(&mut terminal)?;
    result
}

fn setup_terminal() -> Result<Terminal<CrosstermBackend<io::Stdout>>> {
    crossterm::terminal::enable_raw_mode()?;
    let mut stdout = io::stdout();
    crossterm::execute!(stdout, crossterm::terminal::EnterAlternateScreen)?;
    let backend = CrosstermBackend::new(stdout);
    let mut terminal = Terminal::new(backend)?;
    terminal.clear()?;
    Ok(terminal)
}

fn restore_terminal(terminal: &mut Terminal<CrosstermBackend<io::Stdout>>) -> Result<()> {
    crossterm::terminal::disable_raw_mode()?;
    crossterm::execute!(
        terminal.backend_mut(),
        crossterm::terminal::LeaveAlternateScreen
    )?;
    terminal.show_cursor()?;
    Ok(())
}

fn tui_loop(
    terminal: &mut Terminal<CrosstermBackend<io::Stdout>>,
    stats: &IndexStats,
    snapshot: &GraphSnapshot,
) -> Result<()> {
    let mut selected = 0usize;
    loop {
        let selected_node = snapshot.nodes.get(selected);
        terminal.draw(|frame| {
            let area = frame.area();
            let rows = Layout::default()
                .direction(Direction::Vertical)
                .constraints([Constraint::Length(3), Constraint::Min(8), Constraint::Length(2)])
                .split(area);
            let cols = Layout::default()
                .direction(Direction::Horizontal)
                .constraints([Constraint::Percentage(30), Constraint::Percentage(38), Constraint::Percentage(32)])
                .split(rows[1]);

            let title = Paragraph::new(Line::from(vec![
                Span::styled("Cumulus Knowledge", Style::default().fg(Color::Cyan).add_modifier(Modifier::BOLD)),
                Span::raw(format!(
                    "  {} nodes  {} edges  {} chunks",
                    stats.node_count, stats.edge_count, stats.chunk_count
                )),
            ]))
            .block(Block::default().borders(Borders::ALL));
            frame.render_widget(title, rows[0]);

            let node_items: Vec<ListItem> = if snapshot.nodes.is_empty() {
                vec![ListItem::new("No nodes yet. Run: cumulus knowledge index <path>")]
            } else {
                snapshot
                    .nodes
                    .iter()
                    .enumerate()
                    .map(|(idx, node)| {
                        let marker = if idx == selected { "> " } else { "  " };
                        ListItem::new(format!("{marker}{}  {}", node.kind, node.label))
                    })
                    .collect()
            };
            let nodes = List::new(node_items).block(Block::default().title("Source Tree / Nodes").borders(Borders::ALL));
            frame.render_widget(nodes, cols[0]);

            let mut graph_lines = Vec::new();
            for edge in snapshot.edges.iter().take(80) {
                graph_lines.push(Line::from(format!("{}  {} -> {}", edge.kind, edge.from_id, edge.to_id)));
            }
            if graph_lines.is_empty() {
                graph_lines.push(Line::from("No edges indexed yet."));
            }
            let graph = Paragraph::new(graph_lines)
                .wrap(Wrap { trim: true })
                .block(Block::default().title("Graph Canvas").borders(Borders::ALL));
            frame.render_widget(graph, cols[1]);

            let detail_text = selected_node
                .map(|node| {
                    format!(
                        "{}\nkind: {}\nid: {}\nuri: {}\nsource: {}\n\n{}",
                        node.label,
                        node.kind,
                        node.id,
                        node.uri,
                        node.source_id.clone().unwrap_or_else(|| "-".to_string()),
                        node.summary.clone().unwrap_or_default()
                    )
                })
                .unwrap_or_else(|| "First-run wizard\n\nThis folder is ready, but no graph is indexed yet.\nRun `cumulus knowledge index <path>` in another terminal, then reopen this TUI.".to_string());
            let detail = Paragraph::new(detail_text)
                .wrap(Wrap { trim: true })
                .block(Block::default().title("Node Detail").borders(Borders::ALL));
            frame.render_widget(detail, cols[2]);

            let status = Paragraph::new("q/esc exit  up/down select  / search planned  enter expand planned")
                .block(Block::default().borders(Borders::ALL));
            frame.render_widget(status, rows[2]);
        })?;

        if event::poll(Duration::from_millis(250))? {
            if let Event::Key(key) = event::read()? {
                match key.code {
                    KeyCode::Char('q') | KeyCode::Esc => break,
                    KeyCode::Down | KeyCode::Char('j') => {
                        selected = (selected + 1).min(snapshot.nodes.len().saturating_sub(1));
                    }
                    KeyCode::Up | KeyCode::Char('k') => {
                        selected = selected.saturating_sub(1);
                    }
                    _ => {}
                }
            }
        }
    }
    Ok(())
}

fn run_mcp_stdio(path: &Path) -> Result<()> {
    let root = path.to_path_buf();
    let stdin = io::stdin();
    let reader = BufReader::new(stdin.lock());
    let mut stdout = io::stdout();
    for line in reader.lines() {
        let line = line?;
        if line.trim().is_empty() {
            continue;
        }
        let request: Value = match serde_json::from_str(&line) {
            Ok(value) => value,
            Err(err) => {
                writeln!(
                    stdout,
                    "{}",
                    json_rpc_error(Value::Null, -32700, &err.to_string())
                )?;
                stdout.flush()?;
                continue;
            }
        };
        if let Some(response) = handle_json_rpc(&root, request) {
            writeln!(stdout, "{}", serde_json::to_string(&response)?)?;
            stdout.flush()?;
        }
    }
    Ok(())
}

fn run_mcp_http(path: &Path, bind: &str) -> Result<()> {
    let listener = TcpListener::bind(bind).with_context(|| format!("binding {bind}"))?;
    eprintln!("Cumulus MCP HTTP listening on http://{bind}/mcp");
    for stream in listener.incoming() {
        let mut stream = stream?;
        stream.set_read_timeout(Some(Duration::from_secs(20)))?;
        stream.set_write_timeout(Some(Duration::from_secs(20)))?;
        if let Err(err) = handle_http_stream(path, &mut stream) {
            eprintln!("http request failed: {err:#}");
        }
    }
    Ok(())
}

fn run_api_http(path: &Path, bind: &str) -> Result<()> {
    let listener = TcpListener::bind(bind).with_context(|| format!("binding {bind}"))?;
    eprintln!("Cumulus Knowledge API listening on http://{bind}");
    for stream in listener.incoming() {
        let mut stream = stream?;
        stream.set_read_timeout(Some(Duration::from_secs(20)))?;
        stream.set_write_timeout(Some(Duration::from_secs(20)))?;
        if let Err(err) = handle_api_stream(path, &mut stream) {
            eprintln!("api request failed: {err:#}");
        }
    }
    Ok(())
}

fn handle_api_stream(root: &Path, stream: &mut TcpStream) -> Result<()> {
    let mut buffer = [0u8; 256 * 1024];
    let n = stream.read(&mut buffer)?;
    let request = String::from_utf8_lossy(&buffer[..n]);
    let mut lines = request.split("\r\n");
    let request_line = lines.next().unwrap_or_default();
    let headers: Vec<&str> = lines.by_ref().take_while(|line| !line.is_empty()).collect();
    if validate_origin(&headers).is_err() {
        write_http(
            stream,
            403,
            "application/json",
            r#"{"error":"forbidden origin"}"#,
        )?;
        return Ok(());
    }
    let mut parts = request_line.split_whitespace();
    let method = parts.next().unwrap_or_default();
    let route = parts.next().unwrap_or_default();
    let body = request.split("\r\n\r\n").nth(1).unwrap_or_default();
    let (path, _) = route.split_once('?').unwrap_or((route, ""));
    if method == "GET" && path == "/v1/projects/local/exports/html" {
        let store = KnowledgeStore::open(root)?;
        let view = store.graph_view(GraphViewPreset::Full, 1000)?;
        let html = export::graph_view_to_html(&view)?;
        write_http(stream, 200, "text/html; charset=utf-8", &html)?;
        return Ok(());
    }
    if method == "GET" && path == "/v1/projects/local/events" {
        write_http(
            stream,
            200,
            "text/event-stream",
            "data: {\"type\":\"graph.ready\",\"project_id\":\"local\"}\n\n",
        )?;
        return Ok(());
    }
    let response = handle_api_route(root, method, route, body)?;
    write_http(
        stream,
        200,
        "application/json",
        &serde_json::to_string(&response)?,
    )?;
    Ok(())
}

fn handle_api_route(root: &Path, method: &str, route: &str, body: &str) -> Result<Value> {
    let (path, query) = route.split_once('?').unwrap_or((route, ""));
    match (method, path) {
        ("GET", "/health") => Ok(json!({"ok": true})),
        ("POST", "/v1/projects") => Ok(serde_json::to_value(AxiEnvelope::ok(
            "api.projects.create",
            json!({
                "project_id": "local",
                "root_path": root.display().to_string(),
                "next": {
                    "upload": "/v1/projects/local/uploads",
                    "index": "/v1/projects/local/index",
                    "graph_view": "/v1/projects/local/graph-view?preset=full"
                }
            }),
        ))?),
        ("POST", "/v1/projects/local/uploads") => {
            let value: Value = serde_json::from_str(body).unwrap_or_else(|_| json!({}));
            let files = value
                .get("files")
                .and_then(Value::as_array)
                .cloned()
                .unwrap_or_default();
            let mut written = 0usize;
            for file in files {
                let Some(path) = file.get("path").and_then(Value::as_str) else {
                    continue;
                };
                let content = file
                    .get("content")
                    .and_then(Value::as_str)
                    .unwrap_or_default();
                let target = safe_upload_path(root, path)?;
                if let Some(parent) = target.parent() {
                    fs::create_dir_all(parent)
                        .with_context(|| format!("creating {}", parent.display()))?;
                }
                fs::write(&target, content)
                    .with_context(|| format!("writing uploaded file {}", target.display()))?;
                written += 1;
            }
            Ok(serde_json::to_value(AxiEnvelope::ok(
                "api.projects.uploads",
                json!({"project_id": "local", "file_count": written}),
            ))?)
        }
        ("POST", "/v1/projects/local/index") => {
            let mut indexer = Indexer::new(root)?;
            let report = indexer.index(IndexOptions::default())?;
            Ok(serde_json::to_value(AxiEnvelope::ok(
                "api.projects.index",
                report,
            ))?)
        }
        ("GET", "/v1/jobs/local") => Ok(serde_json::to_value(AxiEnvelope::ok(
            "api.jobs.get",
            json!({"job_id": "local", "status": "complete"}),
        ))?),
        ("GET", "/v1/projects/local/graph-view") => {
            let preset = query_param(query, "preset").unwrap_or("full");
            let preset = parse_graph_preset(preset);
            let store = KnowledgeStore::open(root)?;
            let view = store.graph_view(preset, 1000)?;
            Ok(serde_json::to_value(AxiEnvelope::ok(
                "api.projects.graph_view",
                view,
            ))?)
        }
        ("POST", "/v1/projects/local/query") => {
            let value: Value = serde_json::from_str(body).unwrap_or_else(|_| json!({}));
            let query = value
                .get("query")
                .and_then(Value::as_str)
                .unwrap_or_default();
            let limit = value.get("limit").and_then(Value::as_u64).unwrap_or(10) as usize;
            let store = KnowledgeStore::open(root)?;
            Ok(serde_json::to_value(AxiEnvelope::ok(
                "api.projects.query",
                store.search(query, limit)?,
            ))?)
        }
        ("GET", "/v1/projects/local/exports/html") => {
            let store = KnowledgeStore::open(root)?;
            let view = store.graph_view(GraphViewPreset::Full, 1000)?;
            let html = export::graph_view_to_html(&view)?;
            Ok(serde_json::to_value(AxiEnvelope::ok(
                "api.projects.exports.html",
                json!({"html": html}),
            ))?)
        }
        ("GET", "/v1/projects/local/events") => Ok(serde_json::to_value(AxiEnvelope::ok(
            "api.projects.events",
            json!({"events": [{"type": "graph.ready", "project_id": "local"}]}),
        ))?),
        _ if method == "GET"
            && path.starts_with("/v1/projects/local/nodes/")
            && path.ends_with("/source-trace") =>
        {
            let id = path
                .trim_start_matches("/v1/projects/local/nodes/")
                .trim_end_matches("/source-trace");
            let preset = query_param(query, "preset")
                .map(parse_graph_preset)
                .unwrap_or(GraphViewPreset::Full);
            let store = KnowledgeStore::open(root)?;
            let view = store.graph_view(preset, 1000)?;
            let evidence = view
                .evidence
                .into_iter()
                .filter(|item| item.node_id == id)
                .collect::<Vec<_>>();
            Ok(serde_json::to_value(AxiEnvelope::ok(
                "api.projects.nodes.source_trace",
                json!({"node_id": id, "evidence": evidence}),
            ))?)
        }
        _ if method == "GET" && path.starts_with("/v1/projects/local/nodes/") => {
            let id = path.trim_start_matches("/v1/projects/local/nodes/");
            let store = KnowledgeStore::open(root)?;
            let node = store
                .get_node(id)?
                .ok_or_else(|| anyhow!("node not found: {id}"))?;
            Ok(serde_json::to_value(AxiEnvelope::ok(
                "api.projects.nodes.get",
                node,
            ))?)
        }
        _ if method == "GET" && path == "/v1/projects/local/paths/explain" => {
            let from = query_param(query, "from").ok_or_else(|| anyhow!("from is required"))?;
            let to = query_param(query, "to").ok_or_else(|| anyhow!("to is required"))?;
            let store = KnowledgeStore::open(root)?;
            Ok(serde_json::to_value(AxiEnvelope::ok(
                "api.projects.paths.explain",
                store.find_path(from, to, 6)?,
            ))?)
        }
        _ => Ok(serde_json::to_value(AxiEnvelope::ok(
            "api.not_found",
            json!({"error": "not found", "method": method, "path": path}),
        ))?),
    }
}

fn safe_upload_path(root: &Path, file_path: &str) -> Result<PathBuf> {
    let rel = Path::new(file_path);
    if rel.is_absolute()
        || rel.components().any(|component| {
            matches!(
                component,
                Component::ParentDir | Component::RootDir | Component::Prefix(_)
            )
        })
        || rel.components().any(|component| {
            component
                .as_os_str()
                .to_str()
                .map(|part| part == ".cumulus")
                .unwrap_or(false)
        })
    {
        anyhow::bail!("unsafe upload path: {file_path}");
    }
    Ok(root.join(rel))
}

fn handle_http_stream(path: &Path, stream: &mut TcpStream) -> Result<()> {
    let mut buffer = [0u8; 64 * 1024];
    let n = stream.read(&mut buffer)?;
    let request = String::from_utf8_lossy(&buffer[..n]);
    let mut lines = request.split("\r\n");
    let request_line = lines.next().unwrap_or_default();
    let headers: Vec<&str> = lines.by_ref().take_while(|line| !line.is_empty()).collect();
    if validate_origin(&headers).is_err() {
        write_http(
            stream,
            403,
            "application/json",
            r#"{"error":"forbidden origin"}"#,
        )?;
        return Ok(());
    }
    if request_line.starts_with("GET /health ") {
        write_http(stream, 200, "application/json", r#"{"ok":true}"#)?;
        return Ok(());
    }
    if !request_line.starts_with("POST /mcp ") {
        write_http(stream, 404, "application/json", r#"{"error":"not found"}"#)?;
        return Ok(());
    }
    let body = request.split("\r\n\r\n").nth(1).unwrap_or_default();
    let value: Value = serde_json::from_str(body)?;
    let response = handle_json_rpc(path, value).unwrap_or_else(|| json!({}));
    write_http(
        stream,
        200,
        "application/json",
        &serde_json::to_string(&response)?,
    )?;
    Ok(())
}

fn validate_origin(headers: &[&str]) -> Result<()> {
    if let Some(origin) = header_value(headers, "origin") {
        if !origin.starts_with("http://localhost")
            && !origin.starts_with("http://127.0.0.1")
            && !origin.starts_with("http://[::1]")
        {
            anyhow::bail!("forbidden origin");
        }
    }
    Ok(())
}

fn query_param<'a>(query: &'a str, key: &str) -> Option<&'a str> {
    query.split('&').find_map(|part| {
        let (k, v) = part.split_once('=')?;
        (k == key).then_some(v)
    })
}

fn parse_graph_preset(value: &str) -> GraphViewPreset {
    match value {
        "source" => GraphViewPreset::Source,
        "finance" => GraphViewPreset::Finance,
        "timeline" => GraphViewPreset::Timeline,
        "risk" => GraphViewPreset::Risk,
        _ => GraphViewPreset::Full,
    }
}

fn header_value<'a>(headers: &'a [&str], name: &str) -> Option<&'a str> {
    headers.iter().find_map(|line| {
        let (key, value) = line.split_once(':')?;
        key.eq_ignore_ascii_case(name).then(|| value.trim())
    })
}

fn write_http(stream: &mut TcpStream, status: u16, content_type: &str, body: &str) -> Result<()> {
    let reason = match status {
        200 => "OK",
        403 => "Forbidden",
        404 => "Not Found",
        _ => "Error",
    };
    write!(
        stream,
        "HTTP/1.1 {status} {reason}\r\ncontent-type: {content_type}\r\ncontent-length: {}\r\nconnection: close\r\n\r\n{body}",
        body.len()
    )?;
    Ok(())
}

fn handle_json_rpc(root: &Path, request: Value) -> Option<Value> {
    let id = request.get("id").cloned();
    let method = request
        .get("method")
        .and_then(Value::as_str)
        .unwrap_or_default();
    let response = match method {
        "initialize" => Ok(json!({
            "protocolVersion": "2025-06-18",
            "serverInfo": {"name": "cumulus-knowledge", "version": env!("CARGO_PKG_VERSION")},
            "capabilities": {
                "tools": {},
                "resources": {},
                "prompts": {}
            }
        })),
        "ping" => Ok(json!({})),
        "tools/list" => Ok(json!({"tools": mcp::tool_definitions()})),
        "prompts/list" => Ok(json!({"prompts": mcp::prompt_definitions()})),
        "resources/list" => Ok(json!({
            "resources": [
                {"uri": "cumulus://snapshot/current", "name": "Current Graph Snapshot", "mimeType": "application/json"},
                {"uri": "cumulus://graph-view/current", "name": "Current Semantic Graph View", "mimeType": "application/json"}
            ]
        })),
        "resources/read" => {
            let uri = request
                .pointer("/params/uri")
                .and_then(Value::as_str)
                .ok_or_else(|| anyhow!("params.uri is required"));
            uri.and_then(|uri| read_mcp_resource(root, uri))
        }
        "tools/call" => {
            let name = request
                .pointer("/params/name")
                .and_then(Value::as_str)
                .ok_or_else(|| anyhow!("params.name is required"));
            name.and_then(|name| {
                call_mcp_tool(
                    root,
                    name,
                    request.pointer("/params/arguments").unwrap_or(&Value::Null),
                )
            })
        }
        "prompts/get" => {
            let name = request
                .pointer("/params/name")
                .and_then(Value::as_str)
                .unwrap_or("summarize_neighborhood");
            Ok(json!({
                "description": format!("Cumulus prompt: {name}"),
                "messages": [{
                    "role": "user",
                    "content": {
                        "type": "text",
                        "text": prompt_text(name)
                    }
                }]
            }))
        }
        "notifications/initialized" => return None,
        _ => Err(anyhow!("unsupported method: {method}")),
    };
    let id = id?;
    Some(match response {
        Ok(result) => json!({"jsonrpc": "2.0", "id": id, "result": result}),
        Err(err) => json_rpc_error(id, -32603, &err.to_string()),
    })
}

fn json_rpc_error(id: Value, code: i64, message: &str) -> Value {
    json!({"jsonrpc": "2.0", "id": id, "error": {"code": code, "message": message}})
}

fn read_mcp_resource(root: &Path, uri: &str) -> Result<Value> {
    let store = KnowledgeStore::open(root)?;
    if uri == "cumulus://snapshot/current" {
        let snapshot = store.snapshot(None, 500)?;
        return Ok(
            json!({"contents": [{"uri": uri, "mimeType": "application/json", "text": serde_json::to_string(&snapshot)?}]}),
        );
    }
    if uri == "cumulus://snapshot/current/view" || uri == "cumulus://graph-view/current" {
        let view = store.graph_view(GraphViewPreset::Full, 800)?;
        return Ok(
            json!({"contents": [{"uri": uri, "mimeType": "application/json", "text": serde_json::to_string(&view)?}]}),
        );
    }
    if let Some(id) = uri.strip_prefix("cumulus://node/") {
        let node = store
            .get_node(id)?
            .ok_or_else(|| anyhow!("node not found: {id}"))?;
        return Ok(
            json!({"contents": [{"uri": uri, "mimeType": "application/json", "text": serde_json::to_string(&node)?}]}),
        );
    }
    if let Some(id) = uri.strip_prefix("cumulus://chunk/") {
        let chunk = store
            .get_chunk(id)?
            .ok_or_else(|| anyhow!("chunk not found: {id}"))?;
        return Ok(
            json!({"contents": [{"uri": uri, "mimeType": "application/json", "text": serde_json::to_string(&chunk)?}]}),
        );
    }
    Err(anyhow!("unsupported resource uri: {uri}"))
}

fn call_mcp_tool(root: &Path, name: &str, args: &Value) -> Result<Value> {
    match name {
        "graph_view" => {
            let preset = graph_preset_arg(args);
            let limit = args.get("limit").and_then(Value::as_u64).unwrap_or(800) as usize;
            let store = KnowledgeStore::open(root)?;
            mcp_tool_result(store.graph_view(preset, limit)?)
        }
        "search" => {
            let query = required_str(args, "query")?;
            let limit = args.get("limit").and_then(Value::as_u64).unwrap_or(10) as usize;
            let store = KnowledgeStore::open(root)?;
            mcp_tool_result(store.search(query, limit)?)
        }
        "fetch" => {
            let id = required_str(args, "id")?;
            let store = KnowledgeStore::open(root)?;
            if let Some(node) = store.get_node(id)? {
                mcp_tool_result(node)
            } else if let Some(chunk) = store.get_chunk(id)? {
                mcp_tool_result(chunk)
            } else {
                Err(anyhow!("not found: {id}"))
            }
        }
        "expand_neighbors" => {
            let id = required_str(args, "id")?;
            let depth = args.get("depth").and_then(Value::as_u64).unwrap_or(1) as usize;
            let store = KnowledgeStore::open(root)?;
            mcp_tool_result(store.expand(id, depth)?)
        }
        "find_paths" => {
            let from_id = required_str(args, "from_id")?;
            let to_id = required_str(args, "to_id")?;
            let max_depth = args.get("max_depth").and_then(Value::as_u64).unwrap_or(6) as usize;
            let store = KnowledgeStore::open(root)?;
            mcp_tool_result(store.find_path(from_id, to_id, max_depth)?)
        }
        "summarize_subgraph" => {
            let id = required_str(args, "id")?;
            let depth = args.get("depth").and_then(Value::as_u64).unwrap_or(1) as usize;
            let store = KnowledgeStore::open(root)?;
            let graph = store.expand(id, depth)?;
            let summary = format!(
                "Subgraph around {} has {} nodes and {} edges. Main node kinds: {}.",
                graph.root_id,
                graph.nodes.len(),
                graph.edges.len(),
                graph
                    .nodes
                    .iter()
                    .take(8)
                    .map(|node| node.kind.as_str())
                    .collect::<Vec<_>>()
                    .join(", ")
            );
            mcp_tool_result(json!({"summary": summary, "graph": graph}))
        }
        "source_trace" => {
            let id = required_str(args, "id")?;
            let preset = graph_preset_arg(args);
            let store = KnowledgeStore::open(root)?;
            let view = store.graph_view(preset, 1000)?;
            let evidence = view
                .evidence
                .into_iter()
                .filter(|item| item.node_id == id)
                .collect::<Vec<_>>();
            mcp_tool_result(json!({"node_id": id, "evidence": evidence}))
        }
        "index_status" => {
            let store = KnowledgeStore::open(root)?;
            mcp_tool_result(store.stats()?)
        }
        "ingest" => {
            let profile = match args.get("profile").and_then(Value::as_str).unwrap_or("all") {
                "code" => IndexProfile::Code,
                "docs" => IndexProfile::Docs,
                "facility" => IndexProfile::Facility,
                _ => IndexProfile::All,
            };
            let mut indexer = Indexer::new(root)?;
            mcp_tool_result(indexer.index(IndexOptions {
                profile,
                ..IndexOptions::default()
            })?)
        }
        _ => Err(anyhow!("unknown tool: {name}")),
    }
}

fn graph_preset_arg(args: &Value) -> GraphViewPreset {
    match args.get("preset").and_then(Value::as_str).unwrap_or("full") {
        "source" => GraphViewPreset::Source,
        "finance" => GraphViewPreset::Finance,
        "timeline" => GraphViewPreset::Timeline,
        "risk" => GraphViewPreset::Risk,
        _ => GraphViewPreset::Full,
    }
}

fn required_str<'a>(args: &'a Value, key: &str) -> Result<&'a str> {
    args.get(key)
        .and_then(Value::as_str)
        .ok_or_else(|| anyhow!("{key} is required"))
}

fn mcp_tool_result(data: impl Serialize) -> Result<Value> {
    let structured = serde_json::to_value(data)?;
    Ok(json!({
        "content": [{
            "type": "text",
            "text": serde_json::to_string_pretty(&structured)?
        }],
        "structuredContent": structured
    }))
}

fn prompt_text(name: &str) -> String {
    match name {
        "trace_decision" => "Use Cumulus resources to trace a decision through cited nodes. Return IDs, edge kinds, and missing context.".to_string(),
        "explain_symbol" => "Explain the symbol using its node, chunk, file, imports, and nearby references. Keep the answer compact and cite cumulus:// URIs.".to_string(),
        "audit_context" => "Audit the retrieved Cumulus context for gaps, duplicate chunks, stale files, and missing citations.".to_string(),
        _ => "Summarize the node neighborhood. Lead with stable IDs, relationship counts, and cited source chunks.".to_string(),
    }
}
