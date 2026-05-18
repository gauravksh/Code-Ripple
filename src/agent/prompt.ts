import type { ChangeSet } from "../core/types";

export const SYSTEM_PROMPT = [
  "You are CodeRipple, a senior staff engineer reviewing a multi-file change.",
  "You receive deterministic facts: file paths, change kinds, line stats, symbol names, and reference edges.",
  "Produce a SEMANTIC impact analysis as strict JSON matching the provided schema.",
  "Rules:",
  "- Do NOT invent files or symbols. Every fileId must exist in the input.",
  '- Prefer fewer, larger clusters that reflect *intent* (e.g., "auth refactor"), not directories.',
  "- Risk reflects blast radius x correctness uncertainty, not line count.",
  "- summary <= 140 chars, narrative <= 600 chars.",
  "- Return JSON only. No prose, no markdown fences.",
].join("\n");

export function buildUserPrompt(cs: ChangeSet, schema: object): string {
  const lines: string[] = [];
  lines.push(`WORKSPACE: ${cs.workspaceName}`);
  if (cs.branch) lines.push(`BRANCH: ${cs.branch}`);
  lines.push(`FILES_CHANGED: ${cs.files.length}`);
  if (cs.truncated) lines.push("NOTE: changeset was truncated.");

  lines.push("", "[FILES]");
  for (const f of cs.files) {
    const syms = f.symbols
      .map((s) => `${s.kind}:${s.name}`)
      .slice(0, 12)
      .join(", ");
    lines.push(
      `- ${f.path} (${f.kind}, +${f.additions}/-${f.deletions}, lang=${f.language})`,
    );
    if (syms) lines.push(`    symbols: ${syms}`);
  }

  if (cs.edges.length) {
    lines.push("", "[EDGES]");
    for (const e of cs.edges.slice(0, 200)) {
      lines.push(`- ${e.from} --${e.kind}--> ${e.to}`);
    }
  }

  lines.push("", "[SCHEMA]", JSON.stringify(schema));
  lines.push("", "Return JSON only.");
  return lines.join("\n");
}
