/**
 * pages/admin/AdminDashboard.jsx
 * Enterprise Admin Dashboard — org analytics, approval workflow, platform overview
 */

import React, { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';

const BASE_URL = import.meta.env.PROD ? '' : 'http://localhost:3001';

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
  if (text) {
    try { data = JSON.parse(text); } catch { throw new Error(`Server error (${res.status})`); }
  }
  if (!res.ok) {
    const msg = typeof data?.error === 'string' ? data.error : data?.error?.message || `Request failed (${res.status})`;
    throw new Error(msg);
  }
  return data?.data ?? data;
};

const Toast = ({ message, type, onClose }) => {
  useEffect(() => { const t = setTimeout(onClose, 4000); return () => clearTimeout(t); }, [onClose]);
  const colors = {
    success: 'bg-emerald-500/15 border-emerald-500/30 text-emerald-300',
    error: 'bg-red-500/15 border-red-500/30 text-red-300',
    info: 'bg-indigo-500/15 border-indigo-500/30 text-indigo-300',
  };
  return (
    <div className={`fixed top-6 right-6 z-50 flex items-center gap-3 px-5 py-3.5 rounded-xl border backdrop-blur-xl shadow-2xl ${colors[type]}`}>
      <span className="text-sm font-semibold">{message}</span>
      <button onClick={onClose} className="ml-2 text-current/50 hover:text-current text-lg leading-none">&times;</button>
    </div>
  );
};

const Skeleton = ({ className = '' }) => (
  <div className={`animate-pulse rounded-lg bg-slate-700/40 ${className}`} />
);

const StatCard = ({ label, value, icon, borderClass, bgClass, textClass }) => (
  <div className={`rounded-xl border ${borderClass} ${bgClass} p-4`}>
    <div className="flex items-center justify-between">
      <div>
        <p className={`text-xs font-bold ${textClass} uppercase tracking-widest mb-2`}>{label}</p>
        <p className="text-2xl font-black text-white">{value}</p>
      </div>
      <div className="text-3xl opacity-50">{icon}</div>
    </div>
  </div>
);

export default function AdminDashboard() {
  const { user } = useAuth();
  const navigate = useNavigate();

  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState(null);
  const [activeTab, setActiveTab] = useState('overview');
  const [stats, setStats] = useState(null);
  const [pendingRequests, setPendingRequests] = useState([]);
  const [allRequests, setAllRequests] = useState([]);
  const [approvingId, setApprovingId] = useState(null);
  const [users, setUsers] = useState([]);
  const [modules, setModules] = useState([]);
  const [selectedRequest, setSelectedRequest] = useState(null);

  const showToast = useCallback((message, type = 'info') => {
    setToast({ message, type });
  }, []);

  useEffect(() => {
    if (!user || user.role !== 'admin') { navigate('/dashboard'); return; }
    loadAll();
  }, [user, navigate]);

  const loadAll = async () => {
    setLoading(true);
    try {
      const [usersRes, modulesRes, assignmentsRes, requestsRes] = await Promise.allSettled([
        authFetch('/api/users'),
        authFetch('/api/modules'),
        authFetch('/api/assignments'),
        authFetch('/api/assignments/requests'),
      ]);

      const usersData = usersRes.status === 'fulfilled' ? (usersRes.value?.users || usersRes.value || []) : [];
      const modulesData = modulesRes.status === 'fulfilled' ? (modulesRes.value?.modules || modulesRes.value || []) : [];
      const assignmentsData = assignmentsRes.status === 'fulfilled' ? (assignmentsRes.value?.assignments || assignmentsRes.value || []) : [];
      const requestsData = requestsRes.status === 'fulfilled' ? (requestsRes.value?.requests || requestsRes.value || []) : [];

      setUsers(Array.isArray(usersData) ? usersData : []);
      setModules(Array.isArray(modulesData) ? modulesData : []);
      const reqArr = Array.isArray(requestsData) ? requestsData : [];
      setAllRequests(reqArr);
      setPendingRequests(reqArr.filter(r => r.status === 'pending'));

      const aList = Array.isArray(assignmentsData) ? assignmentsData : [];
      setStats({
        totalUsers: usersData.length,
        totalAdmins: usersData.filter(u => u.role === 'admin').length,
        totalManagers: usersData.filter(u => u.role === 'manager').length,
        totalEmployees: usersData.filter(u => u.role === 'employee').length,
        activeSessions: aList.filter(a => a.status === 'in_progress').length,
        completedModules: aList.filter(a => a.status === 'completed').length,
        totalModules: modulesData.length,
        avgCompletionRate: aList.length > 0
          ? Math.round(aList.reduce((s, a) => s + (a.progress || 0), 0) / aList.length)
          : 0,
        totalAssignments: aList.length,
        pendingAssignments: aList.filter(a => a.status === 'assigned').length,
        pendingRequests: requestsData.filter(r => r.status === 'pending').length,
      });
    } catch (err) {
      showToast(err.message || 'Failed to load dashboard', 'error');
    } finally {
      setLoading(false);
    }
  };

  const approveRequest = async (id) => {
    setApprovingId(id);
    try {
      await authFetch(`/api/assignments/requests/${id}/approve`, { method: 'POST' });
      showToast('Request approved — assignment created', 'success');
      setPendingRequests(prev => prev.filter(r => r.id !== id));
      setAllRequests(prev => prev.map(r => r.id === id ? { ...r, status: 'approved' } : r));
      setStats(prev => prev ? { ...prev, pendingRequests: Math.max(0, prev.pendingRequests - 1) } : prev);
    } catch (err) {
      showToast(err.message || 'Failed to approve', 'error');
    } finally {
      setApprovingId(null);
    }
  };

  const rejectRequest = async (id) => {
    setApprovingId(id);
    try {
      await authFetch(`/api/assignments/requests/${id}/reject`, { method: 'POST' });
      showToast('Request rejected', 'info');
      setPendingRequests(prev => prev.filter(r => r.id !== id));
      setAllRequests(prev => prev.map(r => r.id === id ? { ...r, status: 'rejected' } : r));
      setStats(prev => prev ? { ...prev, pendingRequests: Math.max(0, prev.pendingRequests - 1) } : prev);
    } catch (err) {
      showToast(err.message || 'Failed to reject', 'error');
    } finally {
      setApprovingId(null);
    }
  };

  if (!user || user.role !== 'admin') return null;

  const statCards = [
    { label: 'Total Users', value: stats?.totalUsers ?? '—', icon: '👥', borderClass: 'border-indigo-500/20', bgClass: 'bg-indigo-500/5', textClass: 'text-indigo-400' },
    { label: 'Managers', value: stats?.totalManagers ?? '—', icon: '👔', borderClass: 'border-sky-500/20', bgClass: 'bg-sky-500/5', textClass: 'text-sky-400' },
    { label: 'Employees', value: stats?.totalEmployees ?? '—', icon: '👨‍💼', borderClass: 'border-fuchsia-500/20', bgClass: 'bg-fuchsia-500/5', textClass: 'text-fuchsia-400' },
    { label: 'Active Sessions', value: stats?.activeSessions ?? '—', icon: '⚡', borderClass: 'border-amber-500/20', bgClass: 'bg-amber-500/5', textClass: 'text-amber-400' },
    { label: 'Modules', value: stats?.totalModules ?? '—', icon: '📚', borderClass: 'border-emerald-500/20', bgClass: 'bg-emerald-500/5', textClass: 'text-emerald-400' },
    { label: 'Avg Completion', value: stats ? `${stats.avgCompletionRate}%` : '—', icon: '📊', borderClass: 'border-cyan-500/20', bgClass: 'bg-cyan-500/5', textClass: 'text-cyan-400' },
    { label: 'Completed', value: stats?.completedModules ?? '—', icon: '✅', borderClass: 'border-emerald-500/20', bgClass: 'bg-emerald-500/5', textClass: 'text-emerald-400' },
    { label: 'Pending Approvals', value: stats?.pendingRequests ?? '—', icon: '⏳', borderClass: 'border-rose-500/20', bgClass: 'bg-rose-500/5', textClass: 'text-rose-400' },
  ];

  const tabs = [
    { id: 'overview', label: '📊 Overview' },
    { id: 'approvals', label: `⏳ Approvals${stats?.pendingRequests ? ` (${stats.pendingRequests})` : ''}` },
    { id: 'assignments', label: '📋 Assignments' },
  ];

  return (
    <div className="min-h-screen bg-[#0F172A] px-4 sm:px-6 py-8 max-w-7xl mx-auto">
      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}

      <div className="mb-8 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 rounded-2xl bg-indigo-600/20 border border-indigo-500/30 flex items-center justify-center text-2xl">👑</div>
          <div>
            <h1 className="text-3xl font-black text-white">Admin Dashboard</h1>
            <p className="text-slate-400 text-sm">Platform-wide analytics &amp; enterprise control</p>
          </div>
        </div>
        <button
          onClick={loadAll}
          className="px-4 py-2 rounded-xl bg-slate-800/60 border border-slate-700/50 text-slate-400 hover:text-white text-sm font-semibold transition-all flex items-center gap-2"
        >
          <span className="text-base">↻</span> Refresh
        </button>
      </div>

      {/* Stats Grid */}
      {loading ? (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
          {[...Array(8)].map((_, i) => <Skeleton key={i} className="h-24 rounded-xl" />)}
        </div>
      ) : (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
          {statCards.map((s, i) => <StatCard key={i} {...s} />)}
        </div>
      )}

      {/* Tabs */}
      <div className="flex gap-2 mb-6 overflow-x-auto pb-2">
        {tabs.map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`px-4 py-2 rounded-lg font-semibold whitespace-nowrap transition-all text-sm ${
              activeTab === tab.id
                ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-500/30'
                : 'bg-slate-800/50 border border-slate-700 text-slate-400 hover:text-white'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* ── Overview ── */}
      {activeTab === 'overview' && (
        <div className="space-y-6">
          {/* Platform Health Row */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
            {/* User Breakdown */}
            <div className="rounded-2xl border border-slate-700/50 bg-slate-800/30 p-6">
              <div className="flex items-center justify-between mb-5">
                <h3 className="text-xs font-bold text-slate-400 uppercase tracking-widest">User Breakdown</h3>
                <span className="text-2xl">👥</span>
              </div>
              <div className="space-y-3">
                {[
                  { label: 'Total Users', value: stats?.totalUsers || 0, bar: 100, color: 'bg-indigo-500' },
                  { label: 'Admins', value: stats?.totalAdmins || 0, bar: stats?.totalUsers ? Math.round((stats.totalAdmins / stats.totalUsers) * 100) : 0, color: 'bg-rose-500' },
                  { label: 'Managers', value: stats?.totalManagers || 0, bar: stats?.totalUsers ? Math.round((stats.totalManagers / stats.totalUsers) * 100) : 0, color: 'bg-amber-500' },
                  { label: 'Employees', value: stats?.totalEmployees || 0, bar: stats?.totalUsers ? Math.round((stats.totalEmployees / stats.totalUsers) * 100) : 0, color: 'bg-emerald-500' },
                ].map((item, i) => (
                  <div key={i}>
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-sm text-slate-300">{item.label}</span>
                      <span className="text-sm font-bold text-white">{item.value}</span>
                    </div>
                    <div className="h-1.5 rounded-full bg-slate-700/50">
                      <div className={`h-full rounded-full ${item.color} transition-all`} style={{ width: `${item.bar}%` }} />
                    </div>
                  </div>
                ))}
              </div>
              <button onClick={() => navigate('/admin/users')} className="mt-5 w-full py-2 rounded-xl bg-slate-700/40 hover:bg-slate-700/70 text-xs font-bold text-slate-300 transition-all">
                Manage Users →
              </button>
            </div>

            {/* Learning Activity */}
            <div className="rounded-2xl border border-slate-700/50 bg-slate-800/30 p-6">
              <div className="flex items-center justify-between mb-5">
                <h3 className="text-xs font-bold text-slate-400 uppercase tracking-widest">Learning Activity</h3>
                <span className="text-2xl">📚</span>
              </div>
              <div className="space-y-4">
                {[
                  { label: 'Total Modules', value: stats?.totalModules || 0, icon: '📚', sub: 'in library' },
                  { label: 'Active Sessions', value: stats?.activeSessions || 0, icon: '⚡', sub: 'in progress' },
                  { label: 'Completed Modules', value: stats?.completedModules || 0, icon: '✅', sub: 'finished' },
                  { label: 'Avg Completion', value: `${stats?.avgCompletionRate || 0}%`, icon: '📊', sub: 'overall rate' },
                ].map((item, i) => (
                  <div key={i} className="flex items-center gap-3">
                    <span className="text-xl w-8 flex-shrink-0">{item.icon}</span>
                    <div className="flex-1 min-w-0">
                      <p className="text-xs text-slate-500">{item.label}</p>
                      <p className="text-base font-black text-white leading-tight">{item.value} <span className="text-xs font-normal text-slate-500">{item.sub}</span></p>
                    </div>
                  </div>
                ))}
              </div>
              <button onClick={() => navigate('/admin/modules')} className="mt-5 w-full py-2 rounded-xl bg-slate-700/40 hover:bg-slate-700/70 text-xs font-bold text-slate-300 transition-all">
                Manage Modules →
              </button>
            </div>

            {/* Assignment Pipeline */}
            <div className="rounded-2xl border border-slate-700/50 bg-slate-800/30 p-6">
              <div className="flex items-center justify-between mb-5">
                <h3 className="text-xs font-bold text-slate-400 uppercase tracking-widest">Assignment Pipeline</h3>
                <span className="text-2xl">📋</span>
              </div>
              <div className="grid grid-cols-2 gap-3 mb-4">
                {[
                  { label: 'Total', value: stats?.totalAssignments || 0, color: 'border-indigo-500/30 bg-indigo-500/5 text-indigo-400' },
                  { label: 'In Progress', value: stats?.activeSessions || 0, color: 'border-amber-500/30 bg-amber-500/5 text-amber-400' },
                  { label: 'Completed', value: stats?.completedModules || 0, color: 'border-emerald-500/30 bg-emerald-500/5 text-emerald-400' },
                  { label: 'Pending', value: stats?.pendingAssignments || 0, color: 'border-sky-500/30 bg-sky-500/5 text-sky-400' },
                ].map((s, i) => (
                  <div key={i} className={`rounded-xl border p-3 text-center ${s.color}`}>
                    <p className="text-xl font-black">{s.value}</p>
                    <p className="text-xs font-bold opacity-70 uppercase tracking-wider mt-0.5">{s.label}</p>
                  </div>
                ))}
              </div>
              {stats?.pendingRequests > 0 && (
                <div className="rounded-xl bg-rose-500/10 border border-rose-500/20 p-3 mb-3 flex items-center justify-between">
                  <div>
                    <p className="text-xs font-bold text-rose-300">{stats.pendingRequests} Pending Approval{stats.pendingRequests > 1 ? 's' : ''}</p>
                    <p className="text-xs text-rose-400/60">Requires your review</p>
                  </div>
                  <button onClick={() => setActiveTab('approvals')} className="text-xs font-bold text-rose-300 hover:text-rose-200">
                    Review →
                  </button>
                </div>
              )}
              <button onClick={() => navigate('/admin/assignments')} className="w-full py-2 rounded-xl bg-slate-700/40 hover:bg-slate-700/70 text-xs font-bold text-slate-300 transition-all">
                Manage Assignments →
              </button>
            </div>
          </div>

          {/* Bottom Analytics Row */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
            {/* Completion Rate Visualization */}
            <div className="rounded-2xl border border-slate-700/50 bg-slate-800/30 p-6">
              <h3 className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-4">Platform Completion Rate</h3>
              <div className="flex items-end gap-4">
                <div className="flex-1">
                  <div className="flex items-baseline gap-2 mb-2">
                    <span className="text-5xl font-black text-white">{stats?.avgCompletionRate || 0}</span>
                    <span className="text-2xl font-bold text-slate-400">%</span>
                  </div>
                  <p className="text-xs text-slate-500 mb-4">Average across all active assignments</p>
                  <div className="h-3 rounded-full bg-slate-700/50 overflow-hidden">
                    <div
                      className="h-full rounded-full bg-gradient-to-r from-indigo-500 to-purple-500 transition-all duration-700"
                      style={{ width: `${stats?.avgCompletionRate || 0}%` }}
                    />
                  </div>
                </div>
              </div>
              <div className="mt-4 pt-4 border-t border-slate-700/40 grid grid-cols-3 gap-3 text-center">
                {[
                  { label: 'Completed', value: stats?.completedModules || 0, cls: 'text-emerald-400' },
                  { label: 'Active', value: stats?.activeSessions || 0, cls: 'text-amber-400' },
                  { label: 'Total', value: stats?.totalAssignments || 0, cls: 'text-indigo-400' },
                ].map((s, i) => (
                  <div key={i}>
                    <p className={`text-lg font-black ${s.cls}`}>{s.value}</p>
                    <p className="text-xs text-slate-500 font-semibold">{s.label}</p>
                  </div>
                ))}
              </div>
            </div>

            {/* Recent Activity / Quick Stats */}
            <div className="rounded-2xl border border-slate-700/50 bg-slate-800/30 p-6">
              <h3 className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-4">Platform Summary</h3>
              <div className="space-y-3">
                {[
                  { icon: '👥', label: 'Registered Users', value: stats?.totalUsers || 0, color: 'text-indigo-400' },
                  { icon: '📚', label: 'Available Modules', value: stats?.totalModules || 0, color: 'text-violet-400' },
                  { icon: '📋', label: 'Total Assignments', value: stats?.totalAssignments || 0, color: 'text-sky-400' },
                  { icon: '⏳', label: 'Pending Approvals', value: stats?.pendingRequests || 0, color: stats?.pendingRequests > 0 ? 'text-rose-400 font-black' : 'text-slate-400' },
                  { icon: '✅', label: 'Modules Completed', value: stats?.completedModules || 0, color: 'text-emerald-400' },
                ].map((item, i) => (
                  <div key={i} className="flex items-center gap-3 py-1.5 border-b border-slate-700/20 last:border-0">
                    <span className="text-xl w-8 flex-shrink-0">{item.icon}</span>
                    <span className="text-sm text-slate-300 flex-1">{item.label}</span>
                    <span className={`text-sm font-bold ${item.color}`}>{item.value}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Approvals ── */}
      {activeTab === 'approvals' && (
        <>
          {/* Request detail popup */}
          {selectedRequest && (() => {
            const req = selectedRequest;
            const manager = users.find(u => (u.userId || u.id) === req.manager_id);
            const employee = users.find(u => (u.userId || u.id) === req.employee_id);
            const module = modules.find(m => m.id === req.module_id);
            return (
              <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={() => setSelectedRequest(null)}>
                <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />
                <div className="relative w-full max-w-lg rounded-2xl border border-slate-700/60 bg-[#131C2E] shadow-2xl overflow-hidden" onClick={e => e.stopPropagation()}>
                  <div className="flex items-center justify-between p-5 border-b border-slate-700/50">
                    <div>
                      <h2 className="text-base font-black text-white">Assignment Request</h2>
                      <p className="text-xs text-slate-400 mt-0.5">Review and take action</p>
                    </div>
                    <button onClick={() => setSelectedRequest(null)} className="w-8 h-8 rounded-lg bg-slate-700/50 hover:bg-slate-700 text-slate-400 hover:text-white flex items-center justify-center transition-all">&times;</button>
                  </div>
                  <div className="p-5 space-y-4">
                    <div className="grid grid-cols-2 gap-3">
                      {[
                        { label: 'Action Type', value: 'Module Assignment', icon: '📋' },
                        { label: 'Status', value: req.status || 'pending', icon: '⏳', cls: 'capitalize' },
                        { label: 'Module', value: module?.title || req.module_id || '—', icon: '📚' },
                        { label: 'Manager', value: manager?.name || req.manager_id || '—', icon: '👔' },
                        { label: 'Employee', value: employee?.name || req.employee_id || '—', icon: '👤' },
                        { label: 'Created', value: new Date(req.requested_at || req.created_at || Date.now()).toLocaleDateString(), icon: '📅' },
                        { label: 'Priority', value: req.priority || 'medium', icon: '🎯', cls: 'capitalize' },
                        { label: 'Due Date', value: req.due_date ? new Date(req.due_date).toLocaleDateString() : '—', icon: '🗓️' },
                      ].map(item => (
                        <div key={item.label} className="rounded-lg bg-slate-800/50 border border-slate-700/40 p-3">
                          <p className="text-xs font-bold text-slate-500 uppercase tracking-widest mb-0.5">{item.icon} {item.label}</p>
                          <p className={`text-sm font-semibold text-white ${item.cls || ''}`}>{item.value}</p>
                        </div>
                      ))}
                    </div>
                    {module && (
                      <div className="rounded-lg bg-indigo-900/20 border border-indigo-500/20 p-3">
                        <p className="text-xs font-bold text-indigo-400 uppercase tracking-widest mb-1">Module Details</p>
                        <p className="text-sm font-bold text-white">{module.title}</p>
                        {module.description && <p className="text-xs text-slate-400 mt-0.5 line-clamp-2">{module.description}</p>}
                        {module.difficulty && <span className="inline-block mt-1 text-xs font-bold uppercase px-2 py-0.5 rounded-full bg-slate-700/40 text-slate-300 border border-slate-600/40">{module.difficulty}</span>}
                      </div>
                    )}
                  </div>
                  {req.status === 'pending' && (
                    <div className="flex gap-3 p-5 border-t border-slate-700/50">
                      <button
                        onClick={() => { approveRequest(req.id); setSelectedRequest(null); }}
                        disabled={approvingId === req.id}
                        className="flex-1 py-2.5 rounded-xl bg-emerald-600/20 border border-emerald-500/30 text-emerald-300 hover:bg-emerald-600/30 text-sm font-bold transition-all disabled:opacity-50"
                      >
                        ✓ Approve Request
                      </button>
                      <button
                        onClick={() => { rejectRequest(req.id); setSelectedRequest(null); }}
                        disabled={approvingId === req.id}
                        className="flex-1 py-2.5 rounded-xl bg-red-600/20 border border-red-500/30 text-red-300 hover:bg-red-600/30 text-sm font-bold transition-all disabled:opacity-50"
                      >
                        ✕ Reject
                      </button>
                    </div>
                  )}
                </div>
              </div>
            );
          })()}

          <div className="space-y-4">
            {/* Stats row */}
            <div className="grid grid-cols-3 gap-4">
              <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 p-4 text-center">
                <p className="text-2xl font-black text-amber-400">{pendingRequests.length}</p>
                <p className="text-xs font-bold text-amber-400/70 uppercase tracking-widest mt-0.5">Pending</p>
              </div>
              <div className="rounded-xl border border-indigo-500/20 bg-indigo-500/5 p-4 text-center">
                <p className="text-2xl font-black text-indigo-400">{allRequests.length}</p>
                <p className="text-xs font-bold text-indigo-400/70 uppercase tracking-widest mt-0.5">Total Requests</p>
              </div>
              <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-4 text-center">
                <p className="text-2xl font-black text-emerald-400">{allRequests.length - pendingRequests.length}</p>
                <p className="text-xs font-bold text-emerald-400/70 uppercase tracking-widest mt-0.5">Reviewed</p>
              </div>
            </div>

            {/* Table */}
            <div className="rounded-2xl border border-slate-700/40 bg-[#111827] overflow-hidden shadow-xl">
              {/* Table header */}
              <div className="grid border-b border-slate-700/40 bg-slate-800/30 px-5 py-3"
                style={{ gridTemplateColumns: '2fr 1.5fr 1.5fr 1fr 160px' }}>
                {['Module', 'Employee', 'Manager', 'Date', 'Actions'].map(h => (
                  <div key={h} className="text-xs font-bold text-slate-500 uppercase tracking-widest">{h}</div>
                ))}
              </div>

              {loading ? (
                <div className="divide-y divide-slate-700/20">
                  {[...Array(3)].map((_, i) => (
                    <div key={i} className="px-5 py-4 flex items-center gap-4 animate-pulse">
                      <div className="flex-1 h-4 bg-slate-700/50 rounded" />
                      <div className="w-28 h-4 bg-slate-700/40 rounded" />
                      <div className="w-28 h-4 bg-slate-700/50 rounded" />
                      <div className="w-16 h-4 bg-slate-700/40 rounded" />
                      <div className="w-28 h-6 bg-slate-700/50 rounded-lg" />
                    </div>
                  ))}
                </div>
              ) : pendingRequests.length === 0 ? (
                <div className="text-center py-16">
                  <div className="text-5xl mb-3 opacity-20">✅</div>
                  <p className="text-base font-bold text-slate-400">No Pending Requests</p>
                  <p className="text-xs text-slate-600 mt-1">All assignment requests have been reviewed.</p>
                </div>
              ) : (
                <div className="divide-y divide-slate-700/20">
                  {pendingRequests.map((req) => {
                    const manager = users.find(u => (u.userId || u.id) === req.manager_id);
                    const employee = users.find(u => (u.userId || u.id) === req.employee_id);
                    const module = modules.find(m => m.id === req.module_id);
                    return (
                      <div
                        key={req.id}
                        onClick={() => setSelectedRequest(req)}
                        className="group grid items-center px-5 py-4 hover:bg-slate-800/30 cursor-pointer transition-all"
                        style={{ gridTemplateColumns: '2fr 1.5fr 1.5fr 1fr 160px' }}
                      >
                        <div className="min-w-0 pr-3">
                          <p className="text-sm font-semibold text-white truncate">{module?.title || 'Unknown Module'}</p>
                          <p className="text-xs text-slate-600 truncate">{module?.difficulty || 'Module Assignment'}</p>
                        </div>
                        <div className="min-w-0 pr-3">
                          <p className="text-sm text-slate-300 truncate">{employee?.name || '—'}</p>
                          <p className="text-xs text-slate-600 truncate">{employee?.email || req.employee_id || '—'}</p>
                        </div>
                        <div className="min-w-0 pr-3">
                          <p className="text-sm text-slate-300 truncate">{manager?.name || '—'}</p>
                        </div>
                        <div className="text-xs text-slate-500 pr-3 whitespace-nowrap">
                          {new Date(req.requested_at || req.created_at || Date.now()).toLocaleDateString()}
                        </div>
                        <div className="flex gap-1.5">
                          <button
                            onClick={(e) => { e.stopPropagation(); approveRequest(req.id); }}
                            disabled={approvingId === req.id}
                            title="Approve"
                            className="px-2.5 py-1.5 rounded-lg bg-emerald-600/20 border border-emerald-500/30 text-emerald-300 hover:bg-emerald-600/30 text-xs font-bold transition-all disabled:opacity-50"
                          >
                            {approvingId === req.id ? '…' : '✓'}
                          </button>
                          <button
                            onClick={(e) => { e.stopPropagation(); rejectRequest(req.id); }}
                            disabled={approvingId === req.id}
                            title="Reject"
                            className="px-2.5 py-1.5 rounded-lg bg-red-600/20 border border-red-500/30 text-red-300 hover:bg-red-600/30 text-xs font-bold transition-all disabled:opacity-50"
                          >
                            ✕
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </>
      )}

      {/* ── Assignments ── */}
      {activeTab === 'assignments' && (
        <div className="rounded-2xl border border-slate-700/40 bg-[#111827] p-6 shadow-xl">
          <h3 className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-5">Assignment Summary</h3>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
            {[
              { label: 'Total', value: stats?.totalAssignments || 0, borderCls: 'border-indigo-500/25', bgCls: 'bg-indigo-500/5', textCls: 'text-indigo-400' },
              { label: 'In Progress', value: stats?.activeSessions || 0, borderCls: 'border-amber-500/25', bgCls: 'bg-amber-500/5', textCls: 'text-amber-400' },
              { label: 'Completed', value: stats?.completedModules || 0, borderCls: 'border-emerald-500/25', bgCls: 'bg-emerald-500/5', textCls: 'text-emerald-400' },
              { label: 'Pending', value: stats?.pendingAssignments || 0, borderCls: 'border-sky-500/25', bgCls: 'bg-sky-500/5', textCls: 'text-sky-400' },
            ].map(s => (
              <div key={s.label} className={`p-4 rounded-xl border ${s.borderCls} ${s.bgCls} text-center`}>
                <p className={`text-xs font-bold ${s.textCls} uppercase tracking-widest mb-1`}>{s.label}</p>
                <p className="text-3xl font-black text-white">{s.value}</p>
              </div>
            ))}
          </div>
          <button
            onClick={() => navigate('/admin/assignments')}
            className="w-full py-3 rounded-xl bg-indigo-600/20 border border-indigo-500/30 text-indigo-300 hover:bg-indigo-600/30 transition-all text-sm font-bold"
          >
            Manage All Assignments →
          </button>
        </div>
      )}
    </div>
  );
}
