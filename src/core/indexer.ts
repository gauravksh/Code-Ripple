import * as vscode from "vscode";
import type {
  ChangeSet,
  ChangedFile,
  ChangedSymbol,
  ReferenceEdge,
  ReferenceLocation,
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
const MAX_REFS_PER_SYMBOL = 25;

export class Indexer {
  constructor(private log: Logger) {}

  async build(
    folder: vscode.WorkspaceFolder,
    opts: { maxFiles: number; includeUntracked: boolean; repo?: GitRepository },
  ): Promise<ChangeSet> {
    const api = await getGitAPI();
    if (!api) {
      this.log.warn(
        "vscode.git extension not available; CodeRipple v0.1 requires git.",
      );
    } else {
      this.log.debug(
        `git api state=${api.state}, repositories=${api.repositories.length}, folder=${folder.uri.fsPath}`,
      );
    }
    const repo = opts.repo ?? (api ? pickRepository(api, folder) : undefined);

    let files: ChangedFile[] = [];
    let truncated = false;
    let branch: string | undefined;
    let head: string | undefined;
    let remote: string | undefined;
    // Use the repo root as the analysis root so file ids resolve correctly even
    // when the repo is a sub-folder of the workspace folder.
    const analysisRoot = repo ? repo.rootUri.fsPath : folder.uri.fsPath;
    const analysisName = repo ? repoLabel(repo, folder) : folder.name;

    if (repo) {
      branch = repo.state.HEAD?.name;
      head = repo.state.HEAD?.commit;
      remote =
        (repo.state as any).remotes?.[0]?.fetchUrl ??
        (repo.state as any).remotes?.[0]?.pushUrl ??
        undefined;
      this.log.info(
        `Using repository root=${repo.rootUri.fsPath}, branch=${branch ?? "?"}, ` +
          `workingTree=${repo.state.workingTreeChanges.length}, ` +
          `index=${repo.state.indexChanges.length}, ` +
          `untracked=${repo.state.untrackedChanges?.length ?? 0}`,
      );
      const collected = await this.collectFromGit(repo, analysisRoot, opts);
      files = collected.files;
      truncated = collected.truncated;
      if (files.length === 0) {
        this.log.warn(
          `[${analysisName}] Repository has no working-tree / index changes.`,
        );
      }
    } else if (api) {
      this.log.warn(
        `No git repository matched workspace folder ${folder.uri.fsPath}. ` +
          `Known repos: [${api.repositories.map((r) => r.rootUri.fsPath).join(", ") || "none"}]`,
      );
    }

    const edges = await this.collectEdges(files, analysisRoot);

    return {
      workspaceName: analysisName,
      workspaceRoot: analysisRoot,
      branch,
      head,
      remote,
      files,
      edges,
      generatedAt: Date.now(),
      truncated,
    };
  }

  private async collectFromGit(
    repo: GitRepository,
    analysisRoot: string,
    opts: { maxFiles: number; includeUntracked: boolean },
  ): Promise<{ files: ChangedFile[]; truncated: boolean }> {
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
        const f = await this.fileFromChange(repo, c, analysisRoot);
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
    analysisRoot: string,
  ): Promise<ChangedFile | undefined> {
    const rel = toRelativePosix(analysisRoot, c.uri.fsPath);
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
    analysisRoot: string,
  ): Promise<ReferenceEdge[]> {
    const fileIds = new Set(files.map((f) => f.id));
    const edges: ReferenceEdge[] = [];
    const root = analysisRoot;
    const rootUri = vscode.Uri.file(root);

    await mapWithConcurrency(files, REF_CONCURRENCY, async (f) => {
      if (f.kind === "deleted") return;
      const uri = vscode.Uri.joinPath(rootUri, ...f.path.split("/"));
      const aggregated: ReferenceLocation[] = [];
      const seenAgg = new Set<string>();

      // Only top few symbols per file to keep things tractable.
      for (const sym of f.symbols.slice(0, 6)) {
        const pos = new vscode.Position(sym.startLine - 1, 0);
        const refs = await vscode.commands
          .executeCommand<
            vscode.Location[]
          >("vscode.executeReferenceProvider", uri, pos)
          .then(
            (x) => x ?? [],
            () => [] as vscode.Location[],
          );

        const symLocs: ReferenceLocation[] = [];
        for (const r of refs.slice(0, MAX_REFS_PER_SYMBOL)) {
          const rel = toRelativePosix(root, r.uri.fsPath);
          if (rel === f.id) continue; // skip self-refs
          const inside = fileIds.has(rel);
          const loc: ReferenceLocation = {
            path: rel,
            line: r.range.start.line + 1,
            column: r.range.start.character + 1,
            symbol: sym.name,
            external: !inside,
          };
          try {
            const doc = await vscode.workspace.openTextDocument(r.uri);
            loc.preview = doc
              .lineAt(r.range.start.line)
              .text.trim()
              .slice(0, 160);
          } catch {
            /* ignore */
          }
          symLocs.push(loc);

          const key = `${rel}:${loc.line}:${sym.name}`;
          if (!seenAgg.has(key)) {
            seenAgg.add(key);
            aggregated.push(loc);
          }

          // Cross-file changeset edge — drives the flow diagram.
          if (inside) {
            const kind = isTestPath(rel) ? "test" : "call";
            edges.push({ from: f.id, to: rel, kind, weight: 1 });
          }
        }
        sym.references = symLocs;
      }
      f.references = aggregated;
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

function repoLabel(
  repo: GitRepository,
  folder: vscode.WorkspaceFolder,
): string {
  const repoBase =
    repo.rootUri.fsPath.split(/[\\/]/).filter(Boolean).pop() || "repo";
  if (repo.rootUri.fsPath === folder.uri.fsPath) return folder.name;
  return repoBase;
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
