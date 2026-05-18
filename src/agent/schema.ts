import type {
  ChangeIntelligence,
  ChangeSet,
  FlowEdge,
  FlowNode,
  ImpactCluster,
  RiskLevel,
  TestStatus,
} from "../core/types";
import { inferChangeIntent, inferFilePurpose } from "../core/intent";
import {
  computeBlastRadius,
  computeTrustScore,
  recommendTests,
} from "../core/trust";
import { scoreFileRisk } from "../core/risk";

export const AGENT_OUTPUT_SCHEMA = {
  $schema: "http://json-schema.org/draft-07/schema#",
  type: "object",
  required: ["summary", "narrative", "risk", "testStatus", "clusters", "flow"],
  properties: {
    summary: { type: "string", maxLength: 140 },
    narrative: { type: "string", maxLength: 600 },
    risk: { enum: ["low", "medium", "high", "critical"] },
    testStatus: { enum: ["unknown", "covered", "partial", "uncovered"] },
    clusters: {
      type: "array",
      items: {
        type: "object",
        required: ["id", "title", "rationale", "risk", "fileIds", "tags"],
        properties: {
          id: { type: "string" },
          title: { type: "string", maxLength: 80 },
          rationale: { type: "string", maxLength: 300 },
          risk: { enum: ["low", "medium", "high", "critical"] },
          fileIds: { type: "array", items: { type: "string" } },
          tags: { type: "array", items: { type: "string" } },
        },
      },
    },
    flow: {
      type: "object",
      required: ["nodes", "edges"],
      properties: {
        nodes: {
          type: "array",
          items: {
            type: "object",
            required: ["id", "label", "kind", "risk"],
            properties: {
              id: { type: "string" },
              label: { type: "string" },
              kind: {
                enum: ["module", "symbol", "test", "config", "external"],
              },
              risk: { enum: ["low", "medium", "high", "critical"] },
              cluster: { type: "string" },
            },
          },
        },
        edges: {
          type: "array",
          items: {
            type: "object",
            required: ["from", "to", "kind"],
            properties: {
              from: { type: "string" },
              to: { type: "string" },
              kind: { enum: ["import", "call", "extends", "test", "data"] },
              weight: { type: "number" },
            },
          },
        },
      },
    },
  },
} as const;

interface LLMShape {
  summary: string;
  narrative: string;
  risk: RiskLevel;
  testStatus: TestStatus;
  clusters: ImpactCluster[];
  flow: { nodes: FlowNode[]; edges: FlowEdge[] };
}

const RISKS: RiskLevel[] = ["low", "medium", "high", "critical"];
const KINDS = ["module", "symbol", "test", "config", "external"] as const;
const EDGE_KINDS = ["import", "call", "extends", "test", "data"] as const;
const STATUSES: TestStatus[] = ["unknown", "covered", "partial", "uncovered"];

export class SchemaError extends Error {}

/**
 * Permissive parser: accepts JSON with stray fences, validates the
 * essentials, drops dangling references to unknown files.
 */
export function parseAgentJson(raw: string, cs: ChangeSet): LLMShape {
  const cleaned = stripFences(raw).trim();
  let obj: unknown;
  try {
    obj = JSON.parse(cleaned);
  } catch (e) {
    throw new SchemaError(
      "Agent did not return valid JSON: " + (e as Error).message,
    );
  }
  if (!obj || typeof obj !== "object")
    throw new SchemaError("Agent JSON is not an object");
  const o = obj as Record<string, unknown>;

  const validIds = new Set(cs.files.map((f) => f.id));

  const summary = str(o.summary, 140) ?? "";
  const narrative = str(o.narrative, 600) ?? "";
  const risk = pickEnum<RiskLevel>(o.risk, RISKS) ?? "low";
  const testStatus = pickEnum<TestStatus>(o.testStatus, STATUSES) ?? "unknown";

  const clusters = Array.isArray(o.clusters)
    ? ((o.clusters as any[])
        .map((c, i) => sanitizeCluster(c, i, validIds))
        .filter(Boolean) as ImpactCluster[])
    : [];

  const flowIn = (o.flow ?? {}) as Record<string, unknown>;
  const nodes = Array.isArray(flowIn.nodes)
    ? ((flowIn.nodes as any[]).map(sanitizeNode).filter(Boolean) as FlowNode[])
    : [];
  const nodeIds = new Set(nodes.map((n) => n.id));
  const edges = Array.isArray(flowIn.edges)
    ? ((flowIn.edges as any[])
        .map(sanitizeEdge)
        .filter(Boolean)
        .filter(
          (e) => nodeIds.has(e!.from) && nodeIds.has(e!.to),
        ) as FlowEdge[])
    : [];

  return {
    summary,
    narrative,
    risk,
    testStatus,
    clusters,
    flow: { nodes, edges },
  };
}

export function attachToChangeSet(
  parsed: LLMShape,
  cs: ChangeSet,
  source: ChangeIntelligence["source"],
  partial = false,
): ChangeIntelligence {
  for (const f of cs.files) {
    if (!f.purpose) f.purpose = inferFilePurpose(f);
    if (!f.risk) f.risk = scoreFileRisk(f);
  }
  const intel: ChangeIntelligence = {
    changeSet: cs,
    summary: parsed.summary,
    narrative: parsed.narrative,
    risk: parsed.risk,
    testStatus: parsed.testStatus,
    clusters: parsed.clusters,
    flow: parsed.flow,
    source,
    partial,
  };
  intel.intent = inferChangeIntent(cs);
  intel.tests = recommendTests(cs);
  intel.blastRadius = computeBlastRadius(cs);
  intel.trust = computeTrustScore(intel);
  return intel;
}

function sanitizeCluster(
  c: any,
  i: number,
  validIds: Set<string>,
): ImpactCluster | undefined {
  if (!c || typeof c !== "object") return undefined;
  const fileIds = Array.isArray(c.fileIds)
    ? c.fileIds.filter(
        (x: unknown): x is string => typeof x === "string" && validIds.has(x),
      )
    : [];
  if (fileIds.length === 0) return undefined;
  return {
    id: typeof c.id === "string" && c.id ? c.id : `cluster-${i}`,
    title: str(c.title, 80) ?? `Cluster ${i + 1}`,
    rationale: str(c.rationale, 300) ?? "",
    risk: pickEnum<RiskLevel>(c.risk, RISKS) ?? "low",
    fileIds,
    tags: Array.isArray(c.tags)
      ? c.tags
          .filter((x: unknown): x is string => typeof x === "string")
          .slice(0, 8)
      : [],
  };
}

function sanitizeNode(n: any): FlowNode | undefined {
  if (!n || typeof n.id !== "string" || typeof n.label !== "string")
    return undefined;
  return {
    id: n.id,
    label: n.label.slice(0, 80),
    kind: (KINDS as readonly string[]).includes(n.kind) ? n.kind : "module",
    risk: pickEnum<RiskLevel>(n.risk, RISKS) ?? "low",
    cluster: typeof n.cluster === "string" ? n.cluster : undefined,
  };
}

function sanitizeEdge(e: any): FlowEdge | undefined {
  if (!e || typeof e.from !== "string" || typeof e.to !== "string")
    return undefined;
  return {
    from: e.from,
    to: e.to,
    kind: (EDGE_KINDS as readonly string[]).includes(e.kind) ? e.kind : "call",
    weight: typeof e.weight === "number" ? e.weight : 1,
  };
}

function str(v: unknown, max: number): string | undefined {
  return typeof v === "string" ? v.slice(0, max) : undefined;
}

function pickEnum<T extends string>(
  v: unknown,
  allowed: readonly T[],
): T | undefined {
  return typeof v === "string" && (allowed as readonly string[]).includes(v)
    ? (v as T)
    : undefined;
}

function stripFences(s: string): string {
  return s.replace(/^```(?:json)?\s*/i, "").replace(/\s*```\s*$/i, "");
}
