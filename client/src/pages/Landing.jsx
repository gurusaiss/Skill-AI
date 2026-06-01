import React, { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { useAuth } from '../contexts/AuthContext.jsx';
import AuthModal from '../components/AuthModal.jsx';

// Agent thought stream for the demo animation (9 specialized agents)
const AGENT_DEMO_STEPS = [
  { delay: 0,    agent: 'GoalAgent',       icon: '🎯', color: '#6366F1', text: 'Analyzing your learning goal...' },
  { delay: 700,  agent: 'DecomposeAgent',  icon: '🌳', color: '#8B5CF6', text: 'Breaking down into core skills...' },
  { delay: 1400, agent: 'DiagnosticAgent', icon: '📋', color: '#06B6D4', text: 'Generating diagnostic questions...' },
  { delay: 2100, agent: 'ScoringAgent',    icon: '📊', color: '#0EA5E9', text: 'Identifying knowledge gaps...' },
  { delay: 2800, agent: 'CurriculumAgent', icon: '📅', color: '#14B8A6', text: 'Building personalized learning plan...' },
  { delay: 3500, agent: 'EvaluatorAgent',  icon: '✅', color: '#10B981', text: 'Evaluating practice responses...' },
  { delay: 4200, agent: 'AdaptorAgent',    icon: '⚡', color: '#F59E0B', text: 'Adapting plan based on performance...' },
  { delay: 4900, agent: 'MarketAgent',     icon: '💼', color: '#EC4899', text: 'Analyzing market opportunities...' },
  { delay: 5600, agent: 'InterviewAgent',  icon: '🎤', color: '#14B8A6', text: 'Preparing interview scenarios...' },
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
  MarketAgent: {
    icon: '💼', color: '#EC4899',
    title: 'Market Opportunity Agent',
    points: [
      'Analyzes current job market trends for your target skill',
      'Identifies in-demand industries and salary ranges',
      'Suggests career paths and next-level opportunities',
      'Recommends strategic skill combinations for market advantage',
    ],
  },
  InterviewAgent: {
    icon: '🎤', color: '#14B8A6',
    title: 'Interview Preparation Agent',
    points: [
      'Generates realistic interview questions for your skill area',
      'Simulates technical and behavioral interview scenarios',
      'Provides feedback on your answers and communication style',
      'Tracks interview readiness score as you progress',
    ],
  },
  SimulationAgent: {
    icon: '🎮', color: '#F59E0B',
    title: 'Simulation & Project Agent',
    points: [
      'Creates real-world project scenarios to apply your learning',
      'Simulates complex workflows and edge cases you\'ll encounter',
      'Generates capstone projects to demonstrate mastery',
      'Provides hands-on practice in production-like environments',
    ],
  },
};

// ── Differentiator tag popup info ─────────────────────────────────────────────
const TAG_INFO = {
  '🤖 True Multi-Agent Pipeline': {
    icon: '🤖', color: '#6366F1',
    title: 'True Multi-Agent Pipeline',
    points: [
      '9 specialized agents each handle a distinct part of your learning journey',
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
  { value: '9',    label: 'Specialized Agents' },
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
            <p className="text-xs font-black uppercase tracking-widest mb-0.5" style={{ color: info.color }}>
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
                className="w-5 h-5 rounded-md flex items-center justify-center text-xs font-black flex-shrink-0 mt-0.5 border"
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
          className="mt-5 w-full py-2.5 rounded-xl text-sm font-bold text-slate-400 border border-slate-700 hover:text-slate-200 hover:border-slate-500 transition-all"
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
    const reset = setTimeout(() => setShown([]), steps[steps.length - 1].delay + 1800);
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
              <span className="text-xs font-black uppercase tracking-widest" style={{ color: step.color }}>
                {step.agent}
              </span>
              <p className="text-xs text-slate-400 leading-relaxed">{step.text}</p>
            </div>
            <span className="text-xs text-slate-600 flex-shrink-0 mt-1 font-bold">ⓘ</span>
          </motion.button>
        ))}
      </AnimatePresence>
      {shown.length === 0 && (
        <div className="flex flex-col items-center justify-center h-full text-slate-700 text-sm gap-2">
          <div className="text-2xl opacity-40">🧠</div>
          <span>Agent system initializing...</span>
        </div>
      )}
    </div>
  );
}

// ── Section A: Animated Stats Counter ────────────────────────────────────────
const STAT_DATA = [
  { icon: '🎯', target: 10000, suffix: '+', label: 'Learning Sessions' },
  { icon: '📚', target: 500,   suffix: '+', label: 'Skills Available' },
  { icon: '⚡', target: 94,    suffix: '%', label: 'Completion Rate' },
  { icon: '🏆', target: 9,     suffix: '',  label: 'AI Agents Working' },
];

function useCountUp(target, duration = 2000, active = true) {
  const [count, setCount] = useState(0);
  useEffect(() => {
    if (!active) return;
    const steps = 60;
    const increment = target / steps;
    const interval = duration / steps;
    let current = 0;
    const timer = setInterval(() => {
      current += increment;
      if (current >= target) { setCount(target); clearInterval(timer); }
      else setCount(Math.round(current));
    }, interval);
    return () => clearInterval(timer);
  }, [target, duration, active]);
  return count;
}

function StatCountItem({ icon, target, suffix, label }) {
  const ref = useRef(null);
  const [active, setActive] = useState(false);
  useEffect(() => {
    const observer = new IntersectionObserver(([e]) => { if (e.isIntersecting) setActive(true); }, { threshold: 0.3 });
    if (ref.current) observer.observe(ref.current);
    return () => observer.disconnect();
  }, []);
  const count = useCountUp(target, 2000, active);
  const display = count >= 1000 ? (count / 1000).toFixed(count % 1000 === 0 ? 0 : 0) + 'K' : count;
  return (
    <div ref={ref} className="flex flex-col items-center gap-2 rounded-2xl border border-slate-700/60 bg-slate-900/70 p-6 backdrop-blur text-center">
      <span className="text-3xl mb-1">{icon}</span>
      <div className="text-4xl md:text-5xl font-black bg-gradient-to-br from-indigo-400 to-violet-400 bg-clip-text text-transparent font-mono leading-none">
        {display}{suffix}
      </div>
      <p className="text-sm font-semibold text-slate-400 mt-1">{label}</p>
    </div>
  );
}

function StatsCounter() {
  return (
    <motion.div
      initial={{ opacity: 0, y: 24 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: '-60px' }}
      transition={{ duration: 0.5 }}
      className="mt-20"
    >
      <p className="text-sm text-slate-600 mb-6 uppercase tracking-widest text-center">Platform at a glance</p>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {STAT_DATA.map(s => <StatCountItem key={s.label} {...s} />)}
      </div>
    </motion.div>
  );
}

// ── Section B: How It Works ───────────────────────────────────────────────────
const HOW_STEPS = [
  {
    num: 1,
    icon: '🎯',
    title: 'Set Your Goal',
    desc: 'Tell SkillForge what you want to learn. Our AI agents analyze your goal and instantly build a personalized skill tree.',
    color: '#6366F1',
  },
  {
    num: 2,
    icon: '📅',
    title: 'Follow Your Plan',
    desc: 'Practice with daily AI-powered challenges, quizzes, and feedback. Our system adapts based on your performance every session.',
    color: '#8B5CF6',
  },
  {
    num: 3,
    icon: '🚀',
    title: 'Land Your Dream Role',
    desc: 'Complete your plan, get your certificate, and access market intelligence to target the best opportunities.',
    color: '#06B6D4',
  },
];

function HowItWorks() {
  return (
    <motion.div
      initial={{ opacity: 0, y: 24 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: '-60px' }}
      transition={{ duration: 0.5 }}
      className="mt-20"
    >
      <p className="text-sm text-slate-600 mb-2 uppercase tracking-widest text-center">Simple process</p>
      <h2 className="text-2xl md:text-3xl font-black text-white text-center mb-10">
        From Zero to Job-Ready in <span className="bg-gradient-to-r from-indigo-400 to-violet-400 bg-clip-text text-transparent">3 Steps</span>
      </h2>
      <div className="flex flex-col md:flex-row gap-4 items-stretch">
        {HOW_STEPS.map((step, i) => (
          <React.Fragment key={step.num}>
            <div className="flex-1 rounded-2xl border border-slate-700/60 bg-slate-900/70 p-6 backdrop-blur flex flex-col gap-4">
              <div className="flex items-center gap-3">
                <div
                  className="w-10 h-10 rounded-xl flex items-center justify-center text-lg font-black border flex-shrink-0"
                  style={{ background: `${step.color}20`, borderColor: `${step.color}40`, color: step.color }}
                >
                  {step.num}
                </div>
                <span className="text-2xl">{step.icon}</span>
              </div>
              <div>
                <h3 className="text-base font-black text-white mb-2">{step.title}</h3>
                <p className="text-sm text-slate-400 leading-relaxed">{step.desc}</p>
              </div>
            </div>
            {i < HOW_STEPS.length - 1 && (
              <div className="hidden md:flex items-center text-slate-700 text-2xl flex-shrink-0 self-center px-1">
                →
              </div>
            )}
          </React.Fragment>
        ))}
      </div>
    </motion.div>
  );
}

// ── Section C: Feature Comparison Table ──────────────────────────────────────
const COMPARISON_ROWS = [
  { feature: 'Personalized Path',      sf: ['✅', 'AI-generated for you'], lms: ['❌', 'Same for everyone'], yt: ['❌', ''] },
  { feature: 'Real-time Adaptation',   sf: ['✅', 'Adjusts every session'],  lms: ['❌', 'Static content'],    yt: ['❌', ''] },
  { feature: 'Interview Practice',      sf: ['✅', 'AI interview simulator'], lms: ['❌', ''],                  yt: ['❌', ''] },
  { feature: 'Market Intelligence',     sf: ['✅', 'Live career insights'],   lms: ['❌', ''],                  yt: ['❌', ''] },
  { feature: 'Progress Tracking',       sf: ['✅', '9-agent analytics'],      lms: ['⚠️', 'Basic completion'], yt: ['❌', ''] },
];

function StatusIcon({ val }) {
  if (val === '✅') return <span className="text-emerald-400 font-black text-base">✅</span>;
  if (val === '⚠️') return <span className="text-amber-400 font-black text-base">⚠️</span>;
  return <span className="text-red-500 font-black text-base">❌</span>;
}

function ComparisonTable() {
  return (
    <motion.div
      initial={{ opacity: 0, y: 24 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: '-60px' }}
      transition={{ duration: 0.5 }}
      className="mt-20"
    >
      <p className="text-sm text-slate-600 mb-2 uppercase tracking-widest text-center">Why choose us</p>
      <h2 className="text-2xl md:text-3xl font-black text-white text-center mb-8">
        Why SkillForge Beats <span className="bg-gradient-to-r from-indigo-400 to-violet-400 bg-clip-text text-transparent">Traditional Learning</span>
      </h2>
      <div className="rounded-2xl border border-slate-700/60 bg-slate-900/70 overflow-hidden backdrop-blur">
        {/* Header */}
        <div className="grid grid-cols-4 border-b border-slate-700/60">
          <div className="px-5 py-4 text-xs font-black text-slate-500 uppercase tracking-widest">Feature</div>
          <div className="px-4 py-4 text-xs font-black text-indigo-400 uppercase tracking-widest text-center">SkillForge AI</div>
          <div className="px-4 py-4 text-xs font-black text-slate-500 uppercase tracking-widest text-center">Traditional LMS</div>
          <div className="px-4 py-4 text-xs font-black text-slate-500 uppercase tracking-widest text-center">YouTube/Courses</div>
        </div>
        {COMPARISON_ROWS.map((row, i) => (
          <div
            key={row.feature}
            className={`grid grid-cols-4 border-b border-slate-800/60 transition-colors hover:bg-slate-800/30 ${i % 2 === 0 ? 'bg-slate-900/40' : 'bg-slate-800/20'}`}
          >
            <div className="px-5 py-4 text-sm font-semibold text-slate-300">{row.feature}</div>
            <div className="px-4 py-4 flex flex-col items-center gap-0.5">
              <StatusIcon val={row.sf[0]} />
              {row.sf[1] && <span className="text-xs text-emerald-400/80 text-center leading-tight">{row.sf[1]}</span>}
            </div>
            <div className="px-4 py-4 flex flex-col items-center gap-0.5">
              <StatusIcon val={row.lms[0]} />
              {row.lms[1] && <span className="text-xs text-slate-500 text-center leading-tight">{row.lms[1]}</span>}
            </div>
            <div className="px-4 py-4 flex flex-col items-center gap-0.5">
              <StatusIcon val={row.yt[0]} />
            </div>
          </div>
        ))}
      </div>
    </motion.div>
  );
}

// ── Section D: Testimonials ───────────────────────────────────────────────────
const TESTIMONIALS = [
  {
    initials: 'PS',
    name: 'Priya S.',
    title: 'Junior Developer @ TCS',
    quote: 'I went from knowing nothing about React to getting a job offer in 6 weeks. The AI adapts to my exact weak spots.',
    color: '#6366F1',
  },
  {
    initials: 'RM',
    name: 'Rahul M.',
    title: 'Data Analyst @ Wipro',
    quote: 'The market intelligence feature helped me pick Python + SQL — exactly what my employer needed.',
    color: '#8B5CF6',
  },
  {
    initials: 'AK',
    name: 'Ananya K.',
    title: 'Product Manager @ Startup',
    quote: 'The interview simulator felt more realistic than actual interviews. It prepared me perfectly.',
    color: '#06B6D4',
  },
];

function Testimonials() {
  return (
    <motion.div
      initial={{ opacity: 0, y: 24 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: '-60px' }}
      transition={{ duration: 0.5 }}
      className="mt-20 mb-4"
    >
      <p className="text-sm text-slate-600 mb-2 uppercase tracking-widest text-center">Success stories</p>
      <h2 className="text-2xl md:text-3xl font-black text-white text-center mb-8">
        Learners <span className="bg-gradient-to-r from-indigo-400 to-violet-400 bg-clip-text text-transparent">Love SkillForge</span>
      </h2>
      <div className="grid md:grid-cols-3 gap-5">
        {TESTIMONIALS.map(t => (
          <div
            key={t.name}
            className="flex flex-col gap-4 rounded-2xl border border-slate-700/60 bg-[#1E293B] p-6 backdrop-blur"
          >
            {/* Stars */}
            <div className="text-amber-400 text-sm tracking-wide">⭐⭐⭐⭐⭐</div>
            {/* Quote */}
            <p className="text-sm text-slate-300 italic leading-relaxed flex-1">"{t.quote}"</p>
            {/* Author */}
            <div className="flex items-center gap-3 pt-2 border-t border-slate-700/40">
              <div
                className="w-10 h-10 rounded-xl flex items-center justify-center text-sm font-black flex-shrink-0 border"
                style={{ background: `${t.color}20`, borderColor: `${t.color}40`, color: t.color }}
              >
                {t.initials}
              </div>
              <div>
                <p className="text-sm font-black text-slate-100">{t.name}</p>
                <p className="text-xs text-slate-500">{t.title}</p>
              </div>
            </div>
          </div>
        ))}
      </div>
    </motion.div>
  );
}

// ── Main Landing ──────────────────────────────────────────────────────────────
export default function Landing() {
  const navigate = useNavigate();
  const { isAuthenticated, isLoading: authLoading } = useAuth();
  const [demoRunning, setDemoRunning] = useState(true);
  const [popup, setPopup] = useState(null);
  const [showAuthModal, setShowAuthModal] = useState(false);

  // Redirect authenticated users to dashboard
  useEffect(() => {
    if (!authLoading && isAuthenticated) {
      navigate('/dashboard');
    }
  }, [isAuthenticated, authLoading, navigate]);

  // Cycle demo every 30 seconds (auto-restart loop)
  useEffect(() => {
    const interval = setInterval(() => {
      setDemoRunning(false);
      setTimeout(() => setDemoRunning(true), 100);
    }, 11000);
    return () => clearInterval(interval);
  }, []);

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
            <div className="flex items-center gap-2 px-4 py-1.5 rounded-full border border-indigo-500/30 bg-indigo-500/8 text-sm font-semibold text-indigo-300">
              <span className="w-1.5 h-1.5 rounded-full bg-indigo-400 animate-pulse" />
              Autonomous AI Learning Platform · 9-Agent System
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
          
          {/* LEFT: Process + Value Props + Goal Input */}
          <motion.div
            initial={{ opacity: 0, x: -20 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: 0.2 }}
            className="space-y-5"
          >
            {/* Info header */}
            <div className="rounded-2xl border border-slate-700/60 bg-slate-900/70 p-6 backdrop-blur space-y-5">
              <div>
                <h3 className="text-base font-black text-slate-300 uppercase tracking-widest mb-1">Why SkillForge AI</h3>
                <p className="text-sm text-slate-500 leading-snug">The only learning platform that replaces every human instructor with structured AI — from diagnosis to certification.</p>
              </div>
              <div className="grid grid-cols-2 gap-2">
                {[
                  { emoji: '🎯', label: 'Goal → Plan',       desc: 'Raw goal parsed & structured by GoalAgent', agentKey: 'GoalAgent' },
                  { emoji: '🌳', label: 'Skill Tree',        desc: 'Auto-decomposed by DecomposeAgent', agentKey: 'DecomposeAgent' },
                  { emoji: '📋', label: 'Diagnostic Quiz',   desc: '5 MCQs generated per skill gap', agentKey: 'DiagnosticAgent' },
                  { emoji: '📊', label: 'Profile Report',    desc: 'ScoringAgent maps your 0–100% gaps', agentKey: 'ScoringAgent' },
                  { emoji: '📅', label: 'Personalised Plan', desc: 'CurriculumAgent builds a 14-day roadmap', agentKey: 'CurriculumAgent' },
                  { emoji: '⚡', label: 'Adaptive Path',     desc: 'AdaptorAgent adjusts daily based on scores', agentKey: 'AdaptorAgent' },
                  { emoji: '💼', label: 'Career Intelligence',desc: 'MarketAgent surfaces salary & roles', agentKey: 'MarketAgent' },
                  { emoji: '🎤', label: 'Interview Ready',  desc: 'InterviewAgent generates practice questions', agentKey: 'InterviewAgent' },
                  { emoji: '📜', label: 'Certification',    desc: 'EvaluatorAgent signs your competency proof', agentKey: 'EvaluatorAgent' },
                ].map(item => (
                  <button
                    key={item.label}
                    onClick={() => setPopup(AGENT_INFO[item.agentKey])}
                    className="flex items-start gap-2 rounded-lg bg-slate-800/40 border border-slate-700/50 p-2.5 text-left hover:bg-slate-700/50 hover:border-slate-600 transition-all active:scale-[0.98] group"
                  >
                    <span className="text-sm leading-none mt-0.5">{item.emoji}</span>
                    <div>
                      <div className="text-xs font-bold text-slate-300 leading-tight group-hover:text-white transition-colors">{item.label}</div>
                      <div className="text-xs text-slate-500 mt-0.5 leading-snug">{item.desc}</div>
                    </div>
                  </button>
                ))}
              </div>
            </div>

          </motion.div>

          {/* RIGHT: Terminal / Agent Demo */}
          <motion.div
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: 0.3 }}
          >
            <div className="rounded-2xl border border-slate-700/60 bg-[#060B14] overflow-hidden h-full">
              {/* Terminal header */}
              <div className="flex items-center gap-2 px-4 py-3 border-b border-slate-800 bg-slate-900/80">
                <div className="flex gap-1.5">
                  <div className="w-3 h-3 rounded-full bg-red-500/70" />
                  <div className="w-3 h-3 rounded-full bg-yellow-500/70" />
                  <div className="w-3 h-3 rounded-full bg-green-500/70" />
                </div>
                <span className="text-xs text-slate-500 font-mono mx-auto">
                  SkillForge Agent Runtime — Live
                </span>
                <span className="flex items-center gap-1">
                  <span className="w-1.5 h-1.5 bg-emerald-400 rounded-full animate-pulse" />
                  <span className="text-xs text-emerald-400">RUNNING</span>
                </span>
              </div>

              <div className="p-4 space-y-3">
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <p className="text-xs text-slate-600 uppercase tracking-widest font-bold">
                      Multi-Agent Reasoning Stream
                    </p>
                    <p className="text-xs text-slate-700 italic">tap any agent to learn more ⓘ</p>
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
                      <div className="text-xs text-slate-600">{m.label}</div>
                    </div>
                  ))}
                </div>

                <div className="text-xs text-slate-700 text-center pt-1">
                  Goal Analysis → Skill Decomposition → Adaptive Planning → Evaluation
                </div>
              </div>
            </div>
          </motion.div>
        </div>

        {/* ── BOTTOM DIFFERENTIATORS */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.5 }}
          className="mt-16 text-center"
        >
          <p className="text-sm text-slate-600 mb-4 uppercase tracking-widest">What makes SkillForge different</p>
          <div className="flex flex-wrap justify-center gap-3">
            {Object.keys(TAG_INFO).map(tag => (
              <button
                key={tag}
                onClick={() => setPopup(TAG_INFO[tag])}
                className="px-3 py-1.5 rounded-full text-sm font-semibold border border-slate-700/60 bg-slate-900/60 text-slate-400 hover:text-slate-200 hover:border-slate-500 hover:bg-slate-800/60 transition-all active:scale-[0.97]"
              >
                {tag}
              </button>
            ))}
          </div>
          <p className="text-xs text-slate-700 mt-3 italic">Click any tag to learn more</p>
        </motion.div>

        {/* ── FRONTIER FEATURES GRID ─────────────────────────────────────── */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.7 }}
          className="mt-16"
        >
          <p className="text-sm text-slate-600 mb-6 uppercase tracking-widest text-center">Frontier Intelligence Modules</p>
          <div className="grid md:grid-cols-4 gap-4">
            {[
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
                <div className="font-bold text-slate-200 text-base group-hover:text-white transition-all">{label}</div>
                <div className="text-slate-500 text-sm leading-relaxed">{desc}</div>
                <div className="text-sm font-semibold mt-auto" style={{ color }}>Open →</div>
              </button>
            ))}
          </div>
        </motion.div>

        {/* Sections removed for minimal landing page */}

      </div>

      {/* Fixed top-right: Sign In + Live Demo — vertically aligned with Navbar brand */}
      <div className="fixed top-3 right-6 z-40 flex items-center gap-2">
        <button
          onClick={() => setShowAuthModal(true)}
          className="h-9 px-4 rounded-xl font-semibold text-sm border border-slate-600/60 bg-slate-900/70 text-slate-300 hover:bg-slate-800 hover:border-slate-500 hover:text-white transition-all backdrop-blur-sm"
        >
          Sign In
        </button>
        <button
          onClick={() => navigate('/demo')}
          className="h-9 px-4 rounded-xl font-semibold text-sm bg-indigo-600 text-white hover:bg-indigo-500 transition-all shadow-lg shadow-indigo-500/25"
        >
          Live Demo →
        </button>
      </div>

      {/* Auth Modal */}
      <AuthModal isOpen={showAuthModal} onClose={() => setShowAuthModal(false)} />
    </div>
  );
}
