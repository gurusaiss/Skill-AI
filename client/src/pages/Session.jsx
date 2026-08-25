import React, { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api } from '../utils/api.js';
import AgentThinking from '../components/AgentThinking.jsx';
import { ConfidenceSelector, ConfidenceResult } from '../components/ConfidenceCalibration.jsx';

// ── Animated score counter ───────────────────────────────────────────────────
function CountUp({ target, duration = 1200 }) {
  const [current, setCurrent] = useState(0);
  useEffect(() => {
    const start = Date.now();
    const step = () => {
      const elapsed = Date.now() - start;
      const progress = Math.min(elapsed / duration, 1);
      const eased = 1 - Math.pow(1 - progress, 3);
      setCurrent(Math.round(eased * target));
      if (progress < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }, [target, duration]);
  return <>{current}</>;
}

const GRADE_META = {
  A: { label: 'Outstanding', color: '#10B981', bg: 'bg-emerald-500/15', border: 'border-emerald-500/30', emoji: '🏆' },
  B: { label: 'Proficient',  color: '#6366F1', bg: 'bg-indigo-500/15',  border: 'border-indigo-500/30',  emoji: '⭐' },
  C: { label: 'Developing',  color: '#F59E0B', bg: 'bg-amber-500/15',   border: 'border-amber-500/30',   emoji: '📈' },
  D: { label: 'Needs Work',  color: '#F97316', bg: 'bg-orange-500/15',  border: 'border-orange-500/30',  emoji: '💪' },
  F: { label: 'Keep Going',  color: '#EF4444', bg: 'bg-red-500/15',     border: 'border-red-500/30',     emoji: '🔄' },
};

const OPTION_LABELS = ['A', 'B', 'C', 'D'];
const OPTION_COLORS = {
  correct:  'border-emerald-500 bg-emerald-500/20 text-emerald-100',
  wrong:    'border-red-500 bg-red-500/20 text-red-200',
  selected: 'border-indigo-500 bg-indigo-500/20 text-white',
  default:  'border-slate-700 bg-slate-800/30 text-slate-300 hover:border-slate-500 hover:bg-slate-800/70',
};

// ── Fallback questions when API is unavailable ───────────────────────────────
function buildFallbackQuestions(topic, skillName, warmupQuestion) {
  const t = topic || skillName || 'this topic';
  const s = skillName || 'this skill';

  const base = [
    { id: 'q1', type: 'mcq',
      text: `Which statement best describes "${t}" in the context of ${s}?`,
      options: [
        `A) It is a core technique applied directly in ${s} work`,
        `B) It is only used in academic settings, not real ${s} practice`,
        `C) It is an outdated approach fully replaced by modern methods`,
        `D) It applies only to advanced practitioners, not beginners`,
      ],
      correct: `A) It is a core technique applied directly in ${s} work`,
      explanation: `"${t}" is a foundational concept directly applied in ${s}.`,
      concept: t,
    },
    { id: 'q2', type: 'mcq',
      text: `What is the primary purpose of mastering "${t}" in ${s}?`,
      options: [
        `A) To build a strong foundation that enables more advanced techniques`,
        `B) To complete coursework requirements only`,
        `C) To impress peers with technical vocabulary`,
        `D) To replace practical experience entirely`,
      ],
      correct: `A) To build a strong foundation that enables more advanced techniques`,
      explanation: `Mastering "${t}" builds the foundation for advanced ${s} work.`,
      concept: t,
    },
    { id: 'q3', type: 'mcq',
      text: `A beginner in ${s} is practising "${t}". What should they focus on first?`,
      options: [
        `A) Understanding the core principle and practising with simple examples`,
        `B) Memorising every edge case before attempting any practice`,
        `C) Skipping ahead to advanced applications immediately`,
        `D) Focusing on unrelated topics before attempting "${t}"`,
      ],
      correct: `A) Understanding the core principle and practising with simple examples`,
      explanation: `Beginners should grasp the core principle and practise with simple examples.`,
      concept: t,
    },
    { id: 'q4', type: 'mcq',
      text: `In a real ${s} scenario, how does "${t}" differ from related concepts?`,
      options: [
        `A) It has a specific definition and application that distinguishes it from adjacent concepts`,
        `B) It is interchangeable with all other ${s} concepts`,
        `C) It is only distinct in theory, not in practice`,
        `D) It has no meaningful difference from general ${s} knowledge`,
      ],
      correct: `A) It has a specific definition and application that distinguishes it from adjacent concepts`,
      explanation: `"${t}" has a distinct definition and practical application.`,
      concept: t,
    },
    { id: 'q5', type: 'mcq',
      text: `What is the most common mistake learners make when first encountering "${t}"?`,
      options: [
        `A) Treating it as purely theoretical rather than practising hands-on`,
        `B) Practising too much before understanding the concept`,
        `C) Applying it correctly in simple cases`,
        `D) Spending too much time on fundamentals`,
      ],
      correct: `A) Treating it as purely theoretical rather than practising hands-on`,
      explanation: `The most common mistake is treating "${t}" as theory-only.`,
      concept: t,
    },
    { id: 'q6', type: 'mcq',
      text: `Which outcome best demonstrates genuine mastery of "${t}" in ${s}?`,
      options: [
        `A) Applying it correctly in new, unfamiliar scenarios and explaining the reasoning`,
        `B) Reciting the definition from memory`,
        `C) Completing a lesson that covered it`,
        `D) Recognising it when someone else uses it`,
      ],
      correct: `A) Applying it correctly in new, unfamiliar scenarios and explaining the reasoning`,
      explanation: `True mastery means applying "${t}" correctly in unseen scenarios.`,
      concept: t,
    },
    { id: 'q7', type: 'mcq',
      text: `How does understanding "${t}" improve overall performance in ${s}?`,
      options: [
        `A) It enables more accurate, efficient, and professional-quality work`,
        `B) It only affects one narrow area with no broader impact`,
        `C) It replaces the need for other ${s} knowledge`,
        `D) It matters only at expert level, not for beginners`,
      ],
      correct: `A) It enables more accurate, efficient, and professional-quality work`,
      explanation: `"${t}" contributes to higher quality and efficiency across ${s} tasks.`,
      concept: t,
    },
    { id: 'q8', type: 'fill',
      text: `The specific concept studied in today's session within ${s} is called ___.`,
      answer: t,
      keywords: t.toLowerCase().split(' ').filter(w => w.length > 2),
      explanation: `The concept studied today is "${t}".`,
      concept: t,
    },
    { id: 'q9', type: 'fill',
      text: `In ${s}, practitioners use ___ when working on the topic from today's session.`,
      answer: t,
      keywords: t.toLowerCase().split(' ').filter(w => w.length > 2),
      explanation: `Today's focus was "${t}".`,
      concept: t,
    },
    { id: 'q10', type: 'fill',
      text: `The overall skill area that today's session belongs to is ___.`,
      answer: s,
      keywords: [s.toLowerCase()],
      explanation: `The skill area is "${s}".`,
      concept: s,
    },
  ];

  // If there's a warmup question, replace q1 with it for relevance
  if (warmupQuestion?.question && warmupQuestion?.options?.length === 4) {
    base[0] = {
      id: 'q1', type: 'mcq',
      text: warmupQuestion.question,
      options: warmupQuestion.options,
      correct: warmupQuestion.correct,
      explanation: warmupQuestion.explanation || '',
      concept: t,
    };
  }

  return base;
}

// ── Learn Phase ──────────────────────────────────────────────────────────────
function LearnPhase({ challenge, planDay, onReady }) {
  const cs = challenge?.conceptSummary;
  const topic = planDay?.topic || planDay?.skillName || 'Today\'s Concept';

  return (
    <div className="mx-auto max-w-2xl px-6 py-8 space-y-5">
      <div className="text-center mb-2">
        <p className="text-[10px] font-black text-indigo-400 uppercase tracking-[0.3em] mb-1">
          📚 Learn First — Then Quiz
        </p>
        <h1 className="text-2xl font-black text-slate-100 mt-1 leading-tight">
          {cs?.title || topic}
        </h1>
        <p className="text-xs text-slate-500 mt-1">
          Read through this — your 10-question quiz follows
        </p>
      </div>

      <div className="rounded-2xl border border-indigo-500/30 bg-gradient-to-br from-indigo-500/10 to-purple-500/5 p-5">
        <p className="text-[9px] font-black text-indigo-400 uppercase tracking-widest mb-2 flex items-center gap-1.5">
          <span>📖</span> Definition
        </p>
        <p className="text-sm text-slate-200 leading-relaxed font-medium">
          {cs?.definition || `${topic} is a key concept you'll practise in today's session.`}
        </p>
      </div>

      <div className="rounded-2xl border border-slate-700/60 bg-slate-900/80 p-5">
        <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-3 flex items-center gap-1.5">
          <span>🔑</span> Key Points
        </p>
        <ul className="space-y-2.5">
          {(cs?.keyPoints || [
            `${topic} is fundamental to mastering ${planDay?.skillName}`,
            'Focus on understanding the concept before applying it',
            'Practice with real-world scenarios to solidify your knowledge',
          ]).map((pt, i) => (
            <li key={i} className="flex items-start gap-2.5 text-sm text-slate-300">
              <span className="w-5 h-5 rounded-md bg-indigo-500/20 text-indigo-400 flex items-center justify-center text-[10px] font-black flex-shrink-0 mt-0.5 border border-indigo-500/30">
                {i + 1}
              </span>
              <span className="leading-relaxed">{pt}</span>
            </li>
          ))}
        </ul>
      </div>

      {cs?.example && (
        <div className="rounded-xl border border-emerald-500/25 bg-emerald-500/5 p-4">
          <p className="text-[9px] font-black text-emerald-400 uppercase tracking-widest mb-2 flex items-center gap-1.5">
            <span>💡</span> Real-World Example
          </p>
          <p className="text-sm text-slate-300 leading-relaxed">{cs.example}</p>
        </div>
      )}

      {cs?.proTip && (
        <div className="rounded-xl border border-amber-500/25 bg-amber-500/5 p-4">
          <p className="text-[9px] font-black text-amber-400 uppercase tracking-widest mb-2 flex items-center gap-1.5">
            <span>⚡</span> Pro Tip
          </p>
          <p className="text-sm text-slate-300 leading-relaxed">{cs.proTip}</p>
        </div>
      )}

      <div className="flex items-center gap-2 text-[10px] text-slate-600 justify-center flex-wrap">
        <span className="px-2.5 py-1 rounded-full bg-slate-800 border border-slate-700">{planDay?.skillName}</span>
        <span>•</span>
        <span className="capitalize">{planDay?.sessionType} session</span>
        <span>•</span>
        <span>~{planDay?.estimatedMinutes || 30}m total</span>
      </div>

      <button
        onClick={onReady}
        className="w-full py-4 rounded-xl font-black text-sm bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-500 hover:to-purple-500 text-white transition-all hover:shadow-xl hover:shadow-indigo-500/20 active:scale-[0.99]"
      >
        ✅ I've Read This — Start 10-Question Quiz →
      </button>
    </div>
  );
}

// ── MCQ Warm-up ──────────────────────────────────────────────────────────────
function WarmupMCQ({ question, onDone }) {
  const [selected, setSelected] = useState(null);
  const [revealed, setRevealed] = useState(false);

  if (!question) return null;

  const getOptionText = (opt) => opt.replace(/^[A-D]\)\s*/, '').trim();
  const isCorrect = (opt) => opt === question.correct;

  const handleSelect = (opt) => {
    if (revealed) return;
    setSelected(opt);
    setRevealed(true);
  };

  return (
    <div className="rounded-2xl border border-indigo-500/30 bg-slate-900/80 p-6 space-y-4">
      <div className="flex items-center gap-2">
        <span className="text-lg">🎯</span>
        <div>
          <p className="text-[10px] font-black text-indigo-400 uppercase tracking-widest">Warm-Up Check</p>
          <p className="text-[9px] text-slate-600">Quick baseline before the full quiz</p>
        </div>
      </div>

      <h2 className="text-base font-black text-slate-100 leading-snug">{question.question}</h2>

      <div className="space-y-2">
        {(question.options || []).map((opt, idx) => {
          const label = OPTION_LABELS[idx];
          let style = OPTION_COLORS.default;
          if (revealed) {
            if (isCorrect(opt)) style = OPTION_COLORS.correct;
            else if (selected === opt && !isCorrect(opt)) style = OPTION_COLORS.wrong;
          } else if (selected === opt) {
            style = OPTION_COLORS.selected;
          }
          return (
            <button
              key={opt}
              onClick={() => handleSelect(opt)}
              disabled={revealed}
              className={`w-full flex items-center gap-3 rounded-xl border px-4 py-3 text-left transition-all ${style} ${revealed ? 'cursor-default' : 'cursor-pointer'}`}
            >
              <span className={`w-6 h-6 rounded-md flex-shrink-0 flex items-center justify-center text-[11px] font-black border
                ${revealed && isCorrect(opt) ? 'bg-emerald-500 text-white border-emerald-400'
                  : revealed && selected === opt && !isCorrect(opt) ? 'bg-red-500 text-white border-red-400'
                  : 'border-slate-600 text-slate-500 bg-slate-800'}`}>
                {revealed && isCorrect(opt) ? '✓' : revealed && selected === opt && !isCorrect(opt) ? '✗' : label}
              </span>
              <span className="text-sm leading-relaxed">{getOptionText(opt)}</span>
            </button>
          );
        })}
      </div>

      {revealed && (
        <div className={`rounded-xl p-4 ${selected === question.correct ? 'bg-emerald-500/10 border border-emerald-500/30' : 'bg-amber-500/10 border border-amber-500/30'}`}>
          <p className={`text-xs font-black mb-1 ${selected === question.correct ? 'text-emerald-400' : 'text-amber-400'}`}>
            {selected === question.correct ? '✅ Correct!' : '💡 Not quite —'}
          </p>
          <p className="text-xs text-slate-400 leading-relaxed">{question.explanation}</p>
          <button
            onClick={onDone}
            className="mt-3 w-full py-2.5 rounded-xl font-black text-sm bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-500 hover:to-purple-500 text-white transition-all"
          >
            Continue to Quiz →
          </button>
        </div>
      )}

      {!revealed && (
        <button
          onClick={onDone}
          className="w-full py-2 rounded-xl text-xs text-slate-600 border border-slate-800 hover:text-slate-400 hover:border-slate-700 transition-all"
        >
          Skip warm-up →
        </button>
      )}
    </div>
  );
}

// ── Quiz Phase: 10 questions ─────────────────────────────────────────────────
function QuizPhase({ questions, topic, skillName, onSubmit }) {
  const [answers, setAnswers] = useState({});
  const [explanations, setExplanations] = useState({});

  const getOptionText = (opt) => opt.replace(/^[A-D]\)\s*/, '').trim();

  const handleMCQ = (qId, opt) => setAnswers(prev => ({ ...prev, [qId]: opt }));
  const handleFill = (qId, val) => setAnswers(prev => ({ ...prev, [qId]: val }));
  const handleExplanation = (qId, val) =>
    setExplanations(prev => ({ ...prev, [qId]: val }));

  const answeredCount = Object.keys(answers).filter(k => (answers[k] || '').toString().trim().length > 0).length;
  const canSubmit = questions.length > 0 && answeredCount >= Math.ceil(questions.length * 0.7);

  const handleSubmit = () => {
    const results = questions.map(q => {
      const userAnswer = answers[q.id] || '';
      let correct = false;
      if (q.type === 'mcq') {
        correct = userAnswer === q.correct;
      } else {
        const userLower = userAnswer.toLowerCase().trim();
        const keywords = (q.keywords?.length ? q.keywords : [q.answer || '']).map(k => k.toLowerCase().trim());
        correct = keywords.some(kw => kw && userLower.includes(kw));
      }
      return { ...q, userAnswer, correct, userExplanation: explanations[q.id] || '' };
    });
    const score = Math.round((results.filter(r => r.correct).length / questions.length) * 100);
    const weakConcepts = results.filter(r => !r.correct).map(r => r.concept || r.text.slice(0, 40));
    onSubmit({ results, score, weakConcepts });
  };

  if (questions.length === 0) {
    return (
      <div className="mx-auto max-w-2xl px-6 py-14 text-center">
        <div className="text-4xl mb-4">⚠️</div>
        <p className="text-slate-400 text-sm">No questions available. Please go back and try again.</p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-2xl px-6 py-8 space-y-6">
      {/* Header */}
      <div className="text-center">
        <p className="text-[10px] font-black text-indigo-400 uppercase tracking-[0.3em] mb-1">📝 Session Quiz</p>
        <h1 className="text-xl font-black text-slate-100">{topic}</h1>
        <p className="text-xs text-slate-500 mt-1">{skillName} · {questions.length} questions</p>
        <div className="flex items-center justify-center gap-3 mt-3">
          <div className="h-1.5 bg-slate-800 rounded-full flex-1 overflow-hidden">
            <div
              className="h-full bg-indigo-500 rounded-full transition-all"
              style={{ width: `${(answeredCount / questions.length) * 100}%` }}
            />
          </div>
          <span className="text-xs text-slate-500 font-mono flex-shrink-0">{answeredCount}/{questions.length}</span>
        </div>
      </div>

      {/* Questions */}
      <div className="space-y-5">
        {questions.map((q, idx) => {
          const isAnswered = (answers[q.id] || '').toString().trim().length > 0;
          return (
            <div
              key={q.id}
              className={`rounded-2xl border p-5 space-y-3 transition-all ${
                isAnswered ? 'border-indigo-500/30 bg-indigo-500/5' : 'border-slate-700/60 bg-slate-900/60'
              }`}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="flex items-start gap-3 flex-1">
                  <span className={`w-7 h-7 rounded-lg flex items-center justify-center text-xs font-black flex-shrink-0 mt-0.5 ${
                    isAnswered ? 'bg-indigo-600 text-white' : 'bg-slate-800 text-slate-400 border border-slate-700'
                  }`}>
                    {idx + 1}
                  </span>
                  <p className="text-sm font-semibold text-slate-100 leading-snug flex-1">{q.text}</p>
                </div>
                <span className={`text-[9px] px-2 py-0.5 rounded-full font-bold flex-shrink-0 uppercase tracking-wider ${
                  q.type === 'fill'
                    ? 'bg-amber-500/15 text-amber-400 border border-amber-500/30'
                    : 'bg-indigo-500/15 text-indigo-400 border border-indigo-500/30'
                }`}>
                  {q.type === 'fill' ? 'Fill' : 'MCQ'}
                </span>
              </div>

              {q.type === 'mcq' && (
                <div className="space-y-2">
                  {(q.options || []).map((opt, oi) => {
                    const isSelected = answers[q.id] === opt;
                    return (
                      <button
                        key={opt}
                        onClick={() => handleMCQ(q.id, opt)}
                        className={`w-full flex items-center gap-3 rounded-xl border px-4 py-2.5 text-left transition-all ${
                          isSelected ? OPTION_COLORS.selected : OPTION_COLORS.default
                        }`}
                      >
                        <span className={`w-5 h-5 rounded-md flex-shrink-0 flex items-center justify-center text-[10px] font-black border ${
                          isSelected ? 'bg-indigo-600 text-white border-indigo-500' : 'border-slate-600 text-slate-500 bg-slate-800'
                        }`}>
                          {OPTION_LABELS[oi]}
                        </span>
                        <span className="text-sm leading-relaxed">{getOptionText(opt)}</span>
                      </button>
                    );
                  })}
                </div>
              )}

              {q.type === 'fill' && (
                <input
                  type="text"
                  value={answers[q.id] || ''}
                  onChange={e => handleFill(q.id, e.target.value)}
                  placeholder="Type your answer here…"
                  className="w-full rounded-xl border border-slate-700 bg-[#060B14] px-4 py-2.5 text-sm text-slate-100 placeholder-slate-600 focus:border-indigo-500 focus:outline-none transition-colors"
                />
              )}

              <div>
                <button
                  onClick={() => handleExplanation(q.id, explanations[q.id] === undefined ? '' : undefined)}
                  className="text-[10px] text-slate-600 hover:text-slate-400 transition-colors"
                >
                  {explanations[q.id] === undefined ? '+ Add reasoning (optional)' : '− Hide reasoning'}
                </button>
                {explanations[q.id] !== undefined && (
                  <textarea
                    value={explanations[q.id]}
                    onChange={e => handleExplanation(q.id, e.target.value)}
                    placeholder="Why did you choose this answer? (optional)"
                    className="mt-2 w-full min-h-[60px] rounded-xl border border-slate-800 bg-[#060B14] p-3 text-slate-400 text-xs focus:border-slate-700 focus:outline-none resize-none"
                  />
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Submit */}
      <div className="space-y-3">
        {answeredCount < questions.length && (
          <p className="text-center text-xs text-slate-500">
            {questions.length - answeredCount} question{questions.length - answeredCount !== 1 ? 's' : ''} remaining
            {canSubmit ? ' — you can submit now or answer all for full marks' : ''}
          </p>
        )}
        <button
          onClick={handleSubmit}
          disabled={!canSubmit}
          className="w-full py-4 rounded-xl font-black text-sm bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-500 hover:to-purple-500 text-white transition-all disabled:opacity-40 disabled:cursor-not-allowed hover:shadow-xl hover:shadow-indigo-500/20 active:scale-[0.99]"
        >
          Submit Quiz ({answeredCount}/{questions.length} answered) →
        </button>
      </div>
    </div>
  );
}

// ── Quiz Result ──────────────────────────────────────────────────────────────
function QuizResult({ quizData, planDay, onViewNotes, onJournal, onDashboard, onNextSession }) {
  const { results, score, weakConcepts, nextDay } = quizData;
  const [showAll, setShowAll] = useState(false);
  const [expandedQ, setExpandedQ] = useState(null);

  const grade = score >= 90 ? 'A' : score >= 75 ? 'B' : score >= 60 ? 'C' : score >= 45 ? 'D' : 'F';
  const gradeMeta = GRADE_META[grade];
  const correct = results.filter(r => r.correct).length;
  const wrong = results.filter(r => !r.correct).length;
  const getOptionText = (opt) => (opt || '').replace(/^[A-D]\)\s*/, '').trim();

  const performanceLabel =
    score >= 90 ? 'Excellent — you clearly understood the material' :
    score >= 75 ? 'Solid — strong grasp with a few gaps' :
    score >= 60 ? 'Decent — review the topics you missed' :
    score >= 45 ? 'Developing — revisit the material before moving on' :
    'Needs work — study the notes carefully before the next session';

  return (
    <div className="mx-auto max-w-2xl px-6 py-8 space-y-5">
      {/* Score hero */}
      <div className={`rounded-2xl border p-6 text-center ${gradeMeta.bg} ${gradeMeta.border}`}>
        <div className="text-4xl mb-2">{gradeMeta.emoji}</div>
        <div className="text-7xl font-black font-mono mb-1" style={{ color: gradeMeta.color }}>
          <CountUp target={score} />%
        </div>
        <div className="text-sm font-black uppercase tracking-widest mb-1" style={{ color: gradeMeta.color }}>
          Grade {grade} — {gradeMeta.label}
        </div>
        <p className="text-xs text-slate-400 mt-1">{performanceLabel}</p>

        <div className="flex items-center gap-3 mt-4 max-w-xs mx-auto">
          <span className="text-xs text-emerald-400 font-bold flex-shrink-0">{correct} correct</span>
          <div className="flex-1 h-2 bg-slate-800 rounded-full overflow-hidden">
            <div className="h-full rounded-full bg-emerald-500 transition-all duration-700" style={{ width: `${score}%` }} />
          </div>
          <span className="text-xs text-red-400 font-bold flex-shrink-0">{wrong} wrong</span>
        </div>
      </div>

      {/* Question breakdown */}
      <div className="rounded-2xl border border-slate-700/60 bg-slate-900/60 overflow-hidden">
        <div className="flex items-center justify-between px-5 py-3 border-b border-slate-800">
          <h3 className="text-xs font-black text-slate-300 uppercase tracking-widest">Question Breakdown</h3>
          <button onClick={() => setShowAll(s => !s)} className="text-xs text-indigo-400 hover:text-indigo-300">
            {showAll ? 'Hide all' : 'Show all'}
          </button>
        </div>
        <div className="divide-y divide-slate-800/60">
          {results.map((r, i) => {
            const isOpen = showAll || expandedQ === r.id;
            return (
              <div key={r.id} className="px-5 py-3">
                <button
                  onClick={() => setExpandedQ(isOpen && !showAll ? null : r.id)}
                  className="w-full flex items-start gap-3 text-left"
                >
                  <span className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-black flex-shrink-0 mt-0.5 ${
                    r.correct ? 'bg-emerald-500/20 text-emerald-400' : 'bg-red-500/20 text-red-400'
                  }`}>
                    {r.correct ? '✓' : '✗'}
                  </span>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-slate-300 leading-snug font-medium line-clamp-1">
                      Q{i + 1}: {r.text}
                    </p>
                    {r.concept && <p className="text-[10px] text-slate-600 mt-0.5">{r.concept}</p>}
                  </div>
                  <span className="text-[10px] text-slate-600 flex-shrink-0">{isOpen ? '▲' : '▼'}</span>
                </button>
                {isOpen && (
                  <div className="mt-3 space-y-2 pl-8">
                    {r.type === 'mcq' ? (
                      <div className="space-y-1.5">
                        {(r.options || []).map((opt, oi) => {
                          const isCorr = opt === r.correct;
                          const isUser = opt === r.userAnswer;
                          let cls = 'border-slate-800 text-slate-600';
                          if (isCorr) cls = 'border-emerald-500/50 bg-emerald-500/10 text-emerald-300';
                          else if (isUser && !isCorr) cls = 'border-red-500/50 bg-red-500/10 text-red-300';
                          return (
                            <div key={opt} className={`flex items-center gap-2 rounded-lg border px-3 py-1.5 text-xs ${cls}`}>
                              <span className="font-bold flex-shrink-0">{OPTION_LABELS[oi]}</span>
                              <span className="flex-1">{getOptionText(opt)}</span>
                              {isCorr && <span className="text-emerald-400 flex-shrink-0">✓ Correct</span>}
                              {isUser && !isCorr && <span className="text-red-400 flex-shrink-0">✗ Your answer</span>}
                            </div>
                          );
                        })}
                      </div>
                    ) : (
                      <div className="space-y-1.5">
                        <div className="flex items-center gap-2 rounded-lg border border-slate-700/50 bg-slate-800/30 px-3 py-1.5 text-xs">
                          <span className="text-slate-500">Your answer:</span>
                          <span className={r.correct ? 'text-emerald-300' : 'text-red-300'}>{r.userAnswer || '(blank)'}</span>
                        </div>
                        <div className="flex items-center gap-2 rounded-lg border border-emerald-500/30 bg-emerald-500/5 px-3 py-1.5 text-xs">
                          <span className="text-slate-500">Expected:</span>
                          <span className="text-emerald-300">{r.answer}</span>
                        </div>
                      </div>
                    )}
                    {r.explanation && (
                      <div className="rounded-lg bg-indigo-500/8 border border-indigo-500/20 px-3 py-2">
                        <p className="text-[10px] text-indigo-400 font-bold mb-0.5">Explanation</p>
                        <p className="text-xs text-slate-400 leading-relaxed">{r.explanation}</p>
                      </div>
                    )}
                    {r.userExplanation && (
                      <div className="rounded-lg bg-slate-800/30 border border-slate-700/40 px-3 py-2">
                        <p className="text-[10px] text-slate-500 font-bold mb-0.5">Your reasoning</p>
                        <p className="text-xs text-slate-500 italic">{r.userExplanation}</p>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Areas to improve */}
      {weakConcepts.length > 0 && (
        <div className="rounded-xl border border-amber-500/25 bg-amber-500/5 p-4">
          <h3 className="text-xs font-black text-amber-400 uppercase tracking-widest mb-2">📈 Areas to Review</h3>
          <div className="flex flex-wrap gap-2">
            {weakConcepts.map((c, i) => (
              <span key={i} className="text-xs px-2.5 py-1 rounded-full bg-amber-500/10 border border-amber-500/25 text-amber-300">
                {c}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Performance analysis */}
      <div className="rounded-xl border border-slate-700/50 bg-slate-900/60 p-4">
        <h3 className="text-xs font-black text-slate-400 uppercase tracking-widest mb-3">Performance Analysis</h3>
        <div className="grid grid-cols-3 gap-3 mb-3">
          <div className="text-center">
            <div className="text-xl font-black text-emerald-400">{correct}</div>
            <div className="text-[9px] text-slate-600 uppercase tracking-wide">Correct</div>
          </div>
          <div className="text-center">
            <div className="text-xl font-black text-red-400">{wrong}</div>
            <div className="text-[9px] text-slate-600 uppercase tracking-wide">Wrong</div>
          </div>
          <div className="text-center">
            <div className="text-xl font-black text-slate-400">
              {results.filter(r => !r.userAnswer || r.userAnswer.toString().trim() === '').length}
            </div>
            <div className="text-[9px] text-slate-600 uppercase tracking-wide">Skipped</div>
          </div>
        </div>
        <div className="rounded-lg bg-slate-800/40 border border-slate-700/40 p-3">
          <p className="text-xs text-slate-400 leading-relaxed">
            {score >= 80
              ? `Strong session on ${planDay?.topic || 'this topic'}. You answered ${correct}/${results.length} correctly. The study notes below will reinforce what you learned.`
              : score >= 60
              ? `Good progress on ${planDay?.topic || 'this topic'}. Review the ${wrong} questions you missed — the notes below cover each concept in depth.`
              : `You got ${correct}/${results.length} correct on ${planDay?.topic || 'this topic'}. Spend 5 minutes with the auto-generated study notes before your next session.`}
          </p>
        </div>
      </div>

      {/* Actions */}
      <div className="space-y-3">
        {nextDay && (
          <button
            onClick={onNextSession}
            className="w-full py-4 rounded-xl font-black text-sm bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white transition-all hover:shadow-xl hover:shadow-emerald-500/20 active:scale-[0.99]"
          >
            🚀 Continue to Day {nextDay} →
          </button>
        )}
        <div className="flex gap-3">
          <button
            onClick={onViewNotes}
            className="flex-1 py-3.5 rounded-xl font-black text-sm bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-500 hover:to-purple-500 text-white transition-all hover:shadow-xl hover:shadow-indigo-500/20"
          >
            📖 View Study Notes →
          </button>
          <button
            onClick={onJournal}
            className="flex-1 py-3.5 rounded-xl font-black text-sm border border-purple-700/50 bg-purple-900/20 text-purple-300 hover:text-purple-200 hover:border-purple-600 transition-all"
          >
            📓 Reflect
          </button>
        </div>
      </div>
      <button
        onClick={onDashboard}
        className="w-full py-3 rounded-xl text-xs text-slate-600 border border-slate-800 hover:text-slate-400 hover:border-slate-700 transition-all"
      >
        ← Dashboard
      </button>
    </div>
  );
}

// ── Auto Notes ───────────────────────────────────────────────────────────────
function AutoNotes({ notes, topic, skillName, onJournal, onDashboard, onNextSession, nextDay }) {
  const [expanded, setExpanded] = useState({ keyConceptsList: true });
  const toggle = (key) => setExpanded(p => ({ ...p, [key]: !p[key] }));

  const sections = [
    { key: 'overview',         icon: '🗺️', label: 'Overview',           content: notes.overview,          type: 'text' },
    { key: 'definition',       icon: '📖', label: 'Definition',          content: notes.definition,         type: 'text' },
    { key: 'keyConceptsList',  icon: '🔑', label: 'Key Concepts',        content: notes.keyConceptsList,    type: 'list' },
    { key: 'howItWorks',       icon: '⚙️', label: 'How It Works',        content: notes.howItWorks,         type: 'text' },
    { key: 'realWorldExamples',icon: '💡', label: 'Real-World Examples',  content: notes.realWorldExamples,  type: 'list' },
    { key: 'commonMistakes',   icon: '⚠️', label: 'Common Mistakes',     content: notes.commonMistakes,     type: 'list' },
    { key: 'proTips',          icon: '⚡', label: 'Pro Tips',            content: notes.proTips,            type: 'list' },
    { key: 'areasToReview',    icon: '📈', label: 'Areas to Review',     content: notes.areasToReview,      type: 'list' },
    { key: 'quickRecap',       icon: '✅', label: 'Quick Recap',         content: notes.quickRecap,         type: 'text' },
  ].filter(s => s.content && (Array.isArray(s.content) ? s.content.length > 0 : (s.content || '').trim() !== ''));

  const SECTION_COLORS = {
    overview: '#6366F1', definition: '#8B5CF6', keyConceptsList: '#06B6D4',
    howItWorks: '#14B8A6', realWorldExamples: '#10B981', commonMistakes: '#F59E0B',
    proTips: '#F97316', areasToReview: '#EF4444', quickRecap: '#6366F1',
  };

  return (
    <div className="mx-auto max-w-2xl px-6 py-8 space-y-4">
      <div className="text-center mb-2">
        <p className="text-[10px] font-black text-indigo-400 uppercase tracking-[0.3em] mb-1">📓 Auto-Generated Study Notes</p>
        <h1 className="text-xl font-black text-slate-100">{topic}</h1>
        <p className="text-xs text-slate-500 mt-1">{skillName} · Generated by AI based on your quiz performance</p>
      </div>

      {sections.map(({ key, icon, label, content, type }) => {
        const color = SECTION_COLORS[key] || '#6366F1';
        const isOpen = expanded[key] !== false;
        return (
          <div
            key={key}
            className="rounded-xl border overflow-hidden transition-all"
            style={{ borderColor: `${color}25`, backgroundColor: `${color}05` }}
          >
            <button
              onClick={() => toggle(key)}
              className="w-full flex items-center justify-between px-4 py-3 text-left"
            >
              <div className="flex items-center gap-2">
                <span className="text-sm">{icon}</span>
                <span className="text-xs font-black uppercase tracking-widest" style={{ color }}>{label}</span>
              </div>
              <span className="text-slate-600 text-xs">{isOpen ? '▲' : '▼'}</span>
            </button>
            {isOpen && (
              <div className="px-4 pb-4">
                {type === 'text' ? (
                  <p className="text-sm text-slate-300 leading-relaxed whitespace-pre-line">{content}</p>
                ) : (
                  <ul className="space-y-2">
                    {(content || []).map((item, i) => (
                      <li key={i} className="flex items-start gap-2.5 text-sm text-slate-300">
                        <span
                          className="w-5 h-5 rounded-md flex items-center justify-center text-[10px] font-black flex-shrink-0 mt-0.5"
                          style={{ backgroundColor: `${color}20`, color, border: `1px solid ${color}30` }}
                        >
                          {i + 1}
                        </span>
                        <span className="leading-relaxed">{item}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </div>
        );
      })}

      <div className="rounded-lg border border-slate-700/40 bg-slate-900/60 px-4 py-3 flex items-center gap-2">
        <span className="text-sm">💾</span>
        <p className="text-xs text-slate-500">These notes are auto-generated from today's session. Journal your key takeaways below.</p>
      </div>

      <div className="space-y-3">
        {nextDay && (
          <button
            onClick={onNextSession}
            className="w-full py-4 rounded-xl font-black text-sm bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white transition-all hover:shadow-xl hover:shadow-emerald-500/20 active:scale-[0.99]"
          >
            🚀 Continue to Day {nextDay} →
          </button>
        )}
        <div className="flex gap-3">
          <button
            onClick={onJournal}
            className="flex-1 py-3.5 rounded-xl font-black text-sm border border-purple-700/50 bg-purple-900/20 text-purple-300 hover:text-purple-200 hover:border-purple-600 transition-all"
          >
            📓 Reflect & Journal
          </button>
          <button
            onClick={onDashboard}
            className="flex-1 py-3.5 rounded-xl font-black text-sm border border-slate-700 bg-slate-900/60 text-slate-300 hover:text-white hover:border-slate-500 transition-all"
          >
            ← Dashboard
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Reflection Journal ───────────────────────────────────────────────────────
function ReflectionJournal({ skillName, score, onComplete }) {
  const [reflection, setReflection] = useState('');
  const [keyTakeaway, setKeyTakeaway] = useState('');
  const [submitted, setSubmitted] = useState(false);

  const handleSubmit = () => {
    const entry = { date: new Date().toISOString(), skillName, score, reflection, keyTakeaway };
    const existing = JSON.parse(localStorage.getItem('skillforge:journal') || '[]');
    localStorage.setItem('skillforge:journal', JSON.stringify([...existing, entry].slice(-50)));
    setSubmitted(true);
    setTimeout(onComplete, 1200);
  };

  if (submitted) {
    return (
      <div className="rounded-2xl border border-emerald-500/30 bg-emerald-500/10 p-6 text-center">
        <div className="text-3xl mb-2">📓</div>
        <p className="text-sm font-black text-emerald-400">Reflection saved!</p>
        <p className="text-xs text-slate-500 mt-1">Added to your learning journal.</p>
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-purple-500/30 bg-purple-500/5 p-6 space-y-4">
      <div className="flex items-center gap-2">
        <span className="text-xl">📓</span>
        <div>
          <h3 className="text-sm font-black text-slate-200 uppercase tracking-wide">Reflection Journal</h3>
          <p className="text-xs text-slate-500">2 minutes to consolidate what you learned</p>
        </div>
      </div>
      <div>
        <label className="text-xs font-semibold text-slate-400 uppercase tracking-wide block mb-1.5">
          What did you learn? What was challenging?
        </label>
        <textarea
          value={reflection}
          onChange={e => setReflection(e.target.value)}
          className="w-full min-h-[90px] rounded-xl border border-slate-700 bg-[#060B14] p-3 text-slate-200 text-sm focus:border-purple-500 focus:outline-none resize-none"
          placeholder="e.g. I understood the concept better today, but the application is still tricky…"
        />
      </div>
      <div>
        <label className="text-xs font-semibold text-slate-400 uppercase tracking-wide block mb-1.5">
          One key takeaway:
        </label>
        <input
          type="text"
          value={keyTakeaway}
          onChange={e => setKeyTakeaway(e.target.value)}
          className="w-full rounded-xl border border-slate-700 bg-[#060B14] px-3 py-2.5 text-slate-200 text-sm focus:border-purple-500 focus:outline-none"
          placeholder="e.g. Always check the fundamentals before advanced techniques…"
        />
      </div>
      <div className="flex gap-3">
        <button
          onClick={handleSubmit}
          disabled={!reflection.trim() || !keyTakeaway.trim()}
          className="flex-1 py-2.5 rounded-xl font-bold text-sm bg-purple-600 hover:bg-purple-500 text-white transition-all disabled:opacity-40 disabled:cursor-not-allowed"
        >
          Save Reflection
        </button>
        <button
          onClick={onComplete}
          className="px-4 py-2.5 rounded-xl text-sm text-slate-600 border border-slate-800 hover:text-slate-400 transition-all"
        >
          Skip
        </button>
      </div>
    </div>
  );
}

// ── Main Session Component ───────────────────────────────────────────────────
export default function Session() {
  const { day } = useParams();
  const navigate = useNavigate();
  const userId = localStorage.getItem('skillforge:userId');

  const [data, setData] = useState(null);
  // phases: loading | confidence | learn | warmup | quiz-loading | quiz | quiz-result | notes-loading | notes | journal | error
  const [phase, setPhase] = useState('loading');
  const [error, setError] = useState('');
  const [confidenceLevel, setConfidenceLevel] = useState(null);
  const [historicalCalibrations] = useState(() => {
    try { return JSON.parse(localStorage.getItem('skillforge:calibrations') || '[]'); } catch { return []; }
  });

  // Quiz & notes state
  const [quizQuestions, setQuizQuestions] = useState([]);
  const [quizResult, setQuizResult] = useState(null);
  const [autoNotes, setAutoNotes] = useState(null);

  // One-shot guards
  const quizFetchedRef = useRef(false);
  const notesFetchedRef = useRef(false);

  // ── Load challenge data ───────────────────────────────────────────────────
  useEffect(() => {
    if (!userId) { navigate('/'); return; }
    let cancelled = false;
    api.getChallenge(userId, day)
      .then(payload => { if (!cancelled) { setData(payload); setPhase('confidence'); } })
      .catch(e => { if (!cancelled) { setError(e.message || 'Failed to load session'); setPhase('error'); } });
    return () => { cancelled = true; };
  }, [day, userId]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Generate quiz (runs once when phase becomes quiz-loading) ─────────────
  useEffect(() => {
    if (phase !== 'quiz-loading' || !data) return;
    if (quizFetchedRef.current) return;
    quizFetchedRef.current = true;

    const ch = data.challenge || {};
    const pd = data.planDay || {};
    const topic = pd.topic || pd.skillName || 'Today\'s Topic';
    const skillName = pd.skillName || 'this skill';

    // Set a 30-second timeout to force fallback if API is too slow
    const timeoutId = setTimeout(() => {
      console.warn('[Quiz] API timeout - using fallback questions');
      const questions = buildFallbackQuestions(topic, skillName, ch.warmupQuestion);
      setQuizQuestions(questions);
      setPhase('quiz');
    }, 30000);

    api.generateSessionQuiz({
      skillName,
      topic,
      description: ch.description || '',
      domain: ch.domain || pd.skillId || skillName,
      conceptSummary: ch.conceptSummary || null,
    })
      .then(res => {
        clearTimeout(timeoutId);
        const questions = Array.isArray(res?.questions) && res.questions.length >= 5
          ? res.questions
          : buildFallbackQuestions(topic, skillName, ch.warmupQuestion);
        setQuizQuestions(questions);
        setPhase('quiz');
      })
      .catch(() => {
        clearTimeout(timeoutId);
        const questions = buildFallbackQuestions(topic, skillName, ch.warmupQuestion);
        setQuizQuestions(questions);
        setPhase('quiz');
      });
  }, [phase, data]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Generate notes (runs once when phase becomes notes-loading) ───────────
  useEffect(() => {
    if (phase !== 'notes-loading' || !data || !quizResult) return;
    if (notesFetchedRef.current) return;
    notesFetchedRef.current = true;

    const ch = data.challenge || {};
    const pd = data.planDay || {};
    const topic = pd.topic || pd.skillName || 'Today\'s Topic';
    const skillName = pd.skillName || 'this skill';

    api.generateNotes({
      skillName,
      topic,
      description: ch.description || '',
      conceptSummary: ch.conceptSummary || null,
      quizScore: quizResult.score,
      weakConcepts: quizResult.weakConcepts || [],
    })
      .then(res => {
        const notes = res?.notes?.overview ? res.notes : buildFallbackNotes(topic, skillName, ch.conceptSummary, quizResult.weakConcepts);
        setAutoNotes(notes);
        setPhase('notes');
      })
      .catch(() => {
        setAutoNotes(buildFallbackNotes(topic, skillName, ch.conceptSummary, quizResult.weakConcepts));
        setPhase('notes');
      });
  }, [phase, data, quizResult]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Phase renders ─────────────────────────────────────────────────────────

  if (phase === 'loading') return (
    <div className="mx-auto max-w-4xl px-6 py-14">
      <AgentThinking isVisible messages={["Loading today's session…", "Preparing your challenge…", "Calibrating difficulty…"]} />
    </div>
  );

  if (phase === 'error') return (
    <div className="mx-auto max-w-3xl px-6 py-14 text-center space-y-4">
      <div className="text-4xl">⚠️</div>
      <p className="text-red-400 text-sm">{error || 'Session not found.'}</p>
      <button
        onClick={() => navigate('/dashboard')}
        className="px-6 py-2.5 rounded-xl text-sm text-slate-400 border border-slate-700 hover:border-slate-500 transition-all"
      >
        ← Back to Dashboard
      </button>
    </div>
  );

  if (phase === 'confidence') return (
    <div className="mx-auto max-w-2xl px-6 py-10 space-y-5">
      <div className="text-center mb-2">
        <p className="text-[10px] text-slate-500 uppercase tracking-widest font-black">Session {day}</p>
        <h1 className="text-2xl font-black text-slate-100 mt-1">Before You Begin</h1>
        <p className="text-sm text-slate-500 mt-1">The agent tracks your metacognitive accuracy</p>
      </div>
      <ConfidenceSelector
        onSelect={level => { setConfidenceLevel(level); setTimeout(() => setPhase('learn'), 400); }}
        selected={confidenceLevel}
      />
      <button
        onClick={() => setPhase('learn')}
        className="w-full py-3 rounded-xl text-xs text-slate-600 border border-slate-800 hover:text-slate-400 hover:border-slate-700 transition-all"
      >
        Skip confidence check →
      </button>
    </div>
  );

  if (phase === 'learn' && data) return (
    <LearnPhase
      challenge={data.challenge}
      planDay={data.planDay}
      onReady={() => {
        const hasWarmup = data?.challenge?.warmupQuestion?.question;
        setPhase(hasWarmup ? 'warmup' : 'quiz-loading');
      }}
    />
  );

  if (phase === 'warmup' && data) return (
    <div className="mx-auto max-w-2xl px-6 py-8 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-[10px] text-slate-500 uppercase tracking-widest font-black">Session {day}</p>
          <p className="text-base font-black text-slate-100">
            {data.planDay?.skillName} — {data.planDay?.topic}
          </p>
        </div>
        <button
          onClick={() => navigate('/dashboard')}
          className="text-xs text-slate-600 hover:text-slate-400 transition-colors"
        >
          ← Dashboard
        </button>
      </div>
      <WarmupMCQ
        question={data.challenge?.warmupQuestion}
        onDone={() => setPhase('quiz-loading')}
      />
    </div>
  );

  if (phase === 'quiz-loading') return (
    <div className="mx-auto max-w-4xl px-6 py-14">
      <AgentThinking
        isVisible
        messages={[
          'Generating your 10-question quiz…',
          'Creating MCQ and fill-in-blank questions…',
          `Calibrating to ${data?.planDay?.topic || 'today\'s topic'}…`,
          'Almost ready…',
        ]}
      />
    </div>
  );

  if (phase === 'quiz' && data) return (
    <QuizPhase
      questions={quizQuestions}
      topic={data.planDay?.topic || data.planDay?.skillName || 'Quiz'}
      skillName={data.planDay?.skillName || ''}
      onSubmit={async result => {
        if (confidenceLevel) {
          const predicted = confidenceLevel * 20;
          const cals = [...historicalCalibrations, { predicted, actual: result.score, day: Number(day) }];
          localStorage.setItem('skillforge:calibrations', JSON.stringify(cals.slice(-20)));
        }

        try {
          const userResponseText = result.results.map((r, i) => {
            const answer = r.type === 'mcq' ? r.userAnswer : r.userAnswer || '(no answer)';
            const status = r.correct ? '✓ Correct' : '✗ Wrong';
            return `Q${i + 1}: ${answer} ${status}`;
          }).join('\n');

          const submissionResult = await api.submitSession({
            userId,
            day: Number(day),
            skillId: data.planDay?.skillId || data.planDay?.skillName,
            challenge: data.challenge,
            userResponse: userResponseText,
          });

          result.nextDay = submissionResult?.nextDay || null;
        } catch (err) {
          console.error('[Session] Failed to submit session:', err);
        }

        setQuizResult(result);
        setPhase('quiz-result');
      }}
    />
  );

  if (phase === 'quiz-result' && quizResult) return (
    <QuizResult
      quizData={quizResult}
      planDay={data?.planDay}
      onViewNotes={() => setPhase('notes-loading')}
      onJournal={() => setPhase('journal')}
      onDashboard={() => navigate('/dashboard')}
      onNextSession={() => {
        if (quizResult.nextDay) {
          navigate(`/session/${quizResult.nextDay}`);
        }
      }}
    />
  );

  if (phase === 'notes-loading') return (
    <div className="mx-auto max-w-4xl px-6 py-14">
      <AgentThinking
        isVisible
        messages={[
          'Generating your study notes…',
          'Analysing your quiz performance…',
          'Creating personalised revision material…',
        ]}
      />
    </div>
  );

  if (phase === 'notes' && autoNotes) return (
    <AutoNotes
      notes={autoNotes}
      topic={data?.planDay?.topic || data?.planDay?.skillName || 'Today\'s Topic'}
      skillName={data?.planDay?.skillName || ''}
      onJournal={() => setPhase('journal')}
      onDashboard={() => navigate('/dashboard')}
      onNextSession={() => {
        if (quizResult?.nextDay) {
          navigate(`/session/${quizResult.nextDay}`);
        }
      }}
      nextDay={quizResult?.nextDay || null}
    />
  );

  if (phase === 'journal') return (
    <div className="mx-auto max-w-2xl px-6 py-8 space-y-5">
      <div className="text-center">
        <p className="text-xs text-slate-500 uppercase tracking-widest font-black">Session {day} Complete</p>
        <h1 className="text-xl font-black text-slate-100 mt-1">Lock In Your Learning</h1>
      </div>
      {confidenceLevel && quizResult && (
        <ConfidenceResult
          confidenceLevel={confidenceLevel}
          actualScore={quizResult.score}
          historicalCalibrations={historicalCalibrations}
        />
      )}
      <ReflectionJournal
        skillName={data?.planDay?.skillName || ''}
        score={quizResult?.score || 0}
        onComplete={() => navigate('/dashboard')}
      />
    </div>
  );

  return null;
}

// ── Fallback notes builder ───────────────────────────────────────────────────
function buildFallbackNotes(topic, skillName, conceptSummary, weakConcepts) {
  const cs = conceptSummary || {};
  const t = topic || skillName;
  const s = skillName || topic;
  return {
    overview: cs.definition || `${t} is a key concept in ${s} that practitioners apply regularly.`,
    definition: cs.definition || `${t}: A foundational technique in ${s}.`,
    keyConceptsList: cs.keyPoints || [
      `${t} is applied in real-world ${s} work`,
      `Understanding ${t} builds the foundation for advanced skills`,
      `Practising ${t} regularly improves overall mastery`,
    ],
    howItWorks: `1. Understand the core principle of ${t}. 2. Study real examples in ${s}. 3. Practise in controlled scenarios. 4. Apply in real projects. 5. Review and refine.`,
    realWorldExamples: [
      cs.example || `A practitioner uses ${t} in their daily ${s} work`,
      `${t} is essential when working on advanced ${s} projects`,
      `Professionals rely on ${t} to ensure quality results`,
    ],
    commonMistakes: [
      `Treating ${t} as purely theoretical — always practise hands-on`,
      `Skipping fundamentals and jumping to advanced applications`,
      `Not reviewing ${t} after initial learning`,
    ],
    proTips: [
      cs.proTip || `Master the basics of ${t} before advancing`,
      `Connect ${t} to other concepts in ${s}`,
      `Review your notes on ${t} within 24 hours to retain better`,
    ],
    areasToReview: weakConcepts?.length ? weakConcepts : [`Core definition of ${t}`, `Practical application of ${t}`],
    quickRecap: `${t} is a fundamental component of ${s}. ${cs.definition || ''} It is used in real-world practice and forms the basis for more advanced techniques. Mastering it requires both theoretical understanding and hands-on practice.`,
  };
}
