import React, { useEffect, useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import {
  LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer,
} from 'recharts';

const BASE_URL = import.meta.env.PROD ? '' : 'http://localhost:3001';

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

// ── Module Career Twin ────────────────────────────────────────────────────────
function ModuleCareerTwin({ module, assignment, navigate, moduleId, assignmentId }) {
  const skills = (module?.skills || []).map((skill, i) => ({
    skill: typeof skill === 'string' ? skill : skill.name,
    current: Math.min(95, 20 + (assignment?.progress || 0) + (i * 5)),
    target: 90,
    gap: 90 - Math.min(95, 20 + (assignment?.progress || 0) + (i * 5)),
  }));

  const progress = assignment?.progress || 0;
  const sessionsCompleted = Object.values(assignment?.sessionProgress || {}).filter(s => s === 'completed').length;
  const totalSessions = (module?.sessions || []).length;

  return (
    <div className="min-h-screen bg-[#0F172A] text-white">
      <div className="max-w-5xl mx-auto px-6 py-10">
        {/* Header */}
        <div className="mb-8">
          <button
            onClick={() => navigate(`/module/${moduleId}/learn${assignmentId ? `?assignmentId=${assignmentId}` : ''}`)}
            className="text-slate-400 hover:text-white text-sm mb-4 flex items-center gap-1"
          >
            ← Back to Module
          </button>
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-indigo-500/20 border border-indigo-500/40 flex items-center justify-center text-xl">🧬</div>
            <div>
              <h1 className="text-3xl font-bold bg-gradient-to-r from-indigo-400 to-cyan-400 bg-clip-text text-transparent">
                Career Digital Twin
              </h1>
              <p className="text-slate-400 text-sm">{module?.title}</p>
            </div>
          </div>
        </div>

        {/* Stat Cards */}
        <div className="grid grid-cols-3 gap-4 mb-8">
          <div className="rounded-2xl border border-indigo-500/20 bg-indigo-500/5 p-5 text-center">
            <div className="text-3xl font-black text-indigo-400">{sessionsCompleted}/{totalSessions || '—'}</div>
            <div className="text-xs text-slate-500 uppercase tracking-widest mt-1">Sessions Completed</div>
          </div>
          <div className="rounded-2xl border border-emerald-500/20 bg-emerald-500/5 p-5 text-center">
            <div className="text-3xl font-black text-emerald-400">{progress}%</div>
            <div className="text-xs text-slate-500 uppercase tracking-widest mt-1">Overall Progress</div>
          </div>
          <div className="rounded-2xl border border-violet-500/20 bg-violet-500/5 p-5 text-center">
            <div className="text-3xl font-black text-violet-400">{skills.length}</div>
            <div className="text-xs text-slate-500 uppercase tracking-widest mt-1">Skills Tracked</div>
          </div>
        </div>

        <div className="grid md:grid-cols-2 gap-6">
          {/* Radar Chart */}
          <div className="bg-slate-800/40 border border-slate-700 rounded-xl p-5">
            <h3 className="text-slate-300 font-semibold mb-4">🎯 Competency Radar</h3>
            <div className="flex justify-center">
              <RadarChart skills={skills} />
            </div>
            <div className="flex gap-4 justify-center mt-2 text-xs">
              <div className="flex items-center gap-1"><div className="w-3 h-0.5 bg-emerald-400" /> Current</div>
              <div className="flex items-center gap-1"><div className="w-3 h-0.5 bg-indigo-400" style={{ borderTop: '1.5px dashed #6366F1', height: 0 }} /> Target</div>
            </div>
          </div>

          {/* Skill Breakdown */}
          <div className="bg-slate-800/40 border border-slate-700 rounded-xl p-5">
            <h3 className="text-slate-300 font-semibold mb-4">📊 Skill Progress</h3>
            <div className="space-y-4">
              {skills.map((s, i) => {
                const color = s.current >= 75 ? '#10B981' : s.current >= 50 ? '#F59E0B' : '#EF4444';
                return (
                  <div key={i}>
                    <div className="flex justify-between text-xs mb-1">
                      <span className="text-slate-300 font-medium">{s.skill}</span>
                      <span className="font-bold" style={{ color }}>{s.current}% / {s.target}%</span>
                    </div>
                    <div className="h-2 bg-slate-700 rounded-full overflow-hidden">
                      <div
                        className="h-full rounded-full transition-all duration-700"
                        style={{ width: `${Math.min(100, s.current)}%`, background: color }}
                      />
                    </div>
                    <div className="text-slate-500 text-xs mt-0.5">Gap: {s.gap}% to target</div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {/* Back Button */}
        <div className="mt-6">
          <button
            onClick={() => navigate(`/module/${moduleId}/learn${assignmentId ? `?assignmentId=${assignmentId}` : ''}`)}
            className="px-6 py-3 rounded-xl font-bold text-sm border border-indigo-500/40 bg-indigo-500/10 text-indigo-300 hover:bg-indigo-500/20 transition-all"
          >
            ← Back to Module
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Animated trait bar for Learning DNA ──────────────────────────────────────
function AnimatedTraitBar({ label, value, color }) {
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const t = setTimeout(() => setWidth(value), 100);
    return () => clearTimeout(t);
  }, [value]);
  return (
    <div>
      <div className="flex justify-between text-xs mb-1">
        <span className="text-slate-300 font-medium">{label}</span>
        <span className="font-bold" style={{ color }}>{value}%</span>
      </div>
      <div className="h-2 bg-slate-700/60 rounded-full overflow-hidden">
        <div
          className="h-full rounded-full transition-all duration-700 ease-out"
          style={{ width: `${width}%`, background: color }}
        />
      </div>
    </div>
  );
}

// ── Learning DNA + Velocity sections (employee-only) ─────────────────────────
function LearningDNASection({ sessions }) {
  const scores = sessions.map(s => s.score || 0);
  const avgScore = scores.length > 0 ? scores.reduce((a, b) => a + b, 0) / scores.length : 65;
  const scoreVariance = scores.length > 1
    ? Math.sqrt(scores.reduce((s, v) => s + Math.pow(v - avgScore, 2), 0) / scores.length)
    : 0;
  const consistency = sessions.length / Math.max(1, 21);

  let dnaType;
  if (avgScore > 80 && sessions.length < 10) {
    dnaType = { emoji: '🦅', name: 'Eagle Learner', color: '#6366F1', desc: 'High scores, fast progress — you absorb concepts quickly with few sessions needed.', superpower: 'Speed & Accuracy', traits: { speed: 90, consistency: 60, depth: 75 } };
  } else if (consistency > 0.7 && scoreVariance < 15) {
    dnaType = { emoji: '🐢', name: 'Deep Diver', color: '#14B8A6', desc: 'Slow and thorough — you build rock-solid understanding through consistent, steady practice.', superpower: 'Consistency & Depth', traits: { speed: 45, consistency: 95, depth: 90 } };
  } else if (scoreVariance > 20) {
    dnaType = { emoji: '🦊', name: 'Adaptive Learner', color: '#F59E0B', desc: 'Variable performance — you adapt quickly to new topics and thrive in dynamic environments.', superpower: 'Flexibility & Adaptability', traits: { speed: 70, consistency: 55, depth: 65 } };
  } else {
    dnaType = { emoji: '🔥', name: 'Sprint Learner', color: '#EC4899', desc: 'Bursts of intense learning followed by breaks — you perform best under focused, time-boxed sessions.', superpower: 'Focus & Intensity', traits: { speed: 75, consistency: 60, depth: 70 } };
  }

  return (
    <div
      className="rounded-2xl border border-slate-700/50 p-6 mb-6"
      style={{ background: `linear-gradient(135deg, ${dnaType.color}18 0%, #1E293B 60%)` }}
    >
      <h3 className="text-slate-200 font-semibold text-lg mb-4">🧬 Your Learning DNA</h3>
      {sessions.length === 0 ? (
        <p className="text-slate-400 text-sm">Complete your first session to discover your Learning DNA</p>
      ) : (
        <div className="flex flex-wrap gap-6 items-start">
          {/* Emoji + name */}
          <div className="flex flex-col items-center gap-2 min-w-[100px]">
            <span style={{ fontSize: 80, lineHeight: 1 }}>{dnaType.emoji}</span>
            <span
              className="font-extrabold text-base text-center bg-clip-text text-transparent"
              style={{ backgroundImage: `linear-gradient(90deg, ${dnaType.color}, #fff)` }}
            >
              {dnaType.name}
            </span>
          </div>
          {/* Details */}
          <div className="flex-1 min-w-[200px] space-y-4">
            <p className="text-slate-300 text-sm">{dnaType.desc}</p>
            <div>
              <span className="text-xs font-semibold uppercase tracking-widest text-slate-500 mr-2">Your Superpower:</span>
              <span
                className="text-xs font-bold px-3 py-1 rounded-full"
                style={{ background: dnaType.color + '30', color: dnaType.color, border: `1px solid ${dnaType.color}50` }}
              >
                {dnaType.superpower}
              </span>
            </div>
            <div className="space-y-2">
              <AnimatedTraitBar label="Speed" value={dnaType.traits.speed} color={dnaType.color} />
              <AnimatedTraitBar label="Consistency" value={dnaType.traits.consistency} color={dnaType.color} />
              <AnimatedTraitBar label="Depth" value={dnaType.traits.depth} color={dnaType.color} />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function LearningVelocitySection({ sessions }) {
  const velocityData = sessions.slice(-10).map((s, i) => ({
    session: `S${i + 1}`,
    score: s.score || 0,
    target: 70,
  }));

  return (
    <div className="bg-[#1E293B] border border-slate-700/50 rounded-2xl p-6 mb-6">
      <div className="flex items-center justify-between mb-1">
        <h3 className="text-slate-200 font-semibold text-lg">📈 Learning Velocity</h3>
      </div>
      <p className="text-slate-500 text-xs mb-4">Score per session — last 10 sessions</p>
      {sessions.length < 2 ? (
        <p className="text-slate-400 text-sm">Complete more sessions to see your velocity chart</p>
      ) : (
        <ResponsiveContainer width="100%" height={200}>
          <LineChart data={velocityData} margin={{ top: 5, right: 10, left: -30, bottom: 0 }}>
            <XAxis dataKey="session" tick={{ fill: '#64748B', fontSize: 11 }} axisLine={false} tickLine={false} />
            <YAxis domain={[0, 100]} hide />
            <Tooltip
              contentStyle={{ background: '#0F172A', border: '1px solid #334155', borderRadius: 8, fontSize: 12 }}
              labelStyle={{ color: '#94A3B8' }}
              itemStyle={{ color: '#CBD5E1' }}
            />
            <Line
              type="monotone"
              dataKey="score"
              name="Score"
              stroke="#6366F1"
              strokeWidth={2}
              dot={{ r: 3, fill: '#6366F1' }}
              activeDot={{ r: 5 }}
            />
            <Line
              type="monotone"
              dataKey="target"
              name="Target"
              stroke="#F59E0B"
              strokeWidth={1.5}
              strokeDasharray="5 5"
              dot={false}
            />
          </LineChart>
        </ResponsiveContainer>
      )}
    </div>
  );
}

export default function CareerTwin() {
  const navigate = useNavigate();
  const location = useLocation();
  const searchParams = new URLSearchParams(location.search);
  const moduleId = searchParams.get('moduleId');
  const assignmentId = searchParams.get('assignmentId');

  const { user } = useAuth();
  const [moduleContent, setModuleContent] = useState(null);
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState(null);
  const [forecast, setForecast] = useState(null);
  const [market, setMarket] = useState(null);
  const [error, setError] = useState('');

  // Module-aware state
  const [moduleContextData, setModuleContextData] = useState(null);
  const [assignmentData, setAssignmentData] = useState(null);
  const [moduleContextLoading, setModuleContextLoading] = useState(!!moduleId);

  // Fetch module + assignment when moduleId is in URL params
  useEffect(() => {
    if (!moduleId) return;
    const token = localStorage.getItem('auth_token');
    const headers = { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) };
    const fetches = [
      fetch(`${BASE_URL}/api/modules/${moduleId}`, { headers }).then(r => r.json()),
    ];
    if (assignmentId) {
      fetches.push(fetch(`${BASE_URL}/api/assignments/${assignmentId}`, { headers }).then(r => r.json()));
    }
    Promise.all(fetches)
      .then(([modJson, asnJson]) => {
        if (modJson?.success && modJson.data) setModuleContextData(modJson.data);
        if (asnJson?.success && asnJson.data) setAssignmentData(asnJson.data);
        else if (asnJson?.data) setAssignmentData(asnJson.data);
      })
      .catch(() => {})
      .finally(() => setModuleContextLoading(false));
  }, [moduleId, assignmentId]);

  useEffect(() => {
    const loadAssignedModule = async () => {
      if (!user || moduleId) return;
      try {
        const token = localStorage.getItem('auth_token');
        const res = await fetch('/api/assignments?userId=' + user.userId, {
          headers: { Authorization: `Bearer ${token}` }
        });
        const resData = await res.json();
        const assignments = resData.data?.assignments || resData.assignments || [];
        if (assignments.length > 0) {
          const modId = assignments[0].assignable_id;
          const modRes = await fetch(`/api/modules/${modId}`, {
            headers: { Authorization: `Bearer ${token}` }
          });
          const modData = await modRes.json();
          setModuleContent(modData.data?.content || {});
        }
      } catch (_) {}
    };
    loadAssignedModule();
  }, [user, moduleId]);

  useEffect(() => {
    const uid = localStorage.getItem('skillforge:userId');
    if (!uid) { setError('No active session. Complete goal setup first.'); setLoading(false); return; }

    const token = localStorage.getItem('auth_token');
    const authHeaders = token ? { Authorization: `Bearer ${token}` } : {};

    setError('');
    Promise.all([
      fetch(`/api/session/dashboard/${uid}`, { headers: authHeaders }).then(r => r.json()),
      fetch(`/api/simulation/forecast/${uid}`, { headers: authHeaders }).then(r => r.json()),
      fetch(`/api/market/intelligence/${uid}`, { headers: authHeaders }).then(r => r.json()),
    ]).then(([db, fc, mk]) => {
      if (db.success) setData(db.data);
      else setError(db.error?.message || db.error || 'Failed to load session data');
      if (fc.success) setForecast(fc.data);
      if (mk.success) setMarket(mk.data);
    }).catch(e => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  // Module context: show loading state then the module-specific twin
  if (moduleId && moduleContextLoading) {
    return (
      <div className="min-h-screen bg-[#0F172A] flex items-center justify-center">
        <div className="text-center">
          <div className="text-5xl mb-4 animate-pulse">🧬</div>
          <div className="text-indigo-400 font-semibold">Building Module Career Twin...</div>
          <div className="text-slate-500 text-sm mt-2">Loading module data...</div>
        </div>
      </div>
    );
  }

  if (moduleId) {
    return (
      <ModuleCareerTwin
        module={moduleContextData}
        assignment={assignmentData}
        navigate={navigate}
        moduleId={moduleId}
        assignmentId={assignmentId}
      />
    );
  }

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
  
  // Use module content from DB if available (from assigned module)
  const moduleSkills = moduleContent?.milestones || moduleContent?.skills || [];
  const radarData = forecast?.opportunityRadar || (moduleSkills.length > 0 
    ? moduleSkills.slice(0, 6).map((s, i) => ({
        skill: typeof s === 'string' ? s : s.name || s.title, 
        current: Math.min(100, (stats?.avgScore || 40) + i * 8), 
        target: 85, 
        marketDemand: 75, 
        gap: 85 - Math.min(100, (stats?.avgScore || 40) + i * 8),
      }))
    : skills.slice(0, 6).map(s => ({
        skill: s.name, current: s.mastery || 0, target: 85, marketDemand: 75, gap: 85 - (s.mastery || 0),
      }))
  );

  const masteryScore = stats?.avgScore || 0;
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

        {/* Employee-only: Learning DNA + Velocity */}
        {user?.role === 'employee' && (() => {
          const userId = localStorage.getItem('skillforge:userId');
          const stored = userId ? JSON.parse(localStorage.getItem(`sf_data_${userId}`) || '{}') : {};
          const localSessions = stored.sessions || [];
          return (
            <>
              <LearningDNASection sessions={localSessions} />
              <LearningVelocitySection sessions={localSessions} />
            </>
          );
        })()}

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
