import * as vscode from "vscode";
import type { ChangeIntelligence, ChangeSet } from "../core/types";
import {
  AGENT_OUTPUT_SCHEMA,
  attachToChangeSet,
  parseAgentJson,
} from "./schema";
import { SYSTEM_PROMPT, buildUserPrompt } from "./prompt";
import { callLanguageModel } from "./llm";
import { heuristicIntelligence } from "./heuristics";
import type { Logger } from "../services/logger";
import type { LocalTelemetry } from "../services/telemetry";

export class Agent {
  constructor(
    private log: Logger,
    private telemetry: LocalTelemetry,
  ) {}

  async analyze(cs: ChangeSet): Promise<ChangeIntelligence> {
    const cfg = vscode.workspace.getConfiguration("coderipple");
    const mode = (cfg.get<string>("languageMode") ?? "auto") as
      | "auto"
      | "llm"
      | "heuristic";
    const family = cfg.get<string>("model") ?? "auto";

    if (mode === "heuristic" || cs.files.length === 0) {
      return heuristicIntelligence(cs);
    }

    const user = buildUserPrompt(cs, AGENT_OUTPUT_SCHEMA);
    const result = await callLanguageModel(
      SYSTEM_PROMPT,
      user,
      family,
      this.log,
    );

    if (!result) {
      this.telemetry.bump("heuristicFallbacks");
      return heuristicIntelligence(cs);
    }
    this.telemetry.bump("llmCalls");

    try {
      const parsed = parseAgentJson(result.text, cs);
      return attachToChangeSet(parsed, cs, "llm");
    } catch (e) {
      this.log.warn("Agent JSON parse failed, falling back to heuristic.", e);
      this.telemetry.bump("heuristicFallbacks");
      // Hybrid: keep LLM summary text isn't safe (couldn't parse) — just use heuristic.
      return heuristicIntelligence(cs);
    }
  }
}
