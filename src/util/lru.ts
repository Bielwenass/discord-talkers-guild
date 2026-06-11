// Tiny bounded-size map with insertion-order eviction. Used for per-message
// reaction/reply caps and duel-pair cooldowns — losing entries on restart is
// acceptable (design §12 notes).
export class LruMap<K, V> {
  private map = new Map<K, V>();
  constructor(private readonly max: number) {}

  get(key: K): V | undefined {
    const v = this.map.get(key);
    if (v !== undefined) {
      // refresh recency
      this.map.delete(key);
      this.map.set(key, v);
    }
    return v;
  }

  set(key: K, value: V): void {
    if (this.map.has(key)) this.map.delete(key);
    this.map.set(key, value);
    if (this.map.size > this.max) {
      const oldest = this.map.keys().next().value;
      if (oldest !== undefined) this.map.delete(oldest);
    }
  }

  /** Get existing value or initialize via factory, then return it. */
  getOrSet(key: K, factory: () => V): V {
    const existing = this.get(key);
    if (existing !== undefined) return existing;
    const created = factory();
    this.set(key, created);
    return created;
  }
}
