import * as vscode from "vscode";
import type { ChangeStore } from "../core/changeStore";
import type { ChangeIntelligence } from "../core/types";

export class StatusBar implements vscode.Disposable {
  private item: vscode.StatusBarItem;

  constructor(private store: ChangeStore) {
    this.item = vscode.window.createStatusBarItem(
      vscode.StatusBarAlignment.Left,
      50,
    );
    this.item.command = "coderipple.openDashboard";
    store.onChange(() => this.render());
    store.onStatus(() => this.render());
    store.onActive(() => this.render());
    this.render();
    this.item.show();
  }

  private render(): void {
    if (this.store.isAnalyzing) {
      this.item.text = "$(sync~spin) CodeRipple";
      this.item.tooltip = "Analyzing changes...";
      return;
    }
    const s = this.store.current;
    if (!s) {
      this.item.text = "$(pulse) CodeRipple";
      this.item.tooltip = "No analysis yet. Click to open the dashboard.";
      return;
    }
    const count = this.store.list().length;
    const repoTag = count > 1 ? ` · ${s.changeSet.workspaceName}` : "";
    this.item.text = `${icon(s)} ${s.changeSet.files.length} files • ${capitalize(s.risk)}${repoTag}`;
    this.item.tooltip =
      (count > 1
        ? `Active repo: ${s.changeSet.workspaceName} (${count} repos). Click to open the dashboard.\n`
        : "Click to open the dashboard.\n") + (s.summary || "CodeRipple");
  }

  dispose(): void {
    this.item.dispose();
  }
}

function icon(s: ChangeIntelligence): string {
  switch (s.risk) {
    case "critical":
      return "$(error)";
    case "high":
      return "$(warning)";
    case "medium":
      return "$(alert)";
    default:
      return "$(pulse)";
  }
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
