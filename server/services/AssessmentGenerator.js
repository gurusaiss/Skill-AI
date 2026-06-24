/**
 * AssessmentGenerator.js — shared question generation service
 * Extracted from assessment.js so users.js and roles.js can reuse it
 * without circular imports.
 */
import { randomUUID } from 'crypto';

export async function generateQuestionsFromJD({ jobRole, jobDescription, jdSkills, questionCount, questionTypes, employeeSeed }) {
  const num = Math.min(Math.max(parseInt(questionCount) || 5, 2), 50);
  const types = Array.isArray(questionTypes) && questionTypes.length > 0 ? questionTypes : ['mcq'];
  const seed = employeeSeed || randomUUID().slice(0, 8);
  const jdText = (jobDescription || '').trim();
  const skillsList = Array.isArray(jdSkills) && jdSkills.length ? jdSkills : [];

  const system = `You are an expert HR assessment designer who creates role-specific assessments for ALL job functions across ALL industries — HR, Operations, Finance, Sales, Marketing, Customer Success, Procurement, L&D, Project Management, IT, Engineering, Healthcare, Legal, and any other domain.

ABSOLUTE RULES:
1. Read and extract the actual domain, responsibilities, tools, and required knowledge from the JD FIRST.
2. Generate questions ONLY about what the JD explicitly requires — never introduce topics from unrelated domains.
3. Domain must match: HR role → HR questions. Finance role → Finance questions. Operations → Operations questions. Do NOT cross domains.
4. Every question must trace directly to a specific responsibility, skill, process, tool, or competency in the JD.
5. Match seniority level: Executive/Director → strategy, policy, P&L, stakeholder decisions. Manager → team management, planning, escalation, reporting. Specialist/Executive → applied process, tools, day-to-day procedures. Junior/Coordinator → foundational knowledge, process steps.
6. Never generate software coding or engineering architecture questions unless the JD explicitly lists programming as a requirement.
7. Always return valid JSON with exactly a "questions" array.`;

  const prompt = `Generate ${num} assessment questions for this employee.

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
• Use exactly this question type mix (cycle through): ${types.join(', ')}
• Difficulty distribution: EXACTLY one-third each — assign difficulty in a strict rotating cycle (easy → medium → hard → easy → medium → hard …). Every third question must be hard. Do NOT cluster all hard questions at the end.
• Each question must test something from the profile extracted in Step 1
• Prefer scenario-based questions: "In your role as ${jobRole || 'a professional'}, when [situation], what do you do?"
• For non-technical roles: test processes, decisions, communication, and domain knowledge — NOT coding or engineering
• For managerial roles: include team management, delegation, conflict resolution, resource planning, KPI reporting
• For finance/procurement: include budgeting, approval workflows, vendor management, compliance
• For HR roles: include recruitment processes, employee relations, HR policies, performance management
• For sales/marketing: include pipeline management, client handling, campaign strategy, metrics tracking
• Use the variation seed (${seed}) to select different angles and scenarios even if two employees share the same JD

STEP 3 — VALIDATE EACH QUESTION BEFORE RETURNING:
For every question ask: "Can I point to a specific line or responsibility in the JD that makes this question relevant?"
If the answer is NO — replace the question with one that passes this test.

=== OUTPUT FORMAT ===
{
  "questions": [
    {
      "type": "mcq|fill_blank|subjective",
      "question": "specific, scenario-grounded question relevant to this exact role and JD",
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
          temperature: 0.8,
          max_tokens: 8000,
          response_format: { type: 'json_object' },
        }),
        signal: AbortSignal.timeout(30000),
      });
      if (r.ok) {
        const d = await r.json();
        const parsed = JSON.parse(d.choices?.[0]?.message?.content || '{}');
        if (Array.isArray(parsed.questions) && parsed.questions.length > 0) return parsed.questions;
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
            generationConfig: { temperature: 0.8, maxOutputTokens: 8192, responseMimeType: 'application/json' },
          }),
          signal: AbortSignal.timeout(30000),
        }
      );
      if (r.ok) {
        const d = await r.json();
        const parsed = JSON.parse(d.candidates?.[0]?.content?.parts?.[0]?.text || '{}');
        if (Array.isArray(parsed.questions) && parsed.questions.length > 0) return parsed.questions;
      }
    }
  } catch (e) { console.warn('[AssessmentGenerator] Gemini failed:', e.message); }

  // Fallback — skill-grounded rule-based questions
  const role = jobRole || 'Professional';
  const fallbackSkills = skillsList.length > 0 ? skillsList
    : ['core responsibilities', 'stakeholder communication', 'process management', 'performance delivery', 'problem solving'];
  return Array.from({ length: num }, (_, i) => {
    const t = types[i % types.length];
    const difficulty = ['easy', 'medium', 'hard'][i % 3];
    const skill = fallbackSkills[i % fallbackSkills.length];
    return {
      type: t,
      question: t === 'mcq'
        ? `As a ${role}, when facing a challenge related to ${skill}, what is the most effective first step?`
        : t === 'fill_blank'
        ? `A key outcome of strong ${skill} in the ${role} role is ______.`
        : `Describe a specific situation in your ${role} role where ${skill} was critical. What approach did you take and what was the result?`,
      difficulty,
      options: t === 'mcq' ? [
        `A) Assess the situation, identify root cause, and develop a structured plan`,
        `B) Escalate immediately without gathering information`,
        `C) Wait for the situation to resolve on its own`,
        `D) Delegate without providing context or follow-up`,
      ] : undefined,
      answer: t === 'mcq' ? 'A'
        : t === 'fill_blank' ? 'consistent, measurable, and high-quality outcomes'
        : `In my ${role} role, I approach ${skill} challenges by first clarifying objectives and constraints, then systematically identifying root causes, designing solutions aligned with organizational goals, and tracking outcomes against defined KPIs.`,
      explanation: `Tests applied ${skill} competency directly required in the ${role} role.`,
      skillArea: skill,
    };
  });
}
