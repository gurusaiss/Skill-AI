/**
 * GeminiService.js — Gemini (multi-key rotation) → Cerebras → OpenRouter → Groq fallback chain
 *
 * Question-bank generation (generateQuestionsBatch) tries, in order:
 *   1. Gemini 3.6-flash, rotating across every GEMINI_API_KEY[_N] configured.
 *      Free tier caps each KEY at 20 requests/day per model — rotating across
 *      keys from separate Google AI Studio projects multiplies that ceiling
 *      for free (each project gets its own independent quota).
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
    this._geminiKeyBlockedUntil = new Map();
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
    const geminiKeysUsable = this.geminiKeys.filter(k => { const u = this._geminiKeyBlockedUntil.get(k); return !u || Date.now() >= u; }).length;
    const orOn = this.openRouterEnabled && !this.isCoolingDown('openrouter');
    const groqOn = this.groqEnabled && !this.isCoolingDown('groq');
    return {
      geminiKeysUsable,
      gemini: geminiKeysUsable > 0,
      openrouter: orOn,
      groq: groqOn,
      cerebras: this.cerebrasEnabled && !this.isCoolingDown('cerebras'),
      groqTpmLimit: LLMQueue.tpmLimit,
      anyLLM: geminiKeysUsable > 0 || orOn || groqOn || (this.cerebrasEnabled && !this.isCoolingDown('cerebras')),
    };
  }

  // ── Gemini credentials — multi-key rotation ──────────────────────────────
  // Reads GEMINI_API_KEY plus GEMINI_API_KEY_2..GEMINI_API_KEY_N. Each key is
  // expected to come from a SEPARATE Google AI Studio project — Gemini's free
  // tier quota (20 requests/day per model, confirmed live) is scoped per
  // project, so 3 keys from 3 projects genuinely triples the daily ceiling;
  // 3 keys from the same project would not.
  get geminiKeys() {
    const keys = [process.env.GEMINI_API_KEY];
    for (let i = 2; i <= MAX_GEMINI_KEYS; i++) keys.push(process.env[`GEMINI_API_KEY_${i}`]);
    return keys.filter(k => k && k.length > 10);
  }

  // First key not currently in a quota cooldown, or null if every configured
  // key is blocked. Simple round-robin-by-availability: always starts from
  // the front of the list, so a freshly-unblocked earlier key gets reused
  // before falling further down the list — the ordering doesn't matter for
  // correctness, only that a non-blocked key is found when one exists.
  _pickGeminiKey() {
    const now = Date.now();
    for (const key of this.geminiKeys) {
      const blockedUntil = this._geminiKeyBlockedUntil.get(key);
      if (!blockedUntil || now >= blockedUntil) return key;
    }
    return null;
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
    return `https://generativelanguage.googleapis.com/v1beta/models/${this.resolvedModel}:generateContent`;
  }

  // True only when EVERY configured key is currently in a quota cooldown —
  // i.e. there is truly nothing left to try. Callers skip Gemini entirely in
  // that state rather than issuing calls that cannot succeed.
  geminiQuotaBlocked() {
    return this.geminiKeys.length > 0 && this._pickGeminiKey() === null;
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
  get groqApiKey() {
    return process.env.GROQ_API_KEY || '';
  }

  get groqEnabled() {
    return !!(this.groqApiKey && this.groqApiKey.length > 10);
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
  get openRouterApiKey() {
    return process.env.OPENROUTER_API_KEY || '';
  }

  get openRouterEnabled() {
    return !!(this.openRouterApiKey && this.openRouterApiKey.length > 10);
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
  async _openRouterJSON(prompt, system = '', { temperature = 0.7, maxTokens = 4096, timeoutMs = 45000, signal = null, salvage = false } = {}) {
    if (!this.openRouterEnabled) return null;
    try {
      const model = await this._resolveOpenRouterModel();
      const messages = [];
      if (system) messages.push({ role: 'system', content: system });
      messages.push({ role: 'user', content: prompt });

      const res = await LLMQueue.run(() => fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.openRouterApiKey}`,
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
        if (res.status === 429) this.coolDown('openrouter', /per-day|free-models-per-day|daily/i.test(errText) ? this._msUntilNextUtcMidnight() : 60 * 1000, 'HTTP 429');
        else if ([401, 402, 403].includes(res.status)) this.coolDown('openrouter', 60 * 60 * 1000, `HTTP ${res.status}`);
        else if (res.status >= 500) this.coolDown('openrouter', 20 * 1000, `HTTP ${res.status}`);
        return null;
      }

      const data = await res.json();
      const text = data.choices?.[0]?.message?.content;
      if (!text) { console.warn('[OpenRouter] empty response'); return null; }

      const parsed = parseLoose(text, { salvage });
      this.openRouterCallCount++;
      console.log(`[OpenRouter] ✅ Success (${model}) — call #${this.openRouterCallCount}`);
      return parsed;
    } catch (err) {
      console.warn(`[OpenRouter] failed: ${err.message}`);
      return null;
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

        const res = await LLMQueue.run(() => fetch('https://api.groq.com/openai/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${this.groqApiKey}`,
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
        }), estTokens, onThrottle, { maxWaitMs: deadlineAt ? Math.max(0, deadlineAt - Date.now()) : undefined, onResume });

        if (!res.ok) {
          const errText = await res.text();
          // Rate limited despite pacing (estimate error, or a different model
          // tier with a lower TPM cap than the shared window assumes): honor
          // Groq's requested wait and retry the SAME call rather than falling
          // straight through to a generic template.
          if ((res.status === 429 || res.status === 413) && attempt < MAX_RATE_RETRIES) {
            const waitMs = parseRetryMs(res, errText);
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
  async _geminiJSONOnce(prompt, system = '', { temperature = 0.85, maxTokens = 16384, timeoutMs = 120000, signal = null, salvage = false } = {}) {
    // Least-busy usable key (not simply the first): concurrent bulk-generation
    // calls spread across every configured project's key.
    const key = this._pickGeminiKeyBalanced();
    if (!key) return null;
    this._geminiInflight.set(key, (this._geminiInflight.get(key) || 0) + 1);
    try {
      const body = {
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig: { temperature, maxOutputTokens: maxTokens, responseMimeType: 'application/json' },
      };
      // Optional cap on the thinking model's reasoning tokens (unset = model
      // default). Exposed as an env knob because reasoning tokens are a large
      // share of Gemini latency for this schema-filling task.
      const thinking = parseInt(process.env.GEMINI_THINKING_BUDGET || '', 10);
      if (Number.isFinite(thinking) && thinking >= 0) body.generationConfig.thinkingConfig = { thinkingBudget: thinking };
      if (system) body.systemInstruction = { parts: [{ text: system }] };

      const res = await LLMQueue.run(() => fetch(`${this.endpoint}?key=${key}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: mkSignal(timeoutMs, signal),
      }));
      // Surface WHY a call failed instead of returning a silent null — a 404
      // (retired model), a 429 (quota) and a truncated body are completely
      // different problems, and an opaque null previously made a retired
      // model name look like an exhausted quota for weeks.
      if (!res.ok) {
        const errText = await res.text().catch(() => '');
        // Gemini's FREE tier allows only 20 requests per DAY per model, PER
        // KEY (quotaId GenerateRequestsPerDayPerProjectPerModel-FreeTier).
        // Block only THIS key — a sibling key from a different project is
        // unaffected and generateQuestionsBatch's retry will pick it up.
        if (res.status === 429) {
          const perDay = /GenerateRequestsPerDayPerProjectPerModel/.test(errText);
          const cooldownMs = perDay ? this._msUntilNextUtcMidnight() : 60 * 1000;
          this._geminiKeyBlockedUntil.set(key, Date.now() + cooldownMs);
          const now = Date.now();
          const remaining = this.geminiKeys.filter(k => {
            if (k === key) return false;
            const until = this._geminiKeyBlockedUntil.get(k);
            return !until || now >= until;
          }).length;
          console.warn(`[Gemini] key ...${key.slice(-4)} hit ${perDay ? 'its per-DAY free-tier quota' : 'a short-term rate limit'} — cooling down ${Math.round(cooldownMs / 60000)}min. ${remaining > 0 ? `${remaining} other key(s) still available.` : 'No other keys available — falling to Cerebras/Groq.'}`);
          return null;
        }
        console.warn(`[Gemini] HTTP ${res.status} on ${this.resolvedModel}: ${errText.slice(0, 200)}`);
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
      this._geminiInflight.set(key, Math.max(0, (this._geminiInflight.get(key) || 1) - 1));
    }
  }

  // Usable (not quota-blocked) key with the fewest calls in flight.
  _pickGeminiKeyBalanced() {
    const now = Date.now();
    let best = null, bestLoad = Infinity;
    for (const key of this.geminiKeys) {
      const blockedUntil = this._geminiKeyBlockedUntil.get(key);
      if (blockedUntil && now < blockedUntil) continue;
      const load = this._geminiInflight.get(key) || 0;
      if (load < bestLoad) { best = key; bestLoad = load; }
    }
    return best;
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

    if (this.isEnabled() && !this.geminiQuotaBlocked()) {
      const geminiTokens = Math.max(maxTokens, 8192);
      const maxAttempts = Math.max(1, this.geminiKeys.length);
      for (let i = 0; i < maxAttempts; i++) {
        if ((i > 0 && this.geminiQuotaBlocked()) || left() < 4000 || signal?.aborted) break;
        const q = out(await this._geminiJSONOnce(prompt, system, { temperature, maxTokens: geminiTokens, timeoutMs: callTimeout(), signal, salvage }));
        if (q) return done(q, 'gemini');
      }
    }
    if (this.cerebrasEnabled && !this.isCoolingDown('cerebras') && left() >= 4000 && !signal?.aborted) {
      const q = out(await this._cerebrasJSON(prompt, system, { temperature, maxTokens: Math.min(maxTokens, 8192) }));
      if (q) return done(q, 'cerebras');
      this.coolDown('cerebras', 5 * 60 * 1000, 'no usable response');
    }
    if (this.openRouterEnabled && !this.isCoolingDown('openrouter') && this._inflight.openrouter < parseInt(process.env.OPENROUTER_MAX_CONCURRENT || '1', 10) && left() >= 6000 && !signal?.aborted) {
      this._inflight.openrouter++;
      try {
        const q = out(await this._openRouterJSON(prompt, system, { temperature, maxTokens: Math.min(maxTokens, 8192), timeoutMs: Math.min(60000, callTimeout()), signal, salvage }));
        if (q) return done(q, 'openrouter');
      } finally { this._inflight.openrouter--; }
    }
    // A request whose own prompt + max_tokens exceeds the whole per-minute budget is rejected with HTTP 413
    // no matter how long we wait — do not even send it.
    const groqFits = estimateGroqTokens(prompt, system, maxTokens) <= (LLMQueue.tpmLimit || 7000);
    if (this.groqEnabled && groqFits && !this.isCoolingDown('groq') && !signal?.aborted) {
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
      const maxAttempts = Math.max(1, this.geminiKeys.length);
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
      const key = this._pickGeminiKey();
      if (key) {
        try {
          const body = {
            contents: [{ role: 'user', parts: [{ text: prompt }] }],
            generationConfig: { temperature: 0.8, maxOutputTokens: 1024 }
          };
          if (system) body.systemInstruction = { parts: [{ text: system }] };

          const res = await LLMQueue.run(() => fetch(`${this.endpoint}?key=${key}`, {
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
            this._geminiKeyBlockedUntil.set(key, Date.now() + cooldownMs);
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
