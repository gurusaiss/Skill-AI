/**
 * DemoMode.jsx — Simulated Live Agent Orchestration Demo
 * Fully client-side — no backend dependency, always works
 */

import React, { useState, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';

const DEMO_GOALS = [
  { key: 'fullstack', label: '🌐 Full Stack Developer', desc: 'React · Node.js · PostgreSQL · Production Apps' },
  { key: 'datascience', label: '🤖 Data Scientist', desc: 'ML · Python · Statistical Analysis · Insights' },
  { key: 'doctor', label: '🏥 Medical Doctor', desc: 'MBBS · Internal Medicine · Clinical Diagnosis' },
  { key: 'lawyer', label: '⚖️ Corporate Lawyer', desc: 'Tech Law · IP · Contract Drafting · Litigation' },
  { key: 'devops', label: '☸️ DevOps Engineer', desc: 'Kubernetes · AWS · CI/CD · Infrastructure' },
];

const AGENT_COLORS = {
  GoalAgent:       '#6366F1',
  DecomposeAgent:  '#10B981',
  DiagnosticAgent: '#F59E0B',
  ScoringAgent:    '#EF4444',
  CurriculumAgent: '#8B5CF6',
  EvaluatorAgent:  '#10B981',
  AdaptorAgent:    '#F59E0B',
  MarketAgent:     '#06B6D4',
  SimulationAgent: '#14B8A6',
};

const DEMO_SCRIPTS = {
  fullstack: {
    domain: 'Full Stack Development',
    skills: [
      { name: 'HTML & CSS Fundamentals', days: 5 },
      { name: 'JavaScript (ES6+)', days: 10 },
      { name: 'React & Component Architecture', days: 14 },
      { name: 'Node.js & Express', days: 10 },
      { name: 'PostgreSQL & Database Design', days: 8 },
      { name: 'REST API Design', days: 6 },
      { name: 'Authentication & Security', days: 5 },
      { name: 'Deployment & DevOps Basics', days: 4 },
    ],
    diagnosticCount: 12,
    scores: [
      { skill: 'JavaScript', score: 62 },
      { skill: 'React', score: 38 },
      { skill: 'Node.js', score: 44 },
    ],
    sessions: 58,
    reviewSessions: 9,
    market: { demandScore: 92, openJobs: 48200, avgSalary: 112000, topSkills: ['React', 'Node.js', 'TypeScript'] },
    trajectory: [{ month: 1, readiness: 28 }, { month: 3, readiness: 65 }, { month: 6, readiness: 91 }],
    projectedSalary: 112000,
  },
  datascience: {
    domain: 'Data Science & Machine Learning',
    skills: [
      { name: 'Python & Libraries', days: 8 },
      { name: 'Statistics & Probability', days: 10 },
      { name: 'Data Wrangling (Pandas/NumPy)', days: 7 },
      { name: 'Machine Learning (Scikit-learn)', days: 14 },
      { name: 'Deep Learning (PyTorch)', days: 12 },
      { name: 'Feature Engineering', days: 6 },
      { name: 'Model Evaluation & Deployment', days: 7 },
      { name: 'Data Visualization', days: 5 },
    ],
    diagnosticCount: 14,
    scores: [
      { skill: 'Python', score: 71 },
      { skill: 'Statistics', score: 55 },
      { skill: 'Machine Learning', score: 29 },
    ],
    sessions: 64,
    reviewSessions: 11,
    market: { demandScore: 96, openJobs: 32700, avgSalary: 128000, topSkills: ['Python', 'TensorFlow', 'SQL'] },
    trajectory: [{ month: 1, readiness: 22 }, { month: 3, readiness: 58 }, { month: 6, readiness: 87 }],
    projectedSalary: 128000,
  },
  doctor: {
    domain: 'Medical Science (MBBS)',
    skills: [
      { name: 'Anatomy & Physiology', days: 20 },
      { name: 'Biochemistry & Genetics', days: 15 },
      { name: 'Pathology & Pharmacology', days: 18 },
      { name: 'Internal Medicine', days: 22 },
      { name: 'Clinical Diagnosis', days: 16 },
      { name: 'Surgery Fundamentals', days: 12 },
      { name: 'Patient Communication', days: 8 },
    ],
    diagnosticCount: 16,
    scores: [
      { skill: 'Biology Foundations', score: 74 },
      { skill: 'Clinical Knowledge', score: 31 },
      { skill: 'Pharmacology', score: 42 },
    ],
    sessions: 96,
    reviewSessions: 18,
    market: { demandScore: 98, openJobs: 85400, avgSalary: 220000, topSkills: ['Diagnosis', 'Internal Medicine', 'Research'] },
    trajectory: [{ month: 1, readiness: 12 }, { month: 3, readiness: 38 }, { month: 6, readiness: 62 }],
    projectedSalary: 220000,
  },
  lawyer: {
    domain: 'Corporate & Technology Law',
    skills: [
      { name: 'Contract Law & Drafting', days: 12 },
      { name: 'Intellectual Property', days: 10 },
      { name: 'Corporate Governance', days: 8 },
      { name: 'Technology Law & Privacy', days: 9 },
      { name: 'Litigation & Dispute Resolution', days: 11 },
      { name: 'Legal Research & Writing', days: 7 },
    ],
    diagnosticCount: 10,
    scores: [
      { skill: 'Contract Law', score: 55 },
      { skill: 'IP Law', score: 27 },
      { skill: 'Legal Research', score: 61 },
    ],
    sessions: 52,
    reviewSessions: 8,
    market: { demandScore: 84, openJobs: 18900, avgSalary: 145000, topSkills: ['IP Law', 'Contract Drafting', 'Compliance'] },
    trajectory: [{ month: 1, readiness: 19 }, { month: 3, readiness: 52 }, { month: 6, readiness: 83 }],
    projectedSalary: 145000,
  },
  devops: {
    domain: 'DevOps & Cloud Engineering',
    skills: [
      { name: 'Linux & Bash Scripting', days: 6 },
      { name: 'Docker & Containerization', days: 8 },
      { name: 'Kubernetes Orchestration', days: 12 },
      { name: 'AWS / Cloud Platforms', days: 14 },
      { name: 'CI/CD Pipelines', days: 8 },
      { name: 'Infrastructure as Code (Terraform)', days: 9 },
      { name: 'Monitoring & Observability', days: 6 },
    ],
    diagnosticCount: 12,
    scores: [
      { skill: 'Linux', score: 68 },
      { skill: 'Docker', score: 47 },
      { skill: 'Kubernetes', score: 21 },
    ],
    sessions: 60,
    reviewSessions: 10,
    market: { demandScore: 94, openJobs: 38100, avgSalary: 118000, topSkills: ['Kubernetes', 'AWS', 'Terraform'] },
    trajectory: [{ month: 1, readiness: 24 }, { month: 3, readiness: 61 }, { month: 6, readiness: 89 }],
    projectedSalary: 118000,
  },
};

function AgentPill({ name, status }) {
  const color = AGENT_COLORS[name] || '#6B7280';
  const isActive = status === 'active';
  const isDone = status === 'complete';
  return (
    <div className={`flex items-center gap-2 px-3 py-1.5 rounded-full border text-xs font-medium transition-all duration-500 ${isActive ? 'scale-105 shadow-lg' : ''}`}
      style={{
        borderColor: isDone ? color : isActive ? color : '#334155',
        background: isDone ? color + '20' : isActive ? color + '15' : 'transparent',
        color: isDone || isActive ? color : '#64748B',
        boxShadow: isActive ? `0 0 16px ${color}60` : 'none',
      }}>
      <div className={`w-2 h-2 rounded-full ${isActive ? 'animate-ping' : ''}`}
        style={{ background: isDone ? color : isActive ? color : '#334155' }} />
      {name}
      {isDone && <span className="ml-1">✓</span>}
    </div>
  );
}

function StepCard({ step, isLatest }) {
  return (
    <div className={`flex gap-4 items-start transition-all duration-500 ${isLatest ? 'opacity-100' : 'opacity-70'}`}>
      <div className="flex flex-col items-center shrink-0">
        <div className="w-9 h-9 rounded-xl flex items-center justify-center text-lg"
          style={{
            background: (AGENT_COLORS[step.agent] || '#6B7280') + '20',
            border: `1px solid ${(AGENT_COLORS[step.agent] || '#6B7280')}40`,
          }}>
          {step.icon || '🤖'}
        </div>
        <div className="w-0.5 h-full mt-1 bg-slate-700 min-h-4" />
      </div>
      <div className="pb-5 flex-1">
        <div className="flex items-center gap-2 flex-wrap mb-1">
          <span className="font-semibold text-white text-sm">{step.agent}</span>
          {step.status === 'active' && (
            <span className="flex items-center gap-1 text-xs text-amber-400 animate-pulse">
              <span className="w-1.5 h-1.5 bg-amber-400 rounded-full animate-ping" /> processing...
            </span>
          )}
          {step.status === 'complete' && (
            <span className="text-emerald-400 text-xs font-semibold">✓ complete</span>
          )}
          <span className="ml-auto text-slate-600 text-xs">step {step.step}/{step.total}</span>
        </div>
        <div className="text-slate-300 text-sm">{step.message}</div>
        {step.data && (
          <div className="mt-2 bg-slate-900/60 rounded-lg p-3 font-mono text-xs text-slate-400 whitespace-pre-wrap">
            {JSON.stringify(step.data, null, 2)}
          </div>
        )}
      </div>
    </div>
  );
}

function buildScript(goal, script) {
  const GOAL_TEXT = {
    fullstack: 'I want to become a Full Stack Developer proficient in React, Node.js, and PostgreSQL',
    datascience: 'I want to become a Data Scientist who can build ML models and extract insights',
    doctor: 'I want to become a Medical Doctor (MBBS) specializing in internal medicine',
    lawyer: 'I want to become a Corporate Lawyer specializing in technology and IP law',
    devops: 'I want to become a DevOps/Cloud Engineer proficient in Kubernetes and AWS',
  };

  return [
    {
      delayBefore: 400,
      step: { step: 1, total: 9, agent: 'GoalAgent', icon: '🎯', status: 'active',
        message: `Analyzing career goal: "${GOAL_TEXT[goal]}..."` },
    },
    {
      delayBefore: 700,
      step: { step: 1, total: 9, agent: 'GoalAgent', icon: '🎯', status: 'complete',
        message: `Goal parsed — domain identified as "${script.domain}"`,
        data: { domain: script.domain, intent: 'career_mastery', complexity: 'advanced' },
      },
    },
    {
      delayBefore: 500,
      step: { step: 2, total: 9, agent: 'DecomposeAgent', icon: '🌳', status: 'active',
        message: 'Decomposing goal into prerequisite skill tree...' },
    },
    {
      delayBefore: 1200,
      step: { step: 2, total: 9, agent: 'DecomposeAgent', icon: '🌳', status: 'complete',
        message: `Skill tree built: ${script.skills.length} core skills identified`,
        data: { skills: script.skills.slice(0, 5).map(s => ({ name: s.name, days: s.days })), domain: script.domain },
      },
    },
    {
      delayBefore: 500,
      step: { step: 3, total: 9, agent: 'DiagnosticAgent', icon: '📋', status: 'complete',
        message: `Generated ${script.diagnosticCount} diagnostic questions for proficiency assessment`,
        data: { questionCount: script.diagnosticCount, source: 'llm', types: ['mcq', 'scenario', 'conceptual'] },
      },
    },
    {
      delayBefore: 400,
      step: { step: 4, total: 9, agent: 'ScoringAgent', icon: '📊', status: 'active',
        message: 'Running diagnostic simulation — scoring baseline proficiency...' },
    },
    {
      delayBefore: 900,
      step: { step: 4, total: 9, agent: 'ScoringAgent', icon: '📊', status: 'complete',
        message: 'Skill gaps identified — personalized scoring complete',
        data: { scores: script.scores },
      },
    },
    {
      delayBefore: 500,
      step: { step: 5, total: 9, agent: 'CurriculumAgent', icon: '📅', status: 'complete',
        message: `Learning plan generated: ${script.sessions} personalized sessions`,
        data: {
          totalDays: script.sessions,
          firstWeek: [
            { day: 1, skill: script.skills[0]?.name, type: 'learn' },
            { day: 2, skill: script.skills[0]?.name, type: 'practice' },
            { day: 3, skill: script.skills[1]?.name, type: 'learn' },
          ],
        },
      },
    },
    {
      delayBefore: 400,
      step: { step: 6, total: 9, agent: 'EvaluatorAgent', icon: '✅', status: 'active',
        message: 'Reviewing diagnostic outputs and quality signals...' },
    },
    {
      delayBefore: 700,
      step: { step: 6, total: 9, agent: 'EvaluatorAgent', icon: '✅', status: 'complete',
        message: 'Evaluation complete — diagnostic quality and gap strength reviewed',
        data: {
          averageScore: Math.round(script.scores.reduce((s, r) => s + r.score, 0) / script.scores.length),
          topSkills: script.scores.sort((a, b) => b.score - a.score).slice(0, 2).map(r => r.skill),
        },
      },
    },
    {
      delayBefore: 400,
      step: { step: 7, total: 9, agent: 'AdaptorAgent', icon: '⚡', status: 'active',
        message: 'Adjusting the plan for weak skills and review sessions...' },
    },
    {
      delayBefore: 700,
      step: { step: 7, total: 9, agent: 'AdaptorAgent', icon: '⚡', status: 'complete',
        message: 'Adaptive plan refinements applied based on performance gaps',
        data: { reviewSessions: script.reviewSessions, adjustedSessions: script.sessions },
      },
    },
    {
      delayBefore: 400,
      step: { step: 8, total: 9, agent: 'MarketAgent', icon: '📈', status: 'active',
        message: 'Analyzing job market intelligence for your goal...' },
    },
    {
      delayBefore: 1000,
      step: { step: 8, total: 9, agent: 'MarketAgent', icon: '📈', status: 'complete',
        message: `Market intelligence complete — ${script.market.openJobs.toLocaleString()} open positions, demand score ${script.market.demandScore}/100`,
        data: {
          demandScore: script.market.demandScore,
          openJobs: script.market.openJobs,
          avgSalary: `$${(script.market.avgSalary / 1000).toFixed(0)}k`,
          topSkills: script.market.topSkills,
        },
      },
    },
    {
      delayBefore: 400,
      step: { step: 9, total: 9, agent: 'SimulationAgent', icon: '🔮', status: 'active',
        message: 'Running 6-month career trajectory simulation...' },
    },
    {
      delayBefore: 900,
      step: { step: 9, total: 9, agent: 'SimulationAgent', icon: '🔮', status: 'complete',
        message: `Trajectory simulated — projected readiness ${script.trajectory[1]?.readiness}% at 3 months`,
        data: {
          trajectory: script.trajectory.map(t => ({ month: t.month, readinessForHiring: t.readiness })),
          projectedSalary: script.projectedSalary,
        },
      },
    },
  ];
}

export default function DemoMode() {
  const navigate = useNavigate();
  const [selectedGoal, setSelectedGoal] = useState('fullstack');
  const [running, setRunning] = useState(false);
  const [steps, setSteps] = useState([]);
  const [agentStatus, setAgentStatus] = useState({});
  const [complete, setComplete] = useState(null);
  const bottomRef = useRef(null);
  const timersRef = useRef([]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [steps]);

  // Cleanup timers on unmount
  useEffect(() => () => timersRef.current.forEach(clearTimeout), []);

  const runDemo = () => {
    if (running) return;

    // Clear previous timers
    timersRef.current.forEach(clearTimeout);
    timersRef.current = [];

    setRunning(true);
    setSteps([]);
    setAgentStatus({});
    setComplete(null);

    const script = DEMO_SCRIPTS[selectedGoal];
    const events = buildScript(selectedGoal, script);

    // Seed with start message
    setSteps([{
      type: 'system', icon: '🚀', agent: 'Orchestrator',
      message: 'SkillForge Autonomous Agent System activating...',
      status: 'complete', step: 0, total: 9,
    }]);

    let elapsed = 300;

    events.forEach((event, idx) => {
      elapsed += event.delayBefore;

      const t = setTimeout(() => {
        const s = event.step;

        setSteps(prev => {
          const existing = prev.findIndex(p => p.agent === s.agent && p.status === 'active');
          if (existing !== -1) {
            const updated = [...prev];
            updated[existing] = s;
            return updated;
          }
          return [...prev, s];
        });

        setAgentStatus(prev => ({ ...prev, [s.agent]: s.status }));

        // After the last event, fire complete
        if (idx === events.length - 1) {
          const completionTimer = setTimeout(() => {
            setComplete({
              summary: {
                domain: script.domain,
                skills: script.skills.length,
                sessions: script.sessions,
                marketDemand: script.market.demandScore,
                projectedSalary: script.projectedSalary,
                opportunityCount: script.market.openJobs,
              },
              message: '✅ Autonomous analysis complete — 9 agents orchestrated successfully',
            });
            setRunning(false);
          }, 600);
          timersRef.current.push(completionTimer);
        }
      }, elapsed);

      timersRef.current.push(t);
    });
  };

  return (
    <div className="min-h-screen bg-[#0F172A] text-white">
      <div className="max-w-4xl mx-auto px-6 py-10">

        {/* Header */}
        <div className="mb-8 text-center">
          <button onClick={() => navigate('/')} className="text-slate-500 hover:text-white text-sm mb-6 flex items-center gap-1 mx-auto w-fit">
            ← Back to Home
          </button>
          <div className="inline-flex items-center gap-2 px-4 py-1.5 bg-emerald-500/10 border border-emerald-500/30 rounded-full text-emerald-400 text-sm font-medium mb-4">
            <span className="w-2 h-2 bg-emerald-400 rounded-full animate-pulse" />
            LIVE AUTONOMOUS AGENT ORCHESTRATION
          </div>
          <h1 className="text-4xl font-bold bg-gradient-to-r from-white to-slate-300 bg-clip-text text-transparent mb-2">
            Run Live Career Analysis
          </h1>
          <p className="text-slate-400 max-w-xl mx-auto">
            Watch 9 specialized AI agents activate, collaborate, debate, and autonomously build a complete
            personalized career mastery plan — in real time.
          </p>
        </div>

        {/* Goal Selection */}
        {!running && !complete && (
          <div className="mb-8">
            <div className="text-slate-400 text-sm font-medium mb-3 text-center">Select a demo career goal:</div>
            <div className="grid gap-3">
              {DEMO_GOALS.map(({ key, label, desc }) => (
                <button key={key} onClick={() => setSelectedGoal(key)}
                  className={`flex items-center gap-4 p-4 rounded-xl border text-left transition-all ${selectedGoal === key
                    ? 'border-indigo-500 bg-indigo-500/10 shadow-lg shadow-indigo-500/10'
                    : 'border-slate-700 hover:border-slate-600 bg-slate-800/30 hover:bg-slate-800/50'}`}>
                  <div className="text-2xl">{label.split(' ')[0]}</div>
                  <div>
                    <div className={`font-semibold ${selectedGoal === key ? 'text-indigo-300' : 'text-white'}`}>
                      {label.slice(2)}
                    </div>
                    <div className="text-slate-500 text-sm">{desc}</div>
                  </div>
                  {selectedGoal === key && <div className="ml-auto text-indigo-400">✓</div>}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Run Button */}
        {!running && !complete && (
          <div className="text-center mb-8">
            <button onClick={runDemo}
              className="px-10 py-4 bg-gradient-to-r from-indigo-600 to-violet-600 hover:from-indigo-500 hover:to-violet-500 rounded-2xl font-bold text-lg transition-all transform hover:scale-105 shadow-xl shadow-indigo-500/30">
              🚀 Run Live Autonomous Career Analysis
            </button>
            <div className="text-slate-500 text-xs mt-2">
              9 agents · Real orchestration · Full pipeline · ~20 seconds
            </div>
          </div>
        )}

        {/* Agent Status Bar */}
        {(running || complete || steps.length > 0) && (
          <div className="mb-6">
            <div className="text-slate-400 text-xs font-semibold uppercase mb-3">Agent Pipeline Status</div>
            <div className="flex flex-wrap gap-2">
              {Object.keys(AGENT_COLORS).map(name => (
                <AgentPill key={name} name={name} status={agentStatus[name] || 'waiting'} />
              ))}
            </div>
          </div>
        )}

        {/* Live Step Feed */}
        {steps.length > 0 && (
          <div className="bg-slate-900/60 border border-slate-700 rounded-2xl p-6 mb-6">
            <div className="flex items-center gap-2 mb-4">
              <div className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
              <span className="text-slate-300 text-sm font-semibold">Agent Execution Log</span>
              {running && <span className="ml-auto text-amber-400 text-xs animate-pulse">● LIVE</span>}
            </div>
            <div className="space-y-1">
              {steps.map((step, i) => (
                <StepCard key={i} step={step} isLatest={i === steps.length - 1} />
              ))}
              {running && (
                <div className="flex items-center gap-2 pl-12 text-slate-500 text-sm animate-pulse">
                  <span>⟳</span> Agents processing...
                </div>
              )}
            </div>
            <div ref={bottomRef} />
          </div>
        )}

        {/* Completion Summary */}
        {complete && (
          <div className="bg-gradient-to-br from-emerald-900/30 to-indigo-900/20 border border-emerald-500/30 rounded-2xl p-8 text-center">
            <div className="text-5xl mb-4">✅</div>
            <h2 className="text-2xl font-bold text-white mb-2">{complete.message}</h2>
            <div className="text-slate-400 mb-6">
              Goal: <span className="text-white font-medium">{complete.summary?.domain}</span>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-4 mb-8">
              {[
                { label: 'Skills Mapped', value: complete.summary?.skills, icon: '🌳' },
                { label: 'Learning Sessions', value: complete.summary?.sessions, icon: '📅' },
                { label: 'Market Demand', value: `${complete.summary?.marketDemand}/100`, icon: '📈' },
                { label: 'Open Jobs', value: complete.summary?.opportunityCount?.toLocaleString(), icon: '💼' },
                { label: 'Projected Salary', value: `$${((complete.summary?.projectedSalary || 0) / 1000).toFixed(0)}k`, icon: '💰' },
                { label: 'Agents Used', value: '9', icon: '🤖' },
              ].map(({ label, value, icon }) => (
                <div key={label} className="bg-slate-800/40 rounded-xl p-3">
                  <div className="text-2xl mb-1">{icon}</div>
                  <div className="text-white font-bold">{value}</div>
                  <div className="text-slate-500 text-xs">{label}</div>
                </div>
              ))}
            </div>
            <div className="flex gap-3 justify-center flex-wrap">
              <button onClick={() => navigate('/auth/register')}
                className="px-6 py-3 bg-indigo-600 hover:bg-indigo-500 rounded-xl font-semibold transition-all">
                🚀 Get Started Free
              </button>
              <button onClick={() => navigate('/auth/login')}
                className="px-6 py-3 bg-violet-600 hover:bg-violet-500 rounded-xl font-semibold transition-all">
                🔑 Sign In
              </button>
              <button onClick={() => { setComplete(null); setSteps([]); setAgentStatus({}); }}
                className="px-6 py-3 border border-slate-600 hover:border-slate-500 rounded-xl text-slate-300 font-semibold transition-all">
                ↻ Run Again
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
