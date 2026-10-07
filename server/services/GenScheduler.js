/**
 * GenScheduler.js — scheduling primitives for the question-generation pipeline:
 *
 *   PriorityQueue   binary max-heap (highest priority first, FIFO among equals)
 *   TimeBudget      wall-clock budget with an injectable clock
 *   TaskPool        bounded-concurrency pool fed from a priority queue; tasks may
 *                   enqueue follow-up tasks; stops at the time budget and
 *                   abandons (does not wait for) whatever is still in flight
 *   mapPool         order-preserving bounded-concurrency map
 *
 * Pure JS, no I/O — fully unit-testable with a fake clock / fake tasks.
 */

export class PriorityQueue {
  constructor() { this._h = []; this._seq = 0; }
  get size() { return this._h.length; }
  _less(a, b) { return a.p > b.p || (a.p === b.p && a.s < b.s); } // true if a should pop before b
  push(item, priority = 0) {
    const h = this._h; h.push({ item, p: priority, s: this._seq++ });
    let i = h.length - 1;
    while (i > 0) { const par = (i - 1) >> 1; if (this._less(h[i], h[par])) { [h[i], h[par]] = [h[par], h[i]]; i = par; } else break; }
  }
  peek() { return this._h.length ? this._h[0].item : undefined; }
  pop() {
    const h = this._h; if (!h.length) return undefined;
    const top = h[0]; const last = h.pop();
    if (h.length) {
      h[0] = last; let i = 0;
      for (;;) {
        const l = 2 * i + 1, r = l + 1; let m = i;
        if (l < h.length && this._less(h[l], h[m])) m = l;
        if (r < h.length && this._less(h[r], h[m])) m = r;
        if (m === i) break;
        [h[i], h[m]] = [h[m], h[i]]; i = m;
      }
    }
    return top.item;
  }
  /** Removes (and returns) every queued item matching the predicate. */
  removeWhere(pred) {
    const keep = []; const gone = [];
    for (const e of this._h) (pred(e.item) ? gone : keep).push(e);
    this._h = []; this._seq = 0;
    keep.sort((a, b) => (a.p === b.p ? a.s - b.s : b.p - a.p)).forEach(e => this.push(e.item, e.p));
    return gone.map(e => e.item);
  }
}

export class TimeBudget {
  constructor(totalMs, now = () => Date.now()) {
    this.now = now; this.totalMs = totalMs; this.startedAt = now();
    this.deadlineAt = this.startedAt + totalMs;
  }
  get elapsedMs() { return this.now() - this.startedAt; }
  get remainingMs() { return Math.max(0, this.deadlineAt - this.now()); }
  get expired() { return this.now() >= this.deadlineAt; }
  /** true when at least `ms` remain */
  hasRoom(ms) { return this.remainingMs >= ms; }
  fractionUsed() { return this.totalMs > 0 ? Math.min(1, this.elapsedMs / this.totalMs) : 1; }
}

/**
 * Bounded-concurrency pool over a priority queue.
 *   run(task)         async worker; its resolved value goes to onDone
 *   shouldSkip(task)  checked right before a task starts (e.g. its source already hit its target)
 *   onDone(task, result, error)  called for every finished task; may call pool.add(...)
 *   concurrency       number or () => number (re-evaluated whenever a slot frees)
 * drain() resolves when the queue is empty and nothing is in flight, or when
 * the budget expires — in which case still-running tasks are abandoned (their
 * results are ignored) and `drain()` reports { expired: true, abandoned }.
 */
export class TaskPool {
  constructor({ run, shouldSkip = () => false, onSkip = () => {}, onDone = () => {}, concurrency = 4, budget = null, setTimer = setTimeout, clearTimer = clearTimeout } = {}) {
    this.run = run; this.shouldSkip = shouldSkip; this.onSkip = onSkip; this.onDone = onDone; this._paused = true; // tasks queued before drain() are ordered globally by priority before any starts
    this.concurrency = concurrency; this.budget = budget;
    this.q = new PriorityQueue(); this.inflight = new Set(); this.stats = { started: 0, finished: 0, skipped: 0, abandoned: 0, errors: 0, maxInflight: 0 };
    this._setTimer = setTimer; this._clearTimer = clearTimer; this._closed = false; this._idleResolve = null; this._timer = null;
  }
  get limit() { return Math.max(1, Math.floor(typeof this.concurrency === 'function' ? this.concurrency() : this.concurrency)); }
  add(task, priority = 0) { if (!this._closed) { this.q.push(task, priority); if (!this._paused) this._pump(); } }
  _pump() {
    while (!this._closed && !this._paused && this.inflight.size < this.limit && this.q.size > 0) {
      if (this.budget && this.budget.expired) break;
      const task = this.q.pop();
      if (this.shouldSkip(task)) { this.stats.skipped++; try { this.onSkip(task); } catch { /* hook errors never break the pool */ } continue; }
      this.stats.started++;
      const entry = { task };
      this.inflight.add(entry);
      this.stats.maxInflight = Math.max(this.stats.maxInflight, this.inflight.size);
      Promise.resolve().then(() => this.run(task)).then(
        (res) => this._finish(entry, res, null),
        (err) => this._finish(entry, undefined, err || new Error('task failed')),
      );
    }
    this._checkIdle();
  }
  _finish(entry, res, err) {
    if (!this.inflight.has(entry)) return; // abandoned after the deadline
    this.inflight.delete(entry);
    this.stats.finished++; if (err) this.stats.errors++;
    try { this.onDone(entry.task, res, err); } catch { /* a hook must never break the pool */ }
    this._pump();
  }
  _checkIdle() {
    if (this._idleResolve && this.inflight.size === 0 && (this.q.size === 0 || (this.budget && this.budget.expired))) {
      const r = this._idleResolve; this._idleResolve = null; r({ expired: !!(this.budget && this.budget.expired), abandoned: 0, ...this.stats });
    }
  }
  drain() {
    return new Promise((resolve) => {
      let settled = false;
      const finish = (v) => { if (settled) return; settled = true; this._closed = true; if (this._timer) this._clearTimer(this._timer); resolve(v); };
      this._idleResolve = (v) => finish(v);
      if (this.budget) {
        const ms = this.budget.remainingMs;
        this._timer = this._setTimer(() => {
          const abandoned = this.inflight.size;
          this.stats.abandoned += abandoned; this.inflight.clear();
          finish({ expired: true, abandoned, queued: this.q.size, ...this.stats });
        }, ms);
        this._timer?.unref?.();
      }
      this._paused = false;
      this._pump();
      this._checkIdle();
    });
  }
}

/** Order-preserving bounded-concurrency map: results[i] = await fn(items[i], i). Errors become {error}. */
export async function mapPool(items, limit, fn) {
  const results = new Array(items.length);
  let next = 0;
  const worker = async () => {
    for (;;) {
      const i = next++; if (i >= items.length) return;
      try { results[i] = await fn(items[i], i); } catch (error) { results[i] = { error }; }
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, worker));
  return results;
}
