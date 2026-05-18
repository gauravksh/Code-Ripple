// CodeRipple Dashboard webview.
// Renders modern, card-based, multi-workspace pulse.
(function () {
  "use strict";

  const vscode = acquireVsCodeApi();
  const root = document.getElementById("root");
  const statusEl = document.getElementById("status");
  const analyzeBtn = document.getElementById("analyze");

  /** @type {{workspaces:any[], analyzing:boolean}} */
  let state = { workspaces: [], analyzing: false };

  window.addEventListener("message", (ev) => {
    const m = ev.data;
    if (!m) return;
    if (m.type === "dashboard") {
      state = { workspaces: m.workspaces || [], analyzing: !!m.analyzing };
      render();
    } else if (m.type === "status") {
      state.analyzing = !!m.analyzing;
      paintStatus();
    }
  });

  analyzeBtn.addEventListener("click", () =>
    vscode.postMessage({ type: "analyze" }),
  );

  vscode.postMessage({ type: "ready" });

  function paintStatus() {
    statusEl.textContent = state.analyzing ? "● Analyzing…" : "";
    statusEl.classList.toggle("pulse", state.analyzing);
  }

  function render() {
    paintStatus();
    if (state.workspaces.length === 0) {
      root.innerHTML = `
        <section class="empty">
          <div class="empty-card">
            <h2>No analysis yet</h2>
            <p>Open a folder with a git repo, make some changes, and CodeRipple will summarise the ripple.</p>
            <button class="primary" id="empty-analyze">Run analysis</button>
          </div>
        </section>`;
      document
        .getElementById("empty-analyze")
        ?.addEventListener("click", () =>
          vscode.postMessage({ type: "analyze" }),
        );
      return;
    }

    root.innerHTML = state.workspaces.map(renderWorkspace).join("");
    bindWorkspaceEvents();
  }

  function renderWorkspace(ws) {
    const t = ws.totals;
    const langs = (ws.languages || [])
      .slice(0, 5)
      .map(
        (l) => `<span class="chip">${esc(l.lang)} <em>${l.count}</em></span>`,
      )
      .join("");

    const clusters = (ws.clusters || [])
      .map(
        (c) => `
        <article class="cluster-card risk-bg-${c.risk}">
          <header>
            <span class="risk-dot risk-${c.risk}"></span>
            <h4>${esc(c.title)}</h4>
            <span class="badge">${c.files} file(s)</span>
          </header>
          <p class="rationale">${esc(c.rationale)}</p>
          ${
            c.tags && c.tags.length
              ? `<div class="tags">${c.tags
                  .map((tg) => `<span class="tag">${esc(tg)}</span>`)
                  .join("")}</div>`
              : ""
          }
        </article>`,
      )
      .join("");

    const topFiles = (ws.topFiles || [])
      .map(
        (f) => `
        <li class="file-row" data-ws="${esc(ws.key)}" data-path="${esc(f.path)}">
          <div class="file-row-main">
            <span class="file-kind kind-${f.kind}">${kindIcon(f.kind)}</span>
            <span class="file-path" title="${esc(f.path)}">${esc(f.path)}</span>
            <span class="file-stats">
              <span class="add">+${f.additions}</span>
              <span class="del">-${f.deletions}</span>
              ${f.symbols ? `<span class="sym" title="symbols touched">${f.symbols}◊</span>` : ""}
              ${f.refs ? `<span class="ref" title="references found">${f.refs}⇢</span>` : ""}
              ${f.risk ? `<span class="risk-pill risk-bg-${f.risk}">${cap(f.risk)}</span>` : ""}
            </span>
          </div>
          ${f.purpose ? `<div class="file-purpose">${esc(f.purpose)}</div>` : ""}
        </li>`,
      )
      .join("");

    const intent = ws.intent
      ? `
        <div class="card intent-card">
          <div class="card-head">
            <h3>Inferred intent</h3>
            <span class="confidence" title="confidence">${Math.round((ws.intent.confidence || 0) * 100)}%</span>
          </div>
          <div class="intent-label">${esc(ws.intent.label)}</div>
          <div class="intent-kind muted">${esc(ws.intent.kind)}</div>
          <p class="intent-rationale">${esc(ws.intent.rationale)}</p>
        </div>`
      : "";

    const trust = ws.trust
      ? `
        <div class="card trust-card trust-${ws.trust.verdict}">
          <div class="card-head">
            <h3>Trust score</h3>
            <span class="trust-score">${ws.trust.score}</span>
          </div>
          <div class="trust-verdict">${cap(ws.trust.verdict)} confidence</div>
          <ul class="signal-list">
            ${(ws.trust.signals || [])
              .map(
                (s) =>
                  `<li class="signal ${s.kind}"><span class="dot"></span>${esc(s.label)}</li>`,
              )
              .join("")}
          </ul>
        </div>`
      : "";

    const tests = "";

    const blast = ws.blastRadius
      ? `
        <div class="card blast-card">
          <div class="card-head">
            <h3>Blast radius</h3>
            <span class="risk-pill risk-bg-${ws.blastRadius.severity}">${cap(ws.blastRadius.severity)}</span>
          </div>
          ${
            ws.blastRadius.modules.length
              ? `<div class="chips-row small">${ws.blastRadius.modules.map((m) => `<span class="chip">${esc(m)}</span>`).join("")}</div>`
              : ""
          }
          ${
            ws.blastRadius.files.length
              ? `<div class="section-label">Likely impacted files (${ws.blastRadius.files.length})</div>
                 <ul class="test-list">${ws.blastRadius.files
                   .slice(0, 8)
                   .map(
                     (p) =>
                       `<li class="test-row" data-ws="${esc(ws.key)}" data-path="${esc(p)}">${esc(p)}</li>`,
                   )
                   .join("")}</ul>`
              : `<div class="muted small">No external impact detected.</div>`
          }
        </div>`
      : "";

    return `
    <section class="workspace" data-ws="${esc(ws.key)}">
      <header class="ws-header">
        <div class="ws-title">
          <h2>${esc(ws.workspaceName)}</h2>
          ${ws.branch ? `<span class="branch">⎇ ${esc(ws.branch)}</span>` : ""}
          ${ws.head ? `<span class="sha mono">${esc(ws.head)}</span>` : ""}
          ${ws.partial ? `<span class="badge warn">partial</span>` : ""}
        </div>
        <div class="ws-actions">
          <button class="ghost" data-action="openFlow" data-ws="${esc(ws.key)}">⇢ Flow Diagram</button>
        </div>
      </header>

      <p class="summary">${esc(ws.summary || "—")}</p>

      <div class="metrics-grid">
        <div class="metric-card risk-bg-${ws.risk}">
          <div class="metric-label">Risk</div>
          <div class="metric-value">${cap(ws.risk)}</div>
          <div class="metric-foot">source: ${esc(ws.source)}</div>
        </div>
        <div class="metric-card">
          <div class="metric-label">Files changed</div>
          <div class="metric-value">${t.files}</div>
          <div class="metric-foot">${ws.clusters.length} cluster(s)</div>
        </div>
        <div class="metric-card">
          <div class="metric-label">Churn</div>
          <div class="metric-value"><span class="add">+${t.additions}</span> / <span class="del">-${t.deletions}</span></div>
          <div class="metric-foot">${t.edges} cross-file edge(s)</div>
        </div>
        <div class="metric-card test-${ws.testStatus}">
          <div class="metric-label">Tests</div>
          <div class="metric-value">${cap(ws.testStatus)}</div>
          <div class="metric-foot">coverage signal</div>
        </div>
      </div>

      ${langs ? `<div class="chips-row">${langs}</div>` : ""}

      <div class="cards-row">
        ${intent}
        ${trust}
      </div>

      <div class="cards-row">
        <div class="card">
          <h3>Clusters</h3>
          <div class="cluster-grid">${clusters || `<div class="muted">No clusters.</div>`}</div>
        </div>
        <div class="card">
          <h3>Top changed files</h3>
          <ul class="file-list">${topFiles || `<li class="muted">No files.</li>`}</ul>
        </div>
      </div>

      <div class="cards-row">
        ${tests}
        ${blast}
      </div>

      ${ws.narrative ? `<div class="narrative">${esc(ws.narrative)}</div>` : ""}
    </section>`;
  }

  function bindWorkspaceEvents() {
    root.querySelectorAll(".file-row").forEach((el) => {
      el.addEventListener("click", () => {
        vscode.postMessage({
          type: "openFile",
          wsKey: el.getAttribute("data-ws"),
          path: el.getAttribute("data-path"),
        });
      });
    });
    root.querySelectorAll(".test-row").forEach((el) => {
      el.addEventListener("click", () => {
        vscode.postMessage({
          type: "openFile",
          wsKey: el.getAttribute("data-ws"),
          path: el.getAttribute("data-path"),
        });
      });
    });
    root.querySelectorAll('[data-action="openFlow"]').forEach((el) => {
      el.addEventListener("click", () => {
        vscode.postMessage({
          type: "openFlow",
          wsKey: el.getAttribute("data-ws"),
        });
      });
    });
  }

  function kindIcon(k) {
    switch (k) {
      case "added":
        return "A";
      case "deleted":
        return "D";
      case "renamed":
        return "R";
      default:
        return "M";
    }
  }
  function cap(s) {
    return s ? s.charAt(0).toUpperCase() + s.slice(1) : "—";
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
