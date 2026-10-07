/**
 * TextRanking.js — small, dependency-free classical NLP / IR toolkit used by the
 * question-generation pipeline. No models, no network:
 *
 *   - sentence + structure segmentation that keeps ORIGINAL character offsets
 *     (so a sentence or a clause of it is always a verbatim substring of the
 *     source — the property verifyQuoteGrounded depends on)
 *   - tokenization / stopwords / light stemming
 *   - BM25 index (chunk ranking, ranking an avoid-list against a chunk)
 *   - per-sentence "informativeness" (entity / number / rule-cue density) and
 *     per-chunk density used to send LLM calls to rich passages first
 *   - RAKE-style key-phrase extraction + typed span extraction (numbers, codes,
 *     proper-noun phrases) used by the extractive question generator
 *   - 64-bit simhash + hamming distance and k-shingle Jaccard for near-duplicate
 *     detection; seeded PRNG for deterministic selection.
 */

// ── hashing / rng ────────────────────────────────────────────────────────────
export function fnv1a(str, seed = 0x811c9dc5) {
  let h = seed >>> 0;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return h >>> 0;
}
export function hashString(str) {
  return fnv1a(str).toString(16).padStart(8, '0') + fnv1a(str, 0x9e3779b9).toString(16).padStart(8, '0');
}
export function makeRng(seed) {
  let a = fnv1a(String(seed ?? 'seed')) || 1;
  return function rng() {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
export function shuffled(arr, rng) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}

// ── tokenization ─────────────────────────────────────────────────────────────
export const STOPWORDS = new Set((
  'a an the and or but if then else of in on at to for with by from up about into over after before between through during under above ' +
  'is are was were be been being am do does did done have has had having will would could should may might must shall can cannot ' +
  'this that these those it its they them their there here which who whom whose what when where why how not no nor so as than too very ' +
  'also each any all both either neither some such other another own same only just more most less least much many few per via ' +
  'i we you your our us he she his her him one two three first second third within without upon onto out off again further once ' +
  'being get gets got make makes made use used using ensure ensures ensured must').split(/\s+/));

export function tokenize(s) {
  return (String(s || '').toLowerCase().match(/[a-z0-9]+(?:[.'-][a-z0-9]+)*/g) || []);
}
export function stemToken(w) {
  return w.replace(/ing$/, '').replace(/tions?$/, 't').replace(/ments?$/, '').replace(/ies$/, 'y').replace(/ers?$/, '').replace(/es$/, '').replace(/s$/, '');
}
export function contentTokens(s, { stem = false } = {}) {
  const t = tokenize(s).filter(w => w.length > 2 && !STOPWORDS.has(w));
  return stem ? t.map(stemToken) : t;
}
export function collapseWs(s) { return String(s || '').replace(/\s+/g, ' ').trim(); }

// ── segmentation ─────────────────────────────────────────────────────────────
const ABBREV = new Set(['e.g', 'i.e', 'etc', 'vs', 'mr', 'mrs', 'ms', 'dr', 'no', 'nos', 'fig', 'approx', 'inc', 'ltd', 'co', 'st', 'sr', 'jr', 'cf', 'viz', 'dept', 'est', 'min', 'max', 'ref', 'tel', 'ext']);
const LIST_RE = /^\s*(?:step\s*\d+\s*[:.)\-–—]?|\(?\d{1,3}[.)]\s+|\(?[a-zA-Z][.)]\s+|[-•*–▪●○◦]\s+)/i;
const SECTION_NUM_RE = /^\s*\d+(?:\.\d+)*[.)]?\s+\S/;

export function isListItem(line) { return LIST_RE.test(line); }

export function looksLikeHeading(line) {
  const t = line.trim();
  if (!t || t.length > 90) return false;
  const words = t.split(/\s+/);
  if (words.length > 12) return false;
  if (/^step\s*\d+/i.test(t)) return false; // procedure steps are content, not headings
  if (/[.!?;,]$/.test(t)) return false;
  if ((t.match(/,/g) || []).length > 1) return false;
  const smallWords = ['and', 'of', 'the', 'for', 'to', 'in', 'a', 'on', '&', '-', '–', '—', '|', 'or', 'by', 'with'];
  const capRatio = (ws) => ws.length ? ws.filter(w => /^[A-Z0-9(]/.test(w) || smallWords.includes(w.toLowerCase())).length / ws.length : 0;
  const numbered = /^\s*(\d+(?:\.\d+)*)[.)]?\s+(.+)$/.exec(t);
  if (numbered) {
    const rest = numbered[2].split(/\s+/);
    return rest.length <= 10 && capRatio(rest) >= (numbered[1].includes('.') ? 0.5 : 0.75);
  }
  if (/:$/.test(t) && words.length <= 8) return true;
  const letters = t.replace(/[^A-Za-z]/g, '');
  if (letters.length >= 4 && letters === letters.toUpperCase()) return true;
  return words.length <= 9 && capRatio(words) >= 0.8 && !/^\s*(?:[-•*–▪●○◦])\s/.test(t);
}

/**
 * Splits text into sentence-like units, preserving offsets.
 * @returns {{sentences: Array<{i:number,start:number,end:number,text:string,kind:string,section:string|null,para:number}>, headings: Array}}
 */
export function segment(text) {
  const src = String(text || '');
  // 1. lines with offsets
  const lines = [];
  let pos = 0;
  for (const raw of src.split('\n')) {
    lines.push({ raw, start: pos, end: pos + raw.length });
    pos += raw.length + 1;
  }
  // 2. group lines into paragraphs (merge hard-wrapped lines of prose)
  const paras = [];
  let cur = null;
  const flush = () => { if (cur) { paras.push(cur); cur = null; } };
  for (const ln of lines) {
    const t = ln.raw.trim();
    if (!t) { flush(); continue; }
    const head = looksLikeHeading(ln.raw);
    const list = !head && isListItem(ln.raw);
    if (list || head) { flush(); paras.push({ start: ln.start + (ln.raw.length - ln.raw.trimStart().length), end: ln.start + ln.raw.trimEnd().length, kind: list ? 'step' : 'heading' }); continue; }
    const s0 = ln.start + (ln.raw.length - ln.raw.trimStart().length);
    const e0 = ln.start + ln.raw.trimEnd().length;
    if (cur && cur.lastLen >= 55 && !/[.!?:;]$/.test(cur.lastText) ) { cur.end = e0; cur.lastLen = t.length; cur.lastText = t; }
    else { flush(); cur = { start: s0, end: e0, kind: 'text', lastLen: t.length, lastText: t }; }
  }
  flush();

  // 3. sentence split within text paragraphs
  const sentences = [];
  const headings = [];
  let section = null; let paraNo = 0;
  const push = (start, end, kind) => {
    const text = collapseWs(src.slice(start, end));
    if (!text) return;
    sentences.push({ i: sentences.length, start, end, text, kind, section, para: paraNo });
  };
  for (const p of paras) {
    paraNo++;
    if (p.kind === 'heading') { const h = collapseWs(src.slice(p.start, p.end)).replace(/:$/, ''); if (!isMetadataLine(h)) { section = h; headings.push({ text: section, start: p.start }); } continue; }
    if (p.kind === 'step') {
      const stepText = src.slice(p.start, p.end);
      // a step line holding several sentences is split; short ones stay whole
      if (stepText.split(/\s+/).length <= 40) { push(p.start, p.end, kind_of(stepText)); continue; }
    }
    const seg = src.slice(p.start, p.end);
    const re = /[.!?]["')\]]*\s+/g;
    let last = 0; let m;
    while ((m = re.exec(seg)) !== null) {
      const before = seg.slice(last, m.index + 1);
      const lastWord = (/([A-Za-z.]+)\.$/.exec(before) || [])[1] || '';
      const next = seg.slice(m.index + m[0].length, m.index + m[0].length + 1);
      const isAbbrev = ABBREV.has(lastWord.toLowerCase().replace(/\.$/, '')) || /^[A-Z]$/.test(lastWord) || /\d$/.test(before.slice(0, -1)) && /^\d/.test(next);
      if (isAbbrev && seg[m.index] === '.') continue;
      if (!/[A-Z0-9"“'(\[]/.test(next)) continue;
      push(p.start + last, p.start + m.index + m[0].trimEnd().length, p.kind === 'step' ? 'step' : 'sentence');
      last = m.index + m[0].length;
    }
    if (last < seg.length) push(p.start + last, p.end, p.kind === 'step' ? 'step' : 'sentence');
  }
  // classify kv rows (short "Key - value" / "Key: value" lines without a verb-ish tail)
  for (const s of sentences) {
    if (s.kind === 'sentence' && !/[.!?]$/.test(s.text) && s.text.split(/\s+/).length <= 14 && parseKeyValue(s.text)) s.kind = 'kv';
  }
  return { sentences, headings };
}
function kind_of(t) {
  const x = t.trim();
  if (/^step\s*\d+|^\(?\d{1,3}[.)]\s|^\(?[a-zA-Z][.)]\s|^[-•*–▪●○◦]\s/i.test(x)) return 'step';
  return 'sentence';
}

/** Parses "Step 3: Foo" / "3. Foo" / "(c) Foo" → {n, label, body} or null */
export function parseStepLine(text) {
  const m = /^\s*(?:step\s*(\d{1,3})\s*[:.)\-–—]?|\(?(\d{1,3})[.)]|\(?([a-zA-Z])[.)])\s*(.+)$/i.exec(text);
  if (!m) return null;
  const n = m[1] ? +m[1] : m[2] ? +m[2] : null;
  return { n, letter: m[3] || null, body: m[4].trim() };
}

/** Parses "Key - value" / "Key: value" table-ish rows. */
export function parseKeyValue(text) {
  const m = /^\s*([A-Za-z][A-Za-z0-9 /&()'’-]{2,40}?)\s*(?::|\s[-–—]\s|\t|\s\|\s)\s*(\S.{0,70})$/.exec(text);
  if (!m) return null;
  const key = m[1].trim(); const val = m[2].trim().replace(/[.]$/, '');
  if (key.split(/\s+/).length > 6 || /[.!?]$/.test(key)) return null;
  if (val.split(/\s+/).length > 12) return null;
  return { key, value: val };
}

// ── metadata / boilerplate detection ─────────────────────────────────────────
const METADATA_RES = [
  /\bpage \d+( of \d+)?\b/i, /\bversion \d+(\.\d+)*\b/i, /\bconfidential\b/i, /\bcopyright\b|©/i, /\bfile ?name\b/i,
  /\.(docx?|pdf|xlsx?|pptx?)\b/i, /\bauthor(ed)? by\b/i, /\breviewed by\b/i, /\bapproved by\b/i, /\ball rights reserved\b/i,
  /\bdocument (id|number|owner|control)\b/i, /\brevision history\b/i, /\btable of contents\b/i, /\bprepared by\b/i, /\bdate (issued|created|modified)\b/i,
  /\bmr\.\s|\bmrs\.\s|\bms\.\s|\bdr\.\s/i, /^\s*(?:v|rev)\.?\s*\d/i,
];
export function isMetadataLine(text) { return METADATA_RES.some(re => re.test(text)); }

// ── sentence informativeness ─────────────────────────────────────────────────
const RULE_CUES = /\b(must|shall|should|required|requires?|may not|must not|cannot|never|always|only|at least|at most|no later than|no more than|not exceed|exceeds?|within|prior to|before|after|unless|if|when|whenever|once|except|otherwise|escalat\w*|reject\w*|approv\w*|threshold|limit|maximum|minimum|mandatory)\b/i;
const NUM_RE = /\b\d[\d,]*(?:\.\d+)?\s?(?:%|percent|hours?|hrs?|days?|minutes?|mins?|weeks?|months?|years?|business\s+days?|usd|eur|gbp|inr|\$|€|£|k|mb|gb|kb)?/gi;
const CODE_RE = /\b[A-Z]{1,5}[-_ ]?\d{2,}[A-Z0-9-]*\b|\b[A-Z]{2,}\d+\b/g;
const PROPER_RE = /\b[A-Z][A-Za-z0-9]{2,}(?:[ \t]+(?:[A-Z][A-Za-z0-9]*|\d+)){1,3}\b/g;

export function sentenceInformativeness(text) {
  const words = text.split(/\s+/).filter(Boolean);
  const n = words.length;
  if (n < 5 || n > 60) return 0;
  if (isMetadataLine(text)) return 0;
  let s = 0;
  const nums = (text.match(NUM_RE) || []).filter(x => /\d/.test(x));
  const codes = text.match(CODE_RE) || [];
  const props = (text.slice(1).match(PROPER_RE) || []).length;
  s += Math.min(3, nums.length) * 1.2;
  s += Math.min(2, codes.length) * 1.5;
  s += Math.min(3, props) * 0.8;
  if (RULE_CUES.test(text)) s += 2;
  if (/^step\s*\d+|^\d{1,2}[.)]\s/i.test(text)) s += 1.5;
  // length sweet spot 9..30 words
  if (n >= 9 && n <= 30) s += 1; else if (n < 7) s -= 1;
  if (!/[.!?]$/.test(text) && !/^step\s*\d+|^\d{1,2}[.)]\s/i.test(text) && !parseKeyValue(text)) s -= 1;
  return Math.max(0, s);
}

/**
 * Density of a chunk of text: how much question-worthy, document-specific
 * content it holds. `info` is the summed sentence informativeness (capacity),
 * `density` the per-sentence average. Near-duplicate (boilerplate repeated on
 * every page) sentences are counted once via simhash.
 */
export function chunkDensity(text) {
  const { sentences } = segment(text);
  const seen = [];
  let info = 0, good = 0, n = 0;
  for (const s of sentences) {
    n++;
    const v = sentenceInformativeness(s.text);
    if (v <= 0) continue;
    const h = simhash(tokenize(s.text));
    if (seen.some(x => hamming(x, h) <= 2)) continue;
    seen.push(h);
    info += v; if (v >= 3) good++;
  }
  return { info, good, sentences: n, density: n ? info / n : 0 };
}

// ── BM25 ─────────────────────────────────────────────────────────────────────
export class BM25 {
  constructor(docsTokens, { k1 = 1.2, b = 0.75 } = {}) {
    this.k1 = k1; this.b = b; this.N = docsTokens.length;
    this.docs = docsTokens.map(t => { const tf = new Map(); for (const w of t) tf.set(w, (tf.get(w) || 0) + 1); return { tf, len: t.length }; });
    this.avgdl = this.docs.reduce((a, d) => a + d.len, 0) / Math.max(1, this.N) || 1;
    this.df = new Map();
    for (const d of this.docs) for (const w of d.tf.keys()) this.df.set(w, (this.df.get(w) || 0) + 1);
  }
  idf(w) { const df = this.df.get(w) || 0; return Math.log(1 + (this.N - df + 0.5) / (df + 0.5)); }
  score(queryTokens, docIdx) {
    const d = this.docs[docIdx]; if (!d) return 0;
    let s = 0;
    for (const w of new Set(queryTokens)) {
      const f = d.tf.get(w); if (!f) continue;
      s += this.idf(w) * (f * (this.k1 + 1)) / (f + this.k1 * (1 - this.b + this.b * d.len / this.avgdl));
    }
    return s;
  }
  rank(queryTokens, topK = 10) {
    const out = [];
    for (let i = 0; i < this.N; i++) { const s = this.score(queryTokens, i); if (s > 0) out.push({ i, score: s }); }
    return out.sort((a, b) => b.score - a.score).slice(0, topK);
  }
}

// ── key phrases / typed spans ────────────────────────────────────────────────
const VERBISH = new Set(('must shall should will would could may might can cannot is are was were be been being has have had do does did verify validate review approve reject submit send enter open close check confirm ' +
  'record log update escalate forward notify attach archive release inspect ensure provide include contain require requires required follow take make use used').split(' '));

/** Doc-wide statistics reused by span extraction and distractor selection. */
export function buildDocStats(sentences) {
  const df = new Map(); const tf = new Map();
  for (const s of sentences) {
    const toks = contentTokens(s.text);
    for (const w of new Set(toks)) df.set(w, (df.get(w) || 0) + 1);
    for (const w of toks) tf.set(w, (tf.get(w) || 0) + 1);
  }
  return { df, tf, N: Math.max(1, sentences.length), idf(w) { return Math.log(1 + this.N / (1 + (this.df.get(w) || 0))); } };
}

/**
 * Typed candidate answer spans of a sentence. Offsets are relative to `text`.
 * type: number | code | entity | phrase
 */
export function extractSpans(text, stats = null) {
  const spans = [];
  const taken = [];
  const free = (a, b) => !taken.some(([x, y]) => a < y && b > x);
  const add = (type, start, end, score) => {
    if (end <= start || !free(start, end)) return;
    const t = text.slice(start, end);
    taken.push([start, end]);
    spans.push({ type, text: t, start, end, score });
  };
  let m;
  // codes first
  const codeRe = new RegExp(CODE_RE.source, 'g');
  while ((m = codeRe.exec(text)) !== null) add('code', m.index, m.index + m[0].length, 3);
  // numbers with units
  const numRe = /\b\d[\d,]*(?:\.\d+)?(?:\s?(?:%|percent|hours?|hrs?|days?|minutes?|mins?|weeks?|months?|years?|business\s+days?|USD|EUR|GBP|INR)\b|%)?/gi;
  while ((m = numRe.exec(text)) !== null) {
    const tok = m[0].trim();
    if (!/\d/.test(tok)) continue;
    // skip list markers like "3." at the very start and 4-digit years inside dates is allowed
    if (m.index === 0 && /^\d{1,3}$/.test(tok)) continue;
    if (/\b(?:step|section|item|clause|table|figure|page)\s*$/i.test(text.slice(Math.max(0, m.index - 9), m.index))) continue; // list/section markers, not facts
    const hasUnit = /[a-z%]/i.test(tok);
    add('number', m.index, m.index + tok.length, hasUnit ? 3 : 1.5);
  }
  // proper-noun phrases (skip sentence-initial single capital)
  const propRe = /\b[A-Z][A-Za-z0-9]{2,}(?:[ \t]+(?:[A-Z][A-Za-z0-9]*|\d+)){0,3}\b/g;
  while ((m = propRe.exec(text)) !== null) {
    const phrase = m[0];
    const multi = /\s/.test(phrase);
    if (!multi && m.index === 0) continue;
    if (!multi && STOPWORDS.has(phrase.toLowerCase())) continue;
    if (/^(?:Step|Section|Page|Table|Figure|Version|Item|Clause)\b/i.test(phrase)) continue;
    // strip a leading sentence-initial determiner-ish capital word
    let start = m.index; let p = phrase;
    const parts = p.split(/\s+/);
    if (start === 0 && parts.length > 1 && STOPWORDS.has(parts[0].toLowerCase())) { start += parts[0].length + 1; p = parts.slice(1).join(' '); }
    if (p.length < 4) continue;
    add('entity', start, start + p.length, multi ? 2.5 : 1.8);
  }
  // quoted terms
  const qRe = /["“]([^"”]{3,40})["”]/g;
  while ((m = qRe.exec(text)) !== null) add('phrase', m.index + 1, m.index + 1 + m[1].length, 2);
  // RAKE-ish runs of non-stop, non-verb words (max 4 words)
  const wRe = /[A-Za-z][A-Za-z0-9'-]*|[,;:.()]/g;
  let run = [];
  const flushRun = () => {
    if (run.length) {
      const first = run[0], last = run[run.length - 1];
      const nonNum = run.filter(w => !/^\d/.test(w.t));
      if (nonNum.length && last.e - first.s >= 4) {
        const words = nonNum.map(w => w.t.toLowerCase());
        const score = words.reduce((a, w) => a + (stats ? stats.idf(w) : 1), 0) / Math.sqrt(words.length) * 0.6 + (run.length > 1 ? 0.4 : 0);
        add('phrase', first.s, last.e, Math.min(2.4, score));
      }
    }
    run = [];
  };
  while ((m = wRe.exec(text)) !== null) {
    const t = m[0];
    const lw = t.toLowerCase();
    if (/^[,;:.()]$/.test(t) || STOPWORDS.has(lw) || VERBISH.has(lw) || /(?:ed|ing|ly)$/.test(lw) && lw.length > 5) { flushRun(); continue; }
    if (run.length >= 4) flushRun();
    run.push({ t, s: m.index, e: m.index + t.length });
  }
  flushRun();
  return spans.sort((a, b) => b.score - a.score);
}

// ── near-duplicate detection ─────────────────────────────────────────────────
/** 64-bit simhash as [hi, lo] uint32 pair over a token list. */
export function simhash(tokens) {
  const v = new Array(64).fill(0);
  for (const t of tokens) {
    const h1 = fnv1a(t), h2 = fnv1a(t, 0x1b873593);
    for (let b = 0; b < 32; b++) { v[b] += (h1 >>> b) & 1 ? 1 : -1; v[32 + b] += (h2 >>> b) & 1 ? 1 : -1; }
  }
  let hi = 0, lo = 0;
  for (let b = 0; b < 32; b++) { if (v[b] > 0) lo |= (1 << b); if (v[32 + b] > 0) hi |= (1 << b); }
  return [hi >>> 0, lo >>> 0];
}
function popcount32(x) { x -= (x >>> 1) & 0x55555555; x = (x & 0x33333333) + ((x >>> 2) & 0x33333333); return (((x + (x >>> 4)) & 0x0f0f0f0f) * 0x01010101) >>> 24; }
export function hamming(a, b) { return popcount32((a[0] ^ b[0]) >>> 0) + popcount32((a[1] ^ b[1]) >>> 0); }
export function shingles(tokens, k = 3) {
  const out = new Set();
  if (tokens.length < k) { out.add(tokens.join(' ')); return out; }
  for (let i = 0; i <= tokens.length - k; i++) out.add(tokens.slice(i, i + k).join(' '));
  return out;
}
export function jaccard(a, b) {
  if (!a.size || !b.size) return 0;
  let inter = 0; for (const x of a) if (b.has(x)) inter++;
  return inter / (a.size + b.size - inter);
}
export function cosineTf(aTokens, bTokens, idfFn = () => 1) {
  const ta = new Map(), tb = new Map();
  for (const w of aTokens) ta.set(w, (ta.get(w) || 0) + 1);
  for (const w of bTokens) tb.set(w, (tb.get(w) || 0) + 1);
  let dot = 0, na = 0, nb = 0;
  for (const [w, f] of ta) { const x = f * idfFn(w); na += x * x; if (tb.has(w)) dot += x * tb.get(w) * idfFn(w); }
  for (const [w, f] of tb) { const x = f * idfFn(w); nb += x * x; }
  return na && nb ? dot / Math.sqrt(na * nb) : 0;
}
