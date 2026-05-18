import * as assert from "assert";
import { parseAgentJson } from "../../src/agent/schema";
import type { ChangeSet } from "../../src/core/types";

const cs: ChangeSet = {
  workspaceName: "demo",
  files: [
    {
      id: "src/a.ts",
      path: "src/a.ts",
      language: "typescript",
      kind: "modified",
      additions: 10,
      deletions: 2,
      symbols: [],
      hash: "h1",
    },
    {
      id: "src/b.ts",
      path: "src/b.ts",
      language: "typescript",
      kind: "modified",
      additions: 5,
      deletions: 0,
      symbols: [],
      hash: "h2",
    },
  ],
  edges: [],
  generatedAt: 0,
  truncated: false,
};

describe("agent/schema", () => {
  it("parses a valid LLM response", () => {
    const raw = JSON.stringify({
      summary: "auth refactor",
      narrative: "split token cache out",
      risk: "medium",
      testStatus: "partial",
      clusters: [
        {
          id: "c1",
          title: "Auth",
          rationale: "token cache",
          risk: "medium",
          fileIds: ["src/a.ts", "src/b.ts"],
          tags: ["auth"],
        },
      ],
      flow: {
        nodes: [
          {
            id: "src/a.ts",
            label: "a.ts",
            kind: "module",
            risk: "medium",
            cluster: "c1",
          },
          {
            id: "src/b.ts",
            label: "b.ts",
            kind: "module",
            risk: "low",
            cluster: "c1",
          },
        ],
        edges: [{ from: "src/a.ts", to: "src/b.ts", kind: "call" }],
      },
    });
    const out = parseAgentJson(raw, cs);
    assert.strictEqual(out.summary, "auth refactor");
    assert.strictEqual(out.clusters.length, 1);
    assert.strictEqual(out.flow.edges.length, 1);
  });

  it("drops unknown fileIds from clusters", () => {
    const raw = JSON.stringify({
      summary: "s",
      narrative: "n",
      risk: "low",
      testStatus: "unknown",
      clusters: [
        {
          id: "c1",
          title: "X",
          rationale: "",
          risk: "low",
          fileIds: ["ghost.ts", "src/a.ts"],
          tags: [],
        },
      ],
      flow: { nodes: [], edges: [] },
    });
    const out = parseAgentJson(raw, cs);
    assert.deepStrictEqual(out.clusters[0].fileIds, ["src/a.ts"]);
  });

  it("strips markdown fences", () => {
    const raw =
      '```json\n{"summary":"x","narrative":"","risk":"low","testStatus":"unknown","clusters":[],"flow":{"nodes":[],"edges":[]}}\n```';
    const out = parseAgentJson(raw, cs);
    assert.strictEqual(out.summary, "x");
  });
});
