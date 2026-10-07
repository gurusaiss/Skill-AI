/**
 * QuestionChunkCache.js — persistent content-hash cache of ACCEPTED, GROUNDED
 * LLM questions per source chunk.
 *
 * Key = hash(chunk text + generation parameters that change what the model is
 * asked). Regenerating a role whose files did not change therefore needs no LLM
 * call for those chunks: the cached questions come back instantly.
 *
 * What is stored is the filtered output of a call (grounded against the chunk,
 * non-generic) BEFORE cross-version / cross-file dedup — so it stays reusable.
 * Callers must still run every cached question through their own seen-tracker /
 * avoid-list; a cache hit never bypasses "don't repeat deleted or previous
 * questions".
 *
 * Storage: one JSON file (default server/data/qgen-chunk-cache.json — covered by
 * the repo's `server/data/*.json` ignore rule). Loaded lazily, written
 * atomically (tmp + rename) with a debounce; LRU-capped. Disable with
 * GEN_CACHE=0. Every disk failure degrades to an in-memory cache.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { hashString } from './TextRanking.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_FILE = path.join(__dirname, '..', 'data', 'qgen-chunk-cache.json');

export function chunkCacheKey(chunkText, params = {}) {
  const p = Object.keys(params).sort().map(k => `${k}=${params[k]}`).join('&');
  return hashString(String(chunkText || '').replace(/\s+/g, ' ').trim() + '\u0001' + p);
}

export class QuestionChunkCache {
  constructor({ file = DEFAULT_FILE, maxEntries = 600, ttlMs = 30 * 24 * 60 * 60 * 1000, maxPerEntry = 40, flushDelayMs = 1500, enabled = process.env.GEN_CACHE !== '0', persist = true } = {}) {
    this.file = file; this.maxEntries = maxEntries; this.ttlMs = ttlMs; this.maxPerEntry = maxPerEntry; this.flushDelayMs = flushDelayMs;
    this.enabled = enabled; this.persist = persist; this.map = null; this._timer = null; this.hits = 0; this.misses = 0;
  }
  _load() {
    if (this.map) return;
    this.map = new Map();
    if (!this.enabled || !this.persist) return;
    try {
      const raw = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      for (const [k, v] of Object.entries(raw.entries || {})) if (v && Array.isArray(v.q)) this.map.set(k, v);
    } catch { /* missing/corrupt cache file = start empty */ }
  }
  /** @returns {object[]|null} deep-cloned cached questions, or null on miss/expiry */
  get(key) {
    if (!this.enabled) return null;
    this._load();
    const e = this.map.get(key);
    if (!e || Date.now() - e.t > this.ttlMs || !e.q.length) { this.misses++; return null; }
    e.u = Date.now(); this.hits++;
    return JSON.parse(JSON.stringify(e.q));
  }
  /** Stores (merging with any existing entry, de-duplicated by question text). */
  set(key, questions) {
    if (!this.enabled || !Array.isArray(questions) || questions.length === 0) return;
    this._load();
    const prev = this.map.get(key);
    const seen = new Set(); const merged = [];
    for (const q of [...(prev?.q || []), ...questions]) {
      const t = String(q?.question || '').trim().toLowerCase();
      if (!t || seen.has(t)) continue;
      seen.add(t);
      const { id, createdAt, qualityScore, ...rest } = q; // identity/time stamps are assigned per run
      merged.push(rest);
    }
    this.map.set(key, { t: prev?.t || Date.now(), u: Date.now(), q: merged.slice(0, this.maxPerEntry) });
    if (this.map.size > this.maxEntries) {
      const oldest = [...this.map.entries()].sort((a, b) => (a[1].u || 0) - (b[1].u || 0)).slice(0, this.map.size - this.maxEntries);
      for (const [k] of oldest) this.map.delete(k);
    }
    this._scheduleFlush();
  }
  _scheduleFlush() {
    if (!this.persist || this._timer) return;
    this._timer = setTimeout(() => { this._timer = null; this.flush(); }, this.flushDelayMs);
    this._timer.unref?.();
  }
  flush() {
    if (!this.enabled || !this.persist || !this.map) return;
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      const tmp = `${this.file}.${process.pid}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify({ v: 1, entries: Object.fromEntries(this.map) }));
      fs.renameSync(tmp, this.file);
    } catch (err) { console.warn(`[QuestionChunkCache] could not persist cache (${err.message}) — continuing in-memory`); }
  }
  clear() { this.map = new Map(); this._scheduleFlush(); }
  stats() { return { entries: this.map ? this.map.size : 0, hits: this.hits, misses: this.misses }; }
}

export default new QuestionChunkCache();
