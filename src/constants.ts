export const EXT_ID = "coderipple";

export const VIEW_PULSE = "coderipple.pulse";
export const VIEW_IMPACT = "coderipple.impact";

export const CMD = {
  analyze: "coderipple.analyze",
  refresh: "coderipple.refresh",
  openFlow: "coderipple.openFlow",
  explainCluster: "coderipple.explainCluster",
  toggleAuto: "coderipple.toggleAuto",
  clearCache: "coderipple.clearCache",
  showMetrics: "coderipple.showMetrics",
} as const;

export const STATE_KEYS = {
  lastSnapshot: "coderipple.lastSnapshot",
} as const;
