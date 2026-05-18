import type {
  ChangeIntelligence,
  ChangeSet,
  ChangedFile,
  FlowEdge,
  FlowNode,
  ImpactCluster,
  RiskLevel,
} from "../core/types";
import { isConfigPath, isTestPath } from "../util/paths";
import { maxRisk, scoreFileRisk, testStatusFromFiles } from "../core/risk";
import { inferChangeIntent, inferFilePurpose } from "../core/intent";
import {
  computeBlastRadius,
  computeTrustScore,
  recommendTests,
} from "../core/trust";

/**
 * Deterministic fallback when the LLM is unavailable.
 * Cluster strategy: top-level directory + tests/config carve-outs.
 */
export function heuristicIntelligence(cs: ChangeSet): ChangeIntelligence {
  // Annotate per-file purpose + per-file risk in-place so the dashboard
  // and flow view can surface them without recomputation.
  for (const f of cs.files) {
    if (!f.purpose) f.purpose = inferFilePurpose(f);
    if (!f.risk) f.risk = scoreFileRisk(f);
  }

  const buckets = new Map<string, ChangedFile[]>();
  for (const f of cs.files) {
    const key = bucketKey(f);
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key)!.push(f);
  }

  const clusters: ImpactCluster[] = [];
  let idx = 0;
  for (const [key, files] of buckets) {
    const risk = maxRisk(files.map(scoreFileRisk));
    clusters.push({
      id: `c${idx++}`,
      title: prettyTitle(key, files),
      rationale: `${files.length} file(s) grouped by ${key.startsWith("__") ? "role" : "top-level module"}.`,
      risk,
      fileIds: files.map((f) => f.id),
      tags: deriveTags(key, files),
    });
  }

  const flow = buildFlow(cs, clusters);
  const risk = maxRisk(clusters.map((c) => c.risk));
  const ts = testStatusFromFiles(cs.files);

  const base: ChangeIntelligence = {
    changeSet: cs,
    summary: oneLineSummary(cs, clusters, risk),
    narrative: narrative(cs, clusters),
    risk,
    testStatus: ts.status,
    clusters,
    flow,
    source: "heuristic",
    partial: false,
  };

  base.intent = inferChangeIntent(cs);
  base.tests = recommendTests(cs);
  base.blastRadius = computeBlastRadius(cs);
  // Trust depends on the rest of the intelligence — compute last.
  base.trust = computeTrustScore(base);
  return base;
}

function bucketKey(f: ChangedFile): string {
  if (isTestPath(f.path)) return "__tests";
  if (isConfigPath(f.path)) return "__config";
  const seg = f.path.split("/");
  if (
    seg.length >= 2 &&
    (seg[0] === "src" || seg[0] === "lib" || seg[0] === "app")
  ) {
    return `${seg[0]}/${seg[1]}`;
  }
  return seg[0] || "root";
}

function prettyTitle(key: string, files: ChangedFile[]): string {
  if (key === "__tests") return "Tests";
  if (key === "__config") return "Build / Config";
  return `Module: ${key}`;
}

function deriveTags(key: string, files: ChangedFile[]): string[] {
  const tags = new Set<string>();
  if (key === "__tests") tags.add("tests");
  if (key === "__config") tags.add("config");
  for (const f of files) tags.add(f.language);
  return Array.from(tags).slice(0, 6);
}

function oneLineSummary(
  cs: ChangeSet,
  clusters: ImpactCluster[],
  risk: RiskLevel,
): string {
  const top = clusters
    .slice()
    .sort((a, b) => b.fileIds.length - a.fileIds.length)
    .slice(0, 2)
    .map((c) => c.title)
    .join(" + ");
  return `${cs.files.length} file(s) changed across ${clusters.length} area(s) (${risk}): ${top}`.slice(
    0,
    140,
  );
}

function narrative(cs: ChangeSet, clusters: ImpactCluster[]): string {
  const parts: string[] = [];
  for (const c of clusters.slice(0, 3)) {
    parts.push(`${c.title} (${c.risk}): ${c.fileIds.length} file(s).`);
  }
  if (cs.edges.length)
    parts.push(`${cs.edges.length} cross-file reference edge(s) detected.`);
  return parts.join(" ").slice(0, 600);
}

function buildFlow(
  cs: ChangeSet,
  clusters: ImpactCluster[],
): { nodes: FlowNode[]; edges: FlowEdge[] } {
  const fileToCluster = new Map<string, string>();
  for (const c of clusters)
    for (const id of c.fileIds) fileToCluster.set(id, c.id);

  const nodes: FlowNode[] = cs.files.map((f) => ({
    id: f.id,
    label: f.path.split("/").pop() ?? f.path,
    kind: isTestPath(f.path)
      ? "test"
      : isConfigPath(f.path)
        ? "config"
        : "module",
    risk: scoreFileRisk(f),
    cluster: fileToCluster.get(f.id),
  }));

  const edges: FlowEdge[] = cs.edges.map((e) => ({
    from: e.from,
    to: e.to,
    kind: e.kind,
    weight: e.weight ?? 1,
  }));
  return { nodes, edges };
}
