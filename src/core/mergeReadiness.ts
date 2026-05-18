import type { ChangeIntelligence, MergeReadiness, MergeSignal } from "./types";
import { isTestPath } from "../util/paths";

/**
 * Merge readiness — the headline cockpit signal.
 *
 * Deterministic, grounded in the analysis only. Returns a verdict,
 * confidence (0..100), and explicit blockers/cautions the developer
 * still needs to address.
 */
export function computeMergeReadiness(s: ChangeIntelligence): MergeReadiness {
  const cs = s.changeSet;
  const blockers: MergeSignal[] = [];
  const cautions: MergeSignal[] = [];

  if (cs.files.length === 0) {
    return {
      ready: false,
      confidence: 0,
      blockers: [{ label: "No changes to merge" }],
      cautions: [],
    };
  }

  // ---- Blockers (must fix) ----
  if (s.risk === "critical") {
    blockers.push({
      label: "Risk is critical",
      detail: "Resolve high-risk areas before merging.",
    });
  }
  if (cs.truncated) {
    blockers.push({
      label: "Changeset truncated",
      detail: "Analysis is partial; some files were skipped.",
    });
  }
  const nonTest = cs.files.filter((f) => !isTestPath(f.path));
  const tests = cs.files.filter((f) => isTestPath(f.path));
  if (
    nonTest.length > 0 &&
    tests.length === 0 &&
    (s.risk === "high" || s.risk === "critical")
  ) {
    blockers.push({
      label: "No tests touched on a risky change",
      detail: `${nonTest.length} non-test file(s) without test updates`,
    });
  }

  // ---- Cautions (should review) ----
  if (s.risk === "high") {
    cautions.push({ label: "Risk is high", detail: "Review carefully." });
  }
  if (s.testStatus === "uncovered") {
    cautions.push({
      label: "Coverage looks uncovered",
      detail: "Consider adding tests.",
    });
  }
  if (s.blastRadius && s.blastRadius.severity === "high") {
    cautions.push({
      label: "High blast radius",
      detail: `${s.blastRadius.files.length} external file(s) reference changes`,
    });
  }
  if (s.tests && s.tests.missingCoverage.length > 0) {
    cautions.push({
      label: "Files lack test coverage",
      detail: `${s.tests.missingCoverage.length} file(s) without test references`,
    });
  }
  if (s.trust && s.trust.verdict === "low") {
    cautions.push({
      label: "Low trust verdict",
      detail: `Trust ${s.trust.score}/100`,
    });
  }

  // ---- Confidence ----
  // Start from trust score if available; subtract for blockers/cautions.
  let confidence = s.trust ? s.trust.score : riskBaseline(s.risk);
  confidence -= blockers.length * 18;
  confidence -= cautions.length * 6;
  if (s.partial) confidence -= 6;
  confidence = clamp(confidence, 0, 100);

  const ready = blockers.length === 0 && confidence >= 65;
  return { ready, confidence: Math.round(confidence), blockers, cautions };
}

function riskBaseline(r: ChangeIntelligence["risk"]): number {
  switch (r) {
    case "critical":
      return 25;
    case "high":
      return 45;
    case "medium":
      return 65;
    default:
      return 80;
  }
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}
