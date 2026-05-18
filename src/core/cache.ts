/** Tiny LRU. Sufficient for v1; replace with `lru-cache` if needed. */
export class LRU<K, V> {
  private map = new Map<K, V>();
  constructor(private capacity: number) {}

  get(key: K): V | undefined {
    const v = this.map.get(key);
    if (v === undefined) return undefined;
    this.map.delete(key);
    this.map.set(key, v);
    return v;
  }

  set(key: K, val: V): void {
    if (this.map.has(key)) this.map.delete(key);
    this.map.set(key, val);
    if (this.map.size > this.capacity) {
      const firstKey = this.map.keys().next().value as K;
      this.map.delete(firstKey);
    }
  }

  clear(): void {
    this.map.clear();
  }
}
