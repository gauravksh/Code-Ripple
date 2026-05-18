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
    this.item.command = "coderipple.openFlow";
    store.onChange(() => this.render());
    store.onStatus(() => this.render());
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
      this.item.tooltip = "No analysis yet. Click to open flow.";
      return;
    }
    this.item.text = `${icon(s)} ${s.changeSet.files.length} files • ${capitalize(s.risk)}`;
    this.item.tooltip = s.summary || "CodeRipple";
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
