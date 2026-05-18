// CodeRipple Flow webview renderer.
// Receives messages: { type:'render', payload } | { type:'empty' }
// Layered DAG layout (longest-path) with cluster halos. Vanilla SVG, no deps.
(function () {
  "use strict";

  const vscode = acquireVsCodeApi();
  const svg = document.getElementById("svg");
  const legend = document.getElementById("legend");
  const riskFilter = document.getElementById("riskFilter");
  const fitBtn = document.getElementById("fit");

  /** @type {{summary:string,risk:string,clusters:any[],nodes:any[],edges:any[]}|null} */
  let state = null;

  const RISK_ORDER = { low: 0, medium: 1, high: 2, critical: 3 };

  window.addEventListener("message", (ev) => {
    const m = ev.data;
    if (!m) return;
    if (m.type === "render") {
      state = m.payload;
      render();
    } else if (m.type === "empty") {
      state = null;
      renderEmpty();
    }
  });

  riskFilter.addEventListener("change", render);
  fitBtn.addEventListener("click", render);

  vscode.postMessage({ type: "ready" });

  function renderEmpty() {
    svg.innerHTML = "";
    legend.innerHTML =
      '<span>No analysis yet. Run "CodeRipple: Analyze Changes".</span>';
  }

  function render() {
    if (!state) {
      renderEmpty();
      return;
    }
    const minRisk = riskFilter.value;
    const allow = (r) =>
      minRisk === "all" || RISK_ORDER[r] >= RISK_ORDER[minRisk];

    const nodes = state.nodes.filter((n) => allow(n.risk));
    const allowed = new Set(nodes.map((n) => n.id));
    const edges = state.edges.filter(
      (e) => allowed.has(e.from) && allowed.has(e.to),
    );

    if (nodes.length === 0) {
      svg.innerHTML = "";
      legend.innerHTML = "<span>No nodes match filter.</span>";
      return;
    }

    const layers = assignLayers(nodes, edges);
    const positions = layoutGrid(nodes, layers);
    drawSvg(nodes, edges, positions);
    drawLegend();
  }

  /** Longest-path layering on a DAG. Cycles broken arbitrarily. */
  function assignLayers(nodes, edges) {
    const incoming = new Map(nodes.map((n) => [n.id, []]));
    const outgoing = new Map(nodes.map((n) => [n.id, []]));
    for (const e of edges) {
      if (e.from === e.to) continue;
      if (!incoming.has(e.to) || !outgoing.has(e.from)) continue;
      incoming.get(e.to).push(e.from);
      outgoing.get(e.from).push(e.to);
    }
    const layer = new Map();
    const visiting = new Set();

    function rank(id) {
      if (layer.has(id)) return layer.get(id);
      if (visiting.has(id)) return 0;
      visiting.add(id);
      const ins = incoming.get(id) || [];
      let r = 0;
      for (const p of ins) r = Math.max(r, rank(p) + 1);
      visiting.delete(id);
      layer.set(id, r);
      return r;
    }
    nodes.forEach((n) => rank(n.id));
    return layer;
  }

  function layoutGrid(nodes, layers) {
    const byLayer = new Map();
    for (const n of nodes) {
      const l = layers.get(n.id) || 0;
      if (!byLayer.has(l)) byLayer.set(l, []);
      byLayer.get(l).push(n);
    }
    // Sort within layer by cluster then label.
    for (const arr of byLayer.values()) {
      arr.sort(
        (a, b) =>
          (a.cluster || "").localeCompare(b.cluster || "") ||
          a.label.localeCompare(b.label),
      );
    }

    const COL_W = 220;
    const ROW_H = 56;
    const PAD_X = 40;
    const PAD_Y = 40;

    const pos = new Map();
    const maxLayer = Math.max(...byLayer.keys());
    for (let l = 0; l <= maxLayer; l++) {
      const arr = byLayer.get(l) || [];
      arr.forEach((n, i) => {
        pos.set(n.id, {
          x: PAD_X + l * COL_W,
          y: PAD_Y + i * ROW_H,
          w: 180,
          h: 36,
        });
      });
    }
    return pos;
  }

  function drawSvg(nodes, edges, pos) {
    const width =
      Math.max(...Array.from(pos.values()).map((p) => p.x + p.w)) + 40;
    const height =
      Math.max(...Array.from(pos.values()).map((p) => p.y + p.h)) + 40;
    svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
    svg.setAttribute("width", String(width));
    svg.setAttribute("height", String(height));
    svg.innerHTML = "";

    // Cluster halos
    const byCluster = new Map();
    for (const n of nodes) {
      if (!n.cluster) continue;
      if (!byCluster.has(n.cluster)) byCluster.set(n.cluster, []);
      byCluster.get(n.cluster).push(n);
    }
    for (const [cid, ns] of byCluster) {
      const ps = ns.map((n) => pos.get(n.id)).filter(Boolean);
      if (ps.length === 0) continue;
      const minX = Math.min(...ps.map((p) => p.x)) - 10;
      const minY = Math.min(...ps.map((p) => p.y)) - 18;
      const maxX = Math.max(...ps.map((p) => p.x + p.w)) + 10;
      const maxY = Math.max(...ps.map((p) => p.y + p.h)) + 10;
      const halo = el("rect", {
        x: minX,
        y: minY,
        width: maxX - minX,
        height: maxY - minY,
        class: "cluster-halo",
      });
      const label =
        (state.clusters.find((c) => c.id === cid) || {}).title || cid;
      const lbl = el("text", {
        x: minX + 8,
        y: minY + 12,
        class: "cluster-label",
      });
      lbl.textContent = label;
      svg.appendChild(halo);
      svg.appendChild(lbl);
    }

    // Edges
    for (const e of edges) {
      const a = pos.get(e.from);
      const b = pos.get(e.to);
      if (!a || !b) continue;
      const x1 = a.x + a.w;
      const y1 = a.y + a.h / 2;
      const x2 = b.x;
      const y2 = b.y + b.h / 2;
      const mx = (x1 + x2) / 2;
      const d = `M ${x1} ${y1} C ${mx} ${y1}, ${mx} ${y2}, ${x2} ${y2}`;
      svg.appendChild(el("path", { d, class: `edge ${e.kind}` }));
    }

    // Nodes
    for (const n of nodes) {
      const p = pos.get(n.id);
      const g = el("g", { class: "node", "data-id": n.id });
      g.addEventListener("click", () =>
        vscode.postMessage({ type: "reveal", id: n.id }),
      );
      g.addEventListener("mouseenter", () => highlight(n.id, edges));
      g.addEventListener("mouseleave", () => clearHighlight());

      const shape = nodeShape(n, p);
      shape.classList.add(`risk-${n.risk}`);
      g.appendChild(shape);

      const t = el("text", { x: p.x + 10, y: p.y + p.h / 2 + 4 });
      t.textContent = truncate(n.label, 24);
      g.appendChild(t);

      const title = el("title");
      title.textContent = `${n.label}\nkind: ${n.kind}\nrisk: ${n.risk}`;
      g.appendChild(title);

      svg.appendChild(g);
    }
  }

  function nodeShape(n, p) {
    switch (n.kind) {
      case "symbol":
        return el("ellipse", {
          cx: p.x + p.w / 2,
          cy: p.y + p.h / 2,
          rx: p.w / 2,
          ry: p.h / 2,
        });
      case "config": {
        const cx = p.x + p.w / 2,
          cy = p.y + p.h / 2;
        const w = p.w,
          h = p.h;
        return el("polygon", {
          points: `${cx - w / 2},${cy} ${cx},${cy - h / 2} ${cx + w / 2},${cy} ${cx},${cy + h / 2}`,
        });
      }
      case "external": {
        const cx = p.x + p.w / 2,
          cy = p.y + p.h / 2;
        const w = p.w,
          h = p.h;
        return el("polygon", {
          points: `${cx - w / 2},${cy} ${cx - w / 4},${cy - h / 2} ${cx + w / 4},${cy - h / 2} ${cx + w / 2},${cy} ${cx + w / 4},${cy + h / 2} ${cx - w / 4},${cy + h / 2}`,
        });
      }
      case "test":
        return el("rect", {
          x: p.x,
          y: p.y,
          width: p.w,
          height: p.h,
          rx: 6,
          ry: 6,
          "stroke-dasharray": "4 3",
        });
      case "module":
      default:
        return el("rect", {
          x: p.x,
          y: p.y,
          width: p.w,
          height: p.h,
          rx: 4,
          ry: 4,
        });
    }
  }

  function highlight(id, edges) {
    const related = new Set([id]);
    for (const e of edges) {
      if (e.from === id) related.add(e.to);
      if (e.to === id) related.add(e.from);
    }
    for (const g of svg.querySelectorAll(".node")) {
      g.classList.toggle("dim", !related.has(g.getAttribute("data-id")));
    }
  }
  function clearHighlight() {
    for (const g of svg.querySelectorAll(".node")) g.classList.remove("dim");
  }

  function drawLegend() {
    legend.innerHTML = "";
    const items = [
      ["risk-low", "low"],
      ["risk-medium", "medium"],
      ["risk-high", "high"],
      ["risk-critical", "critical"],
    ];
    for (const [cls, label] of items) {
      const sp = document.createElement("span");
      sp.innerHTML = `<span class="legend-swatch ${cls}"></span>${label}`;
      legend.appendChild(sp);
    }
    if (state && state.summary) {
      const s = document.createElement("span");
      s.style.marginLeft = "auto";
      s.textContent = state.summary;
      legend.appendChild(s);
    }
  }

  function el(name, attrs) {
    const e = document.createElementNS("http://www.w3.org/2000/svg", name);
    if (attrs)
      for (const k of Object.keys(attrs)) e.setAttribute(k, String(attrs[k]));
    return e;
  }

  function truncate(s, n) {
    return s.length <= n ? s : s.slice(0, n - 1) + "…";
  }
})();
