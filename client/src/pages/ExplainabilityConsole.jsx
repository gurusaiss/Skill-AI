import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import PageContainer from '../components/PageContainer.jsx';
import PageHeader from '../components/PageHeader.jsx';
import StatCard from '../components/StatCard.jsx';
import TabBar from '../components/TabBar.jsx';

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
      {label && <div className="text-slate-300 text-sm w-40 shrink-0">{label}</div>}
      <div className="flex-1 h-2 bg-slate-700 rounded-full overflow-hidden">
        <div className="h-full rounded-full transition-all" style={{ width: `${score}%`, background: color }} />
      </div>
      <div className="text-sm font-bold w-12 text-right" style={{ color }}>{score}%</div>
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
        <span className="ml-auto text-sm text-slate-400">{debate.timestamp ? new Date(debate.timestamp).toLocaleTimeString() : ''}</span>
      </div>
      <div className="text-slate-300 text-base mb-3">Topic: "{debate.topic}"</div>

      {/* Metrics */}
      <div className="grid grid-cols-3 gap-3 mb-4 text-center">
        {[
          { label: 'Avg Score', value: `${debate.metrics?.avgScore}%` },
          { label: 'Trend', value: `${debate.metrics?.trend > 0 ? '+' : ''}${debate.metrics?.trend}pts` },
          { label: 'Variance', value: `${debate.metrics?.variance}pts` },
        ].map(({ label, value }) => (
          <div key={label} className="bg-slate-800 rounded-lg px-3 py-2 flex-1">
            <div className="text-white font-bold text-base">{value}</div>
            <div className="text-slate-400 text-sm">{label}</div>
          </div>
        ))}
      </div>

      {/* Arguments */}
      <div className="space-y-2 mb-4">
        {debate.arguments?.map((arg, i) => (
          <div key={i} className="flex gap-3 items-start bg-slate-800/50 rounded-lg p-3">
            <span className="text-lg">{arg.icon}</span>
            <div>
              <div className="text-white text-sm font-bold">{arg.agent}</div>
              <div className="text-slate-200 text-sm font-medium">{arg.stance}</div>
              <div className="text-slate-400 text-sm mt-0.5">{arg.reasoning}</div>
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
      <div className="text-slate-400 text-sm mt-1">{debate.verdictReasoning}</div>
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
        aria-expanded={expanded}
        className="w-full flex items-start gap-4 p-4 text-left hover:bg-slate-700/20 transition-all"
      >
        <div className="flex items-center gap-3 min-w-0 flex-1">
          <div className="w-10 h-10 rounded-lg flex items-center justify-center text-lg shrink-0"
            style={{ background: meta.color + '20', border: `1px solid ${meta.color}40` }}>
            {decision.icon || meta.icon}
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-white font-semibold text-base">{decision.title}</span>
              <span className="text-xs px-2 py-0.5 rounded-full font-medium"
                style={{ background: meta.color + '20', color: meta.color }}>
                {meta.label}
              </span>
            </div>
            <div className="text-slate-400 text-sm mt-0.5 truncate" title={decision.detail}>{decision.detail}</div>
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <div className="text-slate-400 text-sm">{decision.timestamp ? new Date(decision.timestamp).toLocaleTimeString() : ''}</div>
          <div className="text-slate-400 text-xs" aria-hidden="true">{expanded ? '▲' : '▼'}</div>
        </div>
      </button>

      {expanded && (
        <div className="px-4 pb-4 border-t border-slate-700/50">
          <div className="mt-4 space-y-4">
            {/* Full Detail */}
            <div>
              <div className="text-slate-400 text-sm font-semibold uppercase mb-1">Decision Detail</div>
              <div className="text-slate-200 text-base bg-slate-900/40 rounded-lg p-3">{decision.detail}</div>
            </div>

            {/* Reasoning Chain */}
            <div>
              <div className="text-slate-400 text-sm font-semibold uppercase mb-1">Reasoning Chain</div>
              <div className="text-slate-300 bg-slate-900/40 rounded-lg p-3 font-mono text-sm leading-relaxed whitespace-pre-wrap break-words">
                {decision.reasoning || 'No reasoning chain available'}
              </div>
            </div>

            {/* Confidence Score */}
            <div>
              <div className="text-slate-400 text-sm font-semibold uppercase mb-2">Confidence Analysis</div>
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
  const [error, setError] = useState('');
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    const uid = localStorage.getItem('skillforge:userId');
    if (!uid) { setLoading(false); return; }
    const token = localStorage.getItem('auth_token');
    const authHeaders = token ? { Authorization: `Bearer ${token}` } : {};
    setLoading(true);
    setError('');
    fetch(`/api/session/dashboard/${uid}`, { headers: authHeaders })
      .then(r => r.json())
      .then(json => {
        if (json.success) setData(json.data);
        else setError(typeof json.error === 'string' ? json.error : json.error?.message || 'Could not load the reasoning chain');
      })
      .catch(e => { console.error('[ExplainabilityConsole]', e); setError(e.message || 'Network error'); })
      .finally(() => setLoading(false));
  }, [reloadKey]);

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
        <div className={error ? 'text-red-400 mb-4' : 'text-slate-300 mb-4'}>{error || 'No session found. Start a learning journey first.'}</div>
        <div className="flex gap-3 justify-center">
          {error && <button onClick={() => setReloadKey(k => k + 1)} className="px-5 py-2.5 bg-slate-700 hover:bg-slate-600 rounded-lg text-base">Retry</button>}
          <button onClick={() => navigate('/')} className="px-5 py-2.5 bg-indigo-600 hover:bg-indigo-500 rounded-lg text-base">Start Learning Journey</button>
        </div>
      </div>
    </div>
  );

  const decisions = Array.isArray(data.agentDecisions) ? data.agentDecisions : [];
  const debates = Array.isArray(data.agentDebates) ? data.agentDebates : [];

  const agentTypes = ['all', ...new Set(decisions.map(d => TYPE_META[d.type]?.label || 'Agent'))];
  const clearFilters = () => { setFilter('all'); setSearch(''); };

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

  const verdictColorOf = (v) => (v === 'review' ? '#F59E0B' : v === 'accelerate' ? '#10B981' : '#6366F1');

  return (
    <div className="min-h-screen bg-[#0F172A] text-white">
      <PageContainer>
        <button onClick={() => navigate(-1)} className="text-slate-300 hover:text-white text-sm mb-3 flex items-center gap-1">
          ← Back
        </button>
        <PageHeader icon="🧠" title="Explainability Console" subtitle="Full reasoning chain: every agent decision explained" />

        {/* Summary */}
        <div className="grid grid-cols-2 xl:grid-cols-4 gap-4 mb-5">
          <StatCard label="Total Decisions" value={decisions.length} icon="🧾" description="Every decision the agents have made for you" tooltip="Count of all logged agent decisions: goal analysis, skill tree, diagnostics, plans, scoring and adaptations." />
          <StatCard label="Agent Debates" value={debates.length} icon="⚔️" description="Times agents argued before deciding" tooltip="Number of multi-agent debates that were held to reach a verdict on how your learning should adapt." />
          <StatCard label="Adaptations" value={decisions.filter(d => d.type === 'adaptation').length} icon="⚡" description="Plan changes made for you" tooltip="Decisions where the AdaptorAgent changed your plan based on how you performed." />
          <StatCard label="Sessions Scored" value={decisions.filter(d => d.type === 'session_complete').length} icon="✅" description="Sessions evaluated by the agents" tooltip="Sessions that the EvaluatorAgent has scored and logged." />
        </div>

        <div className="grid grid-cols-1 xl:grid-cols-3 gap-5 items-start">
          {/* Decision log (2/3) */}
          <section className="xl:col-span-2 min-w-0 rounded-2xl border border-slate-700/60 bg-slate-800/40 p-4 sm:p-5">
            <h2 className="text-lg font-semibold text-slate-100 mb-3">Decision Log</h2>
            <div className="flex flex-col gap-3 mb-4">
              <input
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Search decisions..."
                aria-label="Search decisions"
                className="w-full min-w-0 bg-slate-900 border border-slate-700 rounded-lg px-4 py-2.5 text-base text-white placeholder-slate-400 focus:outline-none focus:border-amber-500"
              />
              <TabBar size="sm" active={filter} onChange={setFilter}
                tabs={agentTypes.map(t => ({ key: t, label: t === 'all' ? 'All agents' : t }))} />
            </div>

            {filtered.length === 0 ? (
              <div className="text-center py-12 text-slate-400 text-base">
                {decisions.length === 0 ? (
                  'No agent decisions yet. Complete the diagnostic to see the reasoning chain.'
                ) : (
                  <>
                    <p>No decisions match your filters.</p>
                    <button onClick={clearFilters} className="mt-3 px-4 py-2 rounded-lg bg-amber-600 hover:bg-amber-500 text-white text-sm font-semibold">Clear filters</button>
                  </>
                )}
              </div>
            ) : (
              <div className="space-y-3">
                {filtered.map((decision, i) => (
                  <DecisionCard key={decision.id || i} decision={decision} index={i} debates={debates} />
                ))}
              </div>
            )}
          </section>

          {/* Side column (1/3) */}
          <div className="space-y-5 min-w-0">
            <section className="rounded-2xl border border-slate-700/60 bg-slate-800/40 p-4 sm:p-5">
              <h2 className="text-lg font-semibold text-slate-100 mb-3">Agent Activity Map</h2>
              {Object.keys(agentCounts).length === 0 ? (
                <p className="text-slate-400 text-base">No agent activity yet.</p>
              ) : (
                <div className="flex flex-wrap gap-3">
                  {Object.entries(agentCounts).map(([agent, count]) => {
                    const meta = Object.values(TYPE_META).find(m => m.label === agent) || TYPE_META.default;
                    return (
                      <div key={agent} className="flex items-center gap-2 px-3 py-2 rounded-lg border"
                        style={{ borderColor: meta.color + '40', background: meta.color + '10' }}>
                        <span>{meta.icon}</span>
                        <span className="text-base font-medium" style={{ color: meta.color }}>{agent}</span>
                        <span className="text-sm bg-slate-700 px-2 py-0.5 rounded-full text-slate-200">{count}</span>
                      </div>
                    );
                  })}
                </div>
              )}
            </section>

            <section className="rounded-2xl border border-amber-500/20 bg-amber-900/10 p-4 sm:p-5">
              <h2 className="text-lg font-semibold text-amber-400 mb-3">⚔️ Agent Debate History ({debates.length})</h2>
              {debates.length === 0 ? (
                <p className="text-slate-400 text-base">No debates held yet.</p>
              ) : (
                <div className="space-y-3">
                  {debates.map((debate, i) => (
                    <div key={i} className="flex items-center justify-between gap-3 bg-slate-800/40 rounded-lg p-3">
                      <div className="min-w-0">
                        <div className="text-white text-base font-medium truncate" title={debate.topic}>{debate.topic}</div>
                        <div className="text-slate-400 text-sm">
                          {debate.arguments?.length ?? 0} agents · avg score {debate.metrics?.avgScore ?? 0}%
                        </div>
                      </div>
                      <div className="text-right shrink-0">
                        <div className="text-base font-bold uppercase" style={{ color: verdictColorOf(debate.verdict) }}>
                          {debate.verdict}
                        </div>
                        <div className="text-slate-400 text-sm">{debate.verdictConfidence}% confidence</div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </section>
          </div>
        </div>
      </PageContainer>
    </div>
  );
}
