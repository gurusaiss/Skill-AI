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
 * Override with env:
 *   LLM_MAX_CONCURRENT=5  LLM_MAX_QUEUE=200  GROQ_TPM_LIMIT=11000
 */

const MAX_CONCURRENT  = parseInt(process.env.LLM_MAX_CONCURRENT || '5', 10);
const MAX_QUEUE_DEPTH = parseInt(process.env.LLM_MAX_QUEUE      || '200', 10);
// Slightly under Groq's real 12,000 TPM cap to leave headroom for estimate
// error (we estimate tokens; the API counts the real tokenization).
const GROQ_TPM_LIMIT  = parseInt(process.env.GROQ_TPM_LIMIT     || '11000', 10);
const TPM_WINDOW_MS   = 60000;

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

class LLMQueue {
  constructor(maxConcurrent = MAX_CONCURRENT, maxQueue = MAX_QUEUE_DEPTH, tpmLimit = GROQ_TPM_LIMIT) {
    this.max       = maxConcurrent;
    this.maxQueue  = maxQueue;
    this.tpmLimit  = tpmLimit;
    this.active    = 0;
    this.queued    = 0;
    this.completed = 0;
    this.rejected  = 0;
    this.throttledMs = 0;      // cumulative time spent waiting on the TPM gate
    this.totalWaitMs = 0;
    this._queue    = [];
    this._tpmWindow = [];      // [{ t: epochMs, tokens }] for calls in the last 60s
    this._tpmGate   = Promise.resolve(); // serializes token reservations
  }

  _pruneWindow() {
    const cutoff = Date.now() - TPM_WINDOW_MS;
    while (this._tpmWindow.length > 0 && this._tpmWindow[0].t <= cutoff) {
      this._tpmWindow.shift();
    }
  }

  _windowTokens() {
    let sum = 0;
    for (const e of this._tpmWindow) sum += e.tokens;
    return sum;
  }

  // Serialized token reservation. Because Node is single-threaded and this
  // chains every reservation onto _tpmGate, only ONE caller evaluates the
  // budget-and-record critical section at a time — so two concurrent callers
  // can't both see "budget available" and double-spend the window.
  async _reserveTokens(estTokens, onThrottle) {
    const prev = this._tpmGate;
    let release;
    this._tpmGate = new Promise(r => { release = r; });
    await prev; // wait for the previous reservation to finish

    try {
      // A single call larger than the whole window budget can never fit by
      // waiting — let it through once the window is otherwise empty rather
      // than deadlock. (Shouldn't happen given per-call sizing, but safe.)
      const capped = Math.min(estTokens, this.tpmLimit);
      let notified = false;
      for (;;) {
        this._pruneWindow();
        const used = this._windowTokens();
        if (used + capped <= this.tpmLimit || this._tpmWindow.length === 0) break;
        const oldest = this._tpmWindow[0];
        const waitMs = Math.max(50, (oldest.t + TPM_WINDOW_MS) - Date.now());
        if (!notified && typeof onThrottle === 'function') {
          notified = true;
          try { onThrottle(waitMs); } catch { /* progress hook must never break generation */ }
        }
        this.throttledMs += waitMs;
        await sleep(waitMs);
      }
      this._tpmWindow.push({ t: Date.now(), tokens: capped });
    } finally {
      release();
    }
  }

  /**
   * @param {Function} fn         async thunk performing the actual HTTP call
   * @param {number}   estTokens  estimated token cost (prompt + max_tokens);
   *                              0 (default) skips the TPM gate entirely
   * @param {Function} onThrottle optional (delayMs)=>void, called once if this
   *                              call has to wait for token budget
   */
  run(fn, estTokens = 0, onThrottle = null) {
    // Shed load when queue is full — callers must handle and use fallback.
    // Checked up front (synchronously) so behavior matches the old contract.
    if (this.queued >= this.maxQueue) {
      this.rejected++;
      const err = new Error('LLM queue full — using fallback');
      err.code  = 'LLM_QUEUE_FULL';
      return Promise.reject(err);
    }

    const gate = estTokens > 0 ? this._reserveTokens(estTokens, onThrottle) : Promise.resolve();
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
    this._pruneWindow();
    return {
      active:       this.active,
      queued:       this.queued,
      completed:    this.completed,
      rejected:     this.rejected,
      max:          this.max,
      maxQueue:     this.maxQueue,
      tpmLimit:     this.tpmLimit,
      windowTokens: this._windowTokens(),
      throttledMs:  this.throttledMs,
      avgWaitMs:    this.completed > 0 ? Math.round(this.totalWaitMs / this.completed) : 0,
    };
  }
}

export default new LLMQueue();
