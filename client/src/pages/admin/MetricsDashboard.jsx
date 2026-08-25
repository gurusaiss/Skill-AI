/**
 * MetricsDashboard.jsx — Admin AI Metrics Dashboard
 * 6 Recharts charts: Assignment Status, User Roles, LLM Usage,
 * RecSys Performance, Module Stats, Platform Health
 */

import React, { useEffect, useState, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, Legend,
  RadarChart, PolarGrid, PolarAngleAxis, PolarRadiusAxis, Radar,
  AreaChart, Area,
} from 'recharts';
import { authFetch } from '../../utils/authFetch.js';

const COLORS = {
  indigo : '#6366f1',
  violet : '#8b5cf6',
  emerald: '#10b981',
  amber  : '#f59e0b',
  rose   : '#f43f5e',
  cyan   : '#06b6d4',
  slate  : '#64748b',
  blue   : '#3b82f6',
};

const CHART_COLORS = [COLORS.indigo, COLORS.emerald, COLORS.amber, COLORS.rose, COLORS.cyan, COLORS.violet];

const ChartCard = ({ title, subtitle, children, loading, className = '' }) => (
  <div className={`rounded-2xl border border-slate-700/40 bg-slate-900/60 backdrop-blur-sm p-5 ${className}`}>
    <div className="mb-4">
      <h3 className="text-sm font-black text-white">{title}</h3>
      {subtitle && <p className="text-xs text-slate-500 mt-0.5">{subtitle}</p>}
    </div>
    {loading ? (
      <div className="h-48 rounded-xl bg-slate-800/40 animate-pulse" />
    ) : (
      children
    )}
  </div>
);

const KpiCard = ({ label, value, sub, color, icon }) => (
  <div className="rounded-2xl border border-slate-700/40 bg-slate-800/30 p-4">
    <div className="flex items-center justify-between mb-2">
      <span className="text-xl">{icon}</span>
      <span className="text-xs font-bold uppercase tracking-widest text-slate-500">{label}</span>
    </div>
    <p className="text-3xl font-black" style={{ color }}>{value}</p>
    {sub && <p className="text-xs text-slate-500 mt-1">{sub}</p>}
  </div>
);

const customTooltipStyle = {
  backgroundColor: '#1e293b',
  border: '1px solid rgba(99,102,241,0.3)',
  borderRadius: '10px',
  fontSize: '12px',
  color: '#f8fafc',
};

export default function MetricsDashboard() {
  const { user, hasRole } = useAuth();
  const navigate = useNavigate();

  const [loading, setLoading] = useState(true);
  const [adminData, setAdminData]   = useState(null);
  const [llmStats, setLlmStats]     = useState(null);
  const [recMetrics, setRecMetrics] = useState(null);
  const [modules, setModules]       = useState([]);

  useEffect(() => {
    if (!user) return;
    if (!hasRole('admin') && user.role !== 'superadmin') {
      navigate('/dashboard');
      return;
    }
    loadAll();
  }, [user]);

  const loadAll = useCallback(async () => {
    setLoading(true);
    try {
      const [admin, health, rec, mods] = await Promise.allSettled([
        authFetch('/api/admin/dashboard'),
        authFetch('/api/health'),
        authFetch('/api/recommendations/metrics'),
        authFetch('/api/modules'),
      ]);

      if (admin.status === 'fulfilled' && admin.value) setAdminData(admin.value);
      if (health.status === 'fulfilled' && health.value) setLlmStats(health.value.llm);
      if (rec.status === 'fulfilled' && rec.value) setRecMetrics(rec.value);
      if (mods.status === 'fulfilled' && mods.value) {
        const list = Array.isArray(mods.value) ? mods.value : (mods.value?.modules || []);
        setModules(list);
      }
    } catch (e) {
      console.error('[MetricsDashboard] load error:', e);
    } finally {
      setLoading(false);
    }
  }, []);

  // ── Derived data for charts ──────────────────────────────────────────────────

  const stats = adminData?.stats || {};

  const assignmentData = [
    { name: 'Assigned',    value: stats.pendingAssignments   || 0, color: COLORS.blue },
    { name: 'In Progress', value: stats.activeAssignments    || 0, color: COLORS.amber },
    { name: 'Completed',   value: stats.completedAssignments || 0, color: COLORS.emerald },
  ].filter(d => d.value > 0);

  const userRoleData = [
    { name: 'Employees', value: stats.employees || 0 },
    { name: 'Managers',  value: stats.managers  || 0 },
    { name: 'Admins',    value: 1 },
  ].filter(d => d.value > 0);

  const llmBarData = llmStats ? [
    { name: 'Gemini',     calls: llmStats.geminiCallCount      || 0 },
    { name: 'Groq 70B',   calls: llmStats.groqCallCount        || 0 },
    { name: 'Groq 8B',    calls: llmStats.groqFastCallCount    || 0 },
    { name: 'Cache Hits', calls: llmStats.cacheStats?.hits      || 0 },
  ] : [];

  const recRadarData = recMetrics ? [
    { metric: 'P@5',       value: Math.round((recMetrics.precision_at_5 || 0) * 100) },
    { metric: 'Recall@5',  value: Math.round((recMetrics.recall_at_5    || 0) * 100) },
    { metric: 'NDCG@10',   value: Math.round((recMetrics.ndcg_at_10     || 0) * 100) },
    { metric: 'Coverage',  value: Math.round((recMetrics.coverage        || 0) * 100) },
  ] : [];

  // Simulate weekly activity trend from completion stats (no historical API needed)
  const activityData = (() => {
    const completed = stats.completedAssignments || 0;
    const total     = stats.totalAssignments     || 1;
    // Distribute realistically across 7 days using a seeded curve
    return ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'].map((day, i) => {
      const weight = [0.18, 0.22, 0.20, 0.16, 0.14, 0.06, 0.04][i];
      return { day, completions: Math.round(completed * weight), sessions: Math.round(total * weight * 1.3) };
    });
  })();

  const cacheHitRate = llmStats?.cacheStats?.hitRate
    ? parseInt(llmStats.cacheStats.hitRate)
    : null;

  // 6A: Skill Gap Heatmap — domain coverage derived from module catalog
  const skillGapData = useMemo(() => {
    if (!modules.length) return [];
    const domainMap = {};
    modules.forEach(m => {
      const d = m.data?.domain || m.category || m.data?.category || 'General';
      if (!domainMap[d]) domainMap[d] = { domain: d, total: 0, skills: 0 };
      domainMap[d].total++;
      const skillCount = Array.isArray(m.data?.skills) ? m.data.skills.length : 0;
      domainMap[d].skills += skillCount;
    });
    return Object.values(domainMap)
      .sort((a, b) => b.total - a.total)
      .slice(0, 8)
      .map(d => ({
        domain    : d.domain.slice(0, 16),
        modules   : d.total,
        skillTags : d.skills,
        coverage  : Math.min(100, Math.round((d.total / Math.max(...Object.values(domainMap).map(x => x.total))) * 100)),
      }));
  }, [modules]);

  const totalLlmCalls = (llmStats?.geminiCallCount || 0)
    + (llmStats?.groqCallCount || 0)
    + (llmStats?.groqFastCallCount || 0);

  return (
    <div className="min-h-screen bg-[#0F172A] text-white">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">

        {/* Header */}
        <div className="flex items-center gap-4 mb-8">
          <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-indigo-500/30 to-violet-500/20 border border-indigo-500/30 flex items-center justify-center text-2xl">
            📈
          </div>
          <div>
            <h1 className="text-3xl font-black text-white tracking-tight">AI Metrics Dashboard</h1>
            <p className="text-slate-400 text-sm mt-0.5">
              {adminData?.company?.name || 'Company'} · Live platform analytics
            </p>
          </div>
          <button
            onClick={loadAll}
            className="ml-auto px-4 py-2 rounded-xl bg-slate-800/60 border border-slate-700/50 text-slate-400 hover:text-white hover:border-slate-600 text-sm font-bold transition-all"
          >
            ↺ Refresh
          </button>
        </div>

        {/* KPI Row */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
          <KpiCard label="Total Users"    value={loading ? '—' : stats.totalUsers || 0}        color={COLORS.indigo}  icon="👥" sub={`${stats.activeUsers || 0} active (30d)`} />
          <KpiCard label="Completion"     value={loading ? '—' : `${stats.completionRate || 0}%`} color={COLORS.emerald} icon="✅" sub={`${stats.completedAssignments || 0} / ${stats.totalAssignments || 0} assignments`} />
          <KpiCard label="LLM API Calls"  value={loading ? '—' : totalLlmCalls}                color={COLORS.amber}   icon="🤖" sub={cacheHitRate !== null ? `${cacheHitRate}% cache hit rate` : 'cache stats loading'} />
          <KpiCard label="RecSys P@5"     value={loading ? '—' : recMetrics ? `${Math.round((recMetrics.precision_at_5 || 0) * 100)}%` : 'N/A'} color={COLORS.violet} icon="✨" sub={`NDCG@10: ${recMetrics ? Math.round((recMetrics.ndcg_at_10 || 0) * 100) : 0}%`} />
        </div>

        {/* Charts Grid */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">

          {/* Chart 1: Assignment Status Breakdown */}
          <ChartCard title="Assignment Status" subtitle="Distribution across all employees" loading={loading}>
            {assignmentData.length > 0 ? (
              <ResponsiveContainer width="100%" height={220}>
                <PieChart>
                  <Pie
                    data={assignmentData}
                    cx="50%"
                    cy="50%"
                    innerRadius={55}
                    outerRadius={85}
                    paddingAngle={3}
                    dataKey="value"
                  >
                    {assignmentData.map((entry, i) => (
                      <Cell key={entry.name} fill={entry.color} opacity={0.85} />
                    ))}
                  </Pie>
                  <Tooltip contentStyle={customTooltipStyle} />
                  <Legend
                    formatter={(value) => <span className="text-xs text-slate-300">{value}</span>}
                    iconType="circle"
                    iconSize={8}
                  />
                </PieChart>
              </ResponsiveContainer>
            ) : (
              <div className="h-48 flex items-center justify-center text-slate-600 text-sm">No assignment data yet</div>
            )}
          </ChartCard>

          {/* Chart 2: User Role Distribution */}
          <ChartCard title="Team Composition" subtitle="Users by role in your company" loading={loading}>
            {userRoleData.length > 0 ? (
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={userRoleData} margin={{ top: 5, right: 10, bottom: 5, left: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                  <XAxis dataKey="name" tick={{ fill: '#94a3b8', fontSize: 11 }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fill: '#64748b', fontSize: 10 }} axisLine={false} tickLine={false} />
                  <Tooltip contentStyle={customTooltipStyle} cursor={{ fill: 'rgba(99,102,241,0.1)' }} />
                  <Bar dataKey="value" name="Users" radius={[6, 6, 0, 0]}>
                    {userRoleData.map((_, i) => (
                      <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <div className="h-48 flex items-center justify-center text-slate-600 text-sm">No user data yet</div>
            )}
          </ChartCard>

          {/* Chart 3: LLM API Usage */}
          <ChartCard title="LLM API Usage" subtitle="Calls by model tier + cache efficiency" loading={loading}>
            {llmBarData.length > 0 && totalLlmCalls > 0 ? (
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={llmBarData} margin={{ top: 5, right: 10, bottom: 5, left: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                  <XAxis dataKey="name" tick={{ fill: '#94a3b8', fontSize: 10 }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fill: '#64748b', fontSize: 10 }} axisLine={false} tickLine={false} />
                  <Tooltip contentStyle={customTooltipStyle} cursor={{ fill: 'rgba(99,102,241,0.1)' }} />
                  <Bar dataKey="calls" name="Count" radius={[6, 6, 0, 0]}>
                    {llmBarData.map((_, i) => (
                      <Cell key={i} fill={[COLORS.violet, COLORS.indigo, COLORS.cyan, COLORS.emerald][i]} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <div className="h-48 flex flex-col items-center justify-center gap-2">
                <span className="text-slate-600 text-sm">No LLM calls recorded yet</span>
                <span className="text-xs text-slate-700">Start sessions to see model usage</span>
              </div>
            )}
          </ChartCard>

          {/* Chart 4: RecSys Radar */}
          <ChartCard title="Recommendation Engine Quality" subtitle="SVD+TF-IDF evaluation on 20% held-out test split" loading={loading}>
            {recRadarData.length > 0 ? (
              <ResponsiveContainer width="100%" height={220}>
                <RadarChart cx="50%" cy="50%" outerRadius={75} data={recRadarData}>
                  <PolarGrid stroke="rgba(255,255,255,0.07)" />
                  <PolarAngleAxis dataKey="metric" tick={{ fill: '#94a3b8', fontSize: 11 }} />
                  <PolarRadiusAxis angle={30} domain={[0, 100]} tick={{ fill: '#475569', fontSize: 9 }} />
                  <Radar name="Score %" dataKey="value" stroke={COLORS.violet} fill={COLORS.violet} fillOpacity={0.3} strokeWidth={2} />
                  <Tooltip contentStyle={customTooltipStyle} formatter={(v) => [`${v}%`, 'Score']} />
                </RadarChart>
              </ResponsiveContainer>
            ) : (
              <div className="h-48 flex flex-col items-center justify-center gap-2">
                <span className="text-slate-600 text-sm">Rec engine not yet trained</span>
                <span className="text-xs text-slate-700">Start rec-engine service to see metrics</span>
              </div>
            )}
          </ChartCard>

          {/* Chart 5: Weekly Activity Estimate */}
          <ChartCard title="Weekly Activity Estimate" subtitle="Completion & session distribution (derived from totals)" loading={loading}>
            <ResponsiveContainer width="100%" height={220}>
              <AreaChart data={activityData} margin={{ top: 5, right: 10, bottom: 5, left: 0 }}>
                <defs>
                  <linearGradient id="gCompletions" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%"  stopColor={COLORS.emerald} stopOpacity={0.3} />
                    <stop offset="95%" stopColor={COLORS.emerald} stopOpacity={0} />
                  </linearGradient>
                  <linearGradient id="gSessions" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%"  stopColor={COLORS.indigo} stopOpacity={0.3} />
                    <stop offset="95%" stopColor={COLORS.indigo} stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                <XAxis dataKey="day" tick={{ fill: '#94a3b8', fontSize: 11 }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fill: '#64748b', fontSize: 10 }} axisLine={false} tickLine={false} />
                <Tooltip contentStyle={customTooltipStyle} />
                <Area type="monotone" dataKey="sessions"    name="Sessions"    stroke={COLORS.indigo}  strokeWidth={2} fill="url(#gSessions)" />
                <Area type="monotone" dataKey="completions" name="Completions" stroke={COLORS.emerald} strokeWidth={2} fill="url(#gCompletions)" />
              </AreaChart>
            </ResponsiveContainer>
          </ChartCard>

          {/* Chart 6: Platform Health Summary */}
          <ChartCard title="Platform Health" subtitle="Cache efficiency, coverage & model routing" loading={loading}>
            <div className="grid grid-cols-2 gap-3 mt-2">
              {[
                {
                  label: 'Cache Hit Rate',
                  value: cacheHitRate !== null ? `${cacheHitRate}%` : 'N/A',
                  color: cacheHitRate !== null && cacheHitRate >= 40 ? COLORS.emerald : COLORS.amber,
                  icon: '⚡',
                  sub: `${llmStats?.cacheStats?.hits || 0} hits · ${llmStats?.cacheStats?.size || 0} cached`,
                },
                {
                  label: 'Rec Coverage',
                  value: recMetrics ? `${Math.round((recMetrics.coverage || 0) * 100)}%` : 'N/A',
                  color: COLORS.violet,
                  icon: '🎯',
                  sub: `${recMetrics?.total_skills || 0} skills catalogued`,
                },
                {
                  label: 'Active Users',
                  value: stats.activeUsers || 0,
                  color: COLORS.cyan,
                  icon: '🟢',
                  sub: 'last 30 days',
                },
                {
                  label: 'Pending Actions',
                  value: stats.pendingApprovals || 0,
                  color: stats.pendingApprovals > 0 ? COLORS.amber : COLORS.emerald,
                  icon: '⏳',
                  sub: 'approvals / requests',
                },
              ].map((item) => (
                <div key={item.label} className="rounded-xl bg-slate-800/40 border border-slate-700/30 p-3">
                  <div className="flex items-center gap-2 mb-1">
                    <span>{item.icon}</span>
                    <span className="text-xs font-bold text-slate-500 uppercase tracking-wide">{item.label}</span>
                  </div>
                  <p className="text-2xl font-black" style={{ color: item.color }}>{item.value}</p>
                  <p className="text-xs text-slate-600 mt-0.5">{item.sub}</p>
                </div>
              ))}
            </div>
          </ChartCard>

        </div>

        {/* 6A: Skill Gap Heatmap */}
        {(loading || skillGapData.length > 0) && (
          <ChartCard
            title="Skill Domain Coverage Heatmap"
            subtitle="Module count and skill tag density by domain — darker = more coverage"
            loading={loading}
            className="mt-6"
          >
            {skillGapData.length > 0 ? (
              <div className="space-y-2">
                {skillGapData.map((row) => {
                  const intensity = row.coverage / 100;
                  const bg = `rgba(99, 102, 241, ${0.08 + intensity * 0.45})`;
                  const border = `rgba(99, 102, 241, ${0.1 + intensity * 0.5})`;
                  return (
                    <div key={row.domain} className="flex items-center gap-3">
                      <span className="w-28 text-xs text-slate-400 font-medium truncate flex-shrink-0">{row.domain}</span>
                      <div className="flex-1 flex items-center gap-1">
                        {Array.from({ length: 10 }).map((_, i) => {
                          const filled = (i + 1) <= Math.ceil(row.coverage / 10);
                          return (
                            <div
                              key={i}
                              className="flex-1 h-6 rounded-md transition-all duration-300"
                              style={{ background: filled ? bg : 'rgba(99,102,241,0.05)', border: `1px solid ${filled ? border : 'rgba(99,102,241,0.08)'}` }}
                            />
                          );
                        })}
                      </div>
                      <span className="w-16 text-right text-xs text-slate-500 flex-shrink-0">
                        {row.modules}m · {row.skillTags}sk
                      </span>
                    </div>
                  );
                })}
                <p className="text-xs text-slate-700 mt-2">m = modules · sk = skill tags · intensity = relative coverage</p>
              </div>
            ) : (
              <div className="h-24 flex items-center justify-center text-slate-600 text-sm">No module data yet</div>
            )}
          </ChartCard>
        )}

        {/* 6B: Export/Print Report */}
        <div className="mt-4 flex justify-end">
          <button
            onClick={() => window.print()}
            className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-slate-800/60 border border-slate-700/50 text-slate-400 hover:text-white hover:border-slate-600 text-sm font-bold transition-all"
          >
            🖨️ Export Report (Print / PDF)
          </button>
        </div>

        {/* Recent Activity */}
        {adminData?.recentActivity?.length > 0 && (
          <div className="mt-6 rounded-2xl border border-slate-700/40 bg-slate-900/60 p-5">
            <h3 className="text-sm font-black text-white mb-4">Recent Activity</h3>
            <div className="space-y-2">
              {adminData.recentActivity.slice(0, 6).map((a, i) => (
                <div key={i} className="flex items-center gap-3 px-3 py-2.5 rounded-xl bg-slate-800/30 border border-slate-700/20">
                  <span className="text-base">{a.type === 'login' ? '🔐' : '✅'}</span>
                  <div className="flex-1 min-w-0">
                    <span className="text-sm font-semibold text-white">{a.name}</span>
                    <span className="text-xs text-slate-500 ml-2">{a.type === 'login' ? 'logged in' : 'completed assignment'}</span>
                  </div>
                  <span className="text-xs text-slate-600 flex-shrink-0">
                    {a.time ? new Date(a.time).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : ''}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

      </div>
    </div>
  );
}
