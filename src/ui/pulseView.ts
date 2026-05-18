import * as vscode from "vscode";
import type { ChangeStore } from "../core/changeStore";
import type { ChangeIntelligence, ChangedFile, RiskLevel } from "../core/types";
import { computeMergeReadiness } from "../core/mergeReadiness";
import { rankFocus } from "../core/focus";

/**
 * Workspace Pulse — the always-visible developer cockpit.
 *
 * Compact, glanceable, codicon-rendered. Designed for daily use rather
 * than occasional inspection. For richer detail, see DashboardPanel.
 */
export class PulseViewProvider implements vscode.TreeDataProvider<PulseItem> {
  private _onDidChange = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this._onDidChange.event;

  constructor(private store: ChangeStore) {
    store.onChange(() => this._onDidChange.fire());
    store.onStatus(() => this._onDidChange.fire());
    store.onActive(() => this._onDidChange.fire());
  }

  getTreeItem(el: PulseItem): vscode.TreeItem {
    return el;
  }

  getChildren(parent?: PulseItem): PulseItem[] {
    const all = this.store.list();
    if (this.store.isAnalyzing && all.length === 0) {
      return [iconRow("sync~spin", "Analyzing changes…", "")];
    }
    if (all.length === 0) {
      return [
        iconRow("pulse", "CodeRipple", "No analysis yet."),
        actionRow("Open Dashboard", "coderipple.openDashboard", "dashboard"),
        actionRow("Analyze now", "coderipple.analyze", "play"),
      ];
    }
    if (
      parent?.contextValue === "section" &&
      parent.sectionId &&
      parent.wsKey
    ) {
      const snap = this.store.get(parent.wsKey);
      if (!snap) return [];
      return expandSection(parent.sectionId, snap, parent.wsKey);
    }
    if (parent?.contextValue === "workspace" && parent.wsKey) {
      const snap = this.store.get(parent.wsKey);
      return snap ? buildCockpit(snap, parent.wsKey) : [];
    }
    if (!parent) {
      if (all.length === 1) {
        return buildCockpit(all[0].snapshot, all[0].key);
      }
      const activeKey = this.store.activeWorkspaceKey;
      const header: PulseItem[] = [
        actionRow("Switch active repo…", "coderipple.switchRepo", "arrow-swap"),
      ];
      const rows = all.map(({ key, snapshot }) => {
        const cs = snapshot.changeSet;
        const isActive = key === activeKey;
        const item = new PulseItem(
          `${cs.workspaceName}${cs.branch ? "  ▸ " + cs.branch : ""}`,
          vscode.TreeItemCollapsibleState.Expanded,
        );
        item.iconPath = new vscode.ThemeIcon(
          isActive ? "check" : "repo",
          isActive ? new vscode.ThemeColor("charts.green") : undefined,
        );
        item.description = `${isActive ? "active · " : ""}${snapshot.risk.toUpperCase()} · ${cs.files.length} file(s)`;
        item.contextValue = "workspace";
        item.wsKey = key;
        item.command = {
          command: "coderipple.setActiveRepo",
          title: "Focus repo",
          arguments: [{ wsKey: key }],
        };
        return item;
      });
      return [...header, ...rows];
    }
    return [];
  }
}

function buildCockpit(s: ChangeIntelligence, wsKey: string): PulseItem[] {
  const cs = s.changeSet;
  const merge = computeMergeReadiness(s);
  const focus = rankFocus(s).slice(0, 3);
  const intentLabel = s.intent?.label ?? "Mixed changes";
  const intentConf = s.intent
    ? `${Math.round((s.intent.confidence ?? 0) * 100)}%`
    : "";
  const trustText = s.trust ? `${s.trust.score}/100 · ${s.trust.verdict}` : "—";
  const totalAdd = cs.files.reduce((n, f) => n + f.additions, 0);
  const totalDel = cs.files.reduce((n, f) => n + f.deletions, 0);

  const out: PulseItem[] = [];

  const header = new PulseItem(
    cs.workspaceName,
    vscode.TreeItemCollapsibleState.None,
  );
  header.iconPath = new vscode.ThemeIcon("repo");
  header.description = cs.branch ?? "no branch";
  out.push(header);

  const mr = new PulseItem(
    merge.ready ? "Ready to merge" : "Not ready to merge",
    merge.blockers.length > 0 || merge.cautions.length > 0
      ? vscode.TreeItemCollapsibleState.Expanded
      : vscode.TreeItemCollapsibleState.None,
  );
  mr.iconPath = new vscode.ThemeIcon(
    merge.ready ? "pass-filled" : "warning",
    new vscode.ThemeColor(merge.ready ? "charts.green" : "charts.yellow"),
  );
  mr.description = `${merge.confidence}% confidence`;
  mr.contextValue = "section";
  mr.sectionId = "merge";
  mr.wsKey = wsKey;
  out.push(mr);

  const intent = new PulseItem(
    intentLabel,
    vscode.TreeItemCollapsibleState.None,
  );
  intent.iconPath = new vscode.ThemeIcon("lightbulb");
  intent.description = intentConf ? `intent · ${intentConf}` : "intent";
  intent.tooltip = s.intent?.rationale ?? s.summary ?? "";
  out.push(intent);

  const risk = new PulseItem(
    `Risk: ${capitalize(s.risk)}`,
    vscode.TreeItemCollapsibleState.None,
  );
  risk.iconPath = riskThemeIcon(s.risk);
  risk.description = s.blastRadius
    ? `blast · ${s.blastRadius.files.length} files`
    : "";
  out.push(risk);

  const trust = new PulseItem(
    `Trust: ${trustText}`,
    vscode.TreeItemCollapsibleState.None,
  );
  trust.iconPath = new vscode.ThemeIcon("shield");
  out.push(trust);

  if (focus.length > 0) {
    const focusRoot = new PulseItem(
      "Focus first",
      vscode.TreeItemCollapsibleState.Expanded,
    );
    focusRoot.iconPath = new vscode.ThemeIcon("target");
    focusRoot.description = `${focus.length} item(s)`;
    focusRoot.contextValue = "section";
    focusRoot.sectionId = "focus";
    focusRoot.wsKey = wsKey;
    out.push(focusRoot);
  }

  const warnings = collectWarnings(s);
  if (warnings.length > 0) {
    const w = new PulseItem(
      `Warnings (${warnings.length})`,
      vscode.TreeItemCollapsibleState.Collapsed,
    );
    w.iconPath = new vscode.ThemeIcon(
      "warning",
      new vscode.ThemeColor("charts.yellow"),
    );
    w.contextValue = "section";
    w.sectionId = "warnings";
    w.wsKey = wsKey;
    out.push(w);
  }

  const stats = new PulseItem(
    `${cs.files.length} files`,
    vscode.TreeItemCollapsibleState.None,
  );
  stats.iconPath = new vscode.ThemeIcon("diff");
  stats.description = `+${totalAdd} / -${totalDel}`;
  out.push(stats);

  out.push(
    actionRow("Open Dashboard", "coderipple.openDashboard", "dashboard"),
    actionRow("Open Flow Diagram", "coderipple.openFlow", "graph"),
    actionRow("Ask about changes", "coderipple.ask", "comment-discussion"),
    actionRow("Re-analyze", "coderipple.analyze", "sync"),
  );

  return out;
}

function expandSection(
  id: string,
  s: ChangeIntelligence,
  wsKey: string,
): PulseItem[] {
  switch (id) {
    case "merge": {
      const m = computeMergeReadiness(s);
      const out: PulseItem[] = [];
      for (const b of m.blockers) {
        const row = new PulseItem(
          b.label,
          vscode.TreeItemCollapsibleState.None,
        );
        row.iconPath = new vscode.ThemeIcon(
          "error",
          new vscode.ThemeColor("charts.red"),
        );
        row.description = b.detail ?? "";
        out.push(row);
      }
      for (const c of m.cautions) {
        const row = new PulseItem(
          c.label,
          vscode.TreeItemCollapsibleState.None,
        );
        row.iconPath = new vscode.ThemeIcon(
          "alert",
          new vscode.ThemeColor("charts.yellow"),
        );
        row.description = c.detail ?? "";
        out.push(row);
      }
      if (out.length === 0) {
        const row = new PulseItem(
          "No blockers",
          vscode.TreeItemCollapsibleState.None,
        );
        row.iconPath = new vscode.ThemeIcon(
          "pass",
          new vscode.ThemeColor("charts.green"),
        );
        out.push(row);
      }
      return out;
    }
    case "focus":
      return rankFocus(s)
        .slice(0, 6)
        .map((f) => focusItem(f, wsKey));
    case "warnings":
      return collectWarnings(s).map((w) => {
        const row = new PulseItem(
          w.label,
          vscode.TreeItemCollapsibleState.None,
        );
        row.iconPath = new vscode.ThemeIcon(
          "warning",
          new vscode.ThemeColor("charts.yellow"),
        );
        row.description = w.detail ?? "";
        return row;
      });
  }
  return [];
}

function focusItem(
  entry: { file: ChangedFile; reason: string; score: number },
  wsKey: string,
): PulseItem {
  const it = new PulseItem(
    entry.file.path.split("/").pop() ?? entry.file.path,
    vscode.TreeItemCollapsibleState.None,
  );
  it.iconPath = riskThemeIcon(entry.file.risk ?? "low");
  it.description = entry.reason;
  it.tooltip = `${entry.file.path}\n${entry.file.purpose ?? ""}`;
  it.resourceUri = vscode.Uri.joinPath(
    vscode.Uri.file(wsKey),
    ...entry.file.path.split("/"),
  );
  it.command = {
    command: "vscode.open",
    title: "Open",
    arguments: [it.resourceUri],
  };
  return it;
}

interface Warning {
  label: string;
  detail?: string;
}

function collectWarnings(s: ChangeIntelligence): Warning[] {
  const out: Warning[] = [];
  if (s.changeSet.truncated) {
    out.push({
      label: "Changeset truncated",
      detail: "Some files were skipped — analysis is partial.",
    });
  }
  const tests = s.tests;
  if (
    tests &&
    tests.missingCoverage.length > 0 &&
    (s.risk === "high" || s.risk === "critical")
  ) {
    out.push({
      label: "Missing tests on risky files",
      detail: `${tests.missingCoverage.length} file(s) without tests`,
    });
  }
  if (s.blastRadius && s.blastRadius.severity === "high") {
    out.push({
      label: "High blast radius",
      detail: `${s.blastRadius.files.length} external file(s) reference changes`,
    });
  }
  if (s.trust && s.trust.verdict === "low") {
    out.push({
      label: "Low trust verdict",
      detail: `${s.trust.score}/100`,
    });
  }
  return out;
}

function riskThemeIcon(r: RiskLevel): vscode.ThemeIcon {
  switch (r) {
    case "critical":
      return new vscode.ThemeIcon("error", new vscode.ThemeColor("charts.red"));
    case "high":
      return new vscode.ThemeIcon(
        "warning",
        new vscode.ThemeColor("charts.red"),
      );
    case "medium":
      return new vscode.ThemeIcon(
        "alert",
        new vscode.ThemeColor("charts.yellow"),
      );
    default:
      return new vscode.ThemeIcon(
        "pass",
        new vscode.ThemeColor("charts.green"),
      );
  }
}

function capitalize(s: string): string {
  if (!s) return "—";
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function iconRow(icon: string, label: string, desc: string): PulseItem {
  const it = new PulseItem(label, vscode.TreeItemCollapsibleState.None);
  it.iconPath = new vscode.ThemeIcon(icon);
  it.description = desc;
  return it;
}

function actionRow(label: string, command: string, icon: string): PulseItem {
  const it = new PulseItem(label, vscode.TreeItemCollapsibleState.None);
  it.iconPath = new vscode.ThemeIcon(icon);
  it.command = { command, title: label };
  it.contextValue = "action";
  return it;
}

class PulseItem extends vscode.TreeItem {
  wsKey?: string;
  sectionId?: string;
}
