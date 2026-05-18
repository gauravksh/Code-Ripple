import * as vscode from "vscode";
import { CMD } from "./constants";
import type { ChangeStore } from "./core/changeStore";
import type { Indexer } from "./core/indexer";
import type { Agent } from "./agent/agent";
import type { Logger } from "./services/logger";
import type { LocalTelemetry } from "./services/telemetry";
import { FlowPanel } from "./ui/flowPanel";
import { heuristicIntelligence } from "./agent/heuristics";

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
      // node.id is 'cluster:<id>' from the impact tree
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
  ];
}
