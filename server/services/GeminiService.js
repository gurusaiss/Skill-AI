/**
 * GeminiService.js — Gemini 2.0 Flash + Groq fallback
 *
 * Tiered model strategy (matches api_report.md recommendation):
 *   Tier 1 — Complex/JSON  : generateJSON()      → Gemini 2.0 Flash first, Groq 70b fallback
 *   Tier 2 — Medium/Text   : generateText()      → Gemini 2.0 Flash first, Groq 70b fallback
 *   Tier 3 — Simple/Fast   : generateTextFast()  → Groq llama-3.1-8b-instant first, Gemini fallback
 *                            generateJSONFast()  → Groq llama-3.1-8b-instant first, Gemini fallback
 *
 * All methods return null on failure — callers fall back to rule-based logic.
 */

import LLMCache from './LLMCache.js';

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
  async _groqJSON(prompt, system = '') {
    if (!this.groqEnabled) return null;
    try {
      const messages = [];
      if (system) messages.push({ role: 'system', content: system });
      messages.push({ role: 'user', content: prompt });

      const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.groqApiKey}`,
        },
        body: JSON.stringify({
          model: 'llama-3.3-70b-versatile',
          messages,
          temperature: 0.7,
          max_tokens: 2048,
          response_format: { type: 'json_object' },
        }),
        signal: AbortSignal.timeout(30000),
      });

      if (!res.ok) {
        const err = await res.text();
        throw new Error(`Groq HTTP ${res.status}: ${err.slice(0, 200)}`);
      }

      const data = await res.json();
      const text = data.choices?.[0]?.message?.content;
      if (!text) throw new Error('Empty response from Groq');

      const parsed = JSON.parse(text);
      this.groqCallCount++;
      console.log(`[Groq] ✅ Success — call #${this.groqCallCount}`);
      return parsed;
    } catch (err) {
      console.error(`[Groq] ❌ Failed: ${err.message}`);
      return null;
    }
  }

  // ── Groq: generate plain text (70b — standard fallback) ─────────────────
  async _groqText(prompt, system = '') {
    if (!this.groqEnabled) return null;
    try {
      const messages = [];
      if (system) messages.push({ role: 'system', content: system });
      messages.push({ role: 'user', content: prompt });

      const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.groqApiKey}`,
        },
        body: JSON.stringify({
          model: 'llama-3.3-70b-versatile',
          messages,
          temperature: 0.8,
          max_tokens: 1024,
        }),
        signal: AbortSignal.timeout(20000),
      });

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

      const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.groqApiKey}`,
        },
        body: JSON.stringify({
          model: 'llama-3.1-8b-instant',
          messages,
          temperature: 0.8,
          max_tokens: 512,
        }),
        signal: AbortSignal.timeout(15000),
      });

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

      const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.groqApiKey}`,
        },
        body: JSON.stringify({
          model: 'llama-3.1-8b-instant',
          messages,
          temperature: 0.7,
          max_tokens: 1024,
          response_format: { type: 'json_object' },
        }),
        signal: AbortSignal.timeout(20000),
      });

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

          const res = await fetch(`${this.endpoint}?key=${this.apiKey}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
            signal: AbortSignal.timeout(30000)
          });

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

        const res = await fetch(`${this.endpoint}?key=${this.apiKey}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(20000)
        });

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
   * Routes to Groq llama-3.1-8b-instant FIRST (near-free, fastest).
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
   * Routes to Groq llama-3.1-8b-instant FIRST, falls back to full Gemini.
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
    };
  }
}

// Singleton
export default new GeminiService();
