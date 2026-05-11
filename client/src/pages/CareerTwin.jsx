import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';

function RadarChart({ skills }) {
  if (!skills?.length) return null;
  const size = 220;
  const cx = size / 2, cy = size / 2, radius = 80;
  const count = skills.length;
  const maxVal = 100;

  const points = skills.map((s, i) => {
    const angle = (i / count) * Math.PI * 2 - Math.PI / 2;
    return { angle, x: cx + radius * Math.cos(angle), y: cy + radius * Math.sin(angle) };
  });

  const dataPoints = skills.map((s, i) => {
    const angle = points[i].angle;
    const r = (s.current / maxVal) * radius;
    return { x: cx + r * Math.cos(angle), y: cy + r * Math.sin(angle) };
  });

  const targetPoints = skills.map((s, i) => {
    const angle = points[i].angle;
    const r = (s.target / maxVal) * radius;
    return { x: cx + r * Math.cos(angle), y: cy + r * Math.sin(angle) };
  });

  const toPath = (pts) => pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ') + ' Z';

  // Grid rings
  const rings = [0.25, 0.5, 0.75, 1].map(r => {
    const ps = points.map(p => ({
      x: cx + radius * r * Math.cos(p.angle),
      y: cy + radius * r * Math.sin(p.angle),
    }));
    return toPath(ps);
  });

  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
      {/* Grid */}
      {rings.map((d, i) => <path key={i} d={d} fill="none" stroke="rgba(99,102,241,0.15)" strokeWidth="1" />)}
      {points.map((p, i) => <line key={i} x1={cx} y1={cy} x2={p.x} y2={p.y} stroke="rgba(99,102,241,0.2)" strokeWidth="1" />)}
      {/* Target area */}
      <path d={toPath(targetPoints)} fill="rgba(99,102,241,0.1)" stroke="#6366F1" strokeWidth="1.5" strokeDasharray="4,2" />
      {/* Current area */}
      <path d={toPath(dataPoints)} fill="rgba(16,185,129,0.2)" stroke="#10B981" strokeWidth="2" />
      {/* Dots */}
      {dataPoints.map((p, i) => <circle key={i} cx={p.x} cy={p.y} r="4" fill="#10B981" />)}
      {/* Labels */}
      {points.map((p, i) => {
        const lx = cx + (radius + 22) * Math.cos(p.angle);
        const ly = cy + (radius + 22) * Math.sin(p.angle);
        return (
          <text key={i} x={lx} y={ly} textAnchor="middle" dominantBaseline="middle"
            fill="#94A3B8" fontSize="8" fontWeight="500">
            {skills[i].skill?.split(' ')[0]}
          </text>
        );
      })}
    </svg>
  );
}

function ProgressBar({ value, max = 100, color = '#6366F1', label, sub }) {
  return (
    <div>
      <div className="flex justify-between text-xs mb-1">
        <span className="text-slate-300 font-medium">{label}</span>
        <span className="font-bold" style={{ color }}>{value}%</span>
      </div>
      <div className="h-2 bg-slate-700 rounded-full overflow-hidden">
        <div className="h-full rounded-full transition-all duration-700"
          style={{ width: `${Math.min(100, value)}%`, background: color }} />
      </div>
      {sub && <div className="text-slate-500 text-xs mt-0.5">{sub}</div>}
    </div>
  );
}

export default function CareerTwin() {
  const navigate = useNavigate();
  const [data, setData] = useState(null);
  const [forecast, setForecast] = useState(null);
  const [market, setMarket] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    const uid = localStorage.getItem('skillforge:userId');
    if (!uid) { setError('No active session. Complete goal setup first.'); setLoading(false); return; }

    Promise.all([
      fetch(`/api/session/dashboard/${uid}`).then(r => r.json()),
      fetch(`/api/simulation/forecast/${uid}`).then(r => r.json()),
      fetch(`/api/market/intelligence/${uid}`).then(r => r.json()),
    ]).then(([db, fc, mk]) => {
      if (db.success) setData(db.data);
      if (fc.success) setForecast(fc.data);
      if (mk.success) setMarket(mk.data);
    }).catch(e => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return (
    <div className="min-h-screen bg-[#0F172A] flex items-center justify-center">
      <div className="text-center">
        <div className="text-5xl mb-4 animate-pulse">🧬</div>
        <div className="text-indigo-400 font-semibold">Building your Career Digital Twin...</div>
        <div className="text-slate-500 text-sm mt-2">Synthesizing skills, market data, and trajectory models</div>
      </div>
    </div>
  );

  if (error || !data) return (
    <div className="min-h-screen bg-[#0F172A] flex items-center justify-center">
      <div className="text-center">
        <div className="text-4xl mb-4">🧬</div>
        <div className="text-red-400 mb-2">{error || 'No session found'}</div>
        <button onClick={() => navigate('/')} className="px-4 py-2 bg-indigo-600 rounded-lg text-sm">Start Learning Journey</button>
      </div>
    </div>
  );

  const { goal, sessions, stats, diagnosticScores } = data;
  const skills = goal?.skills || [];
  const radarData = forecast?.opportunityRadar || skills.slice(0, 6).map(s => ({
    skill: s.name, current: s.mastery || 0, target: 85, marketDemand: 75, gap: 85 - (s.mastery || 0),
  }));

  const masteryScore = stats.avgScore || 0;
  const readiness = forecast?.currentState?.readinessPct || Math.round(masteryScore * 0.8);
  const velocity = forecast?.currentState?.velocity || 0;

  const twinLevel = readiness < 20 ? { label: 'Initializing', color: '#6B7280', icon: '🌱' }
    : readiness < 40 ? { label: 'Developing', color: '#F59E0B', icon: '🔧' }
    : readiness < 65 ? { label: 'Emerging', color: '#3B82F6', icon: '📈' }
    : readiness < 85 ? { label: 'Advanced', color: '#8B5CF6', icon: '⚡' }
    : { label: 'Expert', color: '#10B981', icon: '🏆' };

  return (
    <div className="min-h-screen bg-[#0F172A] text-white">
      <div className="max-w-6xl mx-auto px-6 py-10">

        {/* Header */}
        <div className="mb-8">
          <button onClick={() => navigate(-1)} className="text-slate-400 hover:text-white text-sm mb-4 flex items-center gap-1">
            ← Back
          </button>
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-indigo-500/20 border border-indigo-500/40 flex items-center justify-center text-xl">🧬</div>
            <div>
              <h1 className="text-3xl font-bold bg-gradient-to-r from-indigo-400 to-cyan-400 bg-clip-text text-transparent">
                Career Digital Twin
              </h1>
              <p className="text-slate-400 text-sm">Your evolving virtual career model — updated after every session</p>
            </div>
          </div>
        </div>

        {/* Twin Identity Card */}
        <div className="bg-gradient-to-br from-indigo-900/40 to-violet-900/20 border border-indigo-500/30 rounded-2xl p-6 mb-6">
          <div className="flex flex-wrap items-center gap-6">
            {/* Avatar */}
            <div className="relative">
              <div className="w-24 h-24 rounded-full bg-gradient-to-br from-indigo-500 to-violet-600 flex items-center justify-center text-4xl shadow-lg shadow-indigo-500/30">
                {twinLevel.icon}
              </div>
              <div className="absolute -bottom-1 -right-1 w-7 h-7 rounded-full border-2 border-[#0F172A] flex items-center justify-center text-xs"
                style={{ background: twinLevel.color }}>
                {readiness}
              </div>
            </div>

            {/* Identity */}
            <div className="flex-1">
              <div className="text-2xl font-bold text-white">{goal?.domainLabel || 'Learner'}</div>
              <div className="text-sm font-semibold mb-1" style={{ color: twinLevel.color }}>
                Twin Status: {twinLevel.label}
              </div>
              <div className="text-slate-400 text-sm max-w-md">"{goal?.goalText}"</div>
            </div>

            {/* Stats Row */}
            <div className="flex gap-6">
              {[
                { label: 'Mastery', value: `${masteryScore}%`, color: '#10B981' },
                { label: 'Sessions', value: sessions?.length || 0, color: '#6366F1' },
                { label: 'Readiness', value: `${readiness}%`, color: '#F59E0B' },
                { label: 'Velocity', value: `${velocity > 0 ? '+' : ''}${velocity}`, color: velocity >= 0 ? '#10B981' : '#EF4444' },
              ].map(({ label, value, color }) => (
                <div key={label} className="text-center">
                  <div className="text-2xl font-bold" style={{ color }}>{value}</div>
                  <div className="text-slate-500 text-xs">{label}</div>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="grid md:grid-cols-3 gap-6">

          {/* Skill Radar */}
          <div className="bg-slate-800/40 border border-slate-700 rounded-xl p-5">
            <h3 className="text-slate-300 font-semibold mb-4">🎯 Competency Radar</h3>
            <div className="flex justify-center">
              <RadarChart skills={radarData} />
            </div>
            <div className="flex gap-4 justify-center mt-2 text-xs">
              <div className="flex items-center gap-1"><div className="w-3 h-0.5 bg-emerald-400" /> Current</div>
              <div className="flex items-center gap-1"><div className="w-3 h-0.5 bg-indigo-400 border-dashed" style={{ borderTop: '1.5px dashed #6366F1', height: 0 }} /> Target</div>
            </div>
          </div>

          {/* Skill Progress */}
          <div className="bg-slate-800/40 border border-slate-700 rounded-xl p-5">
            <h3 className="text-slate-300 font-semibold mb-4">📊 Skill Mastery Matrix</h3>
            <div className="space-y-4">
              {skills.slice(0, 6).map((skill, i) => {
                const diagScore = diagnosticScores?.[skill.id];
                const mastery = skill.mastery || diagScore || 0;
                const color = mastery >= 75 ? '#10B981' : mastery >= 50 ? '#F59E0B' : '#EF4444';
                return (
                  <ProgressBar key={i} label={skill.name} value={mastery} color={color}
                    sub={`${skill.sessionsCompleted || 0} sessions · ${skill.status}`} />
                );
              })}
            </div>
          </div>

          {/* Trajectory Forecast */}
          <div className="bg-slate-800/40 border border-slate-700 rounded-xl p-5">
            <h3 className="text-slate-300 font-semibold mb-4">🔮 Career Trajectory</h3>
            {forecast?.trajectory ? (
              <div className="space-y-3">
                {forecast.trajectory.map((t, i) => (
                  <div key={i} className="flex items-center gap-3">
                    <div className="w-16 text-slate-500 text-xs font-medium">{t.label}</div>
                    <div className="flex-1">
                      <div className="h-1.5 bg-slate-700 rounded-full overflow-hidden">
                        <div className="h-full rounded-full bg-gradient-to-r from-indigo-500 to-violet-500 transition-all"
                          style={{ width: `${t.readinessForHiring}%` }} />
                      </div>
                    </div>
                    <div className="w-8 text-right text-xs font-bold text-indigo-400">{t.readinessForHiring}%</div>
                  </div>
                ))}
                <div className="mt-4 pt-4 border-t border-slate-700">
                  <div className="text-slate-400 text-xs">Projected Salary at Readiness</div>
                  <div className="text-2xl font-bold text-emerald-400">
                    ${(forecast.currentState.projectedSalary / 1000).toFixed(0)}k
                  </div>
                  <div className="text-slate-500 text-xs">Based on {goal?.domainLabel} market rates</div>
                </div>
              </div>
            ) : (
              <div className="text-slate-500 text-sm">Complete sessions to unlock trajectory forecast</div>
            )}
          </div>
        </div>

        {/* Market Intelligence Panel */}
        {market && (
          <div className="mt-6 bg-slate-800/40 border border-slate-700 rounded-xl p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-slate-300 font-semibold">📈 Live Market Intelligence</h3>
              <div className="flex items-center gap-2">
                <div className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                <span className="text-emerald-400 text-xs">Market Active</span>
              </div>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
              {[
                { label: 'Demand Score', value: `${market.demandScore}/100`, color: '#6366F1' },
                { label: 'Open Positions', value: market.openJobs, color: '#10B981' },
                { label: 'Avg Salary', value: market.avgSalary, color: '#F59E0B' },
                { label: 'YoY Growth', value: market.trend, color: '#06B6D4' },
              ].map(({ label, value, color }) => (
                <div key={label} className="bg-slate-900/50 rounded-lg p-3 text-center">
                  <div className="text-xs text-slate-500 mb-1">{label}</div>
                  <div className="font-bold text-sm" style={{ color }}>{value}</div>
                </div>
              ))}
            </div>
            {market.insights?.length > 0 && (
              <div className="space-y-2">
                {market.insights.map((ins, i) => (
                  <div key={i} className="flex gap-2 text-sm text-slate-300">
                    <span className="text-indigo-400 font-bold">→</span>
                    <span>{ins}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Opportunity Radar */}
        <div className="mt-6 bg-slate-800/40 border border-slate-700 rounded-xl p-6">
          <h3 className="text-slate-300 font-semibold mb-4">🎯 Opportunity Radar — Skill Gap vs Market Demand</h3>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
            {radarData.map((s, i) => {
              const gapSize = s.gap;
              const urgency = gapSize > 50 ? 'Critical' : gapSize > 25 ? 'High' : gapSize > 10 ? 'Medium' : 'Low';
              const urgencyColor = gapSize > 50 ? '#EF4444' : gapSize > 25 ? '#F59E0B' : gapSize > 10 ? '#6366F1' : '#10B981';
              return (
                <div key={i} className="bg-slate-900/40 rounded-lg p-3">
                  <div className="flex justify-between items-start mb-2">
                    <div className="text-white text-sm font-medium">{s.skill}</div>
                    <div className="text-xs px-2 py-0.5 rounded-full font-semibold"
                      style={{ background: urgencyColor + '20', color: urgencyColor }}>
                      {urgency}
                    </div>
                  </div>
                  <div className="space-y-1">
                    <div className="flex justify-between text-xs text-slate-500">
                      <span>Current</span><span>{s.current}%</span>
                    </div>
                    <div className="h-1 bg-slate-700 rounded-full"><div className="h-full bg-emerald-500 rounded-full" style={{ width: `${s.current}%` }} /></div>
                    <div className="flex justify-between text-xs text-slate-500">
                      <span>Market Req</span><span>{s.marketDemand}%</span>
                    </div>
                    <div className="h-1 bg-slate-700 rounded-full"><div className="h-full rounded-full" style={{ width: `${s.marketDemand}%`, background: urgencyColor }} /></div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Navigation Links */}
        <div className="mt-6 grid grid-cols-2 gap-4">
          <button onClick={() => navigate('/simulation')}
            className="flex items-center gap-3 p-4 bg-violet-600/20 border border-violet-500/40 rounded-xl hover:bg-violet-600/30 transition-all">
            <span className="text-2xl">🔮</span>
            <div className="text-left">
              <div className="text-violet-300 font-semibold">Simulation Lab</div>
              <div className="text-slate-500 text-xs">What-if career scenarios</div>
            </div>
          </button>
          <button onClick={() => navigate('/explain')}
            className="flex items-center gap-3 p-4 bg-amber-600/20 border border-amber-500/40 rounded-xl hover:bg-amber-600/30 transition-all">
            <span className="text-2xl">🧠</span>
            <div className="text-left">
              <div className="text-amber-300 font-semibold">Explainability Console</div>
              <div className="text-slate-500 text-xs">Full agent reasoning chain</div>
            </div>
          </button>
        </div>
      </div>
    </div>
  );
}
