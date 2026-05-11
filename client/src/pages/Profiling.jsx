import React, { useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';

// Dynamic profiling questions based on the career/domain
function buildQuestions(goalText, domainName) {
  const domain = (domainName || goalText || 'this field').split(' ').slice(0, 3).join(' ');
  return [
    {
      id: 'education',
      icon: '🎓',
      question: `What is your current education level?`,
      options: [
        { value: 'school',     label: 'School / High School' },
        { value: 'diploma',    label: 'Diploma / Certificate' },
        { value: 'undergrad',  label: "Bachelor's / B.Tech / B.Sc" },
        { value: 'postgrad',   label: "Master's / MBA / Post-Graduate" },
      ],
    },
    {
      id: 'experience',
      icon: '💼',
      question: `What is your experience level in ${domain}?`,
      options: [
        { value: 'beginner',   label: 'Beginner — completely new to this' },
        { value: 'basic',      label: 'Basic — I know the terminology' },
        { value: 'moderate',   label: 'Moderate — I can do simple tasks' },
        { value: 'advanced',   label: 'Advanced — I have professional experience' },
      ],
    },
    {
      id: 'toolExposure',
      icon: '🔧',
      question: `Have you worked with tools or materials related to ${domain}?`,
      options: [
        { value: 'no_exposure',    label: 'No — completely new to me' },
        { value: 'self_study',     label: "Yes — I've read about them / watched tutorials" },
        { value: 'personal',       label: 'Yes — used in personal projects' },
        { value: 'professional',   label: 'Yes — used professionally or in production' },
      ],
    },
    {
      id: 'practicalExp',
      icon: '🛠️',
      question: `What is your practical exposure level?`,
      options: [
        { value: 'none',      label: 'None — purely theoretical knowledge' },
        { value: 'projects',  label: 'Small personal or practice projects' },
        { value: 'internship',label: 'Internship or structured learning' },
        { value: 'realworld', label: 'Real-world professional work' },
      ],
    },
  ];
}

const OPTION_COLORS = [
  { base: 'border-indigo-500/40 bg-indigo-600/15 text-white shadow-indigo-500/10',  label: 'bg-indigo-500 text-white border-indigo-400' },
  { base: 'border-purple-500/40 bg-purple-600/15 text-white shadow-purple-500/10',  label: 'bg-purple-500 text-white border-purple-400' },
  { base: 'border-cyan-500/40   bg-cyan-600/15   text-white shadow-cyan-500/10',    label: 'bg-cyan-500   text-white border-cyan-400' },
  { base: 'border-emerald-500/40 bg-emerald-600/15 text-white shadow-emerald-500/10', label: 'bg-emerald-500 text-white border-emerald-400' },
];
const OPTION_DEFAULT = 'border-slate-700/60 bg-slate-800/30 text-slate-300 hover:border-slate-500 hover:bg-slate-800/70 hover:text-white';

export default function Profiling() {
  const navigate = useNavigate();
  const location = useLocation();

  // Goal data from Landing
  const stored = localStorage.getItem('skillforge:goalResponse');
  const goalData = location.state || (stored ? JSON.parse(stored) : null);
  const goalText = goalData?.skillTree?.profile?.rawGoal || '';
  const domainName = goalData?.skillTree?.domainName || '';

  const questions = buildQuestions(goalText, domainName);
  const [answers, setAnswers] = useState({});
  const [currentQ, setCurrentQ] = useState(0);
  const [animating, setAnimating] = useState(false);

  // Guard — redirect if no goal data
  if (!goalData) {
    return (
      <div className="mx-auto max-w-xl px-6 py-16 text-center">
        <div className="text-5xl mb-4">🎯</div>
        <p className="text-xl font-black text-slate-200">No goal found</p>
        <button onClick={() => navigate('/')} className="mt-6 px-6 py-3 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-bold transition-all">
          ← Back to Home
        </button>
      </div>
    );
  }

  const question = questions[currentQ];
  const isLast = currentQ === questions.length - 1;
  const allAnswered = questions.every(q => answers[q.id]);

  const selectOption = (questionId, value) => {
    const next = { ...answers, [questionId]: value };
    setAnswers(next);

    if (!isLast) {
      setTimeout(() => {
        setAnimating(true);
        setTimeout(() => {
          setCurrentQ(i => i + 1);
          setAnimating(false);
        }, 180);
      }, 320);
    }
  };

  const handleContinue = () => {
    // Save profiling data
    const profilingData = answers;
    localStorage.setItem('skillforge:profiling', JSON.stringify(profilingData));

    // Navigate to diagnostic with goal data + profiling
    navigate('/diagnostic', {
      state: { ...goalData, profilingData },
    });
  };

  const answeredCount = Object.keys(answers).length;
  const progress = ((currentQ + 1) / questions.length) * 100;

  return (
    <div className="mx-auto max-w-xl px-5 py-8">

      {/* Header */}
      <div className="text-center mb-6">
        <p className="text-[10px] font-black text-purple-400 uppercase tracking-[0.3em] mb-1">Step 1 of 2</p>
        <h1 className="text-xl font-black text-slate-100">Tell us about yourself</h1>
        <p className="text-xs text-slate-500 mt-1">
          4 quick questions to personalise your learning roadmap for{' '}
          <span className="text-slate-300 font-semibold">{domainName || goalText.slice(0, 30)}</span>
        </p>
      </div>

      {/* Progress */}
      <div className="mb-5">
        <div className="flex justify-between text-[10px] text-slate-600 mb-1.5 font-semibold">
          <span>Question {currentQ + 1} of {questions.length}</span>
          <span>{answeredCount}/{questions.length} answered</span>
        </div>
        <div className="h-1.5 rounded-full bg-slate-800 overflow-hidden">
          <div
            className="h-full rounded-full bg-gradient-to-r from-purple-500 to-indigo-500 transition-all duration-500"
            style={{ width: `${progress}%` }}
          />
        </div>
        {/* Dot row */}
        <div className="flex gap-2 mt-2 justify-center">
          {questions.map((q, i) => (
            <button
              key={q.id}
              onClick={() => !animating && setCurrentQ(i)}
              className={`rounded-full transition-all duration-300 ${
                i === currentQ
                  ? 'w-5 h-2 bg-purple-400'
                  : answers[q.id]
                  ? 'w-2 h-2 bg-emerald-500/70'
                  : 'w-2 h-2 bg-slate-700'
              }`}
            />
          ))}
        </div>
      </div>

      {/* Question card */}
      <div className={`rounded-2xl border border-slate-700/60 bg-slate-900/80 p-6 transition-all duration-200 ${animating ? 'opacity-0 scale-[0.98]' : 'opacity-100 scale-100'}`}>

        {/* Icon + question */}
        <div className="flex items-start gap-3 mb-5">
          <span className="text-2xl flex-shrink-0 mt-0.5">{question.icon}</span>
          <h2 className="text-base font-black text-slate-100 leading-snug">
            {question.question}
          </h2>
        </div>

        {/* Options */}
        <div className="space-y-2.5">
          {question.options.map((opt, idx) => {
            const isSelected = answers[question.id] === opt.value;
            const color = OPTION_COLORS[idx] || OPTION_COLORS[0];

            return (
              <button
                key={opt.value}
                type="button"
                onClick={() => selectOption(question.id, opt.value)}
                className={`w-full flex items-center gap-3 rounded-xl border px-4 py-3.5 text-left transition-all duration-200 ${
                  isSelected
                    ? `${color.base} shadow-lg border-opacity-80`
                    : OPTION_DEFAULT
                }`}
              >
                {/* Label dot */}
                <span className={`w-7 h-7 rounded-lg flex-shrink-0 flex items-center justify-center text-xs font-black border transition-all ${
                  isSelected ? color.label : 'border-slate-700 text-slate-500 bg-slate-800/80'
                }`}>
                  {String.fromCharCode(65 + idx)}
                </span>
                <span className="text-sm leading-relaxed font-medium">{opt.label}</span>
                {isSelected && <span className="ml-auto text-sm opacity-80">✓</span>}
              </button>
            );
          })}
        </div>
      </div>

      {/* Navigation */}
      <div className="mt-4 flex items-center gap-3">
        <button
          onClick={() => !animating && currentQ > 0 && setCurrentQ(i => i - 1)}
          disabled={currentQ === 0}
          className="px-4 py-3 rounded-xl text-sm font-semibold border border-slate-700 text-slate-400 hover:text-slate-200 hover:border-slate-500 disabled:opacity-25 disabled:cursor-not-allowed transition-all"
        >
          ← Back
        </button>

        {isLast ? (
          <button
            onClick={handleContinue}
            disabled={!allAnswered}
            className="flex-1 py-3 rounded-xl font-black text-sm bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-500 hover:to-indigo-500 text-white transition-all disabled:opacity-40 disabled:cursor-not-allowed shadow-lg shadow-purple-500/20"
          >
            {allAnswered ? '✓ Continue to Knowledge Quiz →' : `Answer ${questions.length - answeredCount} more to continue`}
          </button>
        ) : (
          <button
            onClick={() => answers[question.id] && !animating && selectOption(question.id, answers[question.id])}
            disabled={!answers[question.id]}
            className="flex-1 py-3 rounded-xl font-black text-sm bg-purple-600 hover:bg-purple-500 text-white transition-all disabled:opacity-40 disabled:cursor-not-allowed"
          >
            Next →
          </button>
        )}
      </div>

      {/* Progress indicator */}
      {answeredCount === questions.length && (
        <div className="mt-3 rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-3 text-center">
          <p className="text-xs text-emerald-400 font-bold">
            ✅ Profile complete — ready for your knowledge quiz!
          </p>
        </div>
      )}
    </div>
  );
}
