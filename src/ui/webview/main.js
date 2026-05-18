// CodeRipple Flow webview renderer.
// Multi-workspace tabs, layered DAG layout, pan+zoom, hover-impact preview.
(function () {
  "use strict";

  const vscode = acquireVsCodeApi();
  const svg = document.getElementById("svg");
  const canvas = document.getElementById("canvas");
  const legend = document.getElementById("legend");
  const riskFilter = document.getElementById("riskFilter");
  const fitBtn = document.getElementById("fit");
  const zoomInBtn = document.getElementById("zoomIn");
  const zoomOutBtn = document.getElementById("zoomOut");
  const tabsEl = document.getElementById("tabs");
  const hoverPanel = document.getElementById("hoverPanel");
  const hpTitle = document.getElementById("hpTitle");
  const hpRisk = document.getElementById("hpRisk");
  const hpMeta = document.getElementById("hpMeta");
  const hpPurpose = document.getElementById("hpPurpose");
  const hpSymbols = document.getElementById("hpSymbols");
  const hpRefs = document.getElementById("hpRefs");

  /** @type {{workspaces:any[], activeKey:string}|null} */
  let state = null;
  /** @type {{x:number,y:number,k:number}} */
  let view = { x: 0, y: 0, k: 1 };
  let dragging = false;
  let dragStart = null;
  let hoverHideTimer = null;
  let viewBoxBase = null;

  const RISK_ORDER = { low: 0, medium: 1, high: 2, critical: 3 };

  window.addEventListener("message", (ev) => {
    const m = ev.data;
    if (!m) return;
    if (m.type === "render") {
      state = { workspaces: m.workspaces, activeKey: m.activeKey };
      render();
    } else if (m.type === "empty") {
      state = null;
      renderEmpty();
    }
  });

  riskFilter.addEventListener("change", render);
  fitBtn.addEventListener("click", () => {
    view = { x: 0, y: 0, k: 1 };
    applyView();
  });
  zoomInBtn.addEventListener("click", () => zoomBy(1.2));
  zoomOutBtn.addEventListener("click", () => zoomBy(1 / 1.2));

  // Pan/zoom on canvas
  canvas.addEventListener(
    "wheel",
    (e) => {
      e.preventDefault();
      const factor = e.deltaY < 0 ? 1.1 : 1 / 1.1;
      zoomBy(factor, e.offsetX, e.offsetY);
    },
    { passive: false },
  );

  svg.addEventListener("mousedown", (e) => {
    dragging = true;
    dragStart = { x: e.clientX, y: e.clientY, vx: view.x, vy: view.y };
    svg.style.cursor = "grabbing";
  });
  window.addEventListener("mouseup", () => {
    dragging = false;
    svg.style.cursor = "";
  });
  window.addEventListener("mousemove", (e) => {
    if (!dragging || !dragStart) return;
    view.x = dragStart.vx + (e.clientX - dragStart.x);
    view.y = dragStart.vy + (e.clientY - dragStart.y);
    applyView();
  });

  vscode.postMessage({ type: "ready" });

  function getActive() {
    if (!state) return null;
    return (
      state.workspaces.find((w) => w.key === state.activeKey) ||
      state.workspaces[0]
    );
  }

  function renderEmpty() {
    tabsEl.innerHTML = "";
    svg.innerHTML = "";
    legend.innerHTML =
      '<span>No analysis yet. Run "CodeRipple: Analyze Changes".</span>';
  }

  function render() {
    if (!state || state.workspaces.length === 0) {
      renderEmpty();
      return;
    }
    renderTabs();
    const active = getActive();
    if (!active) {
      renderEmpty();
      return;
    }
    const minRisk = riskFilter.value;
    const allow = (r) =>
      minRisk === "all" || RISK_ORDER[r] >= RISK_ORDER[minRisk];
    const nodes = active.nodes.filter((n) => allow(n.risk));
    const allowed = new Set(nodes.map((n) => n.id));
    const edges = active.edges.filter(
      (e) => allowed.has(e.from) && allowed.has(e.to),
    );

    if (nodes.length === 0) {
      svg.innerHTML = "";
      legend.innerHTML = "<span>No nodes match filter.</span>";
      return;
    }

    const layers = assignLayers(nodes, edges);
    const positions = layoutGrid(nodes, layers);
    drawSvg(active, nodes, edges, positions);
    drawLegend(active);
    view = { x: 0, y: 0, k: 1 };
    applyView();
  }

  function renderTabs() {
    tabsEl.innerHTML = "";
    const multi = state.workspaces.length > 1;
    for (const ws of state.workspaces) {
      const t = document.createElement("button");
      t.className = "tab" + (ws.key === state.activeKey ? " active" : "");
      t.title = ws.workspaceRoot || ws.workspaceName;
      t.innerHTML = `<span class="tab-name">${esc(ws.workspaceName)}</span>${
        ws.branch ? `<span class="tab-branch">⎇ ${esc(ws.branch)}</span>` : ""
      }<span class="tab-risk risk-pill risk-bg-${ws.risk}">${esc(
        ws.risk,
      )}</span>`;
      t.addEventListener("click", () => {
        state.activeKey = ws.key;
        vscode.postMessage({ type: "setActive", wsKey: ws.key });
        render();
      });
      tabsEl.appendChild(t);
    }
    if (!multi) tabsEl.classList.add("single");
    else tabsEl.classList.remove("single");
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
    for (const arr of byLayer.values()) {
      arr.sort(
        (a, b) =>
          (a.cluster || "").localeCompare(b.cluster || "") ||
          a.label.localeCompare(b.label),
      );
    }
    const COL_W = 240;
    const ROW_H = 72;
    const PAD_X = 60;
    const PAD_Y = 60;
    const pos = new Map();
    const maxLayer = Math.max(...byLayer.keys());
    for (let l = 0; l <= maxLayer; l++) {
      const arr = byLayer.get(l) || [];
      arr.forEach((n, i) => {
        pos.set(n.id, {
          x: PAD_X + l * COL_W,
          y: PAD_Y + i * ROW_H,
          w: 200,
          h: 52,
        });
      });
    }
    return pos;
  }

  function drawSvg(active, nodes, edges, pos) {
    const width =
      Math.max(...Array.from(pos.values()).map((p) => p.x + p.w)) + 60;
    const height =
      Math.max(...Array.from(pos.values()).map((p) => p.y + p.h)) + 60;
    svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
    svg.setAttribute("width", "100%");
    svg.setAttribute("height", "100%");
    svg.innerHTML = "";
    viewBoxBase = { w: width, h: height };

    // Defs: gradients + arrow marker
    const defs = el("defs");
    defs.innerHTML = `
      <marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="8" markerHeight="8" orient="auto-start-reverse">
        <path d="M 0 0 L 10 5 L 0 10 z" fill="currentColor"/>
      </marker>
      <linearGradient id="g-low" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="#3fb950" stop-opacity="0.35"/>
        <stop offset="100%" stop-color="#1f6f33" stop-opacity="0.35"/>
      </linearGradient>
      <linearGradient id="g-medium" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="#d29922" stop-opacity="0.40"/>
        <stop offset="100%" stop-color="#7a5a12" stop-opacity="0.40"/>
      </linearGradient>
      <linearGradient id="g-high" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="#db6d28" stop-opacity="0.45"/>
        <stop offset="100%" stop-color="#7a3c12" stop-opacity="0.45"/>
      </linearGradient>
      <linearGradient id="g-critical" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="#f85149" stop-opacity="0.55"/>
        <stop offset="100%" stop-color="#7a1a16" stop-opacity="0.55"/>
      </linearGradient>
      <filter id="soft-shadow" x="-20%" y="-20%" width="140%" height="140%">
        <feGaussianBlur in="SourceAlpha" stdDeviation="1.5"/>
        <feOffset dy="1"/>
        <feComponentTransfer><feFuncA type="linear" slope="0.4"/></feComponentTransfer>
        <feMerge><feMergeNode/><feMergeNode in="SourceGraphic"/></feMerge>
      </filter>`;
    svg.appendChild(defs);

    // Viewport group (panned/zoomed)
    const root = el("g", { id: "viewport" });
    svg.appendChild(root);

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
      const minX = Math.min(...ps.map((p) => p.x)) - 14;
      const minY = Math.min(...ps.map((p) => p.y)) - 22;
      const maxX = Math.max(...ps.map((p) => p.x + p.w)) + 14;
      const maxY = Math.max(...ps.map((p) => p.y + p.h)) + 14;
      const halo = el("rect", {
        x: minX,
        y: minY,
        width: maxX - minX,
        height: maxY - minY,
        rx: 14,
        ry: 14,
        class: "cluster-halo",
      });
      const label =
        (active.clusters.find((c) => c.id === cid) || {}).title || cid;
      const lbl = el("text", {
        x: minX + 10,
        y: minY + 14,
        class: "cluster-label",
      });
      lbl.textContent = label;
      root.appendChild(halo);
      root.appendChild(lbl);
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
      root.appendChild(
        el("path", {
          d,
          class: `edge ${e.kind}`,
          "marker-end": "url(#arrow)",
          "data-from": e.from,
          "data-to": e.to,
        }),
      );
    }

    // Build file lookup
    const filesById = new Map();
    for (const f of active.files || []) filesById.set(f.id, f);

    // Nodes
    for (const n of nodes) {
      const p = pos.get(n.id);
      const g = el("g", { class: "node", "data-id": n.id });
      g.addEventListener("click", () =>
        vscode.postMessage({
          type: "reveal",
          id: n.id,
          wsKey: active.key,
        }),
      );
      g.addEventListener("mouseenter", () => {
        clearTimeout(hoverHideTimer);
        highlight(n.id, edges);
        showHover(n, filesById.get(n.id), active);
      });
      g.addEventListener("mouseleave", () => {
        clearHighlight();
        hoverHideTimer = setTimeout(() => hideHover(), 250);
      });

      const shape = nodeShape(n, p);
      shape.classList.add(`risk-${n.risk}`);
      shape.setAttribute("filter", "url(#soft-shadow)");
      shape.setAttribute("fill", `url(#g-${n.risk})`);
      g.appendChild(shape);

      // Kind icon (left circle)
      const kind = el("circle", {
        cx: p.x + 14,
        cy: p.y + p.h / 2,
        r: 8,
        class: `kind-dot kind-${n.kind}`,
      });
      g.appendChild(kind);

      const kindLetter = el("text", {
        x: p.x + 14,
        y: p.y + p.h / 2 + 3,
        class: "kind-letter",
        "text-anchor": "middle",
      });
      kindLetter.textContent = kindLetterFor(n.kind);
      g.appendChild(kindLetter);

      const t = el("text", {
        x: p.x + 30,
        y: p.y + p.h / 2 - 2,
        class: "node-label",
      });
      t.textContent = truncate(n.label, 22);
      g.appendChild(t);

      const sub = el("text", {
        x: p.x + 30,
        y: p.y + p.h / 2 + 14,
        class: "node-sub",
      });
      const f = filesById.get(n.id);
      sub.textContent = f
        ? `+${f.additions}/-${f.deletions}` +
          (f.refs && f.refs.length ? `  · ${f.refs.length} ref` : "")
        : n.kind;
      g.appendChild(sub);

      const title = el("title");
      title.textContent = `${n.label}\nkind: ${n.kind}\nrisk: ${n.risk}`;
      g.appendChild(title);

      root.appendChild(g);
    }

    hpRisk.textContent = "";
    hideHover();
  }

  function nodeShape(n, p) {
    switch (n.kind) {
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
          rx: 10,
          ry: 10,
          "stroke-dasharray": "5 3",
        });
      case "symbol":
        return el("rect", {
          x: p.x,
          y: p.y,
          width: p.w,
          height: p.h,
          rx: 26,
          ry: 26,
        });
      case "module":
      default:
        return el("rect", {
          x: p.x,
          y: p.y,
          width: p.w,
          height: p.h,
          rx: 10,
          ry: 10,
        });
    }
  }

  function kindLetterFor(k) {
    switch (k) {
      case "config":
        return "C";
      case "external":
        return "E";
      case "test":
        return "T";
      case "symbol":
        return "ƒ";
      default:
        return "M";
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
    for (const p of svg.querySelectorAll(".edge")) {
      const hot =
        p.getAttribute("data-from") === id || p.getAttribute("data-to") === id;
      p.classList.toggle("hot", hot);
      p.classList.toggle("dim-edge", !hot);
    }
  }
  function clearHighlight() {
    for (const g of svg.querySelectorAll(".node")) g.classList.remove("dim");
    for (const p of svg.querySelectorAll(".edge")) {
      p.classList.remove("hot");
      p.classList.remove("dim-edge");
    }
  }

  function showHover(n, file, active) {
    hoverPanel.classList.remove("hidden");
    hpTitle.textContent = n.label;
    hpRisk.textContent = n.risk;
    hpRisk.className = `risk-pill risk-bg-${n.risk}`;
    hpMeta.innerHTML = `
      <span class="meta-tag">${esc(n.kind)}</span>
      ${file ? `<span class="meta-tag add">+${file.additions}</span><span class="meta-tag del">-${file.deletions}</span>` : ""}
      ${file ? `<span class="meta-tag">${esc(file.path)}</span>` : ""}
    `;
    // Purpose
    if (hpPurpose) {
      const purpose = file && file.purpose ? file.purpose : "";
      hpPurpose.textContent = purpose;
      hpPurpose.style.display = purpose ? "block" : "none";
    }
    // Symbols
    hpSymbols.innerHTML = "";
    if (file && file.symbols && file.symbols.length) {
      for (const sy of file.symbols.slice(0, 8)) {
        const li = document.createElement("li");
        li.className = "hp-symbol";
        li.innerHTML =
          `<span class="hp-sym-name">${esc(sy.name)}</span>` +
          `<span class="hp-sym-kind">${esc(sy.kind)}</span>` +
          (sy.refs && sy.refs.length
            ? `<span class="hp-sym-refs">${sy.refs.length} ref</span>`
            : "");
        li.addEventListener("click", () =>
          vscode.postMessage({
            type: "reveal",
            id: file.path,
            line: sy.startLine,
            wsKey: active.key,
          }),
        );
        hpSymbols.appendChild(li);
      }
    } else {
      hpSymbols.innerHTML = `<li class="muted">— none —</li>`;
    }
    // Refs
    hpRefs.innerHTML = "";
    const allRefs = (file && file.refs) || [];
    if (allRefs.length) {
      for (const r of allRefs.slice(0, 10)) {
        const li = document.createElement("li");
        li.className = "hp-ref" + (r.external ? " external" : "");
        const name = r.path.split("/").pop();
        li.innerHTML =
          `<span class="hp-ref-loc">${esc(name)}:${r.line}</span>` +
          (r.preview
            ? `<span class="hp-ref-preview">${esc(r.preview)}</span>`
            : "");
        li.title = r.path + ":" + r.line;
        li.addEventListener("click", () =>
          vscode.postMessage({
            type: "reveal",
            id: r.path,
            line: r.line,
            wsKey: active.key,
          }),
        );
        hpRefs.appendChild(li);
      }
    } else {
      hpRefs.innerHTML = `<li class="muted">— no external references —</li>`;
    }
  }
  function hideHover() {
    hoverPanel.classList.add("hidden");
  }
  hoverPanel.addEventListener("mouseenter", () => clearTimeout(hoverHideTimer));
  hoverPanel.addEventListener("mouseleave", () => hideHover());

  function drawLegend(active) {
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
    if (active && active.summary) {
      const s = document.createElement("span");
      s.style.marginLeft = "auto";
      s.textContent = active.summary;
      legend.appendChild(s);
    }
  }

  function applyView() {
    const vp = svg.querySelector("#viewport");
    if (!vp) return;
    vp.setAttribute(
      "transform",
      `translate(${view.x} ${view.y}) scale(${view.k})`,
    );
  }
  function zoomBy(factor, cx, cy) {
    const prev = view.k;
    let next = Math.min(4, Math.max(0.2, prev * factor));
    if (cx == null) {
      view.k = next;
    } else {
      // zoom around the cursor
      view.x = cx - ((cx - view.x) * next) / prev;
      view.y = cy - ((cy - view.y) * next) / prev;
      view.k = next;
    }
    applyView();
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
  function esc(s) {
    return String(s == null ? "" : s).replace(
      /[&<>"']/g,
      (c) =>
        ({
          "&": "&amp;",
          "<": "&lt;",
          ">": "&gt;",
          '"': "&quot;",
          "'": "&#39;",
        })[c],
    );
  }
})();
