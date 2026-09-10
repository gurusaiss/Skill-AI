/**
 * SessionContentGenerator.js
 *
 * Generates ONE training day's content in ONE call, and does it per-day.
 *
 * Why this exists: all three module pipelines used to ask for every session's
 * content in a single LLM call capped at 8000 output tokens. Spread across
 * 5-14 days that is ~570-1600 tokens per day — roughly two to four minutes of
 * reading for a day labelled "45 min". No amount of prompt tuning fixes that;
 * the token budget was the ceiling. Generating each day separately gives every
 * day its own full budget.
 *
 * Modelled deliberately on SessionQuizGenerator.js (cache-first,
 * skip-if-present, never throws) so the two behave the same way, and paced
 * sequentially rather than Promise.all-ed because the avoid-ledger needs
 * ordering and 14 concurrent 8k-token calls would blow the Groq TPM gate.
 */
import GeminiService from './GeminiService.js';
import LLMCache from './LLMCache.js';
import { SessionContentCache } from './DataStore.js';
import GenerationJobs from './GenerationJobs.js';
import * as db from '../db/store.js';

export const CONTENT_VERSION = 2;

/** Minutes an AI-declared duration is allowed to be, snapped to 15-min steps. */
export function clampDuration(minutes, fallback = 45) {
  const n = parseInt(minutes, 10);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.min(90, Math.max(30, Math.round(n / 15) * 15));
}

/**
 * How much material a day needs to genuinely fill its declared time.
 * ~25 words/minute of *prose* looks low against raw reading speed, but a day
 * is not only prose: it also carries definitions, a card deck, worked
 * examples, tables and diagrams, all of which take real time to absorb. This
 * lands prose at the "2-3 pages" that was actually asked for at 45 minutes,
 * with the enrichment blocks on top.
 */
export function contentTargets(durationMinutes) {
  const minutes = clampDuration(durationMinutes);
  const targetWords = Math.min(1600, Math.max(750, minutes * 25));
  return {
    minutes,
    targetWords,
    proseBlocks: Math.max(2, Math.ceil(targetWords / 400)),
    cards: Math.min(15, Math.max(10, Math.round(minutes / 4))),
  };
}

const REQUIRED_BLOCK_TYPES = ['flowchart', 'lessonPlan'];
const CHART_TYPES = ['bar', 'pie'];

function wordCount(text) {
  return String(text || '').trim().split(/\s+/).filter(Boolean).length;
}

/**
 * Renders what previous days already covered so the model can go deeper or
 * adjacent instead of restating. Mirrors the avoid-list approach
 * AssessmentGenerator already uses for question de-duplication.
 */
function buildAvoidSection(avoid = {}) {
  const titles = (avoid.titles || []).filter(Boolean).slice(-20);
  const subtopics = (avoid.subtopics || []).filter(Boolean).slice(-40);
  const terms = (avoid.coveredTerms || []).filter(Boolean).slice(-60);
  const companies = (avoid.companies || []).filter(Boolean).slice(-15);
  if (!titles.length && !subtopics.length && !terms.length) return '';
  return `
=== ALREADY COVERED ON EARLIER DAYS — DO NOT REPEAT ===
${titles.length ? `Day titles used: ${titles.join(' | ')}` : ''}
${subtopics.length ? `Subtopics already taught: ${subtopics.join(', ')}` : ''}
${terms.length ? `Terms already defined: ${terms.join(', ')}` : ''}
${companies.length ? `Companies already used as examples: ${companies.join(', ')} — use different ones` : ''}

Go DEEPER or ADJACENT to the above, never restate it. Reusing a definition,
subtopic or example from an earlier day is a failure.`;
}

function buildPrompt({ moduleTitle, jobRole, jdContext, gaps, difficulty, dayNumber, totalDays, skeleton, avoid }) {
  const t = contentTargets(skeleton?.durationMinutes);
  const subtopicHint = (skeleton?.subtopics || [])
    .map(s => (typeof s === 'string' ? s : s?.name))
    .filter(Boolean);

  return `You are a senior subject-matter expert writing ONE day of a corporate training programme.

=== THIS DAY ===
Module: ${moduleTitle || 'Training Module'}
Day ${dayNumber} of ${totalDays}
Day topic: ${skeleton?.title || `Day ${dayNumber}`}
${skeleton?.objective ? `Objective: ${skeleton.objective}` : ''}
${subtopicHint.length ? `Subtopics to cover: ${subtopicHint.join(', ')}` : ''}
Declared duration: ${t.minutes} minutes

=== LEARNER ===
Job role: ${jobRole || 'Professional'}
${difficulty ? `Level: ${difficulty}` : ''}
${gaps?.length ? `Assessment gaps this programme is closing: ${gaps.join(', ')}` : ''}
${jdContext ? `Their job description (write for THIS person's actual work):\n${String(jdContext).slice(0, 1200)}` : ''}
${buildAvoidSection(avoid)}

=== VOLUME REQUIREMENT (non-negotiable) ===
This day must genuinely occupy ${t.minutes} minutes of an employee's time.
Write approximately ${t.targetWords} words of prose across ${t.proseBlocks} separate
prose blocks, PLUS all the structured blocks below. Thin content is the single
most common failure here — a day that can be read in five minutes is wrong.

=== RULES ===
1. Write for this specific job role and these specific gaps. Reference the real
   tools, systems, artefacts and vocabulary someone in this role actually uses.
2. No filler. Avoid "plays a crucial role", "in today's fast-paced world",
   "it is important to note", and any sentence that would read identically in a
   different role's course.
3. Real-world examples must name a real company or a real, checkable industry
   incident, and say what was actually done and what resulted.
4. Every definition must be one this role genuinely needs, not a dictionary gloss.
5. Interleave the blocks (prose -> visual -> prose -> table -> example), so the
   day reads as several varied pages rather than one wall of text.

Return ONLY this JSON:
{
  "contentVersion": 2,
  "durationMinutes": ${t.minutes},
  "learningObjectives": ["By the end of this session you will be able to ...", "...", "..."],
  "subtopics": [{"name": "...", "summary": "...", "learningOutcome": "...", "minutes": 10}],
  "definitions": [{"term": "...", "definition": "...", "whyItMatters": "..."}],
  "abbreviations": [{"short": "SIEM", "full": "Security Information and Event Management", "note": "where this role meets it"}],
  "mnemonics": [{"device": "...", "expands": "...", "howToUse": "..."}],
  "keepInMind": [{"point": "...", "why": "...", "severity": "critical|important|tip"}],
  "cardDeck": [{"front": "question or term", "back": "the answer, 1-3 sentences", "tag": "subtopic"}],
  "keyPoints": ["...", "...", "...", "...", "...", "...", "..."],
  "coveredTerms": ["every term/concept this day teaches — used to stop later days repeating it"],
  "blocks": [
    {"type": "prose", "heading": "...", "body": "300-500 words of real teaching content"},
    {"type": "flowchart", "title": "...", "steps": [{"label": "...", "detail": "..."}], "note": "..."},
    {"type": "bar", "title": "...", "unit": "...", "data": [{"label": "...", "value": 0}], "insight": "..."},
    {"type": "pie", "title": "...", "unit": "%", "data": [{"label": "...", "value": 0}], "insight": "..."},
    {"type": "comparison", "title": "...", "columns": ["Aspect", "Option A", "Option B"], "rows": [["...", "...", "..."]]},
    {"type": "lessonPlan", "title": "What you'll cover", "rows": [{"subtopic": "...", "outcome": "...", "minutes": 10, "activity": "read | practise | review"}]},
    {"type": "example", "title": "...", "company": "Real company name", "year": "2023", "scenario": "...", "action": "...", "outcome": "...", "takeaway": "..."},
    {"type": "callout", "variant": "warning|pitfall|tip", "title": "...", "body": "..."},
    {"type": "checklist", "title": "...", "items": ["...", "..."]}
  ]
}

Required in "blocks": at least ${t.proseBlocks} "prose" blocks, at least one
"flowchart", at least one chart ("bar" or "pie"), exactly one "lessonPlan" with
one row per subtopic, and at least two "example" blocks naming real companies.
Omit a block type entirely if it genuinely does not fit this topic — never
invent numbers for a chart that has no real data behind it.

Required top-level fields — these are NOT optional, do not return an empty
array for any of them:
- "learningObjectives": exactly 3
- "subtopics": 3-6, each with name, summary, learningOutcome, minutes
- "definitions": 6-8
- "cardDeck": ${t.cards}
- "keyPoints": exactly 7
- "keepInMind": 4-6
- "coveredTerms": every term/concept this day teaches (for later-day dedup)
"abbreviations" and "mnemonics" may be empty ONLY if this specific topic
genuinely has none that apply — do not force one that doesn't fit.`;
}

/** Drops malformed blocks so one bad entry can't break the whole day. */
function sanitizeBlocks(blocks) {
  if (!Array.isArray(blocks)) return [];
  return blocks.filter(b => {
    if (!b || typeof b !== 'object' || !b.type) return false;
    switch (b.type) {
      case 'prose': return wordCount(b.body) >= 40;
      case 'flowchart': return Array.isArray(b.steps) && b.steps.length >= 2;
      case 'bar':
      case 'pie': return Array.isArray(b.data) && b.data.filter(d => typeof d?.value === 'number').length >= 2;
      case 'comparison': return Array.isArray(b.columns) && b.columns.length >= 2 && Array.isArray(b.rows) && b.rows.length >= 1;
      case 'lessonPlan': return Array.isArray(b.rows) && b.rows.length >= 1;
      case 'example': return Boolean(b.scenario || b.outcome);
      case 'callout': return Boolean(b.body);
      case 'checklist': return Array.isArray(b.items) && b.items.length >= 2;
      default: return false;
    }
  });
}

/** What the day is still missing, for a single targeted top-up call. */
function findGaps(content, targets) {
  const blocks = content.blocks || [];
  const proseWords = blocks.filter(b => b.type === 'prose').reduce((s, b) => s + wordCount(b.body), 0);
  const missing = [];
  if (proseWords < targets.targetWords * 0.6) missing.push(`more prose (have ~${proseWords} words, need ~${targets.targetWords})`);
  for (const t of REQUIRED_BLOCK_TYPES) {
    if (!blocks.some(b => b.type === t)) missing.push(`a "${t}" block`);
  }
  if (!blocks.some(b => CHART_TYPES.includes(b.type))) missing.push('a "bar" or "pie" chart block');
  if (blocks.filter(b => b.type === 'example').length < 2) missing.push('at least two "example" blocks naming real companies');
  if ((content.cardDeck || []).length < 10) missing.push(`a fuller cardDeck (have ${(content.cardDeck || []).length}, need ${targets.cards})`);
  if ((content.definitions || []).length < 5) missing.push('at least 6 definitions');
  // These were previously never checked, so a response that filled in blocks/
  // cardDeck/definitions well but left the smaller top-level arrays empty
  // (observed from the weaker fallback tiers) sailed through unnoticed — the
  // top-up call never even asked for them because nothing flagged them missing.
  if ((content.learningObjectives || []).length < 2) missing.push('at least 3 learningObjectives ("By the end of this session you will be able to...")');
  if ((content.keyPoints || []).length < 4) missing.push('at least 7 keyPoints');
  if ((content.subtopics || []).length < 2) missing.push('at least 3 subtopics (name, summary, learningOutcome, minutes)');
  if ((content.coveredTerms || []).length < 3) missing.push('a coveredTerms list of the terms/concepts this day teaches');
  return { missing, proseWords };
}

function mergeContent(base, extra) {
  if (!extra || typeof extra !== 'object') return base;
  const mergeArr = (a, b) => [...(Array.isArray(a) ? a : []), ...(Array.isArray(b) ? b : [])];
  return {
    ...base,
    learningObjectives: mergeArr(base.learningObjectives, extra.learningObjectives),
    subtopics: mergeArr(base.subtopics, extra.subtopics),
    definitions: mergeArr(base.definitions, extra.definitions),
    abbreviations: mergeArr(base.abbreviations, extra.abbreviations),
    mnemonics: mergeArr(base.mnemonics, extra.mnemonics),
    keepInMind: mergeArr(base.keepInMind, extra.keepInMind),
    cardDeck: mergeArr(base.cardDeck, extra.cardDeck),
    keyPoints: mergeArr(base.keyPoints, extra.keyPoints),
    coveredTerms: [...new Set(mergeArr(base.coveredTerms, extra.coveredTerms))],
    blocks: mergeArr(base.blocks, sanitizeBlocks(extra.blocks)),
  };
}

/**
 * Generate one day's content. Never throws — returns null on failure so the
 * caller keeps the existing (thin) session rather than losing the module.
 */
export async function generateSessionContent({
  moduleTitle, moduleDescription, jobRole, jdContext, gaps = [], difficulty,
  dayNumber = 1, totalDays = 1, skeleton = {}, avoid = {},
}) {
  const targets = contentTargets(skeleton?.durationMinutes);

  // Fingerprint deliberately EXCLUDES moduleId and userId: two employees in
  // the same role with the same gap profile should share a day's content
  // rather than each paying for its generation.
  const subtopicKey = (skeleton?.subtopics || [])
    .map(s => (typeof s === 'string' ? s : s?.name)).filter(Boolean).join('|');
  const fingerprint = LLMCache.hash([
    jobRole || '', difficulty || '', skeleton?.title || '', subtopicKey,
    (gaps || []).join(','), targets.minutes, CONTENT_VERSION,
  ].join('~'));
  const memKey = `day_content_v${CONTENT_VERSION}_${fingerprint}`;

  const hot = LLMCache.get(memKey);
  if (hot) return hot;
  const persisted = await SessionContentCache.get(fingerprint);
  if (persisted) {
    LLMCache.set(memKey, persisted, LLMCache.TTL.DAY_CONTENT);
    return persisted;
  }

  const prompt = buildPrompt({ moduleTitle, jobRole, jdContext, gaps, difficulty, dayNumber, totalDays, skeleton, avoid });

  let raw;
  try {
    raw = await GeminiService.generateDeepJSON(prompt, '', { maxTokens: 8000 });
  } catch (e) {
    console.warn(`[SessionContentGenerator] day ${dayNumber} generation failed:`, e.message);
    return null;
  }
  if (!raw || typeof raw !== 'object') return null;

  let content = {
    contentVersion: CONTENT_VERSION,
    durationMinutes: clampDuration(raw.durationMinutes, targets.minutes),
    learningObjectives: Array.isArray(raw.learningObjectives) ? raw.learningObjectives : [],
    subtopics: Array.isArray(raw.subtopics) ? raw.subtopics : [],
    definitions: Array.isArray(raw.definitions) ? raw.definitions : [],
    abbreviations: Array.isArray(raw.abbreviations) ? raw.abbreviations : [],
    mnemonics: Array.isArray(raw.mnemonics) ? raw.mnemonics : [],
    keepInMind: Array.isArray(raw.keepInMind) ? raw.keepInMind : [],
    cardDeck: Array.isArray(raw.cardDeck) ? raw.cardDeck : [],
    keyPoints: Array.isArray(raw.keyPoints) ? raw.keyPoints : [],
    coveredTerms: Array.isArray(raw.coveredTerms) ? raw.coveredTerms : [],
    blocks: sanitizeBlocks(raw.blocks),
  };

  // One — and only one — targeted top-up for whatever is missing. Weaker
  // fallback tiers routinely under-deliver, and asking again for just the
  // gaps is far cheaper than regenerating the whole day.
  const { missing } = findGaps(content, targets);
  if (missing.length > 0) {
    try {
      const topUp = await GeminiService.generateDeepJSON(
        `${prompt}\n\n=== TOP-UP ONLY ===\nYour previous response was incomplete. Return ONLY the missing pieces, in the same JSON shape (omit everything already provided):\n- ${missing.join('\n- ')}`,
        '', { maxTokens: 6000 }
      );
      if (topUp) content = mergeContent(content, topUp);
    } catch (e) {
      console.warn(`[SessionContentGenerator] day ${dayNumber} top-up failed:`, e.message);
    }
  }

  // A day with essentially nothing in it is worse than leaving the existing
  // content alone, so refuse to return it.
  if (content.blocks.length < 3 && (content.definitions || []).length < 3) return null;

  LLMCache.set(memKey, content, LLMCache.TTL.DAY_CONTENT);
  await SessionContentCache.set(fingerprint, content);
  return content;
}

/** True when a session already carries real v2 depth. */
export function hasDeepContent(session) {
  return session?.contentVersion === CONTENT_VERSION && Array.isArray(session?.blocks) && session.blocks.length >= 6;
}

/**
 * Fill in deep content for every session that lacks it.
 *
 * Sequential (concurrency 1) on purpose, unlike ensureAllSessionQuizzes'
 * Promise.all: each day must see what earlier days actually covered to avoid
 * repeating them, and 14 concurrent ~8k-token calls would immediately exceed
 * the Groq TPM ceiling and get throttled or rejected anyway.
 *
 * Never throws. A day that fails is left as-is, so a partial run still
 * improves the module and can be resumed later (it skips what it already did).
 */
export async function ensureAllSessionContent(sessions, {
  moduleTitle, moduleDescription, jobRole, jdContext, gaps = [], difficulty, onProgress = null,
  persist = null,
} = {}) {
  if (!Array.isArray(sessions) || sessions.length === 0) return sessions;

  const out = [...sessions];
  const avoid = { titles: [], subtopics: [], coveredTerms: [], companies: [] };

  // Seed the avoid-ledger from days that are already deep, so a resumed run
  // doesn't repeat content it generated on an earlier pass.
  for (const s of out) {
    if (!hasDeepContent(s)) continue;
    if (s.title) avoid.titles.push(s.title);
    (s.subtopics || []).forEach(st => avoid.subtopics.push(typeof st === 'string' ? st : st?.name));
    (s.coveredTerms || []).forEach(t => avoid.coveredTerms.push(t));
    (s.blocks || []).filter(b => b.type === 'example' && b.company).forEach(b => avoid.companies.push(b.company));
  }

  for (let i = 0; i < out.length; i++) {
    const session = out[i];
    if (hasDeepContent(session)) continue;

    const content = await generateSessionContent({
      moduleTitle, moduleDescription, jobRole, jdContext, gaps, difficulty,
      dayNumber: session.dayNumber || i + 1,
      totalDays: out.length,
      skeleton: session,
      avoid,
    });

    if (content) {
      out[i] = {
        ...session,
        ...content,
        // Keep the string form in sync — the existing renderer reads it.
        duration: `${content.durationMinutes} min`,
      };
      if (session.title) avoid.titles.push(session.title);
      (content.subtopics || []).forEach(st => avoid.subtopics.push(typeof st === 'string' ? st : st?.name));
      (content.coveredTerms || []).forEach(t => avoid.coveredTerms.push(t));
      (content.blocks || []).filter(b => b.type === 'example' && b.company).forEach(b => avoid.companies.push(b.company));
    }

    // Persist after EACH day rather than only at the end, so a long run that
    // is interrupted (restart, crash) keeps everything generated so far —
    // and, more importantly, so day 1 is readable while day 8 is still being
    // written.
    if (content && persist) {
      try { await persist(out); } catch (e) { console.warn('[SessionContentGenerator] persist failed:', e.message); }
    }

    if (onProgress) {
      try { onProgress({ dayNumber: session.dayNumber || i + 1, total: out.length, ok: Boolean(content) }); } catch { /* non-fatal */ }
    }
  }

  return out;
}

/**
 * Kick off deep-content generation for a module in the background and return
 * immediately.
 *
 * Nothing is generated inline: a 14-day module is 14 sequential ~8k-token
 * calls, which would add many minutes to whichever admin request triggered it.
 * Sessions are day-locked (day N unlocks on day N), so a background run that
 * takes ten minutes still lands every day well before anyone can open it —
 * content is in the DB before it is ever requested, which is the actual
 * requirement. Day 1 is generated first and persisted immediately.
 *
 * Idempotent per module: GenerationJobs.start() refuses to register a second
 * concurrent run, so repeated triggers (re-approval, a retry, two admins
 * clicking at once) cannot produce duplicate competing generations.
 */
export function startDeepContentJob(moduleId, ctx = {}) {
  if (!moduleId) return { started: false, reason: 'moduleId required' };
  const jobKey = `modulecontent_${moduleId}`;
  const { created } = GenerationJobs.start(jobKey, { total: ctx.sessions?.length || 0, source: 'module-deep-content' });
  if (!created) return { started: false, reason: 'already running' };

  setImmediate(async () => {
    try {
      const current = await db.getModuleById(moduleId).catch(() => null);
      const sessions = current?.content?.sessions || current?.sessions || ctx.sessions || [];
      if (!sessions.length) { GenerationJobs.finish(jobKey, {}); return; }

      await ensureAllSessionContent(sessions, {
        ...ctx,
        onProgress: (evt) => GenerationJobs.progress(jobKey, { done: evt.dayNumber, total: evt.total, phase: `day ${evt.dayNumber}/${evt.total}` }),
        persist: async (updated) => {
          const mod = await db.getModuleById(moduleId).catch(() => null);
          await db.updateModule(moduleId, {
            sessions: updated,
            content: { ...(mod?.content || {}), sessions: updated },
          });
        },
      });
      GenerationJobs.finish(jobKey, { count: sessions.length });
      console.log(`[SessionContentGenerator] deep content complete for module ${moduleId}`);
    } catch (e) {
      console.error(`[SessionContentGenerator] job failed for module ${moduleId}:`, e.message);
      GenerationJobs.fail(jobKey, e.message);
    }
  });

  return { started: true, jobKey };
}
