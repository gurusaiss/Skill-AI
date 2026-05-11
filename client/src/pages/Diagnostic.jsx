import React, { useState, useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { api } from '../utils/api.js';

// ── Option colour palette ─────────────────────────────────────────────────────
const OPTION_LABELS = ['A', 'B', 'C', 'D'];
const OPTION_COLORS = {
  selected: {
    A: 'border-indigo-500 bg-indigo-600/20 text-white shadow-indigo-500/10',
    B: 'border-purple-500 bg-purple-600/20 text-white shadow-purple-500/10',
    C: 'border-cyan-500   bg-cyan-600/20   text-white shadow-cyan-500/10',
    D: 'border-emerald-500 bg-emerald-600/20 text-white shadow-emerald-500/10',
  },
  labelSelected: {
    A: 'bg-indigo-500 text-white border-indigo-400',
    B: 'bg-purple-500 text-white border-purple-400',
    C: 'bg-cyan-500   text-white border-cyan-400',
    D: 'bg-emerald-500 text-white border-emerald-400',
  },
};

// Difficulty pill colours
const DIFF_STYLE = {
  basic:       'bg-emerald-500/15 text-emerald-400 border-emerald-500/30',
  moderate:    'bg-indigo-500/15  text-indigo-400  border-indigo-500/30',
  advanced:    'bg-amber-500/15   text-amber-400   border-amber-500/30',
  practical:   'bg-purple-500/15  text-purple-400  border-purple-500/30',
  real_world:  'bg-rose-500/15    text-rose-400    border-rose-500/30',
};

// ── Processing loader messages ────────────────────────────────────────────────
const PROCESSING_MESSAGES = [
  'Analyzing your profile...',
  'Evaluating skill readiness...',
  'Calculating knowledge gaps...',
  'Building your personalized roadmap...',
  'Scheduling your learning journey...',
];

function ProcessingScreen() {
  const [msgIdx, setMsgIdx] = useState(0);
  const [dots, setDots] = useState('');

  useEffect(() => {
    const msgTimer = setInterval(() => {
      setMsgIdx(i => (i + 1) % PROCESSING_MESSAGES.length);
    }, 700);
    const dotTimer = setInterval(() => {
      setDots(d => d.length >= 3 ? '' : d + '.');
    }, 380);
    return () => { clearInterval(msgTimer); clearInterval(dotTimer); };
  }, []);

  return (
    <div className="min-h-[60vh] flex flex-col items-center justify-center px-6 py-14 space-y-8">
      {/* Spinning ring */}
      <div className="relative w-20 h-20">
        <div className="absolute inset-0 rounded-full border-4 border-slate-700" />
        <div className="absolute inset-0 rounded-full border-4 border-transparent border-t-indigo-500 animate-spin" />
        <div className="absolute inset-2 rounded-full border-4 border-transparent border-t-purple-500 animate-spin" style={{ animationDirection: 'reverse', animationDuration: '0.8s' }} />
        <div className="absolute inset-0 flex items-center justify-center text-2xl">🧠</div>
      </div>

      {/* Message */}
      <div className="text-center space-y-2">
        <p className="text-[10px] font-black text-indigo-400 uppercase tracking-[0.3em]">AI Processing</p>
        <p className="text-lg font-black text-slate-100 min-h-[2rem] transition-all">
          {PROCESSING_MESSAGES[msgIdx]}{dots}
        </p>
      </div>

      {/* Animated steps */}
      <div className="space-y-2 w-full max-w-xs">
        {[
          { icon: '🔍', label: 'Profile analyzed' },
          { icon: '📊', label: 'Gaps identified' },
          { icon: '📅', label: 'Plan building...' },
        ].map((step, i) => (
          <div
            key={step.label}
            className="flex items-center gap-3 rounded-xl bg-slate-800/50 border border-slate-700/40 px-4 py-2.5"
            style={{ animationDelay: `${i * 200}ms` }}
          >
            <span className="text-base">{step.icon}</span>
            <span className="text-xs font-semibold text-slate-400">{step.label}</span>
            <span className="ml-auto w-1.5 h-1.5 rounded-full bg-indigo-400 animate-pulse" />
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Main Diagnostic component ─────────────────────────────────────────────────
export default function Diagnostic() {
  const navigate = useNavigate();
  const location = useLocation();

  // ── All hooks declared unconditionally at the top ─────────────────────────
  const [currentIndex, setCurrentIndex] = useState(0);
  const [answers, setAnswers] = useState({});   // keyed by question index
  const [phase, setPhase] = useState('quiz');   // 'quiz' | 'processing'
  const [error, setError] = useState('');
  const [animating, setAnimating] = useState(false);

  // Derive data from location/localStorage (not hooks, so safe)
  const stored = localStorage.getItem('skillforge:goalResponse');
  const initialData = location.state || (stored ? JSON.parse(stored) : null);

  // Exactly 5 questions
  const allQuestions = (initialData?.diagnosticQuestions || []).slice(0, 5);
  const questions = allQuestions.length > 0 ? allQuestions : [];
  const userId = initialData?.userId || localStorage.getItem('skillforge:userId');
  const profilingData = location.state?.profilingData
    || (() => { try { return JSON.parse(localStorage.getItem('skillforge:profiling') || 'null'); } catch { return null; } })();

  // ── Guard (after all hooks) ───────────────────────────────────────────────
  if (!initialData || !userId) {
    return (
      <div className="mx-auto max-w-3xl px-6 py-16 text-center">
        <div className="text-5xl mb-4">🎯</div>
        <p className="text-slate-200 text-xl font-black">No diagnostic loaded</p>
        <p className="text-slate-500 text-sm mt-2 mb-6">Enter your learning goal on the home page first.</p>
        <button onClick={() => navigate('/')} className="px-6 py-3 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-bold transition-all">
          ← Go Home
        </button>
      </div>
    );
  }

  if (questions.length === 0) {
    return (
      <div className="mx-auto max-w-3xl px-6 py-16 text-center">
        <p className="text-slate-400 text-lg">No questions generated. Redirecting to dashboard…</p>
        {setTimeout(() => navigate('/dashboard'), 1500) && null}
      </div>
    );
  }

  // ── Processing phase ──────────────────────────────────────────────────────
  if (phase === 'processing') {
    return <ProcessingScreen />;
  }

  // ── Quiz state ────────────────────────────────────────────────────────────
  const currentQuestion  = questions[currentIndex];
  const answeredCount    = Object.keys(answers).length;
  const currentAnswer    = answers[currentIndex] ?? '';
  const isLast           = currentIndex === questions.length - 1;
  const progress         = ((currentIndex + 1) / questions.length) * 100;
  const allAnswered      = answeredCount === questions.length;

  const selectOption = (option) => {
    setAnswers(prev => ({ ...prev, [currentIndex]: option }));

    if (!isLast) {
      setTimeout(() => {
        setAnimating(true);
        setTimeout(() => {
          setCurrentIndex(i => i + 1);
          setAnimating(false);
        }, 180);
      }, 320);
    }
  };

  const handleSubmit = async () => {
    if (!allAnswered) {
      setError(`Please answer all ${questions.length} questions before submitting.`);
      return;
    }
    setError('');
    setPhase('processing');

    try {
      // Build answers array in question order
      const answersArray = questions.map((_, i) => answers[i] || '');

      // Show loader for 2–4 sec minimum (UI requirement) while API runs
      const [data] = await Promise.all([
        api.submitDiagnostic({ userId, answers: answersArray, profilingData }),
        new Promise(res => setTimeout(res, 2800)),
      ]);

      localStorage.setItem('skillforge:diagnostic', JSON.stringify(data));
      navigate('/dashboard');
    } catch (err) {
      setError(err.message);
      setPhase('quiz');
    }
  };

  const getOptionText = (option) => option.replace(/^[A-D]\)\s*/, '').trim();

  return (
    <div className="mx-auto max-w-2xl px-5 py-8">

      {/* Header */}
      <div className="text-center mb-6">
        <p className="text-[10px] font-black text-indigo-400 uppercase tracking-[0.3em] mb-1">
          Step 2 of 2 — Knowledge Quiz
        </p>
        <h1 className="text-xl font-black text-slate-100">
          How well do you know this already?
        </h1>
        <p className="text-xs text-slate-500 mt-1">
          5 questions · Your answers shape your personalized plan
        </p>
      </div>

      {/* Progress bar */}
      <div className="mb-5">
        <div className="flex justify-between text-[10px] text-slate-600 mb-1.5 font-semibold">
          <span>Question {currentIndex + 1} of {questions.length}</span>
          <span>{answeredCount}/{questions.length} answered</span>
        </div>
        <div className="h-2 rounded-full bg-slate-800 overflow-hidden">
          <div
            className="h-full rounded-full bg-gradient-to-r from-indigo-500 to-purple-500 transition-all duration-500"
            style={{ width: `${progress}%` }}
          />
        </div>
        {/* Dot progress */}
        <div className="flex gap-1.5 mt-2 justify-center">
          {questions.map((_, i) => (
            <button
              key={i}
              onClick={() => !animating && setCurrentIndex(i)}
              className={`rounded-full transition-all duration-300 ${
                i === currentIndex
                  ? 'w-5 h-2 bg-indigo-400'
                  : answers[i]
                  ? 'w-2 h-2 bg-emerald-500/70'
                  : 'w-2 h-2 bg-slate-700'
              }`}
              title={`Q${i + 1}`}
            />
          ))}
        </div>
      </div>

      {/* Question card */}
      <div className={`rounded-2xl border border-slate-700/60 bg-slate-900/80 overflow-hidden transition-all duration-200 ${animating ? 'opacity-0 scale-[0.98]' : 'opacity-100 scale-100'}`}>

        {/* Concept banner — shown at top of every question */}
        {currentQuestion.concept && (
          <div className="px-5 pt-4 pb-0 flex items-center gap-2 flex-wrap">
            <span className="text-[9px] font-black text-slate-500 uppercase tracking-widest">Concept Tested</span>
            <span className="text-xs px-2.5 py-1 rounded-lg bg-indigo-500/15 text-indigo-300 border border-indigo-500/25 font-bold">
              💡 {currentQuestion.concept}
            </span>
          </div>
        )}

        <div className="p-5">
          {/* Meta tags */}
          <div className="flex items-center gap-2 mb-4 flex-wrap">
            <span className="text-[9px] px-2.5 py-1 rounded-full bg-slate-800 text-slate-400 border border-slate-700 font-semibold uppercase tracking-wide">
              {currentQuestion.skillName}
            </span>
            {currentQuestion.difficulty && (
              <span className={`text-[9px] px-2.5 py-1 rounded-full border font-bold capitalize ${DIFF_STYLE[currentQuestion.difficulty] || DIFF_STYLE.basic}`}>
                {currentQuestion.difficulty.replace('_', ' ')}
              </span>
            )}
            {currentQuestion.source === 'llm' && (
              <span className="text-[9px] px-2.5 py-1 rounded-full bg-violet-500/15 text-violet-300 border border-violet-500/30 font-bold">
                🤖 AI
              </span>
            )}
            {currentQuestion.source === 'rule_base' && (
              <span className="text-[9px] px-2.5 py-1 rounded-full bg-emerald-500/15 text-emerald-400 border border-emerald-500/30 font-bold">
                ✅ Verified
              </span>
            )}
            <span className="ml-auto text-[9px] text-slate-600 font-mono">Q{currentIndex + 1}/{questions.length}</span>
          </div>

          {/* Question text */}
          <h2 className="text-base font-black text-slate-100 leading-snug mb-5">
            {currentQuestion.question}
          </h2>

          {/* MCQ Options */}
          <div className="space-y-2.5">
            {(currentQuestion.options || []).map((option, idx) => {
              const label = OPTION_LABELS[idx] || String.fromCharCode(65 + idx);
              const isSelected = currentAnswer === option;
              const selectedStyle = isSelected ? OPTION_COLORS.selected[label] : '';
              const labelStyle = isSelected
                ? OPTION_COLORS.labelSelected[label]
                : 'border-slate-700 text-slate-500 bg-slate-800/80';

              return (
                <button
                  key={option}
                  type="button"
                  onClick={() => selectOption(option)}
                  className={`w-full flex items-center gap-3 rounded-xl border px-4 py-3.5 text-left transition-all duration-200 group ${
                    isSelected
                      ? `${selectedStyle} shadow-lg`
                      : 'border-slate-700/60 bg-slate-800/30 text-slate-300 hover:border-slate-500 hover:bg-slate-800/70 hover:text-white'
                  }`}
                >
                  <span className={`w-7 h-7 rounded-lg flex-shrink-0 flex items-center justify-center text-xs font-black border transition-all ${labelStyle}`}>
                    {label}
                  </span>
                  <span className="text-sm leading-relaxed font-medium">{getOptionText(option)}</span>
                  {isSelected && <span className="ml-auto text-sm opacity-80">✓</span>}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* Error */}
      {error && (
        <div className="mt-3 rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3">
          <p className="text-sm text-red-400">{error}</p>
        </div>
      )}

      {/* Navigation */}
      <div className="mt-4 flex items-center gap-3">
        <button
          onClick={() => { if (currentIndex > 0 && !animating) setCurrentIndex(i => i - 1); }}
          disabled={currentIndex === 0}
          className="px-4 py-3 rounded-xl text-sm font-semibold border border-slate-700 text-slate-400 hover:text-slate-200 hover:border-slate-500 disabled:opacity-25 disabled:cursor-not-allowed transition-all"
        >
          ← Back
        </button>

        {isLast ? (
          <button
            onClick={handleSubmit}
            disabled={!allAnswered}
            className="flex-1 py-3 rounded-xl font-black text-sm bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white transition-all disabled:opacity-40 disabled:cursor-not-allowed shadow-lg shadow-emerald-500/20"
          >
            {allAnswered
              ? '✓ Submit & Build My Learning Plan →'
              : `Answer ${questions.length - answeredCount} more to continue`}
          </button>
        ) : (
          <button
            onClick={() => currentAnswer && !animating && selectOption(currentAnswer)}
            disabled={!currentAnswer}
            className="flex-1 py-3 rounded-xl font-black text-sm bg-indigo-600 hover:bg-indigo-500 text-white transition-all disabled:opacity-40 disabled:cursor-not-allowed"
          >
            Next Question →
          </button>
        )}
      </div>

      {/* All answered banner */}
      {allAnswered && (
        <div className="mt-3 rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-3 text-center">
          <p className="text-xs text-emerald-400 font-bold">
            ✅ All {questions.length} questions answered — ready to generate your personalized plan!
          </p>
        </div>
      )}
    </div>
  );
}
