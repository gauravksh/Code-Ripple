import * as vscode from "vscode";

const KEY = "coderipple.metrics";

export interface Metrics {
  analyses: number;
  llmCalls: number;
  heuristicFallbacks: number;
  errors: number;
  lastRunAt?: number;
}

const ZERO: Metrics = {
  analyses: 0,
  llmCalls: 0,
  heuristicFallbacks: 0,
  errors: 0,
};

export class LocalTelemetry {
  constructor(private mem: vscode.Memento) {}

  get(): Metrics {
    return { ...ZERO, ...(this.mem.get<Metrics>(KEY) ?? {}) };
  }

  bump(field: keyof Metrics): void {
    const m = this.get();
    if (typeof m[field] === "number") (m[field] as number) += 1;
    m.lastRunAt = Date.now();
    void this.mem.update(KEY, m);
  }

  reset(): void {
    void this.mem.update(KEY, ZERO);
  }
}
