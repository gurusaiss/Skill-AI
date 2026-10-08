/**
 * Analytics.jsx — Employee Learning Analytics
 * Personal performance view: progress, scores, skill breakdown, activity
 */

import React, { useEffect, useState, useMemo } from 'react';
import PageContainer from '../../components/PageContainer.jsx';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell,
  PieChart, Pie, Legend,
  LineChart, Line,
  RadialBarChart, RadialBar,
} from 'recharts';
import { authFetch } from '../../utils/authFetch.js';
import StatCard from '../../components/StatCard.jsx';
import { ratingFromPercent, ratingStyle } from '../../utils/assessmentRules.js';

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

const KpiCard = ({ label, value, sub, color, icon, description, tooltip }) => (
  <StatCard
    label={label}
    value={<span style={{ color }}>{value ?? '—'}</span>}
    icon={icon}
    sub={sub}
    description={description}
    tooltip={tooltip}
    borderClass="border-slate-700/40"
    bgClass="bg-slate-800/30"
    textClass="text-slate-400"
    className="rounded-2xl"
  />
);

const ChartCard = ({ title, subtitle, children, loading, className = '' }) => (
  <div className={`rounded-2xl border border-slate-700/40 bg-slate-900/60 backdrop-blur-sm p-5 ${className}`}>
    <div className="mb-4">
      <h3 className="text-sm font-black text-white">{title}</h3>
      {subtitle && <p className="text-xs text-slate-400 mt-0.5">{subtitle}</p>}
    </div>
    {loading ? (
      <div className="h-44 rounded-xl bg-slate-800/40 animate-pulse" />
    ) : children}
  </div>
);

export default function Analytics() {
  const { user, hasRole } = useAuth();
  const navigate = useNavigate();

  const [loading, setLoading]           = useState(true);
  const [assignments, setAssignments]   = useState([]);
  const [assessments, setAssessments]   = useState([]);
  const [loadError, setLoadError]       = useState('');

  const userId = user?.userId || user?.id;

  useEffect(() => {
    if (!user) return;
    if (!hasRole('employee')) { navigate('/dashboard'); return; }
    loadAll();
  }, [user]);

  const loadAll = async () => {
    setLoading(true);
    setLoadError('');
    try {
      const [asgn, asmt] = await Promise.allSettled([
        authFetch(`/api/assignments?userId=${userId}`),
        authFetch('/api/assessments/my?light=1'),
      ]);
      if (asgn.status  === 'fulfilled') setAssignments(Array.isArray(asgn.value)  ? asgn.value  : (asgn.value?.assignments || []));
      if (asmt.status  === 'fulfilled') setAssessments(Array.isArray(asmt.value)  ? asmt.value  : (asmt.value?.assessments || []));
      if (asgn.status === 'rejected' && asmt.status === 'rejected') setLoadError(asgn.reason?.message || 'Could not load your analytics.');
    } catch (e) { setLoadError(e?.message || 'Could not load your analytics.'); }
    finally { setLoading(false); }
  };

  // ── Derived data ──────────────────────────────────────────────────────────────

  // Cancelled assignments are excluded from every figure on this page.
  const liveAssignments = useMemo(() => assignments.filter(a => a.status !== 'cancelled'), [assignments]);
  const isOverdue = (a) => a.status !== 'completed' && a.status !== 'cancelled' && a.due_date && new Date(a.due_date).getTime() < Date.now();
  const overdueCount = liveAssignments.filter(isOverdue).length;
  const completedCount = liveAssignments.filter(a => a.status === 'completed').length;

  const statusBreakdown = useMemo(() => {
    // Mutually exclusive buckets: a past-due unfinished module counts as Overdue only.
    const counts = { assigned: 0, in_progress: 0, completed: 0, overdue: 0 };
    liveAssignments.forEach(a => {
      if (a.status !== 'completed' && a.due_date && new Date(a.due_date).getTime() < Date.now()) counts.overdue++;
      else if (counts[a.status] !== undefined) counts[a.status]++;
    });
    return [
      { name: 'Assigned',    value: counts.assigned,    color: COLORS.indigo  },
      { name: 'In Progress', value: counts.in_progress, color: COLORS.amber   },
      { name: 'Completed',   value: counts.completed,   color: COLORS.emerald },
      { name: 'Overdue',     value: counts.overdue,     color: COLORS.rose    },
    ].filter(d => d.value > 0);
  }, [liveAssignments]);

  const typeBreakdown = useMemo(() => {
    const counts = {};
    liveAssignments.forEach(a => {
      const t = a.type || 'module';
      counts[t] = (counts[t] || 0) + 1;
    });
    return Object.entries(counts).map(([name, value], i) => ({
      name: name.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase()),
      value,
    }));
  }, [liveAssignments]);

  const progressOf = (a) => (a.status === 'completed' ? 100 : Math.min(100, Math.max(0, Number(a.progress) || 0)));

  const progressData = useMemo(() => {
    return [...liveAssignments]
      .sort((a, b) => progressOf(b) - progressOf(a))
      .slice(0, 8)
      .map(a => ({
        name  : (a.module_name || a.title || 'Module').slice(0, 20),
        progress: progressOf(a),
        color : progressOf(a) >= 75 ? COLORS.emerald
              : progressOf(a) >= 50 ? COLORS.indigo
              : progressOf(a) >= 25 ? COLORS.amber
              : COLORS.rose,
      }));
  }, [liveAssignments]);

  const scoreOf = (a) => {
    const v = a.submission?.scoring?.rawScore ?? a.submission?.scoring?.score ?? a.scoring?.rawScore ?? a.scoring?.score ?? a.score ?? null;
    const n = Number(v);
    return v == null || !Number.isFinite(n) ? null : n;
  };

  const assessmentScores = useMemo(() => {
    return assessments
      .filter(a => scoreOf(a) != null)
      .slice(-8)
      .map((a, i) => ({
        name : (a.title || `Test ${i + 1}`).slice(0, 18),
        score: Math.round(scoreOf(a)),
        // Rating band from the exact (unrounded) score, the same scale every
        // other view and export uses.
        rating: ratingFromPercent(scoreOf(a)),
      }));
  }, [assessments]);

  // Completion = completed / non-cancelled assignments.
  const completionRate = liveAssignments.length > 0
    ? Math.round((completedCount / liveAssignments.length) * 100)
    : 0;

  const submittedAssessments = assessments.filter(a => a.status === 'submitted' || a.status === 'completed');
  const scoredSubmissions = submittedAssessments.map(scoreOf).filter(n => n != null);
  const avgAssessmentScore = scoredSubmissions.length > 0
    ? Math.round(scoredSubmissions.reduce((s, n) => s + n, 0) / scoredSubmissions.length)
    : null;
  const bestScore = scoredSubmissions.length > 0 ? Math.round(Math.max(...scoredSubmissions)) : null;

  // Learning sessions finished, taken from the assignments' saved session data.
  const totalSessions = liveAssignments.reduce((sum, a) => {
    const reports = a.progress_data?.sessionReports;
    if (Array.isArray(reports)) return sum + reports.length;
    const sp = a.session_progress;
    if (Array.isArray(sp)) return sum + sp.length;
    if (sp && typeof sp === 'object') return sum + (Number(sp.completedSessions) || (Array.isArray(sp.sessionReports) ? sp.sessionReports.length : 0));
    return sum;
  }, 0);

  // Activity days: distinct calendar days with an assignment update or an assessment submission.
  const { activeDays30, streak } = useMemo(() => {
    const dayKey = (d) => `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
    const days = new Set();
    const add = (v) => { if (!v) return; const d = new Date(v); if (!isNaN(d.getTime())) days.add(dayKey(d)); };
    liveAssignments.forEach(a => { if (a.status !== 'assigned') add(a.updated_at); });
    assessments.forEach(a => add(a.submission?.submittedAt || a.submittedAt));
    const now = new Date();
    let count30 = 0;
    for (let i = 0; i < 30; i++) {
      const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - i);
      if (days.has(dayKey(d))) count30++;
    }
    let run = 0;
    for (let i = 0; i < 365; i++) {
      const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - i);
      if (days.has(dayKey(d))) run++;
      else if (i === 0) continue; // today may not have activity yet — don't break the streak
      else break;
    }
    return { activeDays30: count30, streak: run };
  }, [liveAssignments, assessments]);

  return (
    <div className="min-h-screen bg-[#0F172A] text-white">
      <PageContainer>

        {/* Header */}
        <div className="flex flex-wrap items-center gap-4 mb-6">
          <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-indigo-500/30 to-cyan-500/20 border border-indigo-500/30 flex items-center justify-center text-2xl">
            📊
          </div>
          <div>
            <h1 className="text-3xl font-black text-white tracking-tight">My Learning Analytics</h1>
            <p className="text-slate-400 text-sm sm:text-base mt-0.5">
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

        {loadError && !loading && (
          <div role="alert" className="mb-6 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-red-500/40 bg-red-500/10 px-5 py-4">
            <p className="text-sm text-red-200">{loadError}</p>
            <button type="button" onClick={loadAll} className="px-4 py-2 rounded-xl bg-red-500/20 border border-red-500/40 text-red-100 hover:bg-red-500/30 text-sm font-bold">Retry</button>
          </div>
        )}

        {/* KPI Row */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
          <KpiCard
            label="Completion"
            value={loading ? '—' : liveAssignments.length > 0 ? `${completionRate}%` : '—'}
            color={completionRate >= 70 ? COLORS.emerald : COLORS.amber}
            icon="✅"
            sub={`${completedCount} of ${liveAssignments.length} modules`}
            description="How many of your modules you have finished"
            tooltip="Completed modules divided by all your non-cancelled modules."
          />
          <KpiCard
            label="Avg Score"
            value={loading ? '—' : avgAssessmentScore != null ? `${avgAssessmentScore}%` : 'N/A'}
            color={COLORS.indigo}
            icon="🎯"
            sub={bestScore != null ? `Best: ${bestScore}%` : 'Submit an assessment to see'}
            description="Your average assessment result"
            tooltip="Mean score of the assessments you have submitted. Shows N/A until you submit one."
          />
          <KpiCard
            label="Streak"
            value={loading ? '—' : `${streak}d`}
            color={COLORS.amber}
            icon="🔥"
            sub="consecutive active days"
            description="Days in a row you were active"
            tooltip="Consecutive days, ending today (or yesterday if you have not been active yet today), on which you updated a module or submitted an assessment."
          />
          <KpiCard
            label="Assessments"
            value={loading ? '—' : submittedAssessments.length}
            color={COLORS.violet}
            icon="📝"
            sub={`of ${assessments.length} assigned`}
            description="Assessments you have submitted"
            tooltip="Number of your assigned assessments with a submission, out of all assessments assigned to you."
          />
        </div>

        {/* Charts Grid */}
        <div className="grid grid-cols-1 xl:grid-cols-2 2xl:grid-cols-4 gap-4 sm:gap-6">

          {/* Chart 1: Assignment Status Breakdown */}
          <ChartCard title="Assignment Status" subtitle="Your current module completion breakdown" loading={loading}>
            {statusBreakdown.length > 0 ? (
              <ResponsiveContainer width="100%" height={260}>
                <PieChart>
                  <Pie data={statusBreakdown} cx="50%" cy="50%" innerRadius={50} outerRadius={80} paddingAngle={3} dataKey="value">
                    {statusBreakdown.map((entry, i) => <Cell key={entry.name} fill={entry.color} opacity={0.85} />)}
                  </Pie>
                  <Tooltip contentStyle={customTooltipStyle} />
                  <Legend formatter={(v) => <span className="text-xs text-slate-300">{v}</span>} iconType="circle" iconSize={8} />
                </PieChart>
              </ResponsiveContainer>
            ) : (
              <div className="h-44 flex items-center justify-center text-slate-400 text-sm">No assignments yet</div>
            )}
          </ChartCard>

          {/* Chart 2: Module Progress Bar */}
          <ChartCard title="Module Progress" subtitle="Top modules by completion %" loading={loading}>
            {progressData.length > 0 ? (
              <ResponsiveContainer width="100%" height={260}>
                <BarChart data={progressData} layout="vertical" margin={{ top: 0, right: 30, bottom: 0, left: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" horizontal={false} />
                  <XAxis type="number" domain={[0, 100]} tick={{ fill: '#64748b', fontSize: 12 }} axisLine={false} tickLine={false} unit="%" />
                  <YAxis type="category" dataKey="name" tick={{ fill: '#94a3b8', fontSize: 12 }} axisLine={false} tickLine={false} width={90} />
                  <Tooltip contentStyle={customTooltipStyle} formatter={(v) => [`${v}%`, 'Progress']} />
                  <Bar dataKey="progress" radius={[0, 4, 4, 0]}>
                    {progressData.map((entry, i) => <Cell key={i} fill={entry.color} />)}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <div className="h-44 flex items-center justify-center text-slate-400 text-sm">No modules assigned yet</div>
            )}
          </ChartCard>

          {/* Chart 3: Assessment Score Trend */}
          <ChartCard title="Assessment Scores" subtitle="Your most recent test results" loading={loading}>
            {assessmentScores.length > 0 ? (
              <ResponsiveContainer width="100%" height={260}>
                <BarChart data={assessmentScores} margin={{ top: 5, right: 10, bottom: 30, left: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                  <XAxis
                    dataKey="name"
                    tick={{ fill: '#94a3b8', fontSize: 12 }}
                    axisLine={false}
                    tickLine={false}
                    angle={-35}
                    textAnchor="end"
                    interval={0}
                  />
                  <YAxis domain={[0, 100]} tick={{ fill: '#64748b', fontSize: 12 }} axisLine={false} tickLine={false} unit="%" />
                  <Tooltip contentStyle={customTooltipStyle} formatter={(v, _n, item) => [`${v}%  (${item?.payload?.rating || ''})`, 'Score']} />
                  <Bar dataKey="score" name="Score" radius={[6, 6, 0, 0]}>
                    {assessmentScores.map((entry, i) => (
                      <Cell key={i} fill={ratingStyle(entry.rating).hex} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <div className="h-44 flex flex-col items-center justify-center gap-2">
                <span className="text-slate-400 text-sm">No submitted assessments yet</span>
                <span className="text-xs text-slate-400">Complete assessments to track your scores</span>
              </div>
            )}
          </ChartCard>

          {/* Chart 4: Content Type Distribution */}
          <ChartCard title="Learning Mix" subtitle="Types of content assigned to you" loading={loading}>
            {typeBreakdown.length > 0 ? (
              <ResponsiveContainer width="100%" height={260}>
                <BarChart data={typeBreakdown} margin={{ top: 5, right: 10, bottom: 5, left: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                  <XAxis dataKey="name" tick={{ fill: '#94a3b8', fontSize: 12 }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fill: '#64748b', fontSize: 12 }} axisLine={false} tickLine={false} />
                  <Tooltip contentStyle={customTooltipStyle} cursor={{ fill: 'rgba(99,102,241,0.1)' }} />
                  <Bar dataKey="value" name="Count" radius={[6, 6, 0, 0]}>
                    {typeBreakdown.map((_, i) => (
                      <Cell key={i} fill={[COLORS.indigo, COLORS.violet, COLORS.cyan, COLORS.emerald][i % 4]} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <div className="h-44 flex items-center justify-center text-slate-400 text-sm">No data yet</div>
            )}
          </ChartCard>

        </div>

        {/* Summary Stats Footer */}
        {!loading && (
          <div className="mt-6 grid grid-cols-2 sm:grid-cols-4 gap-3">
            {[
              { label: 'Total Sessions', value: totalSessions, color: COLORS.indigo, description: 'Learning sessions you finished', tooltip: 'Sessions completed across your modules, counted from the session reports saved on your assignments.' },
              { label: 'Active Days',    value: activeDays30,  color: COLORS.amber, description: 'Days active in the last 30', tooltip: 'Number of distinct days in the last 30 days on which you updated a module or submitted an assessment.' },
              { label: 'Best Score',     value: bestScore != null ? `${bestScore}%` : 'N/A', color: COLORS.emerald, description: 'Your highest assessment score', tooltip: 'Highest score among your submitted assessments.' },
              { label: 'Overdue',        value: overdueCount, color: COLORS.rose, description: 'Modules past their due date', tooltip: 'Modules whose due date has passed and that are not completed or cancelled.' },
            ].map(item => (
              <StatCard key={item.label} label={item.label} value={<span style={{ color: item.color }}>{item.value}</span>}
                description={item.description} tooltip={item.tooltip}
                borderClass="border-slate-700/30" bgClass="bg-slate-800/40" textClass="text-slate-400" />
            ))}
          </div>
        )}

        {/* CTA */}
        <div className="mt-6 rounded-2xl border border-indigo-500/20 bg-gradient-to-r from-indigo-500/5 to-violet-500/5 p-5 flex items-center justify-between gap-4">
          <div>
            <p className="text-sm font-bold text-white">Ready to boost your score?</p>
            <p className="text-sm text-slate-400 mt-0.5">Start a learning session or take a challenge to track your progress here.</p>
          </div>
          <button
            onClick={() => navigate('/dashboard')}
            className="flex-shrink-0 px-5 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-bold transition-all"
          >
            Go to My Learning →
          </button>
        </div>

      </PageContainer>
    </div>
  );
}
