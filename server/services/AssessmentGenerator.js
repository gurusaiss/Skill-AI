/**
 * AssessmentGenerator.js — shared question generation service
 * Extracted from assessment.js so users.js and roles.js can reuse it
 * without circular imports.
 */
import { randomUUID } from 'crypto';
import { classifyJDVsProcessSections } from '../utils/textPreprocessor.js';
import GeminiService from './GeminiService.js';
import LLMQueue from './LLMQueue.js';
import { ASSESSMENT_MIX, mixCounts, buildTypeSequence, typeDeficit as typeDeficitFor } from './QuestionMix.js';
import { chunkDensity, contentTokens, BM25 } from './TextRanking.js';
import { buildDocumentModel, generateExtractiveQuestions } from './ExtractiveQuestionGenerator.js';
import { TaskPool, TimeBudget, mapPool } from './GenScheduler.js';
import questionChunkCache, { chunkCacheKey } from './QuestionChunkCache.js';
import { sanitizeDocumentReferences, validateFillBlankQuality } from './QuestionStyleLearning.js';

// ── Generation tuning ────────────────────────────────────────────────────────
// Where the time used to go: Groq's free tier allows only ~7,000 tokens per
// MINUTE (enforced by LLMQueue's limiter, which counts prompt + requested
// max_tokens), and the old pipeline sent one big instruction-heavy prompt per
// (chunk x attempt), strictly one after another, each reserving a large
// max_tokens: ~2 calls/minute, ~8 questions each, with 30-40% of them rejected
// by the quality filters => 30-60+ minutes for a bank. The levers now:
//   - compact prompt + compact output schema (fewer tokens per question),
//   - tight max_tokens (truncated replies are salvaged, not thrown away),
//   - only the information-dense chunks get an LLM call (BM25-style density),
//   - an extractive, zero-API-call generator supplies the factual share
//     instantly and fills any shortfall (replacing generic template padding),
//   - bounded concurrency across files/chunks and across providers,
//   - a wall-clock budget after which the extractive generator completes the
//     bank so the job always finishes.
// Per-request budgets. Sized by the provider that will REALLY serve the call:
// a configured-but-quota-exhausted Gemini key must not make us size requests
// for Gemini and then send them to Groq (that sent ~8k-token prompts + 14k
// max_tokens to a 7k-TPM pipe: every call was rejected with HTTP 413 and the
// whole bank degraded to generic templates).
const GROQ_MAX_OUTPUT_TOKENS      = 3200;
const GROQ_MAX_QUESTIONS_PER_CALL = 8;
const PROMPT_OVERHEAD_TOKENS      = 800;   // system prompt + instruction lines + a short avoid list

const GEMINI_SOURCE_CHAR_BUDGET   = 24000;  // fewer, richer chunks (no per-minute token squeeze)
const GEMINI_MAX_OUTPUT_TOKENS    = 32768;  // thinking model: reasoning tokens share this budget
// Gemini's FREE tier caps REQUESTS (20/day/key), not tokens — pack many
// questions into each call.
const GEMINI_MAX_QUESTIONS_PER_CALL = 25;

// True only when a Gemini key can take a call right now (configured AND not in
// a quota cooldown).
function geminiPrimary() {
  try { return GeminiService.generationStatus().gemini; } catch { return false; }
}
// Groq: the TPM limiter reserves (prompt + max_tokens) per call for a full
// 60 s window, so a call costing more than HALF the per-minute budget means
// ONE call per minute (4,360 of 7,000 -> the next call must wait for the whole
// window to roll over). Size the excerpt so two calls fill the window almost
// exactly instead: that alone is ~1.6-2x the throughput of the old sizing.
function groqExcerptChars() {
  const callBudget = Math.floor((LLMQueue.tpmLimit || 7000) / 2) - 120;
  const excerptTokens = callBudget - PROMPT_OVERHEAD_TOKENS - outputTokensForGroq(GROQ_MAX_QUESTIONS_PER_CALL);
  return Math.min(6000, Math.max(2400, excerptTokens * 4));
}
function sourceCharBudget()    { return geminiPrimary() ? GEMINI_SOURCE_CHAR_BUDGET   : groqExcerptChars(); }
function maxQuestionsPerCall() { return geminiPrimary() ? GEMINI_MAX_QUESTIONS_PER_CALL : GROQ_MAX_QUESTIONS_PER_CALL; }
function maxOutputTokensCap()  { return geminiPrimary() ? GEMINI_MAX_OUTPUT_TOKENS    : GROQ_MAX_OUTPUT_TOKENS; }

// A question in the COMPACT schema (t/d/q/o/a/k/z) is ~130-170 output tokens.
//  - Groq/OpenRouter: max_tokens is charged against the per-minute budget, so
//    size tightly (a truncated tail is salvaged by the provider layer).
//  - Gemini: thinking tokens share the output budget; keep generous headroom.
function outputTokensForGroq(n) { return Math.min(GROQ_MAX_OUTPUT_TOKENS, Math.max(700, n * 160 + 420)); }
function outputTokensFor(count) {
  const n = count || 1;
  if (geminiPrimary()) return Math.min(maxOutputTokensCap(), Math.max(4000, n * 220 + 4000));
  return outputTokensForGroq(n);
}

const envInt = (k, d) => { const v = parseInt(process.env[k] || '', 10); return Number.isFinite(v) ? v : d; };
const envFloat = (k, d) => { const v = parseFloat(process.env[k] || ''); return Number.isFinite(v) ? v : d; };
// Read at call time so tests / deployments can change them without a restart.
export function generationConfig() {
  return {
    timeBudgetMs:    Math.max(5000, envInt('GEN_TIME_BUDGET_MS', 8 * 60 * 1000)), // hard wall-clock budget for LLM work; the bank is completed extractively afterwards
    concurrency:     Math.max(0, envInt('GEN_CONCURRENCY', 0)),                    // 0 = auto from available providers
    extractiveShare: Math.min(0.9, Math.max(0, envFloat('GEN_EXTRACTIVE_SHARE', 0.35))), // share of each source's questions generated locally up front
    maxRounds:       Math.max(1, envInt('GEN_MAX_ROUNDS', 2)),                     // LLM rounds per source (1 = no top-up retry)
    cache:           process.env.GEN_CACHE !== '0',
    embedMax:        Math.max(0, envInt('GEN_EMBED_MAX', 120)),                    // cap on texts sent to the embedding dedup pass (0 = off)
    taskMinMs:       Math.max(3000, envInt('GEN_TASK_MIN_MS', 15000)),             // do not START an LLM call with less than this left
    pace:            Math.min(1, Math.max(0.2, envFloat('GEN_LLM_PACE', 0.7))),     // stop STARTING new LLM calls after this fraction of the budget (in-flight ones may finish)
  };
}

// Auto concurrency = the SUM of what every provider can take at once (usable
// Gemini (key, model) slots + OpenRouter keys x per-key limit + Groq keys x 2 +
// Cerebras), bounded by GEN_MAX_CONCURRENCY (default 12) and by the LLMQueue
// size minus one slot reserved for interactive calls. GEN_CONCURRENCY overrides.
export function autoConcurrency(status = GeminiService.generationStatus(), { max = envInt('GEN_MAX_CONCURRENCY', 12), queueMax = LLMQueue.max || 5 } = {}) {
  const c = status?.slots?.total ?? 0;
  return Math.max(1, Math.min(c, Math.max(1, max), Math.max(1, queueMax - 1)));
}

// Progress for the whole run. `done` = questions accepted so far across every
// source (extractive picks count immediately — they are real accepted
// questions); phase is 'throttled' only while EVERY in-flight LLM call is
// parked on a rate limit, and flips back to 'generating' the moment one is
// released (the old emitter could leave a stale "paused ~90s" on screen
// because it never saw the end of the wait).
function makeProgressEmitter(onProgress, total) {
  let lastDone = -1;
  let lastPhase = null;
  let lastDelay = -1;
  const safe = (evt) => { if (typeof onProgress === 'function') { try { onProgress(evt); } catch { /* ignore */ } } };
  return {
    progress(done) {
      const clamped = Math.min(total, Math.max(0, done | 0));
      // Emit when the count OR the phase changed; stay quiet otherwise.
      if (clamped === lastDone && lastPhase === 'generating') return;
      lastDone = clamped; lastPhase = 'generating'; lastDelay = -1;
      safe({ phase: 'generating', done: clamped, total });
    },
    throttle(delayMs) {
      const d = delayMs | 0;
      if (lastPhase === 'throttled' && lastDelay === d) return;
      lastPhase = 'throttled'; lastDelay = d;
      safe({ phase: 'throttled', done: Math.max(0, lastDone), total, delayMs: d });
    },
    resume() {
      if (lastPhase === 'throttled') { lastPhase = 'generating'; lastDelay = -1; safe({ phase: 'generating', done: Math.max(0, lastDone), total }); }
    },
  };
}

// ── Shared near-duplicate / seen-content tracking ────────────────────────────
// Single source of truth for "have we already produced this question" —
// previously this logic was independently copy-pasted across
// deduplicateQuestions and mergeFallbackUnique (two implementations that
// could silently drift). Consolidated into one tracker so there is exactly
// ONE normalize/overlap implementation in the file, and so it can be
// pre-seeded with EXTERNAL content (e.g. a prior version's questions) —
// which is what the cross-version regeneration-diversity filter needs,
// without adding a third copy of this logic.
function normalizeTokens(s) {
  return (s || '').toLowerCase().replace(/[^a-z0-9 ]/g, '').split(/\s+/).filter(Boolean);
}
function normalizeOption(o) {
  return (o || '').toLowerCase().replace(/^[a-d]\)\s*/i, '').trim();
}
function isNearDuplicateTokens(tokensA, tokensB, threshold = 0.70) {
  const intersection = [...tokensA].filter(t => tokensB.has(t)).length;
  const union = new Set([...tokensA, ...tokensB]).size;
  return union > 0 && intersection / union > threshold;
}

// ── Semantic (concept-level) duplicate detection ──────────────────────────────
// The raw-token check above (isNearDuplicateTokens, >70% Jaccard on the
// unmodified question stem) only catches near-verbatim repeats — it's
// effectively a paraphrase-blind exact-match detector. Two questions that
// test the SAME knowledge point read as unrelated to it the moment either
// the wording changes meaningfully or the question TYPE changes (an MCQ
// stem vs. a subjective prompt about the same fact share almost no raw
// vocabulary). This is the mechanical reason regeneration only ever
// "changes wording" and an MCQ/subjective pair can silently test the same
// thing: nothing upstream was ever comparing MEANING, only surface text.
//
// conceptTokens() strips stopwords and stems the rest (same lightweight
// suffix-stripping approach already used for fill-blank/subjective
// answer-equivalence in assessment.js's isAnswerCorrect — deliberately
// consistent with that, not a second competing algorithm) so
// "escalate/escalating/escalation" or "verify/verified/verification"
// collapse to one concept. extractConceptText() additionally folds in the
// CORRECT answer's content (the correct MCQ option, or the fill/subjective
// answer) — because "what is being tested" for a question is defined as
// much by its answer as by its stem, and that's exactly the signal an MCQ
// and a subjective question about the same fact actually share even when
// their stems don't.
const STOP_WORDS = new Set([
  'the','a','an','is','are','was','were','be','been','being','have','has','had',
  'do','does','did','will','would','could','should','may','might','must','can',
  'of','in','on','at','to','for','with','by','from','up','about','into','through',
  'and','or','but','if','then','that','this','it','its','not','no','so','as',
  'than','when','where','which','who','how','what','why','you','your','i','we',
  'they','he','she','also','very','all','any','each','some','employee','process',
]);
function stem(w) {
  return w
    .replace(/ing$/, '')
    .replace(/tions?$/, 't')
    .replace(/ments?$/, '')
    .replace(/nesses?$/, '')
    .replace(/iers?$/, 'y')
    .replace(/ies$/, 'y')
    .replace(/ers?$/, '')
    .replace(/es$/, '')
    .replace(/s$/, '');
}
function conceptTokens(s) {
  return normalizeTokens(s)
    .filter(t => t.length > 2 && !STOP_WORDS.has(t))
    .map(stem);
}
function extractConceptText(q) {
  const parts = [q?.question || ''];
  if (Array.isArray(q?.options) && q.options.length) {
    const letter = (q.answer || '').trim().toUpperCase()[0];
    const correctOpt = q.options.find(o => o.trim().toUpperCase().startsWith(`${letter})`) || o.trim().toUpperCase().startsWith(letter))
      || q.options[0];
    if (correctOpt) parts.push(normalizeOption(correctOpt));
  } else if (q?.answer) {
    parts.push(q.answer);
  }
  return parts.join(' ');
}
// Lower threshold than the raw-token check (0.62 vs 0.70) — deliberately: with
// stopwords removed and inflection collapsed, two genuinely different
// questions on the same sub-topic already share less residual vocabulary, so
// this can be stricter without over-rejecting adjacent-but-distinct content.
// The >=4-token floor avoids flagging two short/generic concept sets as
// "62% similar" by chance.
const CONCEPT_SIMILARITY_THRESHOLD = 0.62;
const MIN_CONCEPT_TOKENS_TO_COMPARE = 4;

// Tracks question-text token sets (fuzzy, >70% raw overlap = duplicate),
// concept token sets (fuzzy, >62% stemmed/stopword-free overlap, answer-
// content-aware = SEMANTIC duplicate — this is what catches paraphrases and
// cross-type duplicates), MCQ option sets (exact, order-independent), and
// fill_blank/subjective answers (exact) across a growing set of questions.
// `preSeededQuestions` lets a caller seed the tracker with content it should
// treat as "already used" without those questions being part of the batch
// actually being built — this is the single chokepoint every dedup path in
// this file routes through (deduplicateQuestions, mergeUnique,
// mergeFallbackUnique, fillEmergencyGap, and the cross-file tracker in
// generateQuestionsFromFiles), so improving it here fixes all of them.
function createSeenTracker(preSeededQuestions = []) {
  const tokenSets = [];
  const conceptSets = [];
  const optionSets = new Set();
  const answers = new Set();
  const texts = new Set();

  function add(q) {
    if (!q || !q.question) return;
    tokenSets.push(new Set(normalizeTokens(q.question)));
    conceptSets.push(new Set(conceptTokens(extractConceptText(q))));
    texts.add((q.question || '').trim().toLowerCase());
    if (Array.isArray(q.options) && q.options.length) {
      const key = q.options.map(normalizeOption).sort().join('|');
      if (key) optionSets.add(key);
    } else if (q.answer && (q.type === 'fill_blank' || q.type === 'subjective')) {
      const key = q.answer.toLowerCase().trim();
      if (key) answers.add(key);
    }
  }
  preSeededQuestions.forEach(add);

  return {
    add,
    isDuplicate(q) {
      if (!q || !q.question) return true; // no text = always reject
      const key = (q.question || '').trim().toLowerCase();
      if (texts.has(key)) return true;
      const tokens = new Set(normalizeTokens(q.question));
      if (tokenSets.some(prev => isNearDuplicateTokens(tokens, prev))) return true;
      const concept = new Set(conceptTokens(extractConceptText(q)));
      if (concept.size >= MIN_CONCEPT_TOKENS_TO_COMPARE
          && conceptSets.some(prev => prev.size >= MIN_CONCEPT_TOKENS_TO_COMPARE && isNearDuplicateTokens(concept, prev, CONCEPT_SIMILARITY_THRESHOLD))) {
        return true;
      }
      if (Array.isArray(q.options) && q.options.length) {
        const normOpts = q.options.map(normalizeOption);
        if (new Set(normOpts).size !== normOpts.length) return true; // dup within itself
        const optKey = normOpts.sort().join('|');
        if (optKey && optionSets.has(optKey)) return true;
      } else if (q.answer && (q.type === 'fill_blank' || q.type === 'subjective')) {
        const ansKey = q.answer.toLowerCase().trim();
        if (ansKey && answers.has(ansKey)) return true;
      }
      return false;
    },
  };
}

// Deduplicate questions by meaning: remove questions whose text is >70% similar
// to any already-seen question. `avoidSet` (optional) pre-seeds the tracker
// with external content (e.g. a prior approved version's questions) so
// regeneration can reject near-duplicates of what employees already saw, not
// just duplicates within the current batch.
function deduplicateQuestions(questions, avoidSet = []) {
  const tracker = createSeenTracker(avoidSet);
  return questions.filter(q => {
    if (tracker.isDuplicate(q)) return false;
    tracker.add(q);
    return true;
  });
}

// Merge a new batch into an existing (already-deduplicated) pool, keeping only
// questions that are unique against the pool, each other, AND (if supplied)
// an external avoid-set.
function mergeUnique(pool, batch, avoidSet = []) {
  if (!Array.isArray(batch) || batch.length === 0) return pool;
  return deduplicateQuestions([...pool, ...batch], avoidSet);
}

// Merge deterministic fallback content into the pool.
//
// Fallback content is held to the SAME fuzzy standard as LLM-generated
// content (via the shared tracker above) — a prior version of this function
// used only exact-text matching, on the assumption that each skill x template
// combo is inherently distinct enough that fuzzy overlap would incorrectly
// flag them as near-duplicates. That assumption breaks down whenever the
// skill/keyword pool feeding the templates is small relative to the
// requested count. Since validateQuestionBank enforces the same fuzzy
// threshold on the final bank regardless of where a question came from,
// letting fallback content bypass it here only defers the rejection.
// `avoidSet` (optional) additionally rejects fallback content that repeats a
// prior version's questions — the same cross-version diversity guarantee
// applied to the LLM path.
function mergeFallbackUnique(pool, batch, avoidSet = []) {
  if (!Array.isArray(batch) || batch.length === 0) return pool;
  const tracker = createSeenTracker([...avoidSet, ...pool]);
  const additions = [];
  for (const q of batch) {
    if (tracker.isDuplicate(q)) continue;
    tracker.add(q);
    additions.push(q);
  }
  return [...pool, ...additions];
}

// ── Embedding-based semantic dedup — final pass over an assembled bank ────────
// The lexical/concept checks in createSeenTracker (stemming + stopword
// removal + answer-content folding) catch a lot, but genuinely cannot catch
// true synonym-level paraphrases: "What is the first STEP" vs "which ACTION
// should be performed INITIALLY" share almost no stems even after stemming,
// because "step"/"action" and "first"/"initially" are different words
// entirely, not inflections of the same one. That gap needs real semantic
// understanding, which is what this adds — ONE Gemini batchEmbedContents
// call per generation run (not per question, not per attempt) embeds the
// question+answer text of every candidate, and any pair whose cosine
// similarity exceeds SEMANTIC_EMBED_THRESHOLD is treated as the same
// knowledge point regardless of surface wording or question type. Greedy,
// first-occurrence-wins — matches the "earlier content wins" convention
// createSeenTracker already uses (locked/prior questions are always seeded
// first). Pure enhancement: embedTexts() returning null (quota, network,
// any failure) means this returns the input completely unchanged — the
// lexical pass some questions already survived stands as the final answer.
const SEMANTIC_EMBED_THRESHOLD = 0.90;

function cosineSimilarity(a, b) {
  let dot = 0, magA = 0, magB = 0;
  for (let i = 0; i < a.length; i++) { dot += a[i] * b[i]; magA += a[i] * a[i]; magB += b[i] * b[i]; }
  const denom = Math.sqrt(magA) * Math.sqrt(magB);
  return denom > 0 ? dot / denom : 0;
}

// avoidQuestions (optional): embedded alongside the pool and used to SEED
// the comparison set (never included in the returned output) — so a
// paraphrase too subtle for createSeenTracker's stemmed-concept-overlap
// check (e.g. a deleted question reworded with synonyms/different sentence
// structure that still tests the same fact) still gets caught here, instead
// of only ever being compared against other members of the CURRENT pool.
// This was the real gap behind "deleted questions reappear after
// regenerate": the lexical/concept dedup runs against the avoid-list
// correctly, but this stronger embedding pass previously never did. Capped
// (ALREADY caps the caller-side prompt-facing list at 60 for token-budget
// reasons; this reuses the same-shaped, deleted-question-first list) so one
// generation run never pays for embedding hundreds of historical entries.
const SEMANTIC_AVOID_CAP = 80;
// batchEmbedContents embeds at most 100 texts per request (GeminiService.embedTexts
// truncates beyond that, which used to misalign pool vs avoid-list embeddings
// whenever avoid + pool exceeded 100): the avoid list is capped to what is left.
const EMBED_REQUEST_CAP = 100;
async function applySemanticDedup(questions, avoidQuestions = []) {
  if (!Array.isArray(questions) || questions.length === 0) return questions;
  if (questions.length > EMBED_REQUEST_CAP) return questions; // too big for one request: lexical dedup stands
  const avoidList = (Array.isArray(avoidQuestions) ? avoidQuestions : []).slice(0, Math.min(SEMANTIC_AVOID_CAP, EMBED_REQUEST_CAP - questions.length));
  if (questions.length < 2 && avoidList.length === 0) return questions;
  try {
    const poolTexts = questions.map(q => extractConceptText(q).slice(0, 1500));
    const avoidTexts = avoidList.map(q => extractConceptText(q).slice(0, 1500));
    const embeddings = await GeminiService.embedTexts([...avoidTexts, ...poolTexts]);
    if (!embeddings) return questions; // fail open — lexical results stand
    const avoidEmbeddings = embeddings.slice(0, avoidTexts.length);
    const poolEmbeddings = embeddings.slice(avoidTexts.length);

    const kept = [];
    // Seeded with the avoid-list's embeddings so a pool question too similar
    // to something already used/deleted is rejected on the FIRST comparison,
    // without ever being included in what's returned.
    const keptEmbeddings = [...avoidEmbeddings];
    let removed = 0, removedVsAvoid = 0;
    for (let i = 0; i < questions.length; i++) {
      const dupIdx = keptEmbeddings.findIndex(prev => cosineSimilarity(poolEmbeddings[i], prev) > SEMANTIC_EMBED_THRESHOLD);
      if (dupIdx !== -1) {
        removed++;
        if (dupIdx < avoidEmbeddings.length) removedVsAvoid++;
        continue;
      }
      kept.push(questions[i]);
      keptEmbeddings.push(poolEmbeddings[i]);
    }
    if (removed > 0) {
      console.log(`[AssessmentGenerator] semantic embedding pass removed ${removed} question(s) whose meaning duplicated an earlier one (${removedVsAvoid} matched a prior/deleted question, cosine > ${SEMANTIC_EMBED_THRESHOLD})`);
    }
    return kept;
  } catch (err) {
    console.warn(`[AssessmentGenerator] semantic dedup pass failed (${err.message}) — lexical dedup result used as-is.`);
    return questions;
  }
}

// Interleave questions by difficulty (easy → medium → hard → easy → ...) without
// relabeling or cross-difficulty borrowing. The exact count is always preserved.
// Cross-difficulty borrowing was the root cause of two bugs:
//   (a) count loss when donors couldn't spare questions (41 of 50 error)
//   (b) difficulty label corruption (hard questions relabeled as easy)
function rebalanceDifficulty(questions) {
  const buckets = { easy: [], medium: [], hard: [] };
  for (const q of questions) {
    const d = (q.difficulty === 'easy' || q.difficulty === 'medium' || q.difficulty === 'hard')
      ? q.difficulty : 'medium';
    buckets[d].push(q);
  }
  // Interleave round-robin so output is easy, medium, hard, easy, medium, hard …
  const result = [];
  const order = ['easy', 'medium', 'hard'];
  const maxLen = Math.max(buckets.easy.length, buckets.medium.length, buckets.hard.length);
  for (let i = 0; i < maxLen; i++) {
    for (const diff of order) {
      if (i < buckets[diff].length) result.push(buckets[diff][i]);
    }
  }
  // result.length === questions.length — no questions are ever dropped or added
  return result;
}

// Trim down to exactly `target` questions, preserving type ratios where possible.
// Always returns exactly target items as long as questions.length >= target.
function trimToTarget(questions, target, types) {
  if (questions.length <= target) return questions;
  const typeCounts = {};
  types.forEach(t => { typeCounts[t] = (typeCounts[t] || 0) + 1; });
  const total = types.length || target;
  const result = [];
  const used = new Set();
  for (const [type, count] of Object.entries(typeCounts)) {
    const want = Math.round((count / total) * target);
    const picked = questions.filter(q => q.type === type && !used.has(q)).slice(0, want);
    picked.forEach(q => used.add(q));
    result.push(...picked);
  }
  // Fill remainder with any unused question (any type) to guarantee exact count
  for (const q of questions) {
    if (result.length >= target) break;
    if (!used.has(q)) { result.push(q); used.add(q); }
  }
  return result.slice(0, target);
}

// ── Compact prompts ──────────────────────────────────────────────────────────
// The previous prompts were ~3,000 tokens of instructions per call (document
// path: 4 "STEP" blocks, a 14-style rotation list, a banned-phrase list, a
// verbose output schema, a 60-item avoid list) — re-sent on EVERY call and
// charged against Groq's 7k tokens/minute. These carry the same rules (verbatim
// quote grounding, no generic stems, exact count, per-call type + difficulty
// mix, avoid-list) in roughly a fifth of the tokens, and ask for a compact JSON
// schema that is expanded locally (options get their "A)" prefix, the
// explanation / sourceSection are derived from the quote, not generated).
const COMPACT_TAIL = `3. "z" is a verbatim 6-25 word quote copied character-for-character from the excerpt, the exact text the question tests. No quote that can be copied from the excerpt = do not write the question.
4. No generic or definition-style stems ("purpose of X", "which best describes X", "what does X mean"). One fact per question; no two questions on the same fact. Never use stakeholder-management, change-management, leadership or best-practice phrasing unless quoted from the excerpt.
5. Prefer application: a concrete situation that needs a rule, threshold, sequence or exception from the excerpt ("Given X, what happens next?"). At most 1 in 10 questions may begin with "As a [role]".
6. mcq: 4 distinct, plausible options built from the excerpt's own terms, exactly one correct, never "all/none of the above", vary the correct letter. fill: answer is a 1-5 word term/value from the excerpt. subj: answer is 2-3 points joined by " | ", each under 20 words.
OUTPUT: JSON only, no prose: {"questions":[{"t":"mcq|fill|subj","d":"easy|medium|hard","q":"question text","o":["opt","opt","opt","opt"],"a":"A-D for mcq, else the answer text","k":"skill area, 2-4 words","z":"verbatim quote"}]}
"o" is only for mcq and holds plain option texts WITHOUT "A)" prefixes.`;

function buildCompactSystemPrompt(mode = 'doc') {
  const head = mode === 'jd'
    ? `You write role-specific assessment questions from a job-description excerpt (it may include process documents).
RULES
1. Every question tests a responsibility, skill, process, tool or competency EXPLICITLY present in the excerpt, in the JD's own domain and at its seniority level, using its terminology. No outside knowledge; no coding questions unless the JD requires programming.
2. Never ask about titles, headings, authors, versions, dates, page numbers or file names.
3. Self-contained questions only: NEVER use phrases like "According to the document...", "As per page X...", "Based on the section...", or mention document/file/page references in questions or options. Questions must read naturally as professional workplace assessments.
4. For fill-in-the-blank questions: test domain terminology, technical parameters, or operational codes. NEVER test trivial grammar words (such as "is", "was", "the", "a", "an").`
    : `You write precise, document-specific assessment questions from ONE source excerpt.
RULES
1. Test only facts, steps, rules, thresholds, codes, systems and exceptions EXPLICITLY stated in the excerpt, using its exact terminology. No outside knowledge, no general best practice.
2. Never ask about titles, headings, authors, reviewers, versions, dates, page numbers, file names or confidentiality labels. Draw on procedure steps, tables, decision rules, exceptions and body text.
3. Self-contained questions only: NEVER use phrases like "According to the document...", "As per page X...", "Based on the section...", or mention document/file/page references in questions or options. Questions must read naturally as professional workplace assessments.
4. For fill-in-the-blank questions: test domain terminology, technical parameters, or operational codes. NEVER test trivial grammar words (such as "is", "was", "the", "a", "an").`;
  return `${head}\n${COMPACT_TAIL}`;
}

// Short "already covered" list for the prompt. Ranked by BM25 relevance to the
// excerpt being sent (an avoided question about a DIFFERENT part of the
// document cannot be repeated from this excerpt, so it is wasted tokens),
// capped, and each entry trimmed to its first words.
function buildAvoidSection(avoidQuestions, excerpt = '') {
  const AVOID_PROMPT_CAP = geminiPrimary() ? 30 : 12;
  if (!Array.isArray(avoidQuestions) || avoidQuestions.length === 0) return '';
  const seen = new Set();
  const items = [];
  for (const q of avoidQuestions) {
    const text = (q?.question || q || '').toString().trim();
    const key = text.toLowerCase();
    if (!text || seen.has(key)) continue;
    seen.add(key); items.push(text);
  }
  if (items.length === 0) return '';
  let chosen = items;
  if (items.length > AVOID_PROMPT_CAP) {
    const bm = new BM25(items.map(t => contentTokens(t)));
    const freq = new Map();
    for (const w of contentTokens(excerpt)) freq.set(w, (freq.get(w) || 0) + 1);
    const query = [...freq.entries()].sort((a, b) => b[1] - a[1]).slice(0, 150).map(e => e[0]);
    const ranked = bm.rank(query, AVOID_PROMPT_CAP).map(r => items[r.i]);
    chosen = ranked.length >= 6 ? ranked : items.slice(0, AVOID_PROMPT_CAP);
  }
  const lines = chosen.map(t => { const w = t.split(/\s+/); return `- ${w.slice(0, 10).join(' ')}${w.length > 10 ? '...' : ''}`; });
  return `\nAlready covered (earlier in this run, deleted by an admin, or in a prior version) - cover DIFFERENT facts and wording:\n${lines.join('\n')}\n`;
}

function distribute(total, weights) {
  const sum = weights.reduce((a, b) => a + b, 0) || 1;
  const raw = weights.map(w => (total * w) / sum);
  const out = raw.map(Math.floor);
  let left = total - out.reduce((a, b) => a + b, 0);
  const order = raw.map((r, i) => [r - Math.floor(r), i]).sort((a, b) => b[0] - a[0]);
  for (let i = 0; left > 0; i = (i + 1) % order.length, left--) out[order[i][1]]++;
  return out;
}

function buildCompactUserPrompt({ count, mode = 'doc', jobRole, sourceText, sourceName, sourceType, seed, skillsContext = [], stakeholder = false, processDelivery = false, avoidQuestions = [], typeNeeds = null, diffNeeds = null, styleProfile = null }) {
  const docLabel = mode === 'jd' || sourceType === 'jd' ? 'Job Description' : 'Process Document / Internal Reference';
  const typeCounts = typeNeeds || { mcq: count };
  const tparts = [['mcq', 'mcq'], ['fill_blank', 'fill'], ['subjective', 'subj']].filter(([k]) => typeCounts[k] > 0).map(([k, s]) => `${s} x${typeCounts[k]}`);
  const dc = diffNeeds || (() => { const [e, m, h] = distribute(count, [35, 45, 20]); return { easy: e, medium: m, hard: h }; })();
  const dparts = ['easy', 'medium', 'hard'].filter(k => dc[k] > 0).map(k => `${k} x${dc[k]}`);
  const scope = [];
  scope.push(stakeholder
    ? 'Stakeholder/escalation content: allowed only where the excerpt states the exact steps, paths or approvals.'
    : 'Do NOT ask about stakeholder communication, client relationships, team interaction or escalation behaviour; stick to functional steps, rules, validations and system actions.');
  scope.push(processDelivery
    ? 'SLA/KPI/governance content: allowed only where the excerpt states the exact thresholds, KPI names or reporting formats.'
    : 'Do NOT ask about governance, SLA/KPI management, reporting or delivery management unless that is the whole subject of the excerpt.');
  const skills = skillsContext.length > 0 ? `Role skills (context only, not a question source): ${skillsContext.slice(0, 12).join(', ')}\n` : '';
  const styleSection = styleProfile && typeof styleProfile.toPromptInstructions === 'function' && styleProfile.toPromptInstructions()
    ? `\n${styleProfile.toPromptInstructions()}\n`
    : '';
  return `Role: ${jobRole || 'Professional'} | Source: ${sourceName || 'Source Document'} (${docLabel}) | Seed: ${seed}
Write exactly ${count} questions (${tparts.join(', ')}; ${dparts.join(', ')}). Scenario/application questions where the excerpt allows; direct recall only for hard facts.
${scope.join(' ')}
${skills}${styleSection}${buildAvoidSection(avoidQuestions, sourceText)}
EXCERPT:
${sourceText}`;
}

// ── Reply normalisation: compact (or legacy full) schema -> app question shape ─
const TYPE_ALIASES = { mcq: 'mcq', multiple_choice: 'mcq', 'multiple-choice': 'mcq', fill: 'fill_blank', fill_blank: 'fill_blank', fill_in_blank: 'fill_blank', 'fill-blank': 'fill_blank', subj: 'subjective', subjective: 'subjective', short: 'subjective', essay: 'subjective', short_answer: 'subjective' };
function normalizeLLMQuestions(raw, { fallbackSection = null, findSection = null } = {}) {
  if (!Array.isArray(raw)) return [];
  const out = [];
  for (const r of raw) {
    if (!r || typeof r !== 'object') continue;
    const question = String(r.q ?? r.question ?? '').trim();
    if (!question) continue;
    let type = TYPE_ALIASES[String(r.t ?? r.type ?? '').toLowerCase().trim()];
    const rawOpts = Array.isArray(r.o) ? r.o : Array.isArray(r.options) ? r.options : null;
    if (!type) type = rawOpts ? 'mcq' : 'subjective';
    const difficulty = ['easy', 'medium', 'hard'].includes(String(r.d ?? r.difficulty).toLowerCase()) ? String(r.d ?? r.difficulty).toLowerCase() : 'medium';
    const quote = String(r.z ?? r.sourceQuote ?? '').trim();
    const answerRaw = String(r.a ?? r.answer ?? '').trim();
    const q = { type, question, difficulty };
    if (type === 'mcq') {
      const opts = (rawOpts || []).map(o => String(o ?? '').replace(/^\s*[A-Da-d][).:]\s*/, '').trim());
      if (opts.length !== 4 || opts.some(o => !o) || new Set(opts.map(o => o.toLowerCase())).size !== 4) continue;
      if (opts.some(o => /^(all|none) of the above$/i.test(o))) continue;
      let letter = (/^\s*([A-Da-d])\s*(?:[).:]|$)/.exec(answerRaw) || [])[1];
      if (!letter) { const idx = opts.findIndex(o => o.toLowerCase() === answerRaw.replace(/^[A-Da-d][).:]\s*/, '').toLowerCase()); if (idx >= 0) letter = 'ABCD'[idx]; }
      if (!letter) continue;
      q.options = opts.map((o, i) => `${'ABCD'[i]}) ${o}`);
      q.answer = letter.toUpperCase();
    } else if (type === 'fill_blank') {
      if (!answerRaw || answerRaw.split(/\s+/).length > 10) continue;
      q.answer = answerRaw;
    } else {
      if (!answerRaw) continue;
      const parts = answerRaw.split(/\s*\|\s*|\n+/).map(p => p.replace(/^[•\-*\d.)\s]+/, '').trim()).filter(Boolean).slice(0, 3);
      if (parts.length === 0) continue;
      q.answer = parts.map(p => `• ${p}`).join(' | ');
    }
    q.skillArea = String(r.k ?? r.skillArea ?? '').trim() || fallbackSection || 'Document content';
    q.sourceQuote = quote;
    const sec = String(r.sourceSection ?? '').trim() || (typeof findSection === 'function' ? findSection(quote) : null) || fallbackSection || null;
    q.sourceSection = sec;
    q.explanation = String(r.explanation ?? '').trim() || `Stated in the document${sec ? ` (${sec})` : ''}: "${quote.split(/\s+/).slice(0, 28).join(' ')}"`;
    q.generatedBy = 'llm';
    out.push(q);
  }
  return out;
}

// Extract high-frequency content words from a document — used as fallback skill list
// so template questions reference actual document vocabulary instead of generic terms.
function extractDocKeywords(text, maxTerms = 8) {
  if (!text) return [];
  const STOP = new Set(['the','and','for','that','this','with','from','they','have','their','will','been','more','when','what','each','then','than','also','into','over','your','which','about','after','before','during','between','through','should','would','could','where','there','these','those','other','every','under','above','using','being','while','whether','without','against','following','according','includes','required','provide','ensure','review']);
  const freq = {};
  text.replace(/[^a-zA-Z0-9\s]/g, ' ').split(/\s+/).forEach(w => {
    if (w.length > 4 && !STOP.has(w.toLowerCase())) {
      const lw = w.toLowerCase();
      freq[lw] = (freq[lw] || 0) + 1;
    }
  });
  return Object.entries(freq)
    .filter(([, c]) => c >= 2)
    .sort((a, b) => b[1] - a[1])
    .slice(0, maxTerms)
    .map(([w]) => w);
}

// Phrases/patterns that indicate a question was derived from document
// metadata (title/heading/filename/author/etc.) rather than actual body
// content, or names a specific person rather than a role/process (Issue 13).
// Declared here (rather than only near validateQuestionBank, which also uses
// them) so extractDocEntities below can reuse the exact same patterns for
// its own noise filter instead of duplicating them.
const HEADER_FOOTER_PATTERNS = [
  /\bpage \d+\b/i, /\bversion \d+(\.\d+)*\b/i, /\bconfidential\b/i, /\bcopyright\b/i,
  /\bfile ?name\b/i, /\.(docx?|pdf|xlsx?|pptx?)\b/i, /\bauthor(ed)? by\b/i, /\breviewed by\b/i,
];
const PERSON_NAME_PATTERNS = [/\bmr\.\s|\bmrs\.\s|\bms\.\s|\bdr\.\s/i];

// A candidate entity/keyword pulled from a real, messy uploaded document
// (headers, footers, page numbers, table cells, OCR artifacts) can just as
// easily match extractDocEntities' proper-noun regex as a genuine system/tool
// name can — e.g. "Page 3 Of 12", "TOTAL AMOUNT DUE", a heading fragment cut
// off by a page break. That garbled phrase then gets substituted verbatim
// into a fallback question template ("When starting a task involving Page 3
// Of 12, which action should be completed first?"), which is the direct,
// model-independent (not a GROQ/Gemini quality issue) cause of confusing
// fallback-path questions. Filters those out before they're ever added as a
// candidate entity.
function looksLikeNoisePhrase(phrase) {
  if (HEADER_FOOTER_PATTERNS.some(re => re.test(phrase)) || PERSON_NAME_PATTERNS.some(re => re.test(phrase))) return true;
  // 3+ consecutive ALL-CAPS words — a strong signal of a table header or
  // shouty heading, not real prose. The proper-noun regex's
  // `[a-zA-Z0-9]*` deliberately allows any case after the first letter (so
  // it can also match genuine names), so this needs a separate check.
  if (/^[A-Z0-9]+(\s+[A-Z0-9]+){2,}$/.test(phrase)) return true;
  // Bare page-range fragments like "3 Of 12" — can appear without a leading
  // "Page" if extraction/OCR drops the first word.
  if (/^\d+\s+of\s+\d+$/i.test(phrase)) return true;
  return false;
}

// Extracts multi-word proper-noun phrases (tool/system/form names — "Payment
// Gateway", "Tier 2 Escalation Matrix") and number+unit tokens (thresholds,
// SLAs, codes — "48 hours", "99.9%", "Level 3") from a document. These are
// much stronger grounding/fallback seeds than extractDocKeywords' single
// frequent words: a named system or a specific threshold is unambiguously
// "this document's actual content," whereas a frequent common word like
// "process" or "review" just proves topical proximity. Used alongside
// extractDocKeywords (not instead of it) everywhere fallback content needs a
// skill/topic seed, so template questions cite the document's real
// terminology instead of generic role skills.
function extractDocEntities(text, maxTerms = 12) {
  if (!text) return [];
  const entities = new Set();

  // Consecutive-capitalized sequences of 2-4 words, e.g. "Payment Gateway",
  // "Tier 2 Escalation Matrix" — skips a lone capitalized word at a sentence
  // start (rarely meaningful alone) by requiring at least 2 words. The
  // separator is deliberately [ \t]+ (same line only), NOT \s+ — \s+ matches
  // newlines too, which let this regex splice together unrelated adjacent
  // lines (e.g. a table header ending in "TOTAL AMOUNT DUE" immediately
  // followed by the next line's capitalized first word) into one garbled
  // multi-word "entity" that then got used as a fallback question topic.
  const properNounRe = /\b([A-Z][a-zA-Z0-9]{2,}(?:[ \t]+(?:[A-Z][a-zA-Z0-9]*|\d+)){1,3})\b/g;
  let m;
  while ((m = properNounRe.exec(text)) !== null) {
    const phrase = m[1].trim();
    if (phrase.length >= 6 && phrase.length <= 60 && !looksLikeNoisePhrase(phrase)) entities.add(phrase);
  }

  // Number + unit tokens — thresholds, SLAs, percentages, tiers/levels/codes.
  const numberUnitRe = /\b\d+(?:\.\d+)?\s?(?:%|hours?|hrs?|days?|minutes?|mins?|business\s+days?)\b/gi;
  while ((m = numberUnitRe.exec(text)) !== null) entities.add(m[0].trim());
  const tierRe = /\b(?:tier|level|priority|severity|step|phase|stage)\s+\d+\b/gi;
  while ((m = tierRe.exec(text)) !== null) entities.add(m[0].trim());

  return [...entities].slice(0, maxTerms);
}

// Filter questions that are NOT grounded in the source text (JD, supporting
// docs, or a single process document — same check, different source text).
// Rejects any question whose text, skillArea, and explanation contain zero
// source-specific content words. This is the primary guard against generic
// corporate questions (process management, stakeholder communication, etc.)
// slipping through from the LLM, and is applied to BOTH the JD generation
// path and the document generation path — previously only the document path
// was filtered, which was the root cause of poor first-generation quality
// for JD-only roles.
// Safe to call even when the source is short — returns all questions
// unchanged if fewer than 5 unique content words can be extracted (validation
// impossible).
function filterGrounded(questions, sourceText) {
  if (!Array.isArray(questions) || questions.length === 0) return questions;
  // Combine frequent single words with real named entities (systems,
  // thresholds, tiers) — a question mentioning a specific entity is a much
  // stronger topical signal than a generic frequent word, though this
  // remains only a cheap pre-check; verifyQuoteGrounded is the real gate.
  const keywords = [...extractDocKeywords(sourceText, 50), ...extractDocEntities(sourceText, 20).map(e => e.toLowerCase())];
  if (keywords.length < 5) return questions; // too short to validate reliably
  return questions.filter(q => {
    const haystack = [q.question, q.skillArea, q.explanation]
      .filter(Boolean).join(' ').toLowerCase();
    return keywords.some(kw => haystack.includes(kw));
  });
}

// Normalizes text for verbatim-quote matching: strips all punctuation and
// collapses whitespace, so minor differences in quote marks/commas/line
// breaks don't cause a false rejection, while still requiring the actual
// words to appear in the same sequence as the source (a real substring
// match, not just "contains some of these words somewhere").
function normalizeForQuoteMatch(s) {
  return (s || '').toLowerCase().replace(/[^a-z0-9\s]/g, '').replace(/\s+/g, ' ').trim();
}

// THE primary grounding gate (filterGrounded above is now only a cheap
// pre-check). Requires every question to cite a `sourceQuote` — a short
// excerpt the prompt instructs the LLM to copy verbatim from the source —
// and VERIFIES it actually appears in the source text as a real substring.
// This is what "mentions 1 of 50 frequency keywords" could never catch: a
// generic question like "What is the purpose of a runbook?" will almost
// never have a genuine verbatim quote to offer, because it isn't actually
// testing a specific fact from the document — it's testing a definition the
// LLM already knew before reading anything. Deterministic, free, no
// embeddings/LLM-judge call needed.
function verifyQuoteGrounded(questions, sourceText) {
  if (!Array.isArray(questions) || questions.length === 0) return questions;
  const normalizedSource = normalizeForQuoteMatch(sourceText);
  if (normalizedSource.length < 40) return questions; // too short to enforce reliably
  return questions.filter(q => {
    const rawQuote = (q.sourceQuote || '').trim();
    if (!rawQuote) return false;
    const wordCount = rawQuote.split(/\s+/).filter(Boolean).length;
    if (wordCount < 4) return false; // too short to be a meaningful, specific citation
    const normalizedQuote = normalizeForQuoteMatch(rawQuote);
    return normalizedQuote.length >= 15 && normalizedSource.includes(normalizedQuote);
  });
}

// Per-question numeric quality score (0-100), informational only — never a
// pass/fail gate (that's validateQuestionBank's job). Reuses the same signals
// the hard gates already check (quote groundedness, generic-shape detection)
// as scoring inputs instead of inventing a second quality mechanism:
//  - groundedness (0-40): a verified, real, longer verbatim quote scores higher
//  - specificity (0-30): presence of numbers, multi-word proper nouns, and
//    question length — proxies for "testing a concrete fact" vs. a vague stem
//  - non-generic shape (0-20): fails to 0 if it matches a known generic pattern
//  - answer completeness (0-10): a non-empty answer is present
function computeQuestionQualityScore(q, sourceText) {
  const qText = (q?.question || '').trim();
  const normalizedSource = normalizeForQuoteMatch(sourceText || '');

  let groundedness = 0;
  const rawQuote = (q?.sourceQuote || '').trim();
  if (rawQuote && normalizedSource.length >= 40) {
    const normalizedQuote = normalizeForQuoteMatch(rawQuote);
    const wordCount = rawQuote.split(/\s+/).filter(Boolean).length;
    if (normalizedQuote.length >= 15 && normalizedSource.includes(normalizedQuote)) {
      groundedness = Math.min(40, 20 + wordCount);
    }
  }

  let specificity = 0;
  if (/\d/.test(qText)) specificity += 10;
  if (/[A-Z][a-z]+(?:\s+[A-Z][a-z]+)+/.test(qText)) specificity += 10;
  if (qText.split(/\s+/).filter(Boolean).length >= 8) specificity += 10;

  const nonGeneric = GENERIC_PHRASE_PATTERNS.some(re => re.test(qText)) ? 0 : 20;
  const answerQuality = (q?.answer && String(q.answer).trim()) ? 10 : 0;

  return Math.max(0, Math.min(100, Math.round(groundedness + specificity + nonGeneric + answerQuality)));
}

// Attaches `qualityScore` to every question in a bank. Called once at the end
// of each generation path (after grounding/generic filters, on the final
// exact-count bank) — not inside the retry loops, since it's informational
// metadata on the finished product, not a filter condition itself.
function attachQualityScores(questions, sourceText) {
  if (!Array.isArray(questions)) return questions;
  return questions.map(q => ({ ...q, qualityScore: computeQuestionQualityScore(q, sourceText) }));
}

// Reject questions built from generic phrasing SHAPES (Issue 5 / Issue 13's
// "no generic filler questions" requirement) — applied as an automated
// filter within the same first-pass attempt loop, no extra LLM call needed.
//
// The original version of this list only matched specific literal nouns
// ("process", "stakeholder management", "change management") — so "What is
// the purpose of a RUNBOOK?" sailed straight through, since "runbook" was
// never in the list. That's a losing game: any fixed noun list will always
// miss the next document's specific jargon. Generalized here to the
// STRUCTURAL SHAPE instead: "purpose/objective/goal of X", "key indicator of
// X", "best describes X", "what does X mean", "define X" — these framings
// structurally request a conceptual/textbook definition regardless of what
// X is, which is a fundamentally different (and always generic) question
// shape from a specific-fact recall question.
//
// Deliberately NOT included: a fully bare "what is X?" pattern. That would
// also reject legitimate specific recall questions the prompts are supposed
// to produce (e.g. "What is the retry limit before an incident escalates?").
// verifyQuoteGrounded (above) is the primary defense against generic
// "what is X" content in general — it structurally can't pass a fabricated
// or absent quote, whereas a fully bare regex here can't distinguish
// "generic definition" from "specific recall" by shape alone. This list
// stays narrow and reserved for framings that are unambiguously generic no
// matter the subject.
const GENERIC_PHRASE_PATTERNS = [
  /^what (is|are) the (primary |main |key )?(purpose|objective|goal|aim)s? of (a |an |the )?[a-z][a-z\s]{0,40}\??$/i,
  /^what is a key (indicator|characteristic|feature|benefit) of (effective |good )?[a-z\s]{0,35}\??$/i,
  /^which of the following best describes (a |an |the )?[a-z][a-z\s]{2,35}\??$/i,
  /^what does (a |an |the )?[a-z][a-z\s]{2,40} (mean|refer to|stand for)\??$/i,
  /^define (a |an |the )?[a-z][a-z\s]{2,35}\.?$/i,
  // Known offenders kept verbatim from the original list — cheap, zero
  // false-positive risk, no reason to drop them just because the shape
  // patterns above now cover the general case too.
  /^what is stakeholder management\??$/i,
  /^what is change management\??$/i,
];
function filterGenericPhrasing(questions) {
  if (!Array.isArray(questions) || questions.length === 0) return questions;
  return questions.filter(q => {
    const text = (q.question || '').trim();
    if (!text) return false;
    return !GENERIC_PHRASE_PATTERNS.some(re => re.test(text));
  });
}

// Fallback phrasing banks — kept deliberately varied (not just a number suffix)
// so the similarity-based deduplicator treats each combo as genuinely distinct.
const FALLBACK_TEMPLATES = {
  easy: [
    (s) => `When starting a task involving ${s}, which action should be completed first?`,
    (s) => `A colleague asks for the standard first step in ${s} — which response is correct?`,
    (s) => `Which observable outcome signals that ${s} was completed correctly?`,
    (s) => `Which practice most directly supports ${s}?`,
    (s) => `What foundational knowledge is required to carry out ${s} correctly?`,
    (s) => `Which tool or method is most commonly used when handling ${s}?`,
    (s) => `What is the first step typically taken when starting work on ${s}?`,
    (s) => `Which outcome best signals that ${s} has been done correctly?`,
  ],
  medium: [
    (s) => `A team encounters conflicting priorities related to ${s}. What is the recommended first step?`,
    (s) => `When evaluating options for ${s}, which factor should take highest priority?`,
    (s) => `A stakeholder requests a change that impacts ${s}. How should this be handled?`,
    (s) => `What is the most effective way to measure progress in ${s}?`,
    (s) => `How should conflicting feedback on ${s} be reconciled before finalizing an approach?`,
    (s) => `What risk should be evaluated first when planning ${s} for a new initiative?`,
    (s) => `A deadline shifts unexpectedly during ${s}. What should be reprioritized first?`,
    (s) => `Which metric would best reveal a gap in how ${s} is being executed?`,
  ],
  hard: [
    (s) => `Multiple departments disagree on the approach to ${s}. How would you build consensus while meeting the deadline?`,
    (s) => `A critical failure occurs in ${s} with no clear precedent. Describe the decision-making framework you would apply.`,
    (s) => `How would you design a scalable process for ${s} that balances efficiency, compliance, and stakeholder expectations?`,
    (s) => `Resources for ${s} are cut by 30% mid-cycle. How would you re-prioritize without compromising outcomes?`,
    (s) => `How would you redesign ${s} to remain effective under a sudden 2x increase in scale?`,
    (s) => `A long-standing assumption behind ${s} turns out to be wrong. How would you rebuild the approach?`,
    (s) => `Two senior stakeholders demand opposite outcomes for ${s}. How would you resolve this while protecting long-term goals?`,
    (s) => `How would you justify a strategic pivot in ${s} to leadership skeptical of change?`,
  ],
};

const FALLBACK_FILL_TEMPLATES = [
  (s) => [`A key outcome of effective ${s} is ______.`, `consistent, measurable, and high-quality ${s} outcomes`],
  (s) => [`The primary goal of ${s} is to achieve ______.`, `reliable, repeatable results in ${s}`],
  (s) => [`When ${s} is executed well, the result is typically ______.`, `improved efficiency and stakeholder satisfaction in ${s}`],
  (s) => [`A common best practice in ${s} is to ______.`, `document ${s} decisions and validate them against requirements`],
  (s) => [`The most important input to successful ${s} is ______.`, `clear, accurate, and timely information about ${s}`],
];

const FALLBACK_SUBJECTIVE_TEMPLATES = [
  (s) => [`Describe a situation where ${s} required careful judgment. What approach did you take and what was the result?`,
          `A strong answer identifies the specific judgment call in ${s}, explains the reasoning behind the chosen approach, and states a concrete, measurable result.`],
  (s) => [`Explain how you would approach ${s} when requirements are ambiguous. What steps would you take to reduce risk?`,
          `A strong answer sequences clarification, stakeholder input, and incremental validation to reduce risk while progressing ${s} under ambiguity.`],
  (s) => [`Walk through how you would evaluate the success of ${s} over a full quarter. What would you track and why?`,
          `A strong answer names specific leading and lagging metrics for ${s}, ties them to business outcomes, and explains the review cadence.`],
  (s) => [`Describe a scenario where ${s} conflicted with another priority. How would you decide which to address first?`,
          `A strong answer weighs urgency, impact, and dependencies to justify the prioritization between ${s} and the competing priority.`],
];

// Given a global combo index, deterministically pick a skill/template pairing.
// For indices beyond the primary skill x template grid, falls back to compound
// skill pairs ("skillA and skillB") to generate combinatorially more unique content.
// Also returns `tplIdx` — the exact template-array index chosen — so callers
// that need a SECOND parallel choice synchronized to the same combo (like
// which MCQ option bank to use) can index by tplIdx directly instead of
// re-deriving their own modulo of the raw comboIdx. Two independently-moduloed
// cycles (question template vs option bank) can realign and repeat an
// identical (skill, option-bank) pairing well before either cycle is
// individually exhausted — that was a real bug (duplicate MCQ option sets on
// two questions with different wording but identical options).
function pickCombo(templates, skills, comboIdx) {
  const n = Math.max(1, skills.length);
  const primaryCombos = n * templates.length;
  if (comboIdx < primaryCombos || n < 2) {
    const skill = skills[comboIdx % n];
    const tplIdx = Math.floor(comboIdx / n) % templates.length;
    return { skill, tpl: templates[tplIdx], tplIdx };
  }
  const secondaryIdx = comboIdx - primaryCombos;
  const skillA = skills[secondaryIdx % n];
  const skillB = skills[(secondaryIdx + 1 + Math.floor(secondaryIdx / n)) % n];
  const skill = skillA === skillB ? skillA : `${skillA} and ${skillB}`;
  const tplIdx = Math.floor(secondaryIdx / n) % templates.length;
  return { skill, tpl: templates[tplIdx], tplIdx };
}

// Never let a raw uploaded filename become a fallback "skill" substituted
// into generated question text (e.g. "...involving Employee_Handbook_v2.docx...").
// A filename is document metadata by definition — Issue 13 explicitly bans
// filename-derived questions, and a raw filename commonly contains an
// extension (.docx) and/or a version-like suffix (v2, _final_v3) that also
// trips the header/footer/metadata validation check. This is the actual,
// generic-safe fallback used whenever no real doc keywords or configured
// skills are available — never the filename itself.
const SAFE_FALLBACK_TOPIC = 'the uploaded document\'s stated responsibilities and procedures';

// Deterministic, template-based fill used ONLY to close any residual gap after
// LLM attempts are exhausted — guarantees the exact requested count is always met.
// Uses real combinatorial variety (skill x template, then skill-pair x template)
// rather than cosmetic numbering, so the dedup step never mistakes distinct
// fallback questions for near-duplicates.
function buildFallbackQuestions(count, { types, skillsList, jobRole, difficultyDeficit, typeDeficit, comboCounters = { easy: 0, medium: 0, hard: 0 } }) {
  const role = jobRole || 'Professional';
  // NEVER default to generic corporate terms — caller must supply meaningful skills
  // or document keywords. Defaulting to 'process management' / 'stakeholder communication'
  // is the root cause of the generic-question problem.
  const fallbackSkills = skillsList.length > 0 ? skillsList : ['the documented role responsibilities and requirements'];

  // Build a difficulty sequence honoring the deficit (falls back to even 35/45/20 split if not provided)
  let difficultySeq;
  if (difficultyDeficit && (difficultyDeficit.easy || difficultyDeficit.medium || difficultyDeficit.hard)) {
    difficultySeq = [
      ...Array(Math.max(0, difficultyDeficit.easy || 0)).fill('easy'),
      ...Array(Math.max(0, difficultyDeficit.medium || 0)).fill('medium'),
      ...Array(Math.max(0, difficultyDeficit.hard || 0)).fill('hard'),
    ];
  } else {
    const easyCount = Math.round(count * 0.35);
    const mediumCount = Math.round(count * 0.45);
    const hardCount = Math.max(1, count - easyCount - mediumCount);
    difficultySeq = [...Array(easyCount).fill('easy'), ...Array(mediumCount).fill('medium'), ...Array(hardCount).fill('hard')];
  }
  while (difficultySeq.length < count) difficultySeq.push(['easy', 'medium', 'hard'][difficultySeq.length % 3]);

  // Build a type sequence honoring the actual remaining deficit per type when
  // the caller supplies one, instead of cycling `types[i % types.length]` from
  // index 0 every call. The naive cycle was the root cause of a real bug:
  // `types` is typically the FULL target sequence (e.g. 10 mcq, then 5
  // fill_blank, then 5 subjective), and when only a small `count` needs
  // padding, `i % types.length` for small i just re-samples the front of that
  // array — almost always "mcq" — regardless of how many mcq/fill/subjective
  // questions are already sitting in the pool. That produced banks skewed
  // 80%+ toward mcq. Deficit-tracking fixes it by padding whichever types are
  // actually still short, the same way difficultyDeficit already does.
  let typeSeq = null;
  if (typeDeficit && (typeDeficit.mcq || typeDeficit.fill_blank || typeDeficit.subjective)) {
    typeSeq = [
      ...Array(Math.max(0, typeDeficit.mcq || 0)).fill('mcq'),
      ...Array(Math.max(0, typeDeficit.fill_blank || 0)).fill('fill_blank'),
      ...Array(Math.max(0, typeDeficit.subjective || 0)).fill('subjective'),
    ];
  }
  // Any remaining slots (no deficit supplied, or the deficit was smaller than
  // `count`) follow the platform's target ratio. This line previously read
  // `[...][typeSeq.length % 3]`, a flat round-robin that forced ~33/33/33 and
  // silently destroyed whatever mix the caller asked for — it is why fixing
  // the ratio anywhere else had no visible effect.
  if (!typeSeq || typeSeq.length < count) {
    const filled = typeSeq || [];
    typeSeq = [...filled, ...buildTypeSequence(count - filled.length, ASSESSMENT_MIX)];
  }

  return Array.from({ length: count }, (_, i) => {
    const difficulty = difficultySeq[i] || 'medium';
    const t = typeSeq ? typeSeq[i] : types[i % types.length];
    const comboIdx = comboCounters[difficulty]++;

    let questionText, answer, skill, options;
    if (t === 'fill_blank') {
      const { skill: s, tpl } = pickCombo(FALLBACK_FILL_TEMPLATES, fallbackSkills, comboIdx);
      const [text, ans] = tpl(s);
      questionText = text; answer = ans; skill = s;
    } else if (t === 'subjective') {
      const { skill: s, tpl } = pickCombo(FALLBACK_SUBJECTIVE_TEMPLATES, fallbackSkills, comboIdx);
      const [text, ans] = tpl(s);
      questionText = text; answer = ans; skill = s;
    } else {
      const { skill: s, tplIdx } = pickCombo(FALLBACK_TEMPLATES[difficulty], fallbackSkills, comboIdx);
      questionText = FALLBACK_TEMPLATES[difficulty][tplIdx](s);
      answer = 'A';
      skill = s;
      // 8 option banks — matching FALLBACK_TEMPLATES[difficulty].length exactly —
      // indexed by tplIdx (the SAME index used to pick the question wording),
      // not a separately-cycling comboIdx. Two independent cycles of different
      // lengths (previously: 8 templates vs 4 option banks) realign every
      // LCM(8,4)=8 steps and reuse an identical (skill, option-bank) pairing —
      // producing two different-worded questions with byte-identical options,
      // which the validator correctly flags as a duplicate MCQ option set.
      // Keeping both cycles the same length means every (skill, template)
      // combo gets its own distinct option bank within the primary grid.
      const OPTION_BANKS = [
        (sk) => [`A) Assess the ${sk} situation, identify the root cause, and develop a structured plan`,
                 `B) Escalate the ${sk} issue immediately without gathering information`,
                 `C) Wait for the ${sk} situation to resolve on its own`,
                 `D) Delegate the ${sk} decision without providing context or follow-up`],
        (sk) => [`A) Gather relevant data on ${sk}, consult stakeholders, then act`,
                 `B) Apply a generic solution to ${sk} without reviewing context`,
                 `C) Postpone the ${sk} decision indefinitely`,
                 `D) Act on ${sk} unilaterally without informing the team`],
        (sk) => [`A) Break the ${sk} challenge into smaller steps and validate each one`,
                 `B) Assume the ${sk} outcome without checking assumptions`,
                 `C) Ignore the ${sk} issue since it may resolve naturally`,
                 `D) Reassign the ${sk} responsibility without a handover plan`],
        (sk) => [`A) Align the ${sk} approach with team goals and measurable outcomes`,
                 `B) Prioritize speed over accuracy when handling ${sk}`,
                 `C) Avoid ${sk} decisions that require cross-team input`,
                 `D) Handle ${sk} in isolation without documenting the rationale`],
        (sk) => [`A) Validate the ${sk} inputs against requirements before proceeding`,
                 `B) Skip validation on ${sk} to save time`,
                 `C) Defer the ${sk} decision to whoever is available later`,
                 `D) Apply the same ${sk} approach regardless of context`],
        (sk) => [`A) Document the ${sk} decision and the reasoning behind it`,
                 `B) Make the ${sk} call verbally with no record`,
                 `C) Leave the ${sk} outcome ambiguous for others to interpret`,
                 `D) Copy a prior unrelated decision for ${sk} without review`],
        (sk) => [`A) Escalate ${sk} only after confirming it meets the defined threshold`,
                 `B) Escalate every ${sk} issue regardless of severity`,
                 `C) Never escalate ${sk} issues to avoid overhead`,
                 `D) Let the requester decide if ${sk} should be escalated`],
        (sk) => [`A) Re-check the ${sk} outcome against the original objective`,
                 `B) Assume the ${sk} outcome is correct without re-checking`,
                 `C) Move on from ${sk} without confirming the outcome`,
                 `D) Ask someone else to confirm ${sk} without reviewing it yourself`],
      ];
      options = OPTION_BANKS[tplIdx % OPTION_BANKS.length](s);
    }

    return {
      type: t,
      question: questionText,
      difficulty,
      options,
      answer,
      explanation: `Tests applied ${skill} competency for the ${role} role.`,
      skillArea: skill,
      // Marks this as deterministic template padding rather than a question
      // actually derived from the role's documents. Surfaced to the admin so
      // "why are my questions generic?" has a visible, countable answer
      // instead of being indistinguishable from real generated content.
      isTemplateFallback: true,
    };
  });
}

// HEADER_FOOTER_PATTERNS / PERSON_NAME_PATTERNS are declared above, next to
// extractDocEntities' looksLikeNoisePhrase, which reuses them.

// ── Source-quality gate ───────────────────────────────────────────────────────
// The two anti-generic safeguards in this file (filterGrounded and
// verifyQuoteGrounded) deliberately no-op when the source text is too small to
// validate against — filterGrounded needs >=5 extractable keywords,
// verifyQuoteGrounded needs >=40 normalized chars. That means a role with a
// thin JD gets NO grounding enforcement at all, and the deterministic template
// padding below fills the requested count with generic questions. Regenerating
// then just reshuffles those templates forever, because the real constraint —
// not enough source material — never changes.
//
// This gate makes that condition explicit and refusable up front, instead of
// letting it silently degrade into generic output.
export const MIN_SOURCE_CHARS = 400;
export const CHARS_PER_QUESTION = 80;

/**
 * Judges whether there is enough real source text to generate `requestedCount`
 * grounded questions.
 * @returns {{ok:boolean, totalChars:number, requiredChars:number, perFile:Array<{name:string,chars:number,thin:boolean}>, reason:string|null}}
 */
export function assessSourceQuality(sources, requestedCount = 0) {
  const list = (Array.isArray(sources) ? sources : [sources]).filter(Boolean);
  const perFile = list.map(s => {
    const chars = (s?.text || '').trim().length;
    return { name: s?.name || 'Untitled', chars, thin: chars > 0 && chars < MIN_SOURCE_CHARS };
  });
  const totalChars = perFile.reduce((sum, f) => sum + f.chars, 0);

  // Need a usable floor overall, and enough material to sustain the number of
  // questions being asked for. Capped so a very large bank doesn't demand an
  // unrealistic document.
  const requiredChars = Math.max(
    MIN_SOURCE_CHARS,
    Math.min(requestedCount * CHARS_PER_QUESTION, 12000)
  );

  // Kept under 300 characters on purpose: the client's authFetch replaces any
  // longer error with a generic "something went wrong", which would hide the
  // one message that actually explains the problem.
  let reason = null;
  if (totalChars === 0) {
    reason = 'No readable text could be extracted from this role\'s job description or uploaded files. Add a JD before generating.';
  } else if (totalChars < requiredChars) {
    reason =
      `Not enough source text: ${totalChars.toLocaleString()} characters available, ~${requiredChars.toLocaleString()} needed for ${requestedCount} questions. ` +
      'Regenerating cannot fix this — it produces generic questions. Add a fuller JD or a more detailed document first.';
  }

  return { ok: reason === null, totalChars, requiredChars, perFile, reason };
}

/**
 * Validates a question bank before persisting/approving it.
 * Returns a structured report:
 *   { passed: bool, hardFailures: string[], warnings: string[], checks: {...} }
 * `hardFailures` MUST block approval; `warnings` are informational only.
 * Legacy `valid`/`errors` fields are kept for backward compatibility with any
 * caller still reading the old shape (valid === passed, errors === hardFailures).
 */
export function validateQuestionBank(questions, target, config = {}) {
  const hardFailures = [];
  const warnings = [];
  const checks = {};

  if (!Array.isArray(questions)) {
    return { valid: false, passed: false, errors: ['questions must be an array'], hardFailures: ['questions must be an array'], warnings: [], checks: {} };
  }

  // 1. Count — hard fail
  checks.count = { expected: target, actual: questions.length };
  if (questions.length !== target) {
    hardFailures.push(`Count: got ${questions.length}, expected ${target}`);
  }

  const normalize = (s) => (s || '').toLowerCase().replace(/[^a-z0-9 ]/g, '').split(/\s+/).filter(Boolean);
  const seenText = [];
  const seenOptionSets = new Set();
  const seenFillAnswers = new Set();
  checks.duplicateQuestions = [];
  checks.duplicateOptions = [];
  checks.duplicateAnswers = [];
  checks.malformedMcq = [];
  checks.emptyAnswers = [];
  checks.genericPhrasing = [];
  checks.headerFooterDerived = [];
  checks.groundedness = [];

  for (let i = 0; i < questions.length; i++) {
    const q = questions[i];
    if (!q || !q.question) { hardFailures.push(`Question ${i}: missing question text`); continue; }
    if (!q.answer || !String(q.answer).trim()) { hardFailures.push(`Question ${i}: empty answer`); checks.emptyAnswers.push(i); }

    // Duplicate question text — raw >70% token overlap (near-verbatim), PLUS
    // the same concept-level check (stemmed/stopword-free, answer-content-
    // aware) used at generation time — this is the hard gate at Approve, so
    // it must catch the same paraphrase/cross-type duplicates generation's
    // dedup targets, not a weaker independent reimplementation of only the
    // raw-token half of it.
    const tokens = new Set(normalize(q.question));
    const concept = new Set(conceptTokens(extractConceptText(q)));
    for (let j = 0; j < seenText.length; j++) {
      const prev = seenText[j];
      const prevTokens = new Set(normalize(prev.text));
      const inter = [...tokens].filter(t => prevTokens.has(t)).length;
      const union = new Set([...tokens, ...prevTokens]).size;
      const rawDup = union > 0 && inter / union > 0.70;
      const conceptDup = concept.size >= MIN_CONCEPT_TOKENS_TO_COMPARE && prev.concept?.size >= MIN_CONCEPT_TOKENS_TO_COMPARE
        && isNearDuplicateTokens(concept, prev.concept, CONCEPT_SIMILARITY_THRESHOLD);
      if (rawDup || conceptDup) {
        hardFailures.push(`Duplicate question: [${i}] is ${rawDup ? '>70% textually' : 'semantically'} similar to [${j}]`);
        checks.duplicateQuestions.push([j, i]);
      }
    }
    seenText.push({ text: q.question, idx: i, concept });

    // MCQ shape + duplicate options — hard fail
    if (q.type === 'mcq') {
      if (!Array.isArray(q.options) || q.options.length !== 4 || !/^[A-D](\s*,\s*[A-D])*$/i.test(String(Array.isArray(q.answer) ? q.answer.join(',') : q.answer).trim())) {
        hardFailures.push(`Question ${i}: malformed MCQ (must have 4 options and an A-D answer)`);
        checks.malformedMcq.push(i);
      }
    }
    if (Array.isArray(q.options) && q.options.length) {
      const key = q.options.map(o => (o || '').toLowerCase().replace(/^[a-d]\)\s*/i, '').trim()).sort().join('|');
      if (key && seenOptionSets.has(key)) { hardFailures.push(`Duplicate MCQ options at question ${i}`); checks.duplicateOptions.push(i); }
      seenOptionSets.add(key);
      if (new Set(q.options.map(o => (o || '').toLowerCase().trim())).size !== q.options.length) {
        hardFailures.push(`Question ${i} has duplicate options within itself`);
        checks.malformedMcq.push(i);
      }
    }

    // Duplicate fill_blank / subjective answers — hard fail
    if ((q.type === 'fill_blank' || q.type === 'subjective') && q.answer) {
      const ansKey = q.answer.toLowerCase().trim();
      if (seenFillAnswers.has(ansKey)) { hardFailures.push(`Duplicate answer at question ${i}`); checks.duplicateAnswers.push(i); }
      seenFillAnswers.add(ansKey);
    }

    // Difficulty/type value checks — hard fail (previously computed but never
    // actually blocked a save due to a string-matching bug in the caller)
    if (!['easy', 'medium', 'hard'].includes(q.difficulty)) {
      hardFailures.push(`Question ${i}: invalid difficulty "${q.difficulty}"`);
    }
    if (!['mcq', 'fill_blank', 'subjective'].includes(q.type)) {
      hardFailures.push(`Question ${i}: invalid type "${q.type}"`);
    }

    // Generic phrasing — hard fail
    if (GENERIC_PHRASE_PATTERNS.some(re => re.test((q.question || '').trim()))) {
      hardFailures.push(`Question ${i}: generic/filler phrasing`);
      checks.genericPhrasing.push(i);
    }

    // Header/footer/filename/person-name derived — hard fail.
    // Scoped to q.question ONLY (not explanation/skillArea): those two fields
    // are our OWN internal labels, and fallback padding legitimately uses the
    // source filename there as a last-resort topic tag when no real
    // keywords/skills were available (e.g. skillArea: "Handbook_v2.docx") —
    // that's not a question "derived from metadata," it's just a label, and
    // scanning it here was a false-positive (a real uploaded filename
    // containing "v2" or ".docx" would fail every fallback question that used
    // it as its topic). The actual requirement is that the QUESTION ITSELF
    // must not be about a page number/version/filename/author — not that our
    // internal bookkeeping fields must avoid ever mentioning one.
    const qText = q.question || '';
    if (HEADER_FOOTER_PATTERNS.some(re => re.test(qText)) || PERSON_NAME_PATTERNS.some(re => re.test(qText))) {
      hardFailures.push(`Question ${i}: derived from document metadata or a person's name, not body content`);
      checks.headerFooterDerived.push(i);
    }
  }

  // 2. Difficulty distribution (soft warning only — minor skew is tolerable)
  const easy   = questions.filter(q => q.difficulty === 'easy').length;
  const medium = questions.filter(q => q.difficulty === 'medium').length;
  const hard   = questions.filter(q => q.difficulty === 'hard').length;
  const n = questions.length || 1;
  checks.difficultyDistribution = { easy, medium, hard, easyPct: easy / n, mediumPct: medium / n, hardPct: hard / n };
  if (Math.abs(easy / n - 0.35) > 0.20) warnings.push(`Difficulty distribution: easy=${easy} (${Math.round(easy/n*100)}%) is far from target 35%`);
  if (Math.abs(medium / n - 0.45) > 0.20) warnings.push(`Difficulty distribution: medium=${medium} (${Math.round(medium/n*100)}%) is far from target 45%`);

  // 3. Type distribution — hard fail if requested distribution supplied and missed by >15%
  if (config.typeDist) {
    const mcq = questions.filter(q => q.type === 'mcq').length;
    const fill = questions.filter(q => q.type === 'fill_blank').length;
    const subj = questions.filter(q => q.type === 'subjective').length;
    checks.typeDistribution = { mcq, fill_blank: fill, subjective: subj };
    for (const [type, count] of [['mcq', mcq], ['fill_blank', fill], ['subjective', subj]]) {
      const expectedPct = config.typeDist[type];
      if (expectedPct === undefined) continue;
      if (Math.abs(count / n - expectedPct) > 0.15) {
        hardFailures.push(`Type distribution: ${type}=${count} (${Math.round(count/n*100)}%) is far from target ${Math.round(expectedPct*100)}%`);
      }
    }
  }

  // 4. Aggregate quality score (informational only — never a gate). Only
  // questions carrying a qualityScore (freshly generated ones; manually
  // added/edited questions won't have one) are averaged.
  const scored = questions.map(q => q.qualityScore).filter(s => typeof s === 'number');
  if (scored.length > 0) {
    const avg = Math.round(scored.reduce((a, b) => a + b, 0) / scored.length);
    checks.qualityScore = { avg, min: Math.min(...scored), max: Math.max(...scored), scoredCount: scored.length };
    if (avg < 50) warnings.push(`Average question quality score is low (${avg}/100) — consider regenerating`);
  }

  const passed = hardFailures.length === 0;
  return { valid: passed, passed, errors: hardFailures, hardFailures, warnings, checks };
}

// Attaches the final combo-counter high-water-mark reached during generation
// as a property on the returned array (arrays are objects in JS — this
// doesn't affect Array.isArray/.length/.map/spread for any existing caller).
// The next regeneration for the same role reads this back and starts its
// fallback combo cycling from here instead of index 0, so deterministic
// template padding never repeats a (skill, template) pairing that was
// already used in a prior version — the root cause of "90% of regenerated
// questions are identical" when a bank leans on fallback content.
function withFinalCombo(questions, comboCounters) {
  questions.finalComboCounters = { ...comboCounters };
  return questions;
}

// True last-resort count guarantee: generates enough MORE fallback questions
// to close the exact gap, deduplicated against `existing` and against each
// other via mergeFallbackUnique (NOT just concatenated) — a plain
// `[...existing, ...emergencyBatch]` previously let the emergency batch
// contain duplicates of itself, since buildFallbackQuestions alone doesn't
// dedupe. That was always a latent bug; it surfaces more often now that the
// cross-version avoid-set can exhaust the primary padding loop's budget
// (small skill pool + a regenerate) and fall through to this branch more
// frequently than before. Bounded at 10 rounds with an escalating combo
// offset each round — this is the ONE place that deliberately does NOT take
// an avoidSet, by design (see call sites), to protect the exact-count
// guarantee above all else.
function fillEmergencyGap(existing, num, { types, skillsList, jobRole, avoidQuestions = [] }) {
  let combined = existing;
  let comboCounters = { easy: 9999, medium: 9999, hard: 9999 };
  let round = 0;
  while (combined.length < num && round < 10) {
    const gap = num - combined.length;
    const curMcq  = combined.filter(q => !q.type || q.type === 'mcq').length;
    const curFill = combined.filter(q => q.type === 'fill_blank').length;
    const curSubj = combined.filter(q => q.type === 'subjective').length;
    const batch = buildFallbackQuestions(gap, {
      types, skillsList, jobRole, comboCounters,
      typeDeficit: typeDeficitFor([
        ...Array(curMcq).fill({ type: 'mcq' }),
        ...Array(curFill).fill({ type: 'fill_blank' }),
        ...Array(curSubj).fill({ type: 'subjective' }),
      ], num, ASSESSMENT_MIX),
    });
    // avoidQuestions now threaded through here too — previously this only
    // ever checked against `combined` (the pool being built in THIS run),
    // so an emergency-padded question could still reproduce a DELETED
    // question or one from a prior version, since neither is part of
    // `combined`.
    combined = mergeFallbackUnique(combined, batch, avoidQuestions);
    comboCounters = { easy: comboCounters.easy + 1000, medium: comboCounters.medium + 1000, hard: comboCounters.hard + 1000 };
    round++;
  }
  // Absolute final guarantee: count must NEVER come up short, even if it
  // means accepting a rare duplicate. This only triggers when the
  // skill/template combo space is nearly exhausted (very small skill pools,
  // e.g. 3 skills) — a real, bounded ceiling of the deterministic system, not
  // a bug (the design review flagged this explicitly). An undercount is a
  // strictly worse failure than a rare repeat: every downstream consumer
  // (validateQuestionBank, employee assignment) assumes the exact requested
  // count, and that contract is more important than avoiding one duplicate
  // in the rare case a role has almost no extractable skills/keywords.
  if (combined.length < num) {
    const stillNeeded = num - combined.length;
    const forced = buildFallbackQuestions(stillNeeded, { types, skillsList, jobRole, comboCounters });
    combined = [...combined, ...forced];
  }
  return combined.slice(0, num);
}

// ═══════════════════════════════════════════════════════════════════════════════
// Generation engine
// ═══════════════════════════════════════════════════════════════════════════════
const GEN_PROMPT_VERSION = 'c1'; // bump when the prompt/schema changes: invalidates QuestionChunkCache entries

// The quality gates every LLM batch must pass (identical for fresh calls and
// cache hits): not a generic stem shape, mentions document vocabulary, carries
// a quote that really appears in the excerpt, and is not about page/version/
// file-name/person metadata (validateQuestionBank would reject those later).
function isMetadataDerived(q) {
  const t = q?.question || '';
  return HEADER_FOOTER_PATTERNS.some(re => re.test(t)) || PERSON_NAME_PATTERNS.some(re => re.test(t));
}
function qualityFilter(batch, windowText) {
  const sanitized = (batch || []).map(q => sanitizeDocumentReferences(q));
  const validBlanks = sanitized.filter(q => validateFillBlankQuality(q)?.valid !== false);
  const noGeneric = filterGenericPhrasing(validBlanks);
  const keywordPrefiltered = filterGrounded(noGeneric, windowText);
  const grounded = verifyQuoteGrounded(keywordPrefiltered, windowText);
  return grounded.filter(q => !isMetadataDerived(q));
}

function splitIntoChunks(text, size, overlap = 300) {
  if (text.length <= size) return [{ text, start: 0 }];
  const chunks = [];
  let pos = 0;
  while (pos < text.length) {
    let end = Math.min(pos + size, text.length);
    if (end < text.length) {
      const boundary = text.lastIndexOf('\n\n', end);
      if (boundary > pos + size / 2) end = boundary;
    }
    chunks.push({ text: text.slice(pos, end), start: pos });
    if (end >= text.length) break;
    pos = Math.max(pos + 1, end - overlap);
  }
  return chunks;
}

/**
 * Chooses WHICH parts of a source get an LLM call. Chunks are scored by
 * information density (numbers, codes, entities, rule cues, steps — see
 * TextRanking.chunkDensity; repeated boilerplate counts once) and only the
 * richest `wantWindows` are used; when the document is small relative to the
 * number of calls wanted it is re-split into more, smaller windows instead.
 * (The extractive pass still covers the whole document.)
 */
function planWindows(text, { charBudget, wantWindows, minWin = 1800 }) {
  let chunks = splitIntoChunks(text, charBudget);
  if (chunks.length < wantWindows && text.length / wantWindows >= minWin) {
    chunks = splitIntoChunks(text, Math.max(minWin, Math.ceil(text.length / wantWindows) + 300));
  }
  const scored = chunks.map((c, i) => ({ ...c, i, ...chunkDensity(c.text) }));
  const ranked = scored.slice().sort((a, b) => (b.info - a.info) || (a.i - b.i)).slice(0, Math.max(1, Math.min(scored.length, wantWindows)));
  const useful = ranked.filter(w => w.info >= 3);
  return (useful.length ? useful : ranked.slice(0, 1)).map((w, rank) => ({ ...w, rank }));
}

// Splits `total` asks over windows in proportion to their information, each
// clamped to [2, perCall]; overflow from clamped windows moves to those with room.
function allocateAsks(windows, total, perCall) {
  const asks = distribute(Math.min(total, windows.length * perCall), windows.map(w => Math.max(1, w.info)));
  for (let pass = 0; pass < 3; pass++) {
    let overflow = 0;
    for (let i = 0; i < asks.length; i++) if (asks[i] > perCall) { overflow += asks[i] - perCall; asks[i] = perCall; }
    for (let i = 0; i < asks.length && overflow > 0; i++) { const room = perCall - asks[i]; const g = Math.min(room, overflow); asks[i] += g; overflow -= g; }
  }
  return asks;
}

const normLoc = (s) => (s || '').toLowerCase().replace(/[^a-z0-9\s]/g, '').replace(/\s+/g, ' ').trim();

function tallyTypes(types, count) {
  const c = { mcq: 0, fill_blank: 0, subjective: 0 };
  for (const t of types) { if (t === 'fill_blank') c.fill_blank++; else if (t === 'subjective') c.subjective++; else c.mcq++; }
  const sum = c.mcq + c.fill_blank + c.subjective;
  if (sum !== count) c.mcq = Math.max(0, c.mcq + (count - sum));
  return c;
}
function tallyDifficulty(list) {
  const c = { easy: 0, medium: 0, hard: 0 };
  for (const q of list) c[q.difficulty === 'easy' || q.difficulty === 'hard' ? q.difficulty : 'medium']++;
  return c;
}
const countType = (list, t) => list.filter(q => (q.type || 'mcq') === t).length;

// ── per-source state ─────────────────────────────────────────────────────────
function prepareSource(spec, rt) {
  const { cfg, status } = rt;
  const text = (spec.text || '').trim();
  const count = Math.min(100, Math.max(1, parseInt(spec.count) || 5));
  const types = Array.isArray(spec.types) && spec.types.length ? spec.types : buildTypeSequence(count, ASSESSMENT_MIX);
  const typeCounts = tallyTypes(types, count);
  const [dE, dM, dH] = distribute(count, [35, 45, 20]);
  const diffTargets = { easy: dE, medium: dM, hard: Math.max(0, count - dE - dM) };
  const S = {
    spec, idx: spec.idx, name: spec.name || 'Source', text, count, types, typeCounts, diffTargets, mode: spec.mode || 'doc',
    tracker: createSeenTracker(spec.avoidQuestions || []),
    extractive: [], llm: [], model: null, normSent: null, closed: false,
    usedSentences: new Set(), llmTarget: 0, llmTypeLeft: { ...typeCounts }, llmDiffLeft: { ...diffTargets },
    windows: [], pending: 0, asked: 0, got: 0, rounds: 0, cacheHits: 0, failures: 0,
    accepted() { return this.extractive.length + this.llm.length; },
    findSection(quote) {
      if (!this.model) return null;
      const nq = normLoc(quote).split(' ').slice(0, 6).join(' ');
      if (nq.length < 12) return null;
      if (!this.normSent) this.normSent = this.model.all.map(s => normLoc(s.text));
      const i = this.normSent.findIndex(t => t.includes(nq));
      return i >= 0 ? (this.model.all[i].section || null) : null;
    },
  };
  if (!text) return S;
  S.model = buildDocumentModel(text, { name: S.name });

  // 1) extractive first pass — instant, zero API calls, grounded by construction
  const llmPossible = status.anyLLM;
  let E;
  if (!llmPossible) E = count;
  else { const share = S.mode === 'jd' ? cfg.extractiveShare * 0.7 : cfg.extractiveShare; E = Math.min(count, Math.round(count * share)); }
  if (E > 0) {
    const fill = Math.min(typeCounts.fill_blank, E);
    const mcq = Math.min(typeCounts.mcq, E - fill);
    const subj = llmPossible ? 0 : Math.min(typeCounts.subjective, Math.max(0, E - fill - mcq));
    const eTypes = { mcq: mcq + Math.max(0, E - fill - mcq - subj), fill_blank: fill, subjective: subj };
    const eDiff = llmPossible ? { easy: Math.ceil(E * 0.55), medium: Math.ceil(E * 0.35), hard: Math.ceil(E * 0.1) } : diffTargets;
    const picks = generateExtractiveQuestions(S.model, {
      count: E, typeCounts: eTypes, difficultyTargets: eDiff, seed: `${spec.seed}-x`,
      exclude: (q) => { if (S.tracker.isDuplicate(q)) return true; S.tracker.add(q); return false; },
    });
    for (const q of picks) { for (const i of q._sentences || []) S.usedSentences.add(i); delete q._sentences; }
    S.extractive = picks;
  }

  // 2) LLM share: what the extractive pass did not cover, aimed at the richest windows
  S.llmTarget = llmPossible ? Math.max(0, count - S.extractive.length) : 0;
  if (S.llmTarget > 0) {
    const eT = { mcq: countType(S.extractive, 'mcq'), fill_blank: countType(S.extractive, 'fill_blank'), subjective: countType(S.extractive, 'subjective') };
    for (const k of Object.keys(S.llmTypeLeft)) S.llmTypeLeft[k] = Math.max(0, typeCounts[k] - eT[k]);
    const eD = tallyDifficulty(S.extractive);
    for (const k of Object.keys(S.llmDiffLeft)) S.llmDiffLeft[k] = Math.max(0, diffTargets[k] - eD[k]);
    const perCall = maxQuestionsPerCall();
    const totalAsk = Math.ceil(S.llmTarget * 1.25) + 1;
    const want = Math.max(1, Math.ceil(totalAsk / perCall));
    S.windows = planWindows(text, { charBudget: sourceCharBudget(), wantWindows: want });
    const asks = allocateAsks(S.windows, totalAsk, perCall);
    S.windows.forEach((w, i) => { w.ask = asks[i]; w.cacheKey = chunkCacheKey(w.text, { v: GEN_PROMPT_VERSION, mode: S.mode, st: !!spec.stakeholder, pd: !!spec.processDelivery, ty: spec.sourceType || '' }); });

    // 3) content-hash cache: unchanged chunks cost nothing on regeneration
    if (cfg.cache) {
      for (const w of S.windows) {
        const cached = questionChunkCache.get(w.cacheKey);
        if (!cached) continue;
        let taken = 0;
        for (const q of qualityFilter(cached, w.text)) {
          if (taken >= w.ask || S.llm.length >= S.llmTarget) break;
          if (S.tracker.isDuplicate(q)) continue; // never serve a cached question that repeats an avoided / earlier one
          S.tracker.add(q); S.llm.push(q); taken++;
        }
        if (taken > 0) { S.cacheHits += taken; w.ask = Math.max(0, w.ask - taken); }
      }
    }
  }
  return S;
}

function typeNeedsFor(S, ask) {
  const left = S.llmTypeLeft;
  const parts = distribute(ask, [left.mcq, left.fill_blank, left.subjective].map(x => (x > 0 ? x : 0)));
  const sum = parts.reduce((a, b) => a + b, 0);
  const needs = sum > 0 ? { mcq: parts[0], fill_blank: parts[1], subjective: parts[2] } : { mcq: ask, fill_blank: 0, subjective: 0 };
  S.llmTypeLeft = { mcq: Math.max(0, left.mcq - needs.mcq), fill_blank: Math.max(0, left.fill_blank - needs.fill_blank), subjective: Math.max(0, left.subjective - needs.subjective) };
  return needs;
}
function diffNeedsFor(S, ask) {
  const left = S.llmDiffLeft;
  const w = [left.easy, left.medium, left.hard];
  const parts = distribute(ask, w.reduce((a, b) => a + b, 0) > 0 ? w : [35, 45, 20]);
  S.llmDiffLeft = { easy: Math.max(0, left.easy - parts[0]), medium: Math.max(0, left.medium - parts[1]), hard: Math.max(0, left.hard - parts[2]) };
  return { easy: parts[0], medium: parts[1], hard: parts[2] };
}

function specificityOf(q, S) {
  const df = S.model?.stats?.df;
  if (!df) return 0;
  const toks = contentTokens(`${q.question} ${q.type === 'mcq' ? '' : q.answer || ''} ${q.skillArea || ''}`);
  if (toks.length === 0) return 0;
  const hit = toks.filter(w => df.has(w)).length / toks.length;
  return hit + (/\d/.test(q.question) ? 0.15 : 0) + (/[A-Z][a-z]+(?:\s+[A-Z][a-z]+)+/.test(q.question) ? 0.1 : 0);
}

// ── one LLM call ─────────────────────────────────────────────────────────────
async function runLLMTask(task, rt) {
  const { S } = task;
  let win = task.win;
  if (S.closed || rt.budget.expired) return { skipped: true };
  const need = Math.max(0, S.llmTarget - S.llm.length);
  if (need === 0) return { skipped: true };
  let ask = Math.max(1, Math.min(task.ask, Math.ceil(need * 1.35) + 1));
  // The window may have been sized for Gemini and Gemini has since run out of quota (first 429 of the run):
  // shrink to the densest not-yet-used Groq-sized sub-window instead of sending a request Groq must reject.
  if (!geminiPrimary() && win.text.length > groqExcerptChars() * 1.25) {
    S.subUsed = S.subUsed || new Set();
    const subs = splitIntoChunks(win.text, groqExcerptChars()).map((c, i) => ({ ...c, i: win.i * 100 + i, start: win.start + c.start, rank: win.rank, cacheKey: win.cacheKey, ...chunkDensity(c.text) }));
    const fresh = subs.filter(w => !S.subUsed.has(`${win.i}:${w.start}`));
    const best = (fresh.length ? fresh : subs).sort((a, b) => b.info - a.info)[0];
    S.subUsed.add(`${win.i}:${best.start}`);
    win = best;
    ask = Math.min(ask, maxQuestionsPerCall());
  }
  const spec = S.spec;
  const system = rt.systemFor(S.mode);
  if (task.round > 0) refreshNeeds(S); // top-up: aim the new call at what is actually still missing
  // This run's own earlier output (so a retry/sibling call covers new ground) first, then cross-version avoid items; relevance-ranked per excerpt
  const avoid = [...S.llm.slice(-40), ...(spec.avoidQuestions || [])];
  // The sentences the extractive pass already turned into questions are cut out of the excerpt: the model
  // spends its tokens on content that is NOT yet covered (complementary, not duplicate, questions; fewer prompt tokens).
  const excerpt = maskedExcerpt(S, win);
  if (excerpt.split('[...]').join('').trim().length < 400) return { skipped: true };
  const prompt = buildCompactUserPrompt({
    count: ask, mode: S.mode, jobRole: spec.jobRole, sourceText: excerpt, sourceName: S.name, sourceType: spec.sourceType,
    seed: `${spec.seed}-w${win.i}-r${task.round}`, skillsContext: spec.skillsContext || [], stakeholder: !!spec.stakeholder, processDelivery: !!spec.processDelivery,
    avoidQuestions: avoid, typeNeeds: task.typeNeeds && task.round === 0 ? scaleNeeds(task.typeNeeds, ask) : typeNeedsFor(S, ask), diffNeeds: task.diffNeeds && task.round === 0 ? scaleNeeds(task.diffNeeds, ask) : diffNeedsFor(S, ask),
    styleProfile: spec.styleProfile,
  });
  let throttled = false;
  const onThrottle = (ms) => { if (!throttled) { throttled = true; rt.throttled++; } if (rt.throttled >= rt.inflight && rt.inflight > 0) rt.emit.throttle(ms); };
  const onResume = () => { if (throttled) { throttled = false; rt.throttled--; rt.emit.resume(); } };
  rt.inflight++; rt.stats.calls++;
  let res;
  try {
    res = await GeminiService.generateQuestionsBatchEx(prompt, system, { maxTokens: outputTokensFor(ask), onThrottle, onResume, deadlineAt: rt.budget.deadlineAt, signal: rt.abort.signal });
  } finally { rt.inflight--; if (throttled) { throttled = false; rt.throttled--; } }
  if (!res) { rt.stats.failed++; S.failures++; return { failed: true }; }
  if (S.closed) return { skipped: true };
  rt.stats.ok++; rt.stats.byProvider[res.provider] = (rt.stats.byProvider[res.provider] || 0) + 1;

  const normalized = normalizeLLMQuestions(res.questions, { fallbackSection: null, findSection: (quote) => S.findSection(quote) });
  const kept = qualityFilter(normalized, win.text);
  if (kept.length < res.questions.length) console.log(`[GenEngine] "${S.name}" window ${win.i}: kept ${kept.length}/${res.questions.length} after schema + grounding + generic filters (${res.provider}, ${Math.round(res.ms / 1000)}s)`);
  if (rt.cfg.cache && kept.length) questionChunkCache.set(win.cacheKey, kept);
  let accepted = 0;
  for (const q of kept) {
    if (S.tracker.isDuplicate(q)) continue;
    S.tracker.add(q); S.llm.push(q); accepted++;
  }
  S.asked += ask; S.got += accepted;
  return { accepted };
}
// Window text with the sentences already used by extractive questions replaced by "[...]".
function maskedExcerpt(S, win) {
  if (!S.model || S.usedSentences.size === 0) return win.text;
  const spans = [];
  for (const i of S.usedSentences) {
    const s = S.model.byIdx.get(i);
    if (s && s.start >= win.start && s.end <= win.start + win.text.length) spans.push([s.start - win.start, s.end - win.start]);
  }
  if (spans.length === 0) return win.text;
  spans.sort((a, b) => a[0] - b[0]);
  let out = ''; let pos = 0;
  for (const [a, b] of spans) { if (a < pos) continue; out += win.text.slice(pos, a) + ' [...] '; pos = b; }
  out += win.text.slice(pos);
  return out.replace(/(\s*\[\.\.\.\]\s*){2,}/g, ' [...] ');
}
function refreshNeeds(S) {
  const all = [...S.extractive, ...S.llm];
  const hv = { mcq: countType(all, 'mcq'), fill_blank: countType(all, 'fill_blank'), subjective: countType(all, 'subjective') };
  for (const k of Object.keys(S.llmTypeLeft)) S.llmTypeLeft[k] = Math.max(0, S.typeCounts[k] - hv[k]);
  const hd = tallyDifficulty(all);
  for (const k of Object.keys(S.llmDiffLeft)) S.llmDiffLeft[k] = Math.max(0, S.diffTargets[k] - hd[k]);
}
function scaleNeeds(needs, ask) {
  const keys = Object.keys(needs);
  const parts = distribute(ask, keys.map(k => needs[k]));
  return Object.fromEntries(keys.map((k, i) => [k, parts[i]]));
}

// ── template padding (LAST resort: only when the document is too small for the extractive generator) ──
function padWithTemplates(pool, num, { types, skillsList, jobRole, avoidQuestions, comboCounters }) {
  const targetEasy = Math.round(num * 0.35);
  const targetMedium = Math.round(num * 0.45);
  const targetHard = Math.max(1, num - targetEasy - targetMedium);
  const tc = tallyTypes(types, num);
  let att = 0;
  while (pool.length < num && att < 30) {
    const remaining = num - pool.length;
    const fb = buildFallbackQuestions(remaining, {
      types, skillsList, jobRole,
      difficultyDeficit: {
        easy:   Math.max(0, targetEasy   - pool.filter(q => (q.difficulty || 'medium') === 'easy').length),
        medium: Math.max(0, targetMedium - pool.filter(q => (q.difficulty || 'medium') === 'medium').length),
        hard:   Math.max(0, targetHard   - pool.filter(q => (q.difficulty || 'medium') === 'hard').length),
      },
      typeDeficit: {
        mcq:        Math.max(0, tc.mcq - pool.filter(q => !q.type || q.type === 'mcq').length),
        fill_blank: Math.max(0, tc.fill_blank - pool.filter(q => q.type === 'fill_blank').length),
        subjective: Math.max(0, tc.subjective - pool.filter(q => q.type === 'subjective').length),
      },
      comboCounters,
    });
    pool = mergeFallbackUnique(pool, fb, avoidQuestions);
    att++;
  }
  return pool;
}

// ── finalize one source: dedup, complete extractively, trim, tag ─────────────
async function finalizeSource(S, rt) {
  S.closed = true;
  const { spec, count, types } = S;
  const cfg = rt.cfg;
  const meta = { generatedFrom: spec.sourceType === 'jd' || S.mode === 'jd' ? 'jd' : 'document', stakeholderFlag: !!spec.stakeholder, processDeliveryFlag: !!spec.processDelivery };
  const comboCounters = spec.startingComboCounters ? { ...spec.startingComboCounters } : { easy: 0, medium: 0, hard: 0 };
  if (!S.text) {
    // nothing to read: the old behaviour (empty for a document, template padding for a JD with skills)
    if (S.mode !== 'jd') return withFinalCombo([], comboCounters);
  }

  // semantic (embedding) dedup — only over LLM output, only when time and quota allow
  let llm = S.llm.slice().sort((a, b) => specificityOf(b, S) - specificityOf(a, S));
  const canEmbed = cfg.embedMax > 0 && llm.length > 1 && rt.budget.remainingMs > 25000 && GeminiService.embedAvailable?.();
  if (canEmbed) {
    const timeoutMs = Math.min(15000, Math.max(3000, rt.budget.remainingMs - 10000));
    llm = await withTimeout(applySemanticDedup(llm.slice(0, cfg.embedMax), spec.avoidQuestions || []), timeoutMs, llm);
  }

  let pool = [...S.extractive, ...llm];

  // complete extractively (document-specific) before ever touching generic templates
  if (S.text && pool.length < count) {
    const have = { mcq: countType(pool, 'mcq'), fill_blank: countType(pool, 'fill_blank'), subjective: countType(pool, 'subjective') };
    const deficit = count - pool.length;
    const td = { mcq: Math.max(0, S.typeCounts.mcq - have.mcq), fill_blank: Math.max(0, S.typeCounts.fill_blank - have.fill_blank), subjective: Math.max(0, S.typeCounts.subjective - have.subjective) };
    let tsum = td.mcq + td.fill_blank + td.subjective;
    if (tsum < deficit) td.mcq += deficit - tsum;
    const hd = tallyDifficulty(pool);
    const extra = generateExtractiveQuestions(S.model, {
      count: deficit, typeCounts: td, seed: `${spec.seed}-fill`, usedSentences: S.usedSentences,
      difficultyTargets: { easy: Math.max(0, S.diffTargets.easy - hd.easy), medium: Math.max(0, S.diffTargets.medium - hd.medium), hard: Math.max(0, S.diffTargets.hard - hd.hard) },
      exclude: (q) => { if (S.tracker.isDuplicate(q)) return true; S.tracker.add(q); return false; },
    });
    for (const q of extra) { for (const i of q._sentences || []) S.usedSentences.add(i); delete q._sentences; }
    if (extra.length) console.log(`[GenEngine] "${S.name}": completed ${extra.length} slot(s) with document-specific extractive questions`);
    pool = [...pool, ...extra];
    // the type mix can still be short (e.g. no extractive subjective possible): a second, type-agnostic try
    if (pool.length < count) {
      const more = generateExtractiveQuestions(S.model, { count: count - pool.length, typeCounts: { mcq: count - pool.length, fill_blank: 0, subjective: 0 }, seed: `${spec.seed}-fill2`, usedSentences: S.usedSentences,
        exclude: (q) => { if (S.tracker.isDuplicate(q)) return true; S.tracker.add(q); return false; } });
      for (const q of more) { for (const i of q._sentences || []) S.usedSentences.add(i); delete q._sentences; }
      pool = [...pool, ...more];
    }
    // Last chance before any generic template: a second question about an already-used sentence (a different
    // blank / construct), so a short extractive pass never lets a template into the bank.
    if (pool.length < count) {
      const more = generateExtractiveQuestions(S.model, { count: count - pool.length, typeCounts: { mcq: count - pool.length, fill_blank: 0, subjective: 0 }, seed: `${spec.seed}-fill3`, allowReuse: true,
        exclude: (q) => { if (S.tracker.isDuplicate(q)) return true; S.tracker.add(q); return false; } });
      for (const q of more) delete q._sentences;
      pool = [...pool, ...more];
    }
  }
  S.templateCount = 0;
  if (pool.length < count) {
    const before = pool.length;
    const docEntities = S.text ? extractDocEntities(S.text, 8) : [];
    const docKeywords = S.text ? extractDocKeywords(S.text, 8) : [];
    const skillsList = S.mode === 'jd' && (spec.skillsList || []).length ? spec.skillsList : (docEntities.length ? docEntities : (docKeywords.length ? docKeywords : (spec.skillsList || []).length ? spec.skillsList : [SAFE_FALLBACK_TOPIC]));
    console.warn(`[GenEngine] "${S.name}": ${count - before} slot(s) still open after LLM + extractive — padding with templates (document too small/unstructured)`);
    pool = padWithTemplates(pool, count, { types, skillsList, jobRole: spec.jobRole, avoidQuestions: spec.avoidQuestions || [], comboCounters });
    S.templateCount = pool.length - before;
  }

  const trimmed = trimToTarget(pool, count, types);
  const rebalanced = rebalanceDifficulty(trimmed);
  if (rebalanced.length > count) return withFinalCombo(attachQualityScores(tagMetadata(rebalanced.slice(0, count), meta), S.text || spec.text || ''), comboCounters);
  if (rebalanced.length < count) {
    const final = fillEmergencyGap(rebalanced, count, { types, skillsList: [SAFE_FALLBACK_TOPIC], jobRole: spec.jobRole, avoidQuestions: spec.avoidQuestions || [] });
    return withFinalCombo(attachQualityScores(tagMetadata(final, meta), S.text || ''), comboCounters);
  }
  return withFinalCombo(attachQualityScores(tagMetadata(rebalanced, meta), S.text || ''), comboCounters);
}

function withTimeout(promise, ms, fallback) {
  return new Promise((resolve) => {
    const t = setTimeout(() => resolve(fallback), ms);
    t.unref?.();
    promise.then((v) => { clearTimeout(t); resolve(v); }, () => { clearTimeout(t); resolve(fallback); });
  });
}

/**
 * Runs generation for one or many sources together.
 * specs: [{idx,name,text,sourceType,count,types,seed,jobRole,skillsContext,stakeholder,processDelivery,mode,skillsList,startingComboCounters,avoidQuestions}]
 * Returns { batches: Array<question[]>, states }.
 */
async function runGeneration(specs, { onProgress = null, label = 'bank' } = {}) {
  const cfg = generationConfig();
  const status = GeminiService.generationStatus();
  const budget = new TimeBudget(cfg.timeBudgetMs);
  const total = specs.reduce((s, sp) => s + (sp && sp.text !== undefined ? Math.min(100, Math.max(1, parseInt(sp.count) || 5)) : 0), 0);
  const emit = makeProgressEmitter(onProgress, total);
  const rt = {
    cfg, status, budget, emit, abort: new AbortController(), inflight: 0, throttled: 0,
    stats: { calls: 0, ok: 0, failed: 0, byProvider: {} },
    systemFor: (mode) => buildCompactSystemPrompt(mode),
  };
  const t0 = Date.now();
  const concurrency = cfg.concurrency || autoConcurrency();
  try { console.log(GeminiService.capacityLine()); } catch { /* informational only */ }
  const counters0 = GeminiService.counterSnapshot();
  console.log(`[GenBudget] ${label}: ${specs.length} source(s), ${total} question(s); time budget ${Math.round(cfg.timeBudgetMs / 1000)}s, LLM concurrency ${concurrency}, extractive share ${cfg.extractiveShare}, providers gemini=${status.geminiKeysUsable} openrouter=${status.openrouter} groq=${status.groq}`);
  if (!status.anyLLM) console.warn('[GenBudget] no LLM provider is available right now — the bank is generated locally from the documents (extractive).');

  const tExtract0 = Date.now();
  const states = specs.map(sp => prepareSource(sp, rt));
  const extractiveMs = Date.now() - tExtract0;
  const updateProgress = () => emit.progress(states.reduce((s, S) => s + Math.min(S.count, S.accepted()), 0));
  updateProgress();

  // LLM phase: one priority queue across ALL sources — every source's richest window first
  const pool = new TaskPool({
    concurrency: () => concurrency,
    budget,
    run: (task) => runLLMTask(task, rt),
    shouldSkip: (task) => task.S.closed || task.S.llm.length >= task.S.llmTarget || !budget.hasRoom(cfg.taskMinMs) || budget.fractionUsed() >= cfg.pace,
    onSkip: (task) => { task.S.pending--; },
    onDone: (task, res, err) => {
      const S = task.S; S.pending--;
      if (err) console.warn(`[GenEngine] "${S.name}" window ${task.win.i} failed: ${err.message}`);
      if (res?.failed && task.retries < 1 && budget.hasRoom(cfg.taskMinMs * 2)) { task.retries++; S.pending++; pool.add(task, 300 - task.round * 50); }
      updateProgress();
      if (S.pending === 0 && !S.closed && S.llm.length < S.llmTarget && S.rounds + 1 < cfg.maxRounds && budget.hasRoom(cfg.taskMinMs * 2)) scheduleTopUp(S);
    },
  });
  const scheduleTopUp = (S) => {
    S.rounds++;
    const need = S.llmTarget - S.llm.length;
    const yieldRate = Math.min(1, Math.max(0.3, S.asked > 0 ? S.got / S.asked : 0.6));
    const perCall = maxQuestionsPerCall();
    const totalAsk = Math.ceil((need / yieldRate) * 1.1);
    const nTasks = Math.min(4, Math.max(1, Math.ceil(totalAsk / perCall)));
    const asks = distribute(totalAsk, Array(nTasks).fill(1));
    for (let i = 0; i < nTasks; i++) {
      const win = S.windows[i % S.windows.length];
      if (!win) break;
      S.pending++;
      pool.add({ S, win, ask: Math.min(perCall, Math.max(2, asks[i])), round: S.rounds, retries: 0 }, 400 - S.rounds * 50);
    }
    console.log(`[GenEngine] "${S.name}": ${need} short after round ${S.rounds} (yield ${yieldRate.toFixed(2)}) — scheduling ${nTasks} top-up call(s)`);
  };
  for (const S of states) {
    S.windows.forEach((w, i) => {
      if (w.ask < 1 || S.llmTarget === 0) return;
      const ask = Math.min(maxQuestionsPerCall(), Math.max(2, w.ask));
      const task = { S, win: w, ask, round: 0, retries: 0, typeNeeds: typeNeedsFor(S, ask), diffNeeds: diffNeedsFor(S, ask) };
      S.pending++;
      pool.add(task, 1000 - w.rank * 100 + Math.min(99, Math.round(w.info)));
    });
  }
  const drained = await pool.drain();
  if (drained.expired) {
    rt.abort.abort();
    console.warn(`[GenBudget] ${label}: time budget (${Math.round(cfg.timeBudgetMs / 1000)}s) reached with ${drained.abandoned || 0} call(s) still running and ${drained.queued || 0} queued — completing the rest of the bank from the documents.`);
  }
  updateProgress();

  const batches = await mapPool(states, 4, (S) => finalizeSource(S, rt));
  const llmTotal = states.reduce((s, S) => s + S.llm.length, 0);
  const exTotal = states.reduce((s, S) => s + S.extractive.length, 0);
  const cacheHits = states.reduce((s, S) => s + S.cacheHits, 0);
  console.log(`[GenBudget] ${label}: done in ${Math.round((Date.now() - t0) / 1000)}s — ${rt.stats.calls} LLM call(s) (${rt.stats.ok} ok, ${rt.stats.failed} failed, by provider ${JSON.stringify(rt.stats.byProvider)}), ${llmTotal} LLM question(s) (${cacheHits} from cache), ${exTotal} extractive up-front, template padding ${states.reduce((s, S) => s + (S.templateCount || 0), 0)}`);
  try {
    const c1 = GeminiService.counterSnapshot();
    const d = (g) => Math.max(0, (c1.calls[g] || 0) - (counters0.calls[g] || 0));
    const r = (g) => Math.max(0, (c1.rl429[g] || 0) - (counters0.rl429[g] || 0));
    const waitS = Math.round(Math.max(0, c1.waitMs - counters0.waitMs) / 1000);
    console.log(`[GenBudget] ${label}: time breakdown - extractive ${(extractiveMs / 1000).toFixed(1)}s, waiting for provider capacity ${waitS}s (summed over parallel calls), HTTP calls gemini=${d('gemini')} openrouter=${d('openrouter')} groq=${d('groq')}, 429s gemini=${r('gemini')} openrouter=${r('openrouter')} groq=${r('groq')}`);
  } catch { /* informational only */ }
  updateProgress();
  return { batches: batches.map(b => (b && !b.error ? b : withFinalCombo([], { easy: 0, medium: 0, hard: 0 }))), states, rt };
}

// Stamps every question with the metadata fields required for provenance
// (Issue 10): id, generatedFrom, stakeholder/processDelivery flags, createdAt.
function tagMetadata(questions, { generatedFrom, stakeholderFlag = false, processDeliveryFlag = false } = {}) {
  const now = new Date().toISOString();
  return questions.map(q => ({
    ...q,
    id: q.id || randomUUID(),
    generatedFrom,
    stakeholderFlag: q.stakeholderFlag ?? stakeholderFlag,
    processDeliveryFlag: q.processDeliveryFlag ?? processDeliveryFlag,
    createdAt: q.createdAt || now,
  }));
}

export async function generateQuestionsFromJD({ jobRole, jobDescription, jdSkills, questionCount, questionTypes, employeeSeed, supportingDocs, avoidQuestions = [], startingComboCounters = null, onProgress = null, styleProfile = null }) {
  const num = Math.min(Math.max(parseInt(questionCount) || 5, 2), 100);
  const types = Array.isArray(questionTypes) && questionTypes.length > 0 ? questionTypes : ['mcq'];
  const baseSeed = employeeSeed || randomUUID().slice(0, 8);
  const jdText = (jobDescription || '').trim();
  const skillsList = Array.isArray(jdSkills) && jdSkills.length ? jdSkills : [];

  // JD + every supporting document, so all of it contributes (windows are chosen from the whole)
  let supportingDocsText = '';
  if (Array.isArray(supportingDocs) && supportingDocs.length > 0) {
    const parts = [];
    for (const doc of supportingDocs) {
      if (!doc?.text) continue;
      parts.push(`--- Document: ${doc.name || 'Untitled'} ---\n${doc.text}`);
    }
    supportingDocsText = parts.join('\n\n');
  }
  const combinedSource = [jdText, supportingDocsText].filter(Boolean).join('\n\n');
  const spec = {
    idx: 0, name: jobRole || 'Job Description', text: combinedSource, sourceType: 'jd', count: num, types,
    seed: baseSeed, jobRole, skillsContext: skillsList, mode: 'jd', skillsList, startingComboCounters, avoidQuestions,
    styleProfile,
  };
  const { batches } = await runGeneration([spec], { onProgress, label: `JD "${jobRole || ''}"` });
  const result = batches[0];
  if (typeof onProgress === 'function') { try { onProgress({ phase: 'generating', done: Math.min(num, result.length), total: num }); } catch { /* never break generation */ } }
  if (result.length === num) return result;
  // Safety net (the engine already guarantees the count): never hand back a short bank.
  const meta = { generatedFrom: 'jd' };
  const final = fillEmergencyGap(result.length > num ? result.slice(0, num) : result, num, { types, skillsList, jobRole, avoidQuestions });
  return withFinalCombo(attachQualityScores(tagMetadata(final, meta), combinedSource), result.finalComboCounters || { easy: 0, medium: 0, hard: 0 });
}

// ── Per-file multi-source generation ─────────────────────────────────────────
// Generates exactly the requested number of questions from EACH source file,
// tags every question with sourceFile + sourceType, then merges with
// cross-file deduplication. The result length equals the sum of all per-file
// questionCount values.
function buildTypeSeqLocal(num) {
  return buildTypeSequence(num, ASSESSMENT_MIX);
}

// When a single uploaded file mixes JD-like content and process/SOP-like
// content, splits it into two effective sources with proportionally-split
// question counts. A file that doesn't meaningfully split passes through.
function expandSplitSources(fileSources) {
  const expanded = [];
  for (const source of fileSources) {
    const text = (source.text || '').trim();
    if (!text) { expanded.push(source); continue; }
    const split = classifyJDVsProcessSections(text);
    if (!split.hasMeaningfulSplit) { expanded.push(source); continue; }
    const totalCount = Math.max(1, parseInt(source.questionCount) || 5);
    const jdCount = Math.max(1, Math.round(totalCount * split.jdShare));
    const processCount = Math.max(1, totalCount - jdCount);
    expanded.push({ ...source, text: split.jdText, sourceType: 'jd', questionCount: jdCount, name: `${source.name || 'file'} (JD section)` });
    expanded.push({ ...source, text: split.processText, sourceType: 'supporting', questionCount: processCount, name: `${source.name || 'file'} (Process section)` });
  }
  return expanded;
}

export async function generateQuestionsFromFiles(fileSources, globalContext = {}) {
  if (!Array.isArray(fileSources) || fileSources.length === 0) return [];

  const {
    jobRole = 'Professional', skills = [], seed: baseSeed = '',
    avoidQuestions = [],                  // cross-version "don't repeat these" set, applied per-source
    startingComboCountersBySource = {},   // { [sourceName]: {easy,medium,hard} } from the previous version
    onProgress = null,                    // optional progress hook (see makeProgressEmitter)
    styleProfile = null,                  // optional learned style profile from manual questions
  } = globalContext;
  fileSources = expandSplitSources(fileSources);
  const overallTotal = fileSources.reduce((s, f) => s + Math.min(100, Math.max(1, parseInt(f.questionCount) || 5)), 0);
  const allQuestions = [];
  // Shared fuzzy tracker across ALL files — pre-seeded with avoidQuestions so
  // cross-version diversity is enforced at this level too.
  const tracker = createSeenTracker(avoidQuestions);
  const finalComboCountersBySource = {};

  // ── PHASE 1: every source generated TOGETHER by one scheduler ──────────────
  // (bounded, provider-aware concurrency; richest chunks first across all
  // files; one wall-clock budget; extractive completion at the end)
  const specs = fileSources.map((source, idx) => {
    const text = (source.text || '').trim();
    const count = Math.min(100, Math.max(1, parseInt(source.questionCount) || 5));
    const srcSeed = `${baseSeed || 'fs'}-${(source.name || 'file').replace(/\W/g, '').slice(0, 20)}-${idx}-${Date.now()}`;
    return {
      idx, name: source.name, text, sourceType: source.sourceType || 'supporting', count, types: buildTypeSeqLocal(count), seed: srcSeed,
      jobRole: source.jobRole || jobRole, skillsContext: source.skills || skills, stakeholder: !!source.stakeholder, processDelivery: !!source.processDelivery,
      mode: 'doc', avoidQuestions, startingComboCounters: startingComboCountersBySource[source.name] || null,
      styleProfile: source.styleProfile || styleProfile,
    };
  });
  let batches = [], states = [];
  try {
    ({ batches, states } = await runGeneration(specs.map(sp => (sp.text ? sp : { ...sp, text: '' })), { onProgress, label: `${specs.length} file(s)` }));
  } catch (e) {
    // One failure must never abort the whole bank — phase 2 pads from the documents.
    console.error(`[generateQuestionsFromFiles] generation engine failed: ${e.message}`);
    batches = specs.map(() => null); states = [];
  }

  // ── PHASE 2: accept / dedup / complete SEQUENTIALLY (order-stable) ─────────
  for (const [sourceIdx, source] of fileSources.entries()) {
    const text = (source.text || '').trim();
    const count = Math.min(100, Math.max(1, parseInt(source.questionCount) || 5));
    if (!text) continue;

    const srcJobRole = source.jobRole || jobRole;
    const srcSkills  = source.skills  || skills;

    const batch = batches[sourceIdx];
    if (batch?.finalComboCounters) finalComboCountersBySource[source.name] = batch.finalComboCounters;

    const acceptedForSource = [];
    for (const q of (batch || [])) {
      if (acceptedForSource.length >= count) break;
      if (tracker.isDuplicate(q)) continue;
      tracker.add(q);
      const tagged = {
        ...q,
        id: q.id || randomUUID(),
        sourceFile: source.name || 'Unknown',
        sourceType: source.sourceType || 'jd',
        sourceSection: q.sourceSection || null,
      };
      allQuestions.push(tagged);
      acceptedForSource.push(tagged);
    }

    // Cross-file dedup can drop a few: complete from the document first
    // (document-specific extractive questions), then — only if the document is
    // too small for that — the old generic templates.
    let gap = count - acceptedForSource.length;
    const S = states[sourceIdx];
    if (gap > 0 && S?.model && S.model.usable.length > 0) {
      const tc = tallyTypes(buildTypeSeqLocal(count), count);
      const have = { mcq: countType(acceptedForSource, 'mcq'), fill_blank: countType(acceptedForSource, 'fill_blank'), subjective: countType(acceptedForSource, 'subjective') };
      const td = { mcq: Math.max(0, tc.mcq - have.mcq), fill_blank: Math.max(0, tc.fill_blank - have.fill_blank), subjective: Math.max(0, tc.subjective - have.subjective) };
      const tsum = td.mcq + td.fill_blank + td.subjective;
      if (tsum < gap) td.mcq += gap - tsum;
      const extra = generateExtractiveQuestions(S.model, {
        count: gap, typeCounts: td, seed: `${S.spec.seed}-p2`, usedSentences: S.usedSentences,
        exclude: (q) => { if (tracker.isDuplicate(q)) return true; tracker.add(q); return false; },
      });
      for (const q of extra) {
        if (acceptedForSource.length >= count) break;
        for (const i of q._sentences || []) S.usedSentences.add(i);
        delete q._sentences;
        const tagged = { ...q, id: randomUUID(), generatedFrom: S.spec.sourceType === 'jd' ? 'jd' : 'document', sourceFile: source.name || 'Unknown', sourceType: source.sourceType || 'jd', qualityScore: computeQuestionQualityScore(q, text), createdAt: new Date().toISOString(), stakeholderFlag: !!source.stakeholder, processDeliveryFlag: !!source.processDelivery };
        allQuestions.push(tagged);
        acceptedForSource.push(tagged);
      }
      gap = count - acceptedForSource.length;
      if (gap > 0) {
        const again = generateExtractiveQuestions(S.model, { count: gap, typeCounts: { mcq: gap, fill_blank: 0, subjective: 0 }, seed: `${S.spec.seed}-p3`, allowReuse: true, exclude: (q) => { if (tracker.isDuplicate(q)) return true; tracker.add(q); return false; } });
        for (const q of again) {
          if (acceptedForSource.length >= count) break;
          delete q._sentences;
          const tagged = { ...q, id: randomUUID(), generatedFrom: S.spec.sourceType === 'jd' ? 'jd' : 'document', sourceFile: source.name || 'Unknown', sourceType: source.sourceType || 'jd', qualityScore: computeQuestionQualityScore(q, text), createdAt: new Date().toISOString(), stakeholderFlag: !!source.stakeholder, processDeliveryFlag: !!source.processDelivery };
          allQuestions.push(tagged);
          acceptedForSource.push(tagged);
        }
        gap = count - acceptedForSource.length;
      }
    }

    if (gap > 0) {
      console.warn(`[generateQuestionsFromFiles] "${source.name}": got ${acceptedForSource.length}/${count} after cross-file dedup — padding ${gap} with doc-keyword templates`);
      const docEntitiesForPad = extractDocEntities(text, 12);
      const docKeywordsForPad = extractDocKeywords(text, 12);
      const paddingSkills = docEntitiesForPad.length > 0
        ? docEntitiesForPad
        : docKeywordsForPad.length > 0
          ? docKeywordsForPad
          : (srcSkills.length > 0 ? srcSkills : [SAFE_FALLBACK_TOPIC]);
      const { mcq: targetMcqCount, fill_blank: targetFillCount, subjective: targetSubjCount } =
        mixCounts(count, ASSESSMENT_MIX);

      let hash = 0;
      const hashSeed = `${source.name || ''}-${sourceIdx}`;
      for (let i = 0; i < hashSeed.length; i++) hash = (hash * 31 + hashSeed.charCodeAt(i)) >>> 0;
      let padComboCounters = {
        easy: 50000 + (hash % 10000) + sourceIdx * 10000,
        medium: 50000 + (hash % 10000) + sourceIdx * 10000,
        hard: 50000 + (hash % 10000) + sourceIdx * 10000,
      };

      let round = 0;
      while (acceptedForSource.length < count && round < 10) {
        const remaining = count - acceptedForSource.length;
        const padding = buildFallbackQuestions(remaining, {
          types:         buildTypeSeqLocal(remaining),
          skillsList:    paddingSkills,
          jobRole:       srcJobRole,
          comboCounters: padComboCounters,
          typeDeficit: {
            mcq:        Math.max(0, targetMcqCount  - acceptedForSource.filter(q => !q.type || q.type === 'mcq').length),
            fill_blank: Math.max(0, targetFillCount - acceptedForSource.filter(q => q.type === 'fill_blank').length),
            subjective: Math.max(0, targetSubjCount - acceptedForSource.filter(q => q.type === 'subjective').length),
          },
        });
        for (const q of padding) {
          if (acceptedForSource.length >= count) break;
          if (tracker.isDuplicate(q)) continue;
          tracker.add(q);
          const tagged = { ...q, id: q.id || randomUUID(), sourceFile: source.name || 'Unknown', sourceType: source.sourceType || 'jd', qualityScore: computeQuestionQualityScore(q, text) };
          allQuestions.push(tagged);
          acceptedForSource.push(tagged);
        }
        padComboCounters = { easy: padComboCounters.easy + 1000, medium: padComboCounters.medium + 1000, hard: padComboCounters.hard + 1000 };
        round++;
      }

      // Absolute final guarantee for this source: force-fill any residual
      // shortfall (count must never come up short), de-duplicated for the first
      // rounds, then accepted regardless on the last.
      let forceRound = 0;
      while (acceptedForSource.length < count && forceRound < 4) {
        const stillNeeded = count - acceptedForSource.length;
        const forced = buildFallbackQuestions(stillNeeded, {
          types: buildTypeSeqLocal(stillNeeded), skillsList: paddingSkills, jobRole: srcJobRole,
          comboCounters: { easy: padComboCounters.easy + forceRound * 1000, medium: padComboCounters.medium + forceRound * 1000, hard: padComboCounters.hard + forceRound * 1000 },
        });
        let addedThisRound = 0;
        for (const q of forced) {
          if (acceptedForSource.length >= count) break;
          if (forceRound < 3 && tracker.isDuplicate(q)) continue; // last round: accept regardless, count must not come up short
          const tagged = { ...q, id: q.id || randomUUID(), sourceFile: source.name || 'Unknown', sourceType: source.sourceType || 'jd', qualityScore: computeQuestionQualityScore(q, text) };
          tracker.add(tagged);
          allQuestions.push(tagged);
          acceptedForSource.push(tagged);
          addedThisRound++;
        }
        forceRound++;
        if (addedThisRound === 0 && forceRound >= 3) break; // template pool exhausted, stop looping
      }
    }
  }

  if (typeof onProgress === 'function') {
    try { onProgress({ phase: 'generating', done: Math.min(overallTotal, allQuestions.length), total: overallTotal }); } catch { /* progress hook must never break generation */ }
  }

  // Per-source combo high-water-marks — the next regenerate call reads this
  // back so each file's fallback padding continues where it left off.
  allQuestions.finalComboCounters = finalComboCountersBySource;
  return allQuestions;
}
