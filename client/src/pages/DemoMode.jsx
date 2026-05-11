/**
 * DemoMode.jsx — Live Autonomous Career Analysis for Judges
 * Streams 7 agents activating in real-time via SSE
 * Shows orchestration, reasoning, decisions, and output generation
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
  MarketAgent:     '#06B6D4',
  SimulationAgent: '#F97316',
};

function AgentPill({ name, status }) {
  const color = AGENT_COLORS[name] || '#6B7280';
  const isActive = status === 'active';
  const isDone = status === 'complete';
  return (
    <div className={`flex items-center gap-2 px-3 py-1.5 rounded-full border text-xs font-medium transition-all duration-500
      ${isActive ? 'scale-105 shadow-lg' : ''}`}
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
      <div className={`pb-5 flex-1 ${isLatest ? '' : ''}`}>
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
          <div className="mt-2 bg-slate-900/60 rounded-lg p-3 font-mono text-xs text-slate-400">
            {JSON.stringify(step.data, null, 2)}
          </div>
        )}
      </div>
    </div>
  );
}

export default function DemoMode() {
  const navigate = useNavigate();
  const [selectedGoal, setSelectedGoal] = useState('fullstack');
  const [running, setRunning] = useState(false);
  const [steps, setSteps] = useState([]);
  const [agentStatus, setAgentStatus] = useState({});
  const [complete, setComplete] = useState(null);
  const [error, setError] = useState('');
  const bottomRef = useRef(null);
  const esRef = useRef(null);

  // Auto-scroll
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [steps]);

  // Cleanup SSE on unmount
  useEffect(() => () => esRef.current?.close(), []);

  const runDemo = () => {
    if (running) return;
    setRunning(true);
    setSteps([]);
    setAgentStatus({});
    setComplete(null);
    setError('');

    const es = new EventSource(`/api/demo/run?goal=${selectedGoal}`);
    esRef.current = es;

    es.addEventListener('start', (e) => {
      const d = JSON.parse(e.data);
      setSteps(prev => [...prev, { type: 'system', icon: '🚀', agent: 'Orchestrator', message: d.message, status: 'complete', step: 0, total: 7 }]);
    });

    es.addEventListener('agent', (e) => {
      const d = JSON.parse(e.data);
      setSteps(prev => {
        // Update existing step if same agent
        const idx = prev.findIndex(s => s.agent === d.agent && s.status === 'active');
        if (idx !== -1) {
          const updated = [...prev];
          updated[idx] = { ...d };
          return updated;
        }
        return [...prev, d];
      });
      setAgentStatus(prev => ({ ...prev, [d.agent]: d.status }));
    });

    es.addEventListener('complete', (e) => {
      const d = JSON.parse(e.data);
      setComplete(d);
      setRunning(false);
      es.close();

      // Save userId for navigation
      if (d.userId) {
        localStorage.setItem('skillforge:userId', d.userId);
      }
    });

    es.addEventListener('error', (e) => {
      try {
        const d = JSON.parse(e.data);
        setError(d.message);
      } catch {
        setError('Demo stream error');
      }
      setRunning(false);
      es.close();
    });

    es.onerror = () => {
      if (running) {
        setError('Connection to demo server lost');
        setRunning(false);
        es.close();
      }
    };
  };

  const selectedGoalInfo = DEMO_GOALS.find(g => g.key === selectedGoal);

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
            Watch 7 specialized AI agents activate, collaborate, debate, and autonomously build a complete
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
              7 agents · Real API calls · Full orchestration · ~15 seconds
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

        {error && (
          <div className="bg-red-900/30 border border-red-500/30 rounded-xl p-4 text-red-300 mb-6">{error}</div>
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
                { label: 'Open Jobs', value: complete.summary?.opportunityCount, icon: '💼' },
                { label: 'Projected Salary', value: complete.summary?.projectedSalary ? `$${(complete.summary.projectedSalary / 1000).toFixed(0)}k` : 'N/A', icon: '💰' },
                { label: 'Agents Used', value: '7', icon: '🤖' },
              ].map(({ label, value, icon }) => (
                <div key={label} className="bg-slate-800/40 rounded-xl p-3">
                  <div className="text-2xl mb-1">{icon}</div>
                  <div className="text-white font-bold">{value}</div>
                  <div className="text-slate-500 text-xs">{label}</div>
                </div>
              ))}
            </div>
            <div className="flex gap-3 justify-center flex-wrap">
              <button onClick={() => navigate('/dashboard')}
                className="px-6 py-3 bg-indigo-600 hover:bg-indigo-500 rounded-xl font-semibold transition-all">
                📊 View Full Dashboard
              </button>
              <button onClick={() => navigate('/career-twin')}
                className="px-6 py-3 bg-violet-600 hover:bg-violet-500 rounded-xl font-semibold transition-all">
                🧬 Career Digital Twin
              </button>
              <button onClick={() => navigate('/explain')}
                className="px-6 py-3 bg-amber-600 hover:bg-amber-500 rounded-xl font-semibold transition-all">
                🧠 Explainability Console
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
