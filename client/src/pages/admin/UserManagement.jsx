import React, { useState, useEffect, useMemo } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { useNavigate } from 'react-router-dom';

const BASE_URL = import.meta.env.PROD ? '' : 'http://localhost:3001';

const authFetch = async (path, options = {}) => {
  const token = localStorage.getItem('auth_token');
  const res = await fetch(`${BASE_URL}${path}`, {
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(options.headers || {}) },
    ...options,
  });
  const text = await res.text();
  let data = null;
  if (text) { try { data = JSON.parse(text); } catch { throw new Error(`Server error (${res.status})`); } }
  if (!res.ok) { const msg = typeof data?.error === 'string' ? data.error : data?.error?.message || `Request failed (${res.status})`; throw new Error(msg); }
  return data?.data ?? data;
};

// ─── Helpers ────────────────────────────────────────────────────────────────

function getAvatarInitials(name) {
  if (!name) return '?';
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0][0]?.toUpperCase() || '?';
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function formatDate(dateString) {
  if (!dateString) return '—';
  const date = new Date(dateString);
  if (isNaN(date.getTime())) return '—';
  return date.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
}

const ROLE_RANK = { admin: 0, manager: 1, employee: 2 };

function getStatusBadge(status) {
  switch (status) {
    case 'active':   return 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30';
    case 'blocked':  return 'bg-red-500/20 text-red-400 border-red-500/30';
    case 'inactive': return 'bg-slate-500/20 text-slate-400 border-slate-500/30';
    default:         return 'bg-slate-500/20 text-slate-400 border-slate-500/30';
  }
}

function getRoleBadge(role) {
  switch (role) {
    case 'admin':    return 'bg-purple-500/20 text-purple-300 border-purple-500/30';
    case 'manager':  return 'bg-indigo-500/20 text-indigo-300 border-indigo-500/30';
    case 'employee': return 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30';
    default:         return 'bg-slate-500/20 text-slate-300 border-slate-500/30';
  }
}

function getAvatarColor(role) {
  switch (role) {
    case 'admin':    return 'bg-purple-600/30 border-purple-500/40 text-purple-300';
    case 'manager':  return 'bg-indigo-600/30 border-indigo-500/40 text-indigo-300';
    case 'employee': return 'bg-emerald-600/30 border-emerald-500/40 text-emerald-300';
    default:         return 'bg-slate-600/30 border-slate-500/40 text-slate-300';
  }
}

// ─── Sub-components ─────────────────────────────────────────────────────────

function Toast({ message, type, onClose }) {
  useEffect(() => {
    const t = setTimeout(onClose, 3500);
    return () => clearTimeout(t);
  }, [onClose]);
  return (
    <div className={`fixed top-5 right-5 z-[100] flex items-center gap-3 px-5 py-3 rounded-xl text-white text-sm font-semibold shadow-2xl border transition-all
      ${type === 'success' ? 'bg-emerald-600/95 border-emerald-500/50' : 'bg-red-600/95 border-red-500/50'}`}>
      <span>{type === 'success' ? '✓' : '✕'}</span>
      <span>{message}</span>
      <button onClick={onClose} className="ml-2 opacity-70 hover:opacity-100">✕</button>
    </div>
  );
}

function SortIcon({ column, sortBy, sortDir }) {
  if (sortBy !== column) return <span className="text-slate-600 ml-1">⇅</span>;
  return <span className="text-indigo-400 ml-1">{sortDir === 'asc' ? '↑' : '↓'}</span>;
}

function ProgressBar({ pct }) {
  const color = pct >= 80 ? 'bg-emerald-500' : pct >= 40 ? 'bg-indigo-500' : 'bg-slate-500';
  return (
    <div className="flex items-center gap-2">
      <div className="w-24 h-1.5 bg-slate-700 rounded-full overflow-hidden">
        <div className={`h-full rounded-full transition-all ${color}`} style={{ width: `${pct}%` }} />
      </div>
      <span className="text-slate-400 text-xs tabular-nums">{pct}%</span>
    </div>
  );
}

// ─── Detail Modal ────────────────────────────────────────────────────────────

function DetailModal({ user, assignments, onClose, onEdit, onDeleteSuccess, setToast }) {
  const [manager, setManager] = useState(null);
  const [loadingManager, setLoadingManager] = useState(false);

  const userAssignments = useMemo(
    () => assignments.filter(a => a.employeeId === user.userId || a.userId === user.userId),
    [assignments, user.userId]
  );

  useEffect(() => {
    if (user.role !== 'employee') return;
    setLoadingManager(true);
    authFetch(`/api/assignments/employee/${user.userId}/manager`)
      .then(d => setManager(d))
      .catch(() => setManager(null))
      .finally(() => setLoadingManager(false));
  }, [user.userId, user.role]);

  const handleDelete = async () => {
    if (!window.confirm(`Delete ${user.name}? This cannot be undone.`)) return;
    try {
      await authFetch(`/api/users/${user.userId}`, { method: 'DELETE' });
      setToast({ message: `${user.name} deleted`, type: 'success' });
      onDeleteSuccess(user.userId);
      onClose();
    } catch (err) {
      setToast({ message: err.message, type: 'error' });
    }
  };

  return (
    <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-50 p-4" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="bg-slate-800 border border-slate-700/80 rounded-2xl w-full max-w-xl max-h-[90vh] overflow-y-auto shadow-2xl">

        {/* Header */}
        <div className="p-6 border-b border-slate-700/60 flex items-start justify-between gap-4">
          <div className="flex items-center gap-4">
            <div className={`w-16 h-16 rounded-2xl border-2 flex items-center justify-center text-xl font-bold shrink-0 ${getAvatarColor(user.role)}`}>
              {getAvatarInitials(user.name)}
            </div>
            <div>
              <h2 className="text-xl font-bold text-white leading-tight">{user.name}</h2>
              <p className="text-slate-400 text-sm mt-0.5">{user.email}</p>
              <div className="flex items-center gap-2 mt-2 flex-wrap">
                <span className={`px-2.5 py-0.5 rounded-full text-xs font-semibold border capitalize ${getRoleBadge(user.role)}`}>{user.role}</span>
                <span className={`px-2.5 py-0.5 rounded-full text-xs font-semibold border capitalize ${getStatusBadge(user.status || 'active')}`}>{user.status || 'active'}</span>
              </div>
            </div>
          </div>
          <button onClick={onClose} className="text-slate-500 hover:text-white p-1 rounded-lg hover:bg-slate-700 transition-colors shrink-0">✕</button>
        </div>

        <div className="p-6 space-y-6">
          {/* Joined Date */}
          <div className="grid grid-cols-2 gap-4">
            <div className="bg-slate-900/60 rounded-xl p-3">
              <p className="text-slate-500 text-xs uppercase tracking-wider mb-1">Joined</p>
              <p className="text-slate-200 text-sm font-medium">{formatDate(user.createdAt)}</p>
            </div>
            {user.learningUUID && (
              <div className="bg-slate-900/60 rounded-xl p-3">
                <p className="text-slate-500 text-xs uppercase tracking-wider mb-1">Learning UUID</p>
                <p className="text-slate-200 text-xs font-mono truncate" title={user.learningUUID}>{user.learningUUID}</p>
              </div>
            )}
          </div>

          {/* Assigned Modules */}
          <div>
            <h3 className="text-slate-300 font-semibold text-sm uppercase tracking-wider mb-3 flex items-center gap-2">
              <span className="w-4 h-4 rounded bg-indigo-500/30 flex items-center justify-center text-indigo-400 text-xs">M</span>
              Assigned Modules
            </h3>
            {userAssignments.length === 0 ? (
              <p className="text-slate-500 text-sm italic">No modules assigned</p>
            ) : (
              <div className="space-y-2">
                {userAssignments.map((a, i) => {
                  const pct = typeof a.progress === 'number' ? a.progress : a.completed ? 100 : 0;
                  return (
                    <div key={i} className="bg-slate-900/60 rounded-xl p-3 flex items-center gap-3">
                      <div className="flex-1 min-w-0">
                        <p className="text-white text-sm font-medium truncate">{a.title || a.moduleName || a.contentTitle || 'Module'}</p>
                        <ProgressBar pct={pct} />
                      </div>
                      <span className={`px-2 py-0.5 rounded-full text-xs font-semibold border capitalize shrink-0 ${a.completed ? 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30' : 'bg-slate-500/20 text-slate-400 border-slate-500/30'}`}>
                        {a.completed ? 'completed' : (a.status || 'in progress')}
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Manager Section (employees only) */}
          {user.role === 'employee' && (
            <div>
              <h3 className="text-slate-300 font-semibold text-sm uppercase tracking-wider mb-3 flex items-center gap-2">
                <span className="w-4 h-4 rounded bg-purple-500/30 flex items-center justify-center text-purple-400 text-xs">M</span>
                Manager
              </h3>
              <div className="bg-slate-900/60 rounded-xl p-3">
                {loadingManager ? (
                  <div className="h-4 bg-slate-700 rounded animate-pulse w-32" />
                ) : manager ? (
                  <div className="flex items-center gap-3">
                    <div className={`w-8 h-8 rounded-lg border flex items-center justify-center text-sm font-bold ${getAvatarColor('manager')}`}>
                      {getAvatarInitials(manager.name || manager.managerName)}
                    </div>
                    <div>
                      <p className="text-white text-sm font-medium">{manager.name || manager.managerName}</p>
                      <p className="text-slate-500 text-xs">{manager.email || ''}</p>
                    </div>
                  </div>
                ) : (
                  <p className="text-slate-500 text-sm italic">No manager assigned</p>
                )}
              </div>
            </div>
          )}

          {/* Activity / UUID */}
          {user.learningUUID && (
            <div>
              <h3 className="text-slate-300 font-semibold text-sm uppercase tracking-wider mb-3 flex items-center gap-2">
                <span className="w-4 h-4 rounded bg-emerald-500/30 flex items-center justify-center text-emerald-400 text-xs">A</span>
                Activity
              </h3>
              <div className="bg-slate-900/60 rounded-xl p-3">
                <p className="text-slate-500 text-xs uppercase tracking-wider mb-1">Learning UUID</p>
                <p className="text-slate-300 text-xs font-mono break-all">{user.learningUUID}</p>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 pb-6 flex gap-3">
          <button
            onClick={() => { onClose(); onEdit(user); }}
            className="flex-1 px-4 py-2.5 bg-indigo-600 hover:bg-indigo-500 rounded-xl text-white font-semibold text-sm transition-colors"
          >
            ✏️ Edit User
          </button>
          <button
            onClick={handleDelete}
            className="px-4 py-2.5 bg-red-600/20 hover:bg-red-600/40 border border-red-500/30 rounded-xl text-red-400 font-semibold text-sm transition-colors"
          >
            🗑️ Delete
          </button>
          <button
            onClick={onClose}
            className="px-4 py-2.5 bg-slate-700 hover:bg-slate-600 rounded-xl text-slate-300 text-sm transition-colors"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Edit Modal ───────────────────────────────────────────────────────────────

function EditModal({ user, modules, users, assignments, onClose, onSaved, setToast }) {
  const [form, setForm] = useState({
    name: user.name || '',
    email: user.email || '',
    role: user.role || 'employee',
    status: user.status || 'active',
  });
  const [saving, setSaving] = useState(false);
  const [assignModuleId, setAssignModuleId] = useState('');
  const [assignManagerId, setAssignManagerId] = useState('');
  const [assigning, setAssigning] = useState(false);
  const [currentManagerId, setCurrentManagerId] = useState(null);

  const managers = useMemo(() => users.filter(u => u.role === 'manager' && u.userId !== user.userId), [users, user.userId]);
  const isEmployee = form.role === 'employee';

  // Load current manager for employee
  useEffect(() => {
    if (user.role !== 'employee') return;
    authFetch(`/api/assignments/employee/${user.userId}/manager`)
      .then(d => {
        if (d?.managerId || d?.userId) {
          const mgrid = d.managerId || d.userId;
          setCurrentManagerId(mgrid);
          setAssignManagerId(mgrid);
        }
      })
      .catch(() => {});
  }, [user.userId, user.role]);

  const handleSave = async () => {
    setSaving(true);
    try {
      await Promise.all([
        authFetch(`/api/users/${user.userId}`, {
          method: 'PUT',
          body: JSON.stringify({ name: form.name, email: form.email, status: form.status }),
        }),
        authFetch(`/api/users/${user.userId}/role`, {
          method: 'PUT',
          body: JSON.stringify({ role: form.role }),
        }),
      ]);
      setToast({ message: `${form.name} updated successfully`, type: 'success' });
      onSaved();
      onClose();
    } catch (err) {
      setToast({ message: err.message, type: 'error' });
    } finally {
      setSaving(false);
    }
  };

  const handleAssignModule = async () => {
    if (!assignModuleId) return;
    setAssigning(true);
    try {
      await authFetch('/api/assignments/content', {
        method: 'POST',
        body: JSON.stringify({ type: 'module', assignableId: assignModuleId, assignedToUser: user.userId, priority: 'medium' }),
      });
      const mod = modules.find(m => m.id === assignModuleId);
      setToast({ message: `Module "${mod?.title || 'Module'}" assigned`, type: 'success' });
      setAssignModuleId('');
      onSaved();
    } catch (err) {
      setToast({ message: err.message, type: 'error' });
    } finally {
      setAssigning(false);
    }
  };

  const handleAssignManager = async () => {
    if (!assignManagerId) return;
    setAssigning(true);
    try {
      await authFetch(`/api/assignments/manager/${assignManagerId}/employees`, {
        method: 'POST',
        body: JSON.stringify({ employeeIds: [user.userId] }),
      });
      const mgr = managers.find(m => m.userId === assignManagerId);
      setToast({ message: `Manager "${mgr?.name || 'Manager'}" assigned`, type: 'success' });
      setCurrentManagerId(assignManagerId); // update current manager display
      onSaved();
    } catch (err) {
      setToast({ message: err.message, type: 'error' });
    } finally {
      setAssigning(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-50 p-4" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="bg-slate-800 border border-slate-700/80 rounded-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto shadow-2xl">

        {/* Header */}
        <div className="p-6 border-b border-slate-700/60 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className={`w-10 h-10 rounded-xl border flex items-center justify-center text-sm font-bold ${getAvatarColor(user.role)}`}>
              {getAvatarInitials(user.name)}
            </div>
            <div>
              <h2 className="text-lg font-bold text-white">Edit User</h2>
              <p className="text-slate-500 text-xs">{user.email}</p>
            </div>
          </div>
          <button onClick={onClose} className="text-slate-500 hover:text-white p-1 rounded-lg hover:bg-slate-700 transition-colors">✕</button>
        </div>

        <div className="p-6 space-y-5">
          {/* Name */}
          <div>
            <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-1.5">Full Name</label>
            <input
              type="text"
              value={form.name}
              onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
              className="w-full px-3 py-2.5 bg-slate-900 border border-slate-700 rounded-xl text-white placeholder-slate-600 focus:outline-none focus:border-indigo-500 transition-colors"
            />
          </div>

          {/* Email */}
          <div>
            <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-1.5">Email</label>
            <input
              type="email"
              value={form.email}
              onChange={e => setForm(f => ({ ...f, email: e.target.value }))}
              className="w-full px-3 py-2.5 bg-slate-900 border border-slate-700 rounded-xl text-white placeholder-slate-600 focus:outline-none focus:border-indigo-500 transition-colors"
            />
          </div>

          {/* Role + Status row */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-1.5">Role</label>
              <select
                value={form.role}
                onChange={e => setForm(f => ({ ...f, role: e.target.value }))}
                className="w-full px-3 py-2.5 bg-slate-900 border border-slate-700 rounded-xl text-white focus:outline-none focus:border-indigo-500 transition-colors"
              >
                <option value="admin">Admin</option>
                <option value="manager">Manager</option>
                <option value="employee">Employee</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-1.5">Status</label>
              <select
                value={form.status}
                onChange={e => setForm(f => ({ ...f, status: e.target.value }))}
                className="w-full px-3 py-2.5 bg-slate-900 border border-slate-700 rounded-xl text-white focus:outline-none focus:border-indigo-500 transition-colors"
              >
                <option value="active">Active</option>
                <option value="inactive">Inactive</option>
                <option value="blocked">Blocked</option>
              </select>
            </div>
          </div>

          {/* Employee-only: Assign Module */}
          {isEmployee && (
            <div className="border-t border-slate-700/60 pt-5">
              <h3 className="text-slate-300 font-semibold text-sm mb-3">Assign Module</h3>
              <div className="flex gap-2">
                <select
                  value={assignModuleId}
                  onChange={e => setAssignModuleId(e.target.value)}
                  className="flex-1 px-3 py-2 bg-slate-900 border border-slate-700 rounded-xl text-white text-sm focus:outline-none focus:border-indigo-500 transition-colors"
                >
                  <option value="">Select module…</option>
                  {modules.map(m => (
                    <option key={m.id} value={m.id}>{m.title}</option>
                  ))}
                </select>
                <button
                  onClick={handleAssignModule}
                  disabled={!assignModuleId || assigning}
                  className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 disabled:cursor-not-allowed rounded-xl text-white text-sm font-semibold transition-colors"
                >
                  Assign
                </button>
              </div>
            </div>
          )}

          {/* Employee-only: Assign Manager */}
          {isEmployee && (
            <div>
              <h3 className="text-slate-300 font-semibold text-sm mb-1">Assign Manager</h3>
              {currentManagerId && (
                <p className="text-xs text-slate-500 mb-2">
                  Current: <span className="text-indigo-400 font-medium">{managers.find(m => m.userId === currentManagerId)?.name || 'Unknown'}</span>
                </p>
              )}
              <div className="flex gap-2">
                <select
                  value={assignManagerId}
                  onChange={e => setAssignManagerId(e.target.value)}
                  className="flex-1 px-3 py-2 bg-slate-900 border border-slate-700 rounded-xl text-white text-sm focus:outline-none focus:border-indigo-500 transition-colors"
                >
                  <option value="">Select manager…</option>
                  {managers.map(m => (
                    <option key={m.userId} value={m.userId}>{m.name}{m.userId === currentManagerId ? ' (current)' : ''}</option>
                  ))}
                </select>
                <button
                  onClick={handleAssignManager}
                  disabled={!assignManagerId || assigning || assignManagerId === currentManagerId}
                  className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 disabled:cursor-not-allowed rounded-xl text-white text-sm font-semibold transition-colors"
                >
                  {assigning ? '…' : assignManagerId === currentManagerId ? '✓ Set' : 'Assign'}
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 pb-6 flex gap-3">
          <button
            onClick={handleSave}
            disabled={saving}
            className="flex-1 px-4 py-2.5 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 rounded-xl text-white font-bold text-sm transition-colors"
          >
            {saving ? 'Saving…' : 'Save Changes'}
          </button>
          <button
            onClick={onClose}
            className="px-4 py-2.5 bg-slate-700 hover:bg-slate-600 rounded-xl text-slate-300 text-sm transition-colors"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Delete confirmation helper ───────────────────────────────────────────────

async function confirmDelete(user, setToast, refreshUsers) {
  if (!window.confirm(`Delete "${user.name}"? This cannot be undone.`)) return;
  try {
    await authFetch(`/api/users/${user.userId}`, { method: 'DELETE' });
    setToast({ message: `${user.name} deleted`, type: 'success' });
    refreshUsers();
  } catch (err) {
    setToast({ message: err.message, type: 'error' });
  }
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function UserManagement() {
  const { user, hasRole } = useAuth();
  const navigate = useNavigate();

  // State
  const [users, setUsers] = useState([]);
  const [assignments, setAssignments] = useState([]);
  const [modules, setModules] = useState([]);
  const [loading, setLoading] = useState(true);
  const [lastRefreshed, setLastRefreshed] = useState(null);
  const [toast, setToast] = useState(null);
  const [activeTab, setActiveTab] = useState('staff');
  const [search, setSearch] = useState('');
  const [sortBy, setSortBy] = useState('role');
  const [sortDir, setSortDir] = useState('asc');
  const [detailUser, setDetailUser] = useState(null);
  const [editUser, setEditUser] = useState(null);
  const [editForm, setEditForm] = useState({});
  const [saving, setSaving] = useState(false);
  const [userManager, setUserManager] = useState(null);
  const [assignModuleId, setAssignModuleId] = useState('');
  const [assignManagerId, setAssignManagerId] = useState('');

  // Auth guard
  useEffect(() => {
    if (!hasRole('admin')) navigate('/dashboard');
  }, [hasRole, navigate]);

  // Fetch all data
  const fetchData = async () => {
    setLoading(true);
    setLastRefreshed(new Date());
    try {
      const [usersData, assignmentsData, modulesData] = await Promise.allSettled([
        authFetch('/api/users'),
        authFetch('/api/assignments'),
        authFetch('/api/modules'),
      ]);

      if (usersData.status === 'fulfilled') {
        const u = usersData.value;
        setUsers(Array.isArray(u) ? u : u?.users || u?.data || []);
      }
      if (assignmentsData.status === 'fulfilled') {
        const a = assignmentsData.value;
        setAssignments(Array.isArray(a) ? a : a?.assignments || a?.data || []);
      }
      if (modulesData.status === 'fulfilled') {
        const m = modulesData.value;
        setModules(Array.isArray(m) ? m : m?.modules || m?.data || []);
      }
    } catch {
      setToast({ message: 'Failed to load data. Please refresh.', type: 'error' });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
    // Auto-refresh every 30 s so newly-registered users appear without a manual reload
    const interval = setInterval(fetchData, 30_000);
    return () => clearInterval(interval);
  }, []);

  // Derived lists
  const staffUsers = useMemo(() => users.filter(u => u.role === 'admin' || u.role === 'manager'), [users]);
  const employeeUsers = useMemo(() => users.filter(u => u.role === 'employee'), [users]);

  const getUserAssignments = (userId) =>
    assignments.filter(a => a.employeeId === userId || a.userId === userId);

  // Filtered + sorted lists
  const filterAndSort = (list, tab) => {
    const q = search.toLowerCase();
    let filtered = q
      ? list.filter(u => u.name?.toLowerCase().includes(q) || u.email?.toLowerCase().includes(q))
      : list;

    filtered = [...filtered].sort((a, b) => {
      if (tab === 'staff' && sortBy === 'role') {
        const rankDiff = (ROLE_RANK[a.role] ?? 99) - (ROLE_RANK[b.role] ?? 99);
        if (rankDiff !== 0) return sortDir === 'asc' ? rankDiff : -rankDiff;
        // alphabetical within same role
        return (a.name || '').localeCompare(b.name || '');
      }

      let aVal, bVal;
      if (sortBy === 'assignments') {
        aVal = getUserAssignments(a.userId).length;
        bVal = getUserAssignments(b.userId).length;
      } else if (sortBy === 'progress') {
        const aA = getUserAssignments(a.userId);
        const bA = getUserAssignments(b.userId);
        aVal = aA.length ? aA.filter(x => x.completed).length / aA.length : 0;
        bVal = bA.length ? bA.filter(x => x.completed).length / bA.length : 0;
      } else {
        aVal = (a[sortBy] || '').toString().toLowerCase();
        bVal = (b[sortBy] || '').toString().toLowerCase();
      }

      if (aVal < bVal) return sortDir === 'asc' ? -1 : 1;
      if (aVal > bVal) return sortDir === 'asc' ? 1 : -1;
      return 0;
    });

    return filtered;
  };

  const displayedUsers = useMemo(() => {
    if (activeTab === 'staff') return filterAndSort(staffUsers, 'staff');
    return filterAndSort(employeeUsers, 'employees');
  }, [users, assignments, activeTab, search, sortBy, sortDir]);

  const handleSort = (col) => {
    if (sortBy === col) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortBy(col); setSortDir('asc'); }
  };

  const openDetail = (u) => setDetailUser(u);
  const openEdit = (u) => { setEditUser(u); setDetailUser(null); };

  const handleTabChange = (tab) => {
    setActiveTab(tab);
    setSortBy(tab === 'staff' ? 'role' : 'name');
    setSortDir('asc');
    setSearch('');
  };

  // ─── Render ────────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="min-h-screen bg-[#0F172A] p-6 flex items-center justify-center">
        <div className="text-center space-y-4">
          <div className="w-12 h-12 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin mx-auto" />
          <p className="text-slate-400 text-sm">Loading users…</p>
        </div>
      </div>
    );
  }

  const thClass = 'py-3 px-4 text-left';
  const thBtn = 'flex items-center gap-0.5 text-xs font-bold text-slate-400 hover:text-white uppercase tracking-wider transition-colors';

  return (
    <div className="min-h-screen bg-[#0F172A]">
      {toast && <Toast {...toast} onClose={() => setToast(null)} />}

      {/* Modals */}
      {detailUser && (
        <DetailModal
          user={detailUser}
          assignments={assignments}
          onClose={() => setDetailUser(null)}
          onEdit={openEdit}
          onDeleteSuccess={(id) => { setUsers(prev => prev.filter(u => u.userId !== id)); }}
          setToast={setToast}
        />
      )}
      {editUser && (
        <EditModal
          user={editUser}
          modules={modules}
          users={users}
          assignments={assignments}
          onClose={() => setEditUser(null)}
          onSaved={fetchData}
          setToast={setToast}
        />
      )}

      <div className="max-w-7xl mx-auto p-6 lg:p-8">

        {/* Page header */}
        <div className="mb-8">
          <button
            onClick={() => navigate('/admin/dashboard')}
            className="text-slate-500 hover:text-slate-300 text-sm flex items-center gap-1.5 mb-5 transition-colors"
          >
            ← Back to Dashboard
          </button>
          <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
            <div>
              <h1 className="text-3xl font-black text-white tracking-tight">User Management</h1>
              <p className="text-slate-400 mt-1">Manage users, roles, and training assignments</p>
            </div>
            <div className="flex gap-3 text-sm">
              <div className="bg-slate-800 border border-slate-700/60 rounded-xl px-4 py-2 text-center">
                <div className="text-2xl font-bold text-white">{users.length}</div>
                <div className="text-slate-500 text-xs">Total Users</div>
              </div>
              <div className="bg-slate-800 border border-slate-700/60 rounded-xl px-4 py-2 text-center">
                <div className="text-2xl font-bold text-purple-300">{staffUsers.length}</div>
                <div className="text-slate-500 text-xs">Staff</div>
              </div>
              <div className="bg-slate-800 border border-slate-700/60 rounded-xl px-4 py-2 text-center">
                <div className="text-2xl font-bold text-emerald-300">{employeeUsers.length}</div>
                <div className="text-slate-500 text-xs">Employees</div>
              </div>
            </div>
          </div>
        </div>

        {/* Controls bar */}
        <div className="flex flex-col sm:flex-row gap-3 mb-5">
          {/* Tabs */}
          <div className="flex bg-slate-800/60 border border-slate-700/60 rounded-xl p-1 gap-1">
            {[
              { id: 'staff', label: 'Staff', count: staffUsers.length },
              { id: 'employees', label: 'Employees', count: employeeUsers.length },
            ].map(tab => (
              <button
                key={tab.id}
                onClick={() => handleTabChange(tab.id)}
                className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold transition-all ${
                  activeTab === tab.id
                    ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-500/25'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                {tab.label}
                <span className={`px-1.5 py-0.5 rounded-md text-xs ${activeTab === tab.id ? 'bg-indigo-500/50' : 'bg-slate-700 text-slate-500'}`}>
                  {tab.count}
                </span>
              </button>
            ))}
          </div>

          {/* Search */}
          <div className="flex-1 relative">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500 text-sm">🔍</span>
            <input
              type="text"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search by name or email…"
              className="w-full pl-9 pr-4 py-2.5 bg-slate-800 border border-slate-700/60 rounded-xl text-white placeholder-slate-500 text-sm focus:outline-none focus:border-indigo-500 transition-colors"
            />
          </div>

          <div className="flex items-center gap-3 text-slate-500 text-sm whitespace-nowrap">
            <span>{displayedUsers.length} of {activeTab === 'staff' ? staffUsers.length : employeeUsers.length} shown</span>
            <button
              onClick={fetchData}
              title={lastRefreshed ? `Last refreshed ${lastRefreshed.toLocaleTimeString()}` : 'Refresh'}
              className="flex items-center gap-1 px-2.5 py-1 rounded-lg border border-slate-700/50 bg-slate-800/40 hover:bg-slate-700/50 hover:text-white transition-all text-xs font-medium"
            >
              <span className={loading ? 'animate-spin' : ''}>↻</span>
              <span>Refresh</span>
            </button>
          </div>
        </div>

        {/* Table */}
        {displayedUsers.length === 0 ? (
          <div className="bg-[#111827] border border-slate-700/40 rounded-2xl p-16 text-center shadow-xl">
            <div className="text-5xl mb-4 opacity-20">👤</div>
            <h3 className="text-lg font-bold text-slate-400 mb-1">No users found</h3>
            <p className="text-slate-600 text-sm">Try adjusting your search or filter</p>
          </div>
        ) : (
          <div className="bg-[#111827] border border-slate-700/40 rounded-2xl overflow-hidden shadow-xl">
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-slate-800/30 border-b border-slate-700/40">
                  <tr>
                    {/* Name col */}
                    <th className={thClass}>
                      <button onClick={() => handleSort('name')} className={thBtn}>
                        Name <SortIcon column="name" sortBy={sortBy} sortDir={sortDir} />
                      </button>
                    </th>
                    {/* Email col */}
                    <th className={thClass}>
                      <button onClick={() => handleSort('email')} className={thBtn}>
                        Email <SortIcon column="email" sortBy={sortBy} sortDir={sortDir} />
                      </button>
                    </th>

                    {activeTab === 'staff' ? (
                      <>
                        <th className={thClass}>
                          <button onClick={() => handleSort('role')} className={thBtn}>
                            Role <SortIcon column="role" sortBy={sortBy} sortDir={sortDir} />
                          </button>
                        </th>
                        <th className={thClass}>
                          <button onClick={() => handleSort('status')} className={thBtn}>
                            Status <SortIcon column="status" sortBy={sortBy} sortDir={sortDir} />
                          </button>
                        </th>
                      </>
                    ) : (
                      <>
                        <th className={thClass}>
                          <button onClick={() => handleSort('assignments')} className={thBtn}>
                            Modules <SortIcon column="assignments" sortBy={sortBy} sortDir={sortDir} />
                          </button>
                        </th>
                        <th className={thClass}>
                          <button onClick={() => handleSort('progress')} className={thBtn}>
                            Progress <SortIcon column="progress" sortBy={sortBy} sortDir={sortDir} />
                          </button>
                        </th>
                        <th className={thClass}>
                          <button onClick={() => handleSort('status')} className={thBtn}>
                            Status <SortIcon column="status" sortBy={sortBy} sortDir={sortDir} />
                          </button>
                        </th>
                      </>
                    )}

                    <th className={`${thClass} text-right pr-5`}>
                      <span className="text-xs font-bold text-slate-500 uppercase tracking-wider">Actions</span>
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-700/20">
                  {displayedUsers.map(u => {
                    const userAssignments = getUserAssignments(u.userId);
                    const completed = userAssignments.filter(a => a.completed).length;
                    const pct = userAssignments.length ? Math.round((completed / userAssignments.length) * 100) : 0;
                    const isSelf = u.userId === user?.userId;

                    return (
                      <tr key={u.userId} className="hover:bg-slate-800/30 transition-colors group">
                        {/* Avatar + Name */}
                        <td className="py-3.5 px-4">
                          <button
                            onClick={() => openDetail(u)}
                            className="flex items-center gap-3 text-left group/name"
                          >
                            <div className={`w-9 h-9 rounded-xl border flex items-center justify-center text-sm font-bold shrink-0 ${getAvatarColor(u.role)}`}>
                              {getAvatarInitials(u.name)}
                            </div>
                            <div>
                              <span className="text-white font-semibold text-sm group-hover/name:text-indigo-300 transition-colors leading-tight">
                                {u.name}
                                {isSelf && <span className="ml-1.5 text-xs text-slate-500">(you)</span>}
                              </span>
                            </div>
                          </button>
                        </td>

                        {/* Email */}
                        <td className="py-3.5 px-4">
                          <span className="text-slate-400 text-sm">{u.email}</span>
                        </td>

                        {activeTab === 'staff' ? (
                          <>
                            {/* Role */}
                            <td className="py-3.5 px-4">
                              <span className={`px-2.5 py-1 rounded-lg text-xs font-semibold border capitalize ${getRoleBadge(u.role)}`}>
                                {u.role}
                              </span>
                            </td>
                            {/* Status */}
                            <td className="py-3.5 px-4">
                              <span className={`px-2.5 py-1 rounded-lg text-xs font-semibold border capitalize ${getStatusBadge(u.status || 'active')}`}>
                                {u.status || 'active'}
                              </span>
                            </td>
                          </>
                        ) : (
                          <>
                            {/* Modules count */}
                            <td className="py-3.5 px-4">
                              <span className="text-slate-300 text-sm font-medium">{userAssignments.length}</span>
                              <span className="text-slate-600 text-xs ml-1">assigned</span>
                            </td>
                            {/* Progress */}
                            <td className="py-3.5 px-4">
                              <ProgressBar pct={pct} />
                            </td>
                            {/* Status */}
                            <td className="py-3.5 px-4">
                              <span className={`px-2.5 py-1 rounded-lg text-xs font-semibold border capitalize ${getStatusBadge(u.status || 'active')}`}>
                                {u.status || 'active'}
                              </span>
                            </td>
                          </>
                        )}

                        {/* Actions */}
                        <td className="py-3.5 px-4">
                          <div className="flex items-center gap-1.5 justify-end opacity-0 group-hover:opacity-100 transition-opacity">
                            <button
                              onClick={() => openEdit(u)}
                              title="Edit user"
                              className="w-8 h-8 flex items-center justify-center rounded-lg bg-blue-600/10 hover:bg-blue-600/30 text-blue-400 hover:text-blue-300 border border-blue-600/20 hover:border-blue-500/40 transition-all text-sm"
                            >
                              ✏️
                            </button>
                            {!isSelf && (
                              <button
                                onClick={() => confirmDelete(u, setToast, fetchData)}
                                title="Delete user"
                                className="w-8 h-8 flex items-center justify-center rounded-lg bg-red-600/10 hover:bg-red-600/30 text-red-400 hover:text-red-300 border border-red-600/20 hover:border-red-500/40 transition-all text-sm"
                              >
                                🗑️
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {/* Footer */}
            <div className="px-6 py-3 border-t border-slate-700/30 bg-slate-800/10 flex items-center justify-between">
              <p className="text-xs text-slate-600">
                Showing <span className="text-slate-400 font-semibold">{displayedUsers.length}</span> of{' '}
                <span className="text-slate-400 font-semibold">{activeTab === 'staff' ? staffUsers.length : employeeUsers.length}</span>{' '}
                {activeTab === 'staff' ? 'staff members' : 'employees'}
              </p>
              <button
                onClick={fetchData}
                className="text-xs text-slate-600 hover:text-slate-400 transition-colors flex items-center gap-1"
              >
                ↻ Refresh
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
