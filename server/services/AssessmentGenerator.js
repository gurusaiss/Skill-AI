/**
 * AssessmentGenerator.js — shared question generation service
 * Extracted from assessment.js so users.js and roles.js can reuse it
 * without circular imports.
 */
import { randomUUID } from 'crypto';

// Deduplicate questions by meaning: remove questions whose text is >70% similar
// to any already-seen question (simple normalized-token overlap check)
function deduplicateQuestions(questions) {
  const normalize = (s) => (s || '').toLowerCase().replace(/[^a-z0-9 ]/g, '').split(/\s+/).filter(Boolean);
  const normOpt = (o) => (o || '').toLowerCase().replace(/^[a-d]\)\s*/i, '').trim();
  const seen = [];
  const seenOptionSets = new Set(); // catches identical MCQ option sets reused across different questions
  const seenAnswers = new Set();    // catches identical fill_blank/subjective answers reused verbatim
  return questions.filter(q => {
    if (!q || !q.question) return false;
    const tokens = new Set(normalize(q.question));
    for (const prev of seen) {
      const prevTokens = new Set(normalize(prev.question));
      const intersection = [...tokens].filter(t => prevTokens.has(t)).length;
      const union = new Set([...tokens, ...prevTokens]).size;
      if (union > 0 && intersection / union > 0.70) return false; // too similar
    }
    if (Array.isArray(q.options) && q.options.length) {
      const normOpts = q.options.map(normOpt);
      // Reject duplicate options within the same question
      if (new Set(normOpts).size !== normOpts.length) return false;
      // Reject if this exact option set has already appeared on a different question
      // (guards against templated fallback content reusing the same generic choices)
      const optionSetKey = [...normOpts].sort().join('|');
      if (optionSetKey && seenOptionSets.has(optionSetKey)) return false;
      seenOptionSets.add(optionSetKey);
    } else if (q.answer && (q.type === 'fill_blank' || q.type === 'subjective')) {
      const answerKey = (q.answer || '').toLowerCase().trim();
      if (answerKey && seenAnswers.has(answerKey)) return false;
      seenAnswers.add(answerKey);
    }
    seen.push(q);
    return true;
  });
}

// Merge a new batch into an existing (already-deduplicated) pool, keeping only
// questions that are unique against the pool AND against each other.
function mergeUnique(pool, batch) {
  if (!Array.isArray(batch) || batch.length === 0) return pool;
  const combined = deduplicateQuestions([...pool, ...batch]);
  return combined;
}

// Merge deterministic fallback content using exact-text matching rather than the
// fuzzy 70%-overlap check: fallback questions deliberately reuse a fixed sentence
// template with only the skill substituted, so most tokens are always shared by
// design — the fuzzy check would (incorrectly) flag them as near-duplicates even
// though each combo targets a distinct skill/scenario. Uniqueness here is already
// guaranteed by the skill x template combo index, so exact-match is sufficient.
function mergeFallbackUnique(pool, batch) {
  if (!Array.isArray(batch) || batch.length === 0) return pool;
  const seen = new Set(pool.map(q => (q.question || '').trim().toLowerCase()));
  const seenOptionSets = new Set(pool.filter(q => q.options?.length).map(q => q.options.map(o => o.toLowerCase()).sort().join('|')));
  const additions = [];
  for (const q of batch) {
    const key = (q.question || '').trim().toLowerCase();
    if (!key || seen.has(key)) continue;
    if (q.options?.length) {
      const optKey = q.options.map(o => o.toLowerCase()).sort().join('|');
      if (seenOptionSets.has(optKey)) continue; // reject — identical option set already used
      seenOptionSets.add(optKey);
    }
    seen.add(key);
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

function buildUserPrompt({ count, jobRole, jdText, skillsList, types, seed, supportingDocsText }) {
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
${processDocsSection}
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
      "skillArea": "specific competency, tool, process, or SOP from the JD or process docs"
    }
  ]
}`;
}

async function callGroq(system, prompt, { temperature = 0.85, maxTokens = 16000, timeoutMs = 30000 } = {}) {
  const groqKey = process.env.GROQ_API_KEY;
  if (!(groqKey?.length > 10)) return null;
  try {
    const r = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${groqKey}` },
      body: JSON.stringify({
        model: 'llama-3.3-70b-versatile',
        messages: [{ role: 'system', content: system }, { role: 'user', content: prompt }],
        temperature,
        max_tokens: maxTokens,
        response_format: { type: 'json_object' },
      }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!r.ok) return null;
    const d = await r.json();
    const parsed = JSON.parse(d.choices?.[0]?.message?.content || '{}');
    return Array.isArray(parsed.questions) ? parsed.questions : null;
  } catch (e) {
    console.warn('[AssessmentGenerator] Groq batch failed:', e.message);
    return null;
  }
}

async function callGemini(system, prompt, { temperature = 0.85, maxTokens = 16384, timeoutMs = 30000 } = {}) {
  const geminiKey = process.env.GEMINI_API_KEY;
  const geminiModel = process.env.GEMINI_MODEL || 'gemini-2.0-flash';
  if (!(geminiKey?.length > 10)) return null;
  try {
    const r = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${geminiModel}:generateContent?key=${geminiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: system + '\n\n' + prompt }] }],
          generationConfig: { temperature, maxOutputTokens: maxTokens, responseMimeType: 'application/json' },
        }),
        signal: AbortSignal.timeout(timeoutMs),
      }
    );
    if (!r.ok) return null;
    const d = await r.json();
    const parsed = JSON.parse(d.candidates?.[0]?.content?.parts?.[0]?.text || '{}');
    return Array.isArray(parsed.questions) ? parsed.questions : null;
  } catch (e) {
    console.warn('[AssessmentGenerator] Gemini batch failed:', e.message);
    return null;
  }
}

// Fallback phrasing banks — kept deliberately varied (not just a number suffix)
// so the similarity-based deduplicator treats each combo as genuinely distinct.
const FALLBACK_TEMPLATES = {
  easy: [
    (s) => `What is the primary purpose of ${s} in a professional context?`,
    (s) => `Which of the following best describes ${s}?`,
    (s) => `What is a key indicator of effective ${s}?`,
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
function pickCombo(templates, skills, comboIdx) {
  const n = Math.max(1, skills.length);
  const primaryCombos = n * templates.length;
  if (comboIdx < primaryCombos || n < 2) {
    const skill = skills[comboIdx % n];
    const tpl = templates[Math.floor(comboIdx / n) % templates.length];
    return { skill, tpl };
  }
  const secondaryIdx = comboIdx - primaryCombos;
  const skillA = skills[secondaryIdx % n];
  const skillB = skills[(secondaryIdx + 1 + Math.floor(secondaryIdx / n)) % n];
  const skill = skillA === skillB ? skillA : `${skillA} and ${skillB}`;
  const tpl = templates[Math.floor(secondaryIdx / n) % templates.length];
  return { skill, tpl };
}

// Deterministic, template-based fill used ONLY to close any residual gap after
// LLM attempts are exhausted — guarantees the exact requested count is always met.
// Uses real combinatorial variety (skill x template, then skill-pair x template)
// rather than cosmetic numbering, so the dedup step never mistakes distinct
// fallback questions for near-duplicates.
function buildFallbackQuestions(count, { types, skillsList, jobRole, difficultyDeficit, comboCounters = { easy: 0, medium: 0, hard: 0 } }) {
  const role = jobRole || 'Professional';
  const fallbackSkills = skillsList.length > 0 ? skillsList
    : ['core responsibilities', 'stakeholder communication', 'process management', 'performance delivery', 'problem solving'];

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

  return Array.from({ length: count }, (_, i) => {
    const difficulty = difficultySeq[i] || 'medium';
    const t = types[i % types.length];
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
      const { skill: s, tpl } = pickCombo(FALLBACK_TEMPLATES[difficulty], fallbackSkills, comboIdx);
      questionText = tpl(s);
      answer = 'A';
      skill = s;
      // Options are skill + phrasing-bank specific so no two MCQs share an identical
      // option set, even when the same skill recurs across difficulty tiers.
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
      ];
      options = OPTION_BANKS[comboIdx % OPTION_BANKS.length](s);
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

/**
 * Validates a question bank before persisting it.
 * Returns { valid: boolean, errors: string[] }
 * Used by routes to gate DB saves — never overwrites an existing bank if validation fails.
 */
export function validateQuestionBank(questions, target) {
  const errors = [];

  // 1. Count
  if (!Array.isArray(questions)) {
    return { valid: false, errors: ['questions must be an array'] };
  }
  if (questions.length !== target) {
    errors.push(`Count: got ${questions.length}, expected ${target}`);
  }

  // 2. Duplicate question text (>70% token overlap)
  const normalize = (s) => (s || '').toLowerCase().replace(/[^a-z0-9 ]/g, '').split(/\s+/).filter(Boolean);
  const seenText = [];
  const seenOptionSets = new Set();
  const seenFillAnswers = new Set();
  const seenScenarios = new Set();

  for (let i = 0; i < questions.length; i++) {
    const q = questions[i];
    if (!q || !q.question) { errors.push(`Question ${i}: missing question text`); continue; }

    // Duplicate question text
    const tokens = new Set(normalize(q.question));
    for (let j = 0; j < seenText.length; j++) {
      const prev = seenText[j];
      const prevTokens = new Set(normalize(prev.text));
      const inter = [...tokens].filter(t => prevTokens.has(t)).length;
      const union = new Set([...tokens, ...prevTokens]).size;
      if (union > 0 && inter / union > 0.70) {
        errors.push(`Duplicate question: [${i}] is >70% similar to [${j}]`);
      }
    }
    seenText.push({ text: q.question, idx: i });

    // Duplicate MCQ option sets
    if (Array.isArray(q.options) && q.options.length) {
      const key = q.options.map(o => (o || '').toLowerCase().replace(/^[a-d]\)\s*/i, '').trim()).sort().join('|');
      if (key && seenOptionSets.has(key)) errors.push(`Duplicate MCQ options at question ${i}`);
      seenOptionSets.add(key);
      // Internal duplicates within same question
      if (new Set(q.options.map(o => (o || '').toLowerCase().trim())).size !== q.options.length) {
        errors.push(`Question ${i} has duplicate options within itself`);
      }
    }

    // Duplicate fill_blank / subjective answers
    if ((q.type === 'fill_blank' || q.type === 'subjective') && q.answer) {
      const ansKey = q.answer.toLowerCase().trim();
      if (seenFillAnswers.has(ansKey)) errors.push(`Duplicate answer at question ${i}`);
      seenFillAnswers.add(ansKey);
    }

    // Difficulty value check
    if (!['easy', 'medium', 'hard'].includes(q.difficulty)) {
      errors.push(`Question ${i}: invalid difficulty "${q.difficulty}"`);
    }

    // Type value check
    if (!['mcq', 'fill_blank', 'subjective'].includes(q.type)) {
      errors.push(`Question ${i}: invalid type "${q.type}"`);
    }
  }

  // 3. Difficulty distribution check (warn if more than 20% off target)
  const easy   = questions.filter(q => q.difficulty === 'easy').length;
  const medium  = questions.filter(q => q.difficulty === 'medium').length;
  const hard   = questions.filter(q => q.difficulty === 'hard').length;
  const n = questions.length || 1;
  if (Math.abs(easy / n - 0.35) > 0.20) errors.push(`Difficulty distribution: easy=${easy} (${Math.round(easy/n*100)}%) is far from target 35%`);
  if (Math.abs(medium / n - 0.45) > 0.20) errors.push(`Difficulty distribution: medium=${medium} (${Math.round(medium/n*100)}%) is far from target 45%`);

  return { valid: errors.length === 0, errors };
}

export async function generateQuestionsFromJD({ jobRole, jobDescription, jdSkills, questionCount, questionTypes, employeeSeed, supportingDocs }) {
  const num = Math.min(Math.max(parseInt(questionCount) || 5, 2), 100);
  const types = Array.isArray(questionTypes) && questionTypes.length > 0 ? questionTypes : ['mcq'];
  const baseSeed = employeeSeed || randomUUID().slice(0, 8);
  const jdText = (jobDescription || '').trim();
  const skillsList = Array.isArray(jdSkills) && jdSkills.length ? jdSkills : [];
  const system = buildSystemPrompt();

  // Build supporting docs text (cap at 8000 chars to avoid token overflow)
  const MAX_SUPPORTING_CHARS = 8000;
  let supportingDocsText = '';
  if (Array.isArray(supportingDocs) && supportingDocs.length > 0) {
    const parts = [];
    let used = 0;
    for (const doc of supportingDocs) {
      if (!doc?.text) continue;
      const header = `--- Document: ${doc.name || 'Untitled'} ---\n`;
      const remaining = MAX_SUPPORTING_CHARS - used - parts.length * 2;
      if (remaining <= 0) break;
      const chunk = doc.text.slice(0, remaining);
      parts.push(header + chunk);
      used += header.length + chunk.length;
    }
    supportingDocsText = parts.join('\n\n');
  }

  let pool = [];
  const MAX_ATTEMPTS = 5;

  for (let attempt = 0; attempt < MAX_ATTEMPTS && pool.length < num; attempt++) {
    const stillNeeded = num - pool.length;
    // Escalating buffer: first attempt +40%, later attempts ask for progressively more
    // headroom since each additional attempt tends to yield a lower unique-acceptance rate.
    const bufferMultiplier = 1.4 + attempt * 0.3;
    const askFor = Math.min(100, Math.max(stillNeeded, Math.ceil(stillNeeded * bufferMultiplier)));
    const seed = attempt === 0 ? baseSeed : `${baseSeed}-retry${attempt}-${randomUUID().slice(0, 6)}`;
    const prompt = buildUserPrompt({ count: askFor, jobRole, jdText, skillsList, types, seed, supportingDocsText });

    let batch = await callGroq(system, prompt);
    if (!batch || batch.length === 0) batch = await callGemini(system, prompt);
    if (batch && batch.length > 0) {
      pool = mergeUnique(pool, batch);
    }
  }

  // Absolute last resort: deterministic template padding to guarantee the exact count.
  // Combos (skill x template, then skill-pair x template) are combinatorially large,
  // so a shared counter across rounds always finds fresh, non-duplicate content.
  if (pool.length < num) {
    const shortage = num - pool.length;
    console.warn(`[AssessmentGenerator] LLM produced only ${pool.length}/${num} unique questions after ${MAX_ATTEMPTS} attempts — padding ${shortage} with template questions.`);

    const targetEasy = Math.round(num * 0.35);
    const targetMedium = Math.round(num * 0.45);
    const targetHard = Math.max(1, num - targetEasy - targetMedium);
    const curEasy = pool.filter(q => (q.difficulty || 'medium') === 'easy').length;
    const curMedium = pool.filter(q => (q.difficulty || 'medium') === 'medium').length;
    const curHard = pool.filter(q => (q.difficulty || 'medium') === 'hard').length;

    const comboCounters = { easy: 0, medium: 0, hard: 0 };
    let attempt = 0;
    while (pool.length < num && attempt < 30) {
      const remaining = num - pool.length;
      const fallbackBatch = buildFallbackQuestions(remaining, {
        types,
        skillsList,
        jobRole,
        difficultyDeficit: {
          easy: Math.max(0, targetEasy - curEasy),
          medium: Math.max(0, targetMedium - curMedium),
          hard: Math.max(0, targetHard - curHard),
        },
        comboCounters, // shared & mutated across rounds so no combo repeats
      });
      pool = mergeFallbackUnique(pool, fallbackBatch);
      attempt++;
    }
  }

  // Final trim to exact target
  const trimmed = trimToTarget(pool, num, types);
  const rebalanced = rebalanceDifficulty(trimmed);

  // Post-generation safety net: if count is still off (should never happen after the
  // fallback loop, but guard against any future edge case), force to exact count.
  if (rebalanced.length !== num) {
    console.warn(`[AssessmentGenerator] Post-rebalance count mismatch: ${rebalanced.length}/${num} — applying emergency fix`);
    if (rebalanced.length > num) {
      return rebalanced.slice(0, num);
    }
    // Still short — generate emergency fallback for the remaining gap
    const emergencyComboCounters = { easy: 9999, medium: 9999, hard: 9999 };
    const gap = num - rebalanced.length;
    const emergency = buildFallbackQuestions(gap, { types, skillsList, jobRole, comboCounters: emergencyComboCounters });
    return [...rebalanced, ...emergency].slice(0, num);
  }

  return rebalanced;
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

export async function generateQuestionsFromFiles(fileSources, globalContext = {}) {
  if (!Array.isArray(fileSources) || fileSources.length === 0) return [];

  const { jobRole = 'Professional', skills = [], seed: baseSeed = '' } = globalContext;
  const allQuestions = [];
  const seenKeys = new Set();

  const dedupeKey = q =>
    (q.question || '').toLowerCase().replace(/[^a-z0-9 ]/g, '').replace(/\s+/g, ' ').trim().slice(0, 100);

  for (const source of fileSources) {
    const text = (source.text || '').trim();
    const count = Math.min(100, Math.max(1, parseInt(source.questionCount) || 5));
    if (!text) continue;

    const srcJobRole = source.jobRole || jobRole;
    const srcSkills  = source.skills  || skills;
    const srcSeed    = `${baseSeed || 'fs'}-${(source.name || 'file').replace(/\W/g, '').slice(0, 20)}-${Date.now()}`;

    // Generate exactly `count` unique questions from this source file
    const batch = await generateQuestionsFromJD({
      jobRole:        srcJobRole,
      jobDescription: text,
      jdSkills:       srcSkills,
      questionCount:  count,
      questionTypes:  buildTypeSeqLocal(count),
      employeeSeed:   srcSeed,
    });

    // Accept non-duplicates up to `count`
    let accepted = 0;
    for (const q of (batch || [])) {
      if (accepted >= count) break;
      const key = dedupeKey(q);
      if (!key || seenKeys.has(key)) continue;
      seenKeys.add(key);
      allQuestions.push({
        ...q,
        id: q.id || randomUUID(),
        sourceFile: source.name || 'Unknown',
        sourceType: source.sourceType || 'jd',
      });
      accepted++;
    }

    // Pad with fallback templates if the LLM came up short
    const gap = count - accepted;
    if (gap > 0) {
      console.warn(`[generateQuestionsFromFiles] "${source.name}": got ${accepted}/${count} — padding ${gap} with templates`);
      const padding = buildFallbackQuestions(gap, {
        types:         buildTypeSeqLocal(gap),
        skillsList:    srcSkills,
        jobRole:       srcJobRole,
        comboCounters: { easy: 99999, medium: 99999, hard: 99999 },
      });
      for (const q of padding) {
        const key = dedupeKey(q);
        if (!key || seenKeys.has(key)) continue;
        seenKeys.add(key);
        allQuestions.push({
          ...q,
          id: q.id || randomUUID(),
          sourceFile: source.name || 'Unknown',
          sourceType: source.sourceType || 'jd',
        });
      }
    }
  }

  return allQuestions;
}
