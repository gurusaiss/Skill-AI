/**
 * GroupManagement.jsx — Company-scoped group CRUD for Admin
 */
import React, { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { useNavigate } from 'react-router-dom';
import { authFetch } from '../../utils/authFetch.js';

function Toast({ message, type, onClose }) {
  useEffect(() => { const t = setTimeout(onClose, 3500); return () => clearTimeout(t); }, [onClose]);
  return (
    <div className={`fixed top-5 right-5 z-[200] flex items-center gap-3 px-5 py-3 rounded-xl text-white text-sm font-semibold shadow-2xl border
      ${type === 'success' ? 'bg-emerald-600/95 border-emerald-500/50' : type === 'error' ? 'bg-red-600/95 border-red-500/50' : 'bg-indigo-600/95 border-indigo-500/50'}`}>
      <span>{type === 'success' ? '✓' : type === 'error' ? '✕' : 'ℹ'}</span>
      <span>{message}</span>
      <button onClick={onClose} className="ml-2 opacity-60 hover:opacity-100">✕</button>
    </div>
  );
}

function StatusBadge({ status }) {
  return (
    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-bold border ${
      status === 'active'
        ? 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30'
        : 'bg-slate-500/20 text-slate-400 border-slate-500/30'
    }`}>
      {status ? status.charAt(0).toUpperCase() + status.slice(1) : 'Active'}
    </span>
  );
}

function formatDate(d) {
  if (!d) return '—';
  const dt = new Date(d);
  return isNaN(dt) ? '—' : dt.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

// ── Group Form Modal ──────────────────────────────────────────────────────────
function GroupModal({ mode, group, managers, employees, onClose, onSave }) {
  const [form, setForm] = useState({
    name: group?.name || '',
    description: group?.description || '',
    managerId: group?.managerId || '',
    employeeIds: group?.employeeIds || [],
    status: group?.status || 'active',
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const toggleEmployee = (id) => {
    setForm(f => ({
      ...f,
      employeeIds: f.employeeIds.includes(id)
        ? f.employeeIds.filter(e => e !== id)
        : [...f.employeeIds, id],
    }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    if (!form.name.trim()) { setError('Group name is required'); return; }
    setSaving(true);
    try {
      await onSave(form);
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-[100] p-4">
      <div className="bg-[#1E293B] border border-slate-700/80 rounded-2xl w-full max-w-lg shadow-2xl max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-700/60 flex-shrink-0">
          <h2 className="text-lg font-bold text-white">
            {mode === 'create' ? '➕ Create Group' : '✏️ Edit Group'}
          </h2>
          <button onClick={onClose} className="text-slate-400 hover:text-white text-xl transition-colors">✕</button>
        </div>

        {/* Scrollable body */}
        <form onSubmit={handleSubmit} className="overflow-y-auto flex-1 px-6 py-5 space-y-4">
          {error && (
            <div className="bg-red-500/10 border border-red-500/30 text-red-400 text-sm rounded-xl px-4 py-2.5">
              {error}
            </div>
          )}

          <div>
            <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-1.5">
              Group Name <span className="text-red-400">*</span>
            </label>
            <input
              required
              value={form.name}
              onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
              placeholder="e.g. Engineering Team"
              className="w-full bg-slate-900/60 border border-slate-700 rounded-xl px-4 py-2.5 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500/60"
            />
          </div>

          <div>
            <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-1.5">Description</label>
            <textarea
              value={form.description}
              onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
              placeholder="Brief description of this group..."
              rows={2}
              className="w-full bg-slate-900/60 border border-slate-700 rounded-xl px-4 py-2.5 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500/60 resize-none"
            />
          </div>

          <div>
            <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-1.5">Group Manager</label>
            <select
              value={form.managerId}
              onChange={e => setForm(f => ({ ...f, managerId: e.target.value }))}
              className="w-full bg-slate-900/60 border border-slate-700 rounded-xl px-4 py-2.5 text-sm text-white focus:outline-none focus:border-indigo-500/60"
            >
              <option value="">— No manager assigned —</option>
              {managers.map(m => (
                <option key={m.userId || m.id} value={m.userId || m.id}>{m.name}</option>
              ))}
            </select>
          </div>

          {mode === 'edit' && (
            <div>
              <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-1.5">Status</label>
              <select
                value={form.status}
                onChange={e => setForm(f => ({ ...f, status: e.target.value }))}
                className="w-full bg-slate-900/60 border border-slate-700 rounded-xl px-4 py-2.5 text-sm text-white focus:outline-none focus:border-indigo-500/60"
              >
                <option value="active">Active</option>
                <option value="inactive">Inactive</option>
              </select>
            </div>
          )}

          <div>
            <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">
              Employees ({form.employeeIds.length} selected)
            </label>
            {employees.length === 0 ? (
              <p className="text-slate-500 text-sm italic">No employees in your company yet.</p>
            ) : (
              <div className="bg-slate-900/60 border border-slate-700 rounded-xl max-h-48 overflow-y-auto divide-y divide-slate-700/40">
                {employees.map(emp => {
                  const id = emp.userId || emp.id;
                  const selected = form.employeeIds.includes(id);
                  return (
                    <label
                      key={id}
                      className={`flex items-center gap-3 px-4 py-2.5 cursor-pointer hover:bg-slate-800/60 transition-colors ${selected ? 'bg-indigo-500/10' : ''}`}
                    >
                      <input
                        type="checkbox"
                        checked={selected}
                        onChange={() => toggleEmployee(id)}
                        className="rounded border-slate-600 text-indigo-500 focus:ring-indigo-500/40"
                      />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-white truncate">{emp.name}</p>
                        <p className="text-xs text-slate-500 truncate">{emp.email}</p>
                      </div>
                      {emp.jobRole && (
                        <span className="text-xs text-slate-500 flex-shrink-0">{emp.jobRole}</span>
                      )}
                    </label>
                  );
                })}
              </div>
            )}
          </div>
        </form>

        {/* Footer */}
        <div className="flex gap-3 px-6 py-4 border-t border-slate-700/60 flex-shrink-0">
          <button
            type="button"
            onClick={onClose}
            className="flex-1 py-2.5 rounded-xl bg-slate-700 hover:bg-slate-600 text-white font-bold text-sm transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={saving}
            className="flex-1 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 disabled:opacity-60 text-white font-bold text-sm transition-colors"
          >
            {saving ? 'Saving...' : mode === 'create' ? 'Create Group' : 'Save Changes'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── View Group Modal ──────────────────────────────────────────────────────────
function ViewGroupModal({ groupId, onClose }) {
  const [detail, setDetail] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    authFetch(`/api/groups/${groupId}`)
      .then(d => setDetail(d))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [groupId]);

  return (
    <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-[100] p-4">
      <div className="bg-[#1E293B] border border-slate-700/80 rounded-2xl w-full max-w-lg shadow-2xl max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-700/60 sticky top-0 bg-[#1E293B]">
          <h2 className="text-lg font-bold text-white">👥 Group Details</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-white text-xl">✕</button>
        </div>
        <div className="px-6 py-5">
          {loading ? (
            <div className="text-center py-8 text-slate-400 text-sm">Loading...</div>
          ) : !detail ? (
            <div className="text-center py-8 text-slate-400 text-sm">Could not load group details.</div>
          ) : (
            <div className="space-y-4">
              <div>
                <h3 className="text-xl font-bold text-white mb-1">{detail.name}</h3>
                <StatusBadge status={detail.status} />
              </div>
              {detail.description && (
                <p className="text-slate-400 text-sm">{detail.description}</p>
              )}
              <div className="grid grid-cols-2 gap-3">
                <div className="bg-slate-900/60 rounded-xl p-3 border border-slate-700/40">
                  <p className="text-xs text-slate-500 mb-0.5">Manager</p>
                  <p className="text-sm font-semibold text-white">{detail.manager?.name || '—'}</p>
                </div>
                <div className="bg-slate-900/60 rounded-xl p-3 border border-slate-700/40">
                  <p className="text-xs text-slate-500 mb-0.5">Members</p>
                  <p className="text-sm font-semibold text-white">{detail.members?.length || 0}</p>
                </div>
                <div className="bg-slate-900/60 rounded-xl p-3 border border-slate-700/40">
                  <p className="text-xs text-slate-500 mb-0.5">Created</p>
                  <p className="text-sm font-semibold text-white">{formatDate(detail.createdAt)}</p>
                </div>
              </div>
              {detail.members?.length > 0 && (
                <div>
                  <p className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">Members</p>
                  <div className="space-y-2">
                    {detail.members.map(m => (
                      <div key={m.userId} className="flex items-center gap-3 bg-slate-900/60 rounded-xl px-4 py-2.5 border border-slate-700/40">
                        <div className="w-8 h-8 rounded-lg bg-indigo-600/20 flex items-center justify-center text-sm font-bold text-indigo-400 flex-shrink-0">
                          {m.name?.charAt(0)?.toUpperCase() || '?'}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-white truncate">{m.name}</p>
                          <p className="text-xs text-slate-500 truncate">{m.email}</p>
                        </div>
                        {m.jobRole && <span className="text-xs text-slate-500">{m.jobRole}</span>}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Main Component ────────────────────────────────────────────────────────────
export default function GroupManagement() {
  const { user } = useAuth();
  const navigate = useNavigate();

  const [groups, setGroups] = useState([]);
  const [managers, setManagers] = useState([]);
  const [employees, setEmployees] = useState([]);
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState(null);
  const [search, setSearch] = useState('');
  const [modal, setModal] = useState(null); // null | { mode: 'create' } | { mode: 'edit', group } | { mode: 'view', groupId } | { mode: 'delete', group }

  const showToast = (message, type = 'success') => setToast({ message, type });

  const fetchAll = useCallback(async () => {
    setLoading(true);
    try {
      const [groupsData, usersData] = await Promise.allSettled([
        authFetch('/api/groups'),
        authFetch('/api/users'),
      ]);

      const grps = groupsData.status === 'fulfilled'
        ? (groupsData.value?.groups || groupsData.value || [])
        : [];
      const users = usersData.status === 'fulfilled'
        ? (usersData.value?.users || usersData.value || [])
        : [];

      setGroups(grps);
      setManagers(users.filter(u => u.role === 'manager'));
      setEmployees(users.filter(u => u.role === 'employee'));
    } catch (err) {
      showToast(err.message, 'error');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!user || user.role !== 'admin') { navigate('/dashboard'); return; }
    fetchAll();
  }, [user, navigate, fetchAll]);

  const handleCreate = async (form) => {
    await authFetch('/api/groups', { method: 'POST', body: JSON.stringify(form) });
    showToast('Group created successfully');
    setModal(null);
    fetchAll();
  };

  const handleEdit = async (form) => {
    await authFetch(`/api/groups/${modal.group.id}`, { method: 'PUT', body: JSON.stringify(form) });
    showToast('Group updated successfully');
    setModal(null);
    fetchAll();
  };

  const handleDelete = async (group) => {
    await authFetch(`/api/groups/${group.id}`, { method: 'DELETE' });
    showToast('Group deleted', 'info');
    setModal(null);
    fetchAll();
  };

  const filtered = groups.filter(g =>
    !search || g.name?.toLowerCase().includes(search.toLowerCase()) || g.managerName?.toLowerCase().includes(search.toLowerCase())
  );

  const activeCount = groups.filter(g => g.status !== 'inactive').length;
  const totalMembers = groups.reduce((sum, g) => sum + (g.employeeIds?.length || g.employeeCount || 0), 0);

  if (!user || user.role !== 'admin') return null;

  return (
    <div className="min-h-screen bg-[#0F172A] text-[#F8FAFC]">
      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}

      {/* Modals */}
      {modal?.mode === 'create' && (
        <GroupModal mode="create" managers={managers} employees={employees} onClose={() => setModal(null)} onSave={handleCreate} />
      )}
      {modal?.mode === 'edit' && (
        <GroupModal mode="edit" group={modal.group} managers={managers} employees={employees} onClose={() => setModal(null)} onSave={handleEdit} />
      )}
      {modal?.mode === 'view' && (
        <ViewGroupModal groupId={modal.groupId} onClose={() => setModal(null)} />
      )}
      {modal?.mode === 'delete' && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-[100] p-4">
          <div className="bg-[#1E293B] border border-slate-700/80 rounded-2xl w-full max-w-sm shadow-2xl p-6 text-center">
            <div className="text-4xl mb-3">⚠️</div>
            <h3 className="text-lg font-bold text-white mb-1">Delete Group</h3>
            <p className="text-slate-400 text-sm mb-5">
              Delete <span className="text-white font-bold">"{modal.group.name}"</span>? This cannot be undone.
            </p>
            <div className="flex gap-3">
              <button onClick={() => setModal(null)} className="flex-1 py-2.5 rounded-xl bg-slate-700 hover:bg-slate-600 text-white font-bold text-sm transition-colors">Cancel</button>
              <button onClick={() => handleDelete(modal.group)} className="flex-1 py-2.5 rounded-xl bg-red-600/20 border border-red-500/30 text-red-300 hover:bg-red-600/30 font-bold text-sm transition-colors">Delete</button>
            </div>
          </div>
        </div>
      )}

      <div className="max-w-6xl mx-auto px-6 py-8 lg:px-8">

        {/* Header */}
        <div className="flex items-start justify-between mb-8">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-2xl bg-teal-600/20 border border-teal-500/30 flex items-center justify-center text-2xl">👥</div>
            <div>
              <h1 className="text-2xl font-bold text-white">Group Management</h1>
              <p className="text-teal-400 text-sm font-semibold">Admin Panel · Company-Scoped</p>
            </div>
          </div>
          <button
            onClick={() => setModal({ mode: 'create' })}
            className="flex items-center gap-2 px-5 py-2.5 bg-teal-600 hover:bg-teal-500 rounded-xl text-white font-bold text-sm transition-all shadow-lg"
          >
            ➕ Create Group
          </button>
        </div>

        {/* Summary Cards */}
        <div className="grid grid-cols-3 gap-4 mb-6">
          {[
            { label: 'Total Groups', value: groups.length, icon: '🗂️', color: 'border-teal-500/30 bg-teal-500/5 text-teal-400' },
            { label: 'Active', value: activeCount, icon: '✅', color: 'border-emerald-500/30 bg-emerald-500/5 text-emerald-400' },
            { label: 'Total Members', value: totalMembers, icon: '👤', color: 'border-indigo-500/30 bg-indigo-500/5 text-indigo-400' },
          ].map(s => (
            <div key={s.label} className={`rounded-xl border p-4 ${s.color}`}>
              <div className="flex items-center gap-3">
                <span className="text-2xl">{s.icon}</span>
                <div>
                  <p className={`text-2xl font-bold tabular-nums`}>{s.value}</p>
                  <p className="text-xs font-bold uppercase tracking-wider opacity-70">{s.label}</p>
                </div>
              </div>
            </div>
          ))}
        </div>

        {/* Search */}
        <div className="mb-5">
          <div className="relative">
            <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-500 text-sm">🔍</span>
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search groups by name or manager..."
              className="w-full bg-slate-800/50 border border-slate-700 rounded-xl pl-10 pr-4 py-2.5 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-teal-500/60"
            />
          </div>
        </div>

        {/* Table */}
        {loading ? (
          <div className="text-center py-16">
            <div className="animate-spin text-teal-400 text-4xl mb-4">⟳</div>
            <div className="text-slate-400 text-sm">Loading groups...</div>
          </div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-16 text-slate-500">
            <div className="text-5xl mb-3">👥</div>
            <p className="text-sm font-semibold mb-2">{search ? 'No groups match your search.' : 'No groups yet.'}</p>
            {!search && (
              <button onClick={() => setModal({ mode: 'create' })} className="mt-2 text-teal-400 hover:text-teal-300 text-sm font-bold underline">
                Create your first group →
              </button>
            )}
          </div>
        ) : (
          <div className="bg-[#1E293B] border border-slate-700/60 rounded-2xl overflow-hidden">
            <table className="w-full">
              <thead>
                <tr className="border-b border-slate-700/60">
                  {['Group Name', 'Manager', 'Members', 'Created', 'Status', 'Actions'].map(h => (
                    <th key={h} className="text-left px-5 py-3.5 text-xs font-bold text-slate-400 uppercase tracking-wider">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-700/40">
                {filtered.map(g => (
                  <tr key={g.id} className="hover:bg-slate-700/20 transition-colors">
                    <td className="px-5 py-4">
                      <div className="flex items-center gap-3">
                        <div className="w-9 h-9 rounded-xl bg-teal-600/20 border border-teal-500/20 flex items-center justify-center text-sm font-bold text-teal-400 flex-shrink-0">
                          {g.name?.charAt(0)?.toUpperCase() || 'G'}
                        </div>
                        <div>
                          <p className="font-semibold text-white text-sm">{g.name}</p>
                          {g.description && <p className="text-xs text-slate-500 truncate max-w-[160px]">{g.description}</p>}
                        </div>
                      </div>
                    </td>
                    <td className="px-5 py-4">
                      <span className="text-sm text-slate-300">{g.managerName || '—'}</span>
                    </td>
                    <td className="px-5 py-4">
                      <span className="inline-flex items-center gap-1.5 text-sm font-semibold text-indigo-400">
                        👤 {g.employeeCount ?? (g.employeeIds?.length || 0)}
                      </span>
                    </td>
                    <td className="px-5 py-4">
                      <span className="text-xs text-slate-500">{formatDate(g.createdAt)}</span>
                    </td>
                    <td className="px-5 py-4">
                      <StatusBadge status={g.status} />
                    </td>
                    <td className="px-5 py-4">
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => setModal({ mode: 'view', groupId: g.id })}
                          className="p-2 rounded-lg bg-slate-700 hover:bg-slate-600 text-slate-400 hover:text-white transition-colors text-sm"
                          title="View"
                        >👁️</button>
                        <button
                          onClick={() => setModal({ mode: 'edit', group: g })}
                          className="p-2 rounded-lg bg-indigo-600/20 hover:bg-indigo-600/30 text-indigo-400 hover:text-indigo-300 border border-indigo-500/20 transition-colors text-sm"
                          title="Edit"
                        >✏️</button>
                        <button
                          onClick={() => setModal({ mode: 'delete', group: g })}
                          className="p-2 rounded-lg bg-red-600/20 hover:bg-red-600/30 text-red-400 hover:text-red-300 border border-red-500/20 transition-colors text-sm"
                          title="Delete"
                        >🗑️</button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="px-5 py-3 border-t border-slate-700/40 text-xs text-slate-500">
              Showing {filtered.length} of {groups.length} groups
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
