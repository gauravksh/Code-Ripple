import * as vscode from "vscode";
import { VIEW_IMPACT, VIEW_PULSE } from "./constants";
import { ChangeStore } from "./core/changeStore";
import { Indexer } from "./core/indexer";
import { Agent } from "./agent/agent";
import { Logger } from "./services/logger";
import { LocalTelemetry } from "./services/telemetry";
import { PulseViewProvider } from "./ui/pulseView";
import { ImpactViewProvider } from "./ui/impactView";
import { StatusBar } from "./ui/statusBar";
import { registerCommands } from "./commands";
import { debounce } from "./util/debounce";
import { getGitAPI, pickRepository } from "./services/git";

export async function activate(ctx: vscode.ExtensionContext): Promise<void> {
  const log = new Logger();
  log.info("CodeRipple activating");

  const telemetry = new LocalTelemetry(ctx.globalState);
  const store = new ChangeStore();
  const indexer = new Indexer(log);
  const agent = new Agent(log, telemetry);

  let analyzing: Promise<void> | undefined;

  const runAnalyze = async () => {
    if (analyzing) return analyzing;
    analyzing = (async () => {
      const folder = vscode.workspace.workspaceFolders?.[0];
      if (!folder) {
        void vscode.window.showWarningMessage(
          "CodeRipple: open a folder/workspace first.",
        );
        return;
      }
      const cfg = vscode.workspace.getConfiguration("coderipple");
      const maxFiles = cfg.get<number>("maxFiles") ?? 200;
      const includeUntracked = cfg.get<boolean>("includeUntracked") ?? true;

      store.setAnalyzing(true);
      try {
        const cs = await indexer.build(folder, { maxFiles, includeUntracked });
        const intel = await agent.analyze(cs);
        store.set(intel);
        telemetry.bump("analyses");
        log.info(
          `Analyzed ${cs.files.length} file(s); source=${intel.source}; risk=${intel.risk}`,
        );
      } catch (e) {
        log.error("Analysis failed", e);
        telemetry.bump("errors");
        void vscode.window.showErrorMessage(
          "CodeRipple analysis failed. See output.",
        );
      } finally {
        store.setAnalyzing(false);
      }
    })().finally(() => {
      analyzing = undefined;
    });
    return analyzing;
  };

  // Views
  const pulse = new PulseViewProvider(store);
  const impact = new ImpactViewProvider(
    store,
    vscode.workspace.workspaceFolders?.[0]?.uri,
  );
  ctx.subscriptions.push(
    vscode.window.registerTreeDataProvider(VIEW_PULSE, pulse),
    vscode.window.registerTreeDataProvider(VIEW_IMPACT, impact),
  );

  // Status bar
  const status = new StatusBar(store);
  ctx.subscriptions.push(status);

  // Commands
  ctx.subscriptions.push(
    ...registerCommands({
      ctx,
      store,
      indexer,
      agent,
      log,
      telemetry,
      runAnalyze,
    }),
  );

  // Auto-analyze on git change + file save (debounced)
  const cfg = vscode.workspace.getConfiguration("coderipple");
  const debounceMs = cfg.get<number>("debounceMs") ?? 1500;
  const trigger = debounce(() => {
    const auto =
      vscode.workspace
        .getConfiguration("coderipple")
        .get<boolean>("autoAnalyze") ?? true;
    if (auto) void runAnalyze();
  }, debounceMs);

  ctx.subscriptions.push(
    vscode.workspace.onDidSaveTextDocument(() => trigger()),
    vscode.workspace.onDidChangeWorkspaceFolders(() => trigger()),
  );

  // Hook into git repo state changes when available.
  void (async () => {
    const api = await getGitAPI();
    if (!api) return;
    const ws = vscode.workspace.workspaceFolders?.[0];
    const repo = ws ? pickRepository(api, ws) : undefined;
    if (repo) {
      ctx.subscriptions.push(repo.state.onDidChange(() => trigger()));
    } else {
      ctx.subscriptions.push(api.onDidOpenRepository(() => trigger()));
    }
  })();

  // Kick off an initial analysis after activation settles.
  setTimeout(() => trigger(), 500);

  log.info("CodeRipple activated");
}

export function deactivate(): void {
  /* noop */
}
