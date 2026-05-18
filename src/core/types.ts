// Pure data models. No `vscode` import allowed in this file.

export type ChangeKind = "added" | "modified" | "deleted" | "renamed";

export type RiskLevel = "low" | "medium" | "high" | "critical";

export type TestStatus = "unknown" | "covered" | "partial" | "uncovered";

export type ReasoningSource = "llm" | "heuristic" | "hybrid";

/** A single external reference location (where a changed symbol is used). */
export interface ReferenceLocation {
  /** Workspace-relative POSIX path when inside the workspace, else absolute fsPath. */
  path: string;
  /** 1-based line. */
  line: number;
  /** Optional column (1-based). */
  column?: number;
  /** Name of the changed symbol that this reference points to. */
  symbol?: string;
  /** Short snippet of the referencing line (best-effort, may be empty). */
  preview?: string;
  /** True if this reference is in a file outside the current changeset. */
  external: boolean;
}

export interface ChangedSymbol {
  name: string;
  kind: string; // 'function' | 'class' | 'method' | 'variable' | ...
  startLine: number;
  endLine: number;
  signature?: string;
  /** All references for this symbol across the workspace (capped). */
  references?: ReferenceLocation[];
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
  /** Aggregated references for the file (union of symbol refs, deduped). */
  references?: ReferenceLocation[];
  /** Short one-line "why" — purpose of the change. Heuristic or LLM. */
  purpose?: string;
  /** Per-file risk badge (heuristic + agent merged). */
  risk?: RiskLevel;
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
  /** Workspace folder absolute fsPath (used to resolve files when revealing). */
  workspaceRoot?: string;
  branch?: string;
  head?: string;
  /** Repository remote URL (best-effort). */
  remote?: string;
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
  /** Inferred high-level intent of the change. */
  intent?: ChangeIntent;
  /** Trust score for the change (0..100) with positive/negative signals. */
  trust?: TrustScore;
  /** Smart test recommendations. */
  tests?: TestRecommendation;
  /** Blast-radius prediction: modules / services / tests likely impacted. */
  blastRadius?: BlastRadius;
  /** Architectural-drift warnings detected heuristically. */
  driftWarnings?: DriftWarning[];
  /** "What did Copilot miss?" suggestions. */
  followUps?: FollowUpSuggestion[];
}

export type IntentKind =
  | "feature"
  | "bugfix"
  | "refactor"
  | "auth"
  | "security"
  | "performance"
  | "api-contract"
  | "config-migration"
  | "tests"
  | "docs"
  | "infra"
  | "unknown";

export interface ChangeIntent {
  kind: IntentKind;
  label: string; // human-friendly title e.g. "Authentication refactor"
  confidence: number; // 0..1
  rationale: string; // short reason
}

export interface TrustSignal {
  kind: "positive" | "negative";
  label: string;
  weight: number; // 1..5
}

export interface TrustScore {
  score: number; // 0..100
  signals: TrustSignal[];
  verdict: "low" | "medium" | "high"; // overall confidence band
}

export interface TestRecommendation {
  framework: "jest" | "vitest" | "pytest" | "go" | "generic";
  recommended: string[]; // workspace-relative test file paths
  likelyImpacted: string[];
  missingCoverage: string[]; // changed files that lack any test reference
}

export interface BlastRadius {
  modules: string[]; // top-level modules likely impacted
  files: string[]; // specific files outside the changeset that consume changed symbols
  tests: string[]; // tests that should be re-run
  severity: RiskLevel;
  confidence: number; // 0..1
}

export type DriftKind =
  | "layer-violation"
  | "circular-dependency"
  | "bypassed-abstraction"
  | "convention-drift";

export interface DriftWarning {
  kind: DriftKind;
  message: string;
  files: string[];
  severity: RiskLevel;
}

export interface FollowUpSuggestion {
  message: string;
  category: "tests" | "callers" | "edge-cases" | "types" | "docs" | "config";
  confidence: number;
  relatedFiles: string[];
}

export interface MergeSignal {
  label: string;
  detail?: string;
}

export interface MergeReadiness {
  ready: boolean;
  /** 0..100 merge confidence */
  confidence: number;
  blockers: MergeSignal[];
  cautions: MergeSignal[];
}
