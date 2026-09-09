/**
 * SessionQuizGenerator.js
 *
 * Single-purpose, fast generator for a module-session's "Knowledge Quiz" —
 * NOT the heavy JD-source-grounded assessment pipeline (AssessmentGenerator.js)
 * used for real hiring/onboarding assessments. One LLM call, cached by
 * (module + session + topics) since a given session's content never changes,
 * so repeat callers (every employee on the same session, any retry) hit the
 * cache instead of paying for another generation.
 *
 * Extracted from routes/assessment.js's POST /generate handler so the same
 * logic can be reused to pre-generate and persist every session's quiz at
 * module-creation time (see ensureAllSessionQuizzes below), instead of only
 * generating one on-demand the first time an employee opens that specific day.
 */
import GeminiService from './GeminiService.js';
import LLMCache from './LLMCache.js';

export async function generateSessionQuiz({ moduleTitle, moduleDescription, sessionTitle = 'Session', topics, keyPoints, numQuestions = 10 }) {
  const num = Math.min(Math.max(parseInt(numQuestions) || 10, 2), 20);
  const topicsStr = Array.isArray(topics) && topics.length > 0 ? topics.join(', ') : 'core concepts';
  const keyPointsStr = Array.isArray(keyPoints) ? keyPoints.join('. ') : '';

  const cacheKey = `module_quiz_${LLMCache.hash([moduleTitle, sessionTitle, topicsStr, num].join('|'))}`;
  const cached = LLMCache.get(cacheKey);
  if (cached) return cached;

  const prompt = `Create exactly ${num} quiz questions testing comprehension of this training session's content.

Module: ${moduleTitle || 'Learning Module'}
Session: ${sessionTitle}
Topics covered: ${topicsStr}
${moduleDescription ? `Module context: ${moduleDescription}` : ''}
${keyPointsStr ? `Key points taught in this session: ${keyPointsStr}` : ''}

Return ONLY a JSON object: { "questions": [ { "type": "mcq"|"fill_blank"|"subjective", "question": "...", "options": ["A) ...", "B) ...", "C) ...", "D) ..."] (mcq only), "answer": "...", "explanation": "..." } ] }
Mix of types: mostly mcq, a couple fill_blank, one subjective. Questions must be specific to the topics/key points above, not generic.`;

  try {
    const result = await GeminiService.generateJSON(prompt, '', { maxTokens: 2500 });
    const list = Array.isArray(result?.questions) ? result.questions : (Array.isArray(result) ? result : []);
    if (list.length >= Math.min(3, num)) {
      const questions = list.slice(0, num);
      LLMCache.set(cacheKey, questions, LLMCache.TTL.QUIZ);
      return questions;
    }
  } catch (err) {
    console.warn('[SessionQuizGenerator] LLM failed:', err.message);
  }
  return null;
}

/**
 * Fills in a real quiz for every session in `sessions` that doesn't already
 * have one (>=3 questions) — in parallel, since each call is small/fast and
 * independent. Mutates and returns a new sessions array; never throws (a
 * session that fails generation is left as-is, so the module still saves).
 *
 * Call this once at module-creation time (all 3 generation pipelines) so an
 * employee opening ANY day already has its quiz sitting in the DB — no
 * per-day "Generating your knowledge quiz…" wait ever, instead of only the
 * lucky case where the single big content-generation call happened to include
 * every session's quiz within its own token budget.
 */
export async function ensureAllSessionQuizzes(sessions, { moduleTitle, moduleDescription } = {}) {
  if (!Array.isArray(sessions) || sessions.length === 0) return sessions;
  return Promise.all(sessions.map(async (session) => {
    const hasQuiz = Array.isArray(session.quiz) && session.quiz.length >= 3;
    if (hasQuiz) return session;
    const topics = session.topics || session.keyPoints?.slice(0, 5) || [];
    const quiz = await generateSessionQuiz({
      moduleTitle,
      moduleDescription,
      sessionTitle: session.title || session.topic || 'Session',
      topics,
      keyPoints: session.keyPoints,
      numQuestions: 10,
    });
    return quiz ? { ...session, quiz } : session;
  }));
}
