import * as vscode from "vscode";
import type { ChangeStore } from "../core/changeStore";
import type { ChangeIntelligence } from "../core/types";
import type { Logger } from "../services/logger";

export class FlowPanel {
  private static current: FlowPanel | undefined;

  static show(
    ctx: vscode.ExtensionContext,
    store: ChangeStore,
    log: Logger,
  ): void {
    if (FlowPanel.current) {
      FlowPanel.current.panel.reveal(vscode.ViewColumn.Beside);
      FlowPanel.current.render();
      return;
    }
    const panel = vscode.window.createWebviewPanel(
      "coderipple.flow",
      "CodeRipple — Flow",
      vscode.ViewColumn.Beside,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [
          vscode.Uri.joinPath(ctx.extensionUri, "out", "ui", "webview"),
        ],
      },
    );
    FlowPanel.current = new FlowPanel(ctx, panel, store, log);
  }

  private disposables: vscode.Disposable[] = [];

  private constructor(
    private ctx: vscode.ExtensionContext,
    private panel: vscode.WebviewPanel,
    private store: ChangeStore,
    private log: Logger,
  ) {
    this.panel.webview.html = this.html();

    this.disposables.push(
      this.panel.onDidDispose(() => this.dispose()),
      { dispose: this.store.onChange(() => this.render()) },
      { dispose: this.store.onActive(() => this.render()) },
      this.panel.webview.onDidReceiveMessage((m) => this.onMessage(m)),
    );

    this.render();
  }

  private render(): void {
    const list = this.store.list();
    if (list.length === 0) {
      void this.panel.webview.postMessage({ type: "empty" });
      return;
    }
    void this.panel.webview.postMessage({
      type: "render",
      activeKey: this.store.activeWorkspaceKey ?? list[0].key,
      workspaces: list.map(({ key, snapshot }) =>
        this.serialize(key, snapshot),
      ),
    });
  }

  private serialize(key: string, s: ChangeIntelligence) {
    // Include references for hover-impact preview. Strip narrative bulk.
    return {
      key,
      workspaceName: s.changeSet.workspaceName,
      workspaceRoot: s.changeSet.workspaceRoot,
      branch: s.changeSet.branch,
      summary: s.summary,
      risk: s.risk,
      intent: s.intent ?? null,
      trust: s.trust ?? null,
      clusters: s.clusters.map((c) => ({
        id: c.id,
        title: c.title,
        risk: c.risk,
        tags: c.tags,
      })),
      nodes: s.flow.nodes,
      edges: s.flow.edges,
      files: s.changeSet.files.map((f) => ({
        id: f.id,
        path: f.path,
        kind: f.kind,
        additions: f.additions,
        deletions: f.deletions,
        purpose: f.purpose ?? "",
        risk: f.risk ?? "low",
        symbols: f.symbols.map((sy) => ({
          name: sy.name,
          kind: sy.kind,
          startLine: sy.startLine,
          refs: (sy.references ?? []).slice(0, 8).map((r) => ({
            path: r.path,
            line: r.line,
            symbol: r.symbol,
            preview: r.preview ?? "",
            external: r.external,
          })),
        })),
        refs: (f.references ?? []).slice(0, 12).map((r) => ({
          path: r.path,
          line: r.line,
          symbol: r.symbol,
          preview: r.preview ?? "",
          external: r.external,
        })),
      })),
    };
  }

  private async onMessage(m: any): Promise<void> {
    if (!m || typeof m.type !== "string") return;
    switch (m.type) {
      case "ready":
        this.render();
        return;
      case "setActive":
        if (typeof m.wsKey === "string") this.store.setActive(m.wsKey);
        return;
      case "reveal": {
        if (typeof m.id !== "string") return;
        const wsKey = typeof m.wsKey === "string" ? m.wsKey : undefined;
        const ws = this.resolveWorkspaceUri(wsKey);
        if (!ws) {
          this.log.warn(`Flow reveal: no workspace folder for key ${wsKey}`);
          return;
        }
        const uri = vscode.Uri.joinPath(ws, ...m.id.split("/"));
        try {
          const opts: vscode.TextDocumentShowOptions = {
            preview: true,
            viewColumn: vscode.ViewColumn.One,
          };
          if (typeof m.line === "number" && m.line > 0) {
            const pos = new vscode.Position(m.line - 1, 0);
            opts.selection = new vscode.Range(pos, pos);
          }
          await vscode.window.showTextDocument(uri, opts);
        } catch (e) {
          this.log.warn("reveal failed", e);
        }
        return;
      }
      default:
        this.log.debug("Unhandled webview message", m.type);
    }
  }

  private resolveWorkspaceUri(wsKey?: string): vscode.Uri | undefined {
    if (wsKey) {
      // wsKey is the repo root fsPath written by changeStore.keyOf(),
      // which equals ChangeSet.workspaceRoot. Use it directly — it may
      // be a sub-folder of a VS Code workspace folder.
      try {
        return vscode.Uri.file(wsKey);
      } catch {
        // fall through
      }
    }
    const folders = vscode.workspace.workspaceFolders ?? [];
    return folders[0]?.uri;
  }

  private html(): string {
    const w = this.panel.webview;
    const base = vscode.Uri.joinPath(
      this.ctx.extensionUri,
      "out",
      "ui",
      "webview",
    );
    const script = w.asWebviewUri(vscode.Uri.joinPath(base, "main.js"));
    const styles = w.asWebviewUri(vscode.Uri.joinPath(base, "styles.css"));
    const nonce = makeNonce();
    const csp = [
      `default-src 'none'`,
      `img-src ${w.cspSource} https:`,
      `style-src ${w.cspSource} 'unsafe-inline'`,
      `script-src 'nonce-${nonce}'`,
      `font-src ${w.cspSource}`,
    ].join("; ");

    return /* html */ `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta http-equiv="Content-Security-Policy" content="${csp}" />
  <link rel="stylesheet" href="${styles}" />
  <title>CodeRipple — Flow</title>
</head>
<body>
  <header class="toolbar">
    <div id="tabs" class="tabs"></div>
    <span class="spacer"></span>
    <label class="filter">Risk
      <select id="riskFilter">
        <option value="all">all</option>
        <option value="medium">≥ medium</option>
        <option value="high">≥ high</option>
      </select>
    </label>
    <button id="fit" title="Fit / Reset view">⌂ Fit</button>
    <button id="zoomIn" title="Zoom in">+</button>
    <button id="zoomOut" title="Zoom out">−</button>
  </header>
  <main id="canvas">
    <svg id="svg" xmlns="http://www.w3.org/2000/svg"></svg>
    <aside id="hoverPanel" class="hover-panel hidden">
      <div class="hp-header">
        <span id="hpTitle" class="hp-title"></span>
        <span id="hpRisk" class="risk-pill"></span>
      </div>
      <div id="hpMeta" class="hp-meta"></div>
      <div id="hpPurpose" class="hp-purpose"></div>
      <div class="hp-section">
        <div class="hp-section-title">Changed symbols</div>
        <ul id="hpSymbols" class="hp-list"></ul>
      </div>
      <div class="hp-section">
        <div class="hp-section-title">Referenced from</div>
        <ul id="hpRefs" class="hp-list"></ul>
      </div>
      <div class="hp-hint">Click node to open • Move away to dismiss</div>
    </aside>
  </main>
  <footer id="legend"></footer>
  <script nonce="${nonce}" src="${script}"></script>
</body>
</html>`;
  }

  private dispose(): void {
    FlowPanel.current = undefined;
    while (this.disposables.length) {
      const d = this.disposables.pop();
      try {
        d?.dispose();
      } catch {
        /* noop */
      }
    }
  }
}

function makeNonce(): string {
  const chars =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let s = "";
  for (let i = 0; i < 24; i++)
    s += chars.charAt(Math.floor(Math.random() * chars.length));
  return s;
}
