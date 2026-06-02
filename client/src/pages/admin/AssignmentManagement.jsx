import React, { useEffect, useState, useMemo, useCallback } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { useNavigate } from 'react-router-dom';

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
    try { data = JSON.parse(text); } catch { throw new Error(`Server returned non-JSON (${res.status})`); }
  }
  if (!res.ok) {
    const msg = typeof data?.error === 'string' ? data.error : data?.error?.message || `Request failed (${res.status})`;
    throw new Error(msg);
  }
  return data?.data ?? data;
};

const Toast = ({ message, type, onClose }) => {
  useEffect(() => { const t = setTimeout(onClose, 4000); return () => clearTimeout(t); }, [onClose]);
  const colors = { success: 'bg-emerald-500/15 border-emerald-500/30 text-emerald-300', error: 'bg-red-500/15 border-red-500/30 text-red-300', info: 'bg-indigo-500/15 border-indigo-500/30 text-indigo-300' };
  return (
    <div className={`fixed top-6 right-6 z-50 flex items-center gap-3 px-5 py-3.5 rounded-xl border backdrop-blur-xl shadow-2xl ${colors[type]}`}>
      <span className="text-sm font-semibold">{message}</span>
      <button onClick={onClose} className="ml-2 opacity-60 hover:opacity-100 text-lg leading-none">&times;</button>
    </div>
  );
};

const statusConfig = {
  assigned:    { bg: 'bg-blue-500/15',    text: 'text-blue-300',    border: 'border-blue-500/30',    label: 'Assigned' },
  pending:     { bg: 'bg-amber-500/15',   text: 'text-amber-300',   border: 'border-amber-500/30',   label: 'Pending' },
  in_progress: { bg: 'bg-violet-500/15',  text: 'text-violet-300',  border: 'border-violet-500/30',  label: 'In Progress' },
  completed:   { bg: 'bg-emerald-500/15', text: 'text-emerald-300', border: 'border-emerald-500/30', label: 'Completed' },
  overdue:     { bg: 'bg-red-500/15',     text: 'text-red-300',     border: 'border-red-500/30',     label: 'Overdue' },
  cancelled:   { bg: 'bg-slate-500/15',   text: 'text-slate-400',   border: 'border-slate-500/30',   label: 'Cancelled' },
  rejected:    { bg: 'bg-rose-500/15',    text: 'text-rose-400',    border: 'border-rose-500/30',    label: 'Rejected' },
};

const priorityConfig = {
  low:    { dot: 'bg-slate-400',  text: 'text-slate-400',  label: 'Low' },
  medium: { dot: 'bg-blue-400',   text: 'text-blue-300',   label: 'Medium' },
  high:   { dot: 'bg-orange-400', text: 'text-orange-300', label: 'High' },
  urgent: { dot: 'bg-red-500',    text: 'text-red-300',    label: 'Urgent' },
};

const SkeletonRow = () => (
  <div className="px-5 py-4 flex items-center gap-4 animate-pulse border-b border-slate-700/30">
    <div className="flex-1 h-4 bg-slate-700/50 rounded" />
    <div className="w-32 h-4 bg-slate-700/40 rounded" />
    <div className="w-20 h-4 bg-slate-700/50 rounded" />
    <div className="w-24 h-4 bg-slate-700/40 rounded" />
    <div className="w-20 h-6 bg-slate-700/50 rounded-full" />
  </div>
);

const EMPTY_FORM = { moduleId: '', employeeId: '', groupId: '', priority: 'medium', dueDate: '' };

export default function AssignmentManagement() {
  const { user, hasRole } = useAuth();
  const navigate = useNavigate();

  const [assignments, setAssignments] = useState([]);
  const [users, setUsers] = useState([]);
  const [modules, setModules] = useState([]);
  const [groups, setGroups] = useState([]);
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState(null);
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [filterStatus, setFilterStatus] = useState('all');
  const [search, setSearch] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [showPendingModal, setShowPendingModal] = useState(false);

  const isAdmin = hasRole('admin');
  const isManager = hasRole('manager');

  const showToast = useCallback((message, type = 'info') => setToast({ message, type }), []);

  useEffect(() => {
    if (!user || (!isAdmin && !isManager)) { navigate('/dashboard'); return; }
    loadAll();
    const interval = setInterval(loadAll, 30000); // refresh every 30s
    return () => clearInterval(interval);
  }, [user, navigate, isAdmin, isManager]);

  const loadAll = async () => {
    setLoading(true);
    try {
      const [assignRes, userRes, modRes, grRes] = await Promise.allSettled([
        authFetch('/api/assignments'),
        authFetch('/api/users'),
        authFetch('/api/modules'),
        authFetch('/api/content/groups'),
      ]);
      if (assignRes.status === 'fulfilled') {
        const v = assignRes.value;
        setAssignments(Array.isArray(v) ? v : (v?.assignments || []));
      }
      if (userRes.status === 'fulfilled') {
        const v = userRes.value;
        setUsers(Array.isArray(v) ? v : (v?.users || []));
      }
      if (modRes.status === 'fulfilled') {
        const v = modRes.value;
        setModules(Array.isArray(v) ? v : (v?.modules || []));
      }
      if (grRes.status === 'fulfilled') {
        const v = grRes.value;
        setGroups(Array.isArray(v) ? v : (v?.groups || []));
      }
    } catch (e) {
      showToast(e.message || 'Failed to load data', 'error');
    } finally {
      setLoading(false);
    }
  };

  const employees = useMemo(() => users.filter(u => u.role === 'employee'), [users]);

  // Filter out completely invalid/phantom rows (no ID, no employee, no module)
  const isValidAssignment = useCallback((a) => {
    const hasId = Boolean(a.id);
    const hasEmployee = Boolean(a.assigned_to_user || a.employee_id);
    const hasModule = Boolean(a.assignable_id || a.module_id);
    return hasId && (hasEmployee || hasModule);
  }, []);

  const filtered = useMemo(() => {
    return assignments.filter(a => {
      if (!isValidAssignment(a)) return false;
      const moduleId = a.assignable_id || a.module_id;
      const moduleName = getModuleName(moduleId).toLowerCase();
      const employeeName = getUserName(a.assigned_to_user || a.employee_id).toLowerCase();
      const matchesSearch = !search ||
        moduleName.includes(search.toLowerCase()) ||
        employeeName.includes(search.toLowerCase());
      const matchesStatus = filterStatus === 'all' || a.status === filterStatus;
      return matchesSearch && matchesStatus;
    });
  }, [assignments, search, filterStatus, users, modules, isValidAssignment]);

  function getUserName(uid) {
    if (!uid) return '—';
    const u = users.find(u => (u.userId || u.id) === uid);
    return u?.name || u?.email || uid;
  }

  function getModuleName(mid) {
    if (!mid) return '—';
    const m = modules.find(m => m.id === mid);
    return m?.title || mid;
  }

  const stats = useMemo(() => ({
    total: assignments.length,
    active: assignments.filter(a => a.status === 'in_progress' || a.status === 'active').length,
    completed: assignments.filter(a => a.status === 'completed' || a.completed === true).length,
    pending: assignments.filter(a => a.status === 'assigned' || a.status === 'pending').length,
    overdue: assignments.filter(a => a.status !== 'completed' && a.completed !== true && a.due_date && new Date(a.due_date) < new Date()).length,
  }), [assignments]);

  const handleCreate = async (e) => {
    e.preventDefault();
    if (!form.moduleId) { showToast('Please select a module', 'error'); return; }
    if (!form.employeeId && !form.groupId) { showToast('Please assign to an employee or group', 'error'); return; }
    setSubmitting(true);
    try {
      if (isAdmin) {
        // Admin: direct assignment
        await authFetch('/api/assignments/content', {
          method: 'POST',
          body: JSON.stringify({
            type: 'module',
            assignableId: form.moduleId,
            assignedToUser: form.employeeId || null,
            assignedToGroup: form.groupId || null,
            priority: form.priority,
            dueDate: form.dueDate || null,
          }),
        });
        showToast('Assignment created successfully', 'success');
      } else {
        // Manager: create request for admin approval
        await authFetch('/api/assignments/requests', {
          method: 'POST',
          body: JSON.stringify({
            moduleId: form.moduleId,
            employeeId: form.employeeId || null,
            groupId: form.groupId || null,
            priority: form.priority,
            dueDate: form.dueDate || null,
          }),
        });
        showToast('Assignment request submitted for admin approval', 'info');
      }
      setShowCreate(false);
      setForm(EMPTY_FORM);
      loadAll();
    } catch (e) {
      showToast(e.message || 'Failed to create assignment', 'error');
    } finally {
      setSubmitting(false);
    }
  };

  const cancelAssignment = async (id) => {
    try {
      await authFetch(`/api/assignments/${id}`, { method: 'PUT', body: JSON.stringify({ status: 'cancelled' }) });
      setAssignments(prev => prev.map(a => a.id === id ? { ...a, status: 'cancelled' } : a));
      showToast('Assignment cancelled', 'info');
    } catch (e) {
      showToast(e.message || 'Failed to cancel', 'error');
    }
  };

  const deleteAssignment = async (id) => {
    if (!window.confirm('Permanently delete this assignment? This cannot be undone.')) return;
    try {
      await authFetch(`/api/assignments/${id}`, { method: 'DELETE' });
      setAssignments(prev => prev.filter(a => a.id !== id));
      showToast('Assignment deleted', 'info');
    } catch (e) {
      showToast(e.message || 'Failed to delete assignment', 'error');
    }
  };

  return (
    <div className="min-h-screen bg-[#0F172A] text-white">
      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">

        {/* ── Header ── */}
        <div className="flex items-center justify-between mb-8">
          <div>
            <button onClick={() => navigate(isAdmin ? '/admin/dashboard' : '/manager/dashboard')}
              className="inline-flex items-center gap-1.5 text-slate-500 hover:text-slate-300 text-sm mb-3 transition-colors">
              ← Back to Dashboard
            </button>
            <h1 className="text-3xl font-black text-white tracking-tight">Assignment Management</h1>
            <p className="text-slate-400 text-sm mt-1">
              {isAdmin ? 'Create and manage learning assignments across the organisation' : 'Request module assignments for your team'}
            </p>
          </div>
          <button
            onClick={() => setShowCreate(true)}
            className="px-5 py-2.5 rounded-xl bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-500 hover:to-purple-500 text-sm font-bold transition-all shadow-lg shadow-indigo-500/25 flex items-center gap-2"
          >
            <span className="text-base">+</span>
            {isAdmin ? 'New Assignment' : 'Request Assignment'}
          </button>
        </div>

        {/* ── Stat Cards ── */}
        <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mb-8">
          {[
            { label: 'Total', value: stats.total, icon: '📋', borderCls: 'border-indigo-500/25', bgCls: 'bg-indigo-500/5', textCls: 'text-indigo-400', numCls: 'text-indigo-300', clickable: false },
            { label: 'Pending', value: stats.pending, icon: '⏳', borderCls: 'border-sky-500/25', bgCls: 'bg-sky-500/5', textCls: 'text-sky-400', numCls: 'text-sky-300', clickable: true },
            { label: 'In Progress', value: stats.active, icon: '⚡', borderCls: 'border-amber-500/25', bgCls: 'bg-amber-500/5', textCls: 'text-amber-400', numCls: 'text-amber-300', clickable: false },
            { label: 'Completed', value: stats.completed, icon: '✅', borderCls: 'border-emerald-500/25', bgCls: 'bg-emerald-500/5', textCls: 'text-emerald-400', numCls: 'text-emerald-300', clickable: false },
            { label: 'Overdue', value: stats.overdue, icon: '🚨', borderCls: 'border-red-500/25', bgCls: 'bg-red-500/5', textCls: 'text-red-400', numCls: 'text-red-300', clickable: false },
          ].map((s, i) => (
            <div
              key={i}
              onClick={s.clickable ? () => setShowPendingModal(true) : undefined}
              className={`rounded-2xl border ${s.borderCls} ${s.bgCls} p-5 flex flex-col gap-2 transition-all ${s.clickable ? 'cursor-pointer hover:scale-[1.02] hover:shadow-lg hover:shadow-sky-500/10 hover:border-sky-400/40' : ''}`}
            >
              <div className="flex items-center justify-between">
                <p className={`text-xs font-bold ${s.textCls} uppercase tracking-widest`}>{s.label}</p>
                <span className="text-lg opacity-60">{s.icon}</span>
              </div>
              <p className={`text-4xl font-black ${s.numCls} leading-none`}>{s.value}</p>
              {s.clickable && <p className="text-xs text-sky-500/60 mt-0.5">Click to view →</p>}
            </div>
          ))}
        </div>

        {/* ── Table Card ── */}
        <div className="rounded-2xl border border-slate-700/40 bg-[#111827] overflow-hidden shadow-xl">

          {/* Toolbar */}
          <div className="flex flex-col sm:flex-row sm:items-center gap-3 px-6 py-4 border-b border-slate-700/50 bg-slate-800/20">
            <div className="relative flex-1">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500 text-sm">🔍</span>
              <input
                type="text"
                placeholder="Search by module or employee name..."
                value={search}
                onChange={e => setSearch(e.target.value)}
                className="w-full pl-9 pr-4 py-2 rounded-xl bg-slate-800/80 border border-slate-700/60 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500/60 transition-colors"
              />
            </div>
            <select
              value={filterStatus}
              onChange={e => setFilterStatus(e.target.value)}
              className="px-4 py-2 rounded-xl bg-slate-800/80 border border-slate-700/60 text-sm text-slate-300 font-semibold focus:outline-none focus:border-indigo-500/60 min-w-[160px]"
            >
              <option value="all">All Status</option>
              <option value="assigned">Assigned</option>
              <option value="pending">Pending Approval</option>
              <option value="in_progress">In Progress</option>
              <option value="completed">Completed</option>
              <option value="overdue">Overdue</option>
              <option value="cancelled">Cancelled</option>
            </select>
            <button onClick={loadAll} className="px-4 py-2 rounded-xl bg-slate-800/80 border border-slate-700/60 text-sm text-slate-400 hover:text-white hover:border-slate-600 font-semibold transition-all flex items-center gap-2">
              <span>↻</span> Refresh
            </button>
          </div>

          {/* Column Headers */}
          <div className="hidden lg:grid px-6 py-3 border-b border-slate-700/40 bg-slate-800/30"
            style={{ gridTemplateColumns: '2fr 2.5fr 1fr 1fr 1.2fr 1.5fr 1fr 80px' }}>
            {['Employee', 'Module', 'Priority', 'Due Date', 'Status', 'Assigned By', 'Created', 'Actions'].map(h => (
              <div key={h} className="text-xs font-bold text-slate-500 uppercase tracking-widest">{h}</div>
            ))}
          </div>

          {/* Rows */}
          {loading ? (
            <div className="divide-y divide-slate-700/20">
              {Array.from({ length: 5 }).map((_, i) => <SkeletonRow key={i} />)}
            </div>
          ) : filtered.length === 0 ? (
            <div className="py-20 text-center">
              <div className="text-6xl mb-4 opacity-20">📋</div>
              <p className="text-lg font-bold text-slate-400 mb-1">No Assignments Found</p>
              <p className="text-sm text-slate-600">
                {assignments.length === 0 ? 'Create your first assignment to get started.' : 'Try adjusting your search or status filter.'}
              </p>
            </div>
          ) : (
            <div className="divide-y divide-slate-700/20">
              {filtered.map((a, idx) => {
                // Normalise status: treat 'active' as 'in_progress', treat completed===true as 'completed'
                const rawStatus = a.status || 'assigned';
                const status = (a.completed === true && rawStatus !== 'completed')
                  ? 'completed'
                  : rawStatus === 'active'
                  ? 'in_progress'
                  : rawStatus;
                const priority = a.priority || 'medium';
                const cfg = statusConfig[status] || statusConfig.assigned;
                const pcfg = priorityConfig[priority] || priorityConfig.medium;
                // Progress percentage
                const pct = typeof a.progress === 'number' && a.progress > 0
                  ? a.progress
                  : status === 'completed'
                    ? 100
                    : status === 'in_progress'
                      ? 50
                      : 0;
                const employeeId = a.assigned_to_user || a.employee_id;
                const moduleId = a.assignable_id || a.module_id;
                const isOverdue = status !== 'completed' && a.due_date && new Date(a.due_date) < new Date();
                const empName = getUserName(employeeId);
                const empInitial = empName !== '—' ? empName.charAt(0).toUpperCase() : '?';
                const assignedByName = getUserName(a.assigned_by || a.manager_id);
                const createdDate = a.created_at || a.createdAt;

                return (
                  <div
                    key={a.id || idx}
                    className="group px-6 py-4 hover:bg-slate-800/30 transition-all"
                    style={{ display: 'grid', gridTemplateColumns: '2fr 2.5fr 1fr 1fr 1.2fr 1.5fr 1fr 80px', alignItems: 'center', gap: '12px' }}
                  >
                    {/* Employee */}
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="w-8 h-8 rounded-full bg-gradient-to-br from-indigo-600/40 to-purple-600/30 border border-indigo-500/30 flex items-center justify-center text-xs font-black text-indigo-300 flex-shrink-0 shadow-sm">
                        {empInitial}
                      </div>
                      <div className="min-w-0">
                        <p className="text-sm font-semibold text-white truncate leading-tight">{empName}</p>
                        <p className="text-xs text-slate-600 truncate">{a.type || 'module'}</p>
                      </div>
                    </div>

                    {/* Module */}
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-slate-200 truncate leading-tight">{getModuleName(moduleId)}</p>
                      {pct > 0 && (
                        <div className="flex items-center gap-2 mt-1">
                          <div className="flex-1 h-1 rounded-full bg-slate-700/60 overflow-hidden">
                            <div className="h-full bg-indigo-500 rounded-full" style={{ width: `${pct}%` }} />
                          </div>
                          <span className="text-xs text-slate-500 flex-shrink-0">{pct}%</span>
                        </div>
                      )}
                    </div>

                    {/* Priority */}
                    <div className="flex items-center gap-1.5">
                      <span className={`w-2 h-2 rounded-full flex-shrink-0 ${pcfg.dot}`} />
                      <span className={`text-xs font-semibold ${pcfg.text}`}>{pcfg.label}</span>
                    </div>

                    {/* Due Date */}
                    <div>
                      {a.due_date ? (
                        <span className={`text-xs font-medium ${isOverdue ? 'text-red-400' : 'text-slate-400'}`}>
                          {new Date(a.due_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: '2-digit' })}
                          {isOverdue && <span className="ml-1 text-red-400">⚠</span>}
                        </span>
                      ) : (
                        <span className="text-xs text-slate-600">No deadline</span>
                      )}
                    </div>

                    {/* Status Badge */}
                    <div>
                      <span className={`inline-flex items-center px-2.5 py-1 rounded-lg text-xs font-bold uppercase tracking-wide border ${cfg.bg} ${cfg.text} ${cfg.border}`}>
                        {cfg.label}
                      </span>
                    </div>

                    {/* Assigned By */}
                    <div className="min-w-0">
                      <p className="text-sm text-slate-400 truncate">{assignedByName}</p>
                    </div>

                    {/* Created Date */}
                    <div>
                      <p className="text-xs text-slate-500">
                        {createdDate ? new Date(createdDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: '2-digit' }) : '—'}
                      </p>
                    </div>

                    {/* Actions */}
                    <div className="flex items-center gap-1.5 justify-end opacity-0 group-hover:opacity-100 transition-opacity">
                      {status !== 'completed' && status !== 'cancelled' && (
                        <button
                          onClick={() => cancelAssignment(a.id)}
                          title="Cancel assignment"
                          className="w-7 h-7 rounded-lg bg-slate-700/60 hover:bg-amber-500/20 hover:border-amber-500/40 border border-transparent text-slate-400 hover:text-amber-300 flex items-center justify-center text-xs transition-all"
                        >
                          ⊘
                        </button>
                      )}
                      {isAdmin && (
                        <button
                          onClick={() => deleteAssignment(a.id)}
                          title="Delete permanently"
                          className="w-7 h-7 rounded-lg bg-slate-700/60 hover:bg-red-500/20 hover:border-red-500/40 border border-transparent text-slate-400 hover:text-red-300 flex items-center justify-center text-xs transition-all"
                        >
                          ✕
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* Footer count */}
          {!loading && filtered.length > 0 && (
            <div className="px-6 py-3 border-t border-slate-700/30 bg-slate-800/10 flex items-center justify-between">
              <p className="text-xs text-slate-600">
                Showing <span className="text-slate-400 font-semibold">{filtered.length}</span> of <span className="text-slate-400 font-semibold">{assignments.length}</span> assignments
              </p>
              <p className="text-xs text-slate-600">
                Last refreshed: {new Date().toLocaleTimeString()}
              </p>
            </div>
          )}
        </div>
      </div>

      {/* Pending Assignments Modal */}
      {showPendingModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4" onClick={e => e.target === e.currentTarget && setShowPendingModal(false)}>
          <div className="bg-slate-900 border border-slate-700 rounded-2xl w-full max-w-2xl max-h-[85vh] flex flex-col shadow-2xl">
            {/* Header */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-700 shrink-0">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-xl bg-sky-500/15 border border-sky-500/25 flex items-center justify-center text-lg">⏳</div>
                <div>
                  <h3 className="text-lg font-black text-white">Pending Assignments</h3>
                  <p className="text-xs text-slate-500 mt-0.5">{stats.pending} assignment{stats.pending !== 1 ? 's' : ''} awaiting action</p>
                </div>
              </div>
              <button onClick={() => setShowPendingModal(false)} className="text-slate-500 hover:text-white w-8 h-8 rounded-lg hover:bg-slate-800 flex items-center justify-center transition-colors">✕</button>
            </div>

            {/* Table */}
            <div className="overflow-y-auto flex-1">
              {assignments.filter(a => a.status === 'pending' || a.status === 'assigned').length === 0 ? (
                <div className="py-16 text-center">
                  <div className="text-5xl mb-3 opacity-20">✅</div>
                  <p className="text-slate-400 font-semibold">All caught up!</p>
                  <p className="text-slate-600 text-sm mt-1">No pending assignments at this time.</p>
                </div>
              ) : (
                <>
                  {/* Column headers */}
                  <div className="grid px-6 py-3 border-b border-slate-700/40 bg-slate-800/30 text-xs font-bold text-slate-500 uppercase tracking-widest"
                    style={{ gridTemplateColumns: '1.8fr 2fr 1fr 1fr 1.2fr' }}>
                    <span>Employee</span>
                    <span>Module</span>
                    <span>Priority</span>
                    <span>Due Date</span>
                    <span>Assigned By</span>
                  </div>
                  <div className="divide-y divide-slate-700/20">
                    {assignments
                      .filter(a => a.status === 'pending' || a.status === 'assigned')
                      .map((a, idx) => {
                        const employeeId = a.assigned_to_user || a.employee_id;
                        const moduleId = a.assignable_id || a.module_id;
                        const empName = getUserName(employeeId);
                        const priority = a.priority || 'medium';
                        const pcfg = priorityConfig[priority] || priorityConfig.medium;
                        const isOverdue = a.due_date && new Date(a.due_date) < new Date();
                        return (
                          <div
                            key={a.id || idx}
                            className="grid px-6 py-4 items-center gap-3 hover:bg-slate-800/30 transition-all"
                            style={{ gridTemplateColumns: '1.8fr 2fr 1fr 1fr 1.2fr' }}
                          >
                            {/* Employee */}
                            <div className="flex items-center gap-2.5 min-w-0">
                              <div className="w-8 h-8 rounded-full bg-gradient-to-br from-sky-600/40 to-indigo-600/30 border border-sky-500/30 flex items-center justify-center text-xs font-black text-sky-300 flex-shrink-0">
                                {empName !== '—' ? empName.charAt(0).toUpperCase() : '?'}
                              </div>
                              <p className="text-sm font-semibold text-white truncate">{empName}</p>
                            </div>
                            {/* Module */}
                            <p className="text-sm text-slate-300 truncate">{getModuleName(moduleId)}</p>
                            {/* Priority */}
                            <div className="flex items-center gap-1.5">
                              <span className={`w-2 h-2 rounded-full flex-shrink-0 ${pcfg.dot}`} />
                              <span className={`text-xs font-semibold ${pcfg.text}`}>{pcfg.label}</span>
                            </div>
                            {/* Due Date */}
                            <div>
                              {a.due_date ? (
                                <span className={`text-xs font-medium ${isOverdue ? 'text-red-400' : 'text-slate-400'}`}>
                                  {new Date(a.due_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: '2-digit' })}
                                  {isOverdue && ' ⚠'}
                                </span>
                              ) : <span className="text-xs text-slate-600">No deadline</span>}
                            </div>
                            {/* Assigned By */}
                            <p className="text-xs text-slate-400 truncate">{getUserName(a.assigned_by || a.manager_id)}</p>
                          </div>
                        );
                      })}
                  </div>
                </>
              )}
            </div>

            {/* Footer */}
            <div className="px-6 py-4 border-t border-slate-700 shrink-0 flex items-center justify-between">
              <p className="text-xs text-slate-600">
                Showing <span className="text-slate-400 font-semibold">{assignments.filter(a => a.status === 'pending' || a.status === 'assigned').length}</span> pending assignment{assignments.filter(a => a.status === 'pending' || a.status === 'assigned').length !== 1 ? 's' : ''}
              </p>
              <button
                onClick={() => setShowPendingModal(false)}
                className="px-4 py-2 rounded-xl bg-slate-800 border border-slate-700 text-sm text-slate-300 hover:text-white hover:bg-slate-700 transition-colors"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Create Modal */}
      {showCreate && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
          <div className="bg-slate-900 border border-slate-700 rounded-2xl p-6 w-full max-w-md shadow-2xl">
            <div className="flex items-center justify-between mb-6">
              <div>
                <h3 className="text-lg font-black text-white">
                  {isAdmin ? 'New Assignment' : 'Request Assignment'}
                </h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  {isAdmin ? 'Assign a module directly to an employee' : 'Submit a request for admin approval'}
                </p>
              </div>
              <button onClick={() => { setShowCreate(false); setForm(EMPTY_FORM); }} className="text-slate-500 hover:text-white text-xl transition-colors">✕</button>
            </div>

            <form onSubmit={handleCreate} className="space-y-4">
              {/* Module Select */}
              <div>
                <label className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-1.5 block">
                  Select Module <span className="text-red-400">*</span>
                </label>
                <select
                  value={form.moduleId}
                  onChange={e => setForm({ ...form, moduleId: e.target.value })}
                  className="w-full px-3 py-2.5 rounded-xl bg-slate-800 border border-slate-700 text-white text-sm focus:border-indigo-500 focus:outline-none"
                  required
                >
                  <option value="">— Select a module —</option>
                  {modules.map(m => (
                    <option key={m.id} value={m.id}>{m.title || m.name || 'Untitled'}</option>
                  ))}
                </select>
                {modules.length === 0 && (
                  <p className="text-xs text-amber-400/70 mt-1">No modules yet — create one first</p>
                )}
              </div>

              {/* Assign To Employee */}
              <div>
                <label className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-1.5 block">
                  Assign To Employee
                </label>
                <select
                  value={form.employeeId}
                  onChange={e => setForm({ ...form, employeeId: e.target.value, groupId: '' })}
                  className="w-full px-3 py-2.5 rounded-xl bg-slate-800 border border-slate-700 text-white text-sm focus:border-indigo-500 focus:outline-none"
                >
                  <option value="">— Select employee —</option>
                  {employees.map(u => (
                    <option key={u.userId || u.id} value={u.userId || u.id}>
                      {u.name} {u.email ? `(${u.email})` : ''}
                    </option>
                  ))}
                </select>
              </div>

              {/* Group (optional) */}
              <div>
                <label className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-1.5 block">
                  Group <span className="text-slate-600">(optional)</span>
                </label>
                <select
                  value={form.groupId}
                  onChange={e => setForm({ ...form, groupId: e.target.value, employeeId: '' })}
                  className="w-full px-3 py-2.5 rounded-xl bg-slate-800 border border-slate-700 text-white text-sm focus:border-indigo-500 focus:outline-none"
                >
                  <option value="">— No group —</option>
                  {groups.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}
                </select>
              </div>

              {/* Priority + Due Date */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-1.5 block">Priority</label>
                  <select
                    value={form.priority}
                    onChange={e => setForm({ ...form, priority: e.target.value })}
                    className="w-full px-3 py-2.5 rounded-xl bg-slate-800 border border-slate-700 text-white text-sm focus:border-indigo-500 focus:outline-none"
                  >
                    <option value="low">Low</option>
                    <option value="medium">Medium</option>
                    <option value="high">High</option>
                    <option value="urgent">Urgent</option>
                  </select>
                </div>
                <div>
                  <label className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-1.5 block">Due Date</label>
                  <input
                    type="date"
                    value={form.dueDate}
                    onChange={e => setForm({ ...form, dueDate: e.target.value })}
                    min={new Date().toISOString().split('T')[0]}
                    className="w-full px-3 py-2.5 rounded-xl bg-slate-800 border border-slate-700 text-white text-sm focus:border-indigo-500 focus:outline-none"
                  />
                </div>
              </div>

              {/* Role hint */}
              {isManager && (
                <div className="flex items-start gap-2 p-3 rounded-xl bg-amber-500/8 border border-amber-500/20">
                  <span className="text-amber-400 text-sm">⚠️</span>
                  <p className="text-xs text-amber-300/80">As a manager, your request will be sent to an admin for approval before the assignment is created.</p>
                </div>
              )}

              <div className="flex gap-3 pt-1">
                <button
                  type="submit"
                  disabled={submitting}
                  className="flex-1 py-2.5 rounded-xl bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-500 hover:to-purple-500 text-sm font-bold transition-all disabled:opacity-50"
                >
                  {submitting ? '...' : isAdmin ? 'Create Assignment' : 'Submit Request'}
                </button>
                <button
                  type="button"
                  onClick={() => { setShowCreate(false); setForm(EMPTY_FORM); }}
                  className="px-5 py-2.5 rounded-xl bg-slate-800 border border-slate-700 text-sm font-semibold hover:bg-slate-700 transition-all"
                >
                  Cancel
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
