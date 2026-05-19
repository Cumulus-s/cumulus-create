use anyhow::Result;

use crate::models::{GraphSnapshot, GraphView};

pub fn to_dot(snapshot: &GraphSnapshot) -> String {
    let mut out =
        String::from("digraph cumulus {\n  rankdir=LR;\n  node [shape=box, style=rounded];\n");
    for node in &snapshot.nodes {
        out.push_str(&format!(
            "  \"{}\" [label=\"{}\\n{}\"];\n",
            escape(&node.id),
            escape(&node.kind),
            escape(&node.label)
        ));
    }
    for edge in &snapshot.edges {
        out.push_str(&format!(
            "  \"{}\" -> \"{}\" [label=\"{}\"];\n",
            escape(&edge.from_id),
            escape(&edge.to_id),
            escape(&edge.kind)
        ));
    }
    out.push_str("}\n");
    out
}

pub fn to_html(snapshot: &GraphSnapshot) -> Result<String> {
    let json = serde_json::to_string(snapshot)?;
    Ok(format!(
        r#"<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Cumulus Knowledge Graph</title>
  <style>
    body {{ margin: 0; font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; background: #101418; color: #eef2f6; }}
    header {{ padding: 14px 18px; border-bottom: 1px solid #26313a; display: flex; gap: 18px; align-items: center; }}
    main {{ display: grid; grid-template-columns: minmax(280px, 420px) 1fr; height: calc(100vh - 58px); }}
    aside {{ border-right: 1px solid #26313a; overflow: auto; padding: 12px; }}
    #graph {{ position: relative; overflow: hidden; }}
    .node {{ position: absolute; border: 1px solid #5d7282; background: #18222b; border-radius: 6px; padding: 7px 9px; min-width: 120px; max-width: 220px; font-size: 12px; }}
    .kind {{ color: #8cc7ff; font-size: 10px; text-transform: uppercase; }}
    .edge {{ color: #8a99a6; font-size: 12px; border-bottom: 1px solid #33424e; padding: 6px 0; }}
    code {{ color: #9ee493; }}
  </style>
</head>
<body>
  <header>
    <strong>Cumulus Knowledge Graph</strong>
    <span id="counts"></span>
  </header>
  <main>
    <aside>
      <h3>Edges</h3>
      <div id="edges"></div>
    </aside>
    <section id="graph"></section>
  </main>
  <script>
    const snapshot = {json};
    document.getElementById('counts').textContent = `${{snapshot.nodes.length}} nodes - ${{snapshot.edges.length}} edges`;
    const graph = document.getElementById('graph');
    const radius = Math.min(window.innerWidth, window.innerHeight) * 0.34;
    const cx = Math.max(280, graph.clientWidth / 2);
    const cy = Math.max(220, graph.clientHeight / 2);
    snapshot.nodes.forEach((node, i) => {{
      const angle = (Math.PI * 2 * i) / Math.max(1, snapshot.nodes.length);
      const el = document.createElement('div');
      el.className = 'node';
      el.style.left = `${{cx + Math.cos(angle) * radius - 80}}px`;
      el.style.top = `${{cy + Math.sin(angle) * radius - 22}}px`;
      el.innerHTML = `<div class="kind">${{node.kind}}</div><div>${{node.label}}</div><code>${{node.id}}</code>`;
      graph.appendChild(el);
    }});
    const edges = document.getElementById('edges');
    snapshot.edges.forEach(edge => {{
      const el = document.createElement('div');
      el.className = 'edge';
      el.textContent = `${{edge.kind}}: ${{edge.from_id}} -> ${{edge.to_id}}`;
      edges.appendChild(el);
    }});
  </script>
</body>
</html>"#
    ))
}

pub fn graph_view_to_dot(view: &GraphView) -> String {
    let mut out =
        String::from("digraph cumulus_view {\n  rankdir=LR;\n  node [shape=box, style=rounded];\n");
    for node in &view.nodes {
        out.push_str(&format!(
            "  \"{}\" [label=\"{}\\n{}\"];\n",
            escape(&node.id),
            escape(&node.display_kind),
            escape(&node.display_label)
        ));
    }
    for edge in &view.edges {
        out.push_str(&format!(
            "  \"{}\" -> \"{}\" [label=\"{}\"];\n",
            escape(&edge.from_id),
            escape(&edge.to_id),
            escape(&edge.label)
        ));
    }
    out.push_str("}\n");
    out
}

pub fn graph_view_to_html(view: &GraphView) -> Result<String> {
    let json = serde_json::to_string(view)?;
    Ok(format!(
        r#"<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Cumulus Knowledge Graph View</title>
  <style>
    :root {{ color-scheme: dark; --bg: #05070d; --panel: rgba(10, 18, 32, .86); --line: #1f3656; --text: #e5f4ff; --muted: #8da7bd; --accent: #38bdf8; }}
    * {{ box-sizing: border-box; }}
    body {{ margin: 0; min-height: 100vh; font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; background: linear-gradient(90deg, rgba(45, 212, 191, .08) 1px, transparent 1px), linear-gradient(0deg, rgba(248, 180, 64, .06) 1px, transparent 1px), linear-gradient(135deg, #05070d, #10131b 54%, #17110b); background-size: 42px 42px, 42px 42px, auto; color: var(--text); overflow: hidden; }}
    header {{ height: 64px; display: flex; align-items: center; justify-content: space-between; gap: 16px; padding: 0 18px; border-bottom: 1px solid var(--line); background: rgba(5, 8, 14, .9); }}
    h1 {{ font-size: 16px; margin: 0; letter-spacing: 0; }}
    button {{ border: 1px solid #284866; background: #0b1726; color: var(--text); border-radius: 6px; min-height: 34px; padding: 0 10px; cursor: pointer; }}
    main {{ display: grid; grid-template-columns: 280px 1fr 340px; height: calc(100vh - 64px); }}
    aside {{ background: var(--panel); border-right: 1px solid var(--line); padding: 14px; overflow: auto; }}
    aside.right {{ border-right: 0; border-left: 1px solid var(--line); }}
    #graph {{ position: relative; overflow: hidden; }}
    svg {{ position: absolute; inset: 0; width: 100%; height: 100%; pointer-events: none; }}
    .node {{ position: absolute; width: 230px; min-height: 82px; border: 1px solid color-mix(in srgb, var(--node-color) 64%, #0f172a); background: linear-gradient(145deg, rgba(15,23,42,.96), rgba(2,8,23,.9)); border-radius: 8px; padding: 11px 12px; box-shadow: 0 0 28px color-mix(in srgb, var(--node-color) 24%, transparent); transform: translate(-50%, -50%); }}
    .node.hidden, .edge.hidden {{ display: none; }}
    .kind {{ color: var(--node-color); font-size: 11px; text-transform: uppercase; font-weight: 700; }}
    .label {{ margin-top: 5px; font-size: 14px; line-height: 1.25; overflow-wrap: anywhere; }}
    .sub {{ color: var(--muted); margin-top: 6px; font-size: 11px; line-height: 1.25; overflow-wrap: anywhere; }}
    .legend {{ display: grid; gap: 8px; }}
    .legend button {{ display: flex; align-items: center; justify-content: space-between; gap: 8px; width: 100%; text-align: left; }}
    .dot {{ width: 10px; height: 10px; border-radius: 999px; display: inline-block; background: var(--legend-color); box-shadow: 0 0 14px var(--legend-color); }}
    .search {{ width: 100%; height: 36px; margin: 12px 0; border: 1px solid #284866; background: #07111d; color: var(--text); border-radius: 6px; padding: 0 10px; }}
    pre {{ white-space: pre-wrap; font-size: 11px; color: #b7d7ea; }}
    .edge {{ stroke: #7dd3fc; stroke-width: 1.4; stroke-opacity: .72; fill: none; }}
  </style>
</head>
<body>
  <header>
    <h1 id="title">Cumulus Knowledge</h1>
    <div><button id="fit">Fit</button> <button id="reset">Reset Filters</button></div>
  </header>
  <main>
    <aside>
      <strong>Legend</strong>
      <input id="search" class="search" placeholder="Search" />
      <div id="legend" class="legend"></div>
    </aside>
    <section id="graph"><svg id="edges"></svg></section>
    <aside class="right">
      <strong>Detail</strong>
      <div id="detail"><p>No node selected.</p></div>
      <strong>Evidence</strong>
      <pre id="evidence"></pre>
    </aside>
  </main>
  <script type="module">
    import {{ animate, stagger, createTimeline }} from 'https://cdn.jsdelivr.net/npm/animejs/+esm';
    const view = {json};
    const graph = document.getElementById('graph');
    const svg = document.getElementById('edges');
    const detail = document.getElementById('detail');
    const evidenceEl = document.getElementById('evidence');
    const hiddenKinds = new Set();
    const positions = new Map(view.layout.nodes.map(n => [n.id, n]));
    const esc = value => String(value || '').replace(/[&<>"']/g, ch => ({{'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}})[ch]);
    document.getElementById('title').textContent = `${{view.summary}}`;
    const colorByKind = new Map(view.legend.node_kinds.map(item => [item.kind, item.color]));
    const nodes = new Map();
    for (const node of view.nodes) {{
      const pos = positions.get(node.id) || {{x: 200, y: 200}};
      const el = document.createElement('button');
      el.className = 'node';
      el.dataset.id = node.id;
      el.dataset.kind = node.domain_kind;
      el.style.setProperty('--node-color', colorByKind.get(node.domain_kind) || '#cbd5e1');
      el.style.left = `${{pos.x}}px`;
      el.style.top = `${{pos.y}}px`;
      el.innerHTML = `<div class="kind">${{esc(node.display_kind)}}</div><div class="label">${{esc(node.display_label)}}</div><div class="sub">${{esc(node.display_subtitle || node.uri)}}</div>`;
      el.addEventListener('click', () => selectNode(node));
      graph.appendChild(el);
      nodes.set(node.id, el);
    }}
    function renderLegend() {{
      const legend = document.getElementById('legend');
      legend.innerHTML = '';
      for (const item of view.legend.node_kinds) {{
        const btn = document.createElement('button');
        btn.style.setProperty('--legend-color', item.color);
        btn.innerHTML = `<span><span class="dot"></span> ${{esc(item.label)}}</span><span>${{item.count}}</span>`;
        btn.addEventListener('click', () => {{
          hiddenKinds.has(item.kind) ? hiddenKinds.delete(item.kind) : hiddenKinds.add(item.kind);
          updateVisibility();
        }});
        legend.appendChild(btn);
      }}
    }}
    function drawEdges() {{
      svg.innerHTML = '';
      for (const edge of view.edges) {{
        const from = positions.get(edge.from_id);
        const to = positions.get(edge.to_id);
        if (!from || !to) continue;
        const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        const mid = (from.x + to.x) / 2;
        path.setAttribute('d', `M${{from.x}},${{from.y}} C${{mid}},${{from.y}} ${{mid}},${{to.y}} ${{to.x}},${{to.y}}`);
        path.setAttribute('class', 'edge');
        path.dataset.from = edge.from_id;
        path.dataset.to = edge.to_id;
        path.dataset.kind = edge.kind;
        svg.appendChild(path);
      }}
      animate('path.edge', {{ strokeDashoffset: [220, 0], opacity: [.1, .8], delay: stagger(12), duration: 640, ease: 'outCubic' }});
    }}
    function updateVisibility() {{
      for (const [id, el] of nodes) {{
        el.classList.toggle('hidden', hiddenKinds.has(el.dataset.kind));
      }}
      for (const edge of svg.querySelectorAll('path.edge')) {{
        const a = nodes.get(edge.dataset.from);
        const b = nodes.get(edge.dataset.to);
        edge.classList.toggle('hidden', !a || !b || a.classList.contains('hidden') || b.classList.contains('hidden'));
      }}
      animate('.node:not(.hidden)', {{ scale: [0.96, 1], opacity: [0.7, 1], delay: stagger(8), duration: 360, ease: 'outBack' }});
    }}
    function selectNode(node) {{
      detail.innerHTML = `<h2>${{esc(node.display_label)}}</h2><p>${{esc(node.display_kind)}} - confidence ${{Math.round(node.confidence * 100)}}%</p><p>${{esc(node.display_subtitle || '')}}</p><code>${{esc(node.uri)}}</code>`;
      const evidence = view.evidence.filter(item => item.node_id === node.id);
      evidenceEl.textContent = evidence.length ? JSON.stringify(evidence, null, 2) : 'No evidence links for this node.';
      createTimeline().add(nodes.get(node.id), {{ scale: [1, 1.06, 1], duration: 520, ease: 'outElastic(1, .6)' }});
    }}
    document.getElementById('search').addEventListener('input', e => {{
      const q = e.target.value.toLowerCase();
      for (const node of view.nodes) {{
        const el = nodes.get(node.id);
        const match = !q || node.display_label.toLowerCase().includes(q) || node.display_kind.toLowerCase().includes(q);
        el.classList.toggle('hidden', !match || hiddenKinds.has(node.domain_kind));
      }}
      updateVisibility();
    }});
    document.getElementById('reset').addEventListener('click', () => {{ hiddenKinds.clear(); updateVisibility(); }});
    document.getElementById('fit').addEventListener('click', () => graph.scrollTo({{ left: 0, top: 0, behavior: 'smooth' }}));
    renderLegend();
    drawEdges();
    animate('.node', {{ opacity: [0, 1], translateY: [18, 0], scale: [.92, 1], delay: stagger(35), duration: 720, ease: 'outExpo' }});
  </script>
</body>
</html>"#
    ))
}

fn escape(input: &str) -> String {
    input
        .replace('\\', "\\\\")
        .replace('"', "\\\"")
        .replace('\n', "\\n")
}
