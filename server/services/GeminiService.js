/**
 * GeminiService.js — Gemini 2.0 Flash + Groq fallback
 *
 * Tiered model strategy (matches api_report.md recommendation):
 *   Tier 1 — Complex/JSON  : generateJSON()      → Gemini 2.0 Flash first, Groq 70b fallback
 *   Tier 2 — Medium/Text   : generateText()      → Gemini 2.0 Flash first, Groq 70b fallback
 *   Tier 3 — Simple/Fast   : generateTextFast()  → Groq openai/gpt-oss-20b first, Gemini fallback
 *                            generateJSONFast()  → Groq openai/gpt-oss-20b first, Gemini fallback
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

class GeminiService {
  constructor() {
    this.model = 'gemini-2.0-flash';
    this.maxRetries = 3;
    this.callCount = 0;
    this.groqCallCount = 0;
    this.groqFastCallCount = 0;
  }

  // ── Gemini credentials ────────────────────────────────────────────────────
  get apiKey() {
    return process.env.GEMINI_API_KEY || '';
  }

  get endpoint() {
    const model = process.env.GEMINI_MODEL || this.model;
    return `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;
  }

  isEnabled() {
    return !!(this.apiKey && this.apiKey.length > 10);
  }

  // ── Groq credentials ──────────────────────────────────────────────────────
  get groqApiKey() {
    return process.env.GROQ_API_KEY || '';
  }

  get groqEnabled() {
    return !!(this.groqApiKey && this.groqApiKey.length > 10);
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
  async _geminiJSONOnce(prompt, system = '', { temperature = 0.85, maxTokens = 16384, timeoutMs = 30000 } = {}) {
    if (!this.isEnabled()) return null;
    try {
      const body = {
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig: { temperature, maxOutputTokens: maxTokens, responseMimeType: 'application/json' },
      };
      if (system) body.systemInstruction = { parts: [{ text: system }] };

      const res = await LLMQueue.run(() => fetch(`${this.endpoint}?key=${this.apiKey}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs),
      }));
      if (!res.ok) return null;

      const data = await res.json();
      const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
      if (!text) return null;

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
  async generateQuestionsBatch(prompt, system = '', { temperature = 0.85, maxTokens = 16000, timeoutMs = 30000, onThrottle = null } = {}) {
    if (this.groqEnabled) {
      const parsed70b = await this._groqJSON(prompt, system, { temperature, maxTokens, timeoutMs, model: 'openai/gpt-oss-120b', onThrottle });
      if (Array.isArray(parsed70b?.questions)) return parsed70b.questions;

      const parsed8b = await this._groqJSON(prompt, system, { temperature, maxTokens, timeoutMs, model: 'openai/gpt-oss-20b', onThrottle });
      if (Array.isArray(parsed8b?.questions)) return parsed8b.questions;
    }
    if (this.isEnabled()) {
      const parsed = await this._geminiJSONOnce(prompt, system, { temperature, maxTokens: Math.max(maxTokens, 16384), timeoutMs });
      if (Array.isArray(parsed?.questions)) return parsed.questions;
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
  async generateJSON(prompt, system = '') {
    // Try Gemini first (if key is present)
    if (this.isEnabled()) {
      for (let attempt = 0; attempt < this.maxRetries; attempt++) {
        try {
          const body = {
            contents: [{ role: 'user', parts: [{ text: prompt }] }],
            generationConfig: {
              temperature: 0.7,
              maxOutputTokens: 2048,
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
      const result = await this._groqJSON(prompt, system);
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
