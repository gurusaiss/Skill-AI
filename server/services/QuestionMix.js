/**
 * QuestionMix.js
 *
 * The single source of truth for question-type distribution.
 *
 * Before this module the 50/25/25 split was reimplemented in seven separate
 * places (roles.js's buildTypeSequence, an inlined copy in
 * regenerate-questions, AssessmentGenerator's buildTypeSeqLocal, and four
 * separate targetMcq/Fill/Subj trios), and a round-robin padding fallback in
 * AssessmentGenerator silently rewrote whatever ratio was intended into
 * 33/33/33. Fixing the ratio in any one place therefore could not work.
 *
 * Two ratios exist because the two surfaces have different purposes:
 *   - ASSESSMENT_MIX: MCQ-dominant role assessments (auto-gradable at scale).
 *   - QUIZ_MIX: the in-module daily Knowledge Quiz, which deliberately keeps
 *     more written answers because it is formative, not scored for hiring.
 */

import { answerLetters } from './answerMatching.js';

export const ASSESSMENT_MIX = { mcq: 0.90, subjective: 0.08, fill_blank: 0.02 };
export const QUIZ_MIX       = { mcq: 0.70, subjective: 0.20, fill_blank: 0.10 };

export const QUESTION_TYPES = ['mcq', 'subjective', 'fill_blank'];

/**
 * Split `count` across the types using the largest-remainder (Hare-Niemeyer)
 * method, so the parts always sum to exactly `count` — plain rounding does
 * not (e.g. 3 × round(0.333 × 10) = 9 ≠ 10).
 *
 * MCQ absorbs any final leftover, since it is the dominant type everywhere.
 * A floor of one subjective applies from count >= 8 so a reasonably sized
 * assessment always contains at least one written answer. fill_blank is
 * allowed to land on 0 for small counts — at 2% it genuinely rounds away
 * below ~25 questions, and that is intended, not a bug.
 *
 * Examples (ASSESSMENT_MIX): 10 → 9/1/0 · 15 → 14/1/0 · 50 → 45/4/1 · 320 → 288/26/6
 * Examples (QUIZ_MIX):       10 → 7/2/1
 */
export function mixCounts(count, mix = ASSESSMENT_MIX) {
  const total = Math.max(0, Math.floor(Number(count) || 0));
  if (total === 0) return { mcq: 0, subjective: 0, fill_blank: 0 };

  const exact = QUESTION_TYPES.map(type => ({ type, value: total * (mix[type] || 0) }));
  const out = {};
  let assigned = 0;
  for (const { type, value } of exact) {
    out[type] = Math.floor(value);
    assigned += out[type];
  }

  // Hand out the remaining seats to the largest fractional remainders first.
  const remainders = exact
    .map(({ type, value }) => ({ type, frac: value - Math.floor(value) }))
    .sort((a, b) => b.frac - a.frac);
  let leftover = total - assigned;
  for (let i = 0; leftover > 0; i = (i + 1) % remainders.length) {
    out[remainders[i].type] += 1;
    leftover -= 1;
  }

  // At least one written answer once the assessment is big enough to spare it.
  if (total >= 8 && out.subjective === 0 && out.mcq > 1) {
    out.subjective = 1;
    out.mcq -= 1;
  }

  return { mcq: out.mcq, subjective: out.subjective, fill_blank: out.fill_blank };
}

/**
 * A flat array of type strings, length === count, telling the generator what
 * each question should be. The minority types are spread evenly rather than
 * clustered at the end, so a truncated or partially-accepted batch still has
 * a representative mix instead of being all-MCQ.
 */
export function buildTypeSequence(count, mix = ASSESSMENT_MIX) {
  const counts = mixCounts(count, mix);
  const total = counts.mcq + counts.subjective + counts.fill_blank;
  if (total === 0) return [];

  const remaining = { ...counts };
  const seq = [];
  // Greedy largest-share-first interleave: at each slot emit whichever type is
  // furthest behind its target share of the sequence so far.
  for (let i = 0; i < total; i++) {
    let best = null;
    let bestScore = -Infinity;
    for (const type of QUESTION_TYPES) {
      if (remaining[type] <= 0) continue;
      // How badly this type still needs slots, relative to what's left.
      const score = remaining[type] / (counts[type] || 1);
      if (score > bestScore) { bestScore = score; best = type; }
    }
    if (!best) break;
    seq.push(best);
    remaining[best] -= 1;
  }
  return seq;
}

/**
 * Per-type shortfall between what `existing` questions already provide and
 * the target mix for `count`. Used by generation retries to ask only for the
 * types still missing instead of re-requesting a whole balanced batch.
 */
export function typeDeficit(existing = [], count, mix = ASSESSMENT_MIX) {
  const target = mixCounts(count, mix);
  const have = { mcq: 0, subjective: 0, fill_blank: 0 };
  for (const q of existing) {
    const t = normalizeTypeName(q?.type);
    if (have[t] !== undefined) have[t] += 1;
  }
  return {
    mcq: Math.max(0, target.mcq - have.mcq),
    subjective: Math.max(0, target.subjective - have.subjective),
    fill_blank: Math.max(0, target.fill_blank - have.fill_blank),
  };
}

/** Map loose/legacy type spellings onto the three canonical types. */
export function normalizeTypeName(type, hasOptions = false) {
  const t = String(type || '').toLowerCase().trim();
  if (t === 'mcq' || t === 'multiple_choice' || t === 'multiple choice') return 'mcq';
  if (t === 'fill_blank' || t === 'fill' || t === 'fill_in_blank' || t === 'fill in the blank') return 'fill_blank';
  if (t === 'subjective' || t === 'short_answer' || t === 'essay' || t === 'open') return 'subjective';
  // Unrecognised: infer from shape — an options array means MCQ.
  return hasOptions ? 'mcq' : 'subjective';
}

const LETTERS = ['A', 'B', 'C', 'D'];

/**
 * Force one question into a valid shape for its own type, so the renderer
 * never receives an MCQ with no options or a fill-blank with no answer.
 * Returns null when the question cannot be salvaged, so callers can drop it
 * BEFORE topping up and still guarantee the requested count.
 */
export function normalizeQuestionShape(q) {
  if (!q || typeof q !== 'object') return null;
  const stem = String(q.question || q.text || q.prompt || '').trim();
  if (!stem) return null;

  const hasOptions = Array.isArray(q.options) && q.options.length > 0;
  const type = normalizeTypeName(q.type, hasOptions);
  const base = { ...q, question: stem, type };

  if (type === 'mcq') {
    let options = (Array.isArray(q.options) ? q.options : [])
      .map(o => String(o ?? '').trim())
      .filter(Boolean);
    if (options.length < 2) return null; // not salvageable as a choice question
    options = options.slice(0, 4);
    // Re-letter so labels are always A)..D) in order, regardless of input.
    const bodies = options.map(o => o.replace(/^\s*[A-Da-d][).:-]\s*/, ''));
    const rawAnswer = q.answer ?? q.correct ?? '';
    const answerRaw = (Array.isArray(rawAnswer) ? rawAnswer.join(',') : String(rawAnswer)).trim();
    // More than one correct option ("A,C", "a and c", ["A","C"]): keep them all.
    const multi = [...answerLetters(rawAnswer, bodies)].filter(l => LETTERS.indexOf(l) !== -1 && LETTERS.indexOf(l) < bodies.length).sort();
    if (multi.length > 1) {
      return {
        ...base,
        options: bodies.map((b, i) => `${LETTERS[i]}) ${b}`),
        answer: multi.join(','),
        multiple: true,
        explanation: String(q.explanation || '').trim(),
      };
    }
    let idx = LETTERS.indexOf(answerRaw.toUpperCase().charAt(0));
    if (idx === -1 || idx >= bodies.length) {
      // Answer given as full option text rather than a letter — match it back.
      const stripped = answerRaw.replace(/^\s*[A-Da-d][).:-]\s*/, '').toLowerCase();
      idx = bodies.findIndex(b => b.toLowerCase() === stripped);
    }
    if (idx === -1) idx = 0; // deterministic fallback rather than dropping
    return {
      ...base,
      options: bodies.map((b, i) => `${LETTERS[i]}) ${b}`),
      answer: LETTERS[idx],
      explanation: String(q.explanation || '').trim(),
    };
  }

  if (type === 'fill_blank') {
    const answer = String(q.answer ?? q.correct ?? '').trim();
    if (!answer) return null;
    const { options: _drop, ...rest } = base;
    return {
      ...rest,
      // The renderer and the learner both expect a visible blank.
      question: /_{2,}/.test(stem) ? stem : `${stem.replace(/[.?]$/, '')} ______`,
      answer,
      explanation: String(q.explanation || '').trim(),
    };
  }

  // subjective
  const model = String(q.answer ?? q.expectedAnswer ?? q.modelAnswer ?? '').trim();
  if (!model) return null;
  const { options: _drop2, ...rest2 } = base;
  return { ...rest2, answer: model, explanation: String(q.explanation || '').trim() };
}

/**
 * Convert an MCQ into another type deterministically, so a surplus of MCQs can
 * satisfy a shortfall without paying for another LLM call.
 */
function relabelFromMcq(q, targetType) {
  if (targetType === 'subjective') {
    const correct = (q.options || []).find(o => o.trim().startsWith(`${q.answer})`));
    const model = String(q.explanation || correct || '').replace(/^\s*[A-D][).:-]\s*/, '').trim();
    return normalizeQuestionShape({ ...q, type: 'subjective', options: undefined, answer: model || 'See explanation.' });
  }
  if (targetType === 'fill_blank') {
    const correct = (q.options || []).find(o => o.trim().startsWith(`${q.answer})`));
    const short = String(correct || '').replace(/^\s*[A-D][).:-]\s*/, '').trim();
    return normalizeQuestionShape({ ...q, type: 'fill_blank', options: undefined, answer: short || 'answer' });
  }
  return null;
}

/**
 * Bring a generated list to exactly `count` questions in the target mix.
 *
 * Prompt wording alone does not hold a ratio — models drift — so this is the
 * deterministic backstop. Strategy is cheapest-first and never regenerates:
 * normalize shapes, drop anything unsalvageable, fill each type bucket up to
 * target, then satisfy any remaining shortfall by relabelling surplus MCQs.
 * `fallback` supplies extra questions only if the list is still short.
 */
export function enforceMix(questions = [], count, mix = ASSESSMENT_MIX, { fallback = [] } = {}) {
  const target = mixCounts(count, mix);
  const normalized = questions.map(normalizeQuestionShape).filter(Boolean);

  const buckets = { mcq: [], subjective: [], fill_blank: [] };
  for (const q of normalized) buckets[q.type].push(q);

  const picked = [];
  for (const type of QUESTION_TYPES) {
    picked.push(...buckets[type].splice(0, target[type]));
  }

  // Relabel leftover MCQs into whichever types are still short.
  for (const type of ['subjective', 'fill_blank']) {
    let need = target[type] - picked.filter(q => q.type === type).length;
    while (need > 0 && buckets.mcq.length > 0) {
      const converted = relabelFromMcq(buckets.mcq.shift(), type);
      if (converted) { picked.push(converted); need -= 1; }
    }
  }

  // Still short overall (model returned very little): take from fallback,
  // preferring the types we are missing, then anything valid.
  if (picked.length < count) {
    const fb = fallback.map(normalizeQuestionShape).filter(Boolean);
    for (const type of QUESTION_TYPES) {
      let need = target[type] - picked.filter(q => q.type === type).length;
      while (need > 0) {
        const i = fb.findIndex(q => q.type === type);
        if (i === -1) break;
        picked.push(fb.splice(i, 1)[0]);
        need -= 1;
      }
    }
    while (picked.length < count && fb.length > 0) picked.push(fb.shift());
    while (picked.length < count && buckets.mcq.length > 0) picked.push(buckets.mcq.shift());
  }

  // Order by the interleaved target sequence so the mix is spread through the
  // paper rather than clustered by type.
  const wanted = buildTypeSequence(picked.length, mix);
  const byType = { mcq: [], subjective: [], fill_blank: [] };
  for (const q of picked) byType[q.type].push(q);
  const ordered = [];
  for (const type of wanted) {
    const q = byType[type].shift()
      || byType.mcq.shift() || byType.subjective.shift() || byType.fill_blank.shift();
    if (q) ordered.push(q);
  }
  return ordered.slice(0, count);
}
