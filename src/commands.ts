import * as vscode from "vscode";
import { CMD } from "./constants";
import type { ChangeStore } from "./core/changeStore";
import type { Indexer } from "./core/indexer";
import type { Agent } from "./agent/agent";
import type { Logger } from "./services/logger";
import type { LocalTelemetry } from "./services/telemetry";
import { FlowPanel } from "./ui/flowPanel";
import { DashboardPanel } from "./ui/dashboardPanel";
import { heuristicIntelligence } from "./agent/heuristics";
import { answerQuestion } from "./agent/qna";

export interface CommandDeps {
  ctx: vscode.ExtensionContext;
  store: ChangeStore;
  indexer: Indexer;
  agent: Agent;
  log: Logger;
  telemetry: LocalTelemetry;
  runAnalyze: () => Promise<void>;
}

export function registerCommands(d: CommandDeps): vscode.Disposable[] {
  return [
    vscode.commands.registerCommand(CMD.analyze, () => d.runAnalyze()),

    vscode.commands.registerCommand(CMD.refresh, () => {
      d.store.set(
        d.store.current ??
          heuristicIntelligence({
            workspaceName:
              vscode.workspace.workspaceFolders?.[0]?.name ?? "workspace",
            workspaceRoot: vscode.workspace.workspaceFolders?.[0]?.uri.fsPath,
            files: [],
            edges: [],
            generatedAt: Date.now(),
            truncated: false,
          }),
      );
    }),

    vscode.commands.registerCommand(CMD.openFlow, () => {
      FlowPanel.show(d.ctx, d.store, d.log);
    }),

    vscode.commands.registerCommand(CMD.openDashboard, () => {
      DashboardPanel.show(d.ctx, d.store, d.log);
    }),

    vscode.commands.registerCommand(CMD.toggleAuto, async () => {
      const cfg = vscode.workspace.getConfiguration("coderipple");
      const cur = cfg.get<boolean>("autoAnalyze") ?? true;
      await cfg.update(
        "autoAnalyze",
        !cur,
        vscode.ConfigurationTarget.Workspace,
      );
      void vscode.window.showInformationMessage(
        `CodeRipple auto-analyze: ${!cur ? "on" : "off"}`,
      );
    }),

    vscode.commands.registerCommand(CMD.clearCache, () => {
      d.store.clear();
      void vscode.window.showInformationMessage("CodeRipple cache cleared.");
    }),

    vscode.commands.registerCommand(CMD.showMetrics, () => {
      const m = d.telemetry.get();
      d.log.show();
      d.log.info("Local metrics", m);
    }),

    vscode.commands.registerCommand(CMD.explainCluster, async (node?: any) => {
      const snap = d.store.current;
      if (!snap) {
        void vscode.window.showInformationMessage("No snapshot yet.");
        return;
      }
      const id =
        typeof node?.id === "string"
          ? node.id.replace(/^cluster:/, "")
          : undefined;
      const cluster =
        snap.clusters.find((c) => c.id === id) ?? snap.clusters[0];
      if (!cluster) return;
      void vscode.window.showInformationMessage(
        `${cluster.title}: ${cluster.rationale}`,
      );
    }),

    vscode.commands.registerCommand(CMD.ask, async () => {
      const snaps = d.store.list().map(({ snapshot }) => snapshot);
      if (snaps.length === 0) {
        void vscode.window.showInformationMessage(
          "CodeRipple: nothing analyzed yet. Run analyze first.",
        );
        return;
      }
      const q = await vscode.window.showInputBox({
        prompt: "Ask CodeRipple about your pending changes",
        placeHolder:
          "e.g. What is the blast radius of this change? Is it safe to merge?",
        ignoreFocusOut: true,
      });
      if (!q) return;
      const out = vscode.window.createOutputChannel("CodeRipple Q&A");
      out.show(true);
      out.appendLine(`Q: ${q}`);
      out.appendLine("");
      try {
        const res = await answerQuestion(q, snaps, d.log);
        out.appendLine(res.answer);
        if (res.sources.length) {
          out.appendLine("");
          out.appendLine(
            `Grounded in ${res.sources.length} file(s)${res.usedLLM ? "" : " (heuristic mode)"}.`,
          );
        }
      } catch (e) {
        out.appendLine(`Failed: ${String(e)}`);
      }
    }),

    vscode.commands.registerCommand(
      CMD.setActiveRepo,
      (arg?: { wsKey?: string } | string) => {
        const key =
          typeof arg === "string" ? arg : (arg && arg.wsKey) || undefined;
        if (!key) return;
        d.store.setActive(key);
      },
    ),

    vscode.commands.registerCommand(CMD.switchRepo, async () => {
      const all = d.store.list();
      if (all.length === 0) {
        void vscode.window.showInformationMessage(
          "CodeRipple: nothing analyzed yet.",
        );
        return;
      }
      const activeKey = d.store.activeWorkspaceKey;
      const picks = all.map(({ key, snapshot }) => {
        const cs = snapshot.changeSet;
        return {
          label:
            (key === activeKey ? "$(check) " : "$(repo) ") + cs.workspaceName,
          description: cs.branch ? `⎇ ${cs.branch}` : "",
          detail: `${cs.files.length} file(s) • risk ${snapshot.risk} • ${cs.workspaceRoot ?? ""}`,
          key,
        };
      });
      const pick = await vscode.window.showQuickPick(picks, {
        title: "CodeRipple: switch active repository",
        placeHolder: "Pick the repo to focus in Pulse / Flow / Dashboard",
        matchOnDescription: true,
        matchOnDetail: true,
      });
      if (!pick) return;
      d.store.setActive(pick.key);
    }),
  ];
}
