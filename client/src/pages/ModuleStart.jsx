import React, { useState, useEffect, useRef } from 'react';
import { useNavigate, useParams, useLocation } from 'react-router-dom';

const BASE_URL = import.meta.env.VITE_API_URL || (import.meta.env.PROD ? '' : 'http://localhost:3001');

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
  if (text) {
    try { data = JSON.parse(text); } catch { throw new Error(`Server error (${res.status})`); }
  }
  if (!res.ok) { throw new Error(data?.error?.message || data?.error || `Request failed (${res.status})`); }
  return data?.data ?? data;
};

// ─── Constants ────────────────────────────────────────────────────────────────

const PROFILE_QUESTIONS = [
  {
    id: 'education',
    question: 'What is your current education level?',
    options: [
      { value: 'school',    label: 'School / High School' },
      { value: 'diploma',   label: 'Diploma / Certificate' },
      { value: 'bachelor',  label: "Bachelor's / B.Tech / B.Sc" },
      { value: 'masters',   label: "Master's / MBA / Post-Graduate" },
    ],
  },
  {
    id: 'experience',
    question: 'How many years of experience do you have in this area?',
    options: [
      { value: 'lt1',  label: 'Less than 1 year' },
      { value: '1_3',  label: '1–3 years' },
      { value: '3_5',  label: '3–5 years' },
      { value: '5p',   label: '5+ years' },
    ],
  },
  {
    id: 'role',
    question: 'What is your current role?',
    options: [
      { value: 'student',  label: 'Student' },
      { value: 'junior',   label: 'Junior Professional' },
      { value: 'mid',      label: 'Mid-level Professional' },
      { value: 'senior',   label: 'Senior / Lead' },
    ],
  },
  {
    id: 'goal',
    question: 'What is your primary learning goal?',
    options: [
      { value: 'career',    label: 'Career Change / New Role' },
      { value: 'upgrade',   label: 'Skill Upgrade in current job' },
      { value: 'cert',      label: 'Academic / Certification prep' },
      { value: 'personal',  label: 'Personal Growth / Curiosity' },
    ],
  },
];

const AGENT_STEPS = [
  { agent: 'GoalAgent',       icon: '🎯', color: '#6366F1', text: 'Analyzing your learning profile...' },
  { agent: 'ScoringAgent',    icon: '📊', color: '#0EA5E9', text: 'Scoring knowledge assessment...' },
  { agent: 'DiagnosticAgent', icon: '📋', color: '#06B6D4', text: 'Identifying knowledge gaps...' },
  { agent: 'CurriculumAgent', icon: '📅', color: '#14B8A6', text: 'Building adaptive learning plan...' },
  { agent: 'AdaptorAgent',    icon: '⚡', color: '#F59E0B', text: 'Personalizing difficulty & pace...' },
  { agent: 'EvaluatorAgent',  icon: '✅', color: '#10B981', text: 'Setting evaluation checkpoints...' },
  { agent: 'MarketAgent',     icon: '💼', color: '#EC4899', text: 'Aligning with market demand...' },
  { agent: 'InterviewAgent',  icon: '🎤', color: '#14B8A6', text: 'Preparing practice scenarios...' },
  { agent: 'DecomposeAgent',  icon: '🌳', color: '#8B5CF6', text: 'Finalizing your roadmap...' },
];

const FALLBACK_QUIZ = (moduleTitle) => [
  {
    id: 'fq1',
    question: `What is the primary purpose of ${moduleTitle}?`,
    concept: 'Core Concept',
    difficulty: 'beginner',
    options: ['To memorize information passively', 'To build applied skills and knowledge', 'To replace formal education entirely', 'To complete tasks without understanding'],
    correct: 1,
  },
  {
    id: 'fq2',
    question: 'Which approach is most effective for deep learning?',
    concept: 'Learning Strategy',
    difficulty: 'beginner',
    options: ['Reading once without practice', 'Spaced repetition and active recall', 'Watching videos without notes', 'Skipping foundational concepts'],
    correct: 1,
  },
  {
    id: 'fq3',
    question: 'What does "applied knowledge" mean in a professional context?',
    concept: 'Application',
    difficulty: 'intermediate',
    options: ['Theoretical understanding only', 'Memorizing textbook definitions', 'Using knowledge to solve real-world problems', 'Passing certification exams'],
    correct: 2,
  },
  {
    id: 'fq4',
    question: 'Which metric best measures skill mastery?',
    concept: 'Assessment',
    difficulty: 'intermediate',
    options: ['Hours spent studying', 'Number of certificates earned', 'Ability to apply skills in varied scenarios', 'Completion percentage'],
    correct: 2,
  },
  {
    id: 'fq5',
    question: 'What is the most important factor in sustained skill development?',
    concept: 'Growth Mindset',
    difficulty: 'beginner',
    options: ['Natural talent', 'Consistent deliberate practice', 'Expensive training courses', 'Networking alone'],
    correct: 1,
  },
];

const DIFFICULTY_COLORS = {
  beginner:     'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30',
  intermediate: 'bg-amber-500/20 text-amber-300 border border-amber-500/30',
  advanced:     'bg-red-500/20 text-red-300 border border-red-500/30',
  expert:       'bg-purple-500/20 text-purple-300 border border-purple-500/30',
};
const diffColor = (d) => DIFFICULTY_COLORS[d?.toLowerCase()] || DIFFICULTY_COLORS.beginner;

// ─── Phase 0: Module Details ──────────────────────────────────────────────────

function PhaseDetails({ module, onStart }) {
  const skills = module?.skills || module?.content?.skills || [];
  const tasks  = module?.tasks  || module?.content?.tasks  || module?.content?.objectives || [];
  const sessions = module?.sessions_count ?? module?.content?.sessions?.length ?? 7;
  const duration  = module?.estimated_duration || module?.duration || '7 days';
  const difficulty = module?.difficulty || 'intermediate';
  const category   = module?.category || 'Learning';

  return (
    <div className="min-h-screen bg-[#0F172A] py-10 px-4">
      <div className="max-w-2xl mx-auto">
        {/* Icon + category */}
        <div className="flex items-center gap-3 mb-4">
          <span className="text-4xl">📚</span>
          <span className="px-3 py-1 rounded-full bg-indigo-600/20 border border-indigo-500/30 text-indigo-300 text-xs font-bold uppercase tracking-wider">
            {category}
          </span>
        </div>

        {/* Title */}
        <h1 className="text-3xl font-black text-white mb-3 leading-tight">{module.title}</h1>

        {/* Description */}
        <p className="text-slate-400 text-sm leading-relaxed mb-6">{module.description || 'Build practical skills with a structured, AI-personalized learning plan.'}</p>

        {/* Stat pills */}
        <div className="flex flex-wrap gap-3 mb-8">
          <div className="flex items-center gap-2 px-4 py-2 rounded-full bg-slate-800/60 border border-slate-700/60 text-sm text-slate-300">
            <span>⏱</span>
            <span className="font-semibold">{duration}</span>
          </div>
          <div className={`flex items-center gap-2 px-4 py-2 rounded-full text-sm font-semibold ${diffColor(difficulty)}`}>
            <span>📊</span>
            <span className="capitalize">{difficulty}</span>
          </div>
          <div className="flex items-center gap-2 px-4 py-2 rounded-full bg-slate-800/60 border border-slate-700/60 text-sm text-slate-300">
            <span>🎓</span>
            <span className="font-semibold">{skills.length || 6} Skills</span>
          </div>
          <div className="flex items-center gap-2 px-4 py-2 rounded-full bg-slate-800/60 border border-slate-700/60 text-sm text-slate-300">
            <span>📅</span>
            <span className="font-semibold">{sessions} Sessions</span>
          </div>
        </div>

        {/* What you'll learn */}
        {skills.length > 0 && (
          <div className="mb-6">
            <h2 className="text-sm font-black text-slate-200 uppercase tracking-widest mb-3">What you'll learn</h2>
            <div className="flex flex-wrap gap-2">
              {skills.map((s, i) => (
                <span key={i} className="px-3 py-1.5 rounded-lg bg-slate-800/70 border border-slate-700/60 text-slate-300 text-xs font-medium">
                  {typeof s === 'string' ? s : s.name || s}
                </span>
              ))}
            </div>
          </div>
        )}

        {/* What you'll accomplish */}
        {tasks.length > 0 && (
          <div className="mb-8 rounded-2xl bg-slate-800/30 border border-slate-700/60 p-5">
            <h2 className="text-sm font-black text-slate-200 uppercase tracking-widest mb-3">What you'll accomplish</h2>
            <ul className="space-y-2">
              {tasks.slice(0, 5).map((t, i) => (
                <li key={i} className="flex items-start gap-2 text-sm text-slate-300">
                  <span className="text-indigo-400 mt-0.5 flex-shrink-0">→</span>
                  <span>{typeof t === 'string' ? t : t.title || t.description || t}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* CTA */}
        <button
          onClick={onStart}
          className="w-full py-4 rounded-2xl font-black text-base bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-500 hover:to-purple-500 text-white transition-all shadow-lg shadow-indigo-500/20"
        >
          Start Module →
        </button>
      </div>
    </div>
  );
}

// ─── Shared: Progress Header ───────────────────────────────────────────────────

function StepHeader({ step, total, answered, label, title, subtitle }) {
  const progress = ((step + 1) / total) * 100;
  return (
    <div className="mb-6">
      <div className="text-center mb-4">
        <p className="text-xs font-black text-indigo-400 uppercase tracking-[0.3em] mb-1">{label}</p>
        <h1 className="text-xl font-black text-white">{title}</h1>
        <p className="text-xs text-slate-400 mt-1">{subtitle}</p>
      </div>
      <div className="flex justify-between text-xs text-slate-500 mb-1.5 font-semibold">
        <span>Question {step + 1} of {total}</span>
        <span>{answered}/{total} answered</span>
      </div>
      <div className="h-1.5 rounded-full bg-slate-800 overflow-hidden">
        <div
          className="h-full rounded-full transition-all duration-500"
          style={{ width: `${progress}%`, background: 'linear-gradient(to right, #6366f1, #a855f7)' }}
        />
      </div>
      <div className="flex gap-2 mt-2 justify-center">
        {Array.from({ length: total }).map((_, i) => (
          <div
            key={i}
            className={`rounded-full transition-all duration-300 ${
              i === step
                ? 'w-5 h-2 bg-indigo-400'
                : i < step || (answered > i)
                ? 'w-2 h-2 bg-emerald-500'
                : 'w-2 h-2 bg-slate-700'
            }`}
          />
        ))}
      </div>
    </div>
  );
}

// ─── Phase 1: Profile Questions ───────────────────────────────────────────────

function PhaseProfile({ module, onBack, onDone }) {
  const [step, setStep] = useState(0);
  const [answers, setAnswers] = useState({});
  const [animating, setAnimating] = useState(false);

  const question = PROFILE_QUESTIONS[step];
  const isLast = step === PROFILE_QUESTIONS.length - 1;
  const answered = Object.keys(answers).length;
  const currentSelected = answers[question.id];

  const selectOption = (questionId, value) => {
    const next = { ...answers, [questionId]: value };
    setAnswers(next);
    if (!isLast) {
      setTimeout(() => {
        setAnimating(true);
        setTimeout(() => {
          setStep(s => s + 1);
          setAnimating(false);
        }, 180);
      }, 300);
    }
  };

  const handleNext = () => {
    if (isLast && currentSelected) {
      onDone(answers);
    } else if (!isLast && currentSelected) {
      setAnimating(true);
      setTimeout(() => { setStep(s => s + 1); setAnimating(false); }, 180);
    }
  };

  return (
    <div className="min-h-screen bg-[#0F172A] py-10 px-4">
      <div className="max-w-xl mx-auto">
        <StepHeader
          step={step}
          total={PROFILE_QUESTIONS.length}
          answered={answered}
          label="STEP 1 OF 2 · ABOUT YOU"
          title="Tell us about yourself"
          subtitle={`4 quick questions to personalise your learning roadmap for ${module?.title || 'this module'}`}
        />

        {/* Question card */}
        <div
          className={`rounded-2xl border border-slate-700/60 bg-[#0F172A] p-6 mb-4 transition-all duration-200 ${
            animating ? 'opacity-0 scale-[0.98]' : 'opacity-100 scale-100'
          }`}
        >
          <h2 className="text-base font-black text-slate-100 leading-snug mb-5">{question.question}</h2>
          <div className="space-y-2.5">
            {question.options.map((opt, idx) => {
              const isSelected = answers[question.id] === opt.value;
              return (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => selectOption(question.id, opt.value)}
                  className={`w-full flex items-center gap-3 rounded-xl border px-4 py-3.5 text-left transition-all duration-200 ${
                    isSelected
                      ? 'bg-indigo-600/20 border-indigo-500 text-white'
                      : 'bg-slate-800/60 border-slate-700 text-slate-300 hover:border-indigo-500/50 hover:bg-slate-800/80'
                  }`}
                >
                  <span className={`w-7 h-7 rounded-lg flex-shrink-0 flex items-center justify-center text-xs font-black border transition-all ${
                    isSelected
                      ? 'bg-indigo-600 border-indigo-400 text-white'
                      : 'bg-slate-700 border-slate-600 text-slate-400'
                  }`}>
                    {String.fromCharCode(65 + idx)}
                  </span>
                  <span className="text-sm leading-relaxed font-medium flex-1">{opt.label}</span>
                  {isSelected && <span className="text-indigo-300 text-sm ml-auto">✓</span>}
                </button>
              );
            })}
          </div>
        </div>

        {/* Navigation */}
        <div className="flex items-center gap-3">
          <button
            onClick={() => step > 0 ? setStep(s => s - 1) : onBack()}
            className="px-5 py-3 rounded-xl text-sm font-semibold border border-slate-700 text-slate-400 hover:text-slate-200 hover:border-slate-500 transition-all"
          >
            ← Back
          </button>
          <button
            onClick={handleNext}
            disabled={!currentSelected}
            className="flex-1 py-3 rounded-xl font-black text-sm bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-500 hover:to-purple-500 text-white transition-all disabled:opacity-40 disabled:cursor-not-allowed shadow-lg shadow-indigo-500/20"
          >
            {isLast ? (currentSelected ? '✓ Continue to Knowledge Quiz →' : `Answer remaining to continue`) : 'Next →'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Phase 2: Knowledge Quiz ──────────────────────────────────────────────────

function PhaseQuiz({ module, onBack, onDone }) {
  const [step, setStep] = useState(0);
  const [answers, setAnswers] = useState({});
  const [questions, setQuestions] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadQuiz();
  }, []);

  const loadQuiz = async () => {
    setLoading(true);
    try {
      const skill = module?.title || 'General';
      const topic = (module?.skills?.[0]) || module?.title || skill;
      const description = module?.description || '';
      const data = await authFetch('/api/session/quiz', {
        method: 'POST',
        body: JSON.stringify({ skillName: skill, topic, description }),
      });
      const qs = (Array.isArray(data) ? data : data?.questions || [])
        .filter(q => q.type === 'mcq' || !q.type)
        .slice(0, 5);
      if (qs.length >= 1) {
        setQuestions(qs);
      } else {
        setQuestions(FALLBACK_QUIZ(module?.title || 'this module'));
      }
    } catch {
      setQuestions(FALLBACK_QUIZ(module?.title || 'this module'));
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-[#0F172A] flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin text-indigo-400 text-4xl mb-4">⟳</div>
          <p className="text-slate-400 text-sm">Generating your knowledge quiz...</p>
        </div>
      </div>
    );
  }

  const q = questions[step];
  if (!q) return null;

  const answered = Object.keys(answers).length;
  const currentSelected = answers[step];
  const isLast = step === questions.length - 1;

  const concept = q.concept || q.category || q.skill || module?.category || 'Concept';
  const diff = q.difficulty || 'beginner';

  const handleSelect = (optIdx) => {
    setAnswers(prev => ({ ...prev, [step]: optIdx }));
  };

  const handleNext = () => {
    if (isLast) {
      onDone(answers, questions);
    } else {
      setStep(s => s + 1);
    }
  };

  // Normalize options: they may be strings or {text, label} objects
  const opts = q.options || q.choices || [];

  return (
    <div className="min-h-screen bg-[#0F172A] py-10 px-4">
      <div className="max-w-2xl mx-auto">
        <StepHeader
          step={step}
          total={questions.length}
          answered={answered}
          label="STEP 2 OF 2 · KNOWLEDGE CHECK"
          title="How well do you know this already?"
          subtitle={`${questions.length} questions · Your answers shape your personalized plan`}
        />

        {/* Quiz card */}
        <div className="rounded-2xl border border-slate-700/60 bg-[#0F172A] p-6 mb-4">
          {/* Top meta row */}
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="px-3 py-1 rounded-full bg-slate-700/80 border border-slate-600 text-slate-200 text-xs font-semibold">
                CONCEPT TESTED
              </span>
              <span className="px-3 py-1 rounded-full bg-indigo-600/20 border border-indigo-500/30 text-indigo-300 text-xs font-bold">
                {concept}
              </span>
            </div>
            <span className="text-xs font-black text-slate-500">Q{step + 1}/{questions.length}</span>
          </div>

          {/* Tags */}
          <div className="flex items-center gap-2 flex-wrap mb-4">
            <span className="px-2.5 py-1 rounded-md bg-slate-800/70 border border-slate-700/60 text-slate-400 text-xs font-bold uppercase tracking-wide">
              {module?.category || 'General'}
            </span>
            <span className={`px-2.5 py-1 rounded-md text-xs font-bold uppercase tracking-wide ${diffColor(diff)}`}>
              {diff}
            </span>
            <span className="px-2.5 py-1 rounded-md bg-indigo-600/10 border border-indigo-500/20 text-indigo-300 text-xs font-bold">
              🤖 AI
            </span>
          </div>

          {/* Question text */}
          <h2 className="text-lg font-black text-white mb-5 leading-snug">{q.question || q.text}</h2>

          {/* Options */}
          <div className="space-y-2.5">
            {opts.map((opt, idx) => {
              const optText = typeof opt === 'string' ? opt : opt.text || opt.label || String(opt);
              const isSelected = currentSelected === idx;
              return (
                <button
                  key={idx}
                  type="button"
                  onClick={() => handleSelect(idx)}
                  className={`w-full flex items-center gap-3 rounded-xl border px-4 py-3.5 text-left transition-all duration-200 ${
                    isSelected
                      ? 'bg-indigo-600/20 border-indigo-500 text-white'
                      : 'bg-slate-800/60 border-slate-700 text-slate-300 hover:border-indigo-500/50 hover:bg-slate-800/80'
                  }`}
                >
                  <span className={`w-7 h-7 rounded-lg flex-shrink-0 flex items-center justify-center text-xs font-black border transition-all ${
                    isSelected
                      ? 'bg-indigo-600 border-indigo-400 text-white'
                      : 'bg-slate-700 border-slate-600 text-slate-400'
                  }`}>
                    {String.fromCharCode(65 + idx)}
                  </span>
                  <span className="text-sm leading-relaxed font-medium flex-1">{optText}</span>
                  {isSelected && <span className="text-indigo-300 text-sm ml-auto">✓</span>}
                </button>
              );
            })}
          </div>
        </div>

        {/* Navigation */}
        <div className="flex items-center gap-3">
          <button
            onClick={() => step > 0 ? setStep(s => s - 1) : onBack()}
            className="px-5 py-3 rounded-xl text-sm font-semibold border border-slate-700 text-slate-400 hover:text-slate-200 hover:border-slate-500 transition-all"
          >
            ← Back
          </button>
          {isLast ? (
            <button
              onClick={handleNext}
              disabled={currentSelected === undefined}
              className="flex-1 py-3 rounded-xl font-black text-sm bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white transition-all disabled:opacity-40 disabled:cursor-not-allowed shadow-lg shadow-emerald-500/20"
            >
              ✓ Submit & Build My Learning Plan →
            </button>
          ) : (
            <button
              onClick={handleNext}
              disabled={currentSelected === undefined}
              className="flex-1 py-3 rounded-xl font-black text-sm bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-500 hover:to-purple-500 text-white transition-all disabled:opacity-40 disabled:cursor-not-allowed shadow-lg shadow-indigo-500/20"
            >
              Next Question →
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Phase 3: Agent Processing ────────────────────────────────────────────────

function PhaseAgents({ assignmentId, onDone }) {
  const [agentStep, setAgentStep] = useState(0);
  const [done, setDone] = useState(false);
  const timerRef = useRef(null);

  useEffect(() => {
    timerRef.current = setInterval(() => {
      setAgentStep(prev => {
        if (prev >= AGENT_STEPS.length - 1) {
          clearInterval(timerRef.current);
          // After last agent completes, wait a moment then finalize
          setTimeout(async () => {
            try {
              if (assignmentId) {
                await authFetch(`/api/assignments/${assignmentId}`, {
                  method: 'PUT',
                  body: JSON.stringify({ status: 'in_progress', progress: 5 }),
                });
              }
            } catch {}
            setDone(true);
          }, 600);
          return prev;
        }
        return prev + 1;
      });
    }, 400);
    return () => clearInterval(timerRef.current);
  }, []);

  const allDone = agentStep === AGENT_STEPS.length - 1 && done;

  return (
    <div className="min-h-screen bg-[#0F172A] flex items-center justify-center px-4">
      <div className="max-w-lg w-full">
        {allDone ? (
          // Success state
          <div className="text-center">
            <div className="text-6xl mb-4">🎉</div>
            <h2 className="text-2xl font-black text-white mb-2">Your Personalized Learning Plan is Ready!</h2>
            <p className="text-slate-400 text-sm mb-8">
              9 AI agents have analyzed your profile and built a custom roadmap just for you.
            </p>
            <button
              onClick={onDone}
              className="px-8 py-4 rounded-2xl font-black text-base bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-500 hover:to-purple-500 text-white transition-all shadow-lg shadow-indigo-500/20"
            >
              Go to Dashboard →
            </button>
          </div>
        ) : (
          // Agent animation
          <div>
            <div className="text-center mb-8">
              <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-indigo-600/20 border border-indigo-500/30 mb-4">
                <span className="w-2 h-2 rounded-full bg-indigo-400 animate-pulse" />
                <span className="text-indigo-300 text-xs font-bold uppercase tracking-widest">AI Agents Working</span>
              </div>
              <h2 className="text-xl font-black text-white">Building Your Learning Plan</h2>
              <p className="text-slate-400 text-sm mt-1">9 specialized agents are personalizing your roadmap</p>
            </div>

            <div className="space-y-3">
              {AGENT_STEPS.map((agent, idx) => {
                const isActive = idx === agentStep;
                const isComplete = idx < agentStep;
                const isPending = idx > agentStep;

                return (
                  <div
                    key={agent.agent}
                    className={`flex items-center gap-4 rounded-xl border px-5 py-3.5 transition-all duration-300 ${
                      isActive
                        ? 'bg-slate-800/80 border-slate-600'
                        : isComplete
                        ? 'bg-slate-900/40 border-slate-800/60'
                        : 'bg-slate-900/20 border-slate-800/40 opacity-40'
                    }`}
                  >
                    {/* Icon */}
                    <span
                      className={`text-xl transition-all ${isActive ? 'animate-pulse' : ''}`}
                      style={{ filter: isComplete ? 'grayscale(0)' : isPending ? 'grayscale(1)' : 'none' }}
                    >
                      {agent.icon}
                    </span>

                    {/* Agent info */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span
                          className="text-xs font-black uppercase tracking-wide"
                          style={{ color: isComplete || isActive ? agent.color : '#64748b' }}
                        >
                          {agent.agent}
                        </span>
                      </div>
                      <p className={`text-xs mt-0.5 truncate ${isActive ? 'text-slate-300' : 'text-slate-600'}`}>
                        {agent.text}
                      </p>
                    </div>

                    {/* Status */}
                    <div className="flex-shrink-0">
                      {isComplete ? (
                        <span className="text-emerald-400 text-sm font-black">✓</span>
                      ) : isActive ? (
                        <div className="flex gap-1">
                          {[0, 1, 2].map(i => (
                            <span
                              key={i}
                              className="w-1.5 h-1.5 rounded-full bg-indigo-400 animate-bounce"
                              style={{ animationDelay: `${i * 150}ms` }}
                            />
                          ))}
                        </div>
                      ) : (
                        <span className="w-1.5 h-1.5 rounded-full bg-slate-700 inline-block" />
                      )}
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Overall progress bar */}
            <div className="mt-6">
              <div className="h-1.5 rounded-full bg-slate-800 overflow-hidden">
                <div
                  className="h-full rounded-full transition-all duration-500"
                  style={{
                    width: `${((agentStep + 1) / AGENT_STEPS.length) * 100}%`,
                    background: 'linear-gradient(to right, #6366f1, #a855f7)',
                  }}
                />
              </div>
              <p className="text-center text-xs text-slate-500 mt-2 font-semibold">
                {agentStep + 1} / {AGENT_STEPS.length} agents complete
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Main ModuleStart ─────────────────────────────────────────────────────────

export default function ModuleStart() {
  const { moduleId } = useParams();
  const location = useLocation();
  const navigate = useNavigate();

  const searchParams = new URLSearchParams(location.search);
  const assignmentId = searchParams.get('assignmentId');

  const [phase, setPhase] = useState(0); // 0=details, 1=profile, 2=quiz, 3=agents, 4=done
  const [module, setModule] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    loadModule();
  }, [moduleId]);

  const loadModule = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await authFetch(`/api/modules/${moduleId}`);
      setModule(res);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  const handleAgentsDone = () => {
    const dest = `/module/${moduleId}/learn` + (assignmentId ? `?assignmentId=${assignmentId}` : '');
    navigate(dest);
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-[#0F172A] flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin text-indigo-400 text-4xl mb-4">⟳</div>
          <p className="text-slate-400 text-sm">Loading module...</p>
        </div>
      </div>
    );
  }

  if (error || !module) {
    return (
      <div className="min-h-screen bg-[#0F172A] flex items-center justify-center px-4">
        <div className="text-center max-w-sm">
          <div className="text-5xl mb-4">⚠️</div>
          <h2 className="text-xl font-black text-white mb-2">Module Not Found</h2>
          <p className="text-slate-400 text-sm mb-6">{error || 'Unable to load this module.'}</p>
          <button
            onClick={() => navigate('/dashboard')}
            className="px-6 py-3 rounded-xl font-bold bg-indigo-600 hover:bg-indigo-500 text-white transition-all"
          >
            ← Back to Dashboard
          </button>
        </div>
      </div>
    );
  }

  return (
    <>
      {phase === 0 && (
        <PhaseDetails
          module={module}
          onStart={() => setPhase(1)}
        />
      )}
      {phase === 1 && (
        <PhaseProfile
          module={module}
          onBack={() => setPhase(0)}
          onDone={() => setPhase(2)}
        />
      )}
      {phase === 2 && (
        <PhaseQuiz
          module={module}
          onBack={() => setPhase(1)}
          onDone={() => setPhase(3)}
        />
      )}
      {phase === 3 && (
        <PhaseAgents
          assignmentId={assignmentId}
          onDone={handleAgentsDone}
        />
      )}
    </>
  );
}
