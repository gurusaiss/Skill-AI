import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';

// Dynamic quick skills derived from user goal, with tech fallback
function getDynamicSkills(goalSkills) {
  if (goalSkills?.length > 0) {
    return goalSkills.slice(0, 6).map(s => ({ label: s.name, icon: '⚡' }));
  }
  return [
    { label: 'Python', icon: '🐍' }, { label: 'Machine Learning', icon: '🤖' },
    { label: 'React', icon: '⚛️' }, { label: 'AWS', icon: '☁️' },
    { label: 'TypeScript', icon: '📘' }, { label: 'Go', icon: '🐹' },
  ];
}

function MetricCard({ label, before, after, unit = '', color = '#6366F1', prefix = '' }) {
  const isUp = after > before;
  const delta = typeof after === 'number' && typeof before === 'number'
    ? Math.round(((after - before) / Math.max(1, before)) * 100)
    : null;
  return (
    <div className="bg-slate-800/60 border border-slate-700 rounded-xl p-5 flex flex-col gap-2">
      <div className="text-slate-400 text-xs font-medium uppercase tracking-wider">{label}</div>
      <div className="flex items-end gap-3">
        <div className="text-slate-500 text-lg line-through">{prefix}{before?.toLocaleString()}{unit}</div>
        <div className="text-2xl font-bold" style={{ color }}>{prefix}{after?.toLocaleString()}{unit}</div>
      </div>
      {delta !== null && (
        <div className={`text-xs font-semibold ${isUp ? 'text-emerald-400' : 'text-red-400'}`}>
          {isUp ? '↑' : '↓'} {Math.abs(delta)}% {isUp ? 'improvement' : 'reduction'}
        </div>
      )}
    </div>
  );
}

function TimelineBar({ items }) {
  return (
    <div className="flex flex-col gap-0">
      {items.map((item, i) => (
        <div key={i} className="flex gap-4 items-start">
          <div className="flex flex-col items-center">
            <div className="w-8 h-8 rounded-full bg-indigo-500/20 border-2 border-indigo-500 flex items-center justify-center text-indigo-400 text-xs font-bold">
              {item.week}w
            </div>
            {i < items.length - 1 && <div className="w-0.5 h-8 bg-indigo-500/30 mt-1" />}
          </div>
          <div className="pb-6">
            <div className="font-semibold text-white text-sm">{item.milestone}</div>
            <div className="text-emerald-400 text-xs mt-0.5">🔓 {item.unlock}</div>
          </div>
        </div>
      ))}
    </div>
  );
}

export default function SimulationLab() {
  const navigate = useNavigate();
  const userId = localStorage.getItem('skillforge:userId');
  const [skill, setSkill] = useState('');
  const [goalSkills, setGoalSkills] = useState([]);
  const [goalDomain, setGoalDomain] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');

  // Load user's goal to auto-populate skill field
  useEffect(() => {
    if (!userId) return;
    fetch(`/api/session/dashboard/${userId}`)
      .then(r => r.json())
      .then(json => {
        if (json.success) {
          const skills = json.data?.goal?.skills || [];
          const domain = json.data?.goal?.domainLabel || '';
          setGoalSkills(skills);
          setGoalDomain(domain);
          // Auto-populate skill with primary skill if not set
          if (skills.length > 0 && !skill) {
            setSkill(skills[0].name);
          }
          // Auto-populate comparisons
          if (skills.length >= 2) {
            setCompareA(skills[0].name);
            setCompareB(skills[1].name);
          }
        }
      })
      .catch(() => {});
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);
  const [compareA, setCompareA] = useState('Python');
  const [compareB, setCompareB] = useState('AWS');
  const [compareResult, setCompareResult] = useState(null);
  const [compareLoading, setCompareLoading] = useState(false);
  const [tab, setTab] = useState('whatif');

  const runSimulation = async (skillName) => {
    const s = skillName || skill;
    if (!s.trim()) return;
    setLoading(true); setError(''); setResult(null);
    try {
      const uid = userId || 'demo';
      const res = await fetch('/api/simulation/whatif', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: uid, proposedSkill: s }),
      });
      const json = await res.json();
      if (!json.success) throw new Error(json.error);
      setResult(json.data);
    } catch (e) { setError(e.message); }
    finally { setLoading(false); }
  };

  const runCompare = async () => {
    if (!compareA || !compareB) return;
    setCompareLoading(true); setCompareResult(null);
    try {
      const uid = userId || 'demo';
      const res = await fetch('/api/simulation/compare', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: uid, pathA: compareA, pathB: compareB }),
      });
      const json = await res.json();
      if (!json.success) throw new Error(json.error);
      setCompareResult(json.data);
    } catch (e) { setError(e.message); }
    finally { setCompareLoading(false); }
  };

  const verdict = result?.agentVerdict;
  const verdictColor = verdict?.recommendation?.includes('STRONG') ? '#10B981' : '#F59E0B';

  return (
    <div className="min-h-screen bg-[#0F172A] text-white">
      <div className="max-w-6xl mx-auto px-6 py-10">

        {/* Header */}
        <div className="mb-8">
          <button onClick={() => navigate(-1)} className="text-slate-400 hover:text-white text-sm mb-4 flex items-center gap-1">
            ← Back
          </button>
          <div className="flex items-center gap-3 mb-2">
            <div className="w-10 h-10 rounded-xl bg-violet-500/20 border border-violet-500/40 flex items-center justify-center text-xl">🔮</div>
            <div>
              <h1 className="text-3xl font-bold bg-gradient-to-r from-violet-400 to-indigo-400 bg-clip-text text-transparent">
                Simulation Lab
              </h1>
              <p className="text-slate-400 text-sm">What-If Career Simulator — Powered by SimulationAgent</p>
            </div>
          </div>
          <p className="text-slate-300 mt-2 max-w-2xl">
            Ask <strong className="text-violet-400">"What if I learn X?"</strong> and get AI-projected salary impact, market demand shift,
            hiring timeline improvement, and full career trajectory — before you invest the time.
          </p>
        </div>

        {/* Tabs */}
        <div className="flex gap-1 mb-6 bg-slate-800/50 rounded-lg p-1 w-fit">
          {[['whatif', '🔮 What-If Analyzer'], ['compare', '⚖️ Path Comparison']].map(([key, label]) => (
            <button key={key} onClick={() => setTab(key)}
              className={`px-4 py-2 rounded-md text-sm font-medium transition-all ${tab === key ? 'bg-violet-600 text-white' : 'text-slate-400 hover:text-white'}`}>
              {label}
            </button>
          ))}
        </div>

        {tab === 'whatif' && (
          <>
            {/* Input */}
            <div className="bg-slate-800/40 border border-slate-700 rounded-2xl p-6 mb-6">
              <div className="text-slate-300 font-semibold mb-3">Enter a skill to simulate:</div>
              <div className="flex gap-3 mb-4">
                <input
                  value={skill}
                  onChange={e => setSkill(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && runSimulation()}
                  placeholder="e.g. Python, Kubernetes, Machine Learning, React..."
                  className="flex-1 bg-slate-900 border border-slate-700 rounded-lg px-4 py-3 text-white placeholder-slate-500 focus:outline-none focus:border-violet-500"
                />
                <button
                  onClick={() => runSimulation()}
                  disabled={loading || !skill.trim()}
                  className="px-6 py-3 bg-violet-600 hover:bg-violet-500 disabled:opacity-50 rounded-lg font-semibold transition-all"
                >
                  {loading ? '⟳ Simulating...' : '🔮 Simulate'}
                </button>
              </div>
              <div className="flex flex-wrap gap-2">
                {goalSkills.length > 0 && (
                  <span className="text-xs text-slate-600 self-center mr-1">Your skills:</span>
                )}
                {getDynamicSkills(goalSkills).map(({ label, icon }) => (
                  <button key={label} onClick={() => runSimulation(label)}
                    className="px-3 py-1.5 bg-slate-700/50 hover:bg-violet-600/30 border border-slate-600 hover:border-violet-500 rounded-full text-sm text-slate-300 hover:text-white transition-all">
                    {icon} {label}
                  </button>
                ))}
              </div>
            </div>

            {error && <div className="bg-red-900/30 border border-red-500/30 rounded-lg p-4 text-red-300 mb-6">{error}</div>}

            {loading && (
              <div className="text-center py-16">
                <div className="text-4xl mb-4 animate-pulse">🔮</div>
                <div className="text-violet-400 font-semibold">SimulationAgent running projection...</div>
                <div className="text-slate-500 text-sm mt-2">Analyzing salary impact, market demand, hiring timeline...</div>
              </div>
            )}

            {result && (
              <div className="space-y-6">
                {/* Agent Verdict Banner */}
                {verdict && (
                  <div className="rounded-xl p-5 border" style={{ borderColor: verdictColor + '40', background: verdictColor + '10' }}>
                    <div className="flex items-center gap-3 mb-2">
                      <div className="text-2xl">🤖</div>
                      <div>
                        <div className="font-bold text-lg" style={{ color: verdictColor }}>
                          Agent Verdict: {verdict.recommendation}
                        </div>
                        <div className="text-slate-400 text-sm">{verdict.debateOutcome}</div>
                      </div>
                      <div className="ml-auto text-right">
                        <div className="text-2xl font-bold" style={{ color: verdictColor }}>{verdict.confidenceScore}%</div>
                        <div className="text-slate-500 text-xs">confidence</div>
                      </div>
                    </div>
                    <div className="text-slate-300 text-sm">{verdict.reasoning}</div>
                  </div>
                )}

                {/* Outcome Metrics */}
                <div>
                  <h3 className="text-slate-300 font-semibold mb-3">📊 Projected Impact</h3>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                    {result.outcomes?.salaryImpact && (
                      <MetricCard label="Annual Salary" prefix="$" before={result.outcomes.salaryImpact.before} after={result.outcomes.salaryImpact.after} color="#10B981" />
                    )}
                    {result.outcomes?.marketDemand && (
                      <MetricCard label="Market Demand" before={result.outcomes.marketDemand.before} after={result.outcomes.marketDemand.after} unit="/100" color="#6366F1" />
                    )}
                    {result.outcomes?.jobOpenings && (
                      <MetricCard label="Job Openings" before={result.outcomes.jobOpenings.before} after={result.outcomes.jobOpenings.after} color="#F59E0B" />
                    )}
                    <div className="bg-slate-800/60 border border-slate-700 rounded-xl p-5">
                      <div className="text-slate-400 text-xs font-medium uppercase tracking-wider mb-2">Hiring Time</div>
                      <div className="text-slate-500 text-lg line-through">{result.outcomes?.hiringTime?.before}</div>
                      <div className="text-xl font-bold text-emerald-400">{result.outcomes?.hiringTime?.after}</div>
                      <div className="text-emerald-400 text-xs font-semibold mt-1">↑ {result.outcomes?.hiringTime?.improvement}</div>
                    </div>
                  </div>
                </div>

                {/* Timeline */}
                {result.timeline?.length > 0 && (
                  <div className="bg-slate-800/40 border border-slate-700 rounded-xl p-6">
                    <h3 className="text-slate-300 font-semibold mb-4">📅 Learning Milestone Timeline</h3>
                    <TimelineBar items={result.timeline} />
                  </div>
                )}

                {/* Alternatives + Risk */}
                <div className="grid md:grid-cols-2 gap-4">
                  {result.alternativePaths?.length > 0 && (
                    <div className="bg-slate-800/40 border border-slate-700 rounded-xl p-5">
                      <h3 className="text-slate-300 font-semibold mb-3">⚖️ Alternative Skills</h3>
                      <div className="space-y-2">
                        {result.alternativePaths.map((p, i) => (
                          <div key={i} className="flex items-center justify-between py-2 border-b border-slate-700/50 last:border-0">
                            <div>
                              <div className="text-white text-sm font-medium">{p.skill}</div>
                              <div className="text-slate-500 text-xs">{p.difficulty} · {p.verdict}</div>
                            </div>
                            <div className="text-right">
                              <div className="text-emerald-400 text-sm font-bold">+${(p.salaryDelta / 1000).toFixed(0)}k</div>
                              <div className="text-slate-500 text-xs">{p.demandScore}/100 demand</div>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                  {result.riskFactors?.length > 0 && (
                    <div className="bg-slate-800/40 border border-amber-700/30 rounded-xl p-5">
                      <h3 className="text-amber-400 font-semibold mb-3">⚠️ Risk Factors</h3>
                      <div className="space-y-2">
                        {result.riskFactors.map((r, i) => (
                          <div key={i} className="flex gap-2 text-sm text-slate-300">
                            <span className="text-amber-500 mt-0.5">•</span>
                            <span>{r}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>

                <div className="text-slate-500 text-xs text-center">
                  Powered by SimulationAgent · Source: {result._source === 'llm' ? '🤖 AI Analysis' : '📊 Market Model'}
                  · Projections are estimates based on current market data
                </div>
              </div>
            )}
          </>
        )}

        {tab === 'compare' && (
          <div className="space-y-6">
            <div className="bg-slate-800/40 border border-slate-700 rounded-2xl p-6">
              <div className="text-slate-300 font-semibold mb-4">Compare two career paths head-to-head:</div>
              <div className="grid grid-cols-2 gap-4 mb-4">
                <div>
                  <label className="text-slate-500 text-xs mb-1 block">Path A</label>
                  <input value={compareA} onChange={e => setCompareA(e.target.value)}
                    className="w-full bg-slate-900 border border-slate-700 rounded-lg px-4 py-3 text-white focus:outline-none focus:border-violet-500" />
                </div>
                <div>
                  <label className="text-slate-500 text-xs mb-1 block">Path B</label>
                  <input value={compareB} onChange={e => setCompareB(e.target.value)}
                    className="w-full bg-slate-900 border border-slate-700 rounded-lg px-4 py-3 text-white focus:outline-none focus:border-violet-500" />
                </div>
              </div>
              <button onClick={runCompare} disabled={compareLoading}
                className="w-full py-3 bg-violet-600 hover:bg-violet-500 disabled:opacity-50 rounded-lg font-semibold transition-all">
                {compareLoading ? '⟳ Comparing...' : '⚖️ Run Comparison'}
              </button>
            </div>

            {compareLoading && (
              <div className="text-center py-10 text-violet-400 animate-pulse">Simulating both paths...</div>
            )}

            {compareResult && (
              <div className="grid md:grid-cols-2 gap-6">
                {[['pathA', compareResult.pathA], ['pathB', compareResult.pathB]].map(([key, path]) => (
                  <div key={key} className={`bg-slate-800/40 rounded-xl p-5 border ${key === 'pathA' ? 'border-indigo-500/40' : 'border-violet-500/40'}`}>
                    <div className={`text-lg font-bold mb-4 ${key === 'pathA' ? 'text-indigo-400' : 'text-violet-400'}`}>
                      {path.name}
                    </div>
                    <div className="space-y-3">
                      <div className="flex justify-between text-sm">
                        <span className="text-slate-400">Salary Impact</span>
                        <span className="text-emerald-400 font-bold">+{path.outcomes?.salaryImpact?.deltaPercent}%</span>
                      </div>
                      <div className="flex justify-between text-sm">
                        <span className="text-slate-400">Market Demand</span>
                        <span className="text-white font-bold">{path.outcomes?.marketDemand?.after}/100</span>
                      </div>
                      <div className="flex justify-between text-sm">
                        <span className="text-slate-400">Job Openings</span>
                        <span className="text-white font-bold">{path.outcomes?.jobOpenings?.growth}</span>
                      </div>
                      <div className="flex justify-between text-sm">
                        <span className="text-slate-400">Agent Verdict</span>
                        <span className="text-amber-400 font-bold text-xs">{path.agentVerdict?.recommendation}</span>
                      </div>
                    </div>
                  </div>
                ))}
                <div className="md:col-span-2 bg-emerald-900/20 border border-emerald-500/30 rounded-xl p-4 text-center">
                  <div className="text-emerald-400 font-semibold">🏆 {compareResult.verdict}</div>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
