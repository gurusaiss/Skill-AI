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
import { QUIZ_MIX, mixCounts, enforceMix } from './QuestionMix.js';

export async function generateSessionQuiz({ moduleTitle, moduleDescription, sessionTitle = 'Session', topics, keyPoints, numQuestions = 10, mix = QUIZ_MIX }) {
  const num = Math.min(Math.max(parseInt(numQuestions) || 10, 2), 20);
  const topicsStr = Array.isArray(topics) && topics.length > 0 ? topics.join(', ') : 'core concepts';
  const keyPointsStr = Array.isArray(keyPoints) ? keyPoints.join('. ') : '';
  const target = mixCounts(num, mix);

  // The mix is part of the cache identity: without it, entries written under
  // the previous "mostly mcq" wording would keep being served with the wrong
  // distribution long after this change shipped.
  const mixTag = `${target.mcq}-${target.subjective}-${target.fill_blank}`;
  const cacheKey = `module_quiz_${LLMCache.hash([moduleTitle, sessionTitle, topicsStr, num, mixTag].join('|'))}`;
  const cached = LLMCache.get(cacheKey);
  if (cached) return cached;

  // Exact counts, not "mostly mcq" — vague wording let the model drift, and
  // there was no post-generation enforcement to catch it.
  const mixLine = [
    `${target.mcq} multiple-choice (type "mcq", exactly 4 options labelled "A) ".."D) ", answer is the single letter)`,
    target.subjective ? `${target.subjective} subjective (type "subjective", no options, answer is a model answer)` : null,
    target.fill_blank ? `${target.fill_blank} fill-in-the-blank (type "fill_blank", no options, stem contains "______", answer is the missing word/phrase)` : null,
  ].filter(Boolean).join('\n- ');

  const prompt = `Create exactly ${num} quiz questions testing comprehension of this training session's content.

Module: ${moduleTitle || 'Learning Module'}
Session: ${sessionTitle}
Topics covered: ${topicsStr}
${moduleDescription ? `Module context: ${moduleDescription}` : ''}
${keyPointsStr ? `Key points taught in this session: ${keyPointsStr}` : ''}

REQUIRED TYPE BREAKDOWN — return exactly:
- ${mixLine}

Return ONLY a JSON object: { "questions": [ { "type": "mcq"|"fill_blank"|"subjective", "question": "...", "options": ["A) ...", "B) ...", "C) ...", "D) ..."] (mcq only), "answer": "...", "explanation": "..." } ] }
Every question must be specific to the topics/key points above, not generic.`;

  try {
    const result = await GeminiService.generateJSON(prompt, '', { maxTokens: 2500 });
    const list = Array.isArray(result?.questions) ? result.questions : (Array.isArray(result) ? result : []);
    if (list.length >= Math.min(3, num)) {
      // Deterministic backstop: normalises every question into a valid shape
      // for its type, drops unsalvageable ones, and rebalances to the target
      // mix by relabelling surplus MCQs. Guarantees exactly `num` questions
      // in the requested distribution regardless of how the model drifted.
      const questions = enforceMix(list, num, mix);
      if (questions.length > 0) {
        LLMCache.set(cacheKey, questions, LLMCache.TTL.QUIZ);
        return questions;
      }
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
