/**
 * Analytics.jsx — Employee Learning Analytics
 * Personal performance view: progress, scores, skill breakdown, activity
 */

import React, { useEffect, useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell,
  PieChart, Pie, Legend,
  LineChart, Line,
  RadialBarChart, RadialBar,
} from 'recharts';
import { authFetch } from '../../utils/authFetch.js';

const COLORS = {
  indigo : '#6366f1',
  emerald: '#10b981',
  amber  : '#f59e0b',
  rose   : '#f43f5e',
  violet : '#8b5cf6',
  cyan   : '#06b6d4',
};

const customTooltipStyle = {
  backgroundColor: '#1e293b',
  border: '1px solid rgba(99,102,241,0.3)',
  borderRadius: '10px',
  fontSize: '12px',
  color: '#f8fafc',
};

const KpiCard = ({ label, value, sub, color, icon }) => (
  <div className="rounded-2xl border border-slate-700/40 bg-slate-800/30 p-4">
    <div className="flex items-center justify-between mb-2">
      <span className="text-xl">{icon}</span>
      <span className="text-xs font-bold uppercase tracking-widest text-slate-500">{label}</span>
    </div>
    <p className="text-3xl font-black" style={{ color }}>{value ?? '—'}</p>
    {sub && <p className="text-xs text-slate-500 mt-1">{sub}</p>}
  </div>
);

const ChartCard = ({ title, subtitle, children, loading, className = '' }) => (
  <div className={`rounded-2xl border border-slate-700/40 bg-slate-900/60 backdrop-blur-sm p-5 ${className}`}>
    <div className="mb-4">
      <h3 className="text-sm font-black text-white">{title}</h3>
      {subtitle && <p className="text-xs text-slate-500 mt-0.5">{subtitle}</p>}
    </div>
    {loading ? (
      <div className="h-44 rounded-xl bg-slate-800/40 animate-pulse" />
    ) : children}
  </div>
);

export default function Analytics() {
  const { user } = useAuth();
  const navigate = useNavigate();

  const [loading, setLoading]           = useState(true);
  const [assignments, setAssignments]   = useState([]);
  const [dashStats, setDashStats]       = useState(null);
  const [assessments, setAssessments]   = useState([]);

  const userId = user?.userId || user?.id;

  useEffect(() => {
    if (!user) return;
    if (user.role !== 'employee') { navigate('/dashboard'); return; }
    loadAll();
  }, [user]);

  const loadAll = async () => {
    setLoading(true);
    try {
      const [asgn, stats, asmt] = await Promise.allSettled([
        authFetch(`/api/assignments?userId=${userId}`),
        authFetch('/api/assignments/dashboard'),
        authFetch('/api/assessments/my'),
      ]);
      if (asgn.status  === 'fulfilled') setAssignments(Array.isArray(asgn.value)  ? asgn.value  : (asgn.value?.assignments || []));
      if (stats.status === 'fulfilled') setDashStats(stats.value);
      if (asmt.status  === 'fulfilled') setAssessments(Array.isArray(asmt.value)  ? asmt.value  : (asmt.value?.assessments || []));
    } catch { /* fail silently */ }
    finally { setLoading(false); }
  };

  // ── Derived data ──────────────────────────────────────────────────────────────

  const statusBreakdown = useMemo(() => {
    const counts = { assigned: 0, in_progress: 0, completed: 0, overdue: 0 };
    assignments.forEach(a => { if (counts[a.status] !== undefined) counts[a.status]++; });
    return [
      { name: 'Assigned',    value: counts.assigned,    color: COLORS.indigo  },
      { name: 'In Progress', value: counts.in_progress, color: COLORS.amber   },
      { name: 'Completed',   value: counts.completed,   color: COLORS.emerald },
      { name: 'Overdue',     value: counts.overdue,     color: COLORS.rose    },
    ].filter(d => d.value > 0);
  }, [assignments]);

  const typeBreakdown = useMemo(() => {
    const counts = {};
    assignments.forEach(a => {
      const t = a.type || 'module';
      counts[t] = (counts[t] || 0) + 1;
    });
    return Object.entries(counts).map(([name, value], i) => ({
      name: name.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase()),
      value,
    }));
  }, [assignments]);

  const progressData = useMemo(() => {
    return assignments
      .filter(a => a.status !== 'cancelled')
      .sort((a, b) => (b.progress || 0) - (a.progress || 0))
      .slice(0, 8)
      .map(a => ({
        name  : (a.module_name || a.title || 'Module').slice(0, 20),
        progress: a.progress || 0,
        color : (a.progress || 0) >= 75 ? COLORS.emerald
              : (a.progress || 0) >= 50 ? COLORS.indigo
              : (a.progress || 0) >= 25 ? COLORS.amber
              : COLORS.rose,
      }));
  }, [assignments]);

  const assessmentScores = useMemo(() => {
    return assessments
      .filter(a => a.submission?.scoring?.score != null || a.scoring?.score != null || a.score != null)
      .slice(-8)
      .map((a, i) => ({
        name : (a.title || `Test ${i + 1}`).slice(0, 18),
        score: Math.round(a.submission?.scoring?.score ?? a.scoring?.score ?? a.score ?? 0),
      }));
  }, [assessments]);

  const streakData = useMemo(() => {
    // Show last 7 days activity gauge from streak
    const streak = dashStats?.streak || 0;
    return [{ name: 'Streak', value: Math.min(streak, 7), fill: COLORS.amber }];
  }, [dashStats]);

  const completionRate = assignments.length > 0
    ? Math.round((assignments.filter(a => a.status === 'completed').length / assignments.length) * 100)
    : 0;

  const submittedAssessments = assessments.filter(a => a.status === 'submitted' || a.status === 'completed');
  const avgAssessmentScore = submittedAssessments.length > 0
    ? Math.round(submittedAssessments.reduce((s, a) => s + (a.submission?.scoring?.score ?? a.scoring?.score ?? a.score ?? 0), 0) / submittedAssessments.length)
    : null;

  return (
    <div className="min-h-screen bg-[#0F172A] text-white">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">

        {/* Header */}
        <div className="flex items-center gap-4 mb-8">
          <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-indigo-500/30 to-cyan-500/20 border border-indigo-500/30 flex items-center justify-center text-2xl">
            📊
          </div>
          <div>
            <h1 className="text-3xl font-black text-white tracking-tight">My Learning Analytics</h1>
            <p className="text-slate-400 text-sm mt-0.5">
              {user?.name || 'You'} · {new Date().toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}
            </p>
          </div>
          <div className="ml-auto flex gap-2">
            <button
              onClick={loadAll}
              className="px-4 py-2 rounded-xl bg-slate-800/60 border border-slate-700/50 text-slate-400 hover:text-white hover:border-slate-600 text-sm font-bold transition-all"
            >
              ↺ Refresh
            </button>
            <button
              onClick={() => window.print()}
              className="px-4 py-2 rounded-xl bg-slate-800/60 border border-slate-700/50 text-slate-400 hover:text-white hover:border-slate-600 text-sm font-bold transition-all"
            >
              🖨️ Export PDF
            </button>
          </div>
        </div>

        {/* KPI Row */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
          <KpiCard
            label="Completion"
            value={loading ? '—' : `${completionRate}%`}
            color={completionRate >= 70 ? COLORS.emerald : COLORS.amber}
            icon="✅"
            sub={`${assignments.filter(a => a.status === 'completed').length} of ${assignments.length} modules`}
          />
          <KpiCard
            label="Avg Score"
            value={loading ? '—' : dashStats?.avgScore != null ? `${dashStats.avgScore}%` : avgAssessmentScore != null ? `${avgAssessmentScore}%` : 'N/A'}
            color={COLORS.indigo}
            icon="🎯"
            sub={dashStats?.bestScore != null ? `Best: ${dashStats.bestScore}%` : 'Complete sessions to see'}
          />
          <KpiCard
            label="Streak"
            value={loading ? '—' : `${dashStats?.streak || 0}d`}
            color={COLORS.amber}
            icon="🔥"
            sub="consecutive active days"
          />
          <KpiCard
            label="Assessments"
            value={loading ? '—' : submittedAssessments.length}
            color={COLORS.violet}
            icon="📝"
            sub={`of ${assessments.length} assigned`}
          />
        </div>

        {/* Charts Grid */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">

          {/* Chart 1: Assignment Status Breakdown */}
          <ChartCard title="Assignment Status" subtitle="Your current module completion breakdown" loading={loading}>
            {statusBreakdown.length > 0 ? (
              <ResponsiveContainer width="100%" height={200}>
                <PieChart>
                  <Pie data={statusBreakdown} cx="50%" cy="50%" innerRadius={50} outerRadius={80} paddingAngle={3} dataKey="value">
                    {statusBreakdown.map((entry, i) => <Cell key={entry.name} fill={entry.color} opacity={0.85} />)}
                  </Pie>
                  <Tooltip contentStyle={customTooltipStyle} />
                  <Legend formatter={(v) => <span className="text-xs text-slate-300">{v}</span>} iconType="circle" iconSize={8} />
                </PieChart>
              </ResponsiveContainer>
            ) : (
              <div className="h-44 flex items-center justify-center text-slate-600 text-sm">No assignments yet</div>
            )}
          </ChartCard>

          {/* Chart 2: Module Progress Bar */}
          <ChartCard title="Module Progress" subtitle="Top modules by completion %" loading={loading}>
            {progressData.length > 0 ? (
              <ResponsiveContainer width="100%" height={200}>
                <BarChart data={progressData} layout="vertical" margin={{ top: 0, right: 30, bottom: 0, left: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" horizontal={false} />
                  <XAxis type="number" domain={[0, 100]} tick={{ fill: '#64748b', fontSize: 10 }} axisLine={false} tickLine={false} unit="%" />
                  <YAxis type="category" dataKey="name" tick={{ fill: '#94a3b8', fontSize: 10 }} axisLine={false} tickLine={false} width={90} />
                  <Tooltip contentStyle={customTooltipStyle} formatter={(v) => [`${v}%`, 'Progress']} />
                  <Bar dataKey="progress" radius={[0, 4, 4, 0]}>
                    {progressData.map((entry, i) => <Cell key={i} fill={entry.color} />)}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <div className="h-44 flex items-center justify-center text-slate-600 text-sm">No modules assigned yet</div>
            )}
          </ChartCard>

          {/* Chart 3: Assessment Score Trend */}
          <ChartCard title="Assessment Scores" subtitle="Your most recent test results" loading={loading}>
            {assessmentScores.length > 0 ? (
              <ResponsiveContainer width="100%" height={200}>
                <BarChart data={assessmentScores} margin={{ top: 5, right: 10, bottom: 30, left: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                  <XAxis
                    dataKey="name"
                    tick={{ fill: '#94a3b8', fontSize: 9 }}
                    axisLine={false}
                    tickLine={false}
                    angle={-35}
                    textAnchor="end"
                    interval={0}
                  />
                  <YAxis domain={[0, 100]} tick={{ fill: '#64748b', fontSize: 10 }} axisLine={false} tickLine={false} unit="%" />
                  <Tooltip contentStyle={customTooltipStyle} formatter={(v) => [`${v}%`, 'Score']} />
                  <Bar dataKey="score" name="Score" radius={[6, 6, 0, 0]}>
                    {assessmentScores.map((entry, i) => (
                      <Cell key={i} fill={entry.score >= 80 ? COLORS.emerald : entry.score >= 60 ? COLORS.indigo : COLORS.rose} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <div className="h-44 flex flex-col items-center justify-center gap-2">
                <span className="text-slate-600 text-sm">No submitted assessments yet</span>
                <span className="text-xs text-slate-700">Complete assessments to track your scores</span>
              </div>
            )}
          </ChartCard>

          {/* Chart 4: Content Type Distribution */}
          <ChartCard title="Learning Mix" subtitle="Types of content assigned to you" loading={loading}>
            {typeBreakdown.length > 0 ? (
              <ResponsiveContainer width="100%" height={200}>
                <BarChart data={typeBreakdown} margin={{ top: 5, right: 10, bottom: 5, left: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                  <XAxis dataKey="name" tick={{ fill: '#94a3b8', fontSize: 11 }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fill: '#64748b', fontSize: 10 }} axisLine={false} tickLine={false} />
                  <Tooltip contentStyle={customTooltipStyle} cursor={{ fill: 'rgba(99,102,241,0.1)' }} />
                  <Bar dataKey="value" name="Count" radius={[6, 6, 0, 0]}>
                    {typeBreakdown.map((_, i) => (
                      <Cell key={i} fill={[COLORS.indigo, COLORS.violet, COLORS.cyan, COLORS.emerald][i % 4]} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <div className="h-44 flex items-center justify-center text-slate-600 text-sm">No data yet</div>
            )}
          </ChartCard>

        </div>

        {/* Summary Stats Footer */}
        {!loading && (
          <div className="mt-6 grid grid-cols-2 sm:grid-cols-4 gap-3">
            {[
              { label: 'Total Sessions', value: dashStats?.totalSessions || 0, color: COLORS.indigo },
              { label: 'Active Days',    value: dashStats?.streak || 0,        color: COLORS.amber  },
              { label: 'Best Score',     value: dashStats?.bestScore != null ? `${dashStats.bestScore}%` : 'N/A', color: COLORS.emerald },
              { label: 'Overdue',        value: assignments.filter(a => a.status === 'overdue').length, color: COLORS.rose },
            ].map(item => (
              <div key={item.label} className="rounded-xl bg-slate-800/40 border border-slate-700/30 p-3">
                <p className="text-xs font-bold text-slate-500 uppercase tracking-widest mb-1">{item.label}</p>
                <p className="text-xl font-black" style={{ color: item.color }}>{item.value}</p>
              </div>
            ))}
          </div>
        )}

        {/* CTA */}
        <div className="mt-6 rounded-2xl border border-indigo-500/20 bg-gradient-to-r from-indigo-500/5 to-violet-500/5 p-5 flex items-center justify-between gap-4">
          <div>
            <p className="text-sm font-bold text-white">Ready to boost your score?</p>
            <p className="text-xs text-slate-500 mt-0.5">Start a learning session or take a challenge to track your progress here.</p>
          </div>
          <button
            onClick={() => navigate('/dashboard')}
            className="flex-shrink-0 px-5 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-bold transition-all"
          >
            Go to My Learning →
          </button>
        </div>

      </div>
    </div>
  );
}
