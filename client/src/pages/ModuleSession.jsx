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
import { authFetch } from '../utils/authFetch.js';

// ─── Content phase ────────────────────────────────────────────────────────────

function downloadSessionNotes(session, sessionIndex, moduleTitle) {
  const title = session.title || session.topic || `Day ${sessionIndex + 1}`;
  const keyPoints = session.keyPoints || session.key_points || session.topics || [];
  const definitions = session.definitions || [];
  const notes = session.notes || session.content || '';
  const explanation = session.explanation || '';

  const pointsHtml = keyPoints.length > 0
    ? `<h2>Key Points</h2><ol>${keyPoints.map(p => `<li>${typeof p === 'string' ? p : p.title || p.point || ''}</li>`).join('')}</ol>`
    : '';
  const defsHtml = definitions.length > 0
    ? `<h2>Key Definitions</h2><dl>${definitions.map(d => `<dt><strong>${typeof d === 'string' ? d : d.term || ''}</strong></dt>${d.definition ? `<dd>${d.definition}</dd>` : ''}`).join('')}</dl>`
    : '';
  const notesHtml = (explanation || notes)
    ? `<h2>Explanation & Notes</h2><div style="white-space:pre-wrap">${explanation || notes}</div>`
    : '';

  const html = `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>${title} — Learning Notes</title>
<style>
  body{font-family:'Segoe UI',Arial,sans-serif;max-width:800px;margin:40px auto;padding:0 32px;color:#1e293b;line-height:1.7}
  h1{color:#1e40af;font-size:24px;border-bottom:3px solid #e2e8f0;padding-bottom:12px}
  h2{color:#334155;font-size:16px;margin:28px 0 10px;border-bottom:1px solid #e2e8f0;padding-bottom:6px}
  .meta{font-size:12px;color:#64748b;margin-bottom:24px}
  ol,ul{padding-left:20px}
  li{margin-bottom:8px;font-size:14px}
  dt{font-weight:700;font-size:14px;margin-top:10px}
  dd{font-size:13px;color:#475569;margin-left:16px}
  div[style]{font-size:14px;color:#334155}
  .footer{margin-top:40px;font-size:11px;color:#94a3b8;border-top:1px solid #e2e8f0;padding-top:12px}
</style></head><body>
<div class="meta">Module: <strong>${moduleTitle || 'Learning Module'}</strong></div>
<h1>Day ${sessionIndex + 1}: ${title}</h1>
${session.description ? `<p style="color:#475569">${session.description}</p>` : ''}
${defsHtml}${pointsHtml}${notesHtml}
<div class="footer">Downloaded from SkillForge AI &nbsp;|&nbsp; ${new Date().toLocaleDateString()}</div>
</body></html>`;

  const blob = new Blob([html], { type: 'text/html' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `Day${sessionIndex + 1}-${title.replace(/[^a-z0-9]/gi, '-')}-Notes.html`;
  a.click();
  URL.revokeObjectURL(url);
}

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
              <li>• The quiz below has 10 questions — answer all questions to complete this session</li>
            </ul>
          </section>
        </div>

        {/* CTA */}
        <div className="mt-10 flex flex-col sm:flex-row items-center justify-center gap-3">
          <button
            onClick={() => downloadSessionNotes(session, sessionIndex, module?.title)}
            className="px-6 py-3 rounded-2xl border border-slate-600/60 bg-slate-800/60 hover:bg-slate-700/60 text-slate-300 hover:text-white font-semibold text-sm transition-all flex items-center gap-2"
          >
            📥 Download Notes
          </button>
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

const FALLBACK_QUESTIONS = (sessionTitle, topics = []) => {
  const topicStr = topics.length > 0 ? topics[0] : sessionTitle;
  return [
    { type: 'mcq', question: `What is a key characteristic of ${topicStr}?`, options: [`A) It is used in ${topicStr} workflows`, 'B) It is rarely applied in practice', 'C) It only applies to large organizations', 'D) It requires no foundational knowledge'], answer: 'A', explanation: `${topicStr} is primarily valuable because it enables practical workflows and outcomes.` },
    { type: 'mcq', question: `Which best describes the primary purpose of ${topicStr}?`, options: ['A) To complicate existing processes', `B) To improve efficiency and outcomes in ${sessionTitle}`, 'C) To replace all manual work immediately', 'D) To reduce team collaboration'], answer: 'B', explanation: `The primary purpose of ${topicStr} is improving efficiency and driving better outcomes.` },
    { type: 'mcq', question: `When implementing ${topicStr}, what is the most important first step?`, options: ['A) Skip planning and start immediately', `B) Understand the current state and requirements`, 'C) Copy what competitors are doing', 'D) Avoid stakeholder input'], answer: 'B', explanation: 'Understanding current state and requirements ensures the implementation addresses actual needs.' },
    { type: 'fill_blank', question: `In ${sessionTitle}, ${topicStr} is primarily used to ______ business outcomes.`, answer: 'improve', explanation: `${topicStr} is applied to improve measurable business outcomes.` },
    { type: 'mcq', question: `What is a common challenge when working with ${topicStr}?`, options: ['A) Too much available documentation', 'B) Ensuring consistent application across the organization', 'C) Excessive simplicity', 'D) Lack of industry relevance'], answer: 'B', explanation: 'Consistent organizational application is one of the most common implementation challenges.' },
    { type: 'subjective', question: `Describe how ${topicStr} from "${sessionTitle}" would be applied to solve a real problem in your organization.`, answer: `Apply ${topicStr} by first identifying the specific problem, then systematically implementing the concepts from this session, measuring outcomes, and iterating based on results.`, explanation: 'Application to real organizational problems demonstrates genuine understanding.' },
    { type: 'mcq', question: `Which stakeholder group benefits most directly from ${topicStr}?`, options: ['A) Only the IT department', 'B) Executive leadership exclusively', 'C) The teams directly working in the relevant processes', 'D) External vendors only'], answer: 'C', explanation: 'Teams directly working in the relevant processes see the most immediate benefit.' },
    { type: 'mcq', question: `What measurement indicates successful implementation of ${topicStr}?`, options: ['A) The number of meetings held', 'B) Time spent in training', 'C) Measurable improvement in targeted outcomes', 'D) Number of tools purchased'], answer: 'C', explanation: 'Measurable improvement in targeted outcomes is the definitive success indicator.' },
    { type: 'fill_blank', question: `Effective use of ${topicStr} requires both technical knowledge and ______ skills.`, answer: 'practical', explanation: 'Combining technical knowledge with practical application skills is essential for real-world effectiveness.' },
    { type: 'mcq', question: `What is the relationship between ${topicStr} and the broader ${sessionTitle} discipline?`, options: [`A) ${topicStr} is an isolated concept with no connections`, `B) ${topicStr} is a foundational element that supports the broader discipline`, 'C) They are unrelated topics', 'D) The broader discipline depends on ignoring this concept'], answer: 'B', explanation: `${topicStr} serves as a foundational building block within the broader ${sessionTitle} framework.` },
  ];
};

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
      // Build rich context from this specific session's topics
      const sessionTopics = session?.topics || session?.keyPoints?.slice(0, 5) || [];
      const sessionKeyPoints = session?.keyPoints || [];

      const res = await authFetch('/api/assessments/generate', {
        method: 'POST',
        body: JSON.stringify({
          moduleTitle: module?.title || 'Learning Module',
          moduleDescription: session?.description || session?.objective || module?.description || '',
          skills: session?.topics || module?.skills || [],
          numQuestions: 10,
          questionTypes: ['mcq', 'mcq', 'mcq', 'mcq', 'mcq', 'mcq', 'mcq', 'subjective', 'fill_blank', 'fill_blank'],
          sessionTitle,
          sessionTopics,
          sessionKeyPoints,
        }),
      });
      const qs = Array.isArray(res) ? res : (res?.questions || []);
      setQuestions(qs.length >= 5 ? qs.slice(0, 10) : FALLBACK_QUESTIONS(sessionTitle, sessionTopics));
    } catch {
      const sessionTopics = session?.topics || [];
      setQuestions(FALLBACK_QUESTIONS(sessionTitle, sessionTopics));
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
    const scoreData = { correct, total: questions.length, pct, results };
    setScore(scoreData);
    setSubmitted(true);
    // Immediately call onComplete with score so parent can save progress + show ScorePhase
    onComplete(scoreData);
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

  // Once submitted, parent ModuleSession takes over with ScorePhase
  if (submitted) return null;

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

function ScorePhase({ score, sessionTitle, sessionIndex, totalSessions, onRewatch, onRetryQuiz, onNextSession, onDashboard, saving }) {
  const { pct, correct, total, results } = score;
  const passed = pct >= 70;
  const hasNext = sessionIndex + 1 < totalSessions;

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
            {passed ? 'Session Complete!' : 'Session Complete'}
          </p>
          <p className="text-slate-400 text-sm">{correct} correct out of {total} questions</p>
          {saving ? (
            <p className="text-slate-400 text-xs mt-2 animate-pulse">💾 Saving progress…</p>
          ) : (
            <p className="text-emerald-300 text-xs mt-2">✓ Progress saved</p>
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

          {/* Areas to Review */}
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
            {pct < 70 && <li>• Review the session content again to reinforce these concepts before moving on.</li>}
            {weaknesses.length > 0 && <li>• Focus on: {weaknesses.map(r => r.question.slice(0, 40)).join('; ')}…</li>}
            <li>• Apply what you've learned in a real project or work scenario.</li>
          </ul>
        </div>

        {/* Action buttons */}
        <div className="grid grid-cols-2 gap-3 mb-6">
          <button
            onClick={onRewatch}
            className="flex flex-col items-center gap-1.5 py-3.5 px-4 rounded-xl border border-slate-700/50 bg-slate-800/40 hover:bg-slate-700/50 hover:border-slate-600 text-slate-300 hover:text-white transition-all text-sm font-semibold"
          >
            <span className="text-lg">🔁</span>
            <span>Rewatch Session</span>
            <span className="text-xs text-slate-500 font-normal">Review the material</span>
          </button>
          <button
            onClick={onRetryQuiz}
            className="flex flex-col items-center gap-1.5 py-3.5 px-4 rounded-xl border border-slate-700/50 bg-slate-800/40 hover:bg-slate-700/50 hover:border-slate-600 text-slate-300 hover:text-white transition-all text-sm font-semibold"
          >
            <span className="text-lg">🔄</span>
            <span>Retry Quiz</span>
            <span className="text-xs text-slate-500 font-normal">Try for a higher score</span>
          </button>
        </div>

        <div className="flex flex-col gap-3">
          {hasNext && (
            <button
              onClick={onNextSession}
              className="w-full py-3.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-bold transition-all text-sm flex items-center justify-center gap-2 shadow-lg shadow-indigo-500/20"
            >
              <span>Continue to Day {sessionIndex + 2}</span>
              <span>→</span>
            </button>
          )}
          <button
            onClick={onDashboard}
            className={`w-full py-3 rounded-xl border text-sm font-semibold transition-all flex items-center justify-center gap-2 ${
              hasNext
                ? 'border-slate-700/50 bg-slate-800/30 text-slate-400 hover:text-white hover:bg-slate-700/40'
                : 'border-indigo-500/40 bg-indigo-600/20 text-indigo-300 hover:bg-indigo-600/30'
            }`}
          >
            <span>🏠</span>
            <span>{hasNext ? 'Back to Module Dashboard' : 'Complete — Back to Dashboard'}</span>
          </button>
        </div>

        {/* Divider */}
        <div className="my-8 border-t border-slate-700/30" />

        {/* Answer review (collapsible feel via scroll) */}
        <div className="rounded-xl border border-slate-700/50 bg-slate-800/20 overflow-hidden">
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
  const [quizScore, setQuizScore] = useState(null);
  const [saving, setSaving] = useState(false);
  const [quizKey, setQuizKey] = useState(0); // increment to force QuizPhase remount on retry

  useEffect(() => {
    loadData();
  }, [moduleId, sessionIndex]);

  const loadData = async () => {
    setLoading(true);
    setPhase('content');
    setQuizScore(null);
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

  // Called by QuizPhase when the user submits their answers.
  // Always saves progress regardless of score, then transitions to score phase.
  const handleQuizDone = async (score) => {
    setQuizScore(score);
    setPhase('score');

    if (!assignmentId) return;

    setSaving(true);
    try {
      // Fetch current assignment to get the full existing state
      const current = await authFetch(`/api/assignments/${assignmentId}`);
      const existingProgress = current?.sessionProgress || current?.session_progress || {};
      const existingProgressData = current?.progress_data || {};
      const existingSessionReports = existingProgressData?.sessionReports || {};

      // Merge session completion — never overwrite previous sessions
      const mergedProgress = { ...existingProgress, [sessionIndex]: 'completed' };

      // Calculate overall progress from ACTUAL session count — never default to 1 (causes instant 100%)
      const allSessions = module?.sessions || module?.content?.sessions || current?.module?.sessions || [];
      const totalSessions = allSessions.length > 0
        ? allSessions.length
        : Math.max(Object.keys(mergedProgress).length, sessionIndex + 1);
      const completedCount = Object.values(mergedProgress).filter(s => s === 'completed').length;
      const newProgress = totalSessions > 0 ? Math.min(100, Math.round((completedCount / totalSessions) * 100)) : 0;
      // Only mark completed when ALL sessions are truly done
      const allDone = allSessions.length > 0 && completedCount >= allSessions.length;
      const newStatus = allDone ? 'completed' : 'in_progress';

      // Build per-session report for analytics/reports
      const sessionReport = {
        score: score.pct,
        correct: score.correct,
        total: score.total,
        completedAt: new Date().toISOString(),
        sessionTitle: session?.title || session?.topic || `Day ${sessionIndex + 1}`,
        strengths: score.results.filter(r => r.isCorrect).map(r => r.question).slice(0, 3),
        weaknesses: score.results.filter(r => !r.isCorrect).map(r => r.question).slice(0, 3),
      };

      await authFetch(`/api/assignments/${assignmentId}`, {
        method: 'PUT',
        body: JSON.stringify({
          sessionProgress: mergedProgress,
          status: newStatus,
          progress: newProgress,
          progress_data: {
            ...existingProgressData,
            sessionReports: { ...existingSessionReports, [sessionIndex]: sessionReport },
          },
        }),
      });
    } catch (_) {
      // Silently fail — UI still shows score
    } finally {
      setSaving(false);
    }
  };

  const goToDashboard = () => {
    navigate(`/module/${moduleId}/learn${assignmentId ? `?assignmentId=${assignmentId}` : ''}`);
  };

  const goToNextSession = () => {
    navigate(`/module/${moduleId}/session/${sessionIndex + 1}${assignmentId ? `?assignmentId=${assignmentId}` : ''}`);
  };

  const handleRewatch = () => {
    setPhase('content');
  };

  const handleRetryQuiz = () => {
    setQuizKey(k => k + 1); // force QuizPhase to remount and reload fresh questions
    setPhase('quiz');
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
            onClick={goToDashboard}
            className="px-6 py-3 rounded-xl font-bold bg-indigo-600 hover:bg-indigo-500 text-white transition-all"
          >
            ← Back to Module
          </button>
        </div>
      </div>
    );
  }

  const totalSessions = module?.sessions?.length || 1;

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
        key={quizKey}
        session={session}
        sessionIndex={sessionIndex}
        module={module}
        onComplete={handleQuizDone}
      />
    );
  }

  if (phase === 'score' && quizScore) {
    return (
      <ScorePhase
        score={quizScore}
        sessionTitle={session?.title || session?.topic || `Day ${sessionIndex + 1}`}
        sessionIndex={sessionIndex}
        totalSessions={totalSessions}
        saving={saving}
        onRewatch={handleRewatch}
        onRetryQuiz={handleRetryQuiz}
        onNextSession={goToNextSession}
        onDashboard={goToDashboard}
      />
    );
  }

  return null;
}
