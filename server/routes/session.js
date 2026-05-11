import express from 'express';
import SmartAgent from '../agent/SmartAgent.js';
import gemini from '../services/GeminiService.js';

const router = express.Router();
const agent = new SmartAgent();

router.get('/challenge/:userId/:day', async (req, res) => {
  try {
    const { userId, day } = req.params;
    const result = await agent.getChallenge(userId, day);
    res.json({ success: true, data: result, error: null });
  } catch (error) {
    console.error('[GET /api/session/challenge]', error);
    const status = error.message.includes('not found') ? 404 : 500;
    res.status(status).json({ success: false, data: null, error: error.message });
  }
});

router.get('/dashboard/:userId', async (req, res) => {
  try {
    const { userId } = req.params;
    const data = agent.getDashboard(userId);
    res.json({ success: true, data, error: null });
  } catch (error) {
    console.error('[GET /api/session/dashboard]', error);
    const status = error.message.includes('not found') ? 404 : 500;
    res.status(status).json({ success: false, data: null, error: error.message });
  }
});

router.post('/submit', async (req, res) => {
  try {
    const { userId, day, skillId, challenge, userResponse } = req.body;
    if (!userId || !day || !skillId || !challenge || !userResponse) {
      return res.status(400).json({
        success: false, data: null,
        error: 'userId, day, skillId, challenge, and userResponse are required',
      });
    }
    const result = await agent.submitSession({ userId, day, skillId, challenge, userResponse });
    res.json({ success: true, data: result, error: null });
  } catch (error) {
    console.error('[POST /api/session/submit]', error);
    res.status(500).json({ success: false, data: null, error: error.message });
  }
});

// NEW: Agent debates endpoint
router.get('/debates/:userId', async (req, res) => {
  try {
    const { userId } = req.params;
    const debates = agent.getDebates(userId);
    res.json({ success: true, data: { debates }, error: null });
  } catch (error) {
    res.status(500).json({ success: false, data: null, error: error.message });
  }
});

// ── Session Quiz: generate 10 topic-specific questions ──────────────────────
router.post('/quiz', async (req, res) => {
  try {
    const { skillName, topic, description, domain, conceptSummary } = req.body;
    if (!skillName || !topic) {
      return res.status(400).json({ success: false, data: null, error: 'skillName and topic are required' });
    }

    const contextSummary = conceptSummary
      ? `Concept: ${conceptSummary.title || topic}\nDefinition: ${conceptSummary.definition || ''}\nKey Points: ${(conceptSummary.keyPoints || []).join('; ')}`
      : `Topic: ${topic}\nContext: ${description || ''}`;

    const prompt = `You are a quiz designer creating a 10-question session quiz for a learner who just studied: "${topic}" in ${domain || skillName}.

${contextSummary}

Generate EXACTLY 10 questions to test understanding of THIS topic:
- Questions 1-7: Multiple choice (MCQ) with 4 options (A/B/C/D)
- Questions 8-10: Fill-in-the-blank (one key term or short phrase answer)

Return ONLY valid JSON:
{
  "questions": [
    {
      "id": "q1",
      "type": "mcq",
      "text": "Question testing understanding of ${topic}?",
      "options": ["A) ...", "B) ...", "C) ...", "D) ..."],
      "correct": "A) ...",
      "explanation": "Brief explanation of why this is correct.",
      "concept": "Short concept name (2-4 words)"
    },
    {
      "id": "q8",
      "type": "fill",
      "text": "Complete: ___ is the term for [specific concept from ${topic}].",
      "answer": "exact correct term",
      "keywords": ["keyword1", "keyword2"],
      "explanation": "Brief explanation.",
      "concept": "Short concept name"
    }
  ]
}

RULES:
- All questions must be DIRECTLY about "${topic}" — not generic
- MCQ wrong options should be plausible misconceptions, not obviously fake
- Fill-in-blank answers should be 1-3 words max
- "correct" for MCQ must EXACTLY match one of the 4 options
- Vary difficulty: q1-3 basic recall, q4-6 application, q7 analysis, q8-10 fill concepts`;

    let questions = null;

    if (gemini.isEnabled()) {
      try {
        const result = await gemini.generateJSON(prompt, `Quiz generator for ${domain || skillName}. Return valid JSON with exactly 10 questions.`);
        if (result?.questions?.length >= 8) {
          questions = result.questions.slice(0, 10);
        }
      } catch (e) {
        console.warn('[quiz] Gemini failed, using fallback:', e.message);
      }
    }

    // Fallback: generate basic questions from the topic
    if (!questions) {
      const t = topic;
      const s = skillName;
      questions = [
        { id: 'q1', type: 'mcq', text: `Which statement best describes "${t}" in the context of ${s}?`, options: [`A) It is a core technique that practitioners apply directly in ${s} work`, `B) It is only used in academic settings, not real ${s} practice`, `C) It is an outdated approach fully replaced by modern methods`, `D) It applies only to advanced practitioners, not beginners`], correct: `A) It is a core technique that practitioners apply directly in ${s} work`, explanation: `"${t}" is a foundational concept directly applied in ${s}.`, concept: t },
        { id: 'q2', type: 'mcq', text: `When learning ${s}, what is the primary purpose of mastering "${t}"?`, options: [`A) To build a strong foundation that enables more advanced techniques`, `B) To complete coursework requirements only`, `C) To impress peers with technical vocabulary`, `D) To replace practical experience entirely`], correct: `A) To build a strong foundation that enables more advanced techniques`, explanation: `Mastering "${t}" builds the foundation for advanced ${s} work.`, concept: t },
        { id: 'q3', type: 'mcq', text: `A beginner in ${s} is practicing "${t}". What should they focus on first?`, options: [`A) Understanding the core principle and practicing with simple examples`, `B) Memorising every edge case before attempting any practice`, `C) Skipping ahead to advanced applications`, `D) Focusing on related topics before attempting "${t}"`], correct: `A) Understanding the core principle and practicing with simple examples`, explanation: `Beginners should grasp the core principle and practice with simple examples.`, concept: t },
        { id: 'q4', type: 'mcq', text: `In a real ${s} scenario, how does "${t}" differ from related concepts?`, options: [`A) It has a specific definition and application that distinguishes it from adjacent concepts`, `B) It is interchangeable with all other ${s} concepts`, `C) It is only distinct in theory, not in practice`, `D) It has no meaningful difference from general ${s} knowledge`], correct: `A) It has a specific definition and application that distinguishes it from adjacent concepts`, explanation: `"${t}" has a distinct definition and practical application.`, concept: t },
        { id: 'q5', type: 'mcq', text: `What is the most common mistake learners make when first encountering "${t}" in ${s}?`, options: [`A) Treating it as purely theoretical rather than practicing hands-on`, `B) Practising too much before understanding the concept`, `C) Applying it correctly in simple cases`, `D) Spending too much time on fundamentals`], correct: `A) Treating it as purely theoretical rather than practicing hands-on`, explanation: `The most common mistake is treating "${t}" as theory-only instead of practising it.`, concept: t },
        { id: 'q6', type: 'mcq', text: `Which outcome best demonstrates genuine mastery of "${t}" in ${s}?`, options: [`A) Applying it correctly in new, unfamiliar scenarios and explaining the reasoning`, `B) Reciting the definition from memory`, `C) Completing a lesson that covered it`, `D) Recognising it when someone else uses it`], correct: `A) Applying it correctly in new, unfamiliar scenarios and explaining the reasoning`, explanation: `True mastery means transfer — applying "${t}" correctly in unseen scenarios.`, concept: t },
        { id: 'q7', type: 'mcq', text: `How does understanding "${t}" improve overall performance in ${s}?`, options: [`A) It enables more accurate, efficient, and professional-quality work`, `B) It only affects one narrow area with no broader impact`, `C) It replaces the need for other ${s} knowledge`, `D) It matters only at expert level, not for beginners`], correct: `A) It enables more accurate, efficient, and professional-quality work`, explanation: `"${t}" contributes to higher quality and efficiency across ${s} tasks.`, concept: t },
        { id: 'q8', type: 'fill', text: `The specific technique or principle described by "${t}" in ${s} is called ___.`, answer: topic, keywords: topic.toLowerCase().split(' '), explanation: `The concept studied today is "${t}".`, concept: t },
        { id: 'q9', type: 'fill', text: `In ${s}, practitioners use ___ to refer to the approach covered in today's session.`, answer: topic, keywords: topic.toLowerCase().split(' '), explanation: `Today's focus was "${t}".`, concept: t },
        { id: 'q10', type: 'fill', text: `Complete: ___ is a key skill within ${s} that today's session focused on.`, answer: skillName, keywords: [skillName.toLowerCase()], explanation: `The skill area is "${skillName}".`, concept: skillName },
      ];
    }

    res.json({ success: true, data: { questions }, error: null });
  } catch (error) {
    console.error('[POST /api/session/quiz]', error);
    res.status(500).json({ success: false, data: null, error: error.message });
  }
});

// ── Auto Notes: generate structured study notes after quiz ──────────────────
router.post('/notes', async (req, res) => {
  try {
    const { skillName, topic, description, conceptSummary, quizScore, weakConcepts } = req.body;
    if (!topic || !skillName) {
      return res.status(400).json({ success: false, data: null, error: 'topic and skillName are required' });
    }

    const weakStr = weakConcepts?.length ? `Areas needing review: ${weakConcepts.join(', ')}` : '';
    const ctxStr = conceptSummary
      ? `Definition: ${conceptSummary.definition || ''}\nKey Points: ${(conceptSummary.keyPoints || []).join('; ')}\nExample: ${conceptSummary.example || ''}\nPro Tip: ${conceptSummary.proTip || ''}`
      : `Topic: ${topic}\nContext: ${description || ''}`;

    const prompt = `Generate comprehensive study notes for a learner who just completed a session on "${topic}" in ${skillName}.
Their quiz score was ${quizScore || 'not available'}%.
${weakStr}

Session context:
${ctxStr}

Return ONLY valid JSON:
{
  "notes": {
    "overview": "2-3 sentence overview of what ${topic} is and why it matters in ${skillName}",
    "definition": "Clear, precise definition of ${topic}",
    "keyConceptsList": ["Concept 1: explanation", "Concept 2: explanation", "Concept 3: explanation", "Concept 4: explanation", "Concept 5: explanation"],
    "howItWorks": "Step-by-step explanation of how ${topic} works or is applied (3-5 steps as a string)",
    "realWorldExamples": ["Example 1 showing ${topic} in action", "Example 2 in a different context", "Example 3 showing a common application"],
    "commonMistakes": ["Mistake 1 and how to avoid it", "Mistake 2 and the fix", "Mistake 3 beginners make"],
    "proTips": ["Expert tip 1 for mastering ${topic}", "Expert tip 2", "Expert tip 3"],
    "areasToReview": ["Area needing more practice", "Concept to revisit"],
    "quickRecap": "One paragraph summary of the entire topic — what it is, how it works, when to use it"
  }
}`;

    let notes = null;

    if (gemini.isEnabled()) {
      try {
        const result = await gemini.generateJSON(prompt, `Study notes generator for ${skillName}. Return valid JSON notes object.`);
        if (result?.notes?.overview) {
          notes = result.notes;
        }
      } catch (e) {
        console.warn('[notes] Gemini failed, using fallback:', e.message);
      }
    }

    // Fallback notes
    if (!notes) {
      const cs = conceptSummary || {};
      notes = {
        overview: cs.definition || `${topic} is a key concept in ${skillName} that practitioners apply regularly.`,
        definition: cs.definition || `${topic}: A foundational technique in ${skillName}.`,
        keyConceptsList: cs.keyPoints || [`${topic} is applied in real-world ${skillName} work`, `Understanding ${topic} builds the foundation for advanced skills`, `Practising ${topic} regularly improves overall mastery`],
        howItWorks: `1. Understand the core principle of ${topic}. 2. Study real examples of ${topic} in ${skillName}. 3. Practice in controlled scenarios. 4. Apply in real projects. 5. Review and refine.`,
        realWorldExamples: [cs.example || `A practitioner uses ${topic} in their daily ${skillName} work`, `${topic} is essential when working on advanced ${skillName} projects`, `Professionals rely on ${topic} to ensure quality results`],
        commonMistakes: [`Treating ${topic} as purely theoretical — always practise hands-on`, `Skipping fundamentals and jumping to advanced applications`, `Not reviewing ${topic} after initial learning`],
        proTips: [cs.proTip || `Master the basics of ${topic} before advancing`, `Connect ${topic} to other concepts in ${skillName}`, `Review your notes on ${topic} within 24 hours to retain better`],
        areasToReview: weakConcepts?.length ? weakConcepts : [`Core definition of ${topic}`, `Practical application of ${topic}`],
        quickRecap: `${topic} is a fundamental component of ${skillName}. ${cs.definition || ''} It is used in real-world practice and forms the basis for more advanced techniques. Mastering it requires both theoretical understanding and hands-on practice.`,
      };
    }

    res.json({ success: true, data: { notes }, error: null });
  } catch (error) {
    console.error('[POST /api/session/notes]', error);
    res.status(500).json({ success: false, data: null, error: error.message });
  }
});

// Health check
router.get('/health', (_req, res) => {
  res.json({
    success: true,
    data: {
      status: 'ok',
      agents: ['GoalAgent', 'DecomposeAgent', 'DiagnosticAgent', 'ScoringAgent', 'CurriculumAgent', 'EvaluatorAgent', 'AdaptorAgent', 'SkillDriftAgent'],
      innovations: ['SkillDigitalTwin', 'PredictiveMasteryForecast', 'AgentDebate', 'ConfidenceCalibration', 'SkillDriftDetection'],
    },
    error: null,
  });
});

export default router;
