import { EventEmitter } from "events";
import type { ChangeIntelligence } from "./types";

/**
 * Single source of truth for the current change snapshot.
 * UI views subscribe; the indexer/agent pipeline pushes updates.
 */
export class ChangeStore extends EventEmitter {
  private snapshot: ChangeIntelligence | undefined;
  private analyzing = false;

  get current(): ChangeIntelligence | undefined {
    return this.snapshot;
  }

  get isAnalyzing(): boolean {
    return this.analyzing;
  }

  setAnalyzing(v: boolean): void {
    this.analyzing = v;
    this.emit("status");
  }

  set(snapshot: ChangeIntelligence): void {
    this.snapshot = snapshot;
    this.emit("change", snapshot);
  }

  clear(): void {
    this.snapshot = undefined;
    this.emit("change", undefined);
  }

  onChange(fn: (s: ChangeIntelligence | undefined) => void): () => void {
    this.on("change", fn);
    return () => this.off("change", fn);
  }

  onStatus(fn: () => void): () => void {
    this.on("status", fn);
    return () => this.off("status", fn);
  }
}
