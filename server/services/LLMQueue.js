/**
 * LLMQueue — promise semaphore + rolling-window rate limiter for outbound LLM calls.
 *
 * Two independent gates:
 *   1. Concurrency: at most MAX_CONCURRENT calls in flight at once (semaphore).
 *   2. Rate (TPM): at most GROQ_TPM_LIMIT tokens *requested* per rolling 60s
 *      window. This models Groq's free/on-demand per-minute token budget
 *      (observed: 12,000 TPM for openai/gpt-oss-120b (Groq)), where a request's
 *      cost counts prompt tokens + requested max_tokens. Without this gate,
 *      a large question-bank generation fires 20-60 sequential calls back to
 *      back the instant a concurrency slot frees, blowing the per-minute
 *      budget after ~2 calls and getting the rest rejected with HTTP 413 —
 *      which silently degraded generation to the deterministic template
 *      fallback. Callers pass an estimated token cost; calls that would
 *      exceed the window WAIT (they are not rejected) until budget frees.
 *
 * The TPM gate runs BEFORE the concurrency gate on purpose: a call parked
 * waiting for token budget must NOT hold a concurrency slot, or a long
 * generation would starve interactive calls (tutor chat, etc.). Calls that
 * pass estTokens=0 (the default) skip the TPM gate entirely and behave
 * exactly as before — only opted-in callers (Groq generation) are paced.
 *
 * Each credential (e.g. every GROQ_API_KEY_n) can have its OWN TPM window: pass
 * opts.keyId to run(); calls on key B are never delayed by key A's full window.
 * (The semaphore default is 16 so a generation run can use the combined
 * capacity of several providers/keys; one slot is always left for interactive calls.)
 *
 * Override with env:
 *   LLM_MAX_CONCURRENT=16  LLM_MAX_QUEUE=200  GROQ_TPM_LIMIT=11000
 */

const MAX_CONCURRENT  = parseInt(process.env.LLM_MAX_CONCURRENT || '16', 10);
const MAX_QUEUE_DEPTH = parseInt(process.env.LLM_MAX_QUEUE      || '200', 10);
// Groq's REAL free/on-demand per-minute token budget, read from live
// x-ratelimit-limit-tokens response headers: 8,000 TPM for both
// openai/gpt-oss-120b and openai/gpt-oss-20b (and the bucket appears to be
// shared across models on this tier, so falling back to the smaller model
// does NOT buy a fresh budget). The previous default here was 11,000 —
// ABOVE the real ceiling — so the limiter permitted spending Groq would
// reject, and calls still failed with 429/413 despite "pacing" them.
// 7,000 leaves headroom for token-estimate error (we estimate ~4 chars/token;
// the API counts real tokenization).
const GROQ_TPM_LIMIT  = parseInt(process.env.GROQ_TPM_LIMIT     || '7000', 10);
const TPM_WINDOW_MS   = 60000;

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

/**
 * One rolling-60s token window for ONE credential. Every Groq API key has its
 * own per-minute budget, so each key gets its own TpmWindow (keyed by a
 * non-secret label such as "groq#2"); the default window (no key) is the one
 * the legacy single-key callers use.
 */
export class TpmWindow {
  constructor(limit = GROQ_TPM_LIMIT) {
    this.limit = limit;
    this.window = [];            // [{ t: epochMs, tokens }]
    this.gate = Promise.resolve();
    this.pending = 0;            // tokens reserved by callers still waiting at the gate
    this.throttledMs = 0;
  }

  prune() {
    const cutoff = Date.now() - TPM_WINDOW_MS;
    while (this.window.length > 0 && this.window[0].t <= cutoff) this.window.shift();
  }

  tokens() {
    let sum = 0;
    for (const e of this.window) sum += e.tokens;
    return sum;
  }

  /** Tokens still free in the current window (ignoring queued reservations). */
  freeTokens() {
    this.prune();
    return Math.max(0, this.limit - this.tokens() - this.pending);
  }

  // Serialized token reservation: chained on `gate`, so only ONE caller
  // evaluates the budget-and-record section at a time (no double-spend).
  async reserve(estTokens, onThrottle, opts = {}) {
    const prev = this.gate;
    let release;
    this.gate = new Promise(r => { release = r; });
    this.pending += Math.min(estTokens, this.limit);
    const maxWaitMs = Number.isFinite(opts.maxWaitMs) ? opts.maxWaitMs : Infinity;
    const startedAt = Date.now();
    await prev;
    this.pending = Math.max(0, this.pending - Math.min(estTokens, this.limit));

    try {
      // A single call larger than the whole window budget can never fit by
      // waiting — let it through once the window is otherwise empty.
      const capped = Math.min(estTokens, this.limit);
      let notified = false;
      for (;;) {
        this.prune();
        const used = this.tokens();
        if (used + capped <= this.limit || this.window.length === 0) break;
        const oldest = this.window[0];
        const waitMs = Math.max(50, (oldest.t + TPM_WINDOW_MS) - Date.now());
        // Time-budgeted callers would rather skip this call than park past their deadline.
        if ((Date.now() - startedAt) + waitMs > maxWaitMs) {
          const err = new Error(`TPM budget wait (${Math.round(waitMs / 1000)}s) would exceed the caller's time budget`);
          err.code = 'TPM_WAIT_EXCEEDED';
          throw err;
        }
        if (!notified && typeof onThrottle === 'function') {
          notified = true;
          try { onThrottle(waitMs); } catch { /* progress hook must never break generation */ }
        }
        this.throttledMs += waitMs;
        await sleep(waitMs);
      }
      this.window.push({ t: Date.now(), tokens: capped });
      if (notified && typeof opts.onResume === 'function') { try { opts.onResume(); } catch { /* never break generation */ } }
      return notified;
    } finally {
      release();
    }
  }

  /** Approximate ms a call costing `estTokens` would wait for budget now (0 = immediately). */
  estimateWaitMs(estTokens) {
    this.prune();
    const capped = Math.min(estTokens, this.limit);
    const need = this.tokens() + this.pending + capped - this.limit;
    if (need <= 0 || this.window.length === 0) return 0;
    let freed = 0;
    for (const e of this.window) {
      freed += e.tokens;
      if (freed >= need) return Math.max(0, e.t + TPM_WINDOW_MS - Date.now());
    }
    const last = this.window[this.window.length - 1];
    return Math.max(0, last.t + TPM_WINDOW_MS - Date.now()) + (this.pending > 0 ? TPM_WINDOW_MS : 0);
  }
}

const DEFAULT_WINDOW = '__default__';

class LLMQueue {
  constructor(maxConcurrent = MAX_CONCURRENT, maxQueue = MAX_QUEUE_DEPTH, tpmLimit = GROQ_TPM_LIMIT) {
    this.max       = maxConcurrent;
    this.maxQueue  = maxQueue;
    this.tpmLimit  = tpmLimit;
    this.active    = 0;
    this.queued    = 0;
    this.completed = 0;
    this.rejected  = 0;
    this.totalWaitMs = 0;
    this._queue    = [];
    this._windows  = new Map();   // credential label -> TpmWindow (default window = legacy callers)
    this._windows.set(DEFAULT_WINDOW, new TpmWindow(tpmLimit));
  }

  /** The token window for a credential label (created on first use). No label = the shared default window. */
  window(keyId) {
    const id = keyId || DEFAULT_WINDOW;
    let w = this._windows.get(id);
    if (!w) { w = new TpmWindow(this.tpmLimit); this._windows.set(id, w); }
    return w;
  }

  get throttledMs() { let t = 0; for (const w of this._windows.values()) t += w.throttledMs; return t; }

  /** Approximate wait (ms) for a call of `estTokens` on this credential's window. */
  estimateWaitMs(estTokens, keyId) { return this.window(keyId).estimateWaitMs(estTokens); }

  /** Free tokens left in this credential's current window. */
  freeTokens(keyId) { return this.window(keyId).freeTokens(); }

  /**
   * @param {Function} fn         async thunk performing the actual HTTP call
   * @param {number}   estTokens  estimated token cost (prompt + max_tokens);
   *                              0 (default) skips the TPM gate entirely
   * @param {Function} onThrottle optional (delayMs)=>void, called once if this
   *                              call has to wait for token budget
   * @param {object}   opts       { maxWaitMs } reject with code TPM_WAIT_EXCEEDED instead
   *                              of waiting longer than this for token budget;
   *                              { onResume } called when a throttled call is released;
   *                              { keyId } non-secret credential label whose own TPM window is charged
   *                              (omit = the shared default window)
   */
  run(fn, estTokens = 0, onThrottle = null, opts = {}) {
    // Shed load when queue is full — callers must handle and use fallback.
    // Checked up front (synchronously) so behavior matches the old contract.
    if (this.queued >= this.maxQueue) {
      this.rejected++;
      const err = new Error('LLM queue full — using fallback');
      err.code  = 'LLM_QUEUE_FULL';
      return Promise.reject(err);
    }

    const gate = estTokens > 0 ? this.window(opts.keyId).reserve(estTokens, onThrottle, opts) : Promise.resolve();
    return gate.then(() => this._runConcurrencyGated(fn));
  }

  _runConcurrencyGated(fn) {
    return new Promise((resolve, reject) => {
      const enqueueTime = Date.now();

      const execute = async () => {
        this.active++;
        this.queued = Math.max(0, this.queued - 1);
        this.totalWaitMs += Date.now() - enqueueTime;
        try {
          resolve(await fn());
          this.completed++;
        } catch (err) {
          reject(err);
        } finally {
          this.active--;
          if (this._queue.length > 0) {
            this._queue.shift()();
          }
        }
      };

      if (this.active < this.max) {
        execute();
      } else {
        this.queued++;
        if (this.queued % 20 === 0) {
          console.warn(`[LLMQueue] ⚠️  ${this.queued}/${this.maxQueue} calls queued (${this.active} active)`);
        }
        this._queue.push(execute);
      }
    });
  }

  getStats() {
    const d = this.window();
    d.prune();
    return {
      active:       this.active,
      queued:       this.queued,
      completed:    this.completed,
      rejected:     this.rejected,
      max:          this.max,
      maxQueue:     this.maxQueue,
      tpmLimit:     this.tpmLimit,
      windowTokens: d.tokens(),
      throttledMs:  this.throttledMs,
      tpmWindows:   this._windows.size,
      avgWaitMs:    this.completed > 0 ? Math.round(this.totalWaitMs / this.completed) : 0,
    };
  }
}

export default new LLMQueue();

export { LLMQueue };
