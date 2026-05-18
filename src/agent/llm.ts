import * as vscode from "vscode";
import type { Logger } from "../services/logger";

export interface LLMResult {
  text: string;
  modelId: string;
}

const LLM_TIMEOUT_MS = 20_000;
//testing
/**
 * Thin wrapper around `vscode.lm`. Returns `undefined` if no model is
 * available (e.g. user not signed in to Copilot, or VS Code build
 * without the LM API). Callers must handle that case and fall back.
 */
export async function callLanguageModel(
  system: string,
  user: string,
  preferredFamily: string,
  log: Logger,
): Promise<LLMResult | undefined> {
  const lm = (vscode as any).lm as typeof vscode.lm | undefined;
  if (!lm || typeof lm.selectChatModels !== "function") {
    log.info("vscode.lm not available; using heuristic fallback.");
    return undefined;
  }

  let models: vscode.LanguageModelChat[] = [];
  try {
    if (preferredFamily && preferredFamily !== "auto") {
      models = await lm.selectChatModels({
        vendor: "copilot",
        family: preferredFamily,
      });
    }
    if (models.length === 0) {
      models = await lm.selectChatModels({ vendor: "copilot" });
    }
  } catch (e) {
    log.warn("selectChatModels failed", e);
    return undefined;
  }
  if (models.length === 0) {
    log.info("No language models available; using heuristic fallback.");
    return undefined;
  }

  const model = models[0];
  const messages = [
    vscode.LanguageModelChatMessage.User(system + "\n\n" + user),
  ];

  const cts = new vscode.CancellationTokenSource();
  const timer = setTimeout(() => cts.cancel(), LLM_TIMEOUT_MS);
  try {
    const response = await model.sendRequest(messages, {}, cts.token);
    let text = "";
    for await (const frag of response.text) text += frag;
    return { text, modelId: model.id ?? model.family ?? "unknown" };
  } catch (e) {
    log.warn("Language model call failed", e);
    return undefined;
  } finally {
    clearTimeout(timer);
    cts.dispose();
  }
}
