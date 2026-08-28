/**
 * GeminiService.js — Gemini (multi-key rotation) → Cerebras → Groq fallback chain
 *
 * Question-bank generation (generateQuestionsBatch) tries, in order:
 *   1. Gemini 3.6-flash, rotating across every GEMINI_API_KEY[_N] configured.
 *      Free tier caps each KEY at 20 requests/day per model — rotating across
 *      keys from separate Google AI Studio projects multiplies that ceiling
 *      for free (each project gets its own independent quota).
 *   2. Cerebras (OpenAI-compatible), a much larger free tier (1M tokens/day,
 *      14,400 requests/day, no credit card) — a strong second option once
 *      every Gemini key is exhausted for the day.
 *   3. Groq openai/gpt-oss-120b, then openai/gpt-oss-20b — effectively
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
    this._cerebrasModelPromise = null;
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

  // ── Groq: generate JSON ───────────────────────────────────────────────────
  // onThrottle(delayMs) fires whenever this call has to wait — either for the
  // LLMQueue TPM budget (before the call) or on a 429/413 retry-after (after a
  // rejected attempt) — so callers can surface "pausing for rate limit" to the
  // user instead of the run appearing frozen.
  async _groqJSON(prompt, system = '', { temperature = 0.7, maxTokens = 2048, timeoutMs = 30000, model = 'openai/gpt-oss-120b', onThrottle = null } = {}) {
    if (!this.groqEnabled) return null;
    const estTokens = estimateGroqTokens(prompt, system, maxTokens);
    const MAX_RATE_RETRIES = 2;

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
          signal: AbortSignal.timeout(timeoutMs),
        }), estTokens, onThrottle);

        if (!res.ok) {
          const errText = await res.text();
          // Rate limited despite pacing (estimate error, or a different model
          // tier with a lower TPM cap than the shared window assumes): honor
          // Groq's requested wait and retry the SAME call rather than falling
          // straight through to a generic template.
          if ((res.status === 429 || res.status === 413) && attempt < MAX_RATE_RETRIES) {
            const waitMs = parseRetryMs(res, errText);
            if (typeof onThrottle === 'function') { try { onThrottle(waitMs); } catch { /* never break generation */ } }
            console.warn(`[Groq] rate-limited (${res.status}) on ${model} — waiting ${Math.round(waitMs / 1000)}s then retrying (attempt ${attempt + 1}/${MAX_RATE_RETRIES})`);
            await sleep(waitMs);
            continue;
          }
          throw new Error(`Groq HTTP ${res.status}: ${errText.slice(0, 200)}`);
        }

        const data = await res.json();
        const text = data.choices?.[0]?.message?.content;
        if (!text) throw new Error('Empty response from Groq');

        const parsed = JSON.parse(text);
        this.groqCallCount++;
        console.log(`[Groq] ✅ Success (${model}) — call #${this.groqCallCount}`);
        return parsed;
      } catch (err) {
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
  async _geminiJSONOnce(prompt, system = '', { temperature = 0.85, maxTokens = 16384, timeoutMs = 120000 } = {}) {
    const key = this._pickGeminiKey();
    if (!key) return null;
    try {
      const body = {
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig: { temperature, maxOutputTokens: maxTokens, responseMimeType: 'application/json' },
      };
      if (system) body.systemInstruction = { parts: [{ text: system }] };

      const res = await LLMQueue.run(() => fetch(`${this.endpoint}?key=${key}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs),
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

      const clean = text.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/```\s*$/i, '').trim();
      const parsed = JSON.parse(clean);
      this.callCount++;
      return parsed;
    } catch (err) {
      console.warn(`[Gemini] single-attempt JSON failed: ${err.message}`);
      return null;
    }
  }

  // ── generateQuestionsBatch: Groq(70b) → Groq(8b-instant) → Gemini, single attempt each ──
  // Purpose-built for AssessmentGenerator.js's bulk question generation, which
  // runs its own outer retry loop across attempts (escalating buffers, fresh
  // seeds) — this method makes exactly one attempt per provider/model tier,
  // and unwraps the `{questions: [...]}` shape the question-generation
  // prompts always request. Reuses the shared LLMQueue concurrency control
  // and Groq/Gemini credentials instead of the raw fetch calls
  // AssessmentGenerator used to make directly.
  //
  // The middle tier (openai/gpt-oss-20b) matters specifically on Groq's
  // free/on-demand tier: rate limits there are enforced PER MODEL, not per
  // account, so a request that gets hard-rejected against the 70b model's
  // tight TPM budget has a real chance of succeeding against 8b-instant's
  // separate, much larger budget — a free way to salvage a request that
  // would otherwise fall straight through to the deterministic template
  // fallback. Quality is lower than 70b but still real LLM output grounded
  // in the actual prompt, not a topic-word-substituted template.
  async generateQuestionsBatch(prompt, system = '', { temperature = 0.85, maxTokens = 16000, timeoutMs = 120000, onThrottle = null } = {}) {
    // GEMINI FIRST — this ordering matters enormously for wall-clock time.
    // Groq's free/on-demand tier allows only ~8,000 tokens/MINUTE, so a
    // multi-PDF bank needs dozens of paced calls and took 15-40+ minutes.
    // Gemini's free tier has no comparable per-minute token squeeze here
    // (measured: 20 questions returned in a single call, and 5 concurrent
    // calls all succeeded), so routing question generation to Gemini first
    // turns the same job into a couple of calls instead of dozens. Groq
    // stays as the fallback for when Gemini is unavailable or errors.
    if (this.isEnabled()) {
      const geminiTokens = Math.max(maxTokens, 8192);
      // Loop across every configured key, not just "retry once": a 429 on
      // key A immediately frees up key B (different project, independent
      // quota) on the very next iteration via _pickGeminiKey(). Bounded by
      // the actual number of keys so this can't loop forever, and stops the
      // moment every key is in cooldown (geminiQuotaBlocked()).
      const maxAttempts = Math.max(1, this.geminiKeys.length);
      for (let i = 0; i < maxAttempts; i++) {
        if (i > 0 && this.geminiQuotaBlocked()) break;
        const parsed = await this._geminiJSONOnce(prompt, system, { temperature, maxTokens: geminiTokens, timeoutMs });
        if (Array.isArray(parsed?.questions)) return parsed.questions;
      }
    }
    if (this.cerebrasEnabled) {
      const parsed = await this._cerebrasJSON(prompt, system, { temperature, maxTokens: Math.min(maxTokens, 8192) });
      if (Array.isArray(parsed?.questions)) return parsed.questions;
    }
    if (this.groqEnabled) {
      const parsed120b = await this._groqJSON(prompt, system, { temperature, maxTokens, timeoutMs, model: 'openai/gpt-oss-120b', onThrottle });
      if (Array.isArray(parsed120b?.questions)) return parsed120b.questions;

      const parsed20b = await this._groqJSON(prompt, system, { temperature, maxTokens, timeoutMs, model: 'openai/gpt-oss-20b', onThrottle });
      if (Array.isArray(parsed20b?.questions)) return parsed20b.questions;
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
    // Try Gemini first (if key is present)
    if (this.isEnabled()) {
      for (let attempt = 0; attempt < this.maxRetries; attempt++) {
        try {
          const body = {
            contents: [{ role: 'user', parts: [{ text: prompt }] }],
            generationConfig: {
              temperature: 0.7,
              maxOutputTokens: maxTokens,
              responseMimeType: 'application/json'
            }
          };
          if (system) body.systemInstruction = { parts: [{ text: system }] };

          const res = await LLMQueue.run(() => fetch(`${this.endpoint}?key=${this.apiKey}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
            signal: AbortSignal.timeout(30000),
          }));

          if (!res.ok) {
            const err = await res.text();
            const errMsg = `HTTP ${res.status}: ${err.slice(0, 200)}`;

            // 429 quota exceeded — skip remaining retries, go straight to Groq
            if (res.status === 429) {
              console.warn(`[Gemini] ⚠️  Quota exceeded (429) — switching to Groq fallback`);
              break;
            }

            throw new Error(errMsg);
          }

          const data = await res.json();
          const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
          if (!text) throw new Error('Empty response from Gemini');

          const clean = text
            .replace(/^```json\s*/i, '')
            .replace(/^```\s*/i, '')
            .replace(/```\s*$/i, '')
            .trim();

          const parsed = JSON.parse(clean);
          this.callCount++;
          console.log(`[Gemini] ✅ Success (attempt ${attempt + 1}) — call #${this.callCount}`);
          return parsed;

        } catch (err) {
          console.error(`[Gemini] ❌ Attempt ${attempt + 1}/${this.maxRetries} failed: ${err.message}`);
          if (attempt < this.maxRetries - 1) {
            await new Promise(r => setTimeout(r, 1000 * (attempt + 1)));
          }
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
    // Try Gemini first
    if (this.isEnabled()) {
      try {
        const body = {
          contents: [{ role: 'user', parts: [{ text: prompt }] }],
          generationConfig: { temperature: 0.8, maxOutputTokens: 1024 }
        };
        if (system) body.systemInstruction = { parts: [{ text: system }] };

        const res = await LLMQueue.run(() => fetch(`${this.endpoint}?key=${this.apiKey}`, {
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
          console.warn('[Gemini] ⚠️  Quota exceeded (429) on generateText — switching to Groq');
        }
      } catch {
        // fall through to Groq
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
      geminiEnabled     : this.isEnabled(),
      groqEnabled       : this.groqEnabled,
      model             : this.model,
      cacheStats        : LLMCache.getStats(),
      queue             : LLMQueue.getStats(),
    };
  }
}

// Singleton
export default new GeminiService();
