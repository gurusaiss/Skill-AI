/**
 * AssessmentGenerator.js — shared question generation service
 * Extracted from assessment.js so users.js and roles.js can reuse it
 * without circular imports.
 */
import { randomUUID } from 'crypto';
import { classifyJDVsProcessSections } from '../utils/textPreprocessor.js';
import GeminiService from './GeminiService.js';

// Groq's free/on-demand tier enforces a hard per-REQUEST token budget (prompt
// tokens + requested max_tokens combined) — observed limit: 12,000 TPM for
// openai/gpt-oss-120b (Groq). A single request whose own (input + max_tokens)
// exceeds that is rejected outright with HTTP 413, before generating
// anything — this is not a rate/timing issue solvable by spacing calls out.
// The original chunk sizes (80,000 chars) and max_tokens (16,000+) were sized
// for Groq's paid-tier 128k context window, which silently assumed the free
// tier wasn't in play. These smaller budgets keep each individual request
// comfortably under the free-tier ceiling — at the cost of more attempts
// needed to fill a large question count (a real quality/latency tradeoff,
// not a full fix; the free tier itself is the actual constraint. See
// docs/DEPLOYMENT_GUIDE.md for upgrading to a paid Groq/Gemini tier).
// Per-request budgets. These were sized for Groq's free/on-demand tier, whose
// ~8,000 tokens-per-MINUTE ceiling forces many small, paced requests — which
// is what made a multi-PDF bank take 15-40+ minutes. Gemini has no comparable
// per-minute squeeze here (measured: 20 questions in one call, 5 concurrent
// calls all fine), so when Gemini is the active provider we use far larger
// batches and bigger source chunks: the same bank becomes a couple of calls
// instead of dozens. Falls back to the tight Groq numbers automatically when
// Gemini isn't configured, so nothing breaks on a Groq-only deployment.
const GROQ_SOURCE_CHAR_BUDGET    = 6000;   // ~1,500 tokens of source text per request
const GROQ_MAX_OUTPUT_TOKENS     = 3000;
const GROQ_MAX_QUESTIONS_PER_CALL = 8;

const GEMINI_SOURCE_CHAR_BUDGET   = 24000; // ~6,000 tokens — fewer, richer chunks
// gemini-3.6-flash is a THINKING model: reasoning tokens are billed against
// the same output budget as the answer (a measured call spent 2,161 tokens
// thinking before writing a single question). Our question schema is also
// large — type/question/4 options/answer/explanation/skillArea/sourceSection/
// sourceQuote runs ~250-350 tokens each. An 8,192 budget truncated the JSON
// mid-string ("Unterminated string in JSON at position 9371") and the whole
// batch was discarded. Gemini has no tight per-minute token squeeze here, so
// there's no reason to be stingy: give it real headroom.
const GEMINI_MAX_OUTPUT_TOKENS    = 32768;
const GEMINI_MAX_QUESTIONS_PER_CALL = 15;  // conservative vs. the 20 that verified, to keep JSON well inside budget

function geminiPrimary() {
  const k = process.env.GEMINI_API_KEY;
  return !!(k && k.length > 10);
}
function sourceCharBudget()    { return geminiPrimary() ? GEMINI_SOURCE_CHAR_BUDGET   : GROQ_SOURCE_CHAR_BUDGET; }
function maxQuestionsPerCall() { return geminiPrimary() ? GEMINI_MAX_QUESTIONS_PER_CALL : GROQ_MAX_QUESTIONS_PER_CALL; }
function maxOutputTokensCap()  { return geminiPrimary() ? GEMINI_MAX_OUTPUT_TOKENS    : GROQ_MAX_OUTPUT_TOKENS; }

// A question in our JSON format runs ~250-350 output tokens (stem, 4 options,
// answer, explanation, skillArea, sourceSection, sourceQuote).
//
// Two very different sizing regimes:
//  - Groq: the API counts REQUESTED max_tokens against the ~8,000/min budget,
//    so over-reserving directly costs throughput. Size tightly.
//  - Gemini: no comparable per-minute squeeze, AND it's a thinking model whose
//    reasoning tokens share the output budget — under-reserving truncates the
//    JSON mid-object and the entire batch is thrown away. Size generously,
//    with a flat reasoning allowance on top of the per-question estimate.
function outputTokensFor(count) {
  const n = count || 1;
  if (geminiPrimary()) {
    return Math.min(maxOutputTokensCap(), Math.max(4000, n * 400 + 6000)); // +6k reasoning headroom
  }
  return Math.min(maxOutputTokensCap(), Math.max(600, n * 200 + 400));
}

// Wraps an optional caller-supplied onProgress callback into two safe emitters
// used throughout generation. `progress(done)` reports how many questions are
// accepted so far (monotonic, clamped to total). `throttle(delayMs)` reports a
// rate-limit pause so the UI can show "pausing for rate limit ~Ns" instead of
// looking frozen. Both swallow callback errors — a progress hook must never
// break generation. No-ops entirely when onProgress isn't provided (every
// existing caller), so behavior is unchanged unless a caller opts in.
function makeProgressEmitter(onProgress, total) {
  let lastDone = -1;
  const safe = (evt) => { if (typeof onProgress === 'function') { try { onProgress(evt); } catch { /* ignore */ } } };
  return {
    progress(done) {
      const clamped = Math.min(total, Math.max(0, done | 0));
      if (clamped === lastDone) return;
      lastDone = clamped;
      safe({ phase: 'generating', done: clamped, total });
    },
    throttle(delayMs) {
      safe({ phase: 'throttled', done: Math.max(0, lastDone), total, delayMs: delayMs | 0 });
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

// Tracks question-text token sets (fuzzy, >70% overlap = duplicate), MCQ
// option sets (exact, order-independent), and fill_blank/subjective answers
// (exact) across a growing set of questions. `preSeededQuestions` lets a
// caller seed the tracker with content it should treat as "already used"
// without those questions being part of the batch actually being built.
function createSeenTracker(preSeededQuestions = []) {
  const tokenSets = [];
  const optionSets = new Set();
  const answers = new Set();
  const texts = new Set();

  function add(q) {
    if (!q || !q.question) return;
    tokenSets.push(new Set(normalizeTokens(q.question)));
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

function buildSystemPrompt() {
  return `You are an expert HR assessment designer who creates role-specific assessments for ALL job functions across ALL industries — HR, Operations, Finance, Sales, Marketing, Customer Success, Procurement, L&D, Project Management, IT, Engineering, Healthcare, Legal, and any other domain.

ABSOLUTE RULES:
1. Read and extract the actual domain, responsibilities, tools, and required knowledge from the JD FIRST.
2. Generate questions ONLY about what the JD explicitly requires — never introduce topics from unrelated domains.
3. Domain must match: HR role → HR questions. Finance role → Finance questions. Operations → Operations questions. Do NOT cross domains.
4. Every question must trace directly to a specific responsibility, skill, process, tool, or competency in the JD.
5. Match seniority level: Executive/Director → strategy, policy, P&L, stakeholder decisions. Manager → team management, planning, escalation, reporting. Specialist/Executive → applied process, tools, day-to-day procedures. Junior/Coordinator → foundational knowledge, process steps.
6. Never generate software coding or engineering architecture questions unless the JD explicitly lists programming as a requirement.
7. Always return valid JSON with exactly a "questions" array.
8. QUESTION WORDING — CRITICAL: At most 1 out of every 10 questions may begin with "As a [role]", "In your role as", "While working as", or "As an [role]". The other 9+ questions must open naturally — ask directly about the concept, situation, scenario, or decision. Write questions like a real corporate assessment, not like a role-play prompt.
9. NO DUPLICATE QUESTIONS: Every question must test a DIFFERENT concept, situation, and scenario. No two questions may share the same meaning, even if the wording differs. Every question must have unique answer options — no repeated option sets across questions.
10. NO CROSS-DIFFICULTY REPEATS — STRICTLY ENFORCED: A concept or scenario tested at Easy MUST NOT reappear at Medium or Hard, even reworded or at higher complexity. Each difficulty tier covers ENTIRELY DIFFERENT scenarios. Before writing a single question, mentally list all scenarios you will cover and assign each to exactly one difficulty tier — then generate from that plan.
11. NO REPEATED MCQ OPTION SETS: Every MCQ must have a unique set of four answer choices. Never reuse the same options (even reworded) from a previous question.
12. QUESTION STYLE VARIETY — MANDATORY: Write questions in varied styles throughout the set. Required styles include (rotate through them): real workplace scenarios, decision-making under pressure, situational judgment, multi-step process questions, customer/client interaction scenarios, team collaboration dilemmas, compliance and policy questions, root-cause problem solving, communication and escalation, case-based analysis, tool/system usage, performance measurement, stakeholder management, and risk assessment. No single style may appear more than 20% of the time.
13. OPTION QUALITY: MCQ distractors must be plausible but clearly distinguishable from the correct answer. Avoid "all of the above", "none of the above", and trick options. Each wrong option should represent a genuinely mistaken approach, not an obviously silly one.`;
}

// Builds a capped "these were already used, produce different scenarios"
// prompt section for regeneration — sourced from the SAME avoid-set the
// post-hoc cross-version reject filter uses (see mergeUnique/mergeFallbackUnique
// callers), so the LLM's own attempt to diverge and the reject filter never
// disagree on what counts as "already used". Capped at ~40 prior questions,
// first ~12 words each — enough to nudge divergence without the token/latency
// cost of injecting full prior question text on every regenerate call.
function buildAvoidSection(avoidQuestions) {
  if (!Array.isArray(avoidQuestions) || avoidQuestions.length === 0) return '';
  const capped = avoidQuestions.slice(0, 40).map(q => {
    const text = (q?.question || q || '').toString().trim();
    const words = text.split(/\s+/).slice(0, 12).join(' ');
    return `- ${words}${text.split(/\s+/).length > 12 ? '...' : ''}`;
  }).filter(Boolean);
  if (capped.length === 0) return '';
  return `
=== ALREADY USED — DO NOT REPEAT (from the previous version) ===
This is a REGENERATION. The scenarios, wording, and examples below were already used in a prior version and already seen by employees. Every new question must cover DIFFERENT scenarios, wording, and examples — testing the same underlying knowledge is fine, repeating how it was asked is not.
${capped.join('\n')}
`;
}

function buildUserPrompt({ count, jobRole, jdText, skillsList, types, seed, supportingDocsText, avoidQuestions = [] }) {
  const easyCount   = Math.round(count * 0.35);
  const mediumCount = Math.round(count * 0.45);
  const hardCount   = Math.max(1, count - easyCount - mediumCount);
  const maxRoleOpener = Math.max(1, Math.floor(count * 0.08));
  const hasProcessDocs = !!(supportingDocsText?.trim());

  const STYLE_LIST = [
    'real workplace scenario',
    'decision under pressure',
    'situational judgment',
    'multi-step process',
    'client/customer interaction',
    'team collaboration dilemma',
    'compliance or policy',
    'root-cause problem solving',
    'communication or escalation',
    'case-based analysis',
    'tool or system usage',
    'performance measurement',
    'stakeholder management',
    'risk assessment',
  ];

  const processDocsSection = hasProcessDocs ? `
=== INTERNAL PROCESS DOCUMENTS ===
These documents describe the organization's actual operating procedures, workflows, and standards.
They are the PRIMARY source for process-based, SOP, and operational questions.
Generate 30–40% of questions directly from these documents when they are present.

${supportingDocsText}

` : '';

  const processDocsStep = hasProcessDocs ? `
• Extract key processes, SOPs, workflows, and operational standards from the INTERNAL PROCESS DOCUMENTS
• Identify company-specific terminology, step sequences, approval flows, and decision criteria` : '';

  const processDocsMix = hasProcessDocs ? `
• ${Math.round(count * 0.35)} questions from the INTERNAL PROCESS DOCUMENTS (real SOP/workflow scenarios)
• ${count - Math.round(count * 0.35)} questions from the JD responsibilities and required competencies
• Blend both sources — questions should feel like they come from the same organisation` : `
• All scenarios drawn from the JD responsibilities and required competencies`;

  return `Generate exactly ${count} unique assessment questions for the role described below.

=== EMPLOYEE PROFILE ===
Job Role: ${jobRole || 'Professional'}
Variation Seed: ${seed}
${skillsList.length ? `Skills from JD: ${skillsList.join(', ')}` : ''}

=== JOB DESCRIPTION ===
${jdText || '(No JD provided — infer responsibilities from the job role)'}
${processDocsSection}${buildAvoidSection(avoidQuestions)}
=== MANDATORY PRE-GENERATION STEPS ===

STEP 1 — EXTRACT ROLE PROFILE (do this before writing any question):
• Primary domain/industry
• Seniority level
• Top responsibilities from the JD
• Required tools, platforms, systems
• Required processes and workflows
• Required knowledge areas
• Required soft skills and competencies${processDocsStep}

STEP 2 — PLAN ${count} UNIQUE SCENARIOS (do this before writing any question):
List ${count} DISTINCT real-work scenarios, one per question slot.
Source mix:${processDocsMix}

RULES for scenario planning:
• Each scenario covers a different responsibility, process, or competency
• No two scenarios overlap in topic, situation, or wording
• Assign each scenario to exactly ONE difficulty tier — never reuse a scenario across tiers
• Easy scenarios: ${easyCount} — foundational knowledge, clear-cut decisions, standard process steps
• Medium scenarios: ${mediumCount} — applied judgment, multi-step decisions, moderate complexity
• Hard scenarios: ${hardCount} — strategic trade-offs, edge cases, cross-functional conflicts, ambiguous situations
• Distribute styles across ALL ${count} questions (no style > 20% of total):
  ${STYLE_LIST.join(' | ')}

STEP 3 — WRITE QUESTIONS FROM THE PLANNED SCENARIOS:

QUESTION TYPE SEQUENCE (cycle in this exact order): ${types.join(', ')}

WORDING RULES:
• MAX ${maxRoleOpener} question(s) total may start with "As a [role]" / "In your role as" / "While working as"
• ALL other questions must open with a direct scenario or concept — never with the role title
• Good openers: "When evaluating...", "A colleague raises...", "Which approach best...", "A client reports...", "During a review of...", "What is the recommended...", "A team faces..."
• Bad openers: "As an HR Executive...", "In your role as Finance Manager..."

MCQ OPTION RULES:
• Every MCQ must have 4 UNIQUE options not shared with any other question
• Options must be plausible but distinguishable — no trick options, no "all/none of the above"
• Vary which letter (A/B/C/D) is correct — do not default to A

STEP 4 — SELF-CHECK BEFORE OUTPUT:
✓ Exactly ${count} questions total (${easyCount} easy, ${mediumCount} medium, ${hardCount} hard)
✓ No two questions test the same scenario, concept, or wording
✓ No difficulty tier repeats a scenario from another tier
✓ No repeated MCQ option sets across questions
✓ Question styles are varied — no single style exceeds 20%
${hasProcessDocs ? '✓ Process-doc questions reference actual procedures from the uploaded documents' : ''}
✓ sourceQuote is filled with a real, verbatim excerpt from the JD/process text above for every question — not a paraphrase, not invented

=== OUTPUT FORMAT — return only this JSON ===
{
  "questions": [
    {
      "type": "mcq|fill_blank|subjective",
      "question": "naturally worded question — scenario-first, not role-first",
      "difficulty": "easy|medium|hard",
      "options": ["A) ...", "B) ...", "C) ...", "D) ..."],
      "answer": "A/B/C/D for mcq | exact phrase for fill_blank | detailed model answer for subjective",
      "explanation": "which JD responsibility, skill, or process document section this tests",
      "sourceQuote": "a short (5-25 word) excerpt copied VERBATIM, character-for-character, from the JOB DESCRIPTION or INTERNAL PROCESS DOCUMENTS text above — the exact sentence or phrase this question is testing. Do not paraphrase or summarize it. If nothing in the provided text supports this question, do not generate the question at all.",
      "skillArea": "specific competency, tool, process, or SOP from the JD or process docs"
    }
  ]
}`;
}

// ── Document-focused prompt builders ─────────────────────────────────────────
// Used by generateQuestionsFromDocument (file-based path).
// Unlike the JD path, these enforce 100% document-sourced questions and remove
// generic corporate styles that cause irrelevant output for process documents.

function buildDocumentSystemPrompt() {
  return `You are an expert assessment designer who creates precise, document-specific questions for employee capability assessments.

ABSOLUTE RULES:
1. Every question MUST derive directly from content EXPLICITLY STATED in the SOURCE DOCUMENT provided.
2. Use the exact terminology, step names, system names, thresholds, codes, and decision rules found in the document. If the document says "Step 3: Validate the TR field", reference that exact step.
3. DO NOT introduce generic business concepts UNLESS the document explicitly covers them by name.
4. Each question must be answerable using ONLY information from the document. No external knowledge, general best practices, or assumed industry norms.
5. Test actual operational knowledge: specific steps, rules, exception conditions, validation criteria, approval thresholds, system actions, decision points.
6. If the document describes a payment process → ask about payment steps, error codes, and thresholds. If it describes data validation → ask about validation rules, error types, correction steps.
7. Always return valid JSON with exactly a "questions" array.
8. NO DUPLICATE QUESTIONS: Every question must test a DIFFERENT specific item from the document.
9. NO REPEATED MCQ OPTION SETS: Every MCQ must have unique answer choices derived from document content.
10. MAX 1 question in 10 may begin with "As a [role]" opener — all others open naturally with the scenario.
11. NEVER generate questions about: headings, section titles, document titles, author names, reviewer names, version numbers, page numbers, file names, dates, confidentiality labels, or any document metadata. Generate questions ONLY from the main body content: procedures, steps, rules, tables, criteria, thresholds, and decision logic.
12. CONTENT PRIORITY (highest to lowest): (1) numbered/lettered procedure steps, (2) tables and data grids, (3) decision rules and conditions, (4) exception/error handling, (5) body paragraphs, (6) examples and case descriptions. NEVER from headings alone.

STRICTLY BANNED — these phrases MUST NOT appear in any question, option, or explanation unless they are quoted verbatim from the source document:
- "stakeholder management", "stakeholder communication", "stakeholder engagement"
- "change management", "change control"
- "leadership", "leadership style", "leadership qualities"
- "strategic thinking", "strategic alignment", "strategic objectives"
- "continuous improvement", "best practices", "industry standards"
- "professional context", "organizational goals", "team collaboration" (as standalone concepts)
- ANY document metadata: author names, reviewer names, version numbers, file names, dates, page numbers
Any question containing these phrases without a direct quote from the source document will be REJECTED. Generate document-grounded alternatives instead.

ANSWER FORMAT RULES (strictly enforced):
- fill_blank answers: Single word, short phrase (2–5 words maximum), or a specific value/code/number from the document. NEVER a full sentence.
- subjective answers: Exactly 2–3 concise bullet points. Each point under 20 words. No paragraphs. No essays. Format: "• Point 1 | • Point 2 | • Point 3"
- mcq answers: Letter only (A, B, C, or D).`;
}

function buildDocumentUserPrompt({ count, jobRole, sourceText, sourceName, sourceType, types, seed, skillsContext = [], stakeholder = false, processDelivery = false, avoidQuestions = [] }) {
  const easyCount   = Math.round(count * 0.35);
  const mediumCount = Math.round(count * 0.45);
  const hardCount   = Math.max(1, count - easyCount - mediumCount);
  const docLabel    = sourceType === 'jd' ? 'Job Description' : 'Process Document / Internal Reference';
  const skillsLine  = skillsContext.length > 0
    ? `\nRole Skills (context only — do NOT use as question source): ${skillsContext.join(', ')}`
    : '';
  const stakeholderDirective = stakeholder
    ? `\nSTAKEHOLDER CONTENT — ENABLED: Where the document describes interactions with stakeholders (clients, teams, managers, vendors, customers), you MAY generate questions that test the specific communication steps, escalation paths, or approval flows explicitly described. These must still use the document's exact terminology — no generic "stakeholder management" questions.`
    : `\nSTAKEHOLDER CONTENT — DISABLED: Do NOT generate any questions about stakeholder communication, client relationships, team interactions, escalation, or interpersonal scenarios. Focus exclusively on functional steps, technical rules, validation criteria, operational decisions, and system-specific actions described in the document.`;

  const processDeliveryDirective = processDelivery
    ? `\nPROCESS DELIVERY/MANAGEMENT — ENABLED: Where the document explicitly describes governance, SLA/KPI targets, reporting cycles, escalation frameworks, or operational management controls, you MAY generate questions testing those specific delivery mechanisms. Reference the document's exact SLA thresholds, KPI names, escalation paths, and reporting formats — no generic management questions.`
    : `\nPROCESS DELIVERY/MANAGEMENT — DISABLED: Do NOT generate any questions about process governance, SLA management, KPI tracking, reporting, escalation management, operational management, or delivery management unless these exact topics are the entire subject of the document. Focus on execution-level procedural knowledge: steps, rules, validations, and system actions.`;

  return `Generate exactly ${count} assessment questions derived EXCLUSIVELY from the source document below.

=== CONTEXT ===
Role: ${jobRole || 'Professional'}
Document: ${sourceName || 'Source Document'}
Document Type: ${docLabel}
Generation Seed: ${seed}${skillsLine}${stakeholderDirective}${processDeliveryDirective}

=== SOURCE DOCUMENT ===
${sourceText}
${buildAvoidSection(avoidQuestions)}
=== MANDATORY PRE-GENERATION STEPS ===

STEP 1 — READ THE DOCUMENT AND EXTRACT (do this before writing any question):
EXTRACT ONLY FROM: paragraphs, numbered/lettered steps, tables, decision criteria, examples, exception conditions, formulas, and definitions stated in the document body.
IGNORE COMPLETELY: document title, section headings used alone (only use their body content), author/reviewer names, version numbers, dates, page numbers, file name, confidentiality labels, copyright text, watermarks, and any metadata.
• Every specific procedure, step sequence, and workflow described in the body
• Every rule, threshold, condition, and validation criterion stated
• Every system, form, field, tool, code, or platform mentioned in the content
• Every exception case, error condition, or escalation path defined
• Every definition, formula, calculation method, or data validation rule provided
• Specific values, codes, percentages, timeframes, and thresholds found in the document
• Domain-specific terminology unique to this document

STEP 2 — PLAN ${count} DISTINCT TEST ITEMS (one per question slot):
Each item covers a DIFFERENT specific piece of content from Step 1.
CRITICAL: If the document does not explicitly cover a topic, do NOT generate questions about it.
• Easy (${easyCount}): Direct recall — a specific step, rule, definition, or fact stated verbatim in the document
• Medium (${mediumCount}): Application — apply a multi-step procedure or decision rule from the document
• Hard (${hardCount}): Exception handling — edge case, error condition, or complex judgment described in the document

STEP 3 — WRITE QUESTIONS FROM YOUR PLANNED ITEMS:
Question type cycle: ${types.join(', ')}
• MCQ: All 4 options grounded in the document — correct answer explicitly supported, distractors are plausible but incorrect interpretations of document content
• Fill-in-blank: The correct answer must be a specific term, value, or phrase from the document
• Subjective: The model answer must cite specific document content (step numbers, rule names, thresholds, field names, etc.)

STEP 4 — SELF-CHECK (reject and replace any question that fails):
✓ Every question uses at least one specific term, value, name, code, or step from the source document BODY (not the heading)
✓ Every question is answerable using ONLY information stated in the source document
✓ No question was generated from a heading, author name, version number, date, filename, page number, or metadata
✓ No question contains banned phrases unless quoted verbatim from document
✓ No question could be asked for ANY other role or company — it is specific to THIS document's exact content
✓ fill_blank answers are 2–5 words max (a specific term/value/code from the document)
✓ subjective answers are exactly 2–3 bullet points, each under 20 words
✓ Exactly ${count} questions (${easyCount} easy, ${mediumCount} medium, ${hardCount} hard)
✓ sourceSection field is filled with the actual section name or step identifier from the document
✓ sourceQuote is a real, verbatim excerpt from the document text above — copy it exactly, do not paraphrase

=== OUTPUT FORMAT — return only this JSON ===
{
  "questions": [
    {
      "type": "mcq|fill_blank|subjective",
      "question": "question text using document terminology",
      "difficulty": "easy|medium|hard",
      "options": ["A) ...", "B) ...", "C) ...", "D) ..."],
      "answer": "A/B/C/D for mcq | 2–5 word phrase/value from document for fill_blank | '• point1 | • point2 | • point3' (2–3 bullet points, each ≤20 words) for subjective",
      "explanation": "which specific section, step, or rule in the document this question tests",
      "skillArea": "specific procedure, system, rule, or concept from the document",
      "sourceSection": "exact section heading, step number, or paragraph identifier from the source document (e.g. 'Section 3.2', 'Step 4 — Payment Validation', 'Escalation Criteria')",
      "sourceQuote": "a short (5-25 word) excerpt copied VERBATIM, character-for-character, from the SOURCE DOCUMENT text above — the exact sentence or phrase this question is testing. Do not paraphrase, summarize, or invent it — if you cannot find real text to quote, do not generate the question."
    }
  ]
}`;
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
    while (typeSeq.length < count) typeSeq.push(['mcq', 'fill_blank', 'subjective'][typeSeq.length % 3]);
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
    };
  });
}

// HEADER_FOOTER_PATTERNS / PERSON_NAME_PATTERNS are declared above, next to
// extractDocEntities' looksLikeNoisePhrase, which reuses them.

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

    // Duplicate question text (>70% token overlap) — hard fail
    const tokens = new Set(normalize(q.question));
    for (let j = 0; j < seenText.length; j++) {
      const prev = seenText[j];
      const prevTokens = new Set(normalize(prev.text));
      const inter = [...tokens].filter(t => prevTokens.has(t)).length;
      const union = new Set([...tokens, ...prevTokens]).size;
      if (union > 0 && inter / union > 0.70) {
        hardFailures.push(`Duplicate question: [${i}] is >70% similar to [${j}]`);
        checks.duplicateQuestions.push([j, i]);
      }
    }
    seenText.push({ text: q.question, idx: i });

    // MCQ shape + duplicate options — hard fail
    if (q.type === 'mcq') {
      if (!Array.isArray(q.options) || q.options.length !== 4 || !/^[A-D]$/i.test(String(q.answer).trim())) {
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
function fillEmergencyGap(existing, num, { types, skillsList, jobRole }) {
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
      typeDeficit: {
        mcq: Math.max(0, Math.ceil(num * 0.50) - curMcq),
        fill_blank: Math.max(0, Math.round(num * 0.25) - curFill),
        subjective: Math.max(0, num - Math.ceil(num * 0.50) - Math.round(num * 0.25) - curSubj),
      },
    });
    combined = mergeFallbackUnique(combined, batch);
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

export async function generateQuestionsFromJD({ jobRole, jobDescription, jdSkills, questionCount, questionTypes, employeeSeed, supportingDocs, avoidQuestions = [], startingComboCounters = null, onProgress = null }) {
  const num = Math.min(Math.max(parseInt(questionCount) || 5, 2), 100);
  const emit = makeProgressEmitter(onProgress, num);
  const types = Array.isArray(questionTypes) && questionTypes.length > 0 ? questionTypes : ['mcq'];
  const baseSeed = employeeSeed || randomUUID().slice(0, 8);
  const jdText = (jobDescription || '').trim();
  const skillsList = Array.isArray(jdSkills) && jdSkills.length ? jdSkills : [];
  const system = buildSystemPrompt();

  // Build supporting docs text, then combine with the JD text.
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

  // Split the FULL combined source into chunks so every part of the JD and
  // every supporting doc contributes to generation, regardless of length —
  // mirrors generateQuestionsFromDocument's chunking exactly. The previous
  // version hard-truncated to FREE_TIER_SOURCE_CHAR_BUDGET (~1,500 tokens,
  // ~6,000 chars) with NO chunking: every one of the 5 retry attempts saw
  // the exact same first slice, so anything beyond roughly the first page
  // of a JD or any supporting doc was NEVER seen by the LLM — the direct,
  // confirmed cause of generated questions not matching the uploaded
  // JD/file for anything longer than a page or two.
  const CHUNK_SIZE = sourceCharBudget();
  const CHUNK_OVERLAP = 300;
  const chunks = [];
  if (combinedSource.length <= CHUNK_SIZE) {
    chunks.push(combinedSource);
  } else {
    let pos = 0;
    while (pos < combinedSource.length) {
      let end = Math.min(pos + CHUNK_SIZE, combinedSource.length);
      if (end < combinedSource.length) {
        const boundary = combinedSource.lastIndexOf('\n\n', end);
        if (boundary > pos + CHUNK_SIZE / 2) end = boundary;
      }
      chunks.push(combinedSource.slice(pos, end));
      if (end >= combinedSource.length) break;
      pos = Math.max(pos + 1, end - CHUNK_OVERLAP);
    }
    console.log(`[generateQuestionsFromJD] "${jobRole}": ${combinedSource.length} chars (JD + supporting docs) split into ${chunks.length} chunks for full coverage`);
  }

  const totalChunkLen = chunks.reduce((s, c) => s + c.length, 0);
  const chunkTargets  = chunks.map(c => Math.max(2, Math.ceil(num * (c.length / totalChunkLen) * 1.4)));

  let pool = [];
  const MAX_ATTEMPTS = chunks.length > 1 ? 3 : 5; // per chunk — fewer per-chunk retries when there are multiple chunks to cover, same total attempt budget as before for the single-chunk (short JD) case

  for (let ci = 0; ci < chunks.length; ci++) {
    if (pool.length >= num) break; // already have enough from earlier chunks
    const chunk = chunks[ci];
    const chunkTarget = chunkTargets[ci];
    const poolBeforeThisChunk = pool.length;
    const isLastChunk = ci === chunks.length - 1;
    // Cap what THIS chunk may contribute to its own proportional share,
    // unless it's the last chunk (which absorbs any shortfall so the exact
    // count is still guaranteed). Without this cap, an early chunk that
    // happens to produce more than enough content hogs the entire question
    // budget and later chunks — and everything they cover in the JD/uploaded
    // file — never get proportional representation, even though the
    // chunking loop technically "ran." This was silently defeating the
    // point of chunking for full-document coverage.
    const chunkCeiling = isLastChunk ? num : Math.min(num, poolBeforeThisChunk + chunkTarget);

    for (let attempt = 0; attempt < MAX_ATTEMPTS && pool.length < chunkCeiling; attempt++) {
      const stillNeeded = chunkCeiling - pool.length;
      // Escalating buffer: first attempt +40%, later attempts ask for progressively more
      // headroom since each additional attempt tends to yield a lower unique-acceptance rate.
      // Capped at FREE_TIER_MAX_QUESTIONS_PER_CALL (not 100) so a single
      // request's expected output stays small enough to fit the free-tier
      // per-request token budget alongside its proportional max_tokens.
      const bufferMultiplier = 1.4 + attempt * 0.3;
      const askFor = Math.min(maxQuestionsPerCall(), Math.max(stillNeeded, Math.ceil(stillNeeded * bufferMultiplier)));
      const seed = `${baseSeed}-c${ci}-a${attempt}-${randomUUID().slice(0, 6)}`;
      const prompt = buildUserPrompt({ count: askFor, jobRole, jdText: chunk, skillsList, types, seed, supportingDocsText: '', avoidQuestions });

      let batch = await GeminiService.generateQuestionsBatch(prompt, system, { maxTokens: outputTokensFor(askFor), onThrottle: emit.throttle });
      if (batch && batch.length > 0) {
        const noGeneric = filterGenericPhrasing(batch);
        const keywordPrefiltered = filterGrounded(noGeneric, chunk);
        const grounded = verifyQuoteGrounded(keywordPrefiltered, chunk);
        if (grounded.length < batch.length) {
          console.warn(`[generateQuestionsFromJD] chunk${ci} attempt${attempt}: filters removed ${batch.length - grounded.length}/${batch.length} generic/ungrounded/unquoted questions`);
        }
        pool = mergeUnique(pool, grounded, avoidQuestions);
      }
      emit.progress(pool.length);
    }
  }

  // Starting combo counters seed fallback padding's position in the
  // skill x template grid. Defaults to {0,0,0} for a fresh generation, but a
  // regenerate call passes in the previous version's finalComboCounters
  // (via withFinalCombo) so it starts from where the last version left off —
  // guaranteeing no (skill, template) pairing repeats until the grid is
  // actually exhausted, instead of every regenerate deterministically
  // reproducing the same fallback content from index 0.
  const comboCounters = startingComboCounters
    ? { ...startingComboCounters }
    : { easy: 0, medium: 0, hard: 0 };

  // Absolute last resort: deterministic template padding to guarantee the exact count.
  // Combos (skill x template, then skill-pair x template) are combinatorially large,
  // so a shared counter across rounds always finds fresh, non-duplicate content.
  if (pool.length < num) {
    const shortage = num - pool.length;
    console.warn(`[AssessmentGenerator] LLM produced only ${pool.length}/${num} unique questions after ${MAX_ATTEMPTS} attempts — padding ${shortage} with template questions.`);

    const targetEasy = Math.round(num * 0.35);
    const targetMedium = Math.round(num * 0.45);
    const targetHard = Math.max(1, num - targetEasy - targetMedium);
    const targetMcqCount  = Math.ceil(num * 0.50);
    const targetFillCount = Math.round(num * 0.25);
    const targetSubjCount = Math.max(0, num - targetMcqCount - targetFillCount);

    let attempt = 0;
    while (pool.length < num && attempt < 30) {
      const remaining = num - pool.length;
      // Recomputed every round (unlike a fixed deficit) so type balance
      // converges toward target even as padding rounds add content —
      // this is what fixes banks that ended up 80%+ mcq: the type mix
      // still needed is measured against what's ACTUALLY in the pool right
      // now, not a snapshot from before any padding was added.
      const curEasy   = pool.filter(q => (q.difficulty || 'medium') === 'easy').length;
      const curMedium = pool.filter(q => (q.difficulty || 'medium') === 'medium').length;
      const curHard   = pool.filter(q => (q.difficulty || 'medium') === 'hard').length;
      const curMcq  = pool.filter(q => !q.type || q.type === 'mcq').length;
      const curFill = pool.filter(q => q.type === 'fill_blank').length;
      const curSubj = pool.filter(q => q.type === 'subjective').length;
      const fallbackBatch = buildFallbackQuestions(remaining, {
        types,
        skillsList,
        jobRole,
        difficultyDeficit: {
          easy: Math.max(0, targetEasy - curEasy),
          medium: Math.max(0, targetMedium - curMedium),
          hard: Math.max(0, targetHard - curHard),
        },
        typeDeficit: {
          mcq: Math.max(0, targetMcqCount - curMcq),
          fill_blank: Math.max(0, targetFillCount - curFill),
          subjective: Math.max(0, targetSubjCount - curSubj),
        },
        comboCounters, // shared & mutated across rounds so no combo repeats
      });
      pool = mergeFallbackUnique(pool, fallbackBatch, avoidQuestions);
      attempt++;
    }
  }

  // Final trim to exact target
  const trimmed = trimToTarget(pool, num, types);
  const rebalanced = rebalanceDifficulty(trimmed);

  // Post-generation safety net: if count is still off (should never happen after the
  // fallback loop, but guard against any future edge case), force to exact count.
  const scoringSource = `${jdText}\n${supportingDocsText}`;

  if (rebalanced.length !== num) {
    console.warn(`[AssessmentGenerator] Post-rebalance count mismatch: ${rebalanced.length}/${num} — applying emergency fix`);
    if (rebalanced.length > num) {
      return withFinalCombo(attachQualityScores(rebalanced.slice(0, num), scoringSource), comboCounters);
    }
    // Still short — generate emergency fallback for the remaining gap.
    // Deliberately NOT seeded from avoidQuestions: this is the true
    // last-resort guarantee that the exact count is always met, and applying
    // cross-version rejection here risks that guarantee for roles with a
    // small skill pool (design review recommendation) — better a rare repeat
    // of a prior version's content than a broken count. It IS still
    // deduplicated against the current bank and against itself (fillEmergencyGap).
    const final = fillEmergencyGap(rebalanced, num, { types, skillsList, jobRole });
    return withFinalCombo(attachQualityScores(tagMetadata(final, { generatedFrom: 'jd' }), scoringSource), comboCounters);
  }

  return withFinalCombo(attachQualityScores(tagMetadata(rebalanced, { generatedFrom: 'jd' }), scoringSource), comboCounters);
}

// Stamps every question with the metadata fields required for provenance
// tracking (Issue 10): id, generatedFrom, stakeholder/processDelivery flags,
// createdAt. Stored on the question but never shown to employees — the
// employee-facing serializer in the assessment routes strips these before
// returning a question to the client.
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

// ── Document-focused question generation ─────────────────────────────────────
// Used by generateQuestionsFromFiles — generates questions grounded exclusively
// in the source document's content. Skills from the role are passed as context
// only (so the LLM understands the employee profile) but are NOT used as a
// question source. This prevents role skills from overriding document content.
async function generateQuestionsFromDocument(sourceText, { jobRole, sourceName, sourceType, questionCount, questionTypes, seed, skillsContext = [], stakeholder = false, processDelivery = false, avoidQuestions = [], startingComboCounters = null, onProgress = null } = {}) {
  const num   = Math.min(Math.max(parseInt(questionCount) || 5, 2), 100);
  const emit  = makeProgressEmitter(onProgress, num);
  const types = Array.isArray(questionTypes) && questionTypes.length > 0 ? questionTypes : ['mcq'];
  const baseSeed = seed || randomUUID().slice(0, 8);
  const text  = (sourceText || '').trim();
  if (!text) return [];

  const system = buildDocumentSystemPrompt();

  // Split document into chunks so ALL content contributes to question generation,
  // regardless of document size. FREE_TIER_SOURCE_CHAR_BUDGET (not the
  // context-window-sized 80,000 chars this used to be) keeps each chunk's
  // request comfortably under Groq's free-tier per-request token cap — see
  // the constant's comment near the top of this file. Chunks overlap to
  // avoid missing content at section boundaries.
  const CHUNK_SIZE = sourceCharBudget();
  const CHUNK_OVERLAP = 300;
  const chunks = [];
  if (text.length <= CHUNK_SIZE) {
    chunks.push(text);
  } else {
    let pos = 0;
    while (pos < text.length) {
      // Prefer to break at a paragraph boundary near the chunk end
      let end = Math.min(pos + CHUNK_SIZE, text.length);
      if (end < text.length) {
        const boundary = text.lastIndexOf('\n\n', end);
        if (boundary > pos + CHUNK_SIZE / 2) end = boundary;
      }
      chunks.push(text.slice(pos, end));
      if (end >= text.length) break;
      pos = Math.max(pos + 1, end - CHUNK_OVERLAP);
    }
    console.log(`[generateQuestionsFromDocument] "${sourceName}": ${text.length} chars split into ${chunks.length} chunks for full-document coverage`);
  }

  // Per-chunk: how many questions to aim for before moving to the next chunk.
  // Proportional to chunk share of total text length, with a 1.4x buffer for dedup.
  const totalChunkLen = chunks.reduce((s, c) => s + c.length, 0);
  const chunkTargets  = chunks.map(c => Math.max(2, Math.ceil(num * (c.length / totalChunkLen) * 1.4)));

  let pool = [];
  const MAX_ATTEMPTS = 4; // per chunk

  for (let ci = 0; ci < chunks.length; ci++) {
    if (pool.length >= num) break; // already have enough from earlier chunks
    const chunk    = chunks[ci];
    const chunkTarget = chunkTargets[ci];
    const poolBeforeThisChunk = pool.length;
    const isLastChunk = ci === chunks.length - 1;
    // Cap this chunk's contribution to its own proportional share (see
    // generateQuestionsFromJD for the full explanation) — without this, an
    // early chunk that happens to produce enough content on its own hogs the
    // entire question budget and later parts of the uploaded document never
    // get proportional representation, even though chunking technically ran.
    const chunkCeiling = isLastChunk ? num : Math.min(num, poolBeforeThisChunk + chunkTarget);

    for (let attempt = 0; attempt < MAX_ATTEMPTS && pool.length < chunkCeiling; attempt++) {
      const stillNeeded = chunkCeiling - pool.length;
      const bufferMultiplier = 1.4 + attempt * 0.3;
      const askFor = Math.min(maxQuestionsPerCall(), Math.max(1, Math.ceil(stillNeeded * bufferMultiplier)));
      const attemptSeed = `${baseSeed}-c${ci}-a${attempt}-${randomUUID().slice(0, 4)}`;
      const prompt = buildDocumentUserPrompt({
        count: askFor, jobRole, sourceText: chunk, sourceName, sourceType, types, seed: attemptSeed, skillsContext, stakeholder, processDelivery, avoidQuestions,
      });

      let batch = await GeminiService.generateQuestionsBatch(prompt, system, { maxTokens: outputTokensFor(askFor), onThrottle: emit.throttle });
      if (batch && batch.length > 0) {
        const noGeneric = filterGenericPhrasing(batch);
        const keywordPrefiltered = filterGrounded(noGeneric, chunk);
        const grounded = verifyQuoteGrounded(keywordPrefiltered, chunk);
        if (grounded.length < batch.length) {
          console.warn(`[generateQuestionsFromDocument] "${sourceName}" chunk${ci} attempt${attempt}: filters removed ${batch.length - grounded.length}/${batch.length} generic/ungrounded/unquoted questions`);
        }
        pool = mergeUnique(pool, grounded, avoidQuestions);
      }
      emit.progress(pool.length);
    }
  }

  // See generateQuestionsFromJD for why this is seeded from the previous
  // version instead of always starting at {0,0,0}.
  const comboCounters = startingComboCounters
    ? { ...startingComboCounters }
    : { easy: 0, medium: 0, hard: 0 };

  if (pool.length < num) {
    const shortage = num - pool.length;
    console.warn(`[generateQuestionsFromDocument] "${sourceName}": LLM gave ${pool.length}/${num} across all chunks — padding ${shortage} with doc-keyword templates`);
    // Prefer real named entities (systems, forms, thresholds — e.g. "Payment
    // Gateway", "48 hours") over generic frequent words when available; they
    // make fallback template questions read as genuinely document-specific
    // rather than just topically-adjacent.
    const docEntities = extractDocEntities(text, 8);
    const docKeywords = extractDocKeywords(text, 8);
    const fallbackSkills = docEntities.length > 0 ? docEntities : (docKeywords.length > 0 ? docKeywords : [SAFE_FALLBACK_TOPIC]);
    const targetEasy   = Math.round(num * 0.35);
    const targetMedium = Math.round(num * 0.45);
    const targetHard   = Math.max(1, num - targetEasy - targetMedium);
    const targetMcqCount  = Math.ceil(num * 0.50);
    const targetFillCount = Math.round(num * 0.25);
    const targetSubjCount = Math.max(0, num - targetMcqCount - targetFillCount);
    let att = 0;
    while (pool.length < num && att < 30) {
      const remaining = num - pool.length;
      const fb = buildFallbackQuestions(remaining, {
        types, skillsList: fallbackSkills, jobRole,
        difficultyDeficit: {
          easy:   Math.max(0, targetEasy   - pool.filter(q => q.difficulty === 'easy').length),
          medium: Math.max(0, targetMedium - pool.filter(q => q.difficulty === 'medium').length),
          hard:   Math.max(0, targetHard   - pool.filter(q => q.difficulty === 'hard').length),
        },
        typeDeficit: {
          mcq:        Math.max(0, targetMcqCount  - pool.filter(q => !q.type || q.type === 'mcq').length),
          fill_blank: Math.max(0, targetFillCount - pool.filter(q => q.type === 'fill_blank').length),
          subjective: Math.max(0, targetSubjCount - pool.filter(q => q.type === 'subjective').length),
        },
        comboCounters,
      });
      pool = mergeFallbackUnique(pool, fb, avoidQuestions);
      att++;
    }
  }

  const trimmed   = trimToTarget(pool, num, types);
  const rebalanced = rebalanceDifficulty(trimmed);

  const meta = { generatedFrom: sourceType === 'jd' ? 'jd' : 'document', stakeholderFlag: stakeholder, processDeliveryFlag: processDelivery };

  if (rebalanced.length !== num) {
    if (rebalanced.length > num) return withFinalCombo(attachQualityScores(rebalanced.slice(0, num), sourceText), comboCounters);
    // True last-resort guarantee — not seeded from avoidQuestions, same
    // reasoning as generateQuestionsFromJD's emergency path. Deduplicated
    // against the current bank and against itself via fillEmergencyGap.
    const final = fillEmergencyGap(rebalanced, num, { types, skillsList: [SAFE_FALLBACK_TOPIC], jobRole });
    return withFinalCombo(attachQualityScores(tagMetadata(final, meta), sourceText), comboCounters);
  }
  return withFinalCombo(attachQualityScores(tagMetadata(rebalanced, meta), sourceText), comboCounters);
}

// ── Per-file multi-source generation ─────────────────────────────────────────
// Generates exactly the requested number of questions from EACH source file
// independently, tags every question with sourceFile + sourceType, then merges
// with cross-file deduplication. The result length equals the sum of all
// per-file questionCount values.

function buildTypeSeqLocal(num) {
  const m = Math.ceil(num * 0.50);
  const f = Math.round(num * 0.25);
  return [...Array(m).fill('mcq'), ...Array(Math.max(0, f)).fill('fill_blank'), ...Array(Math.max(0, num - m - f)).fill('subjective')];
}

// When a single uploaded file mixes JD-like content and process/SOP-like
// content (common for "one PDF has everything" uploads), splits it into two
// effective sources with proportionally-split question counts, instead of
// generating the whole file as one undifferentiated blob under a single
// sourceType. A file that doesn't meaningfully split (the normal case — a
// single-purpose JD or a single-purpose SOP) passes through unchanged.
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
  } = globalContext;
  fileSources = expandSplitSources(fileSources);
  // Aggregate progress across ALL sources: each per-source call reports its
  // own 0..N, so translate that into overall done/total for the caller.
  const overallTotal = fileSources.reduce((s, f) => s + Math.min(100, Math.max(1, parseInt(f.questionCount) || 5)), 0);
  let completedBeforeSource = 0;
  const emitOverall = (evt) => {
    if (typeof onProgress !== 'function') return;
    try {
      onProgress({
        phase: evt?.phase || 'generating',
        done: Math.min(overallTotal, completedBeforeSource + (evt?.done || 0)),
        total: overallTotal,
        delayMs: evt?.delayMs,
      });
    } catch { /* progress hook must never break generation */ }
  };
  const allQuestions = [];
  // Shared fuzzy tracker across ALL files (upgraded from exact-text-only
  // matching) — two different uploaded documents that thematically overlap
  // (e.g. an Order Processing SOP and an Escalation Handling guide that both
  // mention "vendor coordination") can produce genuinely near-duplicate
  // questions across files even though neither file duplicates itself.
  // Exact-text matching never caught this; the same 70%-overlap standard
  // used everywhere else in this file now applies here too. Pre-seeded with
  // avoidQuestions so cross-version diversity is enforced at this level too,
  // not just inside each per-source generateQuestionsFromDocument call.
  const tracker = createSeenTracker(avoidQuestions);
  const finalComboCountersBySource = {};

  for (const [sourceIdx, source] of fileSources.entries()) {
    const text = (source.text || '').trim();
    const count = Math.min(100, Math.max(1, parseInt(source.questionCount) || 5));
    if (!text) continue;

    const srcJobRole = source.jobRole || jobRole;
    const srcSkills  = source.skills  || skills;
    const srcSeed    = `${baseSeed || 'fs'}-${(source.name || 'file').replace(/\W/g, '').slice(0, 20)}-${Date.now()}`;

    // Generate exactly `count` unique questions from this source file.
    // Uses generateQuestionsFromDocument (not generateQuestionsFromJD) so the
    // prompt is framed around document content, not JD roles/responsibilities.
    // srcSkills is passed as context-only — it does not drive question topics.
    const batch = await generateQuestionsFromDocument(text, {
      jobRole:         srcJobRole,
      sourceName:      source.name,
      sourceType:      source.sourceType || 'supporting',
      questionCount:   count,
      questionTypes:   buildTypeSeqLocal(count),
      seed:            srcSeed,
      skillsContext:   srcSkills,
      stakeholder:     !!source.stakeholder,
      processDelivery: !!source.processDelivery,
      avoidQuestions,
      startingComboCounters: startingComboCountersBySource[source.name] || null,
      onProgress: emitOverall,
    });
    if (batch?.finalComboCounters) finalComboCountersBySource[source.name] = batch.finalComboCounters;

    // Accept non-duplicates up to `count` — tracked in a per-source array
    // (not just a count) so the padding step below can measure the actual
    // type mix already accepted for THIS source, not just how many are short.
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

    // Pad with fallback templates if the LLM came up short after cross-file dedup.
    // RC-2 fix: use document keywords (not role skills) so fallback content stays
    // grounded in this document's vocabulary rather than generic corporate terms.
    //
    // This is a bounded LOOP with a per-source starting combo offset and a
    // forced final top-up — a single non-looping attempt here was a real bug:
    // if two files happen to extract overlapping keywords (common — e.g. two
    // SOPs both mentioning "escalation" and "vendor coordination"), they
    // previously started padding from the SAME flat {99999,99999,99999}
    // combo counters, producing byte-IDENTICAL fallback questions across
    // files. Those then collided in the shared cross-file `seenKeys` set and
    // were silently dropped with no retry — causing the whole bank to come
    // up short of the requested total (observed: 40/50, then 25/50 on a
    // second regenerate). The per-source hash offset below prevents two
    // files from ever starting at the same combo point, and the loop +
    // forced top-up guarantees this source's slice always reaches `count`.
    const gap = count - acceptedForSource.length;
    if (gap > 0) {
      console.warn(`[generateQuestionsFromFiles] "${source.name}": got ${acceptedForSource.length}/${count} after cross-file dedup — padding ${gap} with doc-keyword templates`);
      const docEntitiesForPad = extractDocEntities(text, 12);
      const docKeywordsForPad = extractDocKeywords(text, 12);
      const paddingSkills = docEntitiesForPad.length > 0
        ? docEntitiesForPad
        : docKeywordsForPad.length > 0
          ? docKeywordsForPad
          : (srcSkills.length > 0 ? srcSkills : [SAFE_FALLBACK_TOPIC]);
      const targetMcqCount  = Math.ceil(count * 0.50);
      const targetFillCount = Math.round(count * 0.25);
      const targetSubjCount = Math.max(0, count - targetMcqCount - targetFillCount);

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
          // Deficit measured against THIS source's own target count and what's
          // actually accepted for it — not a fresh 50/25/25 split of just the
          // gap, which was the root cause of banks skewing 80%+ toward mcq.
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
      // shortfall without dedup — count must never come up short, same
      // philosophy as fillEmergencyGap.
      if (acceptedForSource.length < count) {
        const stillNeeded = count - acceptedForSource.length;
        const forced = buildFallbackQuestions(stillNeeded, {
          types: buildTypeSeqLocal(stillNeeded), skillsList: paddingSkills, jobRole: srcJobRole, comboCounters: padComboCounters,
        });
        for (const q of forced) {
          const tagged = { ...q, id: q.id || randomUUID(), sourceFile: source.name || 'Unknown', sourceType: source.sourceType || 'jd', qualityScore: computeQuestionQualityScore(q, text) };
          tracker.add(tagged); // still recorded so later sources avoid repeating it, even though it wasn't itself checked
          allQuestions.push(tagged);
          acceptedForSource.push(tagged);
        }
      }
    }

    // Roll the aggregate progress baseline forward so the next source's
    // 0..N reporting continues from here rather than restarting at 0.
    completedBeforeSource = allQuestions.length;
    emitOverall({ phase: 'generating', done: 0 });
  }

  // Per-source combo high-water-marks — the next regenerate call reads this
  // back and passes it as startingComboCountersBySource so each file's
  // fallback padding continues from where it left off, not from index 0.
  allQuestions.finalComboCounters = finalComboCountersBySource;
  return allQuestions;
}
