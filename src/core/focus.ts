import type { ChangeIntelligence, ChangedFile, RiskLevel } from "./types";
import { isTestPath } from "../util/paths";

export interface FocusEntry {
  file: ChangedFile;
  reason: string;
  score: number;
}

/**
 * Rank changed files by where the developer should focus attention.
 *
 * Combines per-file risk, blast radius (external references), churn,
 * and lack of test coverage. Returns entries sorted by descending score.
 */
export function rankFocus(s: ChangeIntelligence): FocusEntry[] {
  const cs = s.changeSet;
  const out: FocusEntry[] = [];
  for (const f of cs.files) {
    if (isTestPath(f.path)) continue; // test files don't need "focus"
    const churn = f.additions + f.deletions;
    const extRefs = (f.references ?? []).filter((r) => r.external).length;
    const symbolCount = f.symbols.length;

    let score = 0;
    const reasons: string[] = [];

    score += riskWeight(f.risk ?? "low");
    if ((f.risk ?? "low") !== "low") reasons.push(`${f.risk} risk`);

    if (extRefs > 0) {
      const w = Math.min(40, extRefs * 6);
      score += w;
      reasons.push(`${extRefs} caller(s)`);
    }
    if (churn >= 100) {
      score += Math.min(20, Math.floor(churn / 25));
      reasons.push(`${churn} lines`);
    }
    if (symbolCount >= 5) {
      score += Math.min(10, symbolCount);
      reasons.push(`${symbolCount} symbols`);
    }
    if ((f.references?.length ?? 0) === 0 && symbolCount > 0) {
      score += 8;
      reasons.push("no callers found");
    }
    const hasTestRef = (f.references ?? []).some((r) => isTestPath(r.path));
    if (!hasTestRef && f.kind !== "deleted") {
      score += 6;
      reasons.push("untested");
    }

    if (reasons.length === 0) continue;
    out.push({
      file: f,
      score,
      reason: reasons.slice(0, 2).join(" · "),
    });
  }
  out.sort((a, b) => b.score - a.score);
  return out;
}

function riskWeight(r: RiskLevel): number {
  switch (r) {
    case "critical":
      return 60;
    case "high":
      return 40;
    case "medium":
      return 20;
    default:
      return 5;
  }
}
