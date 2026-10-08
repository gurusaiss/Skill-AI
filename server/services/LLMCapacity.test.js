import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// All network is mocked: every test installs its own globalThis.fetch.
const KEY_ENV = /^(GEMINI_|GROQ_|OPENROUTER_|CEREBRAS_|GEN_|LLM_)/;
const GEM_A = 'fake-gemini-key-AAAAAAAA';
const GEM_B = 'fake-gemini-key-BBBBBBBB';
const GROQ_A = 'fake-groq-key-AAAAAAAAAA';
const GROQ_B = 'fake-groq-key-BBBBBBBBBB';
const OR_A = 'fake-openrouter-key-AAAAAA';
const OR_B = 'fake-openrouter-key-BBBBBB';

let savedEnv;
let savedFetch;

const res = (status, body, headers = {}) => ({
  ok: status >= 200 && status < 300,
  status,
  headers: { get: (h) => headers[String(h).toLowerCase()] ?? null },
  text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
  json: async () => (typeof body === 'string' ? JSON.parse(body) : body),
});
const geminiOk = () => res(200, { candidates: [{ finishReason: 'STOP', content: { parts: [{ text: JSON.stringify({ questions: [{ q: 'x' }] }) }] } }] });
const chatOk = () => res(200, { choices: [{ message: { content: JSON.stringify({ questions: [{ q: 'x' }] }) } }] });

async function load(env = {}) {
  for (const k of Object.keys(process.env)) if (KEY_ENV.test(k)) delete process.env[k];
  process.env.GEMINI_MODEL_DISCOVERY = '0';
  Object.assign(process.env, env);
  vi.resetModules();
  const { default: svc } = await import('./GeminiService.js');
  const { default: queue } = await import('./LLMQueue.js');
  return { svc, queue };
}

beforeEach(() => {
  savedEnv = { ...process.env };
  savedFetch = globalThis.fetch;
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => {
  globalThis.fetch = savedFetch;
  for (const k of Object.keys(process.env)) if (!(k in savedEnv)) delete process.env[k];
  Object.assign(process.env, savedEnv);
  vi.restoreAllMocks();
});

describe('Gemini (key, model) slots', () => {
  const env = { GEMINI_API_KEY: GEM_A, GEMINI_API_KEY_2: GEM_B, GEMINI_MODELS: 'gemini-x-flash,gemini-y-flash' };

  it('rotates least-recently-used across keys and models', async () => {
    const { svc } = await load(env);
    const urls = [];
    globalThis.fetch = vi.fn(async (url) => { urls.push(String(url)); return geminiOk(); });
    for (let i = 0; i < 4; i++) expect(await svc._geminiJSONOnce('p', '', {})).toBeTruthy();
    const slots = new Set(urls.map(u => `${u.includes(GEM_A) ? 'A' : 'B'}:${u.match(/models\/([^:]+):/)[1]}`));
    expect(slots.size).toBe(4); // all four (key, model) pairs used once
  });

  it('a per-day 429 blocks only that (key, model); sibling model and sibling key keep serving', async () => {
    const { svc } = await load(env);
    globalThis.fetch = vi.fn(async (url) => {
      if (String(url).includes(GEM_A) && String(url).includes('gemini-x-flash')) {
        return res(429, '{"error":{"details":[{"quotaId":"GenerateRequestsPerDayPerProjectPerModel-FreeTier"}]}}');
      }
      return geminiOk();
    });
    const exclude = new Set();
    // keep asking until slot A/x has been hit once
    let hit = false;
    for (let i = 0; i < 4 && !hit; i++) {
      const info = {};
      await svc._geminiJSONOnce('p', '', { info });
      hit = info.slot && info.slot.startsWith(GEM_A) && info.model === 'gemini-x-flash';
    }
    expect(hit).toBe(true);
    expect(svc._geminiUsableSlots().length).toBe(3);
    expect(svc._slotBlocked(GEM_A, 'gemini-x-flash')).toBe(true);
    expect(svc._slotBlocked(GEM_A, 'gemini-y-flash')).toBe(false);
    expect(svc._slotBlocked(GEM_B, 'gemini-x-flash')).toBe(false);
    expect(svc.geminiQuotaBlocked()).toBe(false);
    const cap = svc.llmCapacity();
    expect(cap.gemini).toMatchObject({ keys: 2, models: 2, usableSlots: 3, blockedSlots: 1 });
    // blocked slot is never picked again
    for (let i = 0; i < 6; i++) {
      const slot = svc._pickGeminiSlot();
      expect(`${slot.key}|${slot.model}`).not.toBe(`${GEM_A}|gemini-x-flash`);
    }
    void exclude;
  });

  it('requireFree skips a slot that is already busy', async () => {
    const { svc } = await load({ GEMINI_API_KEY: GEM_A, GEMINI_MODELS: 'gemini-x-flash' });
    let release;
    globalThis.fetch = vi.fn(() => new Promise((r) => { release = () => r(geminiOk()); }));
    const first = svc._geminiJSONOnce('p', '', { requireFree: true });
    expect(await svc._geminiJSONOnce('p', '', { requireFree: true })).toBeNull(); // slot busy -> no call
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    release();
    expect(await first).toBeTruthy();
  });

  it('a model that returns 404 "not found" is dropped for the process lifetime (logged once)', async () => {
    const { svc } = await load(env);
    globalThis.fetch = vi.fn(async (url) => (String(url).includes('gemini-y-flash')
      ? res(404, '{"error":{"message":"models/gemini-y-flash is not found for API version v1beta"}}')
      : geminiOk()));
    for (let i = 0; i < 6; i++) await svc._geminiJSONOnce('p', '', {});
    expect(svc._droppedModels.has('gemini-y-flash')).toBe(true);
    expect(svc._geminiModelList()).toEqual(['gemini-x-flash']);
    const warns = console.warn.mock.calls.filter(c => String(c[0]).includes('dropped for this process'));
    expect(warns.length).toBe(1);
  });

  it('retries once without thinkingConfig on a 400 and remembers the model', async () => {
    const { svc } = await load({ GEMINI_API_KEY: GEM_A, GEMINI_MODELS: 'gemini-x-flash', GEMINI_THINKING_BUDGET: '0' });
    const bodies = [];
    globalThis.fetch = vi.fn(async (url, init) => {
      const b = JSON.parse(init.body); bodies.push(b);
      return b.generationConfig.thinkingConfig ? res(400, '{"error":{"message":"Thinking budget is not supported for this model"}}') : geminiOk();
    });
    expect(await svc._geminiJSONOnce('p', '', {})).toBeTruthy();
    expect(bodies.length).toBe(2);
    expect(bodies[0].generationConfig.thinkingConfig).toBeTruthy();
    expect(bodies[1].generationConfig.thinkingConfig).toBeUndefined();
    expect(svc._droppedModels.size).toBe(0); // not dropped, only the param
    expect(await svc._geminiJSONOnce('p', '', {})).toBeTruthy();
    expect(bodies.length).toBe(3);
    expect(bodies[2].generationConfig.thinkingConfig).toBeUndefined();
  });

  it('retired models in GEMINI_MODELS are ignored', async () => {
    const { svc } = await load({ GEMINI_API_KEY: GEM_A, GEMINI_MODELS: 'gemini-1.5-flash, gemini-x-flash' });
    expect(svc._geminiModelList()).toEqual(['gemini-x-flash']);
  });
});

describe('Gemini model discovery', () => {
  const list = { models: [
    { name: 'models/gemini-9-flash', supportedGenerationMethods: ['generateContent'] },
    { name: 'models/gemini-9-flash-lite', supportedGenerationMethods: ['generateContent', 'countTokens'] },
    { name: 'models/gemini-9-flash-preview-05', supportedGenerationMethods: ['generateContent'] },
    { name: 'models/gemini-9-flash-image', supportedGenerationMethods: ['generateContent'] },
    { name: 'models/gemini-9-flash-tts', supportedGenerationMethods: ['generateContent'] },
    { name: 'models/gemini-9-flash-live', supportedGenerationMethods: ['bidiGenerateContent'] },
    { name: 'models/gemini-9-flash-thinking-exp', supportedGenerationMethods: ['generateContent'] },
    { name: 'models/gemini-9-pro', supportedGenerationMethods: ['generateContent'] },
    { name: 'models/text-embedding-004', supportedGenerationMethods: ['embedContent'] },
    { name: 'models/gemini-1.5-flash', supportedGenerationMethods: ['generateContent'] },
    { name: 'models/gemini-8-flash', supportedGenerationMethods: ['generateContent'] },
    { name: 'models/gemini-7-flash', supportedGenerationMethods: ['generateContent'] },
  ] };

  it('filters to Flash models that list generateContent, caps at 4, caches for 6h', async () => {
    const { svc } = await load({ GEMINI_API_KEY: GEM_A, GEMINI_MODEL: 'gemini-3.6-flash' });
    delete process.env.GEMINI_MODEL_DISCOVERY;
    globalThis.fetch = vi.fn(async () => res(200, list));
    await svc._ensureGeminiModels();
    const models = svc._geminiModelList();
    expect(models[0]).toBe('gemini-3.6-flash');          // configured model stays first
    expect(models.length).toBeLessThanOrEqual(4);
    for (const m of models) expect(m).toMatch(/flash/);
    for (const m of models) expect(m).not.toMatch(/image|tts|live|thinking|embed|1\.5/);
    expect(models).not.toContain('gemini-9-pro');
    await svc._ensureGeminiModels();
    await svc._ensureGeminiModels();
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);    // cached
  });

  it('fails open to the configured model when discovery errors', async () => {
    const { svc } = await load({ GEMINI_API_KEY: GEM_A, GEMINI_MODEL: 'gemini-3.6-flash' });
    delete process.env.GEMINI_MODEL_DISCOVERY;
    globalThis.fetch = vi.fn(async () => { throw new Error('network down'); });
    await svc._ensureGeminiModels();
    expect(svc._geminiModelList()).toEqual(['gemini-3.6-flash']);
    expect(svc.geminiQuotaBlocked()).toBe(false);
  });

  it('fails open on a non-OK status and never discovers when GEMINI_MODELS is set', async () => {
    const a = await load({ GEMINI_API_KEY: GEM_A });
    delete process.env.GEMINI_MODEL_DISCOVERY;
    globalThis.fetch = vi.fn(async () => res(500, 'boom'));
    await a.svc._ensureGeminiModels();
    expect(a.svc._geminiModelList().length).toBe(1);
    const b = await load({ GEMINI_API_KEY: GEM_A, GEMINI_MODELS: 'gemini-x-flash' });
    delete process.env.GEMINI_MODEL_DISCOVERY;
    globalThis.fetch = vi.fn(async () => res(200, list));
    await b.svc._ensureGeminiModels();
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });
});

describe('Groq per-key token windows', () => {
  it('a call on key B is not delayed by key A\'s full window', async () => {
    const { queue } = await load({ GROQ_API_KEY: GROQ_A, GROQ_API_KEY_2: GROQ_B });
    queue.window('groq#1').window.push({ t: Date.now(), tokens: queue.tpmLimit }); // key A window is full
    expect(queue.estimateWaitMs(3000, 'groq#1')).toBeGreaterThan(1000);
    expect(queue.estimateWaitMs(3000, 'groq#2')).toBe(0);
    const t0 = Date.now();
    await queue.run(async () => 'ok', 3000, null, { keyId: 'groq#2' });
    expect(Date.now() - t0).toBeLessThan(500);
    // default (legacy) window is independent too
    await queue.run(async () => 'ok', 3000);
    expect(Date.now() - t0).toBeLessThan(500);
  });

  it('routes to the key with the most free budget and never to a cooling key', async () => {
    const { svc, queue } = await load({ GROQ_API_KEY: GROQ_A, GROQ_API_KEY_2: GROQ_B });
    queue.window('groq#1').window.push({ t: Date.now(), tokens: 6000 });
    expect(svc._pickGroqKey(3000)).toBe(GROQ_B);
    svc._groqKeyBlockedUntil.set(GROQ_B, Date.now() + 60000);
    expect(svc._pickGroqKey(500)).toBe(GROQ_A);       // B is cooling down, so A even though it is fuller
    svc._groqKeyBlockedUntil.set(GROQ_A, Date.now() + 60000);
    expect(svc._pickGroqKey(500)).toBeNull();
    expect(svc.llmCapacity().groq).toMatchObject({ keys: 2, usableKeys: 0, tokensPerMinuteTotal: 0 });
  });

  it('a 429 on key A cools only A and the retry goes to key B immediately', async () => {
    const { svc, queue } = await load({ GROQ_API_KEY: GROQ_A, GROQ_API_KEY_2: GROQ_B });
    queue.window('groq#2').window.push({ t: Date.now(), tokens: 5000 }); // both fit, A has more free budget so A is preferred
    const auth = [];
    globalThis.fetch = vi.fn(async (url, init) => {
      auth.push(init.headers.Authorization);
      return init.headers.Authorization.includes('AAAA') ? res(429, 'Please retry in 30s', { 'retry-after': '30' }) : chatOk();
    });
    const out = await svc._groqJSON('prompt', 'sys', { maxTokens: 500 });
    expect(out?.questions?.length).toBe(1);
    expect(auth[0]).toContain('AAAA');
    expect(auth[1]).toContain('BBBB');
    expect(svc._groqKeyCooling(GROQ_A)).toBe(true);
    expect(svc._groqKeyCooling(GROQ_B)).toBe(false);
    expect(svc.counters.rl429.groq).toBe(1);
  });
});

describe('OpenRouter per-key cooldown and concurrency', () => {
  const env = { OPENROUTER_API_KEY: OR_A, OPENROUTER_API_KEY_2: OR_B };
  const orFetch = (handler) => vi.fn(async (url, init) => {
    if (String(url).includes('/models')) return res(200, { data: [{ id: 'vendor/model:free' }] });
    return handler(url, init);
  });

  it('429 cools only that key for ~60s; the other key keeps serving', async () => {
    const { svc } = await load(env);
    globalThis.fetch = orFetch((url, init) => (init.headers.Authorization.includes('AAAA') ? res(429, 'rate limited') : chatOk()));
    expect(await svc._openRouterJSON('p', '', { key: OR_A })).toBeNull();
    const left = svc._orKeyBlockedUntil.get(OR_A) - Date.now();
    expect(left).toBeGreaterThan(50000);
    expect(left).toBeLessThanOrEqual(60500);
    expect(svc._usableOpenRouterKeys()).toEqual([OR_B]);
    expect(svc._pickOpenRouterKey()).toBe(OR_B);
    expect((await svc._openRouterJSON('p', '', {}))?.questions?.length).toBe(1);
  });

  it('a daily-limit 429 cools the key until the next UTC midnight', async () => {
    const { svc } = await load(env);
    globalThis.fetch = orFetch(() => res(429, 'Rate limit exceeded: free-models-per-day'));
    await svc._openRouterJSON('p', '', { key: OR_A });
    expect(svc._orKeyBlockedUntil.get(OR_A) - Date.now()).toBeGreaterThan(60 * 1000 - 1);
    expect(svc._orKeyBlockedUntil.get(OR_A) - Date.now()).toBeLessThanOrEqual(24 * 3600 * 1000 + 6 * 60 * 1000);
    expect(svc._msUntilNextUtcMidnight()).toBeGreaterThan(0);
  });

  it('per-key concurrency: a busy key is skipped when a free one exists', async () => {
    const { svc } = await load({ ...env, OPENROUTER_MAX_CONCURRENT: '1' });
    svc._orKeyInflight.set(OR_A, 1);
    expect(svc._pickOpenRouterKey({ requireFree: true })).toBe(OR_B);
    svc._orKeyInflight.set(OR_B, 1);
    expect(svc._pickOpenRouterKey({ requireFree: true })).toBeNull();
    expect(svc._pickOpenRouterKey()).toBeTruthy();         // non-strict still returns the least busy
  });
});

describe('combined capacity and concurrency', () => {
  it('sums usable slots across providers and honours the bounds', async () => {
    const { svc } = await load({
      GEMINI_API_KEY: GEM_A, GEMINI_API_KEY_2: GEM_B, GEMINI_MODELS: 'gemini-x-flash,gemini-y-flash',
      OPENROUTER_API_KEY: OR_A, OPENROUTER_API_KEY_2: OR_B,
      GROQ_API_KEY: GROQ_A, GROQ_API_KEY_2: GROQ_B,
    });
    const { autoConcurrency } = await import('./AssessmentGenerator.js');
    const st = svc.generationStatus();
    expect(st.slots).toMatchObject({ geminiSlots: 4, gemini: 4, openrouter: 2, groq: 4, total: 10 });
    expect(autoConcurrency(st, { max: 12, queueMax: 16 })).toBe(10);
    expect(autoConcurrency(st, { max: 6, queueMax: 16 })).toBe(6);
    expect(autoConcurrency(st, { max: 12, queueMax: 5 })).toBe(4);   // one queue slot is left for interactive calls
    // slots disappear as quotas do
    svc._geminiKeyBlockedUntil.set(svc._slotId(GEM_A, 'gemini-x-flash'), Date.now() + 1e6);
    svc._groqKeyBlockedUntil.set(GROQ_A, Date.now() + 1e6);
    expect(svc.generationStatus().slots.total).toBe(7);
    // everything cooling down -> concurrency floor of 1 and no LLM
    for (const k of [GEM_A, GEM_B]) for (const m of ['gemini-x-flash', 'gemini-y-flash']) svc._geminiKeyBlockedUntil.set(svc._slotId(k, m), Date.now() + 1e6);
    svc._groqKeyBlockedUntil.set(GROQ_B, Date.now() + 1e6);
    svc._orKeyBlockedUntil.set(OR_A, Date.now() + 1e6); svc._orKeyBlockedUntil.set(OR_B, Date.now() + 1e6);
    const none = svc.generationStatus();
    expect(none.anyLLM).toBe(false);
    expect(autoConcurrency(none, { max: 12, queueMax: 16 })).toBe(1);
  });

  it('GEN_CONCURRENCY keeps overriding the auto value (config unchanged)', async () => {
    await load({ GEN_CONCURRENCY: '3' });
    const { generationConfig } = await import('./AssessmentGenerator.js');
    expect(generationConfig().concurrency).toBe(3);
  });
});

describe('llmCapacity (health)', () => {
  it('has the documented shape, counts only, and never contains key strings', async () => {
    const { svc } = await load({
      GEMINI_API_KEY: GEM_A, GEMINI_API_KEY_2: GEM_B,
      OPENROUTER_API_KEY: OR_A, GROQ_API_KEY: GROQ_A, GROQ_API_KEY_2: GROQ_B,
    });
    const cap = svc.llmCapacity();
    expect(cap).toMatchObject({
      gemini: { keys: 2, models: 1, usableSlots: 2, blockedSlots: 0 },
      openrouter: { keys: 1, usableKeys: 1 },
      groq: { keys: 2, usableKeys: 2, tokensPerMinuteTotal: 14000 },
    });
    expect(typeof cap.estimatedQuestionsPerMinute).toBe('number');
    expect(Array.isArray(cap.recommendation)).toBe(true);
    expect(cap.recommendation.join(' ')).toMatch(/GEMINI_API_KEY_n/);
    const json = JSON.stringify(cap) + JSON.stringify(svc.generationStatus()) + svc.capacityLine();
    for (const k of [GEM_A, GEM_B, GROQ_A, GROQ_B, OR_A, OR_B, 'fake-']) expect(json).not.toContain(k);
    expect(svc.capacityLine()).toMatch(/^\[GenCapacity\] gemini slots=2\/2 .* openrouter keys=1\/1 groq keys=2\/2 est ~\d+ questions\/min$/);
  });

  it('with no keys at all it reports zeros and recommends adding keys', async () => {
    const { svc } = await load({});
    const cap = svc.llmCapacity();
    expect(cap.gemini.keys).toBe(0);
    expect(cap.estimatedQuestionsPerMinute).toBe(0);
    expect(cap.recommendation.length).toBeGreaterThan(0);
  });
});
