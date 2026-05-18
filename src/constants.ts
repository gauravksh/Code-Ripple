export const EXT_ID = "coderipple";

export const VIEW_PULSE = "coderipple.pulse";
export const VIEW_IMPACT = "coderipple.impact";

export const CMD = {
  analyze: "coderipple.analyze",
  refresh: "coderipple.refresh",
  openFlow: "coderipple.openFlow",
  openDashboard: "coderipple.openDashboard",
  explainCluster: "coderipple.explainCluster",
  toggleAuto: "coderipple.toggleAuto",
  clearCache: "coderipple.clearCache",
  showMetrics: "coderipple.showMetrics",
  ask: "coderipple.ask",
  switchRepo: "coderipple.switchRepo",
  setActiveRepo: "coderipple.setActiveRepo",
} as const;

export const STATE_KEYS = {
  lastSnapshot: "coderipple.lastSnapshot",
} as const;
