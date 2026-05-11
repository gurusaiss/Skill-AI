import React, { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { api } from '../utils/api.js';

const PLACEHOLDERS = [
  'I want to become a backend developer...',
  'I want to learn to cook professionally...',
  'I want to become a lawyer...',
  'I want to master guitar...',
  'I want to learn tailoring and fashion design...',
  'I want to become a doctor...',
  'I want to master UI/UX design...',
  'I want to learn machine learning...',
];

// Agent thought stream for the demo animation
const AGENT_DEMO_STEPS = [
  { delay: 0,    agent: 'GoalAgent',       icon: '🎯', color: '#6366F1', text: 'Analyzing your learning goal...' },
  { delay: 800,  agent: 'DecomposeAgent',  icon: '🌳', color: '#8B5CF6', text: 'Breaking down into core skills...' },
  { delay: 1600, agent: 'DiagnosticAgent', icon: '📋', color: '#06B6D4', text: 'Generating diagnostic questions...' },
  { delay: 2400, agent: 'ScoringAgent',    icon: '📊', color: '#0EA5E9', text: 'Identifying knowledge gaps...' },
  { delay: 3200, agent: 'CurriculumAgent', icon: '📅', color: '#14B8A6', text: 'Building personalized learning plan...' },
  { delay: 4000, agent: 'EvaluatorAgent',  icon: '✅', color: '#10B981', text: 'Evaluating practice responses...' },
  { delay: 4800, agent: 'AdaptorAgent',    icon: '⚡', color: '#F59E0B', text: 'Adapting plan based on performance' },
];

// ── Agent popup info ──────────────────────────────────────────────────────────
const AGENT_INFO = {
  GoalAgent: {
    icon: '🎯', color: '#6366F1',
    title: 'Goal Analysis Agent',
    points: [
      'Parses your raw learning goal using natural language understanding',
      'Extracts target domain, skill areas, and career intent',
      'Builds your initial learner profile (experience level, tools, intensity)',
      'Maps your goal to a specialized domain knowledge graph',
    ],
  },
  DecomposeAgent: {
    icon: '🌳', color: '#8B5CF6',
    title: 'Skill Decomposition Agent',
    points: [
      'Breaks your goal into 4–6 concrete, teachable skills',
      'Builds a skill dependency tree (e.g. HTML → CSS → JS → React)',
      'Prioritizes skills by foundational importance and learning order',
      'Estimates time required per skill based on your experience level',
    ],
  },
  DiagnosticAgent: {
    icon: '📋', color: '#06B6D4',
    title: 'Diagnostic Agent',
    points: [
      'Generates exactly 5 MCQ questions based on your skill tree',
      'Uses a hybrid rule engine: rule-based for known domains, AI for others',
      'Each question targets a specific concept at calibrated difficulty',
      'Results feed directly into your personalized learning plan',
    ],
  },
  ScoringAgent: {
    icon: '📊', color: '#0EA5E9',
    title: 'Scoring & Gap Analysis Agent',
    points: [
      'Analyses your diagnostic answers to identify knowledge gaps',
      'Calculates a mastery score for each skill (0–100%)',
      'Flags specific weak concepts for targeted practice',
      'Gap data drives curriculum time allocation across the plan',
    ],
  },
  CurriculumAgent: {
    icon: '📅', color: '#14B8A6',
    title: 'Curriculum Planning Agent',
    points: [
      'Builds a personalized day-by-day learning roadmap',
      'Balances concept, practice, and review session types',
      'Allocates more days to skills with lower diagnostic scores',
      'Generates a 14–21 day plan tailored to your experience level',
    ],
  },
  EvaluatorAgent: {
    icon: '✅', color: '#10B981',
    title: 'Evaluation Agent',
    points: [
      'Evaluates your written practice responses with AI scoring',
      'Grades on 4 criteria: understanding, application, examples, reasoning',
      'Provides specific strengths and areas to improve per session',
      'Calibrates scoring against your declared confidence level',
    ],
  },
  AdaptorAgent: {
    icon: '⚡', color: '#F59E0B',
    title: 'Adaptation Agent',
    points: [
      'Monitors your performance trends after every session in real-time',
      'Auto-inserts review days when scores drop below 60%',
      'Adjusts session difficulty based on your recent trajectory',
      'Reprioritizes weak skills in upcoming sessions dynamically',
    ],
  },
};

// ── Differentiator tag popup info ─────────────────────────────────────────────
const TAG_INFO = {
  '🤖 True Multi-Agent Pipeline': {
    icon: '🤖', color: '#6366F1',
    title: 'True Multi-Agent Pipeline',
    points: [
      '7 specialized agents each handle a distinct part of your learning journey',
      'Agents communicate by passing structured state between each other',
      'No single "do-everything" model — every agent is a specialist',
      'The full pipeline runs autonomously from goal input to competency report',
    ],
  },
  '⚡ Real-Time Plan Adaptation': {
    icon: '⚡', color: '#F59E0B',
    title: 'Real-Time Plan Adaptation',
    points: [
      'The Adaptor Agent monitors every session result as it completes',
      'Scores below 60% automatically trigger review day insertion',
      'Strong performance unlocks accelerated paths through the curriculum',
      'Your plan evolves session-by-session — not a rigid static schedule',
    ],
  },
  '🔮 14-Day Mastery Forecast': {
    icon: '🔮', color: '#8B5CF6',
    title: '14-Day Mastery Forecast',
    points: [
      'Uses your performance trajectory to predict mastery at day 14',
      'Identifies which skills you will master vs. likely struggle with',
      'Helps you focus effort on at-risk areas proactively',
      'Visible in the Performance tab of your dashboard as a visual chart',
    ],
  },
  '🧠 Skill Digital Twin': {
    icon: '🧠', color: '#06B6D4',
    title: 'Skill Digital Twin',
    points: [
      'A live model of your current knowledge state for each skill',
      'Updated after every session based on scores and response quality',
      'Shows mastery %, status (active/locked/complete), and topic gaps',
      'Acts as an accurate mirror of your real-world skill level at any moment',
    ],
  },
  '🧭 Confidence Calibration': {
    icon: '🧭', color: '#14B8A6',
    title: 'Confidence Calibration',
    points: [
      'Before each session, you predict your confidence level (1–5)',
      'After scoring, your prediction is compared to your actual result',
      'Tracks metacognitive accuracy — a key self-directed learning skill',
      'Identifies overconfidence and underconfidence patterns over time',
    ],
  },
  '📊 Full Explainability Log': {
    icon: '📊', color: '#10B981',
    title: 'Full Explainability Log',
    points: [
      'Every agent decision is logged with reasoning and a timestamp',
      'View the Agent Brain tab to see exactly how your plan was built',
      'Understand why a review day was added or a skill was prioritized',
      'Full transparency — no black-box decisions, ever',
    ],
  },
};

const STATS = [
  { value: '7',    label: 'Specialized Agents' },
  { value: '∞',    label: 'Skills Supported' },
  { value: '100%', label: 'Autonomous Operation' },
  { value: 'AI',   label: 'Powered Learning' },
];

const FLOW_STEPS = [
  { icon: '🔍', title: 'Diagnose', desc: 'Maps your exact knowledge gaps' },
  { icon: '📋', title: 'Plan',     desc: 'Builds personalized day-by-day path' },
  { icon: '⚔️', title: 'Practice', desc: 'Adaptive challenges with evaluation' },
  { icon: '📜', title: 'Certify',  desc: 'Evidence-based competency proof' },
];

// ── Info Popup Modal ──────────────────────────────────────────────────────────
function InfoModal({ info, onClose }) {
  if (!info) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center px-4" onClick={onClose}>
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" />
      {/* Modal */}
      <motion.div
        initial={{ opacity: 0, scale: 0.92, y: 16 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.92, y: 16 }}
        transition={{ duration: 0.2 }}
        className="relative z-10 w-full max-w-md rounded-2xl border bg-[#0F172A] p-6 shadow-2xl"
        style={{ borderColor: `${info.color}30` }}
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-start gap-3 mb-4">
          <div
            className="w-11 h-11 rounded-xl flex items-center justify-center text-2xl flex-shrink-0 border"
            style={{ backgroundColor: `${info.color}15`, borderColor: `${info.color}30` }}
          >
            {info.icon}
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-[9px] font-black uppercase tracking-widest mb-0.5" style={{ color: info.color }}>
              SkillForge System
            </p>
            <h3 className="text-base font-black text-slate-100 leading-tight">{info.title}</h3>
          </div>
          <button
            onClick={onClose}
            className="flex-shrink-0 w-7 h-7 rounded-lg bg-slate-800 text-slate-400 hover:text-white hover:bg-slate-700 flex items-center justify-center text-sm transition-all"
          >
            ✕
          </button>
        </div>
        {/* Points */}
        <ul className="space-y-2.5">
          {(info.points || []).map((pt, i) => (
            <li key={i} className="flex items-start gap-2.5 text-sm text-slate-300">
              <span
                className="w-5 h-5 rounded-md flex items-center justify-center text-[10px] font-black flex-shrink-0 mt-0.5 border"
                style={{ backgroundColor: `${info.color}15`, borderColor: `${info.color}30`, color: info.color }}
              >
                {i + 1}
              </span>
              <span className="leading-relaxed">{pt}</span>
            </li>
          ))}
        </ul>
        <button
          onClick={onClose}
          className="mt-5 w-full py-2.5 rounded-xl text-xs font-bold text-slate-400 border border-slate-700 hover:text-slate-200 hover:border-slate-500 transition-all"
        >
          Got it →
        </button>
      </motion.div>
    </div>
  );
}

// ── Agent Thought Stream ──────────────────────────────────────────────────────
function AgentThoughtStream({ steps, visible, onStepClick }) {
  const [shown, setShown] = useState([]);
  const scrollRef = useRef(null);

  useEffect(() => {
    if (!visible) { setShown([]); return; }
    const timers = steps.map(step =>
      setTimeout(() => setShown(prev => [...prev, step]), step.delay)
    );
    const reset = setTimeout(() => setShown([]), steps[steps.length - 1].delay + 2200);
    return () => { timers.forEach(clearTimeout); clearTimeout(reset); };
  }, [visible]);

  // Auto-scroll to bottom as new items appear
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [shown]);

  return (
    <div
      ref={scrollRef}
      className="space-y-1.5 h-52 overflow-y-auto pr-1"
      style={{ scrollbarWidth: 'thin', scrollbarColor: '#334155 transparent' }}
    >
      <AnimatePresence>
        {shown.map((step, i) => (
          <motion.button
            key={`${step.agent}-${i}`}
            initial={{ opacity: 0, x: -16, height: 0 }}
            animate={{ opacity: 1, x: 0, height: 'auto' }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.35 }}
            className="w-full flex items-start gap-2 rounded-lg p-2 text-left transition-all hover:brightness-125 active:scale-[0.98]"
            style={{ backgroundColor: `${step.color}08`, border: `1px solid ${step.color}20` }}
            onClick={() => onStepClick && onStepClick(AGENT_INFO[step.agent])}
          >
            <span className="text-sm flex-shrink-0">{step.icon}</span>
            <div className="min-w-0 flex-1">
              <span className="text-[9px] font-black uppercase tracking-widest" style={{ color: step.color }}>
                {step.agent}
              </span>
              <p className="text-[10px] text-slate-400 leading-relaxed">{step.text}</p>
            </div>
            <span className="text-[8px] text-slate-600 flex-shrink-0 mt-1 font-bold">ⓘ</span>
          </motion.button>
        ))}
      </AnimatePresence>
      {shown.length === 0 && (
        <div className="flex flex-col items-center justify-center h-full text-slate-700 text-xs gap-2">
          <div className="text-2xl opacity-40">🧠</div>
          <span>Agent system initializing...</span>
        </div>
      )}
    </div>
  );
}

// ── Main Landing ──────────────────────────────────────────────────────────────
export default function Landing() {
  const navigate = useNavigate();
  const [goalText, setGoalText] = useState('');
  const [phIdx, setPhIdx] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [demoRunning, setDemoRunning] = useState(true);
  const [popup, setPopup] = useState(null);

  // Cycle demo every 6.5 seconds
  useEffect(() => {
    const interval = setInterval(() => {
      setDemoRunning(false);
      setTimeout(() => setDemoRunning(true), 100);
    }, 6500);
    return () => clearInterval(interval);
  }, []);

  // Cycle placeholders
  useEffect(() => {
    const t = setInterval(() => setPhIdx(i => (i + 1) % PLACEHOLDERS.length), 2200);
    return () => clearInterval(t);
  }, []);

  const handleSubmit = async e => {
    e.preventDefault();
    if (goalText.trim().length < 5) return;
    setLoading(true);
    setError('');
    try {
      const data = await api.createGoal({ goalText });
      localStorage.setItem('skillforge:userId', data.userId);
      localStorage.setItem('skillforge:goalResponse', JSON.stringify(data));
      navigate('/profiling', { state: data });
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const loadDemo = async () => {
    setLoading(true);
    setError('');
    try {
      // Create a fresh demo session with a sample goal
      const demoGoal = 'I want to learn React for web development';
      const data = await api.createGoal({ goalText: demoGoal });

      // Auto-submit diagnostic with sample answers (random selections)
      const sampleAnswers = data.diagnosticQuestions.map((q) => {
        if (q.type === 'multiple-choice') {
          // Pick a random option for MC questions
          const randomIndex = Math.floor(Math.random() * q.options.length);
          return q.options[randomIndex];
        } else {
          // Provide a sample answer for open-ended questions
          return 'This is a sample response demonstrating understanding of the concept.';
        }
      });

      await api.submitDiagnostic({
        userId: data.userId,
        answers: sampleAnswers,
      });

      localStorage.setItem('skillforge:userId', data.userId);
      navigate('/dashboard');
    } catch (err) {
      setError('Demo failed to load: ' + err.message);
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#060B14] overflow-hidden">
      {/* Info popup modal */}
      <AnimatePresence>
        {popup && <InfoModal info={popup} onClose={() => setPopup(null)} />}
      </AnimatePresence>

      {/* Radial gradient background */}
      <div className="fixed inset-0 pointer-events-none">
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[800px] h-[500px] rounded-full bg-indigo-600/10 blur-[120px]" />
        <div className="absolute bottom-0 right-0 w-[400px] h-[400px] rounded-full bg-purple-600/8 blur-[100px]" />
      </div>

      <div className="relative max-w-7xl mx-auto px-6 pt-14 pb-20">

        {/* ── HERO ───────────────────────────────────────────────────────── */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.05 }}
          className="text-center mb-12"
        >
          {/* Platform badge */}
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            className="flex justify-center mb-6"
          >
            <div className="flex items-center gap-2 px-4 py-1.5 rounded-full border border-indigo-500/30 bg-indigo-500/8 text-xs font-semibold text-indigo-300">
              <span className="w-1.5 h-1.5 rounded-full bg-indigo-400 animate-pulse" />
              Autonomous AI Learning Platform · 7-Agent System
            </div>
          </motion.div>

          {/* Brand — large & prominent */}
          <h1 className="text-7xl md:text-8xl font-black tracking-tight leading-none mb-3">
            <span className="bg-gradient-to-r from-indigo-400 via-purple-400 to-cyan-400 bg-clip-text text-transparent">
              SKILL FORGE
            </span>
          </h1>
          <p className="text-2xl md:text-3xl font-black text-slate-300 mb-5">
            Master Any Skill.{' '}
            <span className="text-slate-500">Autonomously.</span>
          </p>
          <p className="max-w-2xl mx-auto text-base text-slate-400 leading-relaxed">
            A multi-agent AI system that diagnoses your gaps, builds a personalized plan,
            runs adaptive practice sessions, and certifies mastery —{' '}
            <em className="text-slate-300">without waiting for human instruction.</em>
          </p>
        </motion.div>

        {/* ── MAIN GRID ──────────────────────────────────────────────────── */}
        <div className="grid lg:grid-cols-2 gap-8 items-start">

          {/* LEFT: Goal input */}
          <motion.div
            initial={{ opacity: 0, x: -20 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: 0.2 }}
            className="space-y-5"
          >
            <div className="rounded-2xl border border-slate-700/60 bg-slate-900/70 p-6 backdrop-blur">
              <h2 className="text-sm font-black text-slate-300 uppercase tracking-widest mb-4">
                Start Your Learning Journey
              </h2>
              <form onSubmit={handleSubmit} className="space-y-4">
                <textarea
                  value={goalText}
                  onChange={e => setGoalText(e.target.value)}
                  placeholder={PLACEHOLDERS[phIdx]}
                  className="w-full min-h-[120px] rounded-xl border border-slate-700 bg-[#060B14] p-4 text-slate-100 placeholder-slate-600 focus:border-indigo-500 focus:outline-none resize-none transition-colors text-sm"
                />
                <div className="flex flex-col sm:flex-row gap-3">
                  <button
                    type="submit"
                    disabled={goalText.trim().length < 5 || loading}
                    className="flex-1 py-3.5 rounded-xl font-bold text-sm bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-500 hover:to-purple-500 text-white transition-all disabled:opacity-40 disabled:cursor-not-allowed active:scale-[0.98]"
                  >
                    {loading ? '⏳ Agent analyzing...' : 'Start My AI Journey →'}
                  </button>
                  <button
                    type="button"
                    onClick={() => navigate('/demo')}
                    className="px-5 py-3.5 rounded-xl font-bold text-sm border border-emerald-500/40 bg-emerald-500/10 text-emerald-300 hover:bg-emerald-500/20 transition-all"
                  >
                    🚀 Live Demo
                  </button>
                </div>
                {error && <p className="text-xs text-red-400">{error}</p>}
              </form>
            </div>

            {/* Flow steps */}
            <div className="grid grid-cols-4 gap-2">
              {FLOW_STEPS.map(step => (
                <div key={step.title} className="rounded-xl border border-slate-800 bg-slate-900/50 p-3 text-center">
                  <div className="text-2xl mb-1">{step.icon}</div>
                  <div className="text-xs font-bold text-slate-300">{step.title}</div>
                  <div className="text-[9px] text-slate-600 mt-0.5 leading-snug">{step.desc}</div>
                </div>
              ))}
            </div>

            {/* Stats */}
            <div className="grid grid-cols-2 gap-3">
              {STATS.map(stat => (
                <div key={stat.label} className="rounded-xl border border-slate-800 bg-slate-900/50 p-3">
                  <div className="text-2xl font-black text-indigo-400">{stat.value}</div>
                  <div className="text-[10px] text-slate-500 mt-0.5 uppercase tracking-wider">{stat.label}</div>
                </div>
              ))}
            </div>
          </motion.div>

          {/* RIGHT: Live agent demo terminal */}
          <motion.div
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: 0.3 }}
          >
            <div className="rounded-2xl border border-slate-700/60 bg-[#060B14] overflow-hidden">
              {/* Terminal header */}
              <div className="flex items-center gap-2 px-4 py-3 border-b border-slate-800 bg-slate-900/80">
                <div className="flex gap-1.5">
                  <div className="w-3 h-3 rounded-full bg-red-500/70" />
                  <div className="w-3 h-3 rounded-full bg-yellow-500/70" />
                  <div className="w-3 h-3 rounded-full bg-green-500/70" />
                </div>
                <span className="text-[10px] text-slate-500 font-mono mx-auto">
                  SkillForge Agent Runtime — Live
                </span>
                <span className="flex items-center gap-1">
                  <span className="w-1.5 h-1.5 bg-emerald-400 rounded-full animate-pulse" />
                  <span className="text-[9px] text-emerald-400">RUNNING</span>
                </span>
              </div>

              <div className="p-4 space-y-3">
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <p className="text-[9px] text-slate-600 uppercase tracking-widest font-bold">
                      Multi-Agent Reasoning Stream
                    </p>
                    <p className="text-[8px] text-slate-700 italic">tap any agent to learn more ⓘ</p>
                  </div>
                  <AgentThoughtStream
                    steps={AGENT_DEMO_STEPS}
                    visible={demoRunning}
                    onStepClick={info => info && setPopup(info)}
                  />
                </div>

                {/* Metrics */}
                <div className="grid grid-cols-3 gap-2 pt-2 border-t border-slate-800">
                  {[
                    { label: 'Decisions',   value: '11',   color: '#6366F1' },
                    { label: 'Adaptations', value: '2',    color: '#F59E0B' },
                    { label: 'Mastery ↑',   value: '+44%', color: '#10B981' },
                  ].map(m => (
                    <div key={m.label} className="text-center rounded-lg bg-slate-900 border border-slate-800 p-2">
                      <div className="text-base font-black font-mono" style={{ color: m.color }}>{m.value}</div>
                      <div className="text-[9px] text-slate-600">{m.label}</div>
                    </div>
                  ))}
                </div>

                <div className="text-[9px] text-slate-700 text-center pt-1">
                  Goal Analysis → Skill Decomposition → Adaptive Planning → Evaluation
                </div>
              </div>
            </div>
          </motion.div>
        </div>

        {/* ── BOTTOM DIFFERENTIATORS ─────────────────────────────────────── */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.5 }}
          className="mt-16 text-center"
        >
          <p className="text-xs text-slate-600 mb-4 uppercase tracking-widest">What makes SkillForge different</p>
          <div className="flex flex-wrap justify-center gap-3">
            {Object.keys(TAG_INFO).map(tag => (
              <button
                key={tag}
                onClick={() => setPopup(TAG_INFO[tag])}
                className="px-3 py-1.5 rounded-full text-[11px] font-semibold border border-slate-700/60 bg-slate-900/60 text-slate-400 hover:text-slate-200 hover:border-slate-500 hover:bg-slate-800/60 transition-all active:scale-[0.97]"
              >
                {tag}
              </button>
            ))}
          </div>
          <p className="text-[9px] text-slate-700 mt-3 italic">Click any tag to learn more</p>
        </motion.div>

        {/* ── FRONTIER FEATURES GRID ─────────────────────────────────────── */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.7 }}
          className="mt-16"
        >
          <p className="text-xs text-slate-600 mb-6 uppercase tracking-widest text-center">Frontier Intelligence Modules</p>
          <div className="grid md:grid-cols-4 gap-4">
            {[
              { icon: '🚀', label: 'Live Demo', desc: 'Watch 7 agents orchestrate in real-time', path: '/demo', color: '#10B981' },
              { icon: '🧬', label: 'Career Digital Twin', desc: 'Your evolving virtual career model', path: '/career-twin', color: '#6366F1' },
              { icon: '🔮', label: 'Simulation Lab', desc: 'What-if career scenario analyzer', path: '/simulation', color: '#8B5CF6' },
              { icon: '🎤', label: 'Interview Simulator', desc: 'AI-powered mock interviews', path: '/interview', color: '#EC4899' },
              { icon: '🧠', label: 'Explainability Console', desc: 'Full agent reasoning chain', path: '/explain', color: '#F59E0B' },
            ].map(({ icon, label, desc, path, color }) => (
              <button key={path} onClick={() => navigate(path)}
                className="flex flex-col items-start gap-2 p-4 rounded-xl border border-slate-700/60 bg-slate-900/50 hover:bg-slate-900/80 hover:border-slate-600 transition-all text-left group">
                <div className="w-9 h-9 rounded-lg flex items-center justify-center text-xl"
                  style={{ background: color + '15', border: `1px solid ${color}30` }}>
                  {icon}
                </div>
                <div className="font-bold text-slate-200 text-sm group-hover:text-white transition-all">{label}</div>
                <div className="text-slate-500 text-xs leading-relaxed">{desc}</div>
                <div className="text-xs font-semibold mt-auto" style={{ color }}>Open →</div>
              </button>
            ))}
          </div>
        </motion.div>

      </div>
    </div>
  );
}
