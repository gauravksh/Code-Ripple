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
        retainContextWhenHidden: false,
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

    const unsub = this.store.onChange(() => this.render());
    this.disposables.push(
      this.panel.onDidDispose(() => this.dispose()),
      { dispose: unsub },
      this.panel.webview.onDidReceiveMessage((m) => this.onMessage(m)),
    );

    this.render();
  }

  private render(): void {
    const snap = this.store.current;
    if (!snap) {
      void this.panel.webview.postMessage({ type: "empty" });
      return;
    }
    void this.panel.webview.postMessage({
      type: "render",
      payload: this.serialize(snap),
    });
  }

  private serialize(s: ChangeIntelligence) {
    // Strip anything we don't need on the wire; keep prompt-injection surface minimal.
    return {
      summary: s.summary,
      risk: s.risk,
      clusters: s.clusters.map((c) => ({
        id: c.id,
        title: c.title,
        risk: c.risk,
        tags: c.tags,
      })),
      nodes: s.flow.nodes,
      edges: s.flow.edges,
    };
  }

  private async onMessage(m: any): Promise<void> {
    if (!m || typeof m.type !== "string") return;
    switch (m.type) {
      case "ready":
        this.render();
        return;
      case "reveal": {
        if (typeof m.id !== "string") return;
        const ws = vscode.workspace.workspaceFolders?.[0];
        if (!ws) return;
        const uri = vscode.Uri.joinPath(ws.uri, ...m.id.split("/"));
        try {
          await vscode.window.showTextDocument(uri, {
            preview: true,
            viewColumn: vscode.ViewColumn.One,
          });
        } catch (e) {
          this.log.warn("reveal failed", e);
        }
        return;
      }
      default:
        this.log.debug("Unhandled webview message", m.type);
    }
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
    <span id="title">CodeRipple — Flow</span>
    <span class="spacer"></span>
    <label>Risk: <select id="riskFilter">
      <option value="all">all</option>
      <option value="medium">≥ medium</option>
      <option value="high">≥ high</option>
    </select></label>
    <button id="fit">Fit</button>
  </header>
  <main id="canvas"><svg id="svg" xmlns="http://www.w3.org/2000/svg"></svg></main>
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
