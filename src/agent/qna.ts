import * as vscode from "vscode";
import type { ChangeIntelligence, ChangedFile } from "../core/types";
import type { Logger } from "../services/logger";
import { callLanguageModel } from "./llm";

/**
 * Grounded Q&A: answer questions about the current snapshot using ONLY
 * facts visible in the analysis. Falls back to a deterministic answer
 * when no LLM is available.
 */
export async function answerQuestion(
  question: string,
  snapshots: ChangeIntelligence[],
  log: Logger,
): Promise<{ answer: string; sources: string[]; usedLLM: boolean }> {
  if (!question.trim()) {
    return { answer: "Ask a question first.", sources: [], usedLLM: false };
  }
  if (snapshots.length === 0) {
    return {
      answer: "No analyzed changes yet. Run CodeRipple: Analyze first.",
      sources: [],
      usedLLM: false,
    };
  }
  const context = snapshots.map(serializeSnapshot).join("\n\n");
  const cfg = vscode.workspace.getConfiguration("coderipple");
  const family = cfg.get<string>("model") ?? "auto";

  const sys =
    "You are CodeRipple, an AI staff engineer reviewing a developer's pending changes. " +
    "Answer ONLY from the grounded context below. If the context doesn't contain the answer, say so. " +
    "Cite file paths in backticks. Keep answers under 6 sentences.";
  const user = `# Question\n${question}\n\n# Grounded change context\n${context}`;

  const res = await callLanguageModel(sys, user, family, log);
  if (res) {
    return {
      answer: res.text.trim(),
      sources: extractFiles(snapshots),
      usedLLM: true,
    };
  }
  return {
    answer: deterministicAnswer(question, snapshots),
    sources: extractFiles(snapshots),
    usedLLM: false,
  };
}

function serializeSnapshot(s: ChangeIntelligence): string {
  const cs = s.changeSet;
  const head: string[] = [
    `## Repo: ${cs.workspaceName} (branch=${cs.branch ?? "?"})`,
    `Risk: ${s.risk}; Source: ${s.source}; Tests: ${s.testStatus}`,
    `Summary: ${s.summary}`,
  ];
  if (s.intent)
    head.push(
      `Intent: ${s.intent.label} (${s.intent.kind}, ${Math.round(
        s.intent.confidence * 100,
      )}%) — ${s.intent.rationale}`,
    );
  if (s.trust)
    head.push(
      `Trust: ${s.trust.score}/100 (${s.trust.verdict}); ` +
        s.trust.signals
          .slice(0, 4)
          .map((sg) => `[${sg.kind}] ${sg.label}`)
          .join("; "),
    );
  const files = cs.files.slice(0, 30).map(formatFile).join("\n");
  return `${head.join("\n")}\n\n### Files\n${files}`;
}

function formatFile(f: ChangedFile): string {
  const syms = f.symbols
    .slice(0, 6)
    .map((s) => `${s.kind} ${s.name}`)
    .join(", ");
  const refs = (f.references ?? [])
    .slice(0, 4)
    .map((r) => `${r.path}:${r.line}`)
    .join(", ");
  return (
    `- \`${f.path}\` [${f.kind}] +${f.additions}/-${f.deletions} ` +
    `lang=${f.language}` +
    (f.purpose ? `\n    purpose: ${f.purpose}` : "") +
    (syms ? `\n    symbols: ${syms}` : "") +
    (refs ? `\n    referenced from: ${refs}` : "")
  );
}

function extractFiles(snapshots: ChangeIntelligence[]): string[] {
  const out = new Set<string>();
  for (const s of snapshots) for (const f of s.changeSet.files) out.add(f.path);
  return Array.from(out).slice(0, 50);
}

function deterministicAnswer(
  q: string,
  snapshots: ChangeIntelligence[],
): string {
  const lower = q.toLowerCase();
  const lines: string[] = [];
  for (const s of snapshots) {
    const cs = s.changeSet;
    lines.push(
      `**${cs.workspaceName}** — ${cs.files.length} file(s), risk=${s.risk}, intent=${s.intent?.label ?? "n/a"}.`,
    );
    if (/risk|dangerous|safe/.test(lower) && s.trust) {
      lines.push(
        `Trust ${s.trust.score}/100 (${s.trust.verdict}): ` +
          s.trust.signals
            .slice(0, 3)
            .map((sg) => sg.label)
            .join("; ") +
          ".",
      );
    }
    if (/test/.test(lower) && s.tests) {
      lines.push(
        `Tests: framework=${s.tests.framework}; recommended=${s.tests.recommended.length}; missing=${s.tests.missingCoverage.length}.`,
      );
    }
    if (/blast|impact|radius|references|callers/.test(lower) && s.blastRadius) {
      lines.push(
        `Blast radius: ${s.blastRadius.files.length} external file(s), severity=${s.blastRadius.severity}, modules: ${s.blastRadius.modules.join(", ") || "n/a"}.`,
      );
    }
  }
  lines.push(
    "_LLM unavailable — returning a grounded summary from the analysis only._",
  );
  return lines.join("\n\n");
}
