/**
 * ExtractiveQuestionGenerator.js — deterministic, zero-API-call generator of
 * document-GROUNDED assessment questions built straight from the sentences of
 * the source text.
 *
 * Every question carries `sourceQuote`, a verbatim (whitespace/punctuation-
 * insensitive) contiguous excerpt of the source, so the pipeline's existing
 * verifyQuoteGrounded check passes by construction (and the generator
 * re-verifies each quote itself before returning a question). Constructs:
 *
 *   cloze       fill-in-the-blank on a key term / number / code / entity;
 *               MCQ distractors are drawn from other spans of the SAME document,
 *               chosen by type, shape, number magnitude and context similarity
 *   condition   "if X, what is the prescribed outcome?"  (rule consequences)
 *   obligation  "what must <subject> do?" / "what does <subject> require?"
 *   sequence    "which step comes immediately after <step>?"
 *   definition  "which describes <term>?"
 *   kv          "what is specified for <row key>?" (tables / key-value rows)
 *   statement   "which statement is consistent with the document?" — the true
 *               sentence versus controlled substitutions of it (number swap,
 *               antonym flip, entity swap)
 *   summary     subjective "outline the documented steps/rules for ..." with a
 *               model answer built from the document's own sentences
 *
 * Output uses the app's question shape: type mcq|fill_blank|subjective,
 * "A) ..." options with a single answer letter, difficulty easy|medium|hard.
 */
import {
  segment, parseStepLine, parseKeyValue, isMetadataLine, sentenceInformativeness, extractSpans, buildDocStats,
  contentTokens, tokenize, collapseWs, simhash, hamming, jaccard, makeRng, shuffled,
} from './TextRanking.js';

const LETTERS = ['A', 'B', 'C', 'D'];
const normQuote = (s) => (s || '').toLowerCase().replace(/[^a-z0-9\s]/g, '').replace(/\s+/g, ' ').trim();
const normKey = (t) => (t || '').toLowerCase().replace(/[^a-z0-9]/g, '');
const lcFirst = (s) => s.charAt(0).toLowerCase() + s.slice(1);
const stripEndPunct = (s) => s.replace(/[\s.;:,]+$/, '');
const wordsOf = (s) => s.split(/\s+/).filter(Boolean);
const clipWords = (s, n) => { const w = wordsOf(s); return w.length <= n ? s : w.slice(0, n).join(' '); };

// ── document model ───────────────────────────────────────────────────────────
export function buildDocumentModel(text, { name = '' } = {}) {
  const src = String(text || '');
  const { sentences: all, headings } = segment(src);
  const usable = [];
  const hashes = [];
  for (const s of all) {
    const wc = wordsOf(s.text).length;
    const minWords = s.kind === 'kv' ? 4 : 6;
    if (wc < minWords || wc > 55) continue;
    if (isMetadataLine(s.text)) continue;
    if (sentenceInformativeness(s.text) <= 0 && s.kind !== 'kv') continue;
    const h = simhash(tokenize(s.text));
    if (hashes.some(x => hamming(x, h) <= 2)) continue; // boilerplate repeated verbatim
    hashes.push(h);
    usable.push(s);
  }
  const stats = buildDocStats(usable);
  const model = {
    name, text: src, normText: normQuote(src), all, usable, headings, stats,
    info: new Map(usable.map(s => [s.i, sentenceInformativeness(s.text) + (s.kind === 'kv' ? 1.5 : 0)])),
    _spans: new Map(), _vec: new Map(), _pool: null, _conds: null, _obls: null, _defs: null, _kvs: null,
    span(s) { if (!this._spans.has(s.i)) this._spans.set(s.i, extractSpans(s.text, stats)); return this._spans.get(s.i); },
    vec(s) {
      let v = this._vec.get(s.i);
      if (!v) {
        const m = new Map();
        for (const w of contentTokens(s.text)) m.set(w, (m.get(w) || 0) + 1);
        let n = 0;
        for (const [w, f] of m) { const x = f * stats.idf(w); m.set(w, x); n += x * x; }
        v = { m, norm: Math.sqrt(n) }; this._vec.set(s.i, v);
      }
      return v;
    },
    sim(a, b) {
      const va = this.vec(a), vb = this.vec(b);
      if (!va.norm || !vb.norm) return 0;
      const [small, big] = va.m.size <= vb.m.size ? [va, vb] : [vb, va];
      let dot = 0; for (const [w, x] of small.m) { const y = big.m.get(w); if (y) dot += x * y; }
      return dot / (va.norm * vb.norm);
    },
  };
  model.byIdx = new Map(all.map(s => [s.i, s]));
  return model;
}

function sectionLabel(s) {
  if (!s.section) return null;
  return s.section.replace(/^\s*\d+(?:\.\d+)*[.)]?\s*/, '').replace(/^step\s*\d+\s*[:.\-–—]?\s*/i, '').trim() || null;
}

// ── distractor selection ─────────────────────────────────────────────────────
function spanPool(model) {
  if (model._pool) return model._pool;
  const pool = [];
  for (const s of model.usable) {
    for (const sp of model.span(s).slice(0, 6)) {
      if (sp.score < 1.4 || sp.text.length > 40 || sp.text.length < 2) continue;
      pool.push({ type: sp.type, text: sp.text, sIdx: s.i, s, start: sp.start, end: sp.end, tokens: new Set(tokenize(sp.text)) });
    }
  }
  model._pool = pool;
  return pool;
}
function parseNumber(t) {
  const m = /^(\d[\d,]*(?:\.\d+)?)\s*(.*)$/.exec(t.trim());
  if (!m) return null;
  const val = parseFloat(m[1].replace(/,/g, ''));
  if (!isFinite(val)) return null;
  return { val, unit: m[2].toLowerCase().replace(/s$/, ''), comma: m[1].includes(','), dec: (m[1].split('.')[1] || '').length, unitRaw: m[2] };
}
function formatNumber(val, ref) {
  let s = ref.dec > 0 ? val.toFixed(ref.dec) : String(Math.round(val));
  if (ref.comma && Math.abs(val) >= 1000) s = Number(s).toLocaleString('en-US', { maximumFractionDigits: ref.dec });
  if (!ref.unitRaw) return s;
  return /^%/.test(ref.unitRaw) ? `${s}${ref.unitRaw}` : `${s} ${ref.unitRaw}`;
}

function numberDistractors(model, span, sIdx, rng, k) {
  const ref = parseNumber(span.text);
  if (!ref || ref.val <= 0) return null;
  const out = []; const seen = new Set([normKey(span.text)]);
  const push = (t) => { const nk = normKey(t); if (!seen.has(nk)) { seen.add(nk); out.push(t); } };
  const cands = spanPool(model).filter(p => p.type === 'number' && p.sIdx !== sIdx).map(p => ({ p, n: parseNumber(p.text) }))
    .filter(x => x.n && x.n.unit === ref.unit && x.n.val !== ref.val)
    .sort((a, b) => Math.abs(Math.log(a.n.val / ref.val)) - Math.abs(Math.log(b.n.val / ref.val)));
  for (const c of shuffled(cands.slice(0, 8), rng)) { if (out.length >= k) break; push(c.p.text); }
  const isInt = ref.dec === 0;
  const variants = [ref.val * 2, ref.val / 2, ref.val + (ref.val >= 10 ? 10 : 1), Math.max(1, ref.val - (ref.val >= 10 ? 10 : 1)), ref.val * 3, ref.val + 5, ref.val * 4, ref.val + 2];
  for (const v of shuffled(variants, rng)) {
    if (out.length >= k) break;
    const val = isInt ? Math.round(v) : v;
    if (val > 0 && val !== ref.val) push(formatNumber(val, ref));
  }
  return out.length >= k ? out.slice(0, k) : null;
}
function codeDistractors(model, span, sIdx, rng, k) {
  const shape = (t) => t.replace(/[0-9]/g, '9').replace(/[A-Za-z]/g, 'A');
  const sh = shape(span.text);
  const out = []; const seen = new Set([normKey(span.text)]);
  const cands = spanPool(model).filter(p => p.type === 'code' && p.sIdx !== sIdx && shape(p.text) === sh);
  for (const c of shuffled(cands, rng)) { if (out.length >= k) break; const nk = normKey(c.text); if (!seen.has(nk)) { seen.add(nk); out.push(c.text); } }
  const m = /(\d+)(?!.*\d)/.exec(span.text);
  if (m) {
    const n = parseInt(m[1], 10);
    for (const d of shuffled([1, -1, 3, 10, -10, 7, 12, 25], rng)) {
      if (out.length >= k) break;
      const nv = n + d; if (nv < 0) continue;
      const t = span.text.slice(0, m.index) + String(nv).padStart(m[1].length, '0') + span.text.slice(m.index + m[1].length);
      const nk = normKey(t); if (!seen.has(nk)) { seen.add(nk); out.push(t); }
    }
  }
  return out.length >= k ? out.slice(0, k) : null;
}
/** Generic text distractor ranking: similar length + context similarity, other sentences only. */
function localCtx(text, a, b) {
  const before = tokenize(text.slice(0, a)).slice(-2).map(w => 'L' + w);
  const after = tokenize(text.slice(b)).slice(0, 2).map(w => 'R' + w);
  return new Set([...before, ...after]);
}
function textDistractors(model, items, correct, targetS, rng, k, { sameTypeOf = null, avoidIn = null, targetCtx = null } = {}) {
  const ct = new Set(tokenize(correct)); const cw = wordsOf(correct).length;
  const targetLower = (avoidIn || targetS.text).toLowerCase();
  let source = items;
  if (source.length > 160) source = shuffled(source, rng).slice(0, 160); // bound the work on very large documents
  const scored = [];
  for (const it of source) {
    if (it.sIdx === targetS.i) continue;
    if (sameTypeOf && it.type && it.type !== sameTypeOf) continue;
    const nk = normKey(it.text); if (!nk || nk === normKey(correct)) continue;
    const toks = it.tokens || new Set(tokenize(it.text));
    if (jaccard(ct, toks) >= 0.6) continue;
    if (targetLower.includes(it.text.toLowerCase())) continue;
    const w = wordsOf(it.text).length; const ratio = w / Math.max(1, cw);
    if (ratio < 0.5 || ratio > 2) continue;
    if (!it.type && /^[a-z]/.test(correct) !== /^[a-z]/.test(it.text)) continue;
    const ctx = it.s ? model.sim(targetS, it.s) : 0;
    const lenSim = 1 - Math.min(1, Math.abs(1 - ratio));
    const shape = (/^[A-Z]/.test(correct) === /^[A-Z]/.test(it.text) ? 0.15 : 0) + (cw === w ? 0.1 : 0);
    // same syntactic slot (words just before/after the span) => the same kind of thing (a role vs a system vs a duration)
    const slot = targetCtx && it.start !== undefined ? jaccard(targetCtx, it.ctx || (it.ctx = localCtx(it.s.text, it.start, it.end))) : 0;
    scored.push({ it, toks, score: 0.45 * ctx + 0.3 * lenSim + shape + 0.5 * slot + rng() * 0.12 });
  }
  scored.sort((a, b) => b.score - a.score);
  const out = []; const used = [];
  for (const c of scored.slice(0, 18)) {
    if (out.length >= k) break;
    if (used.some(u => jaccard(u, c.toks) >= 0.6)) continue;
    used.push(c.toks); out.push(c.it.text);
  }
  return out.length >= k ? out : null;
}
function spanDistractors(model, span, s, rng, k) {
  if (span.type === 'number') return numberDistractors(model, span, s.i, rng, k);
  if (span.type === 'code') return codeDistractors(model, span, s.i, rng, k);
  const pool = spanPool(model).filter(p => p.type === 'entity' || p.type === 'phrase');
  const wc = wordsOf(span.text).length;
  const items = pool.filter(p => Math.abs(wordsOf(p.text).length - wc) <= 1 && (p.type === span.type || wc === 1));
  const targetCtx = localCtx(s.text, span.start, span.end);
  return textDistractors(model, items, span.text, s, rng, k, { sameTypeOf: span.type, targetCtx }) || textDistractors(model, pool, span.text, s, rng, k, { targetCtx });
}

// ── question assembly ────────────────────────────────────────────────────────
function makeMcq(correct, distractors, rng, state, maxLen = 150) {
  const texts = [correct, ...distractors].map(t => collapseWs(t));
  if (new Set(texts.map(t => normKey(t))).size !== 4) return null;
  if (texts.some(t => !t || t.length > maxLen)) return null;
  const counts = state.letters; // balance the answer letter: least used position, random tiebreak
  const min = Math.min(...counts);
  const choices = [0, 1, 2, 3].filter(i => counts[i] === min);
  const pos = choices[Math.floor(rng() * choices.length)];
  const order = shuffled(texts.slice(1), rng);
  const opts = []; let di = 0;
  for (let i = 0; i < 4; i++) opts.push(i === pos ? texts[0] : order[di++]);
  counts[pos]++;
  return { options: opts.map((t, i) => `${LETTERS[i]}) ${t}`), answer: LETTERS[pos] };
}

/** Contiguous ≤maxWords window around [a,b) of `text`; whole text if it is short enough. */
function quoteWindow(text, a, b, maxWords = 24) {
  const toks = []; const re = /\S+/g; let m;
  while ((m = re.exec(text)) !== null) toks.push({ s: m.index, e: m.index + m[0].length });
  if (toks.length <= maxWords + 1) return { start: 0, end: text.length };
  // prefer a clause-aligned window (split at , ; : and conjunctions) over an arbitrary word window
  const starts = [0]; const ends = []; const cre = /[,;:]\s+|\s+(?:and|but|while|whereas|which|so that)\s+/gi;
  while ((m = cre.exec(text)) !== null) { ends.push(m.index); starts.push(m.index + m[0].length); }
  ends.push(text.length);
  const wc = (x, y) => wordsOf(text.slice(x, y)).length;
  let ci = -1; for (let i = 0; i < starts.length; i++) if (starts[i] <= a && b <= ends[i]) { ci = i; break; }
  if (ci >= 0) {
    let lo = ci, hi = ci;
    while (wc(starts[lo], ends[hi]) < 7 && (lo > 0 || hi < starts.length - 1)) {
      if (hi < starts.length - 1 && wc(starts[lo], ends[hi + 1]) <= maxWords) hi++;
      else if (lo > 0 && wc(starts[lo - 1], ends[hi]) <= maxWords) lo--;
      else break;
    }
    const n = wc(starts[lo], ends[hi]);
    if (n >= 5 && n <= maxWords) return { start: starts[lo], end: ends[hi] };
  }
  let lo = toks.findIndex(t => t.e > a); if (lo < 0) lo = 0;
  let hi = lo; for (let i = toks.length - 1; i >= lo; i--) if (toks[i].s < b) { hi = i; break; }
  while (hi - lo + 1 > maxWords) hi--;
  let room = maxWords - (hi - lo + 1);
  while (room > 0 && (lo > 0 || hi < toks.length - 1)) { if (lo > 0) { lo--; room--; } if (room > 0 && hi < toks.length - 1) { hi++; room--; } }
  return { start: toks[lo].s, end: toks[hi].e };
}

function topicOf(model, s) {
  const sec = sectionLabel(s);
  if (sec && sec.length <= 60) return sec;
  const sp = model.span(s).find(x => x.type === 'entity' || x.type === 'phrase');
  return sp ? sp.text : 'Document procedure';
}

/** Turns a candidate into a final question (letter balancing happens here, at selection time). */
function finalize(c, model, rng, state) {
  let mcq = null;
  if (c.type === 'mcq') { mcq = makeMcq(c.mcq.correct, c.mcq.dis, rng, state, c.maxLen); if (!mcq) return null; }
  const sec = sectionLabel(c.s);
  const quote = collapseWs(c.quote);
  const q = {
    type: c.type,
    question: c.stem,
    difficulty: c.difficulty,
    ...(mcq ? { options: mcq.options, answer: mcq.answer } : { answer: c.answer }),
    explanation: `Stated in the document${sec ? ` (${sec})` : ''}: "${clipWords(quote, 28)}"`,
    skillArea: c.skillArea || topicOf(model, c.s),
    sourceSection: c.s.section || null,
    sourceQuote: quote,
    generatedBy: 'extractive',
  };
  return q;
}

// ── constructs (each returns candidate descriptors; options are built at selection time) ──
function cand(kind, type, difficulty, s, w, o) { return { kind, type, difficulty, s, sIdx: s.i, w, ...o }; }

function clozeCandidates(model, s, rng) {
  const out = [];
  if (s.kind === 'kv') return out;
  const spans = model.span(s).filter(sp => sp.start > 0 && sp.text.length >= 2 && sp.text.length <= 40 && sp.score >= 1.4).slice(0, 3);
  const leads = ['Which option correctly completes this statement from the document?', 'According to the document, what fills the blank in this statement?', 'Complete the statement taken from the document.'];
  for (const sp of spans) {
    const w = quoteWindow(s.text, sp.start, sp.end);
    const win = s.text.slice(w.start, w.end);
    const a = sp.start - w.start; const b = sp.end - w.start;
    if (a < 0 || b > win.length) continue;
    const before = win.slice(0, a); const after = win.slice(b);
    if (wordsOf(before + ' ' + after).length < 5) continue;
    if ((before + ' ' + after).toLowerCase().includes(sp.text.toLowerCase())) continue; // answer must not leak
    const blanked = `${before}______${after}`;
    const diff = sp.type === 'number' || sp.type === 'code' ? 'medium' : 'easy';
    const dis = spanDistractors(model, sp, s, rng, 3);
    if (dis) out.push(cand('cloze', 'mcq', diff, s, 0.5 + sp.score * 0.2, { stem: `${leads[Math.floor(rng() * leads.length)]} "${blanked}"`, mcq: { correct: sp.text, dis }, quote: win }));
    const wc = wordsOf(sp.text).length;
    if (wc <= (sp.type === 'phrase' ? 3 : 4)) out.push(cand('cloze', 'fill_blank', diff, s, 0.3 + sp.score * 0.2, { stem: `Fill in the blank using the document: "${blanked}"`, answer: sp.text, quote: win }));
  }
  return out;
}

const COND_RE = /^(if|when|whenever|once|unless|in case of|in the event that|where)\s+([^,]{6,150}),\s*(?:then\s+)?(.{8,220})$/i;
function parseCondition(s) {
  const m = COND_RE.exec(s.text);
  if (!m) return null;
  let cons = stripEndPunct(m[3]);
  if (/^(and|or|but)\b/i.test(cons)) return null;
  cons = cons.split(/;\s/)[0];
  if (wordsOf(cons).length > 24 || wordsOf(cons).length < 3) return null;
  if (/\bif\b/i.test(m[2])) return null;
  return { kw: m[1], cond: m[2], text: cons };
}
const OBL_RE = /^(.{3,80}?)\s+(must not|must|shall not|shall|should not|should|is required to|are required to|needs to|need to|may not)\s+(.{8,200})$/i;
const REQ_RE = /^(.{3,80}?)\s+(requires?|needs?)\s+(.{6,160})$/i;
function parseObligation(s) {
  if (COND_RE.test(s.text)) return null;
  const bad = (subj) => wordsOf(subj).length > 9 || /[,;:]/.test(subj) || /^(if|when|once|after|before|unless|while|however|where)\b/i.test(subj);
  const m = OBL_RE.exec(s.text);
  if (m) {
    const subj = m[1].trim(); if (bad(subj)) return null;
    const pred = stripEndPunct(m[3]).split(/;\s/)[0];
    if (wordsOf(pred).length > 24) return null;
    return { form: 'modal', subj, modal: m[2].toLowerCase(), text: pred };
  }
  const r = REQ_RE.exec(s.text);
  if (r) {
    const subj = r[1].trim(); if (bad(subj)) return null;
    const obj = stripEndPunct(r[3]).split(/;\s/)[0];
    if (wordsOf(obj).length > 22) return null;
    return { form: 'req', subj, modal: r[2].toLowerCase(), text: obj };
  }
  return null;
}
const DEF_RE = /^(?:an?\s+|the\s+)?([A-Z][A-Za-z0-9()'/ -]{2,50}?)\s+(is|are|means|refers to)\s+(?:an?\s+|the\s+)?(.{12,200})$/;
function parseDefinition(s) {
  const m = DEF_RE.exec(s.text);
  if (!m) return null;
  const term = m[1].trim();
  if (wordsOf(term).length > 6 || /^(it|this|that|there|these|those|the following|each|any|all|if|when|step)\b/i.test(term)) return null;
  if (/\b(must|shall|should)\b/i.test(term)) return null;
  const def = stripEndPunct(m[3]).split(/;\s/)[0];
  if (wordsOf(def).length > 24 || wordsOf(def).length < 4) return null;
  return { term, text: def };
}
function parseKvSentence(s) {
  if (s.kind !== 'kv') return null;
  const kv = parseKeyValue(s.text); if (!kv) return null;
  return { key: kv.key, text: kv.value };
}
function poolOf(model, key, parser) {
  if (model[key]) return model[key];
  const arr = [];
  for (const s of model.usable) { const p = parser(s); if (p) arr.push({ ...p, s, sIdx: s.i, tokens: new Set(tokenize(p.text)) }); }
  model[key] = arr; return arr;
}

function conditionCandidate(model, s, rng) {
  const p = parseCondition(s); if (!p || wordsOf(s.text).length > 32) return null;
  const conds = poolOf(model, '_conds', parseCondition);
  let dis = textDistractors(model, conds, p.text, s, rng, 3);
  if (!dis) dis = textDistractors(model, [...conds, ...poolOf(model, '_obls', parseObligation)], p.text, s, rng, 3);
  if (!dis) return null;
  return cand('condition', 'mcq', 'medium', s, 1.6, { stem: `According to the document, ${lcFirst(p.kw)} ${p.cond}, what is the prescribed outcome?`, mcq: { correct: p.text, dis }, quote: s.text });
}
function obligationCandidate(model, s, rng) {
  const p = parseObligation(s); if (!p || wordsOf(s.text).length > 34) return null;
  const items = poolOf(model, '_obls', parseObligation).filter(c => c.form === p.form);
  const dis = textDistractors(model, items, p.text, s, rng, 3);
  if (!dis) return null;
  const subj = /^(The|A|An)\s/.test(p.subj) ? lcFirst(p.subj) : p.subj;
  let q;
  if (p.form === 'req') q = `According to the document, what ${/s$/.test(p.modal) ? 'does' : 'do'} ${subj} require?`;
  else if (p.modal === 'may not') q = `According to the document, what may ${subj} NOT do?`;
  else if (/ not$/.test(p.modal)) q = `According to the document, what ${p.modal.replace(/\s+not$/, '')} ${subj} NOT do?`;
  else if (/required to$/.test(p.modal)) q = `According to the document, what ${/^are/.test(p.modal) ? 'are' : 'is'} ${subj} required to do?`;
  else if (/^needs? to$/.test(p.modal)) q = `According to the document, what ${/^needs/.test(p.modal) ? 'does' : 'do'} ${subj} need to do?`;
  else q = `According to the document, what ${p.modal} ${subj} do?`;
  return cand('obligation', 'mcq', 'medium', s, 1.3, { stem: q, mcq: { correct: p.text, dis }, quote: s.text });
}
function definitionCandidate(model, s, rng) {
  const p = parseDefinition(s); if (!p || wordsOf(s.text).length > 32) return null;
  const dis = textDistractors(model, poolOf(model, '_defs', parseDefinition), p.text, s, rng, 3);
  if (!dis) return null;
  return cand('definition', 'mcq', 'easy', s, 1.0, { stem: `According to the document, which of the following describes "${p.term}"?`, mcq: { correct: p.text, dis }, quote: s.text, skillArea: p.term });
}
function kvCandidate(model, s, rng) {
  const kv = parseKvSentence(s); if (!kv) return null;
  const dis = textDistractors(model, poolOf(model, '_kvs', parseKvSentence), kv.text, s, rng, 3);
  if (!dis) return null;
  let quote = s.text;
  if (wordsOf(quote).length < 4 || quote.length < 15) {
    const nxt = model.byIdx.get(s.i + 1);
    if (nxt && contiguous(model, s, nxt)) quote = `${s.text} ${nxt.text}`; else return null;
  }
  const sec = sectionLabel(s);
  return cand('kv', 'mcq', 'easy', s, 0.9, { stem: `According to the document, what is specified for "${kv.key}"${sec ? ` under "${sec}"` : ''}?`, mcq: { correct: kv.text, dis }, quote });
}

function contiguous(model, a, b) {
  if (!a || !b || b.start < a.end) return false;
  return /^\s*$/.test(model.text.slice(a.end, b.start));
}

function sequenceCandidates(model, rng) {
  const out = [];
  const steps = model.usable.filter(s => s.kind === 'step').map(s => ({ s, p: parseStepLine(s.text) })).filter(x => x.p && wordsOf(x.p.body).length >= 3);
  const bodyOf = (x) => stripEndPunct(x.p.body);
  for (let i = 0; i + 1 < steps.length; i++) {
    const a = steps[i], b = steps[i + 1];
    if (!contiguous(model, a.s, b.s) || a.s.section !== b.s.section) continue;
    if (wordsOf(a.p.body).length > 24 || wordsOf(b.p.body).length > 24) continue; // keep step text whole, never clipped mid-phrase
    const mk = (x) => ({ text: bodyOf(x), sIdx: x.s.i, s: x.s, tokens: new Set(tokenize(bodyOf(x))) });
    const same = steps.filter(x => x !== a && x !== b && x.s.section === a.s.section).map(mk);
    const other = steps.filter(x => x.s.section !== a.s.section).map(mk);
    const correct = bodyOf(b);
    const dis = textDistractors(model, same, correct, a.s, rng, 3) || textDistractors(model, [...same, ...other], correct, a.s, rng, 3);
    if (!dis) continue;
    const aw = wordsOf(a.s.text); const bw = wordsOf(b.s.text);
    const headB = bw.slice(0, 21);
    const quote = `${aw.slice(-Math.min(10, Math.max(4, 25 - headB.length))).join(' ')} ${headB.join(' ')}`; // tail of step A + head of step B: contiguous in the source
    const sec = sectionLabel(a.s);
    const c = cand('sequence', 'mcq', 'medium', b.s, 1.7, { stem: `In the documented procedure${sec ? ` for "${sec}"` : ''}, which step comes immediately after: "${stripEndPunct(a.p.body)}"?`, mcq: { correct, dis }, quote });
    c.anchorSIdx = a.s.i; c.s = a.s; // the question is "about" step A's passage
    out.push(c);
  }
  return out;
}

const ANTONYMS = [[/\bbefore\b/i, 'after'], [/\bafter\b/i, 'before'], [/\babove\b/i, 'below'], [/\bbelow\b/i, 'above'], [/\bat least\b/i, 'at most'], [/\bat most\b/i, 'at least'],
  [/\bmore than\b/i, 'less than'], [/\bless than\b/i, 'more than'], [/\bminimum\b/i, 'maximum'], [/\bmaximum\b/i, 'minimum'], [/\bincrease[sd]?\b/i, 'decrease'], [/\bmust not\b/i, 'may'],
  [/\bmust\b/i, 'may'], [/\bshould not\b/i, 'should'], [/\balways\b/i, 'never'], [/\bnever\b/i, 'always'], [/\bis required\b/i, 'is optional'], [/\brejected\b/i, 'approved'], [/\bapproved\b/i, 'rejected'], [/\bfirst\b/i, 'last'], [/\bempty\b/i, 'populated']];
function statementCandidate(model, s, rng) {
  const nw = wordsOf(s.text).length;
  if (s.kind === 'kv' || s.kind === 'step' || nw > 25 || nw < 8) return null;
  const text = s.text;
  const variants = [];
  const seen = new Set([normKey(text)]);
  const add = (t) => { const nk = normKey(t); if (t && !seen.has(nk)) { seen.add(nk); variants.push(t); } };
  const spans = model.span(s);
  for (const sp of spans.filter(x => x.type === 'number').slice(0, 2)) {
    const d = numberDistractors(model, sp, s.i, rng, 2); if (!d) continue;
    for (const v of d) add(text.slice(0, sp.start) + v + text.slice(sp.end));
  }
  for (const [re, rep] of shuffled(ANTONYMS, rng)) { if (re.test(text)) add(text.replace(re, (m) => (/^[A-Z]/.test(m) ? rep.charAt(0).toUpperCase() + rep.slice(1) : rep))); if (variants.length >= 6) break; }
  for (const sp of spans.filter(x => x.type === 'entity' && x.start > 0).slice(0, 2)) {
    const d = spanDistractors(model, sp, s, rng, 2); if (!d) continue;
    for (const v of d) add(text.slice(0, sp.start) + v + text.slice(sp.end));
  }
  if (variants.length < 3) return null;
  const chosen = shuffled(variants, rng).slice(0, 3);
  const sec = sectionLabel(s); const topic = topicOf(model, s);
  const stem = sec ? `Which statement from the "${sec}" part of the document is correct?` : `Which statement about ${topic} is consistent with the document?`;
  return cand('statement', 'mcq', 'hard', s, 1.1, { stem, mcq: { correct: text, dis: chosen }, quote: text, maxLen: 230, skillArea: topic });
}

function summaryCandidates(model) {
  const out = [];
  const bySection = new Map();
  for (const s of model.usable) { if (s.kind !== 'step') continue; const k = s.section || '_'; if (!bySection.has(k)) bySection.set(k, []); bySection.get(k).push(s); }
  for (const [sec, arr] of bySection) {
    if (arr.length < 3) continue;
    const pick = arr.slice(0, 3);
    if (!(contiguous(model, pick[0], pick[1]) && contiguous(model, pick[1], pick[2]))) continue;
    if (pick.some(x => wordsOf(parseStepLine(x.text)?.body || x.text).length > 24)) continue;
    const pts = pick.map(x => '• ' + stripEndPunct(parseStepLine(x.text)?.body || x.text));
    const label = sec === '_' ? null : sectionLabel(pick[0]);
    out.push(cand('summary', 'subjective', 'medium', pick[0], 1.0, { stem: `Outline the first steps the document prescribes${label ? ` for "${label}"` : ''}, in order.`, answer: pts.join(' | '), quote: clipWords(pick[0].text, 24), skillArea: label || undefined }));
  }
  const byPara = new Map();
  for (const s of model.usable) { if (s.kind !== 'sentence') continue; if (!byPara.has(s.para)) byPara.set(s.para, []); byPara.get(s.para).push(s); }
  for (const arr of byPara.values()) {
    if (arr.length < 3) continue;
    const top = arr.slice().sort((a, b) => (model.info.get(b.i) || 0) - (model.info.get(a.i) || 0)).slice(0, 3).sort((a, b) => a.i - b.i);
    if (top.some(x => wordsOf(x.text).length > 26)) continue;
    const pts = top.map(x => '• ' + stripEndPunct(x.text));
    const topic = topicOf(model, top[0]);
    out.push(cand('summary', 'subjective', 'hard', top[0], 0.8, { stem: `Based on the document, explain the rules, thresholds and conditions that apply to ${topic}.`, answer: pts.join(' | '), quote: clipWords(top[0].text, 24), skillArea: topic }));
  }
  return out;
}

// ── selection ────────────────────────────────────────────────────────────────
/**
 * Generates up to `count` grounded questions.
 * @param {string|object} source   raw text or a model from buildDocumentModel
 * @param {object} opts
 *   count, typeCounts {mcq,fill_blank,subjective}, difficultyTargets {easy,medium,hard},
 *   seed, exclude(q)=>bool (duplicate tracker), sentenceFilter(s)=>bool (e.g. restrict to a window),
 *   usedSentences Set<number> (sentence ids not to reuse), onlyKinds string[]
 */
export function generateExtractiveQuestions(source, opts = {}) {
  const model = typeof source === 'string' ? buildDocumentModel(source) : source;
  const count = Math.max(0, Math.floor(opts.count ?? 0));
  if (count === 0 || model.usable.length === 0) return [];
  const rng = makeRng(opts.seed ?? 'extractive');
  const state = { letters: [0, 0, 0, 0] };
  const typeLeft = opts.typeCounts ? { mcq: 0, fill_blank: 0, subjective: 0, ...opts.typeCounts } : { mcq: count, fill_blank: 0, subjective: 0 };
  const diffLeft = { ...(opts.difficultyTargets || {}) };
  const useDiff = !!opts.difficultyTargets;
  const filter = opts.sentenceFilter || (() => true);
  const onlyKinds = opts.onlyKinds ? new Set(opts.onlyKinds) : null;
  const sentUsed = new Set(opts.allowReuse ? [] : (opts.usedSentences || [])); // allowReuse: last-chance pass that may ask a second question about an already-used sentence
  const seenOptionSets = new Set(); // never return two MCQs with the same option set

  // 1. restrict candidate generation to the richest sentences, spread over the document
  const maxIdx = Math.max(1, model.all.length);
  const nSeg = Math.max(1, Math.min(12, Math.ceil(count / 2)));
  const segOf = (sIdx) => Math.min(nSeg - 1, Math.floor((sIdx / maxIdx) * nSeg));
  const eligible = model.usable.filter(s => filter(s) && !sentUsed.has(s.i));
  const perSeg = opts.allowReuse ? 1e9 : Math.max(8, Math.ceil((count * 6) / nSeg));
  const bySeg = Array.from({ length: nSeg }, () => []);
  for (const s of eligible) bySeg[segOf(s.i)].push(s);
  const sents = bySeg.flatMap(arr => arr.sort((a, b) => (model.info.get(b.i) || 0) - (model.info.get(a.i) || 0)).slice(0, perSeg));

  // 2. candidates
  const cands = [];
  for (const s of sents) {
    const info = model.info.get(s.i) || 0;
    const list = [...clozeCandidates(model, s, rng)];
    for (const fn of [conditionCandidate, obligationCandidate, definitionCandidate, kvCandidate, statementCandidate]) { const c = fn(model, s, rng); if (c) list.push(c); }
    for (const c of list) { if (onlyKinds && !onlyKinds.has(c.kind)) continue; c.base = info + c.w * 2; cands.push(c); }
  }
  const inScope = new Set(sents.map(s => s.i));
  if (!onlyKinds || onlyKinds.has('sequence')) for (const c of sequenceCandidates(model, rng)) { if (inScope.has(c.s.i) || (filter(c.s) && !sentUsed.has(c.s.i))) { c.base = (model.info.get(c.s.i) || 2) + c.w * 2; cands.push(c); } }
  if (typeLeft.subjective > 0 || (onlyKinds && onlyKinds.has('summary'))) for (const c of summaryCandidates(model)) { if (filter(c.s) && !sentUsed.has(c.s.i)) { c.base = (model.info.get(c.s.i) || 2) + c.w * 2; cands.push(c); } }

  // 3. greedy selection with document spread + soft difficulty balance
  const segCount = new Array(nSeg).fill(0);
  const kindCount = {};
  const picked = [];
  const pool = cands;
  const maxPerKind = Math.max(3, Math.ceil(count * 0.45));
  let guard = 0;
  while (picked.length < count && pool.length && guard++ < count * 40) {
    let bestI = -1, bestScore = -Infinity;
    for (let i = 0; i < pool.length; i++) {
      const c = pool[i];
      if (sentUsed.has(c.sIdx) || (c.anchorSIdx !== undefined && sentUsed.has(c.anchorSIdx))) continue;
      if (!(typeLeft[c.type] > 0)) continue;
      let sc = c.base - segCount[segOf(c.sIdx)] * 0.9 - (kindCount[c.kind] || 0) * 0.35;
      if ((kindCount[c.kind] || 0) >= maxPerKind) sc -= 3;
      if (useDiff) sc += (diffLeft[c.difficulty] > 0 ? 1.2 : -1.6);
      if (sc > bestScore) { bestScore = sc; bestI = i; }
    }
    if (bestI < 0) break;
    const c = pool.splice(bestI, 1)[0];
    let q;
    try { q = finalize(c, model, rng, state); } catch { continue; }
    if (!q || !q.question) continue;
    const nq = normQuote(q.sourceQuote);
    if (wordsOf(q.sourceQuote).length < 4 || nq.length < 15 || !model.normText.includes(nq)) continue; // grounding safety net
    if (q.type === 'mcq' && (q.options.length !== 4 || new Set(q.options.map(o => normKey(o.slice(3)))).size !== 4)) continue;
    const optKey = q.type === 'mcq' ? q.options.map(o => normKey(o.slice(3))).sort().join('|') : null;
    if (optKey && seenOptionSets.has(optKey)) continue;
    if (typeof opts.exclude === 'function' && opts.exclude(q)) continue;
    if (optKey) seenOptionSets.add(optKey);
    sentUsed.add(c.sIdx); if (c.anchorSIdx !== undefined) sentUsed.add(c.anchorSIdx);
    typeLeft[c.type]--; if (useDiff && diffLeft[q.difficulty] > 0) diffLeft[q.difficulty]--;
    segCount[segOf(c.sIdx)]++; kindCount[c.kind] = (kindCount[c.kind] || 0) + 1;
    q.extractiveKind = c.kind;
    q._sentences = c.anchorSIdx !== undefined ? [c.sIdx, c.anchorSIdx] : [c.sIdx]; // internal: lets callers avoid re-using these sentences (strip before storing)
    picked.push(q);
  }
  return picked;
}

export default { buildDocumentModel, generateExtractiveQuestions };
