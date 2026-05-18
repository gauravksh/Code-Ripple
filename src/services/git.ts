import * as vscode from "vscode";

/**
 * Minimal typing of the VS Code git extension API we actually use.
 * See: https://github.com/microsoft/vscode/blob/main/extensions/git/src/api/git.d.ts
 */
export interface GitChange {
  uri: vscode.Uri;
  originalUri: vscode.Uri;
  renameUri?: vscode.Uri;
  status: number;
}

export interface GitRepository {
  rootUri: vscode.Uri;
  state: {
    HEAD?: { name?: string; commit?: string };
    workingTreeChanges: GitChange[];
    indexChanges: GitChange[];
    untrackedChanges?: GitChange[];
    onDidChange: vscode.Event<void>;
  };
  diffWithHEAD(path: string): Promise<string>;
}

export interface GitAPI {
  repositories: GitRepository[];
  onDidOpenRepository: vscode.Event<GitRepository>;
  getRepository(uri: vscode.Uri): GitRepository | null;
}

export async function getGitAPI(): Promise<GitAPI | undefined> {
  const ext = vscode.extensions.getExtension<{ getAPI(v: number): GitAPI }>(
    "vscode.git",
  );
  if (!ext) return undefined;
  const exports = ext.isActive ? ext.exports : await ext.activate();
  return exports.getAPI(1);
}

export function pickRepository(
  api: GitAPI,
  ws: vscode.WorkspaceFolder,
): GitRepository | undefined {
  return (
    api.getRepository(ws.uri) ??
    api.repositories.find((r) => r.rootUri.fsPath === ws.uri.fsPath)
  );
}

/** Map VS Code Git status codes to our ChangeKind. */
export function mapStatus(
  status: number,
  renamed: boolean,
): "added" | "modified" | "deleted" | "renamed" {
  // Numeric values follow vscode.git Status enum.
  // 0 INDEX_MODIFIED, 1 INDEX_ADDED, 2 INDEX_DELETED, 3 INDEX_RENAMED, 5 MODIFIED, 6 DELETED, 7 UNTRACKED, 8 IGNORED, ...
  if (renamed) return "renamed";
  switch (status) {
    case 1:
    case 7:
      return "added";
    case 2:
    case 6:
      return "deleted";
    case 3:
      return "renamed";
    default:
      return "modified";
  }
}
