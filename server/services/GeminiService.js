/**
 * GeminiService.js — Gemini (multi-key rotation) → Cerebras → OpenRouter → Groq fallback chain
 *
 * Question-bank generation (generateQuestionsBatch) tries, in order:
 *   1. Gemini Flash-family models, rotating across every (GEMINI_API_KEY[_N],
 *      model) pair. Free tier caps each KEY at ~20 requests/day PER MODEL — so
 *      the unit of quota is the (key, model) "slot": more keys (separate Google
 *      projects) AND more models both multiply the daily ceiling for free.
 *   2. Cerebras (OpenAI-compatible) — as of Aug 2026 this now requires a
 *      payment method to unlock even its free credits (a policy change made
 *      after this integration was first written), so in practice this step
 *      is a no-op for anyone unwilling to add a card. Left in place in case
 *      that ever changes back or someone opts in deliberately; effectively
 *      dead weight otherwise, which is exactly why OpenRouter was added
 *      below it.
 *   3. OpenRouter (OpenAI-compatible), free models only (id ends `:free` or
 *      priced at $0) — genuinely no credit card required. Its own quota
 *      bucket, independent of both Gemini's and Groq's, so it adds real
 *      extra daily headroom rather than competing for the same limit.
 *   4. Groq openai/gpt-oss-120b, then openai/gpt-oss-20b — effectively
 *      unlimited requests but only ~8,000 tokens/MINUTE, so it's the slowest
 *      path and stays last.
 *
 * All methods return null on failure — callers fall back to rule-based logic.
 */

import LLMCache from './LLMCache.js';
import LLMQueue from './LLMQueue.js';

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// Rough token estimate for TPM pacing: ~4 chars/token for English text, plus
// the requested output cap (Groq counts prompt + max_tokens toward the
// per-minute budget). Intentionally an over-estimate-friendly heuristic — the
// LLMQueue window leaves headroom under the real cap for estimate error.
function estimateGroqTokens(prompt, system, maxTokens) {
  return Math.ceil(((system || '').length + (prompt || '').length) / 4) + (maxTokens || 0);
}

// Extract how long Groq wants us to wait from a 429/413 rate-limit response —
// prefers the standard Retry-After header, falls back to parsing the
// "Please retry in 41.14s" phrasing Groq puts in the error body, then a
// conservative default.
function parseRetryMs(res, bodyText) {
  const header = res.headers?.get?.('retry-after');
  if (header) {
    const secs = parseFloat(header);
    if (!isNaN(secs)) return Math.min(90000, Math.max(1000, Math.ceil(secs * 1000)));
  }
  const m = /retry in ([\d.]+)\s*s/i.exec(bodyText || '');
  if (m) return Math.min(90000, Math.max(1000, Math.ceil(parseFloat(m[1]) * 1000)));
  return 5000;
}

// Combines a per-call timeout with an optional caller-supplied AbortSignal (the
// question-generation time budget aborts abandoned in-flight calls with it).
function mkSignal(timeoutMs, signal) {
  const t = AbortSignal.timeout(timeoutMs);
  if (!signal) return t;
  return typeof AbortSignal.any === 'function' ? AbortSignal.any([t, signal]) : t;
}

// Strict JSON.parse of a model reply, with optional salvage of a TRUNCATED
// `{"questions":[ {...}, {...}, {"ty` reply: every COMPLETE question object is
// recovered instead of discarding the whole batch. That is what lets callers
// size max_tokens tightly (the Groq TPM budget is spent on max_tokens) without
// losing a call to a cut-off tail.
function parseLoose(text, { salvage = false } = {}) {
  const clean = String(text || '').replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/```\s*$/i, '').trim();
  try { return JSON.parse(clean); } catch (err) { if (!salvage) throw err; }
  const at = clean.indexOf('"questions"');
  const open = at >= 0 ? clean.indexOf('[', at) : -1;
  if (open < 0) throw new Error('unparseable JSON and no questions array to salvage');
  const out = [];
  let depth = 0, inStr = false, esc = false, start = -1;
  for (let i = open + 1; i < clean.length; i++) {
    const ch = clean[i];
    if (inStr) { if (esc) esc = false; else if (ch === '\\') esc = true; else if (ch === '"') inStr = false; continue; }
    if (ch === '"') { inStr = true; continue; }
    if (ch === '{') { if (depth === 0) start = i; depth++; }
    else if (ch === '}') {
      depth--;
      if (depth === 0 && start >= 0) { try { out.push(JSON.parse(clean.slice(start, i + 1))); } catch { /* skip a malformed object */ } start = -1; }
    } else if (ch === ']' && depth === 0) break;
  }
  if (out.length === 0) throw new Error('truncated JSON with no complete question object');
  return { questions: out, _salvaged: true };
}

// Gemini model names Google has retired. A request to any of these fails with
// HTTP 404 ("no longer available") — NOT with an auth or quota error, so it
// looks like a broken key rather than a stale model name. The deployed
// environment sets GEMINI_MODEL in a hosting dashboard (Render/Vercel), which
// would keep overriding the code default with a dead name long after this fix
// ships, so a configured-but-retired value is ignored in favour of the current
// default instead of being trusted blindly.
const RETIRED_GEMINI_MODELS = new Set([
  'gemini-2.0-flash',
  'gemini-2.0-flash-exp',
  'gemini-1.5-flash',
  'gemini-1.5-pro',
  'gemini-2.5-flash',
  'gemini-pro',
]);

// Highest N in GEMINI_API_KEY_N this app will look for. Arbitrary ceiling
// just to keep the env scan bounded — raise it if someone actually wires up
// more than this many free-tier projects.
const MAX_GEMINI_KEYS = 10;
const MAX_GROQ_KEYS = 6;          // GROQ_API_KEY, GROQ_API_KEY_2..6
const MAX_OPENROUTER_KEYS = 5;    // OPENROUTER_API_KEY, OPENROUTER_API_KEY_2..5
const MAX_GEMINI_MODELS = 4;
const MODEL_DISCOVERY_TTL_MS = 6 * 60 * 60 * 1000;
// Model names that are not suitable for plain JSON text generation.
const GEMINI_MODEL_EXCLUDE = /image|tts|audio|live|embed|thinking|exp\b|-exp|native|robotics|computer|vision|aqa|-latest$/i;

// Reads KEY, KEY_2..KEY_max from env (valid = longer than 10 chars), de-duplicated.
function envKeys(base, max) {
  const keys = [process.env[base]];
  for (let i = 2; i <= max; i++) keys.push(process.env[`${base}_${i}`]);
  return [...new Set(keys.filter(k => k && k.length > 10))];
}

class GeminiService {
  constructor() {
    this.model = 'gemini-3.6-flash';
    this.maxRetries = 3;
    this.callCount = 0;
    this.groqCallCount = 0;
    this.groqFastCallCount = 0;
    this._warnedRetired = false;
    // Per-KEY quota cooldown (Map<key, blockedUntilMs>) — Gemini's free-tier
    // request cap is per API key (really per Google Cloud project), not
    // shared across keys, so key A being exhausted must not block key B.
    // Gemini quota unit is the (key, model) SLOT: slotId -> blockedUntilMs.
    this._geminiKeyBlockedUntil = new Map();   // name kept for compatibility; holds SLOT cooldowns
    this._geminiSlotLastUsed = new Map();
    this._droppedModels = new Set();           // models that 404/400'd "not found/unsupported": dropped for the process lifetime
    this._noThinkingModels = new Set();        // models that rejected thinkingConfig
    this._modelDiscovery = null;               // { at, models, promise }
    this._orKeyBlockedUntil = new Map();       // OpenRouter per-key cooldown
    this._orKeyInflight = new Map();
    this._groqKeyBlockedUntil = new Map();     // Groq per-key cooldown
    // Counters used for the "where did the time go" line and the capacity report.
    this.counters = { rl429: { gemini: 0, openrouter: 0, groq: 0 }, waitMs: 0, calls: { gemini: 0, openrouter: 0, groq: 0 } };
    // SEPARATE cooldown map for the embedding model — text-embedding-004 is a
    // different model than the generation model (resolvedModel), so its
    // quota is a distinct bucket even on the same key/project. Sharing
    // _geminiKeyBlockedUntil would incorrectly let an embedding-quota hit
    // block real question generation on that key, or vice versa.
    this._geminiEmbedKeyBlockedUntil = new Map();
    this._cerebrasModelPromise = null;
    this._openRouterModelPromise = null;
    this.openRouterCallCount = 0;
    // Provider routing state for bulk generation (generateQuestionsBatchEx):
    //  - cooldowns: a provider that just rate-limited / rejected us is not
    //    called again until its cooldown ends (previously every call re-tried
    //    it, burning a request + a wait each time);
    //  - inflight: lets concurrent calls spread across providers (one on
    //    OpenRouter while others use Groq) instead of all queueing on one.
    this._providerBlockedUntil = new Map();
    this._inflight = { openrouter: 0, groq: 0 };
    this._geminiInflight = new Map();
    this.routeStats = { gemini: 0, openrouter: 0, groq: 0, failed: 0 };
  }

  // ── provider cooldowns ────────────────────────────────────────────────────
  coolDown(provider, ms, reason = '') {
    const until = Date.now() + Math.max(1000, ms);
    const prev = this._providerBlockedUntil.get(provider) || 0;
    if (until > prev) this._providerBlockedUntil.set(provider, until);
    console.warn(`[LLM] ${provider} cooling down ${Math.round(ms / 1000)}s${reason ? ` (${reason})` : ''}`);
  }
  isCoolingDown(provider) {
    const until = this._providerBlockedUntil.get(provider);
    return !!until && Date.now() < until;
  }

  /**
   * Snapshot of which generation providers can take a call RIGHT NOW. The
   * question pipeline uses it to size chunks/batches for the provider that will
   * really serve them (a configured-but-quota-exhausted Gemini key must not make
   * the pipeline size requests for Gemini and then send them to Groq) and to
   * pick a sensible default concurrency.
   */
  generationStatus() {
    const cap = this.slotCapacity();
    const geminiKeysUsable = this._geminiKeysUsable();
    const cerebrasOn = this.cerebrasEnabled && !this.isCoolingDown('cerebras');
    return {
      geminiKeysUsable,
      geminiSlotsUsable: cap.geminiSlots,
      openrouterKeysUsable: this._usableOpenRouterKeys().length,
      groqKeysUsable: this._usableGroqKeys().length,
      gemini: cap.geminiSlots > 0,
      openrouter: cap.openrouter > 0,
      groq: cap.groq > 0,
      cerebras: cerebrasOn,
      groqTpmLimit: LLMQueue.tpmLimit,
      anyLLM: cap.total > 0,
      slots: cap,
    };
  }

  /**
   * How many calls each provider can take AT THE SAME TIME right now (the
   * scheduler's concurrency is the sum, bounded by the caller):
   *   gemini     = usable (key, model) slots x GEMINI_SLOT_CONCURRENT (default 1)
   *   openrouter = usable keys x OPENROUTER_MAX_CONCURRENT (default 1 per key)
   *   groq       = usable keys x 2 (a key's per-minute token window fits about
   *                two requests; the limiter parks the rest without holding a slot)
   *   cerebras   = 1 when configured
   */
  slotCapacity() {
    const geminiSlots = this._geminiUsableSlots().length;
    const gemini = geminiSlots * this._geminiSlotConcurrency();
    const openrouter = this._usableOpenRouterKeys().length * this._openRouterPerKeyConcurrency();
    const groq = this._usableGroqKeys().length * 2;
    const cerebras = this.cerebrasEnabled && !this.isCoolingDown('cerebras') ? 1 : 0;
    return { geminiSlots, gemini, openrouter, groq, cerebras, total: gemini + openrouter + groq + cerebras };
  }

  _geminiSlotConcurrency() { return Math.max(1, parseInt(process.env.GEMINI_SLOT_CONCURRENT || '1', 10) || 1); }
  _openRouterPerKeyConcurrency() { return Math.max(1, parseInt(process.env.OPENROUTER_MAX_CONCURRENT || '1', 10) || 1); }

  /**
   * COUNTS-ONLY capacity report for /api/health (never contains key material)
   * and the [GenCapacity] log line. estimatedQuestionsPerMinute is a rough
   * burst estimate: sum over providers of (concurrent calls x questions per call
   * x calls per minute per call-slot):
   *   gemini     usable slots x 20 questions / ~45 s per call (thinking model)
   *   openrouter usable keys x ~2 calls/min (20 req/min cap, ~30 s per call) x ~10 questions
   *   groq       per usable key: tokensPerMinute / ~3500 tokens per call x ~8 questions
   * Free daily quotas (Gemini ~20 requests/day/slot, OpenRouter ~50/day/key) cap
   * how long a burst can last; it is an estimate, not a promise.
   */
  llmCapacity() {
    this._maybeDiscoverModels();
    const gKeys = this.geminiKeys.length;
    const models = this._geminiModelList();
    const total = gKeys * models.length;
    const usable = this._geminiUsableSlots().length;
    const orKeys = this._openRouterKeys.length;
    const orUsable = this._usableOpenRouterKeys().length;
    const gqKeys = this.groqKeys.length;
    const gqUsable = this._usableGroqKeys().length;
    const tpmTotal = gqUsable * (LLMQueue.tpmLimit || 0);
    const est = Math.round(
      usable * 20 * (60 / 45) +
      orUsable * 2 * 10 +
      gqUsable * ((LLMQueue.tpmLimit || 7000) / 3500) * 8
    );
    const rec = [];
    if (gKeys === 0) rec.push('No Gemini key configured: add GEMINI_API_KEY (free from Google AI Studio), it is the fastest free provider');
    else {
      if (usable === 0) rec.push('All Gemini (key, model) slots are out of quota until about 00:05 UTC: add more GEMINI_API_KEY_n keys (each Google project adds its own daily quota)');
      else if (usable < 6) rec.push('Add more GEMINI_API_KEY_n keys (each Google project adds its own daily quota)');
      if (models.length < 2) rec.push("Set GEMINI_MODELS to several Flash-family models (Google quota is per model, so each extra model multiplies a key's daily capacity)");
    }
    if (gqKeys < 2) rec.push('Add GROQ_API_KEY_2..GROQ_API_KEY_6 from separate Groq accounts (each key has its own ~7k tokens/minute)');
    if (orKeys < 2) rec.push('Add OPENROUTER_API_KEY_2..OPENROUTER_API_KEY_5 from separate OpenRouter accounts (each key has its own free-model quota)');
    if (est < 40 && rec.length === 0) rec.push('Estimated throughput is low: add more provider keys');
    return {
      gemini: { keys: gKeys, models: models.length, usableSlots: usable, blockedSlots: Math.max(0, total - usable) },
      openrouter: { keys: orKeys, usableKeys: orUsable },
      groq: { keys: gqKeys, usableKeys: gqUsable, tokensPerMinuteTotal: tpmTotal },
      estimatedQuestionsPerMinute: est,
      recommendation: rec,
    };
  }

  /** One-line capacity string for the start of a generation job. */
  capacityLine() {
    const c = this.llmCapacity();
    return `[GenCapacity] gemini slots=${c.gemini.usableSlots}/${c.gemini.keys * c.gemini.models} (${c.gemini.keys} key x ${c.gemini.models} model) openrouter keys=${c.openrouter.usableKeys}/${c.openrouter.keys} groq keys=${c.groq.usableKeys}/${c.groq.keys} est ~${c.estimatedQuestionsPerMinute} questions/min`;
  }

  /** Snapshot of cumulative counters (callers diff two snapshots around a job). */
  counterSnapshot() {
    return {
      rl429: { ...this.counters.rl429 },
      calls: { ...this.counters.calls },
      waitMs: this.counters.waitMs + LLMQueue.throttledMs,
    };
  }

  // ── Gemini credentials — multi-key rotation ──────────────────────────────
  // Reads GEMINI_API_KEY plus GEMINI_API_KEY_2..GEMINI_API_KEY_N. Each key is
  // expected to come from a SEPARATE Google AI Studio project — Gemini's free
  // tier quota (20 requests/day per model, confirmed live) is scoped per
  // project, so 3 keys from 3 projects genuinely triples the daily ceiling;
  // 3 keys from the same project would not.
  get geminiKeys() {
    return envKeys('GEMINI_API_KEY', MAX_GEMINI_KEYS);
  }

  // ── Gemini (key, model) slots ──────────────────────────────────────────────
  // Google's free-tier quota is per project AND per model, so the schedulable
  // unit is the slot "<key>|<model>". A slot has its own cooldown, in-flight
  // count and last-used time; key A exhausted on model X still serves model Y.
  _slotId(key, model) { return `${key}|${model}`; }
  _slotBlocked(key, model) {
    const u = this._geminiKeyBlockedUntil.get(this._slotId(key, model));
    return !!u && Date.now() < u;
  }

  /** Configured model list: GEMINI_MODELS, else resolvedModel + discovered siblings (cap 4), minus retired/dropped models. */
  _geminiModelList() {
    const clean = (arr) => [...new Set(arr.map(m => String(m || '').trim().replace(/^models\//, '')).filter(Boolean))]
      .filter(m => !RETIRED_GEMINI_MODELS.has(m) && !this._droppedModels.has(m));
    const env = (process.env.GEMINI_MODELS || '').split(',');
    let list = clean(env);
    if (list.length === 0) {
      const base = this.resolvedModel;
      list = clean([base, ...((this._modelDiscovery && this._modelDiscovery.models) || [])]);
      // the primary model stays first unless it was dropped
    }
    return list.slice(0, MAX_GEMINI_MODELS);
  }

  /** Every (key, model) pair not in cooldown, as [{ key, model, id }]. */
  _geminiUsableSlots() {
    const out = [];
    const models = this._geminiModelList();
    for (const key of this.geminiKeys) for (const model of models) {
      if (!this._slotBlocked(key, model)) out.push({ key, model, id: this._slotId(key, model) });
    }
    return out;
  }

  _geminiKeysUsable() {
    return new Set(this._geminiUsableSlots().map(s => s.key)).size;
  }

  /**
   * Picks the slot to use: not cooling down, not in `exclude`, and (when
   * requireFree) with fewer in-flight calls than GEMINI_SLOT_CONCURRENT. Among
   * candidates: least busy first, then least recently used (round-robin).
   */
  _pickGeminiSlot({ requireFree = false, exclude = null } = {}) {
    const cap = this._geminiSlotConcurrency();
    let best = null, bestLoad = Infinity, bestUsed = Infinity;
    for (const slot of this._geminiUsableSlots()) {
      if (exclude && exclude.has(slot.id)) continue;
      const load = this._geminiInflight.get(slot.id) || 0;
      if (requireFree && load >= cap) continue;
      const used = this._geminiSlotLastUsed.get(slot.id) || 0;
      if (load < bestLoad || (load === bestLoad && used < bestUsed)) { best = slot; bestLoad = load; bestUsed = used; }
    }
    return best;
  }

  _pickGeminiKey() {
    const slot = this._pickGeminiSlot();
    return slot ? slot.key : null;
  }

  /**
   * Safe model discovery: GET /v1beta/models, keep Flash-family models that list
   * generateContent, drop image/tts/audio/live/embedding/thinking-only/experimental
   * names, cap at 4. Cached 6 h per process; ANY failure falls open (the
   * configured model alone). Disabled by GEMINI_MODEL_DISCOVERY=0 or when
   * GEMINI_MODELS is set explicitly.
   */
  _maybeDiscoverModels() {
    if (process.env.GEMINI_MODEL_DISCOVERY === '0' || (process.env.GEMINI_MODELS || '').trim()) return null;
    const keys = this.geminiKeys;
    if (keys.length === 0) return null;
    const d = this._modelDiscovery;
    if (d && d.promise) return d.promise;
    if (d && Date.now() - d.at < MODEL_DISCOVERY_TTL_MS) return null;
    const prev = d && d.models ? d.models : [];
    const state = { at: Date.now(), models: prev, promise: null };
    state.promise = (async () => {
      try {
        const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${keys[0]}`, { signal: AbortSignal.timeout(10000) });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        state.models = this._filterDiscoveredModels(data.models || []);
        console.log(`[Gemini] model discovery: ${state.models.length} usable Flash model(s): ${state.models.join(', ') || '(none)'}`);
      } catch (err) {
        console.warn(`[Gemini] model discovery failed (${err.message}) - using the configured model only`);
      } finally {
        state.promise = null;
        state.at = Date.now();
      }
      return state.models;
    })();
    this._modelDiscovery = state;
    return state.promise;
  }

  _filterDiscoveredModels(models) {
    const names = [];
    for (const m of models) {
      const name = String(m?.name || '').replace(/^models\//, '');
      if (!/flash/i.test(name)) continue;
      if (GEMINI_MODEL_EXCLUDE.test(name)) continue;
      const methods = m?.supportedGenerationMethods;
      if (!Array.isArray(methods) || !methods.includes('generateContent')) continue;
      if (RETIRED_GEMINI_MODELS.has(name)) continue;
      names.push(name);
    }
    // stable releases before previews, then alphabetical-descending (newer first)
    names.sort((a, b) => (/preview/i.test(a) - /preview/i.test(b)) || b.localeCompare(a));
    return [...new Set(names)].slice(0, MAX_GEMINI_MODELS);
  }

  async _ensureGeminiModels() {
    const p = this._maybeDiscoverModels();
    if (p) { try { await p; } catch { /* fails open */ } }
  }

  // Google's free-tier daily quota resets at a fixed time, not "24h from the
  // failed call" — using next-UTC-midnight as the cooldown boundary is an
  // approximation (the actual reset may be Pacific-time-based) but errs
  // toward retrying a LITTLE early rather than blocking a key that's
  // actually already reset, which is the safer direction to be wrong in.
  _msUntilNextUtcMidnight() {
    const now = new Date();
    const next = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1, 0, 5, 0));
    return next.getTime() - now.getTime();
  }

  get resolvedModel() {
    const configured = process.env.GEMINI_MODEL;
    if (configured && RETIRED_GEMINI_MODELS.has(configured)) {
      if (!this._warnedRetired) {
        this._warnedRetired = true;
        console.warn(`[Gemini] GEMINI_MODEL="${configured}" is retired by Google (404s on every call) — using "${this.model}" instead. Update the env var to silence this.`);
      }
      return this.model;
    }
    return configured || this.model;
  }

  get endpoint() {
    return this._endpointFor(this.resolvedModel);
  }

  _endpointFor(model) {
    return `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;
  }

  // True only when EVERY configured key is currently in a quota cooldown —
  // i.e. there is truly nothing left to try. Callers skip Gemini entirely in
  // that state rather than issuing calls that cannot succeed.
  geminiQuotaBlocked() {
    return this.geminiKeys.length > 0 && this._geminiUsableSlots().length === 0;
  }

  isEnabled() {
    return this.geminiKeys.length > 0;
  }

  // True when embedTexts() could actually make a request (a key whose embedding
  // quota is not in cooldown). Lets callers skip the semantic-dedup pass
  // outright instead of paying for a call that returns null.
  embedAvailable() {
    const now = Date.now();
    return this.geminiKeys.some(k => { const u = this._geminiEmbedKeyBlockedUntil.get(k); return !u || now >= u; });
  }

  // ── Groq credentials ──────────────────────────────────────────────────────
  // GROQ_API_KEY plus GROQ_API_KEY_2..6, each from a separate Groq account/org:
  // every key has its OWN tokens-per-minute window (LLMQueue keyId "groq#<n>")
  // and its own cooldown.
  get groqKeys() {
    return envKeys('GROQ_API_KEY', MAX_GROQ_KEYS);
  }

  /** First configured key (legacy single-key callers). */
  get groqApiKey() {
    return this.groqKeys[0] || '';
  }

  get groqEnabled() {
    return this.groqKeys.length > 0;
  }

  _groqKeyId(key) { return `groq#${this.groqKeys.indexOf(key) + 1}`; }

  _groqKeyCooling(key) {
    const u = this._groqKeyBlockedUntil.get(key);
    return !!u && Date.now() < u;
  }

  _usableGroqKeys() {
    return this.groqKeys.filter(k => !this._groqKeyCooling(k));
  }

  /**
   * Groq key with the most free token budget for a call of `estTokens` (never a
   * cooling-down key). Least expected wait first, then most free tokens.
   */
  _pickGroqKey(estTokens, exclude = null) {
    let best = null, bestWait = Infinity, bestFree = -1;
    for (const key of this._usableGroqKeys()) {
      if (exclude && exclude.has(key)) continue;
      const id = this._groqKeyId(key);
      const wait = LLMQueue.estimateWaitMs(estTokens, id);
      const free = LLMQueue.freeTokens(id);
      if (wait < bestWait || (wait === bestWait && free > bestFree)) { best = key; bestWait = wait; bestFree = free; }
    }
    return best;
  }

  // ── Cerebras credentials ──────────────────────────────────────────────────
  // OpenAI-compatible API. Free tier (no credit card, confirmed): 1,000,000
  // tokens/day and 14,400 requests/day PER MODEL, ~30 requests/min — far more
  // headroom than either Gemini (20 req/day/key) or Groq (8,000 tokens/min).
  get cerebrasApiKey() {
    return process.env.CEREBRAS_API_KEY || '';
  }

  get cerebrasEnabled() {
    return !!(this.cerebrasApiKey && this.cerebrasApiKey.length > 10);
  }

  // Discovers a real, currently-available chat model from Cerebras's own
  // /v1/models endpoint instead of hardcoding a name — this exact codebase
  // just spent a long session debugging hardcoded Groq/Gemini model names
  // that had been silently retired, so a new integration deliberately avoids
  // repeating that mistake. Cached per process; a hardcoded fallback name is
  // used only if discovery itself fails (e.g. transient network error).
  async _resolveCerebrasModel() {
    if (this._cerebrasModelPromise) return this._cerebrasModelPromise;
    this._cerebrasModelPromise = (async () => {
      try {
        const res = await fetch('https://api.cerebras.ai/v1/models', {
          headers: { 'Authorization': `Bearer ${this.cerebrasApiKey}` },
          signal: AbortSignal.timeout(10000),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        const ids = (data.data || []).map(m => m.id).filter(Boolean);
        if (ids.length === 0) throw new Error('empty model list');
        // Prefer a larger/more capable-sounding instruct model when several
        // are offered; otherwise take whatever is actually available.
        const preferred = ids.find(id => /scout|70b|32b|qwen/i.test(id)) || ids[0];
        console.log(`[Cerebras] resolved model: ${preferred} (from ${ids.length} available)`);
        return preferred;
      } catch (err) {
        console.warn(`[Cerebras] model discovery failed (${err.message}) — using fallback name, which may be stale`);
        return 'llama-3.3-70b';
      }
    })();
    return this._cerebrasModelPromise;
  }

  // Cerebras: generate JSON. Same OpenAI-compatible shape as Groq, so this
  // mirrors _groqJSON closely, minus the aggressive TPM pacing Groq needs —
  // Cerebras's free tier is generous enough that reactive 429 handling alone
  // is sufficient without a proactive token-bucket gate.
  async _cerebrasJSON(prompt, system = '', { temperature = 0.7, maxTokens = 4096 } = {}) {
    if (!this.cerebrasEnabled) return null;
    try {
      const model = await this._resolveCerebrasModel();
      const messages = [];
      if (system) messages.push({ role: 'system', content: system });
      messages.push({ role: 'user', content: prompt });

      const res = await LLMQueue.run(() => fetch('https://api.cerebras.ai/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.cerebrasApiKey}`,
        },
        body: JSON.stringify({
          model,
          messages,
          temperature,
          max_tokens: maxTokens,
          response_format: { type: 'json_object' },
        }),
        signal: AbortSignal.timeout(30000),
      }));

      if (!res.ok) {
        const errText = await res.text().catch(() => '');
        console.warn(`[Cerebras] HTTP ${res.status} on ${model}: ${errText.slice(0, 200)}`);
        return null;
      }

      const data = await res.json();
      const text = data.choices?.[0]?.message?.content;
      if (!text) { console.warn('[Cerebras] empty response'); return null; }

      const parsed = JSON.parse(text);
      console.log(`[Cerebras] ✅ Success (${model})`);
      return parsed;
    } catch (err) {
      console.warn(`[Cerebras] failed: ${err.message}`);
      return null;
    }
  }

  // ── OpenRouter credentials ────────────────────────────────────────────────
  // OpenAI-compatible API, single key, aggregates many labs' models. Free
  // models only (id ends ":free", or $0 pricing) — confirmed no credit card
  // required, unlike Cerebras post-Aug-2026. Real but small quota: 20
  // requests/min, 50 free-model requests/day (until $10 has ever been spent
  // on the account, when the daily cap rises to 1,000) — a genuinely
  // separate bucket from Gemini's and Groq's, so it adds real extra daily
  // headroom rather than just re-slicing an existing limit.
  get _openRouterKeys() {
    return envKeys('OPENROUTER_API_KEY', MAX_OPENROUTER_KEYS);
  }

  /** First configured key (legacy single-key callers). */
  get openRouterApiKey() {
    return this._openRouterKeys[0] || '';
  }

  get openRouterEnabled() {
    return this._openRouterKeys.length > 0;
  }

  _orKeyCooling(key) {
    const u = this._orKeyBlockedUntil.get(key);
    return !!u && Date.now() < u;
  }

  _coolOpenRouterKey(key, ms, reason) {
    const until = Date.now() + Math.max(1000, ms);
    if (until > (this._orKeyBlockedUntil.get(key) || 0)) this._orKeyBlockedUntil.set(key, until);
    console.warn(`[OpenRouter] key #${this._openRouterKeys.indexOf(key) + 1} cooling down ${Math.round(ms / 1000)}s (${reason})`);
  }

  _usableOpenRouterKeys() {
    return this._openRouterKeys.filter(k => !this._orKeyCooling(k));
  }

  /** Usable key with the fewest calls in flight; with requireFree, only a key under OPENROUTER_MAX_CONCURRENT. */
  _pickOpenRouterKey({ requireFree = false } = {}) {
    const cap = this._openRouterPerKeyConcurrency();
    let best = null, bestLoad = Infinity;
    for (const key of this._usableOpenRouterKeys()) {
      const load = this._orKeyInflight.get(key) || 0;
      if (requireFree && load >= cap) continue;
      if (load < bestLoad) { best = key; bestLoad = load; }
    }
    return best;
  }

  // Discovers a currently-available FREE model from OpenRouter's own
  // /api/v1/models endpoint rather than hardcoding an id — free-model
  // availability on OpenRouter churns often (models get added/retired), and
  // this codebase already learned that lesson the hard way with hardcoded
  // Groq/Gemini model names going stale (see _resolveCerebrasModel above).
  // Cached per process; the hardcoded fallback below is used only if
  // discovery itself fails (e.g. transient network error), and may itself
  // be stale by the time that path is hit.
  async _resolveOpenRouterModel() {
    if (this._openRouterModelPromise) return this._openRouterModelPromise;
    this._openRouterModelPromise = (async () => {
      try {
        const res = await fetch('https://openrouter.ai/api/v1/models', {
          signal: AbortSignal.timeout(10000),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        const models = data.data || [];
        const free = models.filter(m => {
          const id = m.id || '';
          const promptPrice = parseFloat(m.pricing?.prompt ?? '1');
          const completionPrice = parseFloat(m.pricing?.completion ?? '1');
          return id.endsWith(':free') || (promptPrice === 0 && completionPrice === 0);
        });
        if (free.length === 0) throw new Error('no free models currently listed');
        // Prefer a larger/more capable-sounding instruct model when several
        // free ones are offered; otherwise take whatever is actually available.
        const preferred = free.find(m => /70b|72b|405b|large|deepseek|qwen|llama-3\.3/i.test(m.id)) || free[0];
        console.log(`[OpenRouter] resolved free model: ${preferred.id} (from ${free.length} free of ${models.length} total)`);
        return preferred.id;
      } catch (err) {
        console.warn(`[OpenRouter] model discovery failed (${err.message}) — using fallback name, which may be stale`);
        return 'meta-llama/llama-3.3-70b-instruct:free';
      }
    })();
    return this._openRouterModelPromise;
  }

  // OpenRouter: generate JSON. Same OpenAI-compatible shape as Cerebras/Groq.
  // response_format is requested but not guaranteed honored by every free
  // model, so the markdown-fence strip below is defensive, same as Gemini.
  async _openRouterJSON(prompt, system = '', { temperature = 0.7, maxTokens = 4096, timeoutMs = 45000, signal = null, salvage = false, key = null } = {}) {
    if (!this.openRouterEnabled) return null;
    // Per-key accounting: pick (or accept) a usable key and count the call
    // in flight on it BEFORE the first await, so concurrent callers see it.
    key = key || this._pickOpenRouterKey();
    if (!key) return null;
    this._orKeyInflight.set(key, (this._orKeyInflight.get(key) || 0) + 1);
    try {
      const model = await this._resolveOpenRouterModel();
      const messages = [];
      if (system) messages.push({ role: 'system', content: system });
      messages.push({ role: 'user', content: prompt });

      const res = await LLMQueue.run(() => fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${key}`,
          // Recommended (not required) by OpenRouter for attributing traffic —
          // harmless to omit but good practice for a free-tier consumer.
          'HTTP-Referer': 'https://skillforge.ai',
          'X-Title': 'SkillForge AI',
        },
        body: JSON.stringify({
          model,
          messages,
          temperature,
          max_tokens: maxTokens,
          response_format: { type: 'json_object' },
        }),
        signal: mkSignal(timeoutMs, signal),
      }));

      if (!res.ok) {
        const errText = await res.text().catch(() => '');
        console.warn(`[OpenRouter] HTTP ${res.status} on ${model}: ${errText.slice(0, 200)}`);
        // Known-bad states stop being retried on every call: per-minute limit
        // -> short pause; per-day free-model cap / auth / credit -> long pause.
        if (res.status === 429) { this.counters.rl429.openrouter++; this._coolOpenRouterKey(key, /per-day|free-models-per-day|daily/i.test(errText) ? this._msUntilNextUtcMidnight() : 60 * 1000, 'HTTP 429'); }
        else if ([401, 402, 403].includes(res.status)) this._coolOpenRouterKey(key, 60 * 60 * 1000, `HTTP ${res.status}`);
        else if (res.status >= 500) this._coolOpenRouterKey(key, 20 * 1000, `HTTP ${res.status}`);
        return null;
      }

      const data = await res.json();
      const text = data.choices?.[0]?.message?.content;
      if (!text) { console.warn('[OpenRouter] empty response'); return null; }

      const parsed = parseLoose(text, { salvage });
      this.openRouterCallCount++;
      this.counters.calls.openrouter++;
      console.log(`[OpenRouter] ✅ Success (${model}) — call #${this.openRouterCallCount}`);
      return parsed;
    } catch (err) {
      console.warn(`[OpenRouter] failed: ${err.message}`);
      return null;
    } finally {
      this._orKeyInflight.set(key, Math.max(0, (this._orKeyInflight.get(key) || 1) - 1));
    }
  }

  // ── Groq: generate JSON ───────────────────────────────────────────────────
  // onThrottle(delayMs) fires whenever this call has to wait — either for the
  // LLMQueue TPM budget (before the call) or on a 429/413 retry-after (after a
  // rejected attempt) — so callers can surface "pausing for rate limit" to the
  // user instead of the run appearing frozen.
  async _groqJSON(prompt, system = '', { temperature = 0.7, maxTokens = 2048, timeoutMs = 30000, model = 'openai/gpt-oss-120b', onThrottle = null, onResume = null, signal = null, salvage = false, deadlineAt = null, info = null } = {}) {
    if (!this.groqEnabled) return null;
    const estTokens = estimateGroqTokens(prompt, system, maxTokens);
    const MAX_RATE_RETRIES = 2;
    const fail = (kind) => { if (info) info.failKind = kind; };

    for (let attempt = 0; attempt <= MAX_RATE_RETRIES; attempt++) {
      try {
        const messages = [];
        if (system) messages.push({ role: 'system', content: system });
        messages.push({ role: 'user', content: prompt });

        // Route to the key with the most free token budget; never to a cooling-down key.
        const gKey = this._pickGroqKey(estTokens);
        if (!gKey) { fail('rate'); throw new Error('every Groq key is cooling down'); }
        const keyId = this._groqKeyId(gKey);
        this.counters.calls.groq++;

        const res = await LLMQueue.run(() => fetch('https://api.groq.com/openai/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${gKey}`,
          },
          body: JSON.stringify({
            model,
            messages,
            temperature,
            max_tokens: maxTokens,
            response_format: { type: 'json_object' },
            // gpt-oss models spend part of max_tokens on internal reasoning
            // before emitting the final answer — at default effort this can
            // consume the entire budget on a small max_tokens call, leaving
            // nothing for the actual JSON and failing validation with an
            // empty failed_generation. Low effort is sufficient here: the
            // prompt already does the "reasoning" via explicit grounding
            // instructions, not multi-step chain-of-thought.
            reasoning_effort: 'low',
          }),
          signal: mkSignal(timeoutMs, signal),
        }), estTokens, onThrottle, { maxWaitMs: deadlineAt ? Math.max(0, deadlineAt - Date.now()) : undefined, onResume, keyId });

        if (!res.ok) {
          const errText = await res.text();
          if (res.status === 429) { this.counters.rl429.groq++; this._groqKeyBlockedUntil.set(gKey, Date.now() + parseRetryMs(res, errText)); }
          // Rate limited despite pacing (estimate error, or a different model
          // tier with a lower TPM cap than the shared window assumes): honor
          // Groq's requested wait and retry the SAME call rather than falling
          // straight through to a generic template. This KEY cools down for that
          // long; if another key is usable the retry goes there immediately.
          if ((res.status === 429 || res.status === 413) && attempt < MAX_RATE_RETRIES) {
            const waitMs = parseRetryMs(res, errText);
            if (res.status === 429 && this._pickGroqKey(estTokens)) {
              console.warn(`[Groq] ${keyId} rate-limited (${res.status}) on ${model} - retrying on another key`);
              continue;
            }
            this.counters.waitMs += waitMs;
            // Never sleep past the caller's deadline.
            if (deadlineAt && Date.now() + waitMs > deadlineAt) { fail('rate'); throw new Error(`Groq HTTP ${res.status}: retry-after ${Math.round(waitMs / 1000)}s exceeds the time budget`); }
            if (typeof onThrottle === 'function') { try { onThrottle(waitMs); } catch { /* never break generation */ } }
            console.warn(`[Groq] rate-limited (${res.status}) on ${model} — waiting ${Math.round(waitMs / 1000)}s then retrying (attempt ${attempt + 1}/${MAX_RATE_RETRIES})`);
            await sleep(waitMs);
            if (typeof onResume === 'function') { try { onResume(); } catch { /* never break generation */ } }
            continue;
          }
          if (res.status === 429 || res.status === 413) fail('rate');
          throw new Error(`Groq HTTP ${res.status}: ${errText.slice(0, 200)}`);
        }

        const data = await res.json();
        const text = data.choices?.[0]?.message?.content;
        if (!text) throw new Error('Empty response from Groq');

        const parsed = parseLoose(text, { salvage });
        this.groqCallCount++;
        console.log(`[Groq] ✅ Success (${model}) — call #${this.groqCallCount}${parsed?._salvaged ? ' (salvaged truncated JSON)' : ''}`);
        return parsed;
      } catch (err) {
        if (err?.code === 'TPM_WAIT_EXCEEDED') fail('budget');
        else if (err?.name === 'AbortError' || err?.name === 'TimeoutError') fail('timeout');
        console.error(`[Groq] ❌ Failed (${model}): ${err.message}`);
        return null;
      }
    }
    return null;
  }

  // ── Groq: generate plain text (70b — standard fallback) ─────────────────
  async _groqText(prompt, system = '') {
    if (!this.groqEnabled) return null;
    try {
      const messages = [];
      if (system) messages.push({ role: 'system', content: system });
      messages.push({ role: 'user', content: prompt });

      const res = await LLMQueue.run(() => fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.groqApiKey}`,
        },
        body: JSON.stringify({
          model: 'openai/gpt-oss-120b',
          messages,
          temperature: 0.8,
          max_tokens: 1024,
          reasoning_effort: 'low',
        }),
        signal: AbortSignal.timeout(20000),
      }));

      if (!res.ok) return null;
      const data = await res.json();
      return data.choices?.[0]?.message?.content || null;
    } catch {
      return null;
    }
  }

  // ── Groq: fast plain text (8b-instant — primary for Tier-3 tasks) ─────────
  async _groqTextFast(prompt, system = '') {
    if (!this.groqEnabled) return null;
    try {
      const messages = [];
      if (system) messages.push({ role: 'system', content: system });
      messages.push({ role: 'user', content: prompt });

      const res = await LLMQueue.run(() => fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.groqApiKey}`,
        },
        body: JSON.stringify({
          model: 'openai/gpt-oss-20b',
          messages,
          temperature: 0.8,
          max_tokens: 512,
          reasoning_effort: 'low',
        }),
        signal: AbortSignal.timeout(15000),
      }));

      if (!res.ok) return null;
      const data = await res.json();
      const text = data.choices?.[0]?.message?.content || null;
      if (text) {
        this.groqFastCallCount++;
        console.log(`[Groq-8b] ⚡ Fast text — call #${this.groqFastCallCount}`);
      }
      return text;
    } catch {
      return null;
    }
  }

  // ── Groq: fast JSON (8b-instant — primary for Tier-3/medium JSON tasks) ──
  async _groqJSONFast(prompt, system = '') {
    if (!this.groqEnabled) return null;
    try {
      const messages = [];
      if (system) messages.push({ role: 'system', content: system });
      messages.push({ role: 'user', content: prompt });

      const res = await LLMQueue.run(() => fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.groqApiKey}`,
        },
        body: JSON.stringify({
          model: 'openai/gpt-oss-20b',
          messages,
          temperature: 0.7,
          max_tokens: 1024,
          response_format: { type: 'json_object' },
          reasoning_effort: 'low',
        }),
        signal: AbortSignal.timeout(20000),
      }));

      if (!res.ok) return null;
      const data = await res.json();
      const text = data.choices?.[0]?.message?.content;
      if (!text) return null;
      const parsed = JSON.parse(text);
      this.groqFastCallCount++;
      console.log(`[Groq-8b] ⚡ Fast JSON — call #${this.groqFastCallCount}`);
      return parsed;
    } catch {
      return null;
    }
  }

  // ── Gemini: single-attempt JSON (no retry) ───────────────────────────────
  // Distinct from generateJSON's retrying Gemini path below: callers that
  // already run their own outer retry loop (e.g. bulk question generation)
  // want one attempt per call, not 3 retries nested inside each attempt.
  // timeoutMs defaults to 120s, not 30s: gemini-3.6-flash is a *thinking*
  // model (a measured 20-question call spent 2,161 tokens on reasoning and
  // took ~40s wall-clock). A 30s abort killed exactly the large, useful
  // batches this path exists to make.
  async _geminiJSONOnce(prompt, system = '', { temperature = 0.85, maxTokens = 16384, timeoutMs = 120000, signal = null, salvage = false, requireFree = false, exclude = null, info = null } = {}) {
    // Least-busy, least-recently-used usable (key, model) slot. Concurrent
    // bulk-generation calls spread across every key AND every model. The pick
    // and the in-flight increment happen synchronously (no await in between).
    const slot = this._pickGeminiSlot({ requireFree, exclude });
    if (!slot) return null;
    const { key, model } = slot;
    if (info) { info.slot = slot.id; info.model = model; }
    this._geminiInflight.set(slot.id, (this._geminiInflight.get(slot.id) || 0) + 1);
    this._geminiSlotLastUsed.set(slot.id, Date.now());
    const label = `key #${this.geminiKeys.indexOf(key) + 1}/${model}`;
    try {
      const body = {
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig: { temperature, maxOutputTokens: maxTokens, responseMimeType: 'application/json' },
      };
      // Optional cap on the thinking model's reasoning tokens (unset = model
      // default). Exposed as an env knob because reasoning tokens are a large
      // share of Gemini latency for this schema-filling task. Models that reject
      // it (HTTP 400 mentioning "thinking") are retried once without it and
      // remembered for the process lifetime.
      const thinking = parseInt(process.env.GEMINI_THINKING_BUDGET || '', 10);
      const wantThinking = Number.isFinite(thinking) && thinking >= 0 && !this._noThinkingModels.has(model);
      if (wantThinking) body.generationConfig.thinkingConfig = { thinkingBudget: thinking };
      if (system) body.systemInstruction = { parts: [{ text: system }] };

      const send = () => LLMQueue.run(() => fetch(`${this._endpointFor(model)}?key=${key}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: mkSignal(timeoutMs, signal),
      }));
      this.counters.calls.gemini++;
      let res = await send();
      let errText = '';
      if (!res.ok) {
        errText = await res.text().catch(() => '');
        if (res.status === 400 && body.generationConfig.thinkingConfig && /thinking/i.test(errText)) {
          this._noThinkingModels.add(model);
          console.warn(`[Gemini] ${model} rejected thinkingConfig - retrying without it (remembered for this process)`);
          delete body.generationConfig.thinkingConfig;
          this.counters.calls.gemini++;
          res = await send();
          errText = res.ok ? '' : await res.text().catch(() => '');
        }
      }
      // Surface WHY a call failed instead of returning a silent null — a 404
      // (retired model), a 429 (quota) and a truncated body are completely
      // different problems, and an opaque null previously made a retired
      // model name look like an exhausted quota for weeks.
      if (!res.ok) {
        // Gemini's FREE tier allows only ~20 requests per DAY per model, PER
        // KEY (quotaId GenerateRequestsPerDayPerProjectPerModel-FreeTier).
        // Block only THIS (key, model) slot: sibling keys and sibling models
        // are separate quota buckets and keep serving.
        if (res.status === 429) {
          this.counters.rl429.gemini++;
          const perDay = /GenerateRequestsPerDayPerProjectPerModel/.test(errText);
          const cooldownMs = perDay ? this._msUntilNextUtcMidnight() : 60 * 1000;
          this._geminiKeyBlockedUntil.set(slot.id, Date.now() + cooldownMs);
          const remaining = this._geminiUsableSlots().length;
          console.warn(`[Gemini] ${label} hit ${perDay ? 'its per-DAY free-tier quota' : 'a short-term rate limit'} - slot cooling down ${Math.round(cooldownMs / 60000)}min. ${remaining > 0 ? `${remaining} other slot(s) still available.` : 'No other slots available - falling to OpenRouter/Groq.'}`);
          return null;
        }
        // A model that does not exist / does not support generateContent will
        // never work: drop it for the process lifetime (logged once).
        if ((res.status === 404 || res.status === 400) && /not found|not supported|unsupported|no longer available|is not available/i.test(errText) && !/thinking/i.test(errText)) {
          if (!this._droppedModels.has(model)) {
            this._droppedModels.add(model);
            console.warn(`[Gemini] model "${model}" is not usable (HTTP ${res.status}) - dropped for this process: ${errText.slice(0, 160)}`);
          }
          return null;
        }
        console.warn(`[Gemini] HTTP ${res.status} on ${label}: ${errText.slice(0, 200)}`);
        return null;
      }

      const data = await res.json();
      const finishReason = data.candidates?.[0]?.finishReason;
      const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
      if (!text) {
        console.warn(`[Gemini] empty response (finishReason=${finishReason || 'unknown'})`);
        return null;
      }
      // MAX_TOKENS means the JSON was cut off mid-structure; the parse below
      // would fail anyway, but naming the cause makes it actionable.
      if (finishReason === 'MAX_TOKENS') {
        console.warn(`[Gemini] output hit maxOutputTokens (${maxTokens}) — JSON truncated, batch discarded. Lower questions-per-call or raise the cap.`);
      }

      const parsed = parseLoose(text, { salvage });
      this.callCount++;
      return parsed;
    } catch (err) {
      console.warn(`[Gemini] single-attempt JSON failed: ${err.message}`);
      return null;
    } finally {
      this._geminiInflight.set(slot.id, Math.max(0, (this._geminiInflight.get(slot.id) || 1) - 1));
    }
  }

  // ── embedTexts: batch text embeddings for semantic similarity ────────────
  // Purpose-built for AssessmentGenerator.js's semantic-duplicate pass. Uses
  // Gemini's text-embedding-004 (a SEPARATE model/quota bucket from the
  // generation model — see _geminiEmbedKeyBlockedUntil above) via
  // batchEmbedContents, which embeds up to 100 texts in ONE HTTP request —
  // this is what keeps semantic dedup affordable: one API call per
  // generation run, not one per question. Deliberately a pure ADD-ON: any
  // failure (quota, network, malformed response) returns null and the caller
  // falls back to lexical-only dedup — this must never block or slow down
  // the core generation pipeline, which is already carefully tuned around a
  // tight free-tier quota.
  async embedTexts(texts) {
    if (!Array.isArray(texts) || texts.length === 0) return null;
    if (texts.length > 100) texts = texts.slice(0, 100); // batchEmbedContents' documented per-request cap

    const now = Date.now();
    const key = this.geminiKeys.find(k => {
      const until = this._geminiEmbedKeyBlockedUntil.get(k);
      return !until || now >= until;
    });
    if (!key) return null;

    try {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/text-embedding-004:batchEmbedContents?key=${key}`;
      const body = {
        requests: texts.map(t => ({
          model: 'models/text-embedding-004',
          content: { parts: [{ text: (t || '').slice(0, 2000) }] }, // per-text cap, plenty for one question's worth of text
        })),
      };
      const res = await LLMQueue.run(() => fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(20000),
      }));
      if (!res.ok) {
        if (res.status === 429) {
          // Same per-key-per-day free-tier shape as generation, just a
          // different model — cool this key down for embeddings only.
          this._geminiEmbedKeyBlockedUntil.set(key, now + this._msUntilNextUtcMidnight());
        }
        console.warn(`[Gemini] embedTexts HTTP ${res.status} — semantic dedup pass skipped for this run.`);
        return null;
      }
      const data = await res.json();
      const embeddings = (data.embeddings || []).map(e => e.values);
      if (embeddings.length !== texts.length || embeddings.some(v => !Array.isArray(v))) {
        console.warn('[Gemini] embedTexts: response shape mismatch — semantic dedup pass skipped for this run.');
        return null;
      }
      return embeddings;
    } catch (err) {
      console.warn(`[Gemini] embedTexts failed (${err.message}) — semantic dedup pass skipped for this run.`);
      return null;
    }
  }

  // ── generateQuestionsBatch: capacity-aware routing across providers ───────────
  // Purpose-built for AssessmentGenerator.js's bulk question generation. One
  // attempt per provider/model tier, `{questions: [...]}` unwrapped.
  //
  // ROUTING (this used to be a strictly sequential fall-through, which is why a
  // bank took 30-60+ minutes once Gemini's 20-requests/day/key free quota was
  // gone: EVERY call then walked past a dead Gemini, a dead Cerebras and a
  // rate-limited OpenRouter before parking on Groq's ~7k tokens/MINUTE pipe,
  // one call at a time):
  //   1. Gemini — least-busy usable key; skipped entirely (no request, no
  //      wait) while every key is in a quota cooldown.
  //   2. Cerebras — only when configured and not cooling down.
  //   3. OpenRouter free model — only when it is not cooling down AND has a free
  //      slot (OPENROUTER_MAX_CONCURRENT, default 1): a concurrent call that
  //      finds it busy goes straight to Groq instead of queueing, so the two
  //      free pipes work IN PARALLEL rather than one after the other.
  //   4. Groq gpt-oss-120b, then gpt-oss-20b (only when the 120b failure was
  //      not a rate/size problem — the TPM bucket is shared, so a rate failure
  //      would just burn the same budget twice).
  // `deadlineAt` (epoch ms) bounds every wait: a call that cannot finish before
  // it returns null immediately instead of parking on the TPM limiter.
  // Returns the questions array, or null.
  async generateQuestionsBatch(prompt, system = '', opts = {}) {
    const r = await this.generateQuestionsBatchEx(prompt, system, opts);
    return r ? r.questions : null;
  }

  /** Same as generateQuestionsBatch but returns { questions, provider, ms } so callers can account for cost/latency. */
  async generateQuestionsBatchEx(prompt, system = '', { temperature = 0.85, maxTokens = 16000, timeoutMs = 120000, onThrottle = null, onResume = null, deadlineAt = null, signal = null, salvage = true } = {}) {
    const t0 = Date.now();
    const left = () => (deadlineAt ? deadlineAt - Date.now() : Infinity);
    const done = (questions, provider) => { this.routeStats[provider.split(':')[0]] = (this.routeStats[provider.split(':')[0]] || 0) + 1; return { questions, provider, ms: Date.now() - t0 }; };
    const callTimeout = () => Math.max(4000, Math.min(timeoutMs, left()));
    const out = (parsed) => (Array.isArray(parsed?.questions) ? parsed.questions : null);

    if (this.isEnabled()) await this._ensureGeminiModels();   // no-op once discovery is cached; fails open
    if (this.isEnabled() && !this.geminiQuotaBlocked()) {
      const geminiTokens = Math.max(maxTokens, 8192);
      // Try up to 4 DIFFERENT free (key, model) slots; a slot already busy with
      // GEMINI_SLOT_CONCURRENT calls is skipped (the call goes on to the next provider).
      const tried = new Set();
      const maxAttempts = Math.max(1, Math.min(4, this._geminiUsableSlots().length));
      for (let i = 0; i < maxAttempts; i++) {
        if (left() < 4000 || signal?.aborted) break;
        const gi = {};
        const q = out(await this._geminiJSONOnce(prompt, system, { temperature, maxTokens: geminiTokens, timeoutMs: callTimeout(), signal, salvage, requireFree: true, exclude: tried, info: gi }));
        if (q) return done(q, 'gemini');
        if (!gi.slot) break;          // no free usable slot right now
        tried.add(gi.slot);
      }
    }
    if (this.cerebrasEnabled && !this.isCoolingDown('cerebras') && left() >= 4000 && !signal?.aborted) {
      const q = out(await this._cerebrasJSON(prompt, system, { temperature, maxTokens: Math.min(maxTokens, 8192) }));
      if (q) return done(q, 'cerebras');
      this.coolDown('cerebras', 5 * 60 * 1000, 'no usable response');
    }
    // OpenRouter: a usable key with a free slot (OPENROUTER_MAX_CONCURRENT per key);
    // if every key is busy or cooling the call goes straight to Groq instead of queueing.
    const orKey = this.openRouterEnabled && left() >= 6000 && !signal?.aborted ? this._pickOpenRouterKey({ requireFree: true }) : null;
    if (orKey) {
      const q = out(await this._openRouterJSON(prompt, system, { temperature, maxTokens: Math.min(maxTokens, 8192), timeoutMs: Math.min(60000, callTimeout()), signal, salvage, key: orKey }));
      if (q) return done(q, 'openrouter');
    }
    // A request whose own prompt + max_tokens exceeds the whole per-minute budget is rejected with HTTP 413
    // no matter how long we wait — do not even send it.
    const groqFits = estimateGroqTokens(prompt, system, maxTokens) <= (LLMQueue.tpmLimit || 7000);
    if (this.groqEnabled && groqFits && this._usableGroqKeys().length > 0 && !signal?.aborted) {
      const base = { temperature, maxTokens, timeoutMs: callTimeout(), onThrottle, onResume, signal, salvage, deadlineAt };
      const info = {};
      const q120 = out(await this._groqJSON(prompt, system, { ...base, model: 'openai/gpt-oss-120b', info }));
      if (q120) return done(q120, 'groq:120b');
      // The Groq TPM bucket is shared across models: retry on the 20b model only
      // for failures that are not about rate/size/time.
      if (!info.failKind && left() >= 6000 && !signal?.aborted) {
        const q20 = out(await this._groqJSON(prompt, system, { ...base, timeoutMs: callTimeout(), model: 'openai/gpt-oss-20b' }));
        if (q20) return done(q20, 'groq:20b');
      }
    }
    this.routeStats.failed++;
    return null;
  }

  /**
   * generateDeepJSON — same provider ladder as generateQuestionsBatch, but
   * returns the whole parsed object instead of unwrapping `.questions`.
   *
   * Exists because generateJSON's 2048-token default is far too small for a
   * rich document (a full day of training content), while generateQuestionsBatch
   * only ever hands back a questions array. Without this, deep per-day content
   * was impossible: the single-call-for-all-days generators had to share one
   * 8000-token budget across every day, which is exactly why each day ended up
   * with 2-4 minutes of reading.
   *
   * Default capped at 8000 rather than 16000 on purpose: Cerebras and Groq
   * clamp to 8192, and when a response hits the output ceiling the JSON is
   * truncated and the whole batch is DISCARDED (see _geminiJSONOnce's
   * MAX_TOKENS branch). Asking for more than the weakest tier can deliver
   * would lose an entire day's content on fallback rather than degrade.
   */
  async generateDeepJSON(prompt, system = '', { temperature = 0.8, maxTokens = 8000, timeoutMs = 120000, onThrottle = null } = {}) {
    if (this.isEnabled()) {
      const geminiTokens = Math.max(maxTokens, 8192);
      const maxAttempts = Math.max(1, Math.min(4, this._geminiUsableSlots().length));
      for (let i = 0; i < maxAttempts; i++) {
        if (i > 0 && this.geminiQuotaBlocked()) break;
        const parsed = await this._geminiJSONOnce(prompt, system, { temperature, maxTokens: geminiTokens, timeoutMs });
        if (parsed && typeof parsed === 'object') return parsed;
      }
    }
    if (this.cerebrasEnabled) {
      const parsed = await this._cerebrasJSON(prompt, system, { temperature, maxTokens: Math.min(maxTokens, 8192) });
      if (parsed && typeof parsed === 'object') return parsed;
    }
    if (this.openRouterEnabled) {
      const parsed = await this._openRouterJSON(prompt, system, { temperature, maxTokens: Math.min(maxTokens, 8192) });
      if (parsed && typeof parsed === 'object') return parsed;
    }
    if (this.groqEnabled) {
      for (const model of ['openai/gpt-oss-120b', 'openai/gpt-oss-20b']) {
        const parsed = await this._groqJSON(prompt, system, { temperature, maxTokens: Math.min(maxTokens, 8192), timeoutMs, model, onThrottle });
        if (parsed && typeof parsed === 'object') return parsed;
      }
    }
    return null;
  }

  // ── generateJSON: Gemini → Groq fallback ─────────────────────────────────
  /**
   * Generate structured JSON output
   * @param {string} prompt
   * @param {string} system - optional system instruction
   * @returns {Promise<object|null>}
   */
  async generateJSON(prompt, system = '', { maxTokens = 2048 } = {}) {
    // Try Gemini first (if a key is present). Reuses _geminiJSONOnce, which
    // correctly picks a real key via _pickGeminiKey() and tracks per-key
    // quota cooldowns — this method used to build the request with a
    // nonexistent `this.apiKey` (undefined), so every Gemini call here
    // silently failed auth on every attempt and always fell through to Groq
    // (or the caller's generic rule-based fallback if Groq wasn't configured).
    if (this.isEnabled()) {
      for (let attempt = 0; attempt < this.maxRetries; attempt++) {
        const parsed = await this._geminiJSONOnce(prompt, system, { temperature: 0.7, maxTokens, timeoutMs: 30000 });
        if (parsed) {
          this.callCount++;
          console.log(`[Gemini] ✅ Success (attempt ${attempt + 1}) — call #${this.callCount}`);
          return parsed;
        }
        if (this.geminiQuotaBlocked()) break;
        if (attempt < this.maxRetries - 1) {
          await new Promise(r => setTimeout(r, 1000 * (attempt + 1)));
        }
      }
      console.warn('[Gemini] All retries exhausted — trying Groq fallback');
    }

    // Groq fallback
    if (this.groqEnabled) {
      console.log('[LLM] 🔄 Attempting Groq fallback for JSON generation');
      const result = await this._groqJSON(prompt, system, { maxTokens });
      if (result) return result;
    }

    console.warn('[LLM] All providers failed — caller will use rule-based fallback');
    return null;
  }

  // ── generateText: Gemini → Groq fallback ─────────────────────────────────
  /**
   * Generate plain text
   */
  async generateText(prompt, system = '') {
    // Try Gemini first. Was previously built with a nonexistent `this.apiKey`
    // (always undefined) — every call failed auth silently and fell straight
    // to Groq. Now uses the real multi-key selector via _pickGeminiKey().
    if (this.isEnabled()) {
      const gSlot = this._pickGeminiSlot(); const key = gSlot ? gSlot.key : null;
      if (key) {
        try {
          const body = {
            contents: [{ role: 'user', parts: [{ text: prompt }] }],
            generationConfig: { temperature: 0.8, maxOutputTokens: 1024 }
          };
          if (system) body.systemInstruction = { parts: [{ text: system }] };

          const res = await LLMQueue.run(() => fetch(`${this._endpointFor(gSlot.model)}?key=${key}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
            signal: AbortSignal.timeout(20000),
          }));

          if (res.ok) {
            const data = await res.json();
            const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
            if (text) return text;
          } else if (res.status === 429) {
            const errText = await res.text().catch(() => '');
            const perDay = /GenerateRequestsPerDayPerProjectPerModel/.test(errText);
            const cooldownMs = perDay ? this._msUntilNextUtcMidnight() : 60 * 1000;
            this._geminiKeyBlockedUntil.set(gSlot.id, Date.now() + cooldownMs);
            console.warn('[Gemini] ⚠️  Quota exceeded (429) on generateText — switching to Groq');
          }
        } catch {
          // fall through to Groq
        }
      }
    }

    // Groq fallback
    if (this.groqEnabled) {
      return this._groqText(prompt, system);
    }

    return null;
  }

  // ── generateTextFast: Groq 8b-instant → Gemini fallback (Tier-3 tasks) ───
  /**
   * For simple, high-frequency text tasks (tutor chat, scheduler briefs).
   * Routes to Groq openai/gpt-oss-20b FIRST (near-free, fastest).
   * Falls back to full Gemini only if Groq is unavailable or fails.
   */
  async generateTextFast(prompt, system = '') {
    // Try fast Groq first
    if (this.groqEnabled) {
      const fast = await this._groqTextFast(prompt, system);
      if (fast) return fast;
    }
    // Fall back to standard Gemini path
    return this.generateText(prompt, system);
  }

  // ── generateJSONFast: Groq 8b-instant → Gemini fallback (medium JSON) ────
  /**
   * For medium-priority JSON tasks where 8b quality is sufficient.
   * Routes to Groq openai/gpt-oss-20b FIRST, falls back to full Gemini.
   */
  async generateJSONFast(prompt, system = '') {
    // Try fast Groq first
    if (this.groqEnabled) {
      const fast = await this._groqJSONFast(prompt, system);
      if (fast) return fast;
    }
    // Fall back to standard Gemini path (full quality)
    return this.generateJSON(prompt, system);
  }

  getStats() {
    return {
      callCount         : this.callCount,
      groqCallCount     : this.groqCallCount,
      groqFastCallCount : this.groqFastCallCount,
      openRouterCallCount : this.openRouterCallCount,
      geminiEnabled     : this.isEnabled(),
      groqEnabled       : this.groqEnabled,
      cerebrasEnabled   : this.cerebrasEnabled,
      openRouterEnabled : this.openRouterEnabled,
      model             : this.model,
      cacheStats        : LLMCache.getStats(),
      queue             : LLMQueue.getStats(),
    };
  }
}

// Singleton
export default new GeminiService();
