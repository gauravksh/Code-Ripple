import * as assert from "assert";
import { countAddDel, parseHunks, rangesIntersect } from "../../src/core/diff";

describe("core/diff", () => {
  it("parses hunk new-file ranges", () => {
    const d = [
      "--- a/foo.ts",
      "+++ b/foo.ts",
      "@@ -10,3 +10,5 @@",
      " x",
      "+a",
      "+b",
      "@@ -50 +52,2 @@",
      "+c",
    ].join("\n");
    const h = parseHunks(d);
    assert.deepStrictEqual(h, [
      { start: 10, end: 14 },
      { start: 52, end: 53 },
    ]);
  });

  it("counts additions and deletions", () => {
    const d = "+a\n+b\n-c\n+d\n";
    assert.deepStrictEqual(countAddDel(d), { additions: 3, deletions: 1 });
  });

  it("intersects ranges", () => {
    assert.ok(rangesIntersect({ start: 1, end: 5 }, { start: 5, end: 9 }));
    assert.ok(!rangesIntersect({ start: 1, end: 5 }, { start: 6, end: 9 }));
  });
});
