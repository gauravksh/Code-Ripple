import * as vscode from "vscode";
import type {
  ChangeSet,
  ChangedFile,
  ChangedSymbol,
  ReferenceEdge,
  ChangeKind,
} from "./types";
import {
  getGitAPI,
  mapStatus,
  pickRepository,
  type GitChange,
  type GitRepository,
} from "../services/git";
import { countAddDel, parseHunks, rangesIntersect } from "./diff";
import { fnv1a } from "../util/hash";
import { isTestPath, toRelativePosix } from "../util/paths";
import type { Logger } from "../services/logger";

const SYMBOL_CONCURRENCY = 4;
const REF_CONCURRENCY = 2;

export class Indexer {
  constructor(private log: Logger) {}

  async build(
    folder: vscode.WorkspaceFolder,
    opts: { maxFiles: number; includeUntracked: boolean },
  ): Promise<ChangeSet> {
    const api = await getGitAPI();
    const repo = api ? pickRepository(api, folder) : undefined;

    let files: ChangedFile[] = [];
    let truncated = false;
    let branch: string | undefined;
    let head: string | undefined;

    if (repo) {
      branch = repo.state.HEAD?.name;
      head = repo.state.HEAD?.commit;
      const collected = await this.collectFromGit(repo, folder, opts);
      files = collected.files;
      truncated = collected.truncated;
    } else {
      this.log.warn("No git repository found; CodeRipple v0.1 requires git.");
    }

    const edges = await this.collectEdges(files, folder);

    return {
      workspaceName: folder.name,
      branch,
      head,
      files,
      edges,
      generatedAt: Date.now(),
      truncated,
    };
  }

  private async collectFromGit(
    repo: GitRepository,
    folder: vscode.WorkspaceFolder,
    opts: { maxFiles: number; includeUntracked: boolean },
  ): Promise<{ files: ChangedFile[]; truncated: boolean }> {
    const root = folder.uri.fsPath;
    const dedup = new Map<string, GitChange>();
    const push = (c: GitChange) => {
      if (!dedup.has(c.uri.fsPath)) dedup.set(c.uri.fsPath, c);
    };
    repo.state.workingTreeChanges.forEach(push);
    repo.state.indexChanges.forEach(push);
    if (opts.includeUntracked) repo.state.untrackedChanges?.forEach(push);

    const all = Array.from(dedup.values());
    let truncated = false;
    let work = all;
    if (all.length > opts.maxFiles) {
      truncated = true;
      work = all.slice(0, opts.maxFiles);
      this.log.warn(
        `Truncating change set to ${opts.maxFiles}/${all.length} files`,
      );
    }

    const files: ChangedFile[] = [];
    await mapWithConcurrency(work, SYMBOL_CONCURRENCY, async (c) => {
      try {
        const f = await this.fileFromChange(repo, c, root);
        if (f) files.push(f);
      } catch (e) {
        this.log.warn("Failed to index file", c.uri.fsPath, e);
      }
    });

    return { files, truncated };
  }

  private async fileFromChange(
    repo: GitRepository,
    c: GitChange,
    root: string,
  ): Promise<ChangedFile | undefined> {
    const rel = toRelativePosix(root, c.uri.fsPath);
    const kind: ChangeKind = mapStatus(c.status, !!c.renameUri);

    let unified = "";
    try {
      unified = await repo.diffWithHEAD(c.uri.fsPath);
    } catch {
      /* untracked/binary etc. */
    }

    const { additions, deletions } = countAddDel(unified);
    const hunks = parseHunks(unified);

    const symbols: ChangedSymbol[] =
      kind === "deleted" ? [] : await this.symbolsForFile(c.uri, hunks);

    return {
      id: rel,
      path: rel,
      language: detectLanguage(rel),
      kind,
      additions,
      deletions,
      symbols,
      hash: fnv1a(`${rel}|${additions}|${deletions}|${symbols.length}`),
    };
  }

  private async symbolsForFile(
    uri: vscode.Uri,
    hunks: { start: number; end: number }[],
  ): Promise<ChangedSymbol[]> {
    if (hunks.length === 0) return [];
    const tree = await vscode.commands
      .executeCommand<
        vscode.DocumentSymbol[]
      >("vscode.executeDocumentSymbolProvider", uri)
      .then(
        (x) => x ?? [],
        () => [] as vscode.DocumentSymbol[],
      );

    const out: ChangedSymbol[] = [];
    const visit = (s: vscode.DocumentSymbol) => {
      const r = { start: s.range.start.line + 1, end: s.range.end.line + 1 };
      if (hunks.some((h) => rangesIntersect(h, r))) {
        out.push({
          name: s.name,
          kind: vscode.SymbolKind[s.kind].toLowerCase(),
          startLine: r.start,
          endLine: r.end,
          signature: s.detail || undefined,
        });
      }
      s.children?.forEach(visit);
    };
    tree.forEach(visit);
    return out;
  }

  private async collectEdges(
    files: ChangedFile[],
    folder: vscode.WorkspaceFolder,
  ): Promise<ReferenceEdge[]> {
    const fileIds = new Set(files.map((f) => f.id));
    const edges: ReferenceEdge[] = [];
    const root = folder.uri.fsPath;

    await mapWithConcurrency(files, REF_CONCURRENCY, async (f) => {
      if (f.kind === "deleted") return;
      const uri = vscode.Uri.joinPath(folder.uri, ...f.path.split("/"));
      // Only top few symbols per file to keep things tractable.
      for (const sym of f.symbols.slice(0, 5)) {
        const pos = new vscode.Position(sym.startLine - 1, 0);
        const refs = await vscode.commands
          .executeCommand<
            vscode.Location[]
          >("vscode.executeReferenceProvider", uri, pos)
          .then(
            (x) => x ?? [],
            () => [] as vscode.Location[],
          );

        for (const r of refs.slice(0, 20)) {
          const rel = toRelativePosix(root, r.uri.fsPath);
          if (rel === f.id) continue;
          const kind = isTestPath(rel) ? "test" : "call";
          // Only keep edges that touch *another* changed file — that's the blast radius.
          if (fileIds.has(rel)) {
            edges.push({ from: f.id, to: rel, kind, weight: 1 });
          }
        }
      }
    });

    return dedupEdges(edges);
  }
}

function dedupEdges(edges: ReferenceEdge[]): ReferenceEdge[] {
  const m = new Map<string, ReferenceEdge>();
  for (const e of edges) {
    const k = `${e.from}->${e.to}|${e.kind}`;
    const cur = m.get(k);
    if (cur) cur.weight = (cur.weight ?? 1) + 1;
    else m.set(k, { ...e });
  }
  return Array.from(m.values());
}

function detectLanguage(rel: string): string {
  const ext = rel.split(".").pop()?.toLowerCase() ?? "";
  switch (ext) {
    case "ts":
    case "tsx":
      return "typescript";
    case "js":
    case "jsx":
      return "javascript";
    case "py":
      return "python";
    case "go":
      return "go";
    case "rs":
      return "rust";
    case "java":
      return "java";
    case "json":
      return "json";
    case "md":
      return "markdown";
    default:
      return ext || "plaintext";
  }
}

async function mapWithConcurrency<T>(
  items: T[],
  limit: number,
  fn: (t: T) => Promise<void>,
): Promise<void> {
  const queue = items.slice();
  const workers: Promise<void>[] = [];
  for (let i = 0; i < Math.min(limit, queue.length); i++) {
    workers.push(
      (async () => {
        while (queue.length) {
          const item = queue.shift()!;
          await fn(item);
        }
      })(),
    );
  }
  await Promise.all(workers);
}
