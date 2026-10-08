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
import StatCard from '../../components/StatCard.jsx';
import PageContainer from '../../components/PageContainer.jsx';
import PageHeader from '../../components/PageHeader.jsx';
import Button from '../../components/Button.jsx';

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
  <div className={`rounded-2xl border border-slate-700/40 bg-slate-900/60 backdrop-blur-sm p-4 sm:p-5 ${className}`}>
    <div className="mb-4">
      <h3 className="text-base font-black text-white">{title}</h3>
      {subtitle && <p className="text-sm text-slate-400 mt-0.5">{subtitle}</p>}
    </div>
    {loading ? (
      <div className="h-48 rounded-xl bg-slate-800/40 animate-pulse" />
    ) : (
      children
    )}
  </div>
);

const KpiCard = ({ label, value, sub, color, icon, description, tooltip }) => (
  <StatCard
    label={label}
    value={<span style={{ color }}>{value}</span>}
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

const customTooltipStyle = {
  backgroundColor: '#1e293b',
  border: '1px solid rgba(99,102,241,0.3)',
  borderRadius: '10px',
  fontSize: '14px',
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
  const [loadError, setLoadError]   = useState('');

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
    setLoadError('');
    try {
      const [admin, health, rec, mods] = await Promise.allSettled([
        authFetch('/api/admin/dashboard'),
        authFetch('/api/health'),
        authFetch('/api/recommendations/metrics'),
        authFetch('/api/modules?limit=1000'),
      ]);

      if (admin.status === 'fulfilled' && admin.value) setAdminData(admin.value);
      else if (admin.status === 'rejected') setLoadError(admin.reason?.message || 'Could not load the platform statistics.');
      if (health.status === 'fulfilled' && health.value) setLlmStats(health.value.llm);
      if (rec.status === 'fulfilled' && rec.value) setRecMetrics(rec.value);
      if (mods.status === 'fulfilled' && mods.value) {
        const list = Array.isArray(mods.value) ? mods.value : (mods.value?.modules || []);
        setModules(list);
      }
    } catch (e) {
      console.error('[MetricsDashboard] load error:', e);
      setLoadError('Could not load the dashboard. Please try again.');
    } finally {
      setLoading(false);
    }
  }, []);

  // ── Derived data for charts ──────────────────────────────────────────────────

  const stats = adminData?.stats || {};

  // Cancelled assignments are shown as their own slice and excluded from the completion rate.
  const assignmentData = [
    { name: 'Assigned',    value: stats.pendingAssignments   || 0, color: COLORS.blue },
    { name: 'In Progress', value: stats.activeAssignments    || 0, color: COLORS.amber },
    { name: 'Completed',   value: stats.completedAssignments || 0, color: COLORS.emerald },
    { name: 'Cancelled',   value: stats.cancelledAssignments || 0, color: COLORS.slate },
  ].filter(d => d.value > 0);

  const userRoleData = [
    { name: 'Employees', value: stats.employees  || 0 },
    { name: 'Managers',  value: stats.managers   || 0 },
    { name: 'Admins',    value: stats.admins     || 0 },
    { name: 'Other',     value: stats.otherRoles || 0 },
  ].filter(d => d.value > 0);

  const llmBarData = llmStats ? [
    { name: 'Gemini',     calls: llmStats.callCount               || 0 },
    { name: 'Groq 70B',   calls: llmStats.groqCallCount           || 0 },
    { name: 'Groq 8B',    calls: llmStats.groqFastCallCount       || 0 },
    { name: 'OpenRouter', calls: llmStats.openRouterCallCount     || 0 },
    { name: 'Cache Hits', calls: llmStats.cacheStats?.hits        || 0 },
  ] : [];

  // The rec engine (python) and the JS fallback use different key names; accept both.
  // A missing metric is returned as null and shown as n/a rather than a fake 0%.
  const pickMetric = (...keys) => {
    if (!recMetrics) return null;
    for (const k of keys) {
      const v = Number(recMetrics[k]);
      if (recMetrics[k] != null && Number.isFinite(v)) return v;
    }
    return null;
  };
  const recP5       = pickMetric('precision_at_5', 'precision_at_k');
  const recRecall5  = pickMetric('recall_at_5', 'recall_at_k');
  const recNdcg     = pickMetric('ndcg_at_10', 'ndcg_at_k');
  const recCoverage = pickMetric('coverage');
  const fmtRec = (v) => (v == null ? 'n/a' : `${Math.round(v * 100)}%`);

  const recRadarData = recMetrics ? [
    { metric: 'P@5',      value: recP5 },
    { metric: 'Recall@5', value: recRecall5 },
    { metric: 'NDCG@10',  value: recNdcg },
    { metric: 'Coverage', value: recCoverage },
  ].filter(d => d.value != null).map(d => ({ ...d, value: Math.round(d.value * 100) })) : [];

  // Real per-day activity for the last 7 days, computed on the server from
  // assignment completion timestamps and assessment submission timestamps.
  const activityData = Array.isArray(stats.weeklyActivity) ? stats.weeklyActivity : [];
  const hasActivity = activityData.some(d => d.completions > 0 || d.submissions > 0);

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

  // Total model calls (cache hits are not model calls, so they are excluded).
  const totalLlmCalls = (llmStats?.callCount || 0)
    + (llmStats?.groqCallCount || 0)
    + (llmStats?.groqFastCallCount || 0)
    + (llmStats?.openRouterCallCount || 0);

  return (
    <div className="min-h-screen bg-[#0F172A] text-white">
      <PageContainer>

        <PageHeader
          icon="📈"
          title="AI Metrics Dashboard"
          subtitle={`${adminData?.company?.name || 'Company'} · Live platform analytics`}
          actions={(
            <>
              <Button variant="secondary" onClick={loadAll} loading={loading}>Refresh</Button>
              <Button variant="secondary" onClick={() => window.print()} title="Print or save this dashboard as a PDF">Export Report (Print / PDF)</Button>
            </>
          )}
        />

        {loadError && (
          <div role="alert" className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-200">
            <span>{loadError}</span>
            <Button size="sm" variant="danger" onClick={loadAll}>Retry</Button>
          </div>
        )}

        {/* KPI Row */}
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4 mb-4">
          <KpiCard label="Total Users"    value={loading ? '—' : stats.totalUsers || 0}        color={COLORS.indigo}  icon="👥" sub={`${stats.activeUsers || 0} active (30d)`}
            description="Everyone in your company"
            tooltip="All user accounts in your company. 'Active' = logged in during the last 30 days." />
          <KpiCard label="Completion"     value={loading ? '—' : `${stats.completionRate || 0}%`} color={COLORS.emerald} icon="✅" sub={`${stats.completedAssignments || 0} / ${(stats.totalAssignments || 0) - (stats.cancelledAssignments || 0)} assignments`}
            description="Share of module assignments finished"
            tooltip="Completed assignments divided by non-cancelled assignments. Cancelled assignments are excluded." />
          <KpiCard label="LLM API Calls"  value={loading ? '—' : totalLlmCalls}                color={COLORS.amber}   icon="🤖" sub={cacheHitRate !== null ? `${cacheHitRate}% cache hit rate` : 'cache stats loading'}
            description="AI model requests since the server started"
            tooltip="Sum of calls to Gemini, Groq 70B, Groq 8B and OpenRouter. Cached answers are not counted as calls." />
          <KpiCard label="RecSys P@5"     value={loading ? '—' : fmtRec(recP5)} color={COLORS.violet} icon="✨" sub={`NDCG@10: ${fmtRec(recNdcg)}`}
            description="Recommendation precision at 5"
            tooltip="Of the top 5 recommended skills, the share that were relevant on the held-out test split. n/a means the engine has not reported this metric." />
        </div>

        {/* Charts Grid */}
        <div className="grid grid-cols-1 lg:grid-cols-2 2xl:grid-cols-3 gap-4">

          {/* Chart 1: Assignment Status Breakdown */}
          <ChartCard title="Assignment Status" subtitle="Distribution across all employees" loading={loading}>
            {assignmentData.length > 0 ? (
              <ResponsiveContainer width="100%" height={260}>
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
                    formatter={(value) => <span className="text-sm text-slate-300">{value}</span>}
                    iconType="circle"
                    iconSize={8}
                  />
                </PieChart>
              </ResponsiveContainer>
            ) : (
              <div className="h-48 flex items-center justify-center text-slate-400 text-sm">No assignment data yet</div>
            )}
          </ChartCard>

          {/* Chart 2: User Role Distribution */}
          <ChartCard title="Team Composition" subtitle="Users by role in your company" loading={loading}>
            {userRoleData.length > 0 ? (
              <ResponsiveContainer width="100%" height={260}>
                <BarChart data={userRoleData} margin={{ top: 5, right: 10, bottom: 5, left: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                  <XAxis dataKey="name" tick={{ fill: '#94a3b8', fontSize: 13 }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fill: '#64748b', fontSize: 13 }} axisLine={false} tickLine={false} />
                  <Tooltip contentStyle={customTooltipStyle} cursor={{ fill: 'rgba(99,102,241,0.1)' }} />
                  <Bar dataKey="value" name="Users" radius={[6, 6, 0, 0]}>
                    {userRoleData.map((_, i) => (
                      <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <div className="h-48 flex items-center justify-center text-slate-400 text-sm">No user data yet</div>
            )}
          </ChartCard>

          {/* Chart 3: LLM API Usage */}
          <ChartCard title="LLM API Usage" subtitle="Calls by model tier + cache efficiency" loading={loading}>
            {llmBarData.length > 0 && totalLlmCalls > 0 ? (
              <ResponsiveContainer width="100%" height={260}>
                <BarChart data={llmBarData} margin={{ top: 5, right: 10, bottom: 5, left: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                  <XAxis dataKey="name" tick={{ fill: '#94a3b8', fontSize: 13 }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fill: '#64748b', fontSize: 13 }} axisLine={false} tickLine={false} />
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
                <span className="text-slate-400 text-sm">No LLM calls recorded yet</span>
                <span className="text-sm text-slate-500">Start sessions to see model usage</span>
              </div>
            )}
          </ChartCard>

          {/* Chart 4: RecSys Radar */}
          <ChartCard title="Recommendation Engine Quality" subtitle="SVD+TF-IDF evaluation on 20% held-out test split" loading={loading}>
            {recRadarData.length > 0 ? (
              <ResponsiveContainer width="100%" height={260}>
                <RadarChart cx="50%" cy="50%" outerRadius={75} data={recRadarData}>
                  <PolarGrid stroke="rgba(255,255,255,0.07)" />
                  <PolarAngleAxis dataKey="metric" tick={{ fill: '#94a3b8', fontSize: 13 }} />
                  <PolarRadiusAxis angle={30} domain={[0, 100]} tick={{ fill: '#475569', fontSize: 12 }} />
                  <Radar name="Score %" dataKey="value" stroke={COLORS.violet} fill={COLORS.violet} fillOpacity={0.3} strokeWidth={2} />
                  <Tooltip contentStyle={customTooltipStyle} formatter={(v) => [`${v}%`, 'Score']} />
                </RadarChart>
              </ResponsiveContainer>
            ) : (
              <div className="h-48 flex flex-col items-center justify-center gap-2">
                <span className="text-slate-400 text-sm">Rec engine not yet trained</span>
                <span className="text-sm text-slate-500">Start rec-engine service to see metrics</span>
              </div>
            )}
          </ChartCard>

          {/* Chart 5: Weekly Activity Estimate */}
          <ChartCard title="Weekly Activity" subtitle="Last 7 days: modules completed and assessments submitted" loading={loading}>
            {!hasActivity ? (
              <div className="h-48 flex items-center justify-center text-slate-400 text-sm">No activity in the last 7 days</div>
            ) : (
            <ResponsiveContainer width="100%" height={260}>
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
                <XAxis dataKey="day" tick={{ fill: '#94a3b8', fontSize: 13 }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fill: '#64748b', fontSize: 13 }} axisLine={false} tickLine={false} />
                <Tooltip contentStyle={customTooltipStyle} />
                <Area type="monotone" dataKey="submissions" name="Assessments submitted" stroke={COLORS.indigo}  strokeWidth={2} fill="url(#gSessions)" />
                <Area type="monotone" dataKey="completions" name="Modules completed" stroke={COLORS.emerald} strokeWidth={2} fill="url(#gCompletions)" />
              </AreaChart>
            </ResponsiveContainer>
            )}
          </ChartCard>

          {/* Chart 6: Platform Health Summary */}
          <ChartCard title="Platform Health" subtitle="Cache efficiency, coverage & model routing" loading={loading}>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-2">
              {[
                {
                  label: 'Cache Hit Rate',
                  value: cacheHitRate !== null && Number.isFinite(cacheHitRate) ? `${cacheHitRate}%` : 'N/A',
                  color: cacheHitRate !== null && cacheHitRate >= 40 ? COLORS.emerald : COLORS.amber,
                  icon: '⚡',
                  sub: `${llmStats?.cacheStats?.hits || 0} hits · ${llmStats?.cacheStats?.size || 0} cached`,
                  description: 'AI answers reused from cache',
                  tooltip: 'Share of AI requests answered from the cache instead of calling a model (hits / (hits + misses)).',
                },
                {
                  label: 'Rec Coverage',
                  value: fmtRec(recCoverage),
                  color: COLORS.violet,
                  icon: '🎯',
                  sub: `${recMetrics?.total_skills ?? 'n/a'} skills catalogued`,
                  description: 'Skills the engine can recommend',
                  tooltip: 'Share of the skill catalogue that appears in at least one recommendation. n/a means the engine did not report coverage.',
                },
                {
                  label: 'Active Users',
                  value: stats.activeUsers || 0,
                  color: COLORS.cyan,
                  icon: '🟢',
                  sub: 'last 30 days',
                  description: 'Users seen recently',
                  tooltip: 'Company users whose last login was within the last 30 days.',
                },
                {
                  label: 'Pending Actions',
                  value: stats.pendingApprovals || 0,
                  color: stats.pendingApprovals > 0 ? COLORS.amber : COLORS.emerald,
                  icon: '⏳',
                  sub: 'approvals / requests',
                  description: 'Items waiting for an admin',
                  tooltip: 'Pending manager assignment requests plus pending approval requests in your company.',
                },
              ].map((item) => (
                <StatCard key={item.label} label={item.label}
                  value={<span style={{ color: item.color }}>{item.value}</span>}
                  icon={item.icon} sub={item.sub} description={item.description} tooltip={item.tooltip}
                  borderClass="border-slate-700/30" bgClass="bg-slate-800/40" textClass="text-slate-500" />
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
            className="mt-4"
          >
            {skillGapData.length > 0 ? (
              <div className="space-y-2">
                {skillGapData.map((row) => {
                  const intensity = row.coverage / 100;
                  const bg = `rgba(99, 102, 241, ${0.08 + intensity * 0.45})`;
                  const border = `rgba(99, 102, 241, ${0.1 + intensity * 0.5})`;
                  return (
                    <div key={row.domain} className="flex items-center gap-3">
                      <span className="w-28 sm:w-40 text-sm text-slate-300 font-medium truncate flex-shrink-0" title={row.domain}>{row.domain}</span>
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
                      <span className="w-24 text-right text-sm text-slate-400 flex-shrink-0">
                        {row.modules}m · {row.skillTags}sk
                      </span>
                    </div>
                  );
                })}
                <p className="text-sm text-slate-500 mt-2">m = modules · sk = skill tags · intensity = relative coverage</p>
              </div>
            ) : (
              <div className="h-24 flex items-center justify-center text-slate-400 text-sm">No module data yet</div>
            )}
          </ChartCard>
        )}

        {/* Recent Activity */}
        {adminData?.recentActivity?.length > 0 && (
          <div className="mt-4 rounded-2xl border border-slate-700/40 bg-slate-900/60 p-4 sm:p-5">
            <h3 className="text-base font-black text-white mb-4">Recent Activity</h3>
            <div className="grid grid-cols-1 xl:grid-cols-2 gap-2">
              {adminData.recentActivity.slice(0, 6).map((a, i) => (
                <div key={i} className="flex items-center gap-3 px-3 py-2.5 rounded-xl bg-slate-800/30 border border-slate-700/20">
                  <span className="text-base">{a.type === 'login' ? '🔐' : '✅'}</span>
                  <div className="flex-1 min-w-0">
                    <span className="text-sm font-semibold text-white break-words">{a.name}</span>
                    <span className="text-sm text-slate-400 ml-2">{a.type === 'login' ? 'logged in' : 'completed assignment'}</span>
                  </div>
                  <span className="text-sm text-slate-400 flex-shrink-0">
                    {a.time ? new Date(a.time).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : ''}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

      </PageContainer>
    </div>
  );
}
