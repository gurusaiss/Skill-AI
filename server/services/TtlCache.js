/**
 * TtlCache.js - tiny async read-through cache with request coalescing.
 *
 * Used for hot, read-mostly collections (DataStore tables, the user list, the
 * per-user auth lookup). Design rules:
 *   - A value lives at most `ttlMs` (callers keep this at 5-10 s).
 *   - Concurrent loads of the same key share ONE in-flight promise, so a page
 *     that fires 6 parallel API calls costs one backend read, not six.
 *   - invalidate(key) / invalidateAll() are called by EVERY write path of the
 *     data they guard. A generation counter makes sure a load that started
 *     BEFORE an invalidation can never be stored afterwards (no stale
 *     resurrection by a slow in-flight read).
 *   - `validate(entry)` lets file-backed callers add a cheap extra check
 *     (e.g. file mtime) so writes made by other code paths are still seen.
 *   - Failed loads are never cached.
 */
export class TtlCache {
  constructor({ ttlMs = 5000, maxEntries = 500, now = () => Date.now() } = {}) {
    this.ttlMs = ttlMs;
    this.maxEntries = maxEntries;
    this.now = now;
    this.entries = new Map();   // key -> { value, expires, meta }
    this.inflight = new Map();  // key -> { promise, gen }
    this.gens = new Map();      // key -> generation counter
    this.allGen = 0;
    this.hits = 0;
    this.misses = 0;
  }

  _gen(key) { return (this.gens.get(key) || 0) + this.allGen * 1e6; }

  /**
   * @param {string} key
   * @param {() => Promise<any>} loader
   * @param {{ validate?: (meta:any)=>boolean, meta?: () => any, ttlMs?: number }} [opts]
   *   meta() is evaluated BEFORE loading and stored with the entry; validate(storedMeta)
   *   must return true for the entry to be served.
   */
  async get(key, loader, opts = {}) {
    // Kill switch: DISABLE_READ_CACHE=1 turns every TtlCache into a pass-through
    // (used to benchmark "before" numbers and as an emergency off-switch).
    if (process.env.DISABLE_READ_CACHE === '1') return loader();
    const t = this.now();
    const hit = this.entries.get(key);
    if (hit && hit.expires > t && (!opts.validate || opts.validate(hit.meta))) {
      this.hits++;
      return hit.value;
    }
    const running = this.inflight.get(key);
    if (running && running.gen === this._gen(key) && (!opts.validate || opts.validate(running.meta))) {
      this.hits++;
      return running.promise;
    }
    this.misses++;
    const gen = this._gen(key);
    const meta = opts.meta ? opts.meta() : undefined;
    const promise = (async () => {
      try {
        const value = await loader();
        if (this._gen(key) === gen) {
          if (this.entries.size >= this.maxEntries) this.entries.delete(this.entries.keys().next().value);
          this.entries.set(key, { value, expires: this.now() + (opts.ttlMs ?? this.ttlMs), meta });
        }
        return value;
      } finally {
        const cur = this.inflight.get(key);
        if (cur && cur.promise === promise) this.inflight.delete(key);
      }
    })();
    this.inflight.set(key, { promise, gen, meta });
    return promise;
  }

  invalidate(key) {
    this.gens.set(key, (this.gens.get(key) || 0) + 1);
    this.entries.delete(key);
    this.inflight.delete(key);
  }

  invalidateAll() {
    this.allGen++;
    this.entries.clear();
    this.inflight.clear();
  }

  stats() { return { hits: this.hits, misses: this.misses, size: this.entries.size }; }
}
