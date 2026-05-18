import * as vscode from "vscode";
import type { ChangeStore } from "../core/changeStore";
import type {
  ChangeIntelligence,
  ChangedFile,
  ChangedSymbol,
  ImpactCluster,
  ReferenceLocation,
  RiskLevel,
} from "../core/types";

type Node =
  | WorkspaceNode
  | ClusterNode
  | FileNode
  | FileRefsRootNode
  | SymbolNode
  | SymbolRefsRootNode
  | RefNode
  | InfoNode;

interface WorkspaceNode {
  kind: "workspace";
  wsKey: string;
  snapshot: ChangeIntelligence;
}
interface ClusterNode {
  kind: "cluster";
  cluster: ImpactCluster;
  snapshot: ChangeIntelligence;
}
interface FileNode {
  kind: "file";
  file: ChangedFile;
  cluster: ImpactCluster;
  snapshot: ChangeIntelligence;
}
interface FileRefsRootNode {
  kind: "fileRefsRoot";
  file: ChangedFile;
  snapshot: ChangeIntelligence;
}
interface SymbolNode {
  kind: "symbol";
  symbol: ChangedSymbol;
  file: ChangedFile;
  snapshot: ChangeIntelligence;
}
interface SymbolRefsRootNode {
  kind: "symbolRefsRoot";
  symbol: ChangedSymbol;
  snapshot: ChangeIntelligence;
}
interface RefNode {
  kind: "ref";
  ref: ReferenceLocation;
  snapshot: ChangeIntelligence;
}
interface InfoNode {
  kind: "info";
  label: string;
}

export class ImpactViewProvider implements vscode.TreeDataProvider<Node> {
  private _onDidChange = new vscode.EventEmitter<Node | void>();
  readonly onDidChangeTreeData = this._onDidChange.event;

  constructor(private store: ChangeStore) {
    store.onChange(() => this._onDidChange.fire());
    store.onActive(() => this._onDidChange.fire());
  }

  refresh(): void {
    this._onDidChange.fire();
  }

  getTreeItem(n: Node): vscode.TreeItem {
    switch (n.kind) {
      case "workspace":
        return workspaceItem(n.snapshot);
      case "cluster":
        return clusterItem(n.cluster);
      case "file":
        return fileItem(n.file, rootUri(n.snapshot));
      case "fileRefsRoot":
        return refsRootItem(
          `Referenced in ${n.file.references?.length ?? 0} place(s)`,
          (n.file.references?.length ?? 0) > 0,
        );
      case "symbol":
        return symbolItem(n.symbol, n.file, rootUri(n.snapshot));
      case "symbolRefsRoot":
        return refsRootItem(
          `Used in ${n.symbol.references?.length ?? 0} place(s)`,
          (n.symbol.references?.length ?? 0) > 0,
        );
      case "ref":
        return refItem(n.ref, rootUri(n.snapshot));
      case "info":
        return new vscode.TreeItem(n.label);
    }
  }

  getChildren(parent?: Node): Node[] {
    const all = this.store.list();
    if (all.length === 0)
      return [
        {
          kind: "info",
          label: 'Run "CodeRipple: Analyze Changes" to populate.',
        },
      ];

    if (!parent) {
      if (all.length === 1) return clustersOf(all[0].snapshot);
      return all.map<Node>(({ key, snapshot }) => ({
        kind: "workspace",
        wsKey: key,
        snapshot,
      }));
    }

    if (parent.kind === "workspace") return clustersOf(parent.snapshot);

    if (parent.kind === "cluster") {
      const snap = parent.snapshot;
      const byId = new Map(snap.changeSet.files.map((f) => [f.id, f] as const));
      return parent.cluster.fileIds
        .map((id) => byId.get(id))
        .filter((f): f is ChangedFile => !!f)
        .map<Node>((file) => ({
          kind: "file",
          file,
          cluster: parent.cluster,
          snapshot: snap,
        }));
    }

    if (parent.kind === "file") {
      const out: Node[] = parent.file.symbols.map<Node>((symbol) => ({
        kind: "symbol",
        symbol,
        file: parent.file,
        snapshot: parent.snapshot,
      }));
      if ((parent.file.references?.length ?? 0) > 0) {
        out.push({
          kind: "fileRefsRoot",
          file: parent.file,
          snapshot: parent.snapshot,
        });
      }
      return out;
    }

    if (parent.kind === "fileRefsRoot") {
      return (parent.file.references ?? []).map<Node>((ref) => ({
        kind: "ref",
        ref,
        snapshot: parent.snapshot,
      }));
    }

    if (parent.kind === "symbol") {
      const out: Node[] = [];
      if ((parent.symbol.references?.length ?? 0) > 0) {
        out.push({
          kind: "symbolRefsRoot",
          symbol: parent.symbol,
          snapshot: parent.snapshot,
        });
      }
      return out;
    }

    if (parent.kind === "symbolRefsRoot") {
      return (parent.symbol.references ?? []).map<Node>((ref) => ({
        kind: "ref",
        ref,
        snapshot: parent.snapshot,
      }));
    }

    return [];
  }
}

function clustersOf(snap: ChangeIntelligence): Node[] {
  if (snap.clusters.length === 0)
    return [{ kind: "info", label: "No changes detected." }];
  return snap.clusters.map<Node>((c) => ({
    kind: "cluster",
    cluster: c,
    snapshot: snap,
  }));
}

function rootUri(s: ChangeIntelligence): vscode.Uri | undefined {
  const r = s.changeSet.workspaceRoot;
  return r ? vscode.Uri.file(r) : undefined;
}

function workspaceItem(s: ChangeIntelligence): vscode.TreeItem {
  const cs = s.changeSet;
  const it = new vscode.TreeItem(
    `${cs.workspaceName}${cs.branch ? "  ▸ " + cs.branch : ""}`,
    vscode.TreeItemCollapsibleState.Expanded,
  );
  it.description = `${riskBadge(s.risk)} • ${cs.files.length} file(s)`;
  it.iconPath = new vscode.ThemeIcon("repo");
  it.contextValue = "workspace";
  return it;
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
  const hasChildren = f.symbols.length > 0 || (f.references?.length ?? 0) > 0;
  const it = new vscode.TreeItem(
    f.path.split("/").pop() ?? f.path,
    hasChildren
      ? vscode.TreeItemCollapsibleState.Collapsed
      : vscode.TreeItemCollapsibleState.None,
  );
  const refCount = f.references?.length ?? 0;
  it.description = `${f.kind}  +${f.additions}/-${f.deletions}${
    refCount ? `  ⇢ ${refCount} ref(s)` : ""
  }`;
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

function refsRootItem(label: string, expand: boolean): vscode.TreeItem {
  const it = new vscode.TreeItem(
    label,
    expand
      ? vscode.TreeItemCollapsibleState.Collapsed
      : vscode.TreeItemCollapsibleState.None,
  );
  it.iconPath = new vscode.ThemeIcon("references");
  it.contextValue = "refsRoot";
  return it;
}

function refItem(r: ReferenceLocation, root?: vscode.Uri): vscode.TreeItem {
  const name = r.path.split("/").pop() ?? r.path;
  const it = new vscode.TreeItem(
    `${name}:${r.line}`,
    vscode.TreeItemCollapsibleState.None,
  );
  it.description = r.preview || r.path;
  it.tooltip = `${r.path}:${r.line}${r.symbol ? `\n→ ${r.symbol}` : ""}${
    r.external ? "\n(external)" : ""
  }${r.preview ? `\n\n${r.preview}` : ""}`;
  it.iconPath = new vscode.ThemeIcon(
    r.external ? "link-external" : "arrow-small-right",
  );
  if (root) {
    const uri = vscode.Uri.joinPath(root, ...r.path.split("/"));
    const pos = new vscode.Position(
      Math.max(0, r.line - 1),
      Math.max(0, (r.column ?? 1) - 1),
    );
    it.command = {
      command: "vscode.open",
      title: "Reveal Reference",
      arguments: [uri, { selection: new vscode.Range(pos, pos) }],
    };
  }
  return it;
}

function symbolItem(
  s: ChangedSymbol,
  f: ChangedFile,
  root?: vscode.Uri,
): vscode.TreeItem {
  const hasRefs = (s.references?.length ?? 0) > 0;
  const it = new vscode.TreeItem(
    `${s.name}`,
    hasRefs
      ? vscode.TreeItemCollapsibleState.Collapsed
      : vscode.TreeItemCollapsibleState.None,
  );
  it.description = `${s.kind}${hasRefs ? `  ⇢ ${s.references!.length}` : ""}`;
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
