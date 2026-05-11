import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import GeminiService from '../services/GeminiService.js';
import RuleBase from './RuleBase.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

const TARGET_QUESTIONS = 5; // Always exactly 5 questions

class QuizGenerator {
  constructor() {
    const questionsPath = join(__dirname, '../knowledge/questions.json');
    this.questions = JSON.parse(readFileSync(questionsPath, 'utf-8'));
  }

  // ── STEP 1: Rule-based quiz (highest priority, no API call) ──────────────
  getRuleBasedQuiz(skillTree) {
    const domainId = skillTree.domain || 'custom';
    const goalText = skillTree.profile?.rawGoal || '';

    const questions = RuleBase.getQuiz(domainId, goalText);
    if (!questions || questions.length === 0) return null;

    console.log(`[QuizGenerator] ✅ Rule-base hit for domain "${domainId}" — ${questions.length} questions`);
    // Add concept field fallback, mark source
    return questions.slice(0, TARGET_QUESTIONS).map((q, i) => ({
      ...q,
      concept: q.concept || q.skillName,
      source: 'rule_base',
    }));
  }

  // ── STEP 2: Gemini-powered domain-specific quiz ──────────────────────────
  async generateWithLLM(skillTree) {
    const { profile, skills, domain } = skillTree;
    const domainLabel = skillTree.domainName || domain;
    const goalText = profile?.rawGoal || domainLabel;
    const skillList = skills.slice(0, 5).map((s, i) =>
      `${i + 1}. ${s.name} (id: ${s.id}, topics: ${(s.topics || []).slice(0, 3).join(', ')})`
    ).join('\n');

    const prompt = `You are an expert assessment designer. Create a diagnostic quiz for someone who wants to: "${goalText}"

Domain: ${domainLabel}
Target skills:
${skillList}

Generate EXACTLY ${TARGET_QUESTIONS} multiple-choice questions. Each question must test REAL ${domainLabel} knowledge that a practitioner or student in this field would actually need to know.

CORRECT examples by domain:
- Doctor/Medicine: "A patient presents with crushing chest pain, elevated troponin, and ST elevation in V1-V4. What is the diagnosis?" NOT "What is the purpose of clinical medicine?"
- Lawyer/Law: "Under Section 300 IPC, what distinguishes murder from culpable homicide?" NOT "Why is contract law important?"
- Chef/Cooking: "At what internal temperature is chicken considered safe to eat?" NOT "What is the purpose of learning cooking?"
- Engineer: "A simply-supported beam of 6m span carries 15 kN/m UDL. What is the maximum bending moment?" NOT "What is the role of structural analysis?"

Difficulty order: q1=basic, q2=moderate, q3=advanced, q4=practical scenario, q5=real_world professional judgment

Return ONLY valid JSON:
{
  "questions": [
    {
      "id": "q1",
      "skillId": "exact_skill_id_from_list",
      "skillName": "Exact Skill Name",
      "concept": "Short concept name tested (e.g. 'Brachial Plexus', 'Mens Rea', 'Maillard Reaction', 'Flexbox vs Grid')",
      "difficulty": "basic",
      "question": "A specific factual or scenario-based question using REAL ${domainLabel} terminology",
      "type": "multiple_choice",
      "options": [
        "A) The correct answer with brief justification",
        "B) A plausible but wrong answer (common misconception)",
        "C) A plausible but wrong answer",
        "D) A clearly wrong answer"
      ],
      "correct": "A) The correct answer with brief justification",
      "explanation": "Detailed explanation using ${domainLabel} terminology and reasoning.",
      "key_concepts": ["real concept 1", "real concept 2"],
      "score_keywords": ["keyword1", "keyword2"]
    }
  ]
}

CRITICAL RULES:
- Questions must test DOMAIN KNOWLEDGE, not "meta-learning" (never ask "why is X important to learn")
- Use real terminology from ${domainLabel} (e.g. troponin, habeas corpus, mise en place, shear force)
- Wrong options must be plausible misconceptions a learner might actually have — not obviously fake
- Each question covers a DIFFERENT difficulty: basic, moderate, advanced, practical, real_world
- "correct" must EXACTLY match one of the four option strings
- "concept" must be the specific named topic tested (≤ 6 words)`;

    try {
      const result = await GeminiService.generateJSON(prompt,
        `Expert quiz designer for ${domainLabel}. Return only valid JSON. ${TARGET_QUESTIONS} MCQ questions only.`);

      if (result?.questions?.length >= TARGET_QUESTIONS - 1) {
        const validated = result.questions
          .filter(q => q.question && q.options?.length === 4 && q.correct)
          .map((q, i) => ({
            ...q,
            id: q.id || `q${i + 1}`,
            type: 'multiple_choice',
            concept: q.concept || q.skillName || 'Core Concept',
            source: 'llm',
            options: q.options.map(o => {
              if (/^[A-D]\)/.test(o)) return o;
              const label = ['A', 'B', 'C', 'D'][q.options.indexOf(o)];
              return `${label}) ${o}`;
            }),
          }));

        if (validated.length >= TARGET_QUESTIONS - 1) {
          console.log(`[QuizGenerator] Gemini generated ${validated.length} questions for "${domainLabel}"`);
          return validated.slice(0, TARGET_QUESTIONS);
        }
      }
    } catch (err) {
      console.error('[QuizGenerator] Gemini error:', err.message);
    }
    return null;
  }

  // ── STEP 3: Static bank (filtered to MCQ only) ────────────────────────────
  getStaticMCQ(skill, profile) {
    const skillQuestions = this.questions[skill.id];
    if (!skillQuestions) return [];
    const levelQuestions = skillQuestions[skill.level] || skillQuestions['beginner'] || [];
    return levelQuestions
      .filter(q => q.type === 'multiple_choice')
      .sort((a, b) => this._scoreRelevance(b, skill, profile) - this._scoreRelevance(a, skill, profile))
      .slice(0, 1)
      .map((q, i) => ({
        ...q,
        id: `${q.id}_${skill.id}_${i + 1}`,
        skillId: skill.id,
        skillName: skill.name,
        concept: q.concept || (q.key_concepts?.[0]) || skill.name,
        source: 'static',
      }));
  }

  _scoreRelevance(question, skill, profile) {
    const text = [question.question, ...(question.key_concepts || [])].join(' ').toLowerCase();
    let score = 0;
    for (const kw of profile?.focusKeywords || []) {
      if (text.includes(kw)) score += kw.length > 5 ? 3 : 2;
    }
    for (const tool of profile?.detectedTools || []) {
      if (text.includes(tool)) score += 4;
    }
    return score;
  }

  // ── STEP 4: Domain-knowledge fallback generator ───────────────────────────
  // Uses actual topic names to write knowledge-testing questions, NOT meta-questions.
  // These test whether the learner KNOWS the concept, not whether they know it's important.
  buildFallbackMCQ(skill, topicIndex = 0) {
    const topics = skill.topics || [];
    const t  = topics[topicIndex % topics.length] || skill.name;
    const t2 = topics[(topicIndex + 1) % Math.max(topics.length, 1)] || 'practical application';
    const t3 = topics[(topicIndex + 2) % Math.max(topics.length, 1)] || 'core concepts';
    const t4 = topics[(topicIndex + 3) % Math.max(topics.length, 1)] || 'advanced techniques';
    const domain = skill.name;

    const DIFFICULTIES = ['basic', 'moderate', 'advanced', 'practical', 'real_world'];
    const templateId = topicIndex % 6;

    // Each template tests understanding of the topic itself, using a scenario or direct question
    const templates = [
      {
        // Knowledge check: what does the topic involve / mean?
        question: `Which description best captures what "${t}" involves in ${domain}?`,
        options: [
          `A) "${t}" covers the core principles and techniques that directly enable practical work in ${domain}`,
          `B) "${t}" is a supplementary concept only relevant after completing ${t4}`,
          `C) "${t}" and "${t3}" are interchangeable terms for the same technique`,
          `D) "${t}" is an outdated approach replaced entirely by ${t2} in modern ${domain}`,
        ],
        correct: `A) "${t}" covers the core principles and techniques that directly enable practical work in ${domain}`,
        explanation: `"${t}" is a key component of ${domain} that practitioners apply regularly. Confusing it with "${t3}" or treating it as outdated leads to gaps in foundational skill. It is distinct from, and often prerequisite to, "${t2}".`,
      },
      {
        // Application: when/how do practitioners use it?
        question: `In a real ${domain} scenario, when would a practitioner specifically apply "${t}"?`,
        options: [
          `A) When working on tasks that require ${domain} knowledge of "${t}" to get correct, consistent results`,
          `B) Only in academic settings — "${t}" has no practical application outside theory`,
          `C) Only once "${t4}" has been fully mastered`,
          `D) As a last resort when "${t2}" and "${t3}" have both failed`,
        ],
        correct: `A) When working on tasks that require ${domain} knowledge of "${t}" to get correct, consistent results`,
        explanation: `In ${domain}, "${t}" is applied in real-world work, not just in theory. Skipping it leads to errors in tasks that depend on it. A practitioner encounters "${t}" regularly when working on projects involving "${t2}".`,
      },
      {
        // Sequencing / dependency
        question: `A student learning ${domain} is struggling with "${t2}". What is the most likely reason?`,
        options: [
          `A) They have not yet mastered "${t}" — it is a prerequisite that "${t2}" builds directly upon`,
          `B) "${t2}" is too advanced for anyone without a degree in ${domain}`,
          `C) They should skip "${t2}" entirely and move directly to "${t4}"`,
          `D) The problem is unrelated to prior knowledge — "${t2}" stands alone`,
        ],
        correct: `A) They have not yet mastered "${t}" — it is a prerequisite that "${t2}" builds directly upon`,
        explanation: `In ${domain}, topics are scaffolded: "${t}" must be solid before "${t2}" makes sense. This sequencing prevents foundational gaps. Learners who skip ahead and struggle should revisit prior topics like "${t}" before continuing.`,
      },
      {
        // Common mistake / misconception
        question: `What is the most common mistake beginners make regarding "${t}" in ${domain}?`,
        options: [
          `A) Treating "${t}" as optional or theoretical, instead of practising it hands-on in real ${domain} tasks`,
          `B) Spending too much time on "${t}" when they should move straight to ${t4}`,
          `C) Learning "${t}" before understanding "${t3}", which is its direct prerequisite`,
          `D) Applying "${t}" in professional settings before completing academic study`,
        ],
        correct: `A) Treating "${t}" as optional or theoretical, instead of practising it hands-on in real ${domain} tasks`,
        explanation: `The most common beginner mistake with "${t}" in ${domain} is treating it as pure theory. Without hands-on practice, the concept remains abstract and fails to transfer to real tasks. Active application is what builds genuine skill.`,
      },
      {
        // Comparative: choose correct approach
        question: `A ${domain} practitioner needs to complete a task involving "${t}". Which approach is correct?`,
        options: [
          `A) Apply "${t}" systematically using established ${domain} principles, then verify against "${t2}"`,
          `B) Skip "${t}" and use "${t3}" instead — they produce the same outcome`,
          `C) Delegate any task involving "${t}" until "${t4}" has been studied`,
          `D) Rely on intuition rather than structured knowledge of "${t}"`,
        ],
        correct: `A) Apply "${t}" systematically using established ${domain} principles, then verify against "${t2}"`,
        explanation: `In professional ${domain} work, "${t}" must be applied systematically — not through guesswork. Using "${t3}" as a substitute introduces errors. The correct approach is to apply "${t}" according to its principles, then cross-check with related concepts like "${t2}".`,
      },
      {
        // Mastery indicator: what does knowing this well look like?
        question: `Which outcome best demonstrates that a ${domain} learner has genuinely mastered "${t}"?`,
        options: [
          `A) They can apply "${t}" correctly in unfamiliar ${domain} scenarios and explain the reasoning behind each step`,
          `B) They can recite the definition of "${t}" from memory`,
          `C) They have completed a course that listed "${t}" in its syllabus`,
          `D) They can identify "${t}" when prompted but cannot yet use it independently`,
        ],
        correct: `A) They can apply "${t}" correctly in unfamiliar ${domain} scenarios and explain the reasoning behind each step`,
        explanation: `True mastery of "${t}" in ${domain} means transfer — applying it correctly in new, unseen situations. Memorising definitions or course completion proves familiarity at best. The benchmark is: can you use "${t}" in a real ${domain} task you have not seen before, and justify your approach?`,
      },
    ];

    const tpl = templates[templateId];
    return {
      id: `q_${skill.id}_mcq_${topicIndex}`,
      skillId: skill.id,
      skillName: skill.name,
      concept: t,
      difficulty: DIFFICULTIES[topicIndex % DIFFICULTIES.length],
      question: tpl.question,
      type: 'multiple_choice',
      options: tpl.options,
      correct: tpl.correct,
      explanation: tpl.explanation,
      key_concepts: [t, skill.name],
      score_keywords: [t],
      source: 'fallback',
    };
  }

  // ── Main entry: Rule-base → LLM → Static → Fallback ─────────────────────
  async generate(skillTree) {
    const profile = skillTree.profile || {};

    // ── Step 1: Rule-base first (no API call, highest quality for known domains)
    const ruleQuestions = this.getRuleBasedQuiz(skillTree);
    if (ruleQuestions && ruleQuestions.length >= TARGET_QUESTIONS - 1) {
      return this._ensureExactly5(ruleQuestions, skillTree);
    }

    // ── Step 2: Gemini for unknown domains
    if (GeminiService.isEnabled()) {
      const llmQuestions = await this.generateWithLLM(skillTree);
      if (llmQuestions && llmQuestions.length >= TARGET_QUESTIONS - 1) {
        return this._ensureExactly5(llmQuestions, skillTree);
      }
    }

    // ── Step 3: Static bank + generated fallback
    const diagnosticQuestions = [];
    for (const skill of skillTree.skills) {
      const staticMCQ = this.getStaticMCQ(skill, profile);
      diagnosticQuestions.push(...staticMCQ.slice(0, 1));
      if (diagnosticQuestions.length >= TARGET_QUESTIONS) break;
    }

    // Fill remaining with fallback questions across skills
    let skillIndex = 0;
    let topicIndex = 0;
    while (diagnosticQuestions.length < TARGET_QUESTIONS) {
      const skill = skillTree.skills[skillIndex % skillTree.skills.length];
      diagnosticQuestions.push(this.buildFallbackMCQ(skill, topicIndex));
      skillIndex++;
      topicIndex++;
    }

    return diagnosticQuestions.slice(0, TARGET_QUESTIONS);
  }

  // Ensures exactly 5 questions — pads with fallback if short
  _ensureExactly5(questions, skillTree) {
    if (questions.length >= TARGET_QUESTIONS) return questions.slice(0, TARGET_QUESTIONS);
    const padded = [...questions];
    let i = 0;
    while (padded.length < TARGET_QUESTIONS) {
      const skill = skillTree.skills[i % skillTree.skills.length];
      padded.push(this.buildFallbackMCQ(skill, padded.length));
      i++;
    }
    return padded;
  }
}

export default QuizGenerator;
