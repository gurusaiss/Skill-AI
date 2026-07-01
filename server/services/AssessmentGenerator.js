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
    const tokens = new Set(normalize(q.question));
    for (const prev of seen) {
      const prevTokens = new Set(normalize(prev.question));
      const intersection = [...tokens].filter(t => prevTokens.has(t)).length;
      const union = new Set([...tokens, ...prevTokens]).size;
      if (union > 0 && intersection / union > 0.70) return false; // too similar
    }
    seen.push(q);
    return true;
  });
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
  // If types array has a specific distribution (e.g. 25 mcq, 13 fill, 12 subj), respect it
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

export async function generateQuestionsFromJD({ jobRole, jobDescription, jdSkills, questionCount, questionTypes, employeeSeed }) {
  const num = Math.min(Math.max(parseInt(questionCount) || 5, 2), 100);
  const types = Array.isArray(questionTypes) && questionTypes.length > 0 ? questionTypes : ['mcq'];
  const seed = employeeSeed || randomUUID().slice(0, 8);
  const jdText = (jobDescription || '').trim();
  const skillsList = Array.isArray(jdSkills) && jdSkills.length ? jdSkills : [];

  // Request 40% more than needed so deduplication losses don't reduce the final count
  const requestNum = Math.min(Math.ceil(num * 1.4), 100);

  // Compute target counts per difficulty (based on requestNum so we have buffer)
  const easyCount  = Math.round(requestNum * 0.35);
  const mediumCount = Math.round(requestNum * 0.45);
  const hardCount  = Math.max(1, requestNum - easyCount - mediumCount);

  const system = `You are an expert HR assessment designer who creates role-specific assessments for ALL job functions across ALL industries — HR, Operations, Finance, Sales, Marketing, Customer Success, Procurement, L&D, Project Management, IT, Engineering, Healthcare, Legal, and any other domain.

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

  const prompt = `Generate ${requestNum} assessment questions for the following employee profile.

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
• Maximum ${Math.max(1, Math.floor(requestNum * 0.08))} question(s) in the entire set may start with "As a [role]" / "In your role as" / "While working as". ALL OTHER questions must be worded differently.
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

  // Try Groq first
  try {
    const groqKey = process.env.GROQ_API_KEY;
    if (groqKey?.length > 10) {
      const r = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${groqKey}` },
        body: JSON.stringify({
          model: 'llama-3.3-70b-versatile',
          messages: [{ role: 'system', content: system }, { role: 'user', content: prompt }],
          temperature: 0.85,
          max_tokens: 16000,
          response_format: { type: 'json_object' },
        }),
        signal: AbortSignal.timeout(30000),
      });
      if (r.ok) {
        const d = await r.json();
        const parsed = JSON.parse(d.choices?.[0]?.message?.content || '{}');
        if (Array.isArray(parsed.questions) && parsed.questions.length > 0) {
          const processed = rebalanceDifficulty(deduplicateQuestions(parsed.questions));
          // If still short, make a top-up call with a different seed
          if (processed.length < num) {
            try {
              const topUpNeeded = Math.ceil((num - processed.length) * 1.5);
              const topUpPrompt = prompt.replace(`Generate ${requestNum}`, `Generate ${topUpNeeded}`).replace(seed, seed + '-topup');
              const r2 = await fetch('https://api.groq.com/openai/v1/chat/completions', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${process.env.GROQ_API_KEY}` },
                body: JSON.stringify({ model: 'llama-3.3-70b-versatile', messages: [{ role: 'system', content: system }, { role: 'user', content: topUpPrompt }], temperature: 0.9, max_tokens: 8000, response_format: { type: 'json_object' } }),
                signal: AbortSignal.timeout(25000),
              });
              if (r2.ok) {
                const d2 = await r2.json();
                const p2 = JSON.parse(d2.choices?.[0]?.message?.content || '{}');
                if (Array.isArray(p2.questions)) {
                  const merged = deduplicateQuestions([...processed, ...p2.questions]);
                  return trimToTarget(rebalanceDifficulty(merged), num, types);
                }
              }
            } catch { /* top-up failed, return what we have */ }
          }
          return trimToTarget(processed, num, types);
        }
      }
    }
  } catch (e) { console.warn('[AssessmentGenerator] Groq failed:', e.message); }

  // Try Gemini
  try {
    const geminiKey = process.env.GEMINI_API_KEY;
    const geminiModel = process.env.GEMINI_MODEL || 'gemini-2.0-flash';
    if (geminiKey?.length > 10) {
      const r = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${geminiModel}:generateContent?key=${geminiKey}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{ parts: [{ text: system + '\n\n' + prompt }] }],
            generationConfig: { temperature: 0.85, maxOutputTokens: 16384, responseMimeType: 'application/json' },
          }),
          signal: AbortSignal.timeout(30000),
        }
      );
      if (r.ok) {
        const d = await r.json();
        const parsed = JSON.parse(d.candidates?.[0]?.content?.parts?.[0]?.text || '{}');
        if (Array.isArray(parsed.questions) && parsed.questions.length > 0) {
          const processed = rebalanceDifficulty(deduplicateQuestions(parsed.questions));
          return trimToTarget(processed, num, types);
        }
      }
    }
  } catch (e) { console.warn('[AssessmentGenerator] Gemini failed:', e.message); }

  // Fallback — skill-grounded rule-based questions (no "As a..." prefix)
  const role = jobRole || 'Professional';
  const fallbackSkills = skillsList.length > 0 ? skillsList
    : ['core responsibilities', 'stakeholder communication', 'process management', 'performance delivery', 'problem solving'];

  const fallbackTemplates = {
    easy: [
      (skill) => `What is the primary purpose of ${skill} in a professional context?`,
      (skill) => `Which of the following best describes ${skill}?`,
      (skill) => `What is a key indicator of effective ${skill}?`,
    ],
    medium: [
      (skill) => `A team encounters conflicting priorities related to ${skill}. What is the recommended first step?`,
      (skill) => `When evaluating options for ${skill}, which factor should take highest priority?`,
      (skill) => `A stakeholder requests a change that impacts ${skill}. How should this be handled?`,
    ],
    hard: [
      (skill) => `Multiple departments disagree on the approach to ${skill}. How would you build consensus while meeting the deadline?`,
      (skill) => `A critical failure occurs in ${skill} with no clear precedent. Describe the decision-making framework you would apply.`,
      (skill) => `How would you design a scalable process for ${skill} that balances efficiency, compliance, and stakeholder expectations?`,
    ],
  };

  const difficulties = [
    ...Array(easyCount).fill('easy'),
    ...Array(mediumCount).fill('medium'),
    ...Array(hardCount).fill('hard'),
  ];

  return trimToTarget(deduplicateQuestions(Array.from({ length: requestNum }, (_, i) => {
    const t = types[i % types.length];
    const difficulty = difficulties[i] || ['easy', 'medium', 'hard'][i % 3];
    const skill = fallbackSkills[i % fallbackSkills.length];
    const tpls = fallbackTemplates[difficulty];
    const questionText = t === 'fill_blank'
      ? `A key outcome of effective ${skill} management is ______.`
      : t === 'subjective'
      ? `Describe a situation where ${skill} required careful judgment. What approach did you take and what was the result?`
      : tpls[i % tpls.length](skill);

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
      answer: t === 'mcq' ? 'A'
        : t === 'fill_blank' ? 'consistent, measurable, and high-quality outcomes'
        : `An effective approach involves clarifying objectives and constraints, systematically identifying root causes, designing solutions aligned with organizational goals, and tracking outcomes against defined KPIs.`,
      explanation: `Tests applied ${skill} competency for the ${role} role.`,
      skillArea: skill,
    };
  })), num, types);
}
