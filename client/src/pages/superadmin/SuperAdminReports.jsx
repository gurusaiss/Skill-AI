import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { authFetch } from '../../utils/authFetch.js';
import { useNotification } from '../../contexts/NotificationContext.jsx';
import StatCard from '../../components/StatCard.jsx';
import PageContainer from '../../components/PageContainer.jsx';
import PageHeader from '../../components/PageHeader.jsx';
import Button from '../../components/Button.jsx';

function PlanBadge({ plan }) {
  const styles = {
    trial:      'bg-amber-500/20 text-amber-300 border-amber-500/30',
    standard:   'bg-indigo-500/20 text-indigo-300 border-indigo-500/30',
    enterprise: 'bg-purple-500/20 text-purple-300 border-purple-500/30',
  };
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-sm font-semibold border ${styles[plan] || styles.trial}`}>
      {plan ? plan.charAt(0).toUpperCase() + plan.slice(1) : 'Trial'}
    </span>
  );
}

function StatusBadge({ status }) {
  const styles = {
    active:    'bg-emerald-500/20 text-emerald-400 border-emerald-500/30',
    suspended: 'bg-red-500/20 text-red-400 border-red-500/30',
    inactive:  'bg-slate-500/20 text-slate-400 border-slate-500/30',
  };
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-sm font-semibold border ${styles[status] || styles.inactive}`}>
      {status ? status.charAt(0).toUpperCase() + status.slice(1) : 'Inactive'}
    </span>
  );
}

function CompletionBar({ value = 0 }) {
  const color = value >= 75 ? 'bg-emerald-500' : value >= 40 ? 'bg-amber-500' : 'bg-red-500';
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-1.5 bg-slate-700 rounded-full overflow-hidden">
        <div className={`h-full ${color} rounded-full transition-all`} style={{ width: `${value}%` }} />
      </div>
      <span className="text-sm text-slate-400 tabular-nums w-9 text-right">{value}%</span>
    </div>
  );
}

function formatDate(d) {
  if (!d) return '—';
  const dt = new Date(d);
  return isNaN(dt) ? '—' : dt.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
}

export default function SuperAdminReports() {
  const { user } = useAuth();
  const navigate = useNavigate();

  const [reports, setReports]   = useState([]);
  const [loading, setLoading]   = useState(true);
  const { notify } = useNotification();
  const setToast = useCallback(({ message, type = 'info' }) => notify(message, type), [notify]);
  const [search, setSearch]     = useState('');
  const [filterPlan, setFilterPlan] = useState('all');
  const [sortKey, setSortKey]   = useState('companyName');
  const [sortAsc, setSortAsc]   = useState(true);
  const [loadError, setLoadError] = useState('');

  const fetchReports = useCallback(() => {
    setLoading(true);
    setLoadError('');
    authFetch('/api/superadmin/reports')
      .then(d => setReports(Array.isArray(d) ? d : (d?.reports || [])))
      .catch(err => { setLoadError(err.message || 'Could not load reports'); setToast({ message: err.message, type: 'error' }); })
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { fetchReports(); }, [fetchReports]);

  const handleSort = (key) => {
    if (sortKey === key) setSortAsc(a => !a);
    else { setSortKey(key); setSortAsc(true); }
  };

  const filtered = reports
    .filter(r => {
      if (filterPlan !== 'all' && r.plan !== filterPlan) return false;
      if (!search.trim()) return true;
      const q = search.toLowerCase();
      return (
        r.companyName?.toLowerCase().includes(q) ||
        r.adminName?.toLowerCase().includes(q) ||
        r.adminEmail?.toLowerCase().includes(q)
      );
    })
    .sort((a, b) => {
      const av = a[sortKey] ?? '';
      const bv = b[sortKey] ?? '';
      return sortAsc
        ? (typeof av === 'number' ? av - bv : String(av).localeCompare(String(bv)))
        : (typeof bv === 'number' ? bv - av : String(bv).localeCompare(String(av)));
    });

  // Summary totals
  const totals = reports.reduce((acc, r) => ({
    users: acc.users + (r.totalUsers || 0),
    employees: acc.employees + (r.employees || 0),
    assignments: acc.assignments + (r.totalAssignments || 0),
    completed: acc.completed + (r.completedAssignments || 0),
  }), { users: 0, employees: 0, assignments: 0, completed: 0 });
  const overallCompletion = totals.assignments > 0
    ? Math.round((totals.completed / totals.assignments) * 100)
    : 0;

  const SortIcon = ({ k }) => sortKey === k
    ? <span className="ml-1 text-violet-400">{sortAsc ? '↑' : '↓'}</span>
    : <span className="ml-1 text-slate-400">↕</span>;

  if (loading) {
    return (
      <div className="min-h-screen bg-[#0F172A] flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin text-violet-400 text-4xl mb-4">⟳</div>
          <div className="text-slate-400 text-sm">Loading reports...</div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#0F172A] text-[#F8FAFC]">

      <PageContainer>

        <PageHeader
          icon="📊"
          title="Platform Reports"
          subtitle="Company-level metrics. Live data, no caching."
          actions={<Button variant="primary" onClick={fetchReports}>Refresh</Button>}
        />

        {loadError ? (
          <div className="mb-5 flex flex-wrap items-center gap-3 rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">
            <span className="min-w-0 flex-1">{loadError}</span>
            <Button variant="danger" size="sm" onClick={fetchReports}>Retry</Button>
          </div>
        ) : null}

        {/* Summary Cards */}
        <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-4 mb-5">
          <StatCard label="Companies" value={reports.length}
            description="Companies included in this report."
            tooltip="Number of company records on the platform, before any filter below is applied."
            borderClass="border-violet-500/30" bgClass="bg-violet-600/10" textClass="text-violet-300" />
          <StatCard label="Total Users" value={totals.users}
            description="People across all companies."
            tooltip="Sum of every company's user count (all roles, excluding super admins)."
            borderClass="border-blue-500/30" bgClass="bg-blue-600/10" textClass="text-blue-300" />
          <StatCard label="Employees" value={totals.employees}
            description="Learners across all companies."
            tooltip="Sum of users with the employee role in every company."
            borderClass="border-emerald-500/30" bgClass="bg-emerald-600/10" textClass="text-emerald-300" />
          <StatCard label="Assignments" value={totals.assignments}
            description="Learning items handed out."
            tooltip="Total assignments given to users of all companies, whether completed or not."
            borderClass="border-amber-500/30" bgClass="bg-amber-600/10" textClass="text-amber-300" />
          <StatCard label="Avg Completion" value={`${overallCompletion}%`}
            description="Share of assignments finished."
            tooltip="Completed assignments divided by total assignments across all companies, rounded to a whole percent. It is a platform-wide ratio, not an average of company percentages."
            borderClass="border-purple-500/30" bgClass="bg-purple-600/10" textClass="text-purple-300" />
        </div>

        {/* Filter Bar */}
        <div className="flex flex-wrap items-center gap-3 mb-5 rounded-2xl border border-slate-700/60 bg-slate-800/40 p-4">
          <div className="relative flex-1 min-w-[200px] sm:max-w-md">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-sm">🔍</span>
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search company, admin..."
              className="w-full bg-slate-900/60 border border-slate-700 rounded-xl pl-9 pr-4 py-2.5 text-base text-white placeholder-slate-400 focus:outline-none focus:border-violet-500/60"
            />
          </div>
          <select
            value={filterPlan}
            onChange={e => setFilterPlan(e.target.value)}
            className="bg-slate-900/60 border border-slate-700 rounded-xl px-3 py-2.5 text-base text-white focus:outline-none focus:border-violet-500/60"
          >
            <option value="all">All Plans</option>
            <option value="trial">Trial</option>
            <option value="standard">Standard</option>
            <option value="enterprise">Enterprise</option>
          </select>
          <span className="text-slate-300 text-sm ml-auto">{filtered.length} of {reports.length} companies</span>
          {(search || filterPlan !== 'all') ? <Button size="sm" variant="ghost" onClick={() => { setSearch(''); setFilterPlan('all'); }}>Clear Filters</Button> : null}
        </div>

        {/* Reports Table */}
        <div className="bg-slate-800/40 border border-slate-700/60 rounded-2xl overflow-hidden">
          {filtered.length === 0 ? (
            <div className="px-6 py-16 text-center text-slate-400">
              <div className="text-4xl mb-3">📊</div>
              <p className="text-base">{search || filterPlan !== 'all' ? 'No companies match your filters.' : 'No company data yet.'}</p>
            </div>
          ) : (
            <div className="min-w-0">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-700/60 bg-slate-800/30">
                    <th onClick={() => handleSort('companyName')} className="text-left px-6 py-3 text-sm font-bold text-slate-400 uppercase tracking-wider cursor-pointer hover:text-slate-300">
                      Company <SortIcon k="companyName" />
                    </th>
                    <th className="text-left px-4 py-3 text-sm font-bold text-slate-400 uppercase tracking-wider">Admin</th>
                    <th className="text-left px-4 py-3 text-sm font-bold text-slate-400 uppercase tracking-wider">Plan / Status</th>
                    <th onClick={() => handleSort('totalUsers')} className="text-left px-4 py-3 text-sm font-bold text-slate-400 uppercase tracking-wider cursor-pointer hover:text-slate-300">
                      Users <SortIcon k="totalUsers" />
                    </th>
                    <th onClick={() => handleSort('employees')} className="hidden xl:table-cell text-left px-4 py-3 text-sm font-bold text-slate-400 uppercase tracking-wider cursor-pointer hover:text-slate-300">
                      Employees <SortIcon k="employees" />
                    </th>
                    <th onClick={() => handleSort('totalAssignments')} className="text-left px-4 py-3 text-sm font-bold text-slate-400 uppercase tracking-wider cursor-pointer hover:text-slate-300">
                      Assignments <SortIcon k="totalAssignments" />
                    </th>
                    <th onClick={() => handleSort('completionRate')} className="text-left px-4 py-3 text-sm font-bold text-slate-400 uppercase tracking-wider cursor-pointer hover:text-slate-300">
                      Completion <SortIcon k="completionRate" />
                    </th>
                    <th onClick={() => handleSort('activeUsers')} className="text-left px-4 py-3 text-sm font-bold text-slate-400 uppercase tracking-wider cursor-pointer hover:text-slate-300">
                      Active (30d) <SortIcon k="activeUsers" />
                    </th>
                    <th onClick={() => handleSort('createdAt')} className="hidden xl:table-cell text-left px-4 py-3 text-sm font-bold text-slate-400 uppercase tracking-wider cursor-pointer hover:text-slate-300">
                      Created <SortIcon k="createdAt" />
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-700/30">
                  {filtered.map(r => (
                    <tr key={r.companyId} className="hover:bg-slate-700/20 transition-colors">
                      <td className="px-6 py-4">
                        <div>
                          <p className="font-semibold text-white text-base truncate max-w-[22rem]" title={r.companyName}>{r.companyName}</p>
                          {r.domain && <p className="text-sm text-slate-400 mt-0.5">{r.domain}</p>}
                        </div>
                      </td>
                      <td className="px-4 py-4">
                        <div>
                          <p className="text-white truncate max-w-[16rem]" title={r.adminName}>{r.adminName}</p>
                          <p className="text-sm text-slate-400 mt-0.5 truncate max-w-[16rem]" title={r.adminEmail}>{r.adminEmail}</p>
                        </div>
                      </td>
                      <td className="px-4 py-4">
                        <div className="flex flex-col gap-1">
                          <PlanBadge plan={r.plan} />
                          <StatusBadge status={r.status} />
                        </div>
                      </td>
                      <td className="px-4 py-4 text-slate-300 tabular-nums font-medium">{r.totalUsers}<span className="xl:hidden block text-sm font-normal text-slate-400">{r.employees} employees</span></td>
                      <td className="hidden xl:table-cell px-4 py-4 text-slate-300 tabular-nums">{r.employees}</td>
                      <td className="px-4 py-4">
                        <div className="text-slate-300 tabular-nums">{r.totalAssignments}</div>
                        <div className="text-sm text-slate-400 mt-0.5">{r.completedAssignments} done</div>
                      </td>
                      <td className="px-4 py-4 min-w-[80px]">
                        <CompletionBar value={r.completionRate} />
                      </td>
                      <td className="px-4 py-4 text-slate-300 tabular-nums">{r.activeUsers}</td>
                      <td className="hidden xl:table-cell px-4 py-4 text-slate-300 text-sm">{formatDate(r.createdAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Footer note */}
        <div className="mt-4 text-center text-slate-400 text-sm">
          All data is live from the database — no caching. Click column headers to sort.
        </div>
      </PageContainer>
    </div>
  );
}
