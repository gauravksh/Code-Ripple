/**
 * Diff utilities. Pure: parse unified diff text into hunk line ranges.
 *
 * We only need *changed line ranges* per file so we can intersect them
 * with document symbol ranges and compute the touched symbols.
 */

export interface HunkRange {
  /** 1-based start line in the new file. */
  start: number;
  /** 1-based inclusive end line in the new file. */
  end: number;
}

const HUNK_RE = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/;

/**
 * Parse the hunk headers of a unified diff and return the affected
 * line ranges in the *new* file.
 */
export function parseHunks(unifiedDiff: string): HunkRange[] {
  const out: HunkRange[] = [];
  for (const line of unifiedDiff.split(/\r?\n/)) {
    const m = HUNK_RE.exec(line);
    if (!m) continue;
    const start = parseInt(m[1], 10);
    const count = m[2] ? parseInt(m[2], 10) : 1;
    if (count <= 0) continue;
    out.push({ start, end: start + count - 1 });
  }
  return out;
}

/**
 * Count + / - lines from a unified diff body.
 */
export function countAddDel(unifiedDiff: string): {
  additions: number;
  deletions: number;
} {
  let additions = 0;
  let deletions = 0;
  for (const line of unifiedDiff.split(/\r?\n/)) {
    if (line.startsWith("+++") || line.startsWith("---")) continue;
    if (line.startsWith("+")) additions++;
    else if (line.startsWith("-")) deletions++;
  }
  return { additions, deletions };
}

export function rangesIntersect(
  a: { start: number; end: number },
  b: { start: number; end: number },
): boolean {
  return a.start <= b.end && b.start <= a.end;
}
