import type { GraphView } from "./index.js";

export function renderGraphHtml(view: GraphView): string {
  const payload = JSON.stringify(view).replaceAll("</script", "<\\/script");
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Cumulus Knowledge Graph</title>
  <style>
    :root { color-scheme: dark; --bg: #05070d; --panel: rgba(9, 16, 30, .88); --line: #213a5a; --text: #e8f6ff; --muted: #8da7bd; }
    * { box-sizing: border-box; }
    body { margin: 0; min-height: 100vh; font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; background: linear-gradient(90deg, rgba(45, 212, 191, .08) 1px, transparent 1px), linear-gradient(0deg, rgba(248, 180, 64, .06) 1px, transparent 1px), linear-gradient(135deg, #05070d, #10131b 54%, #17110b); background-size: 42px 42px, 42px 42px, auto; color: var(--text); overflow: hidden; }
    header { height: 66px; display: flex; justify-content: space-between; align-items: center; padding: 0 18px; border-bottom: 1px solid var(--line); background: rgba(2, 6, 12, .92); }
    h1 { margin: 0; font-size: 16px; letter-spacing: 0; }
    main { display: grid; grid-template-columns: 300px 1fr 360px; height: calc(100vh - 66px); }
    aside { padding: 14px; overflow: auto; background: var(--panel); border-right: 1px solid var(--line); }
    aside.right { border-left: 1px solid var(--line); border-right: 0; }
    #cy { height: 100%; width: 100%; }
    button, input, select { border: 1px solid #2b4c6e; background: #081524; color: var(--text); border-radius: 7px; min-height: 34px; padding: 0 10px; }
    input { width: 100%; margin: 12px 0; }
    .legend { display: grid; gap: 8px; }
    .legend button { display: flex; width: 100%; justify-content: space-between; align-items: center; }
    .dot { width: 10px; height: 10px; border-radius: 999px; background: var(--c); box-shadow: 0 0 16px var(--c); display: inline-block; margin-right: 8px; }
    .toolbar { display: flex; gap: 8px; align-items: center; }
    .detail h2 { font-size: 18px; margin: 12px 0 8px; }
    .muted { color: var(--muted); }
    pre { white-space: pre-wrap; font-size: 11px; color: #b8d7ea; }
  </style>
</head>
<body>
  <header>
    <h1 id="title">Cumulus Knowledge</h1>
    <div class="toolbar">
      <select id="layout"><option value="preset">Preset lanes</option><option value="cose">Organic</option><option value="breadthfirst">Hierarchy</option></select>
      <button id="fit">Fit</button>
      <button id="neighborhood">Neighborhood</button>
    </div>
  </header>
  <main>
    <aside>
      <strong>Legend</strong>
      <input id="search" placeholder="Search" />
      <div id="legend" class="legend"></div>
    </aside>
    <section id="cy"></section>
    <aside class="right">
      <strong>Selected Node</strong>
      <div id="detail" class="detail"><p class="muted">No node selected.</p></div>
      <strong>Evidence</strong>
      <pre id="evidence"></pre>
    </aside>
  </main>
  <script type="module">
    import cytoscape from 'https://cdn.jsdelivr.net/npm/cytoscape@3.33.1/+esm';
    import { animate, stagger, createTimeline } from 'https://cdn.jsdelivr.net/npm/animejs/+esm';
    const view = ${payload};
    const hiddenKinds = new Set();
    const colors = new Map(view.legend.node_kinds.map(k => [k.kind, k.color]));
    const positions = new Map(view.layout.nodes.map(p => [p.id, p]));
    const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]);
    document.getElementById('title').textContent = view.summary;
    const cy = cytoscape({
      container: document.getElementById('cy'),
      wheelSensitivity: 0.18,
      elements: [
        ...view.nodes.map(node => ({ data: { id: node.id, label: node.display_label, kind: node.domain_kind, subtitle: node.display_subtitle, raw: node }, position: positions.get(node.id) || { x: 0, y: 0 } })),
        ...view.edges.map(edge => ({ data: { id: edge.id, source: edge.from_id, target: edge.to_id, label: edge.label, kind: edge.kind, raw: edge } }))
      ],
      style: [
        { selector: 'node', style: { 'background-color': ele => colors.get(ele.data('kind')) || '#cbd5e1', 'label': 'data(label)', 'font-size': 11, 'text-wrap': 'wrap', 'text-max-width': 140, 'color': '#e8f6ff', 'text-outline-color': '#06111f', 'text-outline-width': 3, 'width': ele => 44 + Math.min(36, ele.data('label').length), 'height': 42, 'border-color': '#dff6ff', 'border-width': 1 } },
        { selector: 'edge', style: { 'curve-style': 'bezier', 'line-color': '#4ea9d8', 'target-arrow-color': '#4ea9d8', 'target-arrow-shape': 'triangle', 'width': 1.2, 'opacity': .68, 'label': 'data(label)', 'font-size': 9, 'color': '#a8cfe5', 'text-background-color': '#06111f', 'text-background-opacity': .8, 'text-background-padding': 2 } },
        { selector: '.faded', style: { 'opacity': .12 } },
        { selector: '.hidden', style: { 'display': 'none' } },
        { selector: ':selected', style: { 'border-width': 4, 'border-color': '#f8fafc' } }
      ],
      layout: { name: 'preset', fit: true, padding: 48 }
    });
    function renderLegend() {
      const legend = document.getElementById('legend');
      legend.innerHTML = '';
      for (const item of view.legend.node_kinds) {
        const button = document.createElement('button');
        button.style.setProperty('--c', item.color);
        button.innerHTML = '<span><span class="dot"></span>' + escapeHtml(item.label) + '</span><span>' + item.count + '</span>';
        button.onclick = () => { hiddenKinds.has(item.kind) ? hiddenKinds.delete(item.kind) : hiddenKinds.add(item.kind); updateFilters(); };
        legend.appendChild(button);
      }
    }
    function updateFilters() {
      cy.nodes().forEach(node => node.toggleClass('hidden', hiddenKinds.has(node.data('kind'))));
      cy.edges().forEach(edge => edge.toggleClass('hidden', edge.source().hasClass('hidden') || edge.target().hasClass('hidden')));
      animate('#cy canvas', { opacity: [.55, 1], duration: 420, ease: 'outCubic' });
    }
    function selectNode(node) {
      const raw = node.data('raw');
      const evidence = view.evidence.filter(item => item.node_id === raw.id);
      document.getElementById('detail').innerHTML = '<h2>' + escapeHtml(raw.display_label) + '</h2><p class="muted">' + escapeHtml(raw.display_kind) + ' - confidence ' + Math.round(raw.confidence * 100) + '%</p><p>' + escapeHtml(raw.display_subtitle || raw.uri) + '</p><code>' + escapeHtml(raw.uri) + '</code>';
      document.getElementById('evidence').textContent = evidence.length ? JSON.stringify(evidence, null, 2) : 'No evidence links.';
      cy.elements().addClass('faded');
      node.closedNeighborhood().removeClass('faded');
      createTimeline().add('#detail', { opacity: [0, 1], translateY: [10, 0], duration: 360, ease: 'outCubic' });
    }
    cy.on('tap', 'node', event => selectNode(event.target));
    document.getElementById('search').oninput = event => {
      const q = event.target.value.toLowerCase();
      cy.nodes().forEach(node => node.toggleClass('hidden', q && !node.data('label').toLowerCase().includes(q) && !node.data('kind').toLowerCase().includes(q)));
      updateFilters();
    };
    document.getElementById('layout').onchange = event => cy.layout({ name: event.target.value, fit: true, padding: 48, animate: true }).run();
    document.getElementById('fit').onclick = () => cy.fit(undefined, 48);
    document.getElementById('neighborhood').onclick = () => cy.elements().removeClass('faded');
    renderLegend();
    animate('aside, header', { opacity: [0, 1], translateY: [-8, 0], delay: stagger(80), duration: 520, ease: 'outExpo' });
  </script>
</body>
</html>`;
}
