import type {
  ChangeIntent,
  ChangeSet,
  ChangedFile,
  IntentKind,
} from "../core/types";
import { isConfigPath, isTestPath } from "../util/paths";

/**
 * Heuristic change-intent inference.
 *
 * Looks at paths, file names, symbol names, change kinds and ratio of
 * adds vs deletions to classify the overall intent. Returns a confidence
 * score so the UI can show how sure we are.
 */
export function inferChangeIntent(cs: ChangeSet): ChangeIntent {
  const buckets = new Map<IntentKind, number>();
  const score = (k: IntentKind, n: number) =>
    buckets.set(k, (buckets.get(k) ?? 0) + n);

  let totalAdd = 0;
  let totalDel = 0;
  let modified = 0;
  let added = 0;
  let deleted = 0;
  let testFiles = 0;
  let configFiles = 0;

  for (const f of cs.files) {
    totalAdd += f.additions;
    totalDel += f.deletions;
    if (f.kind === "modified") modified++;
    if (f.kind === "added") added++;
    if (f.kind === "deleted") deleted++;
    if (isTestPath(f.path)) {
      testFiles++;
      score("tests", 2);
    }
    if (isConfigPath(f.path)) {
      configFiles++;
      score("config-migration", 2);
    }
    if (/(^|\/)docs?\//i.test(f.path) || /\.mdx?$/i.test(f.path))
      score("docs", 2);
    if (/(^|\/)(infra|deploy|terraform|k8s|helm)\b/i.test(f.path))
      score("infra", 3);
    if (
      /(auth|login|oauth|jwt|token|session|sso|password|credential)/i.test(
        f.path,
      )
    )
      score("auth", 3);
    if (/(security|crypto|sanitize|xss|csrf|escape)/i.test(f.path))
      score("security", 3);
    if (/(perf|bench|cache|memo|throttle|debounce)/i.test(f.path))
      score("performance", 2);
    if (
      /(api|route|controller|handler|endpoint|schema|dto|contract)/i.test(
        f.path,
      )
    )
      score("api-contract", 2);

    for (const s of f.symbols) {
      if (/(fix|bug|patch|guard|handle.*error)/i.test(s.name))
        score("bugfix", 1);
      if (/(refactor|extract|rename|move|cleanup)/i.test(s.name))
        score("refactor", 1);
      if (/(auth|token|login|session)/i.test(s.name)) score("auth", 1);
      if (/(validate|verify|check|sanitize)/i.test(s.name))
        score("security", 1);
    }
  }

  // Ratio-based hints
  if (totalDel > totalAdd * 1.5 && deleted === 0) score("refactor", 2);
  if (added > modified && added >= 3) score("feature", 3);
  if (testFiles > 0 && testFiles >= cs.files.length * 0.6) score("tests", 3);
  if (configFiles > 0 && configFiles >= cs.files.length * 0.6)
    score("config-migration", 3);

  // Pick winner
  let best: IntentKind = "unknown";
  let bestScore = 0;
  for (const [k, v] of buckets) {
    if (v > bestScore) {
      best = k;
      bestScore = v;
    }
  }
  if (cs.files.length === 0) {
    return {
      kind: "unknown",
      label: "No changes",
      confidence: 0,
      rationale: "Nothing to analyze.",
    };
  }
  if (bestScore === 0) {
    best = modified > 0 ? "refactor" : added > 0 ? "feature" : "unknown";
    bestScore = 1;
  }

  // Confidence: relative dominance of winner over runner-up.
  const sorted = Array.from(buckets.values()).sort((a, b) => b - a);
  const top = sorted[0] ?? 0;
  const runner = sorted[1] ?? 0;
  const confidence = Math.min(
    1,
    Math.max(
      0.25,
      top === 0 ? 0.25 : ((top - runner) / (top + 0.001)) * 0.85 + 0.15,
    ),
  );

  return {
    kind: best,
    label: labelFor(best),
    confidence: round(confidence, 2),
    rationale: rationaleFor(best, {
      cs,
      testFiles,
      configFiles,
      added,
      modified,
      deleted,
    }),
  };
}

/**
 * Heuristic per-file purpose. Short, deterministic, never invented.
 * The agent (when LLM is available) may override this with a richer message.
 */
export function inferFilePurpose(f: ChangedFile): string {
  if (f.kind === "deleted") return `Removed ${shortPath(f.path)}.`;
  if (f.kind === "renamed") return `Renamed/moved ${shortPath(f.path)}.`;
  if (isTestPath(f.path)) {
    return f.kind === "added"
      ? `Adds new tests for ${guessSubject(f.path)}.`
      : `Updates tests for ${guessSubject(f.path)}.`;
  }
  if (isConfigPath(f.path)) {
    return `Adjusts build/config (${shortName(f.path)}).`;
  }
  const symNames = f.symbols
    .slice(0, 3)
    .map((s) => s.name)
    .filter(Boolean);
  const churn = f.additions + f.deletions;
  const verb =
    f.kind === "added"
      ? "Introduces"
      : f.additions > f.deletions * 2
        ? "Extends"
        : f.deletions > f.additions * 2
          ? "Trims"
          : "Refactors";
  if (symNames.length) {
    return `${verb} ${symNames.join(", ")} (${churn} lines).`;
  }
  return `${verb} ${shortName(f.path)} (${churn} lines).`;
}

function labelFor(kind: IntentKind): string {
  switch (kind) {
    case "feature":
      return "Feature addition";
    case "bugfix":
      return "Bug fix";
    case "refactor":
      return "Refactor";
    case "auth":
      return "Authentication refactor";
    case "security":
      return "Security hardening";
    case "performance":
      return "Performance optimization";
    case "api-contract":
      return "API contract change";
    case "config-migration":
      return "Config / build update";
    case "tests":
      return "Test additions";
    case "docs":
      return "Documentation update";
    case "infra":
      return "Infrastructure change";
    default:
      return "Mixed changes";
  }
}

function rationaleFor(
  kind: IntentKind,
  ctx: {
    cs: ChangeSet;
    testFiles: number;
    configFiles: number;
    added: number;
    modified: number;
    deleted: number;
  },
): string {
  const { cs, testFiles } = ctx;
  switch (kind) {
    case "auth":
      return "Auth/identity-related paths or symbols are central to this change.";
    case "security":
      return "Validation/crypto-adjacent code changed.";
    case "performance":
      return "Cache / perf-adjacent modules touched.";
    case "api-contract":
      return "Routes/handlers/schemas modified — public surface may shift.";
    case "config-migration":
      return "Mostly build/config artefacts.";
    case "tests":
      return `${testFiles}/${cs.files.length} files are tests.`;
    case "feature":
      return `${ctx.added} new file(s) suggest a net-new capability.`;
    case "bugfix":
      return "Small, targeted edits with fix-related naming.";
    case "refactor":
      return "Re-shaping without big net additions.";
    case "docs":
      return "Documentation files dominate.";
    case "infra":
      return "Deploy / IaC files touched.";
    default:
      return "Heterogeneous edits.";
  }
}

function shortPath(p: string): string {
  const parts = p.split("/");
  return parts.slice(-2).join("/");
}

function shortName(p: string): string {
  return p.split("/").pop() ?? p;
}

function guessSubject(testPath: string): string {
  const base = (testPath.split("/").pop() ?? "")
    .replace(/\.(test|spec)\.[tj]sx?$/i, "")
    .replace(/_test\.py$/, "")
    .replace(/^test_/i, "");
  return base || "the changed code";
}

function round(n: number, digits: number): number {
  const f = Math.pow(10, digits);
  return Math.round(n * f) / f;
}
