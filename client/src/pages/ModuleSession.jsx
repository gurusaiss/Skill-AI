/**
 * ModuleSession.jsx
 * Day/session learning view inside a module.
 * Route: /module/:moduleId/session/:sessionIndex?assignmentId=xxx
 *
 * Flow:
 *  1. Show session content (definitions, key points, explanations, notes)
 *  2. Generate 10 questions via AI (70% MCQ, 30% subjective/fill-blank)
 *  3. Show score, strengths, weaknesses after quiz completion
 */

import React, { useState, useEffect, useRef } from 'react';
import { useParams, useLocation, useNavigate } from 'react-router-dom';

const BASE_URL = import.meta.env.PROD ? '' : 'http://localhost:3001';

const authFetch = async (path, options = {}) => {
  const token = localStorage.getItem('auth_token');
  const res = await fetch(`${BASE_URL}${path}`, {
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(options.headers || {}),
    },
    ...options,
  });
  const text = await res.text();
  let data = null;
  if (text) { try { data = JSON.parse(text); } catch { throw new Error(`Server error (${res.status})`); } }
  if (!res.ok) throw new Error(data?.error?.message || data?.error || `Request failed (${res.status})`);
  return data?.data ?? data;
};

// ─── Content phase ────────────────────────────────────────────────────────────

function ContentPhase({ session, sessionIndex, module, onStartQuiz }) {
  const [readProgress, setReadProgress] = useState(0);
  const contentRef = useRef(null);

  useEffect(() => {
    const handleScroll = () => {
      if (!contentRef.current) return;
      const el = contentRef.current;
      const scrolled = el.scrollTop + el.clientHeight;
      const total = el.scrollHeight;
      setReadProgress(Math.min(100, Math.round((scrolled / total) * 100)));
    };
    const el = contentRef.current;
    if (el) el.addEventListener('scroll', handleScroll, { passive: true });
    return () => el?.removeEventListener('scroll', handleScroll);
  }, []);

  const title = session.title || session.topic || `Day ${sessionIndex + 1}`;
  const description = session.description || session.objective || '';
  const keyPoints = session.keyPoints || session.key_points || session.topics || [];
  const definitions = session.definitions || [];
  const notes = session.notes || session.content || '';
  const explanation = session.explanation || '';

  return (
    <div className="min-h-screen bg-[#0F172A]">
      {/* Top progress */}
      <div className="fixed top-[57px] left-0 right-0 z-10">
        <div className="h-1 bg-indigo-500 transition-all duration-300" style={{ width: `${readProgress}%` }} />
      </div>

      <div className="max-w-3xl mx-auto px-4 sm:px-6 py-10">
        {/* Breadcrumb */}
        <div className="flex items-center gap-2 text-xs text-slate-500 mb-6">
          <span>Module</span>
          <span>/</span>
          <span className="text-slate-300">{title}</span>
        </div>

        {/* Header */}
        <div className="mb-8">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-indigo-600/15 border border-indigo-500/25 text-indigo-300 text-xs font-bold mb-3">
            <span>📚</span> Day {sessionIndex + 1}
          </div>
          <h1 className="text-3xl font-black text-white mb-3 leading-tight">{title}</h1>
          {description && <p className="text-slate-300 text-base leading-relaxed">{description}</p>}
        </div>

        {/* Content scroll area */}
        <div className="space-y-6" ref={contentRef}>
          {/* Definitions */}
          {definitions.length > 0 && (
            <section className="rounded-xl border border-amber-500/20 bg-amber-500/5 p-5">
              <h2 className="text-xs font-bold text-amber-400 uppercase tracking-widest mb-4 flex items-center gap-2">
                <span>📖</span> Key Definitions
              </h2>
              <dl className="space-y-3">
                {definitions.map((def, i) => (
                  <div key={i}>
                    <dt className="text-sm font-bold text-white">
                      {typeof def === 'string' ? def : def.term || def.word || `Term ${i + 1}`}
                    </dt>
                    {def.definition && (
                      <dd className="text-sm text-slate-400 mt-0.5 ml-3">{def.definition}</dd>
                    )}
                  </div>
                ))}
              </dl>
            </section>
          )}

          {/* Key Points */}
          {keyPoints.length > 0 && (
            <section className="rounded-xl border border-indigo-500/20 bg-indigo-500/5 p-5">
              <h2 className="text-xs font-bold text-indigo-400 uppercase tracking-widest mb-4 flex items-center gap-2">
                <span>✅</span> Key Points
              </h2>
              <ul className="space-y-2">
                {keyPoints.map((point, i) => (
                  <li key={i} className="flex gap-3">
                    <span className="w-5 h-5 rounded-full bg-indigo-600/20 border border-indigo-500/30 flex items-center justify-center text-xs font-black text-indigo-400 flex-shrink-0 mt-0.5">
                      {i + 1}
                    </span>
                    <span className="text-sm text-slate-200 leading-relaxed">
                      {typeof point === 'string' ? point : point.title || point.point || JSON.stringify(point)}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {/* Main explanation / notes */}
          {(notes || explanation) && (
            <section className="rounded-xl border border-slate-700/50 bg-slate-800/30 p-5">
              <h2 className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-4 flex items-center gap-2">
                <span>💡</span> Explanation & Notes
              </h2>
              <div className="text-sm text-slate-200 leading-relaxed whitespace-pre-wrap">
                {explanation || notes}
              </div>
            </section>
          )}

          {/* Summary fallback if no structured content */}
          {!notes && !explanation && keyPoints.length === 0 && definitions.length === 0 && (
            <section className="rounded-xl border border-slate-700/50 bg-slate-800/30 p-6 text-center">
              <div className="text-4xl mb-3 opacity-50">📝</div>
              <p className="text-slate-400 text-sm">
                Learning content for <strong className="text-white">{title}</strong> covers the foundational concepts of the module.
                Complete the knowledge quiz below to progress.
              </p>
            </section>
          )}

          {/* Tips */}
          <section className="rounded-xl border border-purple-500/20 bg-purple-500/5 p-5">
            <h2 className="text-xs font-bold text-purple-400 uppercase tracking-widest mb-3 flex items-center gap-2">
              <span>🎯</span> Learning Tips
            </h2>
            <ul className="space-y-1.5 text-xs text-slate-300">
              <li>• Take notes as you read — writing reinforces memory</li>
              <li>• Try to relate concepts to real-world scenarios you know</li>
              <li>• The quiz below has 10 questions — score 70%+ to unlock next session</li>
            </ul>
          </section>
        </div>

        {/* CTA */}
        <div className="mt-10 flex justify-center">
          <button
            onClick={onStartQuiz}
            className="px-8 py-4 rounded-2xl bg-indigo-600 hover:bg-indigo-500 text-white font-black text-base transition-all shadow-xl shadow-indigo-500/25 hover:shadow-indigo-500/40 hover:scale-[1.02] active:scale-100"
          >
            Take Knowledge Quiz →
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Quiz phase ───────────────────────────────────────────────────────────────

const FALLBACK_QUESTIONS = (sessionTitle) => [
  { type: 'mcq', question: `What is the primary goal of learning ${sessionTitle}?`, options: ['A) Understanding core concepts', 'B) Memorizing definitions only', 'C) Skipping prerequisites', 'D) Avoiding practice'], answer: 'A', explanation: 'The primary goal is to build understanding of core concepts.' },
  { type: 'mcq', question: 'Which approach best supports deep learning?', options: ['A) Reading once quickly', 'B) Active recall and practice', 'C) Passive observation only', 'D) Copying notes verbatim'], answer: 'B', explanation: 'Active recall and practice is proven to improve retention.' },
  { type: 'mcq', question: 'How should you apply newly learned skills?', options: ['A) Wait until you feel ready', 'B) Only in controlled environments', 'C) Practice in real scenarios as early as possible', 'D) Avoid practical applications initially'], answer: 'C', explanation: 'Early practical application reinforces learning and identifies gaps.' },
  { type: 'fill_blank', question: `The most effective way to retain knowledge from ${sessionTitle} is through consistent ______.`, answer: 'practice', explanation: 'Consistent practice is the key to retention and skill development.' },
  { type: 'mcq', question: 'What is the benefit of breaking learning into sessions?', options: ['A) Allows procrastination', 'B) Reduces cognitive load and improves focus', 'C) Makes evaluation harder', 'D) Reduces accountability'], answer: 'B', explanation: 'Spaced learning reduces cognitive load and improves long-term retention.' },
  { type: 'subjective', question: `Explain how the concepts from ${sessionTitle} can be applied in a real-world work scenario.`, answer: 'Apply the concepts systematically using the learned frameworks, adapting to specific context and requirements.', explanation: 'Application demonstrates genuine understanding beyond memorization.' },
  { type: 'mcq', question: 'Which metric best measures learning effectiveness?', options: ['A) Time spent reading', 'B) Number of pages covered', 'C) Ability to apply concepts correctly', 'D) How many times content was accessed'], answer: 'C', explanation: 'Application ability is the truest measure of learning.' },
  { type: 'mcq', question: 'What should you do when you encounter a difficult concept?', options: ['A) Skip it and move on', 'B) Mark it and return with a fresh perspective', 'C) Ask someone else to learn it for you', 'D) Ignore it if it seems complex'], answer: 'B', explanation: 'Returning to difficult concepts with a fresh perspective often leads to breakthrough understanding.' },
  { type: 'fill_blank', question: 'Learning objectives are best achieved through ______ practice and application.', answer: 'deliberate', explanation: 'Deliberate practice with focused intent accelerates skill development.' },
  { type: 'mcq', question: 'What is the purpose of a knowledge quiz after learning?', options: ['A) To punish learners who forget', 'B) To reinforce learning and identify knowledge gaps', 'C) To create anxiety about the subject', 'D) To replace the learning material'], answer: 'B', explanation: 'Quizzes act as retrieval practice, which significantly improves long-term memory.' },
];

function QuizPhase({ session, sessionIndex, module, onComplete }) {
  const [questions, setQuestions] = useState([]);
  const [answers, setAnswers] = useState({});
  const [loadingQ, setLoadingQ] = useState(true);
  const [submitted, setSubmitted] = useState(false);
  const [score, setScore] = useState(null);
  const [currentQ, setCurrentQ] = useState(0);

  const sessionTitle = session?.title || session?.topic || `Day ${sessionIndex + 1}`;

  useEffect(() => {
    loadQuestions();
  }, []);

  const loadQuestions = async () => {
    setLoadingQ(true);
    try {
      const res = await authFetch('/api/assessments/generate', {
        method: 'POST',
        body: JSON.stringify({
          moduleTitle: module?.title || 'Learning Module',
          moduleDescription: session?.description || session?.objective || module?.description || '',
          skills: module?.skills || [],
          numQuestions: 10,
          questionTypes: ['mcq', 'mcq', 'mcq', 'mcq', 'mcq', 'mcq', 'mcq', 'subjective', 'fill_blank', 'fill_blank'],
          sessionTitle,
        }),
      });
      const qs = Array.isArray(res) ? res : (res?.questions || []);
      setQuestions(qs.length >= 5 ? qs.slice(0, 10) : FALLBACK_QUESTIONS(sessionTitle));
    } catch {
      setQuestions(FALLBACK_QUESTIONS(sessionTitle));
    } finally {
      setLoadingQ(false);
    }
  };

  const handleAnswer = (qIdx, value) => {
    setAnswers(prev => ({ ...prev, [qIdx]: value }));
  };

  const handleSubmit = () => {
    // Grade all questions
    let correct = 0;
    const results = questions.map((q, i) => {
      const userAnswer = (answers[i] || '').toString().trim().toLowerCase();
      const correctAnswer = (q.answer || '').toString().trim().toLowerCase();
      const isCorrect = q.type === 'subjective'
        ? userAnswer.length > 20  // subjective: any substantial answer
        : userAnswer === correctAnswer || userAnswer.startsWith(correctAnswer.charAt(0));
      if (isCorrect) correct++;
      return { ...q, userAnswer: answers[i] || '', isCorrect };
    });
    const pct = Math.round((correct / questions.length) * 100);
    setScore({ correct, total: questions.length, pct, results });
    setSubmitted(true);
  };

  if (loadingQ) {
    return (
      <div className="min-h-screen bg-[#0F172A] flex items-center justify-center">
        <div className="text-center">
          <div className="text-4xl mb-4 animate-spin">⟳</div>
          <p className="text-slate-400 text-sm">Generating your knowledge quiz…</p>
          <p className="text-slate-600 text-xs mt-1">Using AI to tailor questions to this session</p>
        </div>
      </div>
    );
  }

  if (submitted && score) {
    return <ScorePhase score={score} sessionTitle={sessionTitle} onComplete={onComplete} />;
  }

  const q = questions[currentQ];
  if (!q) return null;

  return (
    <div className="min-h-screen bg-[#0F172A]">
      <div className="max-w-2xl mx-auto px-4 sm:px-6 py-10">
        {/* Progress */}
        <div className="mb-6">
          <div className="flex items-center justify-between text-xs text-slate-500 mb-2">
            <span>Question {currentQ + 1} of {questions.length}</span>
            <span>{Object.keys(answers).length} answered</span>
          </div>
          <div className="h-2 rounded-full bg-slate-800 overflow-hidden">
            <div className="h-full bg-indigo-500 rounded-full transition-all" style={{ width: `${((currentQ + 1) / questions.length) * 100}%` }} />
          </div>
        </div>

        {/* Question card */}
        <div className="rounded-2xl border border-slate-700/50 bg-slate-800/40 p-6 mb-6">
          <div className="flex items-center gap-2 mb-4">
            <span className={`text-xs font-bold uppercase px-2 py-0.5 rounded-full border ${
              q.type === 'mcq' ? 'bg-indigo-500/15 text-indigo-400 border-indigo-500/30'
              : q.type === 'fill_blank' ? 'bg-amber-500/15 text-amber-400 border-amber-500/30'
              : 'bg-purple-500/15 text-purple-400 border-purple-500/30'
            }`}>
              {q.type === 'fill_blank' ? 'Fill Blank' : q.type === 'subjective' ? 'Short Answer' : 'Multiple Choice'}
            </span>
            {q.difficulty && (
              <span className={`text-xs font-bold uppercase px-2 py-0.5 rounded-full border ${
                q.difficulty === 'easy' ? 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30'
                : q.difficulty === 'hard' ? 'bg-rose-500/15 text-rose-400 border-rose-500/30'
                : 'bg-amber-500/15 text-amber-400 border-amber-500/30'
              }`}>
                {q.difficulty}
              </span>
            )}
          </div>

          <p className="text-lg font-bold text-white leading-snug mb-6">{q.question}</p>

          {/* MCQ options */}
          {q.type === 'mcq' && q.options && (
            <div className="space-y-2.5">
              {q.options.map((opt, oi) => {
                const letter = ['A', 'B', 'C', 'D'][oi];
                const selected = answers[currentQ] === letter;
                return (
                  <button
                    key={oi}
                    onClick={() => handleAnswer(currentQ, letter)}
                    className={`w-full text-left rounded-xl border px-4 py-3 transition-all text-sm font-medium ${
                      selected
                        ? 'border-indigo-500/60 bg-indigo-600/20 text-indigo-100'
                        : 'border-slate-700/50 bg-slate-800/50 text-slate-300 hover:border-slate-600 hover:bg-slate-800'
                    }`}
                  >
                    <span className={`inline-flex w-6 h-6 rounded-full items-center justify-center text-xs font-black mr-2 ${
                      selected ? 'bg-indigo-600 text-white' : 'bg-slate-700 text-slate-400'
                    }`}>{letter}</span>
                    {opt.replace(/^[A-D]\)\s*/, '')}
                  </button>
                );
              })}
            </div>
          )}

          {/* Fill blank */}
          {q.type === 'fill_blank' && (
            <input
              value={answers[currentQ] || ''}
              onChange={e => handleAnswer(currentQ, e.target.value)}
              placeholder="Type your answer here…"
              className="w-full px-4 py-3 rounded-xl border border-slate-700 bg-slate-900/60 text-white placeholder-slate-600 text-sm focus:outline-none focus:border-indigo-500/60 focus:ring-1 focus:ring-indigo-500/30"
            />
          )}

          {/* Subjective */}
          {q.type === 'subjective' && (
            <textarea
              value={answers[currentQ] || ''}
              onChange={e => handleAnswer(currentQ, e.target.value)}
              placeholder="Write your detailed answer here…"
              rows={5}
              className="w-full px-4 py-3 rounded-xl border border-slate-700 bg-slate-900/60 text-white placeholder-slate-600 text-sm focus:outline-none focus:border-indigo-500/60 focus:ring-1 focus:ring-indigo-500/30 resize-none"
            />
          )}
        </div>

        {/* Navigation */}
        <div className="flex items-center justify-between">
          <button
            onClick={() => setCurrentQ(prev => Math.max(0, prev - 1))}
            disabled={currentQ === 0}
            className="px-4 py-2 rounded-xl border border-slate-700 text-slate-400 hover:text-white hover:bg-slate-800 text-sm font-semibold transition-all disabled:opacity-30"
          >
            ← Previous
          </button>

          <div className="flex gap-1.5">
            {questions.map((_, i) => (
              <button
                key={i}
                onClick={() => setCurrentQ(i)}
                className={`w-6 h-6 rounded-full text-xs font-black transition-all ${
                  i === currentQ ? 'bg-indigo-600 text-white'
                  : answers[i] !== undefined ? 'bg-emerald-600/30 text-emerald-400 border border-emerald-500/30'
                  : 'bg-slate-700 text-slate-500'
                }`}
              >
                {i + 1}
              </button>
            ))}
          </div>

          {currentQ < questions.length - 1 ? (
            <button
              onClick={() => setCurrentQ(prev => Math.min(questions.length - 1, prev + 1))}
              className="px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-semibold transition-all"
            >
              Next →
            </button>
          ) : (
            <button
              onClick={handleSubmit}
              disabled={Object.keys(answers).length < questions.length}
              className="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-bold transition-all disabled:opacity-40 disabled:cursor-not-allowed"
            >
              Submit Quiz
            </button>
          )}
        </div>

        {Object.keys(answers).length < questions.length && currentQ === questions.length - 1 && (
          <p className="text-center text-xs text-amber-400 mt-3">
            {questions.length - Object.keys(answers).length} question(s) unanswered
          </p>
        )}
      </div>
    </div>
  );
}

// ─── Score phase ──────────────────────────────────────────────────────────────

function ScorePhase({ score, sessionTitle, onComplete }) {
  const { pct, correct, total, results } = score;
  const passed = pct >= 70;

  const strengths = results.filter(r => r.isCorrect).slice(0, 3);
  const weaknesses = results.filter(r => !r.isCorrect).slice(0, 3);

  return (
    <div className="min-h-screen bg-[#0F172A]">
      <div className="max-w-2xl mx-auto px-4 sm:px-6 py-10">
        {/* Score card */}
        <div className={`rounded-2xl border p-8 text-center mb-8 ${passed ? 'border-emerald-500/30 bg-emerald-500/5' : 'border-amber-500/30 bg-amber-500/5'}`}>
          <div className="text-6xl mb-4">{pct >= 90 ? '🌟' : pct >= 70 ? '🎉' : '📚'}</div>
          <h1 className="text-4xl font-black text-white mb-2">{pct}%</h1>
          <p className={`text-lg font-bold mb-1 ${passed ? 'text-emerald-400' : 'text-amber-400'}`}>
            {passed ? 'Session Passed!' : 'Keep Practicing'}
          </p>
          <p className="text-slate-400 text-sm">{correct} correct out of {total} questions</p>
          {passed ? (
            <p className="text-emerald-300 text-xs mt-2">Next session is now unlocked 🚀</p>
          ) : (
            <p className="text-amber-300 text-xs mt-2">Score 70%+ to unlock the next session</p>
          )}
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-6 mb-8">
          {/* Strengths */}
          {strengths.length > 0 && (
            <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-5">
              <h3 className="text-xs font-bold text-emerald-400 uppercase tracking-widest mb-3 flex items-center gap-2">
                <span>💪</span> Strengths
              </h3>
              <ul className="space-y-2">
                {strengths.map((r, i) => (
                  <li key={i} className="text-xs text-slate-300 leading-snug flex gap-2">
                    <span className="text-emerald-400 flex-shrink-0">✓</span>
                    <span className="line-clamp-2">{r.question}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Weaknesses */}
          {weaknesses.length > 0 && (
            <div className="rounded-xl border border-rose-500/20 bg-rose-500/5 p-5">
              <h3 className="text-xs font-bold text-rose-400 uppercase tracking-widest mb-3 flex items-center gap-2">
                <span>🎯</span> Areas to Review
              </h3>
              <ul className="space-y-2">
                {weaknesses.map((r, i) => (
                  <li key={i} className="text-xs text-slate-300 leading-snug flex gap-2">
                    <span className="text-rose-400 flex-shrink-0">✗</span>
                    <span className="line-clamp-2">{r.question}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>

        {/* Recommendations */}
        <div className="rounded-xl border border-indigo-500/20 bg-indigo-500/5 p-5 mb-8">
          <h3 className="text-xs font-bold text-indigo-400 uppercase tracking-widest mb-3">
            💡 Recommendations
          </h3>
          <ul className="space-y-1.5 text-xs text-slate-300">
            {pct >= 90 && <li>• Excellent work! Consider exploring advanced topics in this area.</li>}
            {pct >= 70 && pct < 90 && <li>• Good performance. Review the questions you missed to solidify understanding.</li>}
            {pct < 70 && <li>• Review the session content again, focusing on the areas you found challenging.</li>}
            {weaknesses.length > 0 && <li>• Focus on: {weaknesses.map(r => r.question.slice(0, 40)).join('; ')}…</li>}
            <li>• Apply what you've learned in a real project or work scenario.</li>
          </ul>
        </div>

        {/* Review answers */}
        <div className="rounded-xl border border-slate-700/50 bg-slate-800/20 overflow-hidden mb-8">
          <div className="p-4 border-b border-slate-700/40">
            <h3 className="text-xs font-bold text-slate-400 uppercase tracking-widest">Answer Review</h3>
          </div>
          <div className="divide-y divide-slate-700/30 max-h-80 overflow-y-auto">
            {results.map((r, i) => (
              <div key={i} className={`p-4 ${r.isCorrect ? 'bg-emerald-500/3' : 'bg-rose-500/3'}`}>
                <div className="flex gap-3">
                  <span className={`flex-shrink-0 text-sm ${r.isCorrect ? 'text-emerald-400' : 'text-rose-400'}`}>
                    {r.isCorrect ? '✓' : '✗'}
                  </span>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs text-white font-semibold mb-1">{r.question}</p>
                    {!r.isCorrect && (
                      <>
                        <p className="text-xs text-rose-400">Your answer: {r.userAnswer || '(no answer)'}</p>
                        <p className="text-xs text-emerald-400">Correct: {r.answer}</p>
                      </>
                    )}
                    {r.explanation && (
                      <p className="text-xs text-slate-500 mt-1 italic">{r.explanation}</p>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="flex gap-3">
          <button
            onClick={onComplete}
            className="flex-1 py-3 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-bold transition-all text-sm"
          >
            {passed ? '← Back to Sessions →' : '← Review Content'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Main ModuleSession ───────────────────────────────────────────────────────

export default function ModuleSession() {
  const { moduleId, sessionIndex: sessionIndexStr } = useParams();
  const location = useLocation();
  const navigate = useNavigate();

  const searchParams = new URLSearchParams(location.search);
  const assignmentId = searchParams.get('assignmentId');
  const sessionIndex = parseInt(sessionIndexStr || '0', 10);

  const [phase, setPhase] = useState('content'); // 'content' | 'quiz' | 'score'
  const [module, setModule] = useState(null);
  const [session, setSession] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    loadData();
  }, [moduleId, sessionIndex]);

  const loadData = async () => {
    setLoading(true);
    try {
      const mod = await authFetch(`/api/modules/${moduleId}`);
      if (!mod) throw new Error('Module not found');
      setModule(mod);

      const sessions = mod.sessions || mod.content?.sessions || [];
      const sess = sessions[sessionIndex];
      if (!sess) throw new Error(`Session ${sessionIndex + 1} not found`);
      setSession(sess);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleQuizComplete = async (score) => {
    // Save progress
    if (assignmentId && score?.pct >= 70) {
      try {
        await authFetch(`/api/assignments/${assignmentId}`, {
          method: 'PUT',
          body: JSON.stringify({
            sessionProgress: { [sessionIndex]: 'completed' },
            status: 'in_progress',
            progress: Math.min(100, Math.round(((sessionIndex + 1) / (module?.sessions?.length || 1)) * 100)),
          }),
        });
      } catch (_) {}
    }
    // Go back to module dashboard sessions tab
    navigate(`/module/${moduleId}/learn${assignmentId ? `?assignmentId=${assignmentId}` : ''}`);
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-[#0F172A] flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin text-indigo-400 text-4xl mb-4">⟳</div>
          <p className="text-slate-400 text-sm">Loading session…</p>
        </div>
      </div>
    );
  }

  if (error || !module || !session) {
    return (
      <div className="min-h-screen bg-[#0F172A] flex items-center justify-center px-4">
        <div className="text-center max-w-sm">
          <div className="text-5xl mb-4">⚠️</div>
          <h2 className="text-xl font-black text-white mb-2">Session Not Found</h2>
          <p className="text-slate-400 text-sm mb-6">{error}</p>
          <button
            onClick={() => navigate(`/module/${moduleId}/learn${assignmentId ? `?assignmentId=${assignmentId}` : ''}`)}
            className="px-6 py-3 rounded-xl font-bold bg-indigo-600 hover:bg-indigo-500 text-white transition-all"
          >
            ← Back to Module
          </button>
        </div>
      </div>
    );
  }

  if (phase === 'content') {
    return (
      <ContentPhase
        session={session}
        sessionIndex={sessionIndex}
        module={module}
        onStartQuiz={() => setPhase('quiz')}
      />
    );
  }

  if (phase === 'quiz') {
    return (
      <QuizPhase
        session={session}
        sessionIndex={sessionIndex}
        module={module}
        onComplete={handleQuizComplete}
      />
    );
  }

  return null;
}
