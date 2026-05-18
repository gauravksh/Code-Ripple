import type {
  BlastRadius,
  ChangeIntelligence,
  ChangeSet,
  ChangedFile,
  RiskLevel,
  TestRecommendation,
  TrustScore,
  TrustSignal,
} from "../core/types";
import { isTestPath } from "../util/paths";

/**
 * Trust score for a Copilot-assisted change.
 *
 * Combines deterministic positive/negative signals into a 0..100 score
 * with explicit reasons. Designed to be cheap and explainable.
 */
export function computeTrustScore(intel: ChangeIntelligence): TrustScore {
  const cs = intel.changeSet;
  const signals: TrustSignal[] = [];
  let score = 70; // neutral baseline

  const nonTest = cs.files.filter((f) => !isTestPath(f.path));
  const tests = cs.files.filter((f) => isTestPath(f.path));

  // ---- Positives ----
  if (tests.length > 0) {
    signals.push({
      kind: "positive",
      label: `Tests touched (${tests.length})`,
      weight: 3,
    });
    score += 8;
  }
  if (intel.testStatus === "covered") {
    signals.push({
      kind: "positive",
      label: "Test coverage looks complete",
      weight: 3,
    });
    score += 6;
  }
  if (cs.edges.length > 0) {
    signals.push({
      kind: "positive",
      label: "Cross-file references resolved",
      weight: 2,
    });
    score += 4;
  }
  const allTyped = nonTest.every((f) =>
    ["typescript", "go", "rust", "java"].includes(f.language),
  );
  if (nonTest.length > 0 && allTyped) {
    signals.push({
      kind: "positive",
      label: "Statically typed languages only",
      weight: 1,
    });
    score += 3;
  }

  // ---- Negatives ----
  if (nonTest.length > 0 && tests.length === 0) {
    signals.push({
      kind: "negative",
      label: "No tests touched",
      weight: 4,
    });
    score -= 14;
  }
  if (intel.risk === "high" || intel.risk === "critical") {
    signals.push({
      kind: "negative",
      label: `Risk is ${intel.risk}`,
      weight: 4,
    });
    score -= intel.risk === "critical" ? 18 : 10;
  }
  if (cs.truncated) {
    signals.push({
      kind: "negative",
      label: "Changeset was truncated — partial picture",
      weight: 2,
    });
    score -= 6;
  }
  const orphanFiles = nonTest.filter(
    (f) => (f.references?.length ?? 0) === 0 && f.symbols.length > 0,
  );
  if (orphanFiles.length > 0) {
    signals.push({
      kind: "negative",
      label: `${orphanFiles.length} changed file(s) have no incoming references`,
      weight: 2,
    });
    score -= Math.min(10, orphanFiles.length * 2);
  }
  const bigChurn = nonTest.find((f) => f.additions + f.deletions > 300);
  if (bigChurn) {
    signals.push({
      kind: "negative",
      label: `Large churn file (${bigChurn.path})`,
      weight: 3,
    });
    score -= 6;
  }

  score = Math.max(0, Math.min(100, Math.round(score)));
  const verdict: TrustScore["verdict"] =
    score >= 75 ? "high" : score >= 50 ? "medium" : "low";

  // Stable signal order: positives first, then negatives, by weight desc.
  signals.sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === "positive" ? -1 : 1;
    return b.weight - a.weight;
  });

  return { score, signals, verdict };
}

/**
 * Predicts the blast radius — what's likely to break outside the change.
 *
 * Uses the references collected by the indexer (which already include
 * external locations) to surface impacted modules and tests.
 */
export function computeBlastRadius(cs: ChangeSet): BlastRadius {
  const externalFiles = new Set<string>();
  const externalTests = new Set<string>();
  for (const f of cs.files) {
    for (const r of f.references ?? []) {
      if (!r.external) continue;
      if (isTestPath(r.path)) externalTests.add(r.path);
      else externalFiles.add(r.path);
    }
  }
  const modules = topModulesOf(Array.from(externalFiles), 6);
  const severity: RiskLevel =
    externalFiles.size >= 12
      ? "high"
      : externalFiles.size >= 5
        ? "medium"
        : externalFiles.size > 0
          ? "low"
          : "low";
  const confidence = clamp01(
    (externalFiles.size + externalTests.size) /
      Math.max(4, cs.files.length * 2),
  );
  return {
    modules,
    files: Array.from(externalFiles).slice(0, 30),
    tests: Array.from(externalTests).slice(0, 20),
    severity,
    confidence: Number(confidence.toFixed(2)),
  };
}

/**
 * Recommend tests intelligently based on references.
 */
export function recommendTests(cs: ChangeSet): TestRecommendation {
  const framework = detectFramework(cs);
  const allTests = new Set<string>();
  const direct = new Set<string>(); // tests that reference changed symbols
  for (const f of cs.files) {
    if (isTestPath(f.path)) allTests.add(f.path);
    for (const r of f.references ?? []) {
      if (isTestPath(r.path)) {
        allTests.add(r.path);
        if (r.external) direct.add(r.path);
      }
    }
  }
  const missingCoverage: string[] = [];
  for (const f of cs.files) {
    if (isTestPath(f.path)) continue;
    if (f.kind === "deleted") continue;
    const refsToTests = (f.references ?? []).filter((r) => isTestPath(r.path));
    if (refsToTests.length === 0 && f.symbols.length > 0) {
      missingCoverage.push(f.path);
    }
  }
  const recommended = Array.from(direct);
  // If nothing direct, fall back to any touched tests.
  if (recommended.length === 0) recommended.push(...allTests);

  return {
    framework,
    recommended: dedupe(recommended).slice(0, 12),
    likelyImpacted: dedupe(Array.from(allTests)).slice(0, 20),
    missingCoverage: missingCoverage.slice(0, 12),
  };
}

function detectFramework(cs: ChangeSet): TestRecommendation["framework"] {
  const langs = new Set(cs.files.map((f) => f.language));
  const paths = cs.files.map((f) => f.path).join("\n");
  if (langs.has("python")) return "pytest";
  if (langs.has("go")) return "go";
  if (/vitest/i.test(paths)) return "vitest";
  if (/jest/i.test(paths)) return "jest";
  if (langs.has("typescript") || langs.has("javascript")) return "jest";
  return "generic";
}

function topModulesOf(paths: string[], n: number): string[] {
  const counts = new Map<string, number>();
  for (const p of paths) {
    const seg = p.split("/");
    const mod =
      seg.length >= 2 &&
      (seg[0] === "src" || seg[0] === "lib" || seg[0] === "app")
        ? `${seg[0]}/${seg[1]}`
        : (seg[0] ?? "root");
    counts.set(mod, (counts.get(mod) ?? 0) + 1);
  }
  return Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([k]) => k);
}

function dedupe<T>(xs: T[]): T[] {
  return Array.from(new Set(xs));
}

function clamp01(n: number): number {
  return Math.max(0, Math.min(1, n));
}

// Re-export ChangedFile to satisfy unused-import lint when referenced in JSDoc only.
export type _ChangedFile = ChangedFile;
