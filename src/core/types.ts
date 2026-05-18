// Pure data models. No `vscode` import allowed in this file.

export type ChangeKind = "added" | "modified" | "deleted" | "renamed";

export type RiskLevel = "low" | "medium" | "high" | "critical";

export type TestStatus = "unknown" | "covered" | "partial" | "uncovered";

export type ReasoningSource = "llm" | "heuristic" | "hybrid";

export interface ChangedSymbol {
  name: string;
  kind: string; // 'function' | 'class' | 'method' | 'variable' | ...
  startLine: number;
  endLine: number;
  signature?: string;
}

export interface ChangedFile {
  /** Workspace-relative POSIX path. Also used as the canonical ID. */
  id: string;
  path: string;
  language: string;
  kind: ChangeKind;
  additions: number;
  deletions: number;
  symbols: ChangedSymbol[];
  /** Content hash for cache invalidation. */
  hash: string;
}

export type EdgeKind = "import" | "call" | "extends" | "test" | "data";

export interface ReferenceEdge {
  from: string; // file or symbol id
  to: string;
  kind: EdgeKind;
  weight?: number;
}

export interface ChangeSet {
  workspaceName: string;
  branch?: string;
  head?: string;
  files: ChangedFile[];
  edges: ReferenceEdge[];
  generatedAt: number;
  truncated: boolean;
}

export interface ImpactCluster {
  id: string;
  title: string;
  rationale: string;
  risk: RiskLevel;
  fileIds: string[];
  tags: string[];
}

export type FlowNodeKind = "module" | "symbol" | "test" | "config" | "external";

export interface FlowNode {
  id: string;
  label: string;
  kind: FlowNodeKind;
  risk: RiskLevel;
  cluster?: string;
}

export interface FlowEdge {
  from: string;
  to: string;
  kind: EdgeKind;
  weight?: number;
}

export interface ChangeIntelligence {
  changeSet: ChangeSet;
  summary: string;
  narrative: string;
  risk: RiskLevel;
  testStatus: TestStatus;
  clusters: ImpactCluster[];
  flow: { nodes: FlowNode[]; edges: FlowEdge[] };
  source: ReasoningSource;
  partial: boolean;
}
