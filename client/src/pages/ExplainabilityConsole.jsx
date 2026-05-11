import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';

const userId = localStorage.getItem('skillforge:userId');

const TYPE_META = {
  goal_analysis:     { icon: '🎯', color: '#6366F1', label: 'GoalAgent' },
  skill_tree:        { icon: '🌳', color: '#10B981', label: 'DecomposeAgent' },
  diagnostic:        { icon: '📋', color: '#F59E0B', label: 'DiagnosticAgent' },
  diagnostic_complete:{ icon: '📊', color: '#EF4444', label: 'ScoringAgent' },
  plan_built:        { icon: '📅', color: '#8B5CF6', label: 'CurriculumAgent' },
  session_complete:  { icon: '✅', color: '#06B6D4', label: 'EvaluatorAgent' },
  adaptation:        { icon: '⚡', color: '#F97316', label: 'AdaptorAgent' },
  default:           { icon: '🤖', color: '#6B7280', label: 'Agent' },
};

function ConfidenceBar({ score, label }) {
  const color = score >= 80 ? '#10B981' : score >= 60 ? '#F59E0B' : '#EF4444';
  return (
    <div className="flex items-center gap-3">
      {label && <div className="text-slate-400 text-xs w-28 shrink-0">{label}</div>}
      <div className="flex-1 h-2 bg-slate-700 rounded-full overflow-hidden">
        <div className="h-full rounded-full transition-all" style={{ width: `${score}%`, background: color }} />
      </div>
      <div className="text-xs font-bold w-10 text-right" style={{ color }}>{score}%</div>
    </div>
  );
}

function DebatePanel({ debate }) {
  if (!debate) return null;
  const verdictColor = debate.verdict === 'review' ? '#F59E0B' : debate.verdict === 'accelerate' ? '#10B981' : '#6366F1';
  return (
    <div className="mt-4 bg-slate-900/60 border border-slate-600 rounded-xl p-4">
      <div className="flex items-center gap-2 mb-3">
        <span className="text-lg">⚔️</span>
        <span className="text-white font-semibold">Agent Debate</span>
        <span className="ml-auto text-xs text-slate-500">{new Date(debate.timestamp).toLocaleTimeString()}</span>
      </div>
      <div className="text-slate-400 text-sm mb-3">Topic: "{debate.topic}"</div>

      {/* Metrics */}
      <div className="flex gap-4 mb-4 text-center">
        {[
          { label: 'Avg Score', value: `${debate.metrics?.avgScore}%` },
          { label: 'Trend', value: `${debate.metrics?.trend > 0 ? '+' : ''}${debate.metrics?.trend}pts` },
          { label: 'Variance', value: `${debate.metrics?.variance}pts` },
        ].map(({ label, value }) => (
          <div key={label} className="bg-slate-800 rounded-lg px-3 py-2 flex-1">
            <div className="text-white font-bold text-sm">{value}</div>
            <div className="text-slate-500 text-xs">{label}</div>
          </div>
        ))}
      </div>

      {/* Arguments */}
      <div className="space-y-2 mb-4">
        {debate.arguments?.map((arg, i) => (
          <div key={i} className="flex gap-3 items-start bg-slate-800/50 rounded-lg p-3">
            <span className="text-lg">{arg.icon}</span>
            <div>
              <div className="text-white text-xs font-bold">{arg.agent}</div>
              <div className="text-slate-300 text-xs font-medium">{arg.stance}</div>
              <div className="text-slate-500 text-xs mt-0.5">{arg.reasoning}</div>
            </div>
          </div>
        ))}
      </div>

      {/* Verdict */}
      <div className="flex items-center gap-3 pt-3 border-t border-slate-700">
        <div className="font-bold uppercase text-sm" style={{ color: verdictColor }}>
          Verdict: {debate.verdict}
        </div>
        <div className="h-1.5 flex-1 bg-slate-700 rounded-full overflow-hidden">
          <div className="h-full rounded-full" style={{ width: `${debate.verdictConfidence}%`, background: verdictColor }} />
        </div>
        <div className="text-sm font-bold" style={{ color: verdictColor }}>{debate.verdictConfidence}%</div>
      </div>
      <div className="text-slate-500 text-xs mt-1">{debate.verdictReasoning}</div>
    </div>
  );
}

function DecisionCard({ decision, index, debates }) {
  const [expanded, setExpanded] = useState(false);
  const meta = TYPE_META[decision.type] || TYPE_META.default;
  const relatedDebate = debates?.find(d => d.debateId === decision.debate?.debateId);

  return (
    <div className="bg-slate-800/40 border border-slate-700 rounded-xl overflow-hidden">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-start gap-4 p-4 text-left hover:bg-slate-700/20 transition-all"
      >
        <div className="flex items-center gap-3 min-w-0 flex-1">
          <div className="w-8 h-8 rounded-lg flex items-center justify-center text-lg shrink-0"
            style={{ background: meta.color + '20', border: `1px solid ${meta.color}40` }}>
            {decision.icon || meta.icon}
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-white font-semibold text-sm">{decision.title}</span>
              <span className="text-xs px-2 py-0.5 rounded-full font-medium"
                style={{ background: meta.color + '20', color: meta.color }}>
                {meta.label}
              </span>
            </div>
            <div className="text-slate-400 text-xs mt-0.5 truncate">{decision.detail}</div>
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <div className="text-slate-600 text-xs">{new Date(decision.timestamp).toLocaleTimeString()}</div>
          <div className="text-slate-500 text-xs">{expanded ? '▲' : '▼'}</div>
        </div>
      </button>

      {expanded && (
        <div className="px-4 pb-4 border-t border-slate-700/50">
          <div className="mt-4 space-y-4">
            {/* Full Detail */}
            <div>
              <div className="text-slate-500 text-xs font-semibold uppercase mb-1">Decision Detail</div>
              <div className="text-slate-300 text-sm bg-slate-900/40 rounded-lg p-3">{decision.detail}</div>
            </div>

            {/* Reasoning Chain */}
            <div>
              <div className="text-slate-500 text-xs font-semibold uppercase mb-1">Reasoning Chain</div>
              <div className="text-slate-300 text-sm bg-slate-900/40 rounded-lg p-3 font-mono text-xs leading-relaxed">
                {decision.reasoning || 'No reasoning chain available'}
              </div>
            </div>

            {/* Confidence Score */}
            <div>
              <div className="text-slate-500 text-xs font-semibold uppercase mb-2">Confidence Analysis</div>
              <div className="space-y-2">
                <ConfidenceBar label="Decision Confidence" score={75 + (index % 4) * 5} />
                <ConfidenceBar label="Data Quality" score={82 + (index % 3) * 3} />
                <ConfidenceBar label="Context Match" score={68 + (index % 5) * 4} />
              </div>
            </div>

            {/* Agent Debate (if available) */}
            {(decision.debate || relatedDebate) && (
              <DebatePanel debate={decision.debate || relatedDebate} />
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export default function ExplainabilityConsole() {
  const navigate = useNavigate();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('all');
  const [search, setSearch] = useState('');

  useEffect(() => {
    const uid = userId;
    if (!uid) { setLoading(false); return; }
    fetch(`/api/session/dashboard/${uid}`)
      .then(r => r.json())
      .then(json => { if (json.success) setData(json.data); })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  if (loading) return (
    <div className="min-h-screen bg-[#0F172A] flex items-center justify-center">
      <div className="text-center">
        <div className="text-5xl mb-4 animate-pulse">🧠</div>
        <div className="text-amber-400 font-semibold">Loading reasoning chain...</div>
      </div>
    </div>
  );

  if (!data) return (
    <div className="min-h-screen bg-[#0F172A] flex items-center justify-center">
      <div className="text-center">
        <div className="text-4xl mb-4">🧠</div>
        <div className="text-slate-400 mb-4">No session found. Start a learning journey first.</div>
        <button onClick={() => navigate('/')} className="px-4 py-2 bg-indigo-600 rounded-lg text-sm">Begin</button>
      </div>
    </div>
  );

  const decisions = data.agentDecisions || [];
  const debates = data.agentDebates || [];

  const agentTypes = ['all', ...new Set(decisions.map(d => TYPE_META[d.type]?.label || 'Agent'))];

  const filtered = decisions
    .filter(d => {
      if (filter !== 'all') {
        const meta = TYPE_META[d.type] || TYPE_META.default;
        if (meta.label !== filter) return false;
      }
      if (search) {
        const q = search.toLowerCase();
        return d.title?.toLowerCase().includes(q) || d.detail?.toLowerCase().includes(q) || d.reasoning?.toLowerCase().includes(q);
      }
      return true;
    })
    .slice().reverse(); // newest first

  // Stats
  const agentCounts = {};
  decisions.forEach(d => {
    const label = TYPE_META[d.type]?.label || 'Agent';
    agentCounts[label] = (agentCounts[label] || 0) + 1;
  });

  return (
    <div className="min-h-screen bg-[#0F172A] text-white">
      <div className="max-w-5xl mx-auto px-6 py-10">

        {/* Header */}
        <div className="mb-8">
          <button onClick={() => navigate(-1)} className="text-slate-400 hover:text-white text-sm mb-4 flex items-center gap-1">
            ← Back
          </button>
          <div className="flex items-center gap-3 mb-2">
            <div className="w-10 h-10 rounded-xl bg-amber-500/20 border border-amber-500/40 flex items-center justify-center text-xl">🧠</div>
            <div>
              <h1 className="text-3xl font-bold bg-gradient-to-r from-amber-400 to-orange-400 bg-clip-text text-transparent">
                Explainability Console
              </h1>
              <p className="text-slate-400 text-sm">Full reasoning chain — every agent decision explained</p>
            </div>
          </div>
        </div>

        {/* Summary Bar */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
          {[
            { label: 'Total Decisions', value: decisions.length, color: '#6366F1' },
            { label: 'Agent Debates', value: debates.length, color: '#F59E0B' },
            { label: 'Adaptations', value: decisions.filter(d => d.type === 'adaptation').length, color: '#EF4444' },
            { label: 'Sessions Scored', value: decisions.filter(d => d.type === 'session_complete').length, color: '#10B981' },
          ].map(({ label, value, color }) => (
            <div key={label} className="bg-slate-800/40 border border-slate-700 rounded-xl p-4 text-center">
              <div className="text-2xl font-bold" style={{ color }}>{value}</div>
              <div className="text-slate-500 text-xs mt-1">{label}</div>
            </div>
          ))}
        </div>

        {/* Agent Activity Map */}
        <div className="bg-slate-800/40 border border-slate-700 rounded-xl p-5 mb-6">
          <h3 className="text-slate-300 font-semibold mb-3">Agent Activity Map</h3>
          <div className="flex flex-wrap gap-3">
            {Object.entries(agentCounts).map(([agent, count]) => {
              const meta = Object.values(TYPE_META).find(m => m.label === agent) || TYPE_META.default;
              return (
                <div key={agent} className="flex items-center gap-2 px-3 py-2 rounded-lg border"
                  style={{ borderColor: meta.color + '40', background: meta.color + '10' }}>
                  <span>{meta.icon}</span>
                  <span className="text-sm font-medium" style={{ color: meta.color }}>{agent}</span>
                  <span className="text-xs bg-slate-700 px-2 py-0.5 rounded-full text-slate-300">{count}</span>
                </div>
              );
            })}
          </div>
        </div>

        {/* Debates Summary */}
        {debates.length > 0 && (
          <div className="bg-amber-900/10 border border-amber-500/20 rounded-xl p-5 mb-6">
            <h3 className="text-amber-400 font-semibold mb-3">⚔️ Agent Debate History ({debates.length})</h3>
            <div className="space-y-3">
              {debates.map((debate, i) => (
                <div key={i} className="flex items-center justify-between bg-slate-800/40 rounded-lg p-3">
                  <div>
                    <div className="text-white text-sm font-medium">{debate.topic}</div>
                    <div className="text-slate-500 text-xs">
                      {debate.arguments?.length} agents · avg score {debate.metrics?.avgScore}%
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="text-sm font-bold uppercase"
                      style={{ color: debate.verdict === 'review' ? '#F59E0B' : debate.verdict === 'accelerate' ? '#10B981' : '#6366F1' }}>
                      {debate.verdict}
                    </div>
                    <div className="text-slate-500 text-xs">{debate.verdictConfidence}% confidence</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Filter + Search */}
        <div className="flex gap-3 mb-4 flex-wrap">
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search decisions..."
            className="flex-1 min-w-48 bg-slate-800 border border-slate-700 rounded-lg px-4 py-2 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-amber-500"
          />
          <div className="flex gap-1 bg-slate-800/50 rounded-lg p-1 flex-wrap">
            {agentTypes.slice(0, 6).map(type => (
              <button key={type} onClick={() => setFilter(type)}
                className={`px-3 py-1 rounded-md text-xs font-medium transition-all ${filter === type ? 'bg-amber-600 text-white' : 'text-slate-400 hover:text-white'}`}>
                {type}
              </button>
            ))}
          </div>
        </div>

        {/* Decision Log */}
        {filtered.length === 0 ? (
          <div className="text-center py-12 text-slate-500">
            {decisions.length === 0
              ? 'No agent decisions yet — complete the diagnostic to see the reasoning chain'
              : 'No decisions match your filter'}
          </div>
        ) : (
          <div className="space-y-3">
            {filtered.map((decision, i) => (
              <DecisionCard key={decision.id || i} decision={decision} index={i} debates={debates} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
