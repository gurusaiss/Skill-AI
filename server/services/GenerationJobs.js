/**
 * GenerationJobs — in-process registry for long-running question-bank generation.
 *
 * WHY THIS EXISTS
 * Generating a full question bank on Groq's free tier takes MINUTES, not
 * seconds: the real per-minute token budget is ~8,000 TPM, while a 50-question
 * bank needs ~30,000+ tokens across several sequential LLM calls. Every
 * timeout in the stack is far shorter than that (client fetch aborts at 30s
 * and RETRIES, server res.setTimeout fires at 90s, the old UI poll gave up at
 * 60s), so a synchronous generate/regenerate request could never succeed —
 * and each client retry started ANOTHER competing generation, starving the
 * same token budget further. The visible symptom was "no questions generated,
 * keeps asking me to Regenerate All," with an occasional apparently-random
 * success when an abandoned background run finally finished and saved.
 *
 * This registry makes generation a tracked background job instead:
 *   - start()      registers a job and marks the role as generating
 *   - get()        lets a status endpoint report progress without re-running
 *   - finish/fail  record the terminal state
 * The route layer returns immediately with a job handle; the client polls
 * status (no 30s abort) until the job reports done. Crucially, start() is
 * IDEMPOTENT per role: a second request while a job is already running joins
 * the existing job instead of launching a duplicate, which is what previously
 * multiplied the rate-limit pressure.
 *
 * Deliberately in-memory (no new dependency, no schema change): a job is
 * ephemeral progress metadata, and the AUTHORITATIVE result is always the
 * persisted question_bank_versions row. If the process restarts mid-job the
 * client's poll falls back to reading the saved bank, so nothing is lost —
 * only the live progress readout resets.
 */

const JOB_TTL_MS = 30 * 60 * 1000; // keep finished jobs briefly so a slow poll still sees the result

class GenerationJobs {
  constructor() {
    this._jobs = new Map(); // roleId -> job
  }

  _prune() {
    const now = Date.now();
    for (const [roleId, job] of this._jobs) {
      if (job.status !== 'running' && now - (job.finishedAt || job.startedAt) > JOB_TTL_MS) {
        this._jobs.delete(roleId);
      }
    }
  }

  isRunning(roleId) {
    const job = this._jobs.get(roleId);
    return !!job && job.status === 'running';
  }

  /**
   * Register a new job for this role, unless one is already running.
   * @returns {{job: object, created: boolean}} created=false means an existing
   *          run was joined — the caller must NOT start a second generation.
   */
  start(roleId, { total = 0, source = 'unknown' } = {}) {
    this._prune();
    const existing = this._jobs.get(roleId);
    if (existing && existing.status === 'running') {
      return { job: existing, created: false };
    }
    const job = {
      roleId,
      jobId: `gen_${roleId}_${Date.now()}`,
      status: 'running',
      source,
      done: 0,
      total,
      phase: 'starting',
      throttleMs: 0,
      startedAt: Date.now(),
      finishedAt: null,
      error: null,
      versionId: null,
      count: null,
    };
    this._jobs.set(roleId, job);
    return { job, created: true };
  }

  // Progress hook shaped for AssessmentGenerator's onProgress({phase,done,total,delayMs}).
  progress(roleId, evt = {}) {
    const job = this._jobs.get(roleId);
    if (!job || job.status !== 'running') return;
    if (typeof evt.done === 'number') job.done = evt.done;
    if (typeof evt.total === 'number' && evt.total > 0) job.total = evt.total;
    if (evt.phase) job.phase = evt.phase;
    if (typeof evt.delayMs === 'number') job.throttleMs = evt.delayMs;
  }

  finish(roleId, { versionId = null, count = null, diagnostics = null } = {}) {
    const job = this._jobs.get(roleId);
    if (!job) return;
    job.status = 'done';
    job.phase = 'done';
    job.finishedAt = Date.now();
    job.versionId = versionId;
    job.count = count;
    // Source/grounding breakdown for the finished run, so the UI can explain
    // WHY a bank came out generic instead of just reporting "done".
    job.diagnostics = diagnostics;
    if (count != null) job.done = count;
  }

  fail(roleId, error) {
    const job = this._jobs.get(roleId);
    if (!job) return;
    job.status = 'failed';
    job.phase = 'failed';
    job.finishedAt = Date.now();
    job.error = (error && error.message) || String(error || 'Generation failed');
  }

  get(roleId) {
    this._prune();
    return this._jobs.get(roleId) || null;
  }

  getStats() {
    this._prune();
    let running = 0;
    for (const job of this._jobs.values()) if (job.status === 'running') running++;
    return { tracked: this._jobs.size, running };
  }
}

export default new GenerationJobs();
