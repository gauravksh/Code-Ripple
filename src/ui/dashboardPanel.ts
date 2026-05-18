import * as vscode from "vscode";
import type { ChangeStore } from "../core/changeStore";
import type { ChangeIntelligence } from "../core/types";
import type { Logger } from "../services/logger";

/**
 * Modern workspace pulse dashboard — webview-based, multi-workspace.
 * Cards for repo summary, risk, churn, tests, clusters, top files.
 */
export class DashboardPanel {
  private static current: DashboardPanel | undefined;

  static show(
    ctx: vscode.ExtensionContext,
    store: ChangeStore,
    log: Logger,
  ): void {
    if (DashboardPanel.current) {
      DashboardPanel.current.panel.reveal(vscode.ViewColumn.Active);
      DashboardPanel.current.render();
      return;
    }
    const panel = vscode.window.createWebviewPanel(
      "coderipple.dashboard",
      "CodeRipple — Workspace Pulse",
      vscode.ViewColumn.Active,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [
          vscode.Uri.joinPath(ctx.extensionUri, "out", "ui", "webview"),
        ],
      },
    );
    DashboardPanel.current = new DashboardPanel(ctx, panel, store, log);
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
      { dispose: this.store.onStatus(() => this.renderStatus()) },
      this.panel.webview.onDidReceiveMessage((m) => this.onMessage(m)),
    );
    this.render();
  }

  private renderStatus(): void {
    void this.panel.webview.postMessage({
      type: "status",
      analyzing: this.store.isAnalyzing,
    });
  }

  private render(): void {
    const list = this.store.list();
    const payload = list.map(({ key, snapshot }) =>
      this.serialize(key, snapshot),
    );
    void this.panel.webview.postMessage({
      type: "dashboard",
      workspaces: payload,
      analyzing: this.store.isAnalyzing,
    });
  }

  private serialize(key: string, s: ChangeIntelligence) {
    const cs = s.changeSet;
    const totalAdd = cs.files.reduce((n, f) => n + f.additions, 0);
    const totalDel = cs.files.reduce((n, f) => n + f.deletions, 0);
    const topFiles = [...cs.files]
      .sort((a, b) => b.additions + b.deletions - (a.additions + a.deletions))
      .slice(0, 8)
      .map((f) => ({
        path: f.path,
        additions: f.additions,
        deletions: f.deletions,
        kind: f.kind,
        symbols: f.symbols.length,
        refs: f.references?.length ?? 0,
        purpose: f.purpose ?? "",
        risk: f.risk ?? "low",
      }));
    const langs = new Map<string, number>();
    for (const f of cs.files)
      langs.set(f.language, (langs.get(f.language) ?? 0) + 1);
    return {
      key,
      workspaceName: cs.workspaceName,
      workspaceRoot: cs.workspaceRoot,
      branch: cs.branch ?? null,
      head: cs.head ? cs.head.slice(0, 7) : null,
      remote: cs.remote ?? null,
      summary: s.summary,
      narrative: s.narrative,
      risk: s.risk,
      testStatus: s.testStatus,
      source: s.source,
      partial: s.partial,
      totals: {
        files: cs.files.length,
        additions: totalAdd,
        deletions: totalDel,
        edges: cs.edges.length,
        truncated: cs.truncated,
      },
      languages: Array.from(langs.entries())
        .sort((a, b) => b[1] - a[1])
        .map(([lang, count]) => ({ lang, count })),
      clusters: s.clusters.map((c) => ({
        id: c.id,
        title: c.title,
        risk: c.risk,
        files: c.fileIds.length,
        rationale: c.rationale,
        tags: c.tags,
      })),
      intent: s.intent ?? null,
      trust: s.trust ?? null,
      tests: s.tests ?? null,
      blastRadius: s.blastRadius ?? null,
      topFiles,
    };
  }

  private async onMessage(m: any): Promise<void> {
    if (!m || typeof m.type !== "string") return;
    switch (m.type) {
      case "ready":
        this.render();
        return;
      case "openFile": {
        const wsUri = this.resolveWorkspaceUri(m.wsKey);
        if (!wsUri || typeof m.path !== "string") return;
        const uri = vscode.Uri.joinPath(wsUri, ...m.path.split("/"));
        try {
          await vscode.window.showTextDocument(uri, { preview: true });
        } catch (e) {
          this.log.warn("dashboard open failed", e);
        }
        return;
      }
      case "analyze":
        await vscode.commands.executeCommand("coderipple.analyze");
        return;
      case "openFlow":
        if (typeof m.wsKey === "string") this.store.setActive(m.wsKey);
        await vscode.commands.executeCommand("coderipple.openFlow");
        return;
      default:
        this.log.debug("dashboard unhandled", m.type);
    }
  }

  private resolveWorkspaceUri(wsKey: string): vscode.Uri | undefined {
    if (wsKey) {
      try {
        return vscode.Uri.file(wsKey);
      } catch {
        // ignore
      }
    }
    return vscode.workspace.workspaceFolders?.[0]?.uri;
  }

  private html(): string {
    const w = this.panel.webview;
    const base = vscode.Uri.joinPath(
      this.ctx.extensionUri,
      "out",
      "ui",
      "webview",
    );
    const script = w.asWebviewUri(vscode.Uri.joinPath(base, "dashboard.js"));
    const styles = w.asWebviewUri(vscode.Uri.joinPath(base, "dashboard.css"));
    const nonce = makeNonce();
    const csp = [
      `default-src 'none'`,
      `img-src ${w.cspSource} https: data:`,
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
  <title>CodeRipple — Workspace Pulse</title>
</head>
<body>
  <header class="app-header">
    <div class="brand">
      <span class="logo">◉</span>
      <div>
        <div class="title">CodeRipple</div>
        <div class="subtitle">Workspace Pulse</div>
      </div>
    </div>
    <div class="actions">
      <span id="status" class="status"></span>
      <button id="analyze">Re-analyze</button>
    </div>
  </header>
  <main id="root"></main>
  <script nonce="${nonce}" src="${script}"></script>
</body>
</html>`;
  }

  private dispose(): void {
    DashboardPanel.current = undefined;
    while (this.disposables.length) {
      try {
        this.disposables.pop()?.dispose();
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
