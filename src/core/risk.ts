import type { ChangedFile, RiskLevel } from "./types";
import { isConfigPath, isTestPath } from "../util/paths";

/**
 * Heuristic risk scoring. Not a substitute for the agent —
 * this is the deterministic floor used by the fallback and as
 * a guardrail on LLM outputs.
 */
export function scoreFileRisk(f: ChangedFile): RiskLevel {
  if (isConfigPath(f.path)) return "medium";
  const churn = f.additions + f.deletions;
  const symbolCount = f.symbols.length;
  if (churn > 400 || symbolCount > 12) return "high";
  if (churn > 120 || symbolCount > 5) return "medium";
  if (f.kind === "deleted") return "medium";
  return "low";
}

const ORDER: RiskLevel[] = ["low", "medium", "high", "critical"];

export function maxRisk(levels: RiskLevel[]): RiskLevel {
  let idx = 0;
  for (const l of levels) idx = Math.max(idx, ORDER.indexOf(l));
  return ORDER[idx];
}

export function testStatusFromFiles(files: ChangedFile[]): {
  status: "unknown" | "covered" | "partial" | "uncovered";
  touched: number;
  total: number;
} {
  const nonTest = files.filter((f) => !isTestPath(f.path));
  const tests = files.filter((f) => isTestPath(f.path));
  if (nonTest.length === 0 && tests.length === 0)
    return { status: "unknown", touched: 0, total: 0 };
  if (tests.length === 0)
    return { status: "uncovered", touched: 0, total: nonTest.length };
  if (tests.length >= nonTest.length)
    return { status: "covered", touched: tests.length, total: nonTest.length };
  return { status: "partial", touched: tests.length, total: nonTest.length };
}
