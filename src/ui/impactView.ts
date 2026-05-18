import * as vscode from "vscode";
import type { ChangeStore } from "../core/changeStore";
import type {
  ChangeIntelligence,
  ChangedFile,
  ChangedSymbol,
  ImpactCluster,
  RiskLevel,
} from "../core/types";

type Node = ClusterNode | FileNode | SymbolNode | InfoNode;

interface ClusterNode {
  kind: "cluster";
  cluster: ImpactCluster;
}
interface FileNode {
  kind: "file";
  file: ChangedFile;
  cluster: ImpactCluster;
}
interface SymbolNode {
  kind: "symbol";
  symbol: ChangedSymbol;
  file: ChangedFile;
}
interface InfoNode {
  kind: "info";
  label: string;
}

export class ImpactViewProvider implements vscode.TreeDataProvider<Node> {
  private _onDidChange = new vscode.EventEmitter<Node | void>();
  readonly onDidChangeTreeData = this._onDidChange.event;

  constructor(
    private store: ChangeStore,
    private workspaceRoot?: vscode.Uri,
  ) {
    store.onChange(() => this._onDidChange.fire());
  }

  refresh(): void {
    this._onDidChange.fire();
  }

  getTreeItem(n: Node): vscode.TreeItem {
    switch (n.kind) {
      case "cluster":
        return clusterItem(n.cluster);
      case "file":
        return fileItem(n.file, this.workspaceRoot);
      case "symbol":
        return symbolItem(n.symbol, n.file, this.workspaceRoot);
      case "info":
        return new vscode.TreeItem(n.label);
    }
  }

  getChildren(parent?: Node): Node[] {
    const snap = this.store.current;
    if (!snap)
      return [
        {
          kind: "info",
          label: 'Run "CodeRipple: Analyze Changes" to populate.',
        },
      ];

    if (!parent) {
      if (snap.clusters.length === 0)
        return [{ kind: "info", label: "No changes detected." }];
      return snap.clusters.map<Node>((c) => ({ kind: "cluster", cluster: c }));
    }
    if (parent.kind === "cluster") {
      const byId = new Map(snap.changeSet.files.map((f) => [f.id, f] as const));
      return parent.cluster.fileIds
        .map((id) => byId.get(id))
        .filter((f): f is ChangedFile => !!f)
        .map<Node>((file) => ({ kind: "file", file, cluster: parent.cluster }));
    }
    if (parent.kind === "file") {
      return parent.file.symbols.map<Node>((symbol) => ({
        kind: "symbol",
        symbol,
        file: parent.file,
      }));
    }
    return [];
  }
}

function clusterItem(c: ImpactCluster): vscode.TreeItem {
  const it = new vscode.TreeItem(
    c.title,
    vscode.TreeItemCollapsibleState.Expanded,
  );
  it.description = `${riskBadge(c.risk)} • ${c.fileIds.length} file(s)`;
  it.iconPath = new vscode.ThemeIcon(riskThemeIcon(c.risk));
  it.tooltip = c.rationale + (c.tags.length ? `\n[${c.tags.join(", ")}]` : "");
  it.contextValue = "cluster";
  it.id = `cluster:${c.id}`;
  return it;
}

function fileItem(f: ChangedFile, root?: vscode.Uri): vscode.TreeItem {
  const it = new vscode.TreeItem(
    f.path.split("/").pop() ?? f.path,
    f.symbols.length
      ? vscode.TreeItemCollapsibleState.Collapsed
      : vscode.TreeItemCollapsibleState.None,
  );
  it.description = `${f.kind}  +${f.additions}/-${f.deletions}`;
  it.resourceUri = root
    ? vscode.Uri.joinPath(root, ...f.path.split("/"))
    : undefined;
  it.iconPath = vscode.ThemeIcon.File;
  it.tooltip = f.path;
  it.contextValue = "file";
  if (it.resourceUri) {
    it.command = {
      command: "vscode.open",
      title: "Open",
      arguments: [it.resourceUri],
    };
  }
  return it;
}

function symbolItem(
  s: ChangedSymbol,
  f: ChangedFile,
  root?: vscode.Uri,
): vscode.TreeItem {
  const it = new vscode.TreeItem(
    `${s.name}`,
    vscode.TreeItemCollapsibleState.None,
  );
  it.description = s.kind;
  it.iconPath = new vscode.ThemeIcon(symbolIcon(s.kind));
  if (root) {
    const uri = vscode.Uri.joinPath(root, ...f.path.split("/"));
    const pos = new vscode.Position(Math.max(0, s.startLine - 1), 0);
    it.command = {
      command: "vscode.open",
      title: "Reveal",
      arguments: [uri, { selection: new vscode.Range(pos, pos) }],
    };
  }
  return it;
}

function riskThemeIcon(r: RiskLevel): string {
  return r === "critical"
    ? "error"
    : r === "high"
      ? "warning"
      : r === "medium"
        ? "alert"
        : "check";
}

function riskBadge(r: RiskLevel): string {
  return r.toUpperCase();
}

function symbolIcon(kind: string): string {
  switch (kind) {
    case "function":
    case "method":
      return "symbol-method";
    case "class":
      return "symbol-class";
    case "interface":
      return "symbol-interface";
    case "variable":
    case "constant":
      return "symbol-variable";
    case "enum":
      return "symbol-enum";
    default:
      return "symbol-misc";
  }
}
