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
import { getGitAPI, pickAllRepositories } from "./services/git";

export async function activate(ctx: vscode.ExtensionContext): Promise<void> {
  const log = new Logger();
  log.info("CodeRipple activating");

  const telemetry = new LocalTelemetry(ctx.globalState);
  const store = new ChangeStore();
  const indexer = new Indexer(log);
  const agent = new Agent(log, telemetry);

  const inflight = new Map<string, Promise<void>>();

  const analyzeRepoFor = async (
    folder: vscode.WorkspaceFolder,
    repoRoot: string,
  ): Promise<void> => {
    const key = repoRoot;
    const existing = inflight.get(key);
    if (existing) return existing;
    const cfg = vscode.workspace.getConfiguration("coderipple");
    const maxFiles = cfg.get<number>("maxFiles") ?? 200;
    const includeUntracked = cfg.get<boolean>("includeUntracked") ?? true;

    const p = (async () => {
      store.setAnalyzing(true);
      try {
        const api = await getGitAPI();
        const repo = api?.repositories.find(
          (r) => r.rootUri.fsPath === repoRoot,
        );
        const cs = await indexer.build(folder, {
          maxFiles,
          includeUntracked,
          repo,
        });
        const intel = await agent.analyze(cs);
        store.setFor(key, intel);
        telemetry.bump("analyses");
        log.info(
          `[${cs.workspaceName}] Analyzed ${cs.files.length} file(s); source=${intel.source}; risk=${intel.risk}`,
        );
      } catch (e) {
        log.error(`[${repoRoot}] Analysis failed`, e);
        telemetry.bump("errors");
      } finally {
        store.setAnalyzing(false);
      }
    })();
    inflight.set(key, p);
    void p.finally(() => inflight.delete(key));
    return p;
  };

  const runAnalyze = async (): Promise<void> => {
    const folders = vscode.workspace.workspaceFolders ?? [];
    if (folders.length === 0) {
      void vscode.window.showWarningMessage(
        "CodeRipple: open a folder/workspace first.",
      );
      return;
    }
    const api = await getGitAPI();
    const tasks: Promise<void>[] = [];
    const seenRepos = new Set<string>();
    for (const f of folders) {
      const repos = api ? pickAllRepositories(api, f) : [];
      if (repos.length === 0) {
        // No git repo for this folder — still analyze (will produce empty changeset).
        tasks.push(analyzeRepoFor(f, f.uri.fsPath));
        continue;
      }
      for (const r of repos) {
        if (seenRepos.has(r.rootUri.fsPath)) continue;
        seenRepos.add(r.rootUri.fsPath);
        tasks.push(analyzeRepoFor(f, r.rootUri.fsPath));
      }
    }
    await Promise.all(tasks);
  };

  // Views
  const pulse = new PulseViewProvider(store);
  const impact = new ImpactViewProvider(store);
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
    vscode.workspace.onDidChangeTextDocument((e) => {
      // Only ride live edits in real files (skip output/log/git/etc).
      if (e.document.uri.scheme !== "file") return;
      if (e.contentChanges.length === 0) return;
      trigger();
    }),
    vscode.window.onDidChangeActiveTextEditor((ed) => {
      // Switching to a file in another repo should refocus the active repo.
      if (!ed || ed.document.uri.scheme !== "file") return;
      const docPath = ed.document.uri.fsPath;
      let bestKey: string | undefined;
      let bestLen = -1;
      for (const { key } of store.list()) {
        if (
          (docPath === key || docPath.startsWith(key + "/")) &&
          key.length > bestLen
        ) {
          bestKey = key;
          bestLen = key.length;
        }
      }
      if (bestKey && bestKey !== store.activeWorkspaceKey) {
        store.setActive(bestKey);
      }
    }),
    vscode.workspace.onDidChangeWorkspaceFolders((e) => {
      // Remove snapshots for departed folders.
      for (const removed of e.removed)
        store.removeWorkspace(removed.uri.fsPath);
      trigger();
    }),
  );

  // Hook into git repo state changes when available.
  void (async () => {
    const api = await getGitAPI();
    if (!api) {
      log.warn("vscode.git extension not available.");
      return;
    }
    const wireFolder = (folder: vscode.WorkspaceFolder) => {
      const repos = pickAllRepositories(api, folder);
      for (const repo of repos) {
        log.info(`Wiring git repo: ${repo.rootUri.fsPath}`);
        ctx.subscriptions.push(repo.state.onDidChange(() => trigger()));
      }
    };
    for (const ws of vscode.workspace.workspaceFolders ?? []) wireFolder(ws);
    ctx.subscriptions.push(
      api.onDidOpenRepository((repo) => {
        log.info(`Repository opened: ${repo.rootUri.fsPath}`);
        ctx.subscriptions.push(repo.state.onDidChange(() => trigger()));
        trigger();
      }),
    );
    trigger();
  })();

  // Kick off an initial analysis after activation settles.
  setTimeout(() => trigger(), 1500);

  log.info("CodeRipple activated");
}

export function deactivate(): void {
  /* noop */
}
