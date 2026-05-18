import * as vscode from "vscode";
import * as path from "path";

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
  state: "uninitialized" | "initialized";
  onDidChangeState: vscode.Event<"uninitialized" | "initialized">;
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
  const api = exports.getAPI(1);
  // Wait for the git extension to finish scanning for repositories.
  if (api.state !== "initialized") {
    await new Promise<void>((resolve) => {
      const d = api.onDidChangeState((s) => {
        if (s === "initialized") {
          d.dispose();
          resolve();
        }
      });
      // Hard cap so we never hang.
      setTimeout(() => {
        d.dispose();
        resolve();
      }, 4000);
    });
  }
  return api;
}

export function pickRepository(
  api: GitAPI,
  ws: vscode.WorkspaceFolder,
): GitRepository | undefined {
  // 1. Direct match
  const direct = api.getRepository(ws.uri);
  if (direct) return direct;
  // 2. Same root
  const sameRoot = api.repositories.find(
    (r) => r.rootUri.fsPath === ws.uri.fsPath,
  );
  if (sameRoot) return sameRoot;
  // 3. Workspace is inside a repo (subfolder opened)
  const wsPath = ws.uri.fsPath + path.sep;
  const ancestor = api.repositories.find((r) =>
    wsPath.startsWith(r.rootUri.fsPath + path.sep),
  );
  if (ancestor) return ancestor;
  // 4. Repo is inside the workspace (monorepo with one repo)
  const child = api.repositories.find((r) =>
    (r.rootUri.fsPath + path.sep).startsWith(wsPath),
  );
  return child;
}

/**
 * Return ALL git repositories that belong to a workspace folder:
 *  - the workspace folder itself if it is a repo, OR
 *  - all repos nested inside the workspace folder, OR
 *  - the ancestor repo containing the workspace folder.
 *
 * This is what enables analyzing two sibling repos opened under one workspace folder.
 */
export function pickAllRepositories(
  api: GitAPI,
  ws: vscode.WorkspaceFolder,
): GitRepository[] {
  const wsPath = ws.uri.fsPath + path.sep;
  const exact = api.repositories.find(
    (r) => r.rootUri.fsPath === ws.uri.fsPath,
  );
  if (exact) return [exact];

  const nested = api.repositories.filter((r) =>
    (r.rootUri.fsPath + path.sep).startsWith(wsPath),
  );
  if (nested.length) return nested;

  const ancestor = api.repositories.find((r) =>
    wsPath.startsWith(r.rootUri.fsPath + path.sep),
  );
  return ancestor ? [ancestor] : [];
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
