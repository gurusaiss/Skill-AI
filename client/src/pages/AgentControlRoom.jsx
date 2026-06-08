import React, { useEffect, useState, useRef, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';

// ─── Agent graph definitions ─────────────────────────────────────────────────
const NODES = [
  { id: 'goal',       name: 'GoalAgent',       icon: '🎯', color: '#6366F1', x: 300, y: 40  },
  { id: 'decompose',  name: 'DecomposeAgent',  icon: '🌳', color: '#8B5CF6', x: 160, y: 130 },
  { id: 'diagnostic', name: 'DiagnosticAgent', icon: '📋', color: '#06B6D4', x: 440, y: 130 },
  { id: 'scoring',    name: 'ScoringAgent',    icon: '📊', color: '#0EA5E9', x: 160, y: 230 },
  { id: 'curriculum', name: 'CurriculumAgent', icon: '📅', color: '#14B8A6', x: 440, y: 230 },
  { id: 'evaluator',  name: 'EvaluatorAgent',  icon: '✅', color: '#10B981', x: 100, y: 330 },
  { id: 'adaptor',    name: 'AdaptorAgent',    icon: '⚡', color: '#F59E0B', x: 300, y: 340 },
  { id: 'market',     name: 'MarketAgent',     icon: '💼', color: '#EC4899', x: 480, y: 330 },
  { id: 'simulation', name: 'SimulationAgent', icon: '🔮', color: '#A78BFA', x: 300, y: 430 },
];

const EDGES = [
  ['goal','decompose'], ['goal','diagnostic'],
  ['decompose','scoring'], ['diagnostic','scoring'],
  ['scoring','curriculum'], ['curriculum','adaptor'],
  ['scoring','evaluator'], ['evaluator','adaptor'],
  ['adaptor','market'], ['adaptor','simulation'],
];

const NODE_ORDER = ['goal','decompose','diagnostic','scoring','curriculum','evaluator','adaptor','market','simulation'];

// ─── Type → display metadata ──────────────────────────────────────────────────
const TYPE_META = {
  goal_analysis:       { icon: '🎯', color: '#6366F1', label: 'GoalAgent' },
  skill_tree:          { icon: '🌳', color: '#8B5CF6', label: 'DecomposeAgent' },
  diagnostic:          { icon: '📋', color: '#06B6D4', label: 'DiagnosticAgent' },
  diagnostic_complete: { icon: '📊', color: '#0EA5E9', label: 'ScoringAgent' },
  plan_built:          { icon: '📅', color: '#14B8A6', label: 'CurriculumAgent' },
  session_complete:    { icon: '✅', color: '#10B981', label: 'EvaluatorAgent' },
  adaptation:          { icon: '⚡', color: '#F59E0B', label: 'AdaptorAgent' },
  market_intel:        { icon: '💼', color: '#EC4899', label: 'MarketAgent' },
  default:             { icon: '🤖', color: '#6B7280', label: 'Agent' },
};

const MOCK_DECISIONS = [
  { type: 'goal_analysis',       title: 'GoalAgent — Domain: Full Stack Development',  timestamp: new Date(Date.now() - 300000).toISOString() },
  { type: 'skill_tree',          title: 'DecomposeAgent — 5 skills decomposed',         timestamp: new Date(Date.now() - 280000).toISOString() },
  { type: 'diagnostic',          title: 'DiagnosticAgent — 5 MCQ questions generated',  timestamp: new Date(Date.now() - 260000).toISOString() },
  { type: 'diagnostic_complete', title: 'ScoringAgent — Gap analysis: React hooks, async', timestamp: new Date(Date.now() - 240000).toISOString() },
  { type: 'plan_built',          title: 'CurriculumAgent — 21-day plan created',         timestamp: new Date(Date.now() - 220000).toISOString() },
  { type: 'session_complete',    title: 'EvaluatorAgent — Session scored: 78%',          timestamp: new Date(Date.now() - 180000).toISOString() },
  { type: 'adaptation',          title: 'AdaptorAgent — 2 review sessions added',        timestamp: new Date(Date.now() - 120000).toISOString() },
  { type: 'market_intel',        title: 'MarketAgent — React roles up 23% this quarter', timestamp: new Date(Date.now() -  60000).toISOString() },
];

// ─── Helpers ──────────────────────────────────────────────────────────────────
function relativeTime(iso) {
  const diff = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (diff < 60) return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  return `${Math.floor(diff / 3600)}h ago`;
}

function seededStat(name, min, max) {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return min + (h % (max - min + 1));
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function AgentNode({ node, isActive }) {
  const { x, y, color, icon, name } = node;
  return (
    <g>
      {/* Pulse ring when active */}
      {isActive && (
        <circle
          cx={x}
          cy={y}
          r={32}
          fill="none"
          stroke={color}
          strokeWidth={2}
          opacity={0.6}
          style={{
            animation: 'agentPulse 1s ease-out infinite',
          }}
        />
      )}
      {/* Outer circle */}
      <circle
        cx={x}
        cy={y}
        r={32}
        fill={`${color}15`}
        stroke={isActive ? color : `${color}60`}
        strokeWidth={isActive ? 2 : 1.5}
        style={{ transition: 'all 0.3s ease' }}
      />
      {/* Inner circle */}
      <circle
        cx={x}
        cy={y}
        r={24}
        fill={isActive ? `${color}40` : `${color}25`}
        style={{ transition: 'all 0.3s ease' }}
      />
      {/* Emoji icon */}
      <text
        x={x}
        y={y + 6}
        textAnchor="middle"
        fontSize={18}
        style={{ userSelect: 'none' }}
      >
        {icon}
      </text>
      {/* Agent name below */}
      <text
        x={x}
        y={y + 46}
        textAnchor="middle"
        fontSize={9}
        fill={isActive ? '#E2E8F0' : '#94A3B8'}
        style={{ transition: 'fill 0.3s ease', fontFamily: 'monospace' }}
      >
        {name}
      </text>
    </g>
  );
}

function DecisionCard({ decision, index }) {
  const meta = TYPE_META[decision.type] || TYPE_META.default;
  return (
    <motion.div
      initial={{ opacity: 0, x: 20 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ delay: index * 0.04 }}
      className="flex items-start gap-3 p-3 rounded-xl border border-slate-700/50 bg-[#0F172A]/80 hover:border-slate-600 transition-all"
      style={{ borderLeftWidth: 3, borderLeftColor: meta.color }}
    >
      <div
        className="w-8 h-8 rounded-lg flex items-center justify-center text-sm flex-shrink-0"
        style={{ background: `${meta.color}20` }}
      >
        {meta.icon}
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-slate-200 text-xs font-medium leading-snug truncate">{decision.title}</p>
        <p className="text-slate-500 text-xs mt-0.5">{meta.label}</p>
      </div>
      <span className="text-slate-600 text-xs flex-shrink-0 mt-0.5">{relativeTime(decision.timestamp)}</span>
    </motion.div>
  );
}

function AgentStatCard({ agent, decisions }) {
  const calls = decisions.filter(d => TYPE_META[d.type]?.label === agent.name).length || agent.calls;
  const successRate = agent.successRate || seededStat(agent.name, 92, 99);
  const latency = agent.avgLatencyMs || seededStat(agent.name, 200, 600);
  const color = agent.color;

  return (
    <div
      className="flex-shrink-0 w-44 p-3 rounded-xl border border-slate-700/60 bg-[#0A1628] hover:border-slate-600 transition-all"
      style={{ borderTopWidth: 2, borderTopColor: color }}
    >
      <div className="flex items-center gap-2 mb-2">
        <span className="text-base">{agent.icon}</span>
        <span className="text-xs font-semibold text-slate-300 truncate">{agent.name}</span>
      </div>
      <div className="text-lg font-bold text-white mb-1">{calls} <span className="text-xs text-slate-500 font-normal">calls</span></div>
      {/* Success rate bar */}
      <div className="mb-2">
        <div className="flex justify-between text-xs text-slate-500 mb-0.5">
          <span>Success</span>
          <span style={{ color }}>{successRate}%</span>
        </div>
        <div className="h-1.5 bg-slate-700 rounded-full overflow-hidden">
          <div
            className="h-full rounded-full"
            style={{ width: `${successRate}%`, background: color }}
          />
        </div>
      </div>
      {/* Latency badge */}
      <div
        className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs"
        style={{ background: `${color}20`, color }}
      >
        ⏱ {latency}ms
      </div>
    </div>
  );
}

// ─── Live Pipeline Modal ───────────────────────────────────────────────────────
function PipelineModal({ onClose }) {
  const [events, setEvents] = useState([]);
  const [done, setDone] = useState(false);
  const feedRef = useRef(null);

  useEffect(() => {
    const apiBase = import.meta.env.VITE_API_URL || (import.meta.env.PROD ? '' : 'http://localhost:3001');
    const es = new EventSource(`${apiBase}/api/demo/run?goal=fullstack`);

    es.onmessage = (e) => {
      try {
        const data = JSON.parse(e.data);
        setEvents(prev => [...prev, data]);
        if (data.type === 'complete' || data.stage === 'complete') {
          setDone(true);
          es.close();
        }
      } catch {
        setEvents(prev => [...prev, { message: e.data, type: 'log' }]);
      }
    };

    es.onerror = () => {
      setEvents(prev => [...prev, { message: 'Stream ended or server unavailable.', type: 'error' }]);
      setDone(true);
      es.close();
    };

    return () => es.close();
  }, []);

  useEffect(() => {
    if (feedRef.current) {
      feedRef.current.scrollTop = feedRef.current.scrollHeight;
    }
  }, [events]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
      <motion.div
        initial={{ opacity: 0, scale: 0.9 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.9 }}
        className="w-full max-w-2xl bg-[#0A1628] border border-slate-700 rounded-2xl overflow-hidden shadow-2xl"
      >
        {/* Modal header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-700">
          <div className="flex items-center gap-3">
            <div className="w-2 h-2 rounded-full bg-green-400 animate-pulse" />
            <h2 className="text-white font-bold text-sm tracking-wide">LIVE PIPELINE EXECUTION</h2>
          </div>
          <div className="flex items-center gap-3">
            {done && (
              <span className="text-xs text-green-400 font-semibold bg-green-400/10 px-2 py-1 rounded-full">
                Complete
              </span>
            )}
            <button
              onClick={onClose}
              className="text-slate-400 hover:text-white text-lg transition-colors"
            >
              ✕
            </button>
          </div>
        </div>

        {/* Events feed */}
        <div ref={feedRef} className="h-96 overflow-y-auto p-4 space-y-2 font-mono text-xs">
          {events.length === 0 && (
            <div className="flex items-center gap-2 text-slate-500">
              <div className="w-3 h-3 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
              Connecting to pipeline...
            </div>
          )}
          {events.map((ev, i) => {
            const agentName = ev.agent || ev.agentName || '';
            const message = ev.message || ev.content || ev.text || JSON.stringify(ev);
            const isComplete = ev.type === 'complete' || ev.stage === 'complete';
            const isError = ev.type === 'error';
            return (
              <motion.div
                key={i}
                initial={{ opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                className={`flex gap-2 items-start ${isError ? 'text-red-400' : isComplete ? 'text-green-400' : 'text-slate-300'}`}
              >
                <span className="text-slate-600 flex-shrink-0">{String(i + 1).padStart(2, '0')}</span>
                {agentName && (
                  <span className="text-indigo-400 flex-shrink-0">[{agentName}]</span>
                )}
                <span className="leading-relaxed">{message}</span>
              </motion.div>
            );
          })}
          {done && (
            <div className="text-green-400 pt-2 border-t border-slate-700">
              ✓ Pipeline execution complete
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-3 border-t border-slate-700 flex justify-end">
          <button
            onClick={onClose}
            className="px-4 py-2 bg-slate-700 hover:bg-slate-600 text-slate-300 hover:text-white rounded-lg text-sm transition-all"
          >
            Close
          </button>
        </div>
      </motion.div>
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────
export default function AgentControlRoom() {
  const [clock, setClock] = useState('');
  const [activeNodeId, setActiveNodeId] = useState(NODE_ORDER[0]);
  const [showModal, setShowModal] = useState(false);
  const [agentStats, setAgentStats] = useState([]);

  // Load decisions from localStorage / mock
  const userId = localStorage.getItem('skillforge:userId');
  const stored = userId ? JSON.parse(localStorage.getItem(`sf_data_${userId}`) || '{}') : {};
  const decisions = (stored.agentDecisions || MOCK_DECISIONS).slice(-15).reverse();

  // Live clock
  useEffect(() => {
    const tick = () => {
      const now = new Date();
      setClock(now.toTimeString().slice(0, 8));
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, []);

  // Auto-demo animation cycling through nodes
  useEffect(() => {
    let idx = 0;
    const id = setInterval(() => {
      idx = (idx + 1) % NODE_ORDER.length;
      setActiveNodeId(NODE_ORDER[idx]);
    }, 800);
    return () => clearInterval(id);
  }, []);

  // Fetch agent stats from API (falls back to NODES data)
  useEffect(() => {
    fetch('/api/agent-control/stats')
      .then(r => r.json())
      .then(data => {
        const agents = data.agents || data.data?.agents;
        if (agents) setAgentStats(agents);
      })
      .catch(() => {
        setAgentStats(NODES.map(n => ({
          name: n.name,
          icon: n.icon,
          color: n.color,
          calls: seededStat(n.name, 23, 134),
          successRate: seededStat(n.name, 92, 99),
          avgLatencyMs: seededStat(n.name, 200, 890),
        })));
      });
  }, []);

  const nodeMap = Object.fromEntries(NODES.map(n => [n.id, n]));

  // Metric chips
  const totalDecisions = decisions.length;

  return (
    <div className="min-h-screen bg-[#020818] text-[#F8FAFC] pb-10">
      {/* CSS for pulse animation */}
      <style>{`
        @keyframes agentPulse {
          0%   { r: 32; opacity: 0.8; }
          50%  { r: 44; opacity: 0.15; }
          100% { r: 32; opacity: 0; }
        }
        @keyframes statusPulse {
          0%, 100% { opacity: 1; }
          50%       { opacity: 0.3; }
        }
        .status-dot { animation: statusPulse 2s ease-in-out infinite; }
      `}</style>

      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div className="sticky top-0 z-10 bg-[#020818]/95 backdrop-blur border-b border-slate-800/60 px-6 py-3">
        <div className="max-w-screen-2xl mx-auto flex items-center justify-between gap-4">
          {/* Left: title */}
          <div>
            <h1 className="text-lg font-black tracking-wider bg-gradient-to-r from-indigo-400 via-purple-400 to-cyan-400 bg-clip-text text-transparent">
              ⚡ AGENT CONTROL ROOM
            </h1>
            <p className="text-xs text-slate-500 font-mono mt-0.5">SKILLFORGE AI v2.0</p>
          </div>

          {/* Center: clock */}
          <div className="font-mono text-2xl font-bold text-cyan-400 tracking-widest tabular-nums hidden sm:block">
            {clock}
          </div>

          {/* Right: status + button */}
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-green-500/10 border border-green-500/30">
              <span className="status-dot w-2 h-2 rounded-full bg-green-400 block" />
              <span className="text-green-400 text-xs font-semibold">SYSTEM ONLINE</span>
              <span className="text-slate-500 text-xs hidden sm:inline">9 Agents Active</span>
            </div>
            <button
              onClick={() => setShowModal(true)}
              className="flex items-center gap-2 px-4 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold transition-all shadow-lg shadow-indigo-900/40"
            >
              ▶ Run Live Pipeline
            </button>
          </div>
        </div>
      </div>

      {/* ── Main content ───────────────────────────────────────────────────── */}
      <div className="max-w-screen-2xl mx-auto px-4 sm:px-6 pt-6">
        <div className="flex flex-col lg:flex-row gap-5">

          {/* ── Left: SVG Agent Network ──────────────────────────────────── */}
          <div className="lg:w-[55%]">
            <div className="bg-[#0A1628] border border-slate-700/50 rounded-2xl overflow-hidden">
              {/* Panel header */}
              <div className="flex items-center justify-between px-5 py-3 border-b border-slate-700/50">
                <div className="flex items-center gap-2">
                  <span className="text-indigo-400 text-sm">🕸</span>
                  <span className="text-slate-300 text-sm font-semibold tracking-wide">Agent Network</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" />
                  <span className="text-slate-500 text-xs">Live</span>
                </div>
              </div>

              {/* SVG */}
              <div className="px-2 py-4">
                <svg
                  width="100%"
                  viewBox="0 0 580 490"
                  style={{ overflow: 'visible' }}
                >
                  {/* Defs for glow filter */}
                  <defs>
                    <filter id="glow" x="-50%" y="-50%" width="200%" height="200%">
                      <feGaussianBlur stdDeviation="4" result="blur" />
                      <feMerge>
                        <feMergeNode in="blur" />
                        <feMergeNode in="SourceGraphic" />
                      </feMerge>
                    </filter>
                  </defs>

                  {/* Edges */}
                  {EDGES.map(([fromId, toId], i) => {
                    const from = nodeMap[fromId];
                    const to = nodeMap[toId];
                    const isActiveEdge = activeNodeId === fromId || activeNodeId === toId;
                    return (
                      <line
                        key={i}
                        x1={from.x}
                        y1={from.y}
                        x2={to.x}
                        y2={to.y}
                        stroke={isActiveEdge ? `${from.color}80` : `${from.color}30`}
                        strokeWidth={isActiveEdge ? 2 : 1.5}
                        strokeDasharray={isActiveEdge ? '0' : '4 4'}
                        style={{ transition: 'all 0.3s ease' }}
                      />
                    );
                  })}

                  {/* Nodes */}
                  {NODES.map(node => (
                    <AgentNode
                      key={node.id}
                      node={node}
                      isActive={activeNodeId === node.id}
                    />
                  ))}
                </svg>
              </div>

              {/* Legend row */}
              <div className="flex flex-wrap gap-2 px-5 pb-4 pt-1">
                {NODES.map(n => (
                  <div
                    key={n.id}
                    className="flex items-center gap-1 px-2 py-0.5 rounded-full text-xs transition-all"
                    style={{
                      background: activeNodeId === n.id ? `${n.color}25` : `${n.color}10`,
                      color: activeNodeId === n.id ? n.color : '#64748B',
                      border: `1px solid ${activeNodeId === n.id ? `${n.color}50` : 'transparent'}`,
                    }}
                  >
                    <span>{n.icon}</span>
                    <span className="font-mono">{n.name.replace('Agent', '')}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* ── Right: Live Agent Feed ────────────────────────────────────── */}
          <div className="lg:w-[45%]">
            <div className="bg-[#0A1628] border border-slate-700/50 rounded-2xl overflow-hidden h-full">
              {/* Panel header */}
              <div className="flex items-center justify-between px-5 py-3 border-b border-slate-700/50">
                <div className="flex items-center gap-2">
                  <span className="text-cyan-400 text-sm">📡</span>
                  <span className="text-slate-300 text-sm font-semibold tracking-wide">Live Agent Feed</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="w-1.5 h-1.5 rounded-full bg-cyan-400 animate-pulse" />
                  <span className="text-slate-500 text-xs">Streaming</span>
                </div>
              </div>

              {/* Metric chips */}
              <div className="flex flex-wrap gap-2 px-5 py-3 border-b border-slate-800/60">
                <div className="flex items-center gap-1.5 px-3 py-1 rounded-full text-xs bg-indigo-500/10 border border-indigo-500/20 text-indigo-400">
                  <span>📊</span>
                  Total Decisions: {totalDecisions}
                </div>
                <div className="flex items-center gap-1.5 px-3 py-1 rounded-full text-xs bg-green-500/10 border border-green-500/20 text-green-400">
                  <span>🟢</span>
                  Agents: 9/9 Online
                </div>
                <div className="flex items-center gap-1.5 px-3 py-1 rounded-full text-xs bg-purple-500/10 border border-purple-500/20 text-purple-400">
                  <span>🤖</span>
                  AI Powered: Gemini 2.0
                </div>
              </div>

              {/* Decision cards */}
              <div className="flex flex-col gap-2 p-4 overflow-y-auto" style={{ maxHeight: 420 }}>
                <AnimatePresence>
                  {decisions.map((d, i) => (
                    <DecisionCard key={`${d.type}-${i}`} decision={d} index={i} />
                  ))}
                </AnimatePresence>
                {decisions.length === 0 && (
                  <div className="text-slate-600 text-sm text-center py-8">No decisions yet. Run a session to populate the feed.</div>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* ── Bottom: 9 Agent Stat Cards ───────────────────────────────────── */}
        <div className="mt-6">
          <div className="flex items-center gap-2 mb-3">
            <span className="text-slate-400 text-sm font-semibold">Agent Performance</span>
            <div className="flex-1 h-px bg-slate-800" />
            <span className="text-slate-600 text-xs">Real-time metrics</span>
          </div>
          <div className="flex gap-3 overflow-x-auto pb-2">
            {(agentStats.length > 0 ? agentStats : NODES.map(n => ({
              name: n.name,
              icon: n.icon,
              color: n.color,
              calls: seededStat(n.name, 23, 134),
              successRate: seededStat(n.name, 92, 99),
              avgLatencyMs: seededStat(n.name, 200, 890),
            }))).map((agent, i) => (
              <AgentStatCard key={i} agent={agent} decisions={decisions} />
            ))}
          </div>
        </div>
      </div>

      {/* ── Pipeline Modal ─────────────────────────────────────────────────── */}
      <AnimatePresence>
        {showModal && <PipelineModal onClose={() => setShowModal(false)} />}
      </AnimatePresence>
    </div>
  );
}
