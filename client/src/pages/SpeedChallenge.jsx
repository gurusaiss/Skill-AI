import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';

const QUESTION_BANK = [
  { q: "What does CSS stand for?",                        options: ["Cascading Style Sheets", "Creative Style System", "Computer Style Sheet", "Colorful Style Script"],   answer: 0 },
  { q: "Which hook manages state in React?",              options: ["useEffect", "useState", "useRef", "useContext"],                                                        answer: 1 },
  { q: "What does SQL stand for?",                        options: ["Simple Query Language", "Structured Query Language", "Standard Query Logic", "System Query Language"],  answer: 1 },
  { q: "Which symbol starts a comment in Python?",        options: ["//", "/*", "#", "--"],                                                                                  answer: 2 },
  { q: "What is the time complexity of binary search?",   options: ["O(n)", "O(n²)", "O(log n)", "O(1)"],                                                                    answer: 2 },
  { q: "Which Git command saves changes locally?",        options: ["git push", "git commit", "git save", "git add"],                                                        answer: 1 },
  { q: "What does API stand for?",                        options: ["App Programming Interface", "Application Programming Interface", "Automated Program Integration", "Applied Protocol Interface"], answer: 1 },
  { q: "Which is NOT a JavaScript data type?",            options: ["String", "Boolean", "Float", "Undefined"],                                                              answer: 2 },
  { q: "What does 'npm' stand for?",                      options: ["Node Package Manager", "New Programming Method", "Network Protocol Manager", "Node Project Manager"],  answer: 0 },
  { q: "Which CSS property controls text size?",          options: ["text-size", "font-size", "text-scale", "font-weight"],                                                  answer: 1 },
  { q: "What is JSX?",                                    options: ["A database", "A JavaScript XML syntax", "A CSS framework", "A testing tool"],                           answer: 1 },
  { q: "Which method adds to end of a JS array?",         options: ["push()", "append()", "add()", "insert()"],                                                              answer: 0 },
  { q: "What does 'async/await' handle?",                 options: ["Synchronous code", "Promises/asynchronous code", "Loops", "Classes"],                                  answer: 1 },
  { q: "Which HTTP method creates a resource?",           options: ["GET", "DELETE", "POST", "PATCH"],                                                                       answer: 2 },
  { q: "What does 'useState' return?",                    options: ["Just a value", "Just a setter", "A value and a setter function", "An object"],                         answer: 2 },
  { q: "Which keyword declares a constant in JS?",        options: ["var", "let", "const", "static"],                                                                       answer: 2 },
  { q: "What is the CSS box model's outermost layer?",    options: ["Padding", "Border", "Margin", "Content"],                                                              answer: 2 },
  { q: "Which Python data structure uses key-value pairs?", options: ["List", "Tuple", "Set", "Dictionary"],                                                                answer: 3 },
  { q: "What does 'git clone' do?",                       options: ["Creates a new branch", "Copies a remote repo locally", "Merges branches", "Deletes a repository"],    answer: 1 },
  { q: "What does 'flex-wrap' do in CSS?",                options: ["Adds padding", "Allows flex items to wrap", "Centers items", "Sets direction"],                        answer: 1 },
  { q: "Which SQL command retrieves data?",               options: ["INSERT", "UPDATE", "SELECT", "DELETE"],                                                                answer: 2 },
  { q: "What is the result of typeof null in JS?",        options: ["null", "undefined", "object", "boolean"],                                                              answer: 2 },
  { q: "Which React hook runs side effects?",             options: ["useState", "useEffect", "useMemo", "useCallback"],                                                     answer: 1 },
  { q: "What does 'pip' manage in Python?",               options: ["Files", "Packages", "Processes", "Ports"],                                                             answer: 1 },
  { q: "Which is a valid HTTP status for 'Not Found'?",   options: ["200", "301", "404", "500"],                                                                            answer: 2 },
  { q: "What does DRY stand for in programming?",         options: ["Do Repeat Yourself", "Don't Repeat Yourself", "Dynamic Runtime Yield", "Direct Route Yield"],         answer: 1 },
  { q: "Which HTML tag creates a hyperlink?",             options: ["<link>", "<a>", "<href>", "<url>"],                                                                    answer: 1 },
  { q: "What is 'undefined' in JavaScript?",             options: ["A null value", "An error type", "A variable declared but not assigned", "A number"],                   answer: 2 },
  { q: "Which CSS unit is relative to viewport width?",   options: ["px", "em", "rem", "vw"],                                                                              answer: 3 },
  { q: "What does JSON stand for?",                       options: ["JavaScript Object Notation", "Java Serialized Object Node", "JavaScript Oriented Notation", "JSON Schema Object Node"], answer: 0 },
];

const TIME_PER_Q = 15;
const NUM_QUESTIONS = 10;
const XP_PER_CORRECT = 25;
const XP_SPEED_MULTIPLIER = 2;

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function getGrade(correct) {
  if (correct === 10) return { grade: 'S', color: '#f59e0b', label: 'PERFECT SCORE!' };
  if (correct >= 8)   return { grade: 'A', color: '#10b981', label: 'Excellent!' };
  if (correct >= 6)   return { grade: 'B', color: '#6366f1', label: 'Good Work!' };
  if (correct >= 4)   return { grade: 'C', color: '#f97316', label: 'Keep Practicing!' };
  return               { grade: 'D', color: '#ef4444', label: 'Need More Practice' };
}

// Circular countdown ring component
function CountdownRing({ timeLeft, total = TIME_PER_Q }) {
  const radius = 28;
  const circumference = 2 * Math.PI * radius;
  const progress = timeLeft / total;
  const dashOffset = circumference * (1 - progress);
  const color = timeLeft > 8 ? '#10b981' : timeLeft > 4 ? '#f59e0b' : '#ef4444';

  return (
    <div className="relative flex items-center justify-center w-20 h-20">
      <svg className="absolute inset-0 w-20 h-20 -rotate-90" viewBox="0 0 64 64">
        <circle cx="32" cy="32" r={radius} fill="none" stroke="#1e293b" strokeWidth="5" />
        <circle
          cx="32" cy="32" r={radius}
          fill="none"
          stroke={color}
          strokeWidth="5"
          strokeDasharray={circumference}
          strokeDashoffset={dashOffset}
          strokeLinecap="round"
          style={{ transition: 'stroke-dashoffset 1s linear, stroke 0.3s' }}
        />
      </svg>
      <span
        className="text-xl font-black font-mono z-10 transition-colors duration-300"
        style={{ color }}
      >
        {timeLeft}
      </span>
    </div>
  );
}

// ── SCREENS ───────────────────────────────────────────────────────────────────

function IntroScreen({ onStart }) {
  return (
    <div className="flex flex-col items-center justify-center min-h-[70vh] text-center px-4">
      {/* Pulsing icon */}
      <div className="relative mb-6">
        <div className="absolute inset-0 rounded-full bg-yellow-400/20 animate-ping" style={{ width: 96, height: 96 }} />
        <div
          className="relative w-24 h-24 rounded-full flex items-center justify-center text-5xl shadow-2xl"
          style={{ background: 'linear-gradient(135deg, #f59e0b, #ef4444)' }}
        >
          ⚡
        </div>
      </div>

      <h1
        className="text-5xl font-black mb-2 tracking-tight"
        style={{
          background: 'linear-gradient(90deg, #f59e0b, #ef4444, #ec4899)',
          WebkitBackgroundClip: 'text',
          WebkitTextFillColor: 'transparent',
        }}
      >
        SPEED CHALLENGE
      </h1>
      <p className="text-slate-400 text-lg mb-8">10 questions · 15 seconds each · Earn XP</p>

      {/* Rules */}
      <div className="grid grid-cols-3 gap-4 mb-10 max-w-md w-full">
        {[
          { icon: '⏱', label: '15 sec / question' },
          { icon: '✅', label: '+25 XP per correct' },
          { icon: '⚡', label: 'Speed bonus XP' },
        ].map(({ icon, label }) => (
          <div
            key={label}
            className="flex flex-col items-center gap-2 p-4 rounded-2xl border"
            style={{ background: 'rgba(255,255,255,0.03)', borderColor: 'rgba(255,255,255,0.08)' }}
          >
            <span className="text-2xl">{icon}</span>
            <p className="text-xs text-slate-400 font-semibold text-center">{label}</p>
          </div>
        ))}
      </div>

      <button
        onClick={onStart}
        className="px-12 py-4 rounded-2xl text-lg font-black text-black shadow-2xl transition-all hover:scale-105 active:scale-95"
        style={{ background: 'linear-gradient(135deg, #f59e0b, #ef4444)' }}
      >
        START CHALLENGE ⚡
      </button>
    </div>
  );
}

function ResultScreen({ correct, totalXP, questions, answers, onRetry, onCertificate }) {
  const { grade, color, label } = getGrade(correct);
  const navigate = useNavigate();

  const handleShare = () => {
    const msg = `I scored ${correct}/10 (Grade ${grade}) in the SkillForge AI Speed Challenge! ⚡ ${totalXP} XP earned!`;
    if (navigator.clipboard) {
      navigator.clipboard.writeText(msg).then(() => alert('Copied! Share it anywhere 🎉'));
    }
  };

  return (
    <div className="flex flex-col items-center justify-center min-h-[70vh] text-center px-4">
      {/* Grade circle */}
      <div
        className="w-32 h-32 rounded-full flex flex-col items-center justify-center text-black font-black mb-6 shadow-2xl"
        style={{ background: `linear-gradient(135deg, ${color}, ${color}99)`, boxShadow: `0 0 40px ${color}55` }}
      >
        <span className="text-5xl leading-none">{grade}</span>
        <span className="text-xs mt-1 opacity-80">GRADE</span>
      </div>

      <h2 className="text-3xl font-black text-white mb-1">{label}</h2>
      <p className="text-slate-400 text-lg mb-6">{correct} / 10 correct</p>

      {/* XP earned */}
      <div
        className="flex items-center gap-3 px-8 py-4 rounded-2xl mb-8 border"
        style={{ background: 'rgba(245,158,11,0.1)', borderColor: 'rgba(245,158,11,0.3)' }}
      >
        <span className="text-3xl">⚡</span>
        <div className="text-left">
          <p className="text-xs text-amber-400/70 uppercase font-bold tracking-widest">Total XP Earned</p>
          <p className="text-3xl font-black text-amber-400">{totalXP} XP</p>
        </div>
      </div>

      {/* Review answers */}
      <div className="w-full max-w-lg mb-8 space-y-2 text-left">
        <p className="text-xs font-black text-slate-500 uppercase tracking-widest mb-3">Question Review</p>
        {questions.map((q, i) => {
          const wasCorrect = answers[i] === q.answer;
          const wasAnswered = answers[i] !== null && answers[i] !== undefined;
          return (
            <div
              key={i}
              className="rounded-xl px-4 py-3 border text-sm flex items-start gap-3"
              style={{
                background: wasCorrect ? 'rgba(16,185,129,0.08)' : 'rgba(239,68,68,0.08)',
                borderColor: wasCorrect ? 'rgba(16,185,129,0.25)' : 'rgba(239,68,68,0.25)',
              }}
            >
              <span className="text-base flex-shrink-0 mt-0.5">{wasCorrect ? '✅' : '❌'}</span>
              <div className="flex-1 min-w-0">
                <p className="font-semibold text-slate-200 leading-snug">{q.q}</p>
                {!wasCorrect && (
                  <p className="text-xs text-emerald-400 mt-1">
                    Correct: <span className="font-bold">{q.options[q.answer]}</span>
                  </p>
                )}
                {!wasAnswered && (
                  <p className="text-xs text-slate-500 mt-1 italic">Time ran out</p>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Buttons */}
      <div className="flex flex-wrap gap-3 justify-center">
        <button
          onClick={onRetry}
          className="px-6 py-3 rounded-xl font-bold text-sm border border-slate-600 text-slate-300 hover:bg-slate-800 transition-all"
        >
          🔄 Play Again
        </button>
        <button
          onClick={handleShare}
          className="px-6 py-3 rounded-xl font-bold text-sm bg-slate-800 border border-slate-700 text-slate-200 hover:bg-slate-700 transition-all"
        >
          🔗 Share Score
        </button>
        <button
          onClick={onCertificate}
          className="px-6 py-3 rounded-xl font-bold text-sm text-black transition-all hover:scale-105"
          style={{ background: 'linear-gradient(135deg, #f59e0b, #ef4444)' }}
        >
          🎓 View Certificate
        </button>
        <button
          onClick={() => navigate('/dashboard')}
          className="px-6 py-3 rounded-xl font-bold text-sm bg-indigo-600 text-white hover:bg-indigo-500 transition-all"
        >
          🏠 Dashboard
        </button>
      </div>
    </div>
  );
}

// ── MAIN COMPONENT ────────────────────────────────────────────────────────────

export default function SpeedChallenge() {
  const navigate = useNavigate();

  const [phase, setPhase] = useState('intro'); // intro | playing | result
  const [questions, setQuestions] = useState([]);
  const [qIndex, setQIndex] = useState(0);
  const [timeLeft, setTimeLeft] = useState(TIME_PER_Q);
  const [selected, setSelected] = useState(null);      // null | index
  const [revealed, setRevealed] = useState(false);
  const [answers, setAnswers] = useState([]);            // array of chosen indices (null if timed out)
  const [xpBreakdown, setXpBreakdown] = useState([]);   // xp per question
  const [transitioning, setTransitioning] = useState(false);
  const timerRef = useRef(null);

  const totalXP = xpBreakdown.reduce((s, x) => s + x, 0);
  const correctCount = answers.filter((a, i) => questions[i] && a === questions[i].answer).length;

  // ── Start game ──
  const startGame = useCallback(() => {
    const picked = shuffle(QUESTION_BANK).slice(0, NUM_QUESTIONS);
    setQuestions(picked);
    setQIndex(0);
    setTimeLeft(TIME_PER_Q);
    setSelected(null);
    setRevealed(false);
    setAnswers([]);
    setXpBreakdown([]);
    setTransitioning(false);
    setPhase('playing');
  }, []);

  // ── Advance to next question or end ──
  const advance = useCallback((chosenIndex, remainingTime) => {
    const q = questions[qIndex];
    const correct = chosenIndex !== null && chosenIndex === q.answer;
    const xp = correct
      ? XP_PER_CORRECT + (remainingTime > 0 ? remainingTime * XP_SPEED_MULTIPLIER : 0)
      : 0;

    setAnswers(prev => [...prev, chosenIndex]);
    setXpBreakdown(prev => [...prev, xp]);
    setTransitioning(true);

    setTimeout(() => {
      if (qIndex + 1 >= NUM_QUESTIONS) {
        setPhase('result');
      } else {
        setQIndex(i => i + 1);
        setTimeLeft(TIME_PER_Q);
        setSelected(null);
        setRevealed(false);
        setTransitioning(false);
      }
    }, 900);
  }, [qIndex, questions]);

  // ── Timer ──
  useEffect(() => {
    if (phase !== 'playing' || revealed || transitioning) return;
    timerRef.current = setInterval(() => {
      setTimeLeft(t => {
        if (t <= 1) {
          clearInterval(timerRef.current);
          setRevealed(true);
          advance(null, 0);
          return 0;
        }
        return t - 1;
      });
    }, 1000);
    return () => clearInterval(timerRef.current);
  }, [phase, qIndex, revealed, transitioning, advance]);

  // ── User selects answer ──
  const handleSelect = (idx) => {
    if (revealed || transitioning) return;
    clearInterval(timerRef.current);
    setSelected(idx);
    setRevealed(true);
    advance(idx, timeLeft);
  };

  // ── Certificate link ──
  const handleCertificate = () => {
    const scorePercent = Math.round((correctCount / NUM_QUESTIONS) * 100);
    navigate(`/certificate?skill=Speed+Challenge&score=${scorePercent}&days=1`);
  };

  // ── RENDER ────────────────────────────────────────────────────────────────

  if (phase === 'intro') {
    return (
      <div className="min-h-screen px-4 py-6 max-w-2xl mx-auto" style={{ background: 'inherit' }}>
        <IntroScreen onStart={startGame} />
      </div>
    );
  }

  if (phase === 'result') {
    return (
      <div className="min-h-screen px-4 py-6 max-w-2xl mx-auto">
        <ResultScreen
          correct={correctCount}
          totalXP={totalXP}
          questions={questions}
          answers={answers}
          onRetry={startGame}
          onCertificate={handleCertificate}
        />
      </div>
    );
  }

  // ── PLAYING PHASE ─────────────────────────────────────────────────────────
  const q = questions[qIndex];
  if (!q) return null;

  const optionState = (idx) => {
    if (!revealed) return 'neutral';
    if (idx === q.answer) return 'correct';
    if (idx === selected && idx !== q.answer) return 'wrong';
    return 'dim';
  };

  const optionStyles = {
    neutral: 'border-slate-700/60 bg-slate-800/50 text-slate-200 hover:border-indigo-500/60 hover:bg-indigo-600/10 hover:text-white cursor-pointer',
    correct: 'border-emerald-500 bg-emerald-500/20 text-emerald-200 shadow-lg shadow-emerald-500/20',
    wrong:   'border-red-500 bg-red-500/20 text-red-200',
    dim:     'border-slate-700/30 bg-slate-800/20 text-slate-600',
  };

  const runningXP = xpBreakdown.reduce((s, x) => s + x, 0);

  return (
    <div className="min-h-screen px-4 py-6 max-w-2xl mx-auto">
      {/* Top bar */}
      <div className="flex items-center justify-between mb-6">
        {/* Header */}
        <div>
          <h1
            className="text-2xl font-black tracking-tight"
            style={{
              background: 'linear-gradient(90deg, #f59e0b, #ef4444)',
              WebkitBackgroundClip: 'text',
              WebkitTextFillColor: 'transparent',
            }}
          >
            SPEED CHALLENGE ⚡
          </h1>
          <p className="text-slate-500 text-xs mt-0.5">
            Question {qIndex + 1} of {NUM_QUESTIONS}
          </p>
        </div>

        {/* XP counter */}
        <div className="flex items-center gap-2 px-4 py-2 rounded-xl border border-amber-500/30 bg-amber-500/10">
          <span className="text-amber-400 text-sm">⚡</span>
          <span className="text-amber-400 font-black font-mono text-sm">{runningXP} XP</span>
        </div>
      </div>

      {/* Progress bar */}
      <div className="w-full h-2 bg-slate-800 rounded-full mb-6 overflow-hidden">
        <div
          className="h-full rounded-full transition-all duration-300"
          style={{
            width: `${((qIndex) / NUM_QUESTIONS) * 100}%`,
            background: 'linear-gradient(90deg, #f59e0b, #ef4444)',
          }}
        />
      </div>

      {/* Question card */}
      <div
        className="rounded-3xl border p-6 mb-6 transition-all duration-300"
        style={{
          background: 'rgba(15,23,42,0.8)',
          borderColor: 'rgba(255,255,255,0.07)',
          boxShadow: '0 0 40px rgba(0,0,0,0.5)',
        }}
      >
        {/* Timer + question */}
        <div className="flex items-start gap-4 mb-6">
          <CountdownRing timeLeft={timeLeft} total={TIME_PER_Q} />
          <p className="text-xl font-black text-white leading-snug flex-1 mt-2">
            {q.q}
          </p>
        </div>

        {/* Options */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {q.options.map((opt, idx) => {
            const state = optionState(idx);
            return (
              <button
                key={idx}
                onClick={() => handleSelect(idx)}
                disabled={revealed}
                className={`rounded-2xl border-2 px-5 py-4 text-sm font-bold text-left transition-all duration-200 leading-snug ${optionStyles[state]}`}
              >
                <span
                  className="inline-flex items-center justify-center w-6 h-6 rounded-lg text-xs font-black mr-3 flex-shrink-0"
                  style={{
                    background: state === 'neutral' ? 'rgba(255,255,255,0.06)' :
                                state === 'correct' ? 'rgba(16,185,129,0.3)' :
                                state === 'wrong'   ? 'rgba(239,68,68,0.3)' : 'rgba(255,255,255,0.03)',
                  }}
                >
                  {['A','B','C','D'][idx]}
                </span>
                {opt}
                {state === 'correct' && <span className="float-right">✓</span>}
                {state === 'wrong'   && <span className="float-right">✗</span>}
              </button>
            );
          })}
        </div>

        {/* Feedback bar */}
        {revealed && (
          <div
            className="mt-4 rounded-xl px-4 py-3 text-sm font-bold transition-all text-center"
            style={{
              background: selected === q.answer
                ? 'rgba(16,185,129,0.15)'
                : selected === null
                ? 'rgba(100,116,139,0.15)'
                : 'rgba(239,68,68,0.15)',
              color: selected === q.answer ? '#6ee7b7' : selected === null ? '#94a3b8' : '#fca5a5',
            }}
          >
            {selected === q.answer
              ? `⚡ Correct! +${xpBreakdown[xpBreakdown.length - 1] || XP_PER_CORRECT} XP`
              : selected === null
              ? `⏱ Time's up! Answer: ${q.options[q.answer]}`
              : `✗ Wrong! Correct: ${q.options[q.answer]}`}
          </div>
        )}
      </div>

      {/* Mini dot progress */}
      <div className="flex justify-center gap-2">
        {questions.map((_, i) => (
          <div
            key={i}
            className="w-2.5 h-2.5 rounded-full transition-all duration-300"
            style={{
              background:
                i < qIndex
                  ? answers[i] === questions[i]?.answer ? '#10b981' : '#ef4444'
                  : i === qIndex
                  ? '#f59e0b'
                  : 'rgba(255,255,255,0.1)',
              transform: i === qIndex ? 'scale(1.3)' : 'scale(1)',
            }}
          />
        ))}
      </div>
    </div>
  );
}
