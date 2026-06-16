/**
 * LLMCache.js — In-memory TTL cache for LLM responses
 *
 * Shared singleton used by all agents to avoid redundant API calls.
 * Keys are namespaced per agent; values are cached with an expiry timestamp.
 * A background sweep clears expired entries every 10 minutes.
 *
 * Usage:
 *   import LLMCache from '../services/LLMCache.js';
 *   const key = `market_${LLMCache.hash(domain)}`;
 *   const cached = LLMCache.get(key);
 *   if (cached) return cached;
 *   const result = await callLLM(...);
 *   LLMCache.set(key, result, LLMCache.TTL.DOMAIN);
 */

// ── TTL constants (milliseconds) ───────────────────────────────────────────────
export const TTL = {
  TUTOR_MSG   :  2 * 60 * 1000,        //  2 min  — dedup identical rapid-fire chat messages
  EVAL        : 30 * 60 * 1000,        // 30 min  — same challenge + same response
  CHALLENGE   :  4 * 60 * 60 * 1000,   //  4 h    — ChallengeEngine per plan day
  QUIZ        : 12 * 60 * 60 * 1000,   // 12 h    — QuizGenerator per domain+skills
  MARKET      : 24 * 60 * 60 * 1000,   // 24 h    — MarketAgent per domain
  INTERVIEW   : 24 * 60 * 60 * 1000,   // 24 h    — InterviewAgent questions per role+skills
  SKILL_DECOMP:  7 * 24 * 60 * 60 * 1000, // 7 d  — SkillDecomposer per goal text
};

// ── Max cache entries (prevents unbounded memory growth) ─────────────────────
const MAX_ENTRIES = 500;

class LLMCache {
  constructor() {
    this.store  = new Map();
    this.hits   = 0;
    this.misses = 0;

    // Sweep expired entries every 10 minutes
    setInterval(() => this._cleanup(), 10 * 60 * 1000).unref?.();
  }

  /**
   * Retrieve a cached value. Returns null on miss or expiry.
   */
  get(key) {
    const entry = this.store.get(key);
    if (!entry) {
      this.misses++;
      return null;
    }
    if (Date.now() > entry.expiresAt) {
      this.store.delete(key);
      this.misses++;
      return null;
    }
    this.hits++;
    console.log(`[LLMCache] ✅ HIT  ${key.slice(0, 70)}`);
    return entry.value;
  }

  /**
   * Store a value with a TTL.
   * If the cache is full, the oldest 10% of entries are evicted first.
   */
  set(key, value, ttlMs) {
    if (this.store.size >= MAX_ENTRIES) this._evictOldest();
    this.store.set(key, { value, expiresAt: Date.now() + ttlMs });
  }

  /**
   * Deterministic integer hash → base-36 string.
   * Safe for use as part of a Map key.
   */
  static hash(str) {
    let h = 5381;
    for (let i = 0; i < str.length; i++) {
      h = ((h << 5) + h) + str.charCodeAt(i);
      h = h & h; // force 32-bit int
    }
    return Math.abs(h).toString(36);
  }

  // ── Internals ──────────────────────────────────────────────────────────────

  _cleanup() {
    const now = Date.now();
    let removed = 0;
    for (const [key, entry] of this.store) {
      if (now > entry.expiresAt) {
        this.store.delete(key);
        removed++;
      }
    }
    if (removed > 0) {
      console.log(`[LLMCache] 🧹 Swept ${removed} expired entries — ${this.store.size} remain`);
    }
  }

  _evictOldest() {
    const evictCount = Math.max(1, Math.floor(MAX_ENTRIES * 0.1));
    let n = 0;
    for (const key of this.store.keys()) {
      if (n >= evictCount) break;
      this.store.delete(key);
      n++;
    }
    console.log(`[LLMCache] ♻️  Evicted ${n} oldest entries (cache full)`);
  }

  /** Manually remove a key (e.g. after a user action that invalidates it). */
  delete(key) {
    return this.store.delete(key);
  }

  /** Stats for /api/health endpoint */
  getStats() {
    const total = this.hits + this.misses;
    return {
      size    : this.store.size,
      hits    : this.hits,
      misses  : this.misses,
      hitRate : total > 0 ? `${Math.round((this.hits / total) * 100)}%` : '0%',
    };
  }
}

const instance = new LLMCache();

// Re-export TTL constants on the instance for convenience
instance.TTL = TTL;
// Re-export static hash so callers using `LLMCache.hash(...)` work
instance.hash = LLMCache.hash.bind(LLMCache);

export default instance;
