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
  const seen = [];
  return questions.filter(q => {
    if (!q || !q.question) return false;
    const tokens = new Set(normalize(q.question));
    for (const prev of seen) {
      const prevTokens = new Set(normalize(prev.question));
      const intersection = [...tokens].filter(t => prevTokens.has(t)).length;
      const union = new Set([...tokens, ...prevTokens]).size;
      if (union > 0 && intersection / union > 0.70) return false; // too similar
    }
    // Reject duplicate options within the same question
    if (Array.isArray(q.options) && q.options.length) {
      const normOpts = q.options.map(o => (o || '').toLowerCase().replace(/^[a-d]\)\s*/i, '').trim());
      if (new Set(normOpts).size !== normOpts.length) return false;
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
  const additions = [];
  for (const q of batch) {
    const key = (q.question || '').trim().toLowerCase();
    if (key && !seen.has(key)) {
      seen.add(key);
      additions.push(q);
    }
  }
  return [...pool, ...additions];
}

// Re-balance difficulty to ~35% easy, ~45% medium, ~20% hard
function rebalanceDifficulty(questions) {
  const n = questions.length;
  const targets = {
    easy:   Math.round(n * 0.35),
    medium: Math.round(n * 0.45),
    hard:   Math.max(1, n - Math.round(n * 0.35) - Math.round(n * 0.45)),
  };
  const buckets = { easy: [], medium: [], hard: [] };
  for (const q of questions) {
    const d = q.difficulty || 'medium';
    buckets[d] = buckets[d] || [];
    buckets[d].push(q);
  }
  const result = [];
  for (const [diff, target] of Object.entries(targets)) {
    const bucket = buckets[diff] || [];
    result.push(...bucket.slice(0, target));
    // borrow from other buckets if short
    if (bucket.length < target) {
      const shortage = target - bucket.length;
      const donors = Object.entries(buckets).filter(([d]) => d !== diff);
      for (let i = 0; i < shortage; i++) {
        for (const [donorDiff, donorBucket] of donors) {
          if (donorBucket.length > targets[donorDiff]) {
            const borrowed = donorBucket.pop();
            if (borrowed) result.push({ ...borrowed, difficulty: diff });
            break;
          }
        }
      }
    }
  }
  // Shuffle so difficulties are interleaved, not grouped
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

// Trim a processed question list down to exactly `target`, preserving type ratios
function trimToTarget(questions, target, types) {
  if (questions.length <= target) return questions;
  const typeCounts = {};
  types.forEach(t => { typeCounts[t] = (typeCounts[t] || 0) + 1; });
  const total = types.length || target;
  const result = [];
  for (const [type, count] of Object.entries(typeCounts)) {
    const want = Math.round((count / total) * target);
    result.push(...questions.filter(q => q.type === type).slice(0, want));
  }
  // Fill remainder from any type if we're still short
  if (result.length < target) {
    const used = new Set(result);
    for (const q of questions) {
      if (!used.has(q) && result.length < target) result.push(q);
    }
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
9. NO DUPLICATE QUESTIONS: Every question must test a different concept, situation, or scenario. No two questions may have the same meaning, even if the wording differs. No duplicate answer options.`;
}

function buildUserPrompt({ count, jobRole, jdText, skillsList, types, seed }) {
  const easyCount  = Math.round(count * 0.35);
  const mediumCount = Math.round(count * 0.45);
  const hardCount  = Math.max(1, count - easyCount - mediumCount);

  return `Generate ${count} assessment questions for the following employee profile.

=== EMPLOYEE PROFILE ===
Job Role: ${jobRole || 'Professional'}
${skillsList.length ? `Skills identified from JD: ${skillsList.join(', ')}` : ''}

=== JOB DESCRIPTION ===
${jdText || '(No JD provided — use only the job role to infer responsibilities)'}

=== VARIATION SEED: ${seed} ===

=== STEP-BY-STEP GENERATION PROCESS ===

STEP 1 — EXTRACT THE ROLE PROFILE FROM THE JD:
Identify before generating any question:
• Primary domain/industry (HR / Finance / Operations / Sales / IT / Healthcare / Legal / etc.)
• Seniority level (junior / specialist / senior / manager / director / executive)
• Top 5 day-to-day responsibilities described in the JD
• Required tools, platforms, systems (HRMS, SAP, Salesforce, Excel, Jira, etc.)
• Required processes (recruitment, budgeting, pipeline management, vendor evaluation, etc.)
• Required knowledge areas (labor law, IFRS, Agile, ISO standards, etc.)
• Required soft skills and competencies (stakeholder management, negotiation, team leadership, etc.)
• Key performance indicators or expected outcomes mentioned

STEP 2 — GENERATE QUESTIONS GROUNDED IN THE EXTRACTED PROFILE:

QUESTION TYPE MIX — cycle through in order: ${types.join(', ')}

DIFFICULTY DISTRIBUTION — MANDATORY:
• Easy: exactly ${easyCount} questions (~35%) — foundational knowledge, definitions, straightforward processes
• Medium: exactly ${mediumCount} questions (~45%) — applied situations, multi-step decisions, moderate complexity
• Hard: exactly ${hardCount} questions (~20%) — complex scenarios, strategic thinking, edge cases, cross-functional judgment
Generate all easy questions first, then medium, then hard in the JSON — the final reordering will happen in code.

WORDING RULES — STRICTLY ENFORCED:
• Maximum ${Math.max(1, Math.floor(count * 0.08))} question(s) in the entire set may start with "As a [role]" / "In your role as" / "While working as". ALL OTHER questions must be worded differently.
• Write questions that directly address: concepts, best practices, scenarios, decisions, processes, policies, tools, case situations — without mentioning the job role in the question stem.
• Good examples: "What is the recommended approach when...", "Which of the following best describes...", "A team encounters [situation]. What should be done first?", "When evaluating [process], which factor is most important?"
• Bad examples: "As an HR Executive, when you face...", "In your role as a Finance Manager, what would you do..."
• Make each question test a UNIQUE concept — no two questions may test the same thing even with different wording.

STEP 3 — VALIDATE EACH QUESTION BEFORE RETURNING:
• Can I point to a specific line or responsibility in the JD that makes this question relevant? If NO — replace it.
• Is this question unique compared to all others in the set? If similar to another — replace it.
• Does the wording follow the rules above? If not — rewrite it.

=== OUTPUT FORMAT ===
{
  "questions": [
    {
      "type": "mcq|fill_blank|subjective",
      "question": "direct, naturally worded question about a concept, scenario, or decision",
      "difficulty": "easy|medium|hard",
      "options": ["A) ...", "B) ...", "C) ...", "D) ..."],
      "answer": "A (or B/C/D for mcq) | exact phrase for fill_blank | detailed model answer for subjective",
      "explanation": "brief phrase — which JD requirement this tests",
      "skillArea": "the specific responsibility, skill, or competency from the JD being tested"
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
  (s) => [`A key outcome of effective ${s} is ______.`, 'consistent, measurable, and high-quality outcomes'],
  (s) => [`The primary goal of ${s} is to achieve ______.`, 'reliable, repeatable results'],
  (s) => [`When ${s} is executed well, the result is typically ______.`, 'improved efficiency and stakeholder satisfaction'],
  (s) => [`A common best practice in ${s} is to ______.`, 'document decisions and validate against requirements'],
  (s) => [`The most important input to successful ${s} is ______.`, 'clear, accurate, and timely information'],
];

const FALLBACK_SUBJECTIVE_TEMPLATES = [
  (s) => `Describe a situation where ${s} required careful judgment. What approach did you take and what was the result?`,
  (s) => `Explain how you would approach ${s} when requirements are ambiguous. What steps would you take to reduce risk?`,
  (s) => `Walk through how you would evaluate the success of ${s} over a full quarter. What would you track and why?`,
  (s) => `Describe a scenario where ${s} conflicted with another priority. How would you decide which to address first?`,
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

    let questionText, answer, skill;
    if (t === 'fill_blank') {
      const { skill: s, tpl } = pickCombo(FALLBACK_FILL_TEMPLATES, fallbackSkills, comboIdx);
      const [text, ans] = tpl(s);
      questionText = text; answer = ans; skill = s;
    } else if (t === 'subjective') {
      const { skill: s, tpl } = pickCombo(FALLBACK_SUBJECTIVE_TEMPLATES, fallbackSkills, comboIdx);
      questionText = tpl(s);
      answer = `An effective approach involves clarifying objectives and constraints, systematically identifying root causes, designing solutions aligned with organizational goals, and tracking outcomes against defined KPIs.`;
      skill = s;
    } else {
      const { skill: s, tpl } = pickCombo(FALLBACK_TEMPLATES[difficulty], fallbackSkills, comboIdx);
      questionText = tpl(s);
      answer = 'A';
      skill = s;
    }

    return {
      type: t,
      question: questionText,
      difficulty,
      options: t === 'mcq' ? [
        `A) Assess the situation, identify root cause, and develop a structured plan`,
        `B) Escalate immediately without gathering information`,
        `C) Wait for the situation to resolve on its own`,
        `D) Delegate without providing context or follow-up`,
      ] : undefined,
      answer,
      explanation: `Tests applied ${skill} competency for the ${role} role.`,
      skillArea: skill,
    };
  });
}

/**
 * Generates exactly `questionCount` unique questions for the given job role/JD.
 * Guarantees:
 *  - Exact count (never fewer, never more)
 *  - No duplicate questions or duplicate options
 *  - Approximate 35/45/20 easy/medium/hard distribution
 *  - Type mix follows `questionTypes` sequence/ratio
 * Strategy: request from the LLM with a buffer, retry with escalating asks if
 * short, and — only as an absolute last resort — pad the remainder with
 * deterministic template questions so the caller never receives a partial set.
 */
export async function generateQuestionsFromJD({ jobRole, jobDescription, jdSkills, questionCount, questionTypes, employeeSeed }) {
  const num = Math.min(Math.max(parseInt(questionCount) || 5, 2), 100);
  const types = Array.isArray(questionTypes) && questionTypes.length > 0 ? questionTypes : ['mcq'];
  const baseSeed = employeeSeed || randomUUID().slice(0, 8);
  const jdText = (jobDescription || '').trim();
  const skillsList = Array.isArray(jdSkills) && jdSkills.length ? jdSkills : [];
  const system = buildSystemPrompt();

  let pool = [];
  const MAX_ATTEMPTS = 5;

  for (let attempt = 0; attempt < MAX_ATTEMPTS && pool.length < num; attempt++) {
    const stillNeeded = num - pool.length;
    // Escalating buffer: first attempt +40%, later attempts ask for progressively more
    // headroom since each additional attempt tends to yield a lower unique-acceptance rate.
    const bufferMultiplier = 1.4 + attempt * 0.3;
    const askFor = Math.min(100, Math.max(stillNeeded, Math.ceil(stillNeeded * bufferMultiplier)));
    const seed = attempt === 0 ? baseSeed : `${baseSeed}-retry${attempt}-${randomUUID().slice(0, 6)}`;
    const prompt = buildUserPrompt({ count: askFor, jobRole, jdText, skillsList, types, seed });

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

  const trimmed = trimToTarget(pool, num, types);
  return rebalanceDifficulty(trimmed);
}
