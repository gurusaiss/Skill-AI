import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';

const BASE_URL = import.meta.env.VITE_API_URL || (import.meta.env.PROD ? '' : 'http://localhost:3001');

const authFetch = async (path, options = {}) => {
  const token = localStorage.getItem('auth_token');
  const res = await fetch(`${BASE_URL}${path}`, {
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(options.headers || {}),
    },
    ...options,
  });
  const text = await res.text();
  let data = null;
  if (text) { try { data = JSON.parse(text); } catch { throw new Error(`Server error (${res.status})`); } }
  if (!res.ok) { throw new Error(typeof data?.error === 'string' ? data.error : data?.error?.message || `Request failed (${res.status})`); }
  return data?.data ?? data;
};

function Toast({ message, type, onClose }) {
  useEffect(() => { const t = setTimeout(onClose, 3500); return () => clearTimeout(t); }, [onClose]);
  return (
    <div className={`fixed top-5 right-5 z-[200] flex items-center gap-3 px-5 py-3 rounded-xl text-white text-sm font-semibold shadow-2xl border
      ${type === 'success' ? 'bg-emerald-600/95 border-emerald-500/50' : 'bg-red-600/95 border-red-500/50'}`}>
      <span>{type === 'success' ? '✓' : '✕'}</span>
      <span>{message}</span>
      <button onClick={onClose} className="ml-2 opacity-70 hover:opacity-100">✕</button>
    </div>
  );
}

function PlanBadge({ plan }) {
  const styles = {
    trial:      'bg-amber-500/20 text-amber-300 border-amber-500/30',
    standard:   'bg-indigo-500/20 text-indigo-300 border-indigo-500/30',
    enterprise: 'bg-purple-500/20 text-purple-300 border-purple-500/30',
  };
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold border ${styles[plan] || styles.trial}`}>
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
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold border ${styles[status] || styles.inactive}`}>
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
      <span className="text-xs text-slate-400 tabular-nums w-9 text-right">{value}%</span>
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
  const [toast, setToast]       = useState(null);
  const [search, setSearch]     = useState('');
  const [filterPlan, setFilterPlan] = useState('all');
  const [sortKey, setSortKey]   = useState('companyName');
  const [sortAsc, setSortAsc]   = useState(true);

  const fetchReports = useCallback(() => {
    setLoading(true);
    authFetch('/api/superadmin/reports')
      .then(d => setReports(Array.isArray(d) ? d : (d?.reports || [])))
      .catch(err => setToast({ message: err.message, type: 'error' }))
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
    : <span className="ml-1 text-slate-600">↕</span>;

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
      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}

      <div className="max-w-7xl mx-auto px-6 py-8 lg:px-8">

        {/* Header */}
        <div className="flex items-start justify-between mb-8">
          <div>
            <div className="flex items-center gap-3 mb-1">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-violet-600/20 border border-violet-500/20 text-xl">📊</div>
              <div>
                <h1 className="text-2xl font-bold text-white">Platform Reports</h1>
                <p className="text-violet-400 text-sm font-semibold">SkillForge AI</p>
              </div>
            </div>
            <p className="text-slate-400 text-sm mt-1 ml-[52px]">Company-level metrics — live data, no caching</p>
          </div>
          <div className="flex gap-2">
            <button
              onClick={fetchReports}
              className="flex items-center gap-2 px-4 py-2.5 bg-slate-700 hover:bg-slate-600 rounded-xl text-white font-bold text-sm transition-colors"
            >
              ↻ Refresh
            </button>
          </div>
        </div>

        {/* Summary Cards */}
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-4 mb-6">
          <div className="bg-[#1E293B] border border-slate-700/60 rounded-2xl p-4 text-center">
            <div className="text-2xl font-bold text-violet-300 tabular-nums">{reports.length}</div>
            <div className="text-slate-400 text-xs mt-0.5">Companies</div>
          </div>
          <div className="bg-[#1E293B] border border-slate-700/60 rounded-2xl p-4 text-center">
            <div className="text-2xl font-bold text-blue-300 tabular-nums">{totals.users}</div>
            <div className="text-slate-400 text-xs mt-0.5">Total Users</div>
          </div>
          <div className="bg-[#1E293B] border border-slate-700/60 rounded-2xl p-4 text-center">
            <div className="text-2xl font-bold text-emerald-300 tabular-nums">{totals.employees}</div>
            <div className="text-slate-400 text-xs mt-0.5">Employees</div>
          </div>
          <div className="bg-[#1E293B] border border-slate-700/60 rounded-2xl p-4 text-center">
            <div className="text-2xl font-bold text-amber-300 tabular-nums">{totals.assignments}</div>
            <div className="text-slate-400 text-xs mt-0.5">Assignments</div>
          </div>
          <div className="bg-[#1E293B] border border-slate-700/60 rounded-2xl p-4 text-center">
            <div className="text-2xl font-bold text-purple-300 tabular-nums">{overallCompletion}%</div>
            <div className="text-slate-400 text-xs mt-0.5">Avg Completion</div>
          </div>
        </div>

        {/* Filter Bar */}
        <div className="flex flex-wrap items-center gap-3 mb-5">
          <div className="relative flex-1 min-w-[200px] max-w-xs">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-sm">🔍</span>
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search company, admin..."
              className="w-full bg-[#1E293B] border border-slate-700 rounded-xl pl-9 pr-4 py-2.5 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-violet-500/60"
            />
          </div>
          <select
            value={filterPlan}
            onChange={e => setFilterPlan(e.target.value)}
            className="bg-[#1E293B] border border-slate-700 rounded-xl px-3 py-2.5 text-sm text-white focus:outline-none focus:border-violet-500/60"
          >
            <option value="all">All Plans</option>
            <option value="trial">Trial</option>
            <option value="standard">Standard</option>
            <option value="enterprise">Enterprise</option>
          </select>
          <span className="text-slate-500 text-sm ml-auto">{filtered.length} of {reports.length} companies</span>
        </div>

        {/* Reports Table */}
        <div className="bg-[#1E293B] border border-slate-700/60 rounded-2xl overflow-hidden">
          {filtered.length === 0 ? (
            <div className="px-6 py-16 text-center text-slate-500">
              <div className="text-4xl mb-3">📊</div>
              <p className="text-sm">{search || filterPlan !== 'all' ? 'No companies match your filters.' : 'No company data yet.'}</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-700/60 bg-slate-800/30">
                    <th onClick={() => handleSort('companyName')} className="text-left px-6 py-3 text-xs font-bold text-slate-500 uppercase tracking-wider cursor-pointer hover:text-slate-300">
                      Company <SortIcon k="companyName" />
                    </th>
                    <th className="text-left px-4 py-3 text-xs font-bold text-slate-500 uppercase tracking-wider">Admin</th>
                    <th className="text-left px-4 py-3 text-xs font-bold text-slate-500 uppercase tracking-wider">Plan / Status</th>
                    <th onClick={() => handleSort('totalUsers')} className="text-left px-4 py-3 text-xs font-bold text-slate-500 uppercase tracking-wider cursor-pointer hover:text-slate-300">
                      Users <SortIcon k="totalUsers" />
                    </th>
                    <th onClick={() => handleSort('employees')} className="text-left px-4 py-3 text-xs font-bold text-slate-500 uppercase tracking-wider cursor-pointer hover:text-slate-300">
                      Employees <SortIcon k="employees" />
                    </th>
                    <th onClick={() => handleSort('totalAssignments')} className="text-left px-4 py-3 text-xs font-bold text-slate-500 uppercase tracking-wider cursor-pointer hover:text-slate-300">
                      Assignments <SortIcon k="totalAssignments" />
                    </th>
                    <th onClick={() => handleSort('completionRate')} className="text-left px-4 py-3 text-xs font-bold text-slate-500 uppercase tracking-wider cursor-pointer hover:text-slate-300">
                      Completion <SortIcon k="completionRate" />
                    </th>
                    <th onClick={() => handleSort('activeUsers')} className="text-left px-4 py-3 text-xs font-bold text-slate-500 uppercase tracking-wider cursor-pointer hover:text-slate-300">
                      Active (30d) <SortIcon k="activeUsers" />
                    </th>
                    <th onClick={() => handleSort('createdAt')} className="text-left px-4 py-3 text-xs font-bold text-slate-500 uppercase tracking-wider cursor-pointer hover:text-slate-300">
                      Created <SortIcon k="createdAt" />
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-700/30">
                  {filtered.map(r => (
                    <tr key={r.companyId} className="hover:bg-slate-700/20 transition-colors">
                      <td className="px-6 py-4">
                        <div>
                          <p className="font-semibold text-white">{r.companyName}</p>
                          {r.domain && <p className="text-xs text-slate-500 mt-0.5">{r.domain}</p>}
                        </div>
                      </td>
                      <td className="px-4 py-4">
                        <div>
                          <p className="text-white">{r.adminName}</p>
                          <p className="text-xs text-slate-500 mt-0.5">{r.adminEmail}</p>
                        </div>
                      </td>
                      <td className="px-4 py-4">
                        <div className="flex flex-col gap-1">
                          <PlanBadge plan={r.plan} />
                          <StatusBadge status={r.status} />
                        </div>
                      </td>
                      <td className="px-4 py-4 text-slate-300 tabular-nums font-medium">{r.totalUsers}</td>
                      <td className="px-4 py-4 text-slate-300 tabular-nums">{r.employees}</td>
                      <td className="px-4 py-4">
                        <div className="text-slate-300 tabular-nums">{r.totalAssignments}</div>
                        <div className="text-xs text-slate-500 mt-0.5">{r.completedAssignments} done</div>
                      </td>
                      <td className="px-4 py-4 min-w-[120px]">
                        <CompletionBar value={r.completionRate} />
                      </td>
                      <td className="px-4 py-4 text-slate-300 tabular-nums">{r.activeUsers}</td>
                      <td className="px-4 py-4 text-slate-500 text-xs">{formatDate(r.createdAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Footer note */}
        <div className="mt-4 text-center text-slate-600 text-xs">
          All data is live from the database — no caching. Click column headers to sort.
        </div>
      </div>
    </div>
  );
}
