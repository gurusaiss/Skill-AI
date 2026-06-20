/**
 * LLMQueue — promise semaphore for outbound LLM API calls.
 *
 * Caps concurrent HTTP requests to Groq/Gemini at MAX_CONCURRENT (default 5).
 * Excess calls queue and run as slots free.
 * MAX_QUEUE_DEPTH prevents unbounded memory accumulation — requests beyond
 * the limit are rejected immediately with a 503-style error so callers can
 * fall back to rule-based responses instead of hanging forever.
 *
 * Override with env: LLM_MAX_CONCURRENT=5  LLM_MAX_QUEUE=200
 */

const MAX_CONCURRENT  = parseInt(process.env.LLM_MAX_CONCURRENT || '5', 10);
const MAX_QUEUE_DEPTH = parseInt(process.env.LLM_MAX_QUEUE      || '200', 10);

class LLMQueue {
  constructor(maxConcurrent = MAX_CONCURRENT, maxQueue = MAX_QUEUE_DEPTH) {
    this.max       = maxConcurrent;
    this.maxQueue  = maxQueue;
    this.active    = 0;
    this.queued    = 0;
    this.completed = 0;
    this.rejected  = 0;
    this.totalWaitMs = 0;
    this._queue    = [];
  }

  run(fn) {
    return new Promise((resolve, reject) => {
      // Shed load when queue is full — callers must handle and use fallback
      if (this.queued >= this.maxQueue) {
        this.rejected++;
        const err = new Error('LLM queue full — using fallback');
        err.code  = 'LLM_QUEUE_FULL';
        return reject(err);
      }

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
    return {
      active:     this.active,
      queued:     this.queued,
      completed:  this.completed,
      rejected:   this.rejected,
      max:        this.max,
      maxQueue:   this.maxQueue,
      avgWaitMs:  this.completed > 0 ? Math.round(this.totalWaitMs / this.completed) : 0,
    };
  }
}

export default new LLMQueue();
