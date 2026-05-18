import * as path from "path";

/** Convert an absolute path to a workspace-relative POSIX path. */
export function toRelativePosix(root: string, abs: string): string {
  const rel = path.relative(root, abs);
  return rel.split(path.sep).join("/");
}

const TEST_RE = /(^|\/)(test|tests|__tests__|spec|specs)\//i;
const TEST_FILE_RE = /\.(test|spec)\.[tj]sx?$|_test\.py$|test_.*\.py$/i;

export function isTestPath(rel: string): boolean {
  return TEST_RE.test(rel) || TEST_FILE_RE.test(rel);
}

const CONFIG_RE =
  /(^|\/)(tsconfig|package|pyproject|requirements|webpack|vite|esbuild|rollup|babel)\b/i;
export function isConfigPath(rel: string): boolean {
  return CONFIG_RE.test(rel);
}
