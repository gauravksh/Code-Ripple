import { EventEmitter } from "events";
import type { ChangeIntelligence } from "./types";

/**
 * Multi-workspace snapshot store.
 *
 * Holds one `ChangeIntelligence` per workspace folder, keyed by a stable key
 * (workspaceRoot fsPath when available, otherwise workspaceName).
 *
 * Exposes a "current" / active selection so legacy single-workspace views keep
 * working unchanged.
 */
export class ChangeStore extends EventEmitter {
  private snapshots = new Map<string, ChangeIntelligence>();
  private order: string[] = []; // preserve workspace insertion order
  private activeKey: string | undefined;
  private analyzing = 0;

  // ---- Active selection (legacy 'current') -------------------------------

  get current(): ChangeIntelligence | undefined {
    if (this.activeKey && this.snapshots.has(this.activeKey)) {
      return this.snapshots.get(this.activeKey);
    }
    return this.order.length ? this.snapshots.get(this.order[0]) : undefined;
  }

  get isAnalyzing(): boolean {
    return this.analyzing > 0;
  }

  setAnalyzing(v: boolean): void {
    this.analyzing += v ? 1 : -1;
    if (this.analyzing < 0) this.analyzing = 0;
    this.emit("status");
  }

  /** Legacy single-snapshot setter. Stores under the snapshot's own key. */
  set(snapshot: ChangeIntelligence): void {
    this.setFor(keyOf(snapshot), snapshot);
  }

  setFor(key: string, snapshot: ChangeIntelligence): void {
    if (!this.snapshots.has(key)) this.order.push(key);
    this.snapshots.set(key, snapshot);
    if (!this.activeKey) this.activeKey = key;
    this.emit("change", snapshot);
  }

  setActive(key: string): void {
    if (!this.snapshots.has(key)) return;
    this.activeKey = key;
    this.emit("active", key);
    this.emit("change", this.snapshots.get(key));
  }

  get activeWorkspaceKey(): string | undefined {
    return this.activeKey;
  }

  /** Remove a single workspace's snapshot. */
  removeWorkspace(key: string): void {
    if (!this.snapshots.delete(key)) return;
    this.order = this.order.filter((k) => k !== key);
    if (this.activeKey === key) this.activeKey = this.order[0];
    this.emit("change", this.current);
  }

  clear(): void {
    this.snapshots.clear();
    this.order = [];
    this.activeKey = undefined;
    this.emit("change", undefined);
  }

  // ---- All snapshots -----------------------------------------------------

  list(): Array<{ key: string; snapshot: ChangeIntelligence }> {
    return this.order
      .map((k) => ({ key: k, snapshot: this.snapshots.get(k)! }))
      .filter((x) => !!x.snapshot);
  }

  has(key: string): boolean {
    return this.snapshots.has(key);
  }

  get(key: string): ChangeIntelligence | undefined {
    return this.snapshots.get(key);
  }

  // ---- Subscriptions -----------------------------------------------------

  onChange(fn: (s: ChangeIntelligence | undefined) => void): () => void {
    this.on("change", fn);
    return () => this.off("change", fn);
  }

  onStatus(fn: () => void): () => void {
    this.on("status", fn);
    return () => this.off("status", fn);
  }

  onActive(fn: (key: string) => void): () => void {
    this.on("active", fn);
    return () => this.off("active", fn);
  }
}

export function keyOf(s: ChangeIntelligence): string {
  return s.changeSet.workspaceRoot || s.changeSet.workspaceName;
}
