import * as vscode from "vscode";
import type { ChangeStore } from "../core/changeStore";
import type { ChangeIntelligence, RiskLevel } from "../core/types";

/**
 * Workspace Pulse: a compact, glanceable cockpit rendered as a TreeView.
 * Non-expandable rows; the view itself is the dashboard.
 */
export class PulseViewProvider implements vscode.TreeDataProvider<PulseItem> {
  private _onDidChange = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this._onDidChange.event;

  constructor(private store: ChangeStore) {
    store.onChange(() => this._onDidChange.fire());
    store.onStatus(() => this._onDidChange.fire());
  }

  getTreeItem(el: PulseItem): vscode.TreeItem {
    return el;
  }

  getChildren(): PulseItem[] {
    const snap = this.store.current;
    if (this.store.isAnalyzing && !snap) {
      return [row("$(sync~spin) Analyzing changes...", "")];
    }
    if (!snap) {
      return [
        row("$(pulse) CodeRipple", "No analysis yet."),
        actionRow("Analyze now", "coderipple.analyze", "$(play)"),
      ];
    }
    return buildPulse(snap);
  }
}

function buildPulse(s: ChangeIntelligence): PulseItem[] {
  const cs = s.changeSet;
  const totalAdd = cs.files.reduce((n, f) => n + f.additions, 0);
  const totalDel = cs.files.reduce((n, f) => n + f.deletions, 0);
  const branch = cs.branch ? ` ▸ ${cs.branch}` : "";

  return [
    row(`$(repo) ${cs.workspaceName}${branch}`, s.partial ? "partial" : ""),
    row(
      `$(diff) Changes`,
      `${cs.files.length} files  +${totalAdd} / -${totalDel}`,
    ),
    row(`${riskIcon(s.risk)} Risk`, capitalize(s.risk)),
    row(`$(beaker) Tests`, capitalize(s.testStatus)),
    row(`$(comment-discussion) Summary`, s.summary || "—"),
    row(`$(info) Source`, `${s.source}${s.partial ? " (partial)" : ""}`),
    sep(),
    actionRow("Re-analyze", "coderipple.analyze", "$(sync)"),
    actionRow("Open Flow Diagram", "coderipple.openFlow", "$(graph)"),
  ];
}

function riskIcon(r: RiskLevel): string {
  switch (r) {
    case "critical":
      return "$(error)";
    case "high":
      return "$(warning)";
    case "medium":
      return "$(alert)";
    default:
      return "$(check)";
  }
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function row(label: string, desc: string): PulseItem {
  const item = new PulseItem(label, vscode.TreeItemCollapsibleState.None);
  item.description = desc;
  return item;
}

function actionRow(label: string, command: string, icon: string): PulseItem {
  const item = new PulseItem(
    `${icon} ${label}`,
    vscode.TreeItemCollapsibleState.None,
  );
  item.command = { command, title: label };
  item.contextValue = "action";
  return item;
}

function sep(): PulseItem {
  return new PulseItem(
    "────────────────",
    vscode.TreeItemCollapsibleState.None,
  );
}

class PulseItem extends vscode.TreeItem {}
