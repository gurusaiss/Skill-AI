/**
 * LLMQueue — promise semaphore for outbound LLM API calls.
 *
 * Caps concurrent HTTP requests to Groq/Gemini at MAX_CONCURRENT (default 3).
 * Excess calls queue and run as slots free — no drops, no queue-level timeouts.
 * Each individual fetch still has its own AbortSignal timeout.
 *
 * Override with env: LLM_MAX_CONCURRENT=5
 */

const MAX_CONCURRENT = parseInt(process.env.LLM_MAX_CONCURRENT || '3', 10);

class LLMQueue {
  constructor(maxConcurrent = MAX_CONCURRENT) {
    this.max = maxConcurrent;
    this.active = 0;
    this.queued = 0;
    this.completed = 0;
    this.totalWaitMs = 0;
    this._queue = [];
  }

  run(fn) {
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
        if (this.queued % 10 === 0) {
          console.warn(`[LLMQueue] ⚠️  ${this.queued} calls waiting — consider scaling LLM_MAX_CONCURRENT`);
        }
        this._queue.push(execute);
      }
    });
  }

  getStats() {
    return {
      active: this.active,
      queued: this.queued,
      completed: this.completed,
      max: this.max,
      avgWaitMs: this.completed > 0 ? Math.round(this.totalWaitMs / this.completed) : 0,
    };
  }
}

export default new LLMQueue();
