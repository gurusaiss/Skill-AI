/**
 * GroupManagement.jsx — Company-scoped group CRUD for Admin
 */
import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { useNavigate } from 'react-router-dom';
import { authFetch } from '../../utils/authFetch.js';
import { useNotification } from '../../contexts/NotificationContext.jsx';
import SearchableSelect from '../../components/SearchableSelect.jsx';
import PageContainer from '../../components/PageContainer.jsx';
import PageHeader from '../../components/PageHeader.jsx';
import Button from '../../components/Button.jsx';
import ActionMenu from '../../components/ActionMenu.jsx';
import StatCard from '../../components/StatCard.jsx';

const ROW_GRID = 'lg:grid-cols-[minmax(0,2.4fr)_minmax(0,1.4fr)_minmax(0,0.8fr)_minmax(0,1fr)_minmax(0,0.8fr)_auto]';
const LABEL = 'block text-xs font-bold text-slate-300 uppercase tracking-wider mb-1.5';
const INPUT = 'w-full bg-slate-900/60 border border-slate-700 rounded-xl px-4 py-2.5 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500/60';

function StatusBadge({ status }) {
  return (
    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-bold border ${
      status === 'inactive'
        ? 'bg-slate-500/20 text-slate-300 border-slate-500/30'
        : 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30'
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
  const [empSearch, setEmpSearch] = useState('');

  const toggleEmployee = (id) => {
    setForm(f => ({
      ...f,
      employeeIds: f.employeeIds.includes(id)
        ? f.employeeIds.filter(e => e !== id)
        : [...f.employeeIds, id],
    }));
  };

  const filteredEmployees = useMemo(() => {
    const q = empSearch.toLowerCase().trim();
    if (!q) return employees;
    return employees.filter(emp =>
      emp.name?.toLowerCase().includes(q) ||
      emp.email?.toLowerCase().includes(q) ||
      emp.jobRole?.toLowerCase().includes(q) ||
      emp.department?.toLowerCase().includes(q) ||
      emp.employeeId?.toLowerCase().includes(q)
    );
  }, [employees, empSearch]);

  const allFilteredSelected = filteredEmployees.length > 0 && filteredEmployees.every(emp => form.employeeIds.includes(emp.userId || emp.id));

  const toggleSelectAllFiltered = () => {
    const ids = filteredEmployees.map(e => e.userId || e.id);
    if (allFilteredSelected) {
      setForm(f => ({ ...f, employeeIds: f.employeeIds.filter(id => !ids.includes(id)) }));
    } else {
      setForm(f => ({ ...f, employeeIds: [...new Set([...f.employeeIds, ...ids])] }));
    }
  };

  const handleSubmit = async (e) => {
    e?.preventDefault?.();
    if (saving) return;
    setError('');
    if (!form.name.trim()) { setError('Group name is required'); return; }
    setSaving(true);
    try {
      await onSave(form);
    } catch (err) {
      setError(err?.message || 'Could not save the group');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-[100] p-4" role="dialog" aria-modal="true">
      <div className="bg-[#1E293B] border border-slate-700/80 rounded-2xl w-full max-w-4xl shadow-2xl max-h-[92vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between gap-3 px-5 sm:px-6 py-4 border-b border-slate-700/60 flex-shrink-0">
          <h2 className="text-xl font-bold text-white">
            {mode === 'create' ? 'Create Group' : 'Edit Group'}
          </h2>
          <button type="button" onClick={onClose} aria-label="Close" title="Close" className="h-9 w-9 rounded-lg text-slate-300 hover:bg-slate-700 hover:text-white text-xl transition-colors">✕</button>
        </div>

        {/* Body */}
        <form onSubmit={handleSubmit} className="overflow-y-auto flex-1 px-5 sm:px-6 py-5">
          {error && (
            <div role="alert" className="mb-4 bg-red-500/10 border border-red-500/30 text-red-300 text-sm rounded-xl px-4 py-2.5">
              {error}
            </div>
          )}

          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            <div className="space-y-4 min-w-0">
              <div>
                <label htmlFor="grp-name" className={LABEL}>
                  Group Name <span className="text-red-400">*</span>
                </label>
                <input
                  id="grp-name"
                  required
                  value={form.name}
                  onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                  placeholder="e.g. Engineering Team"
                  className={INPUT}
                />
              </div>

              <div>
                <label htmlFor="grp-desc" className={LABEL}>Description</label>
                <textarea
                  id="grp-desc"
                  value={form.description}
                  onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
                  placeholder="Brief description of this group..."
                  rows={3}
                  className={`${INPUT} resize-none`}
                />
              </div>

              <div>
                <label htmlFor="grp-mgr" className={LABEL}>Group Manager / Group Head</label>
                <select
                  id="grp-mgr"
                  value={form.managerId}
                  onChange={e => setForm(f => ({ ...f, managerId: e.target.value }))}
                  className={INPUT}
                >
                  <option value="">— No manager assigned —</option>
                  {managers.map(m => (
                    <option key={m.userId || m.id} value={m.userId || m.id}>{m.name}</option>
                  ))}
                </select>
              </div>

              {mode === 'edit' && (
                <div>
                  <label htmlFor="grp-status" className={LABEL}>Status</label>
                  <select
                    id="grp-status"
                    value={form.status}
                    onChange={e => setForm(f => ({ ...f, status: e.target.value }))}
                    className={INPUT}
                  >
                    <option value="active">Active</option>
                    <option value="inactive">Inactive</option>
                  </select>
                </div>
              )}
            </div>

            <div className="min-w-0">
              <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
                <span className={`${LABEL} !mb-0`}>
                  Employees ({form.employeeIds.length} selected)
                </span>
                {filteredEmployees.length > 0 && (
                  <Button size="sm" variant="ghost" onClick={toggleSelectAllFiltered}>
                    {allFilteredSelected ? 'Deselect all' : `Select all (${filteredEmployees.length})`}
                  </Button>
                )}
              </div>

              {/* Employee search */}
              <div className="relative mb-2">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-sm" aria-hidden="true">🔍</span>
                <input
                  type="text"
                  aria-label="Search employees"
                  value={empSearch}
                  onChange={e => setEmpSearch(e.target.value)}
                  placeholder="Search by name, email, job role, department..."
                  className="w-full bg-slate-900/60 border border-slate-700 rounded-xl pl-9 pr-10 py-2.5 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500/60"
                />
                {empSearch && (
                  <button type="button" aria-label="Clear search" title="Clear search" onClick={() => setEmpSearch('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-white text-sm">✕</button>
                )}
              </div>

              {employees.length === 0 ? (
                <p className="text-slate-400 text-sm italic">No employees in your company yet.</p>
              ) : filteredEmployees.length === 0 ? (
                <p className="text-slate-400 text-sm italic text-center py-4">No employees match "{empSearch}"</p>
              ) : (
                <div className="bg-slate-900/60 border border-slate-700 rounded-xl max-h-[46vh] overflow-y-auto divide-y divide-slate-700/40">
                  {filteredEmployees.map(emp => {
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
                          className="h-4 w-4 rounded border-slate-600 text-indigo-500 focus:ring-indigo-500/40"
                        />
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-white truncate" title={emp.name}>{emp.name}</p>
                          <p className="text-sm text-slate-400 truncate">{emp.email}{emp.employeeId ? ` · ${emp.employeeId}` : ''}</p>
                        </div>
                        {emp.jobRole && (
                          <span className="hidden sm:inline-block max-w-[40%] truncate text-xs text-indigo-300 flex-shrink-0 bg-indigo-500/10 px-2 py-0.5 rounded" title={emp.jobRole}>{emp.jobRole}</span>
                        )}
                      </label>
                    );
                  })}
                </div>
              )}
              {form.employeeIds.length > 0 && (
                <p className="text-sm text-slate-400 mt-1.5">{form.employeeIds.length} employee{form.employeeIds.length !== 1 ? 's' : ''} will be in this group</p>
              )}
            </div>
          </div>
        </form>

        {/* Footer */}
        <div className="flex flex-wrap justify-end gap-3 px-5 sm:px-6 py-4 border-t border-slate-700/60 flex-shrink-0">
          <Button onClick={onClose} disabled={saving}>Cancel</Button>
          <Button variant="primary" onClick={handleSubmit} loading={saving}>
            {saving ? 'Saving...' : mode === 'create' ? 'Create Group' : 'Save Changes'}
          </Button>
        </div>
      </div>
    </div>
  );
}

// ── View Group Modal ──────────────────────────────────────────────────────────
function ViewGroupModal({ groupId, onClose }) {
  const [detail, setDetail] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError('');
    authFetch(`/api/groups/${groupId}`)
      .then(d => { if (!cancelled) setDetail(d); })
      .catch(err => { if (!cancelled) setError(err?.message || 'Could not load group details.'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [groupId, attempt]);

  const cell = 'bg-slate-900/60 rounded-xl p-3 border border-slate-700/40 min-w-0';

  return (
    <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-[100] p-4" role="dialog" aria-modal="true">
      <div className="bg-[#1E293B] border border-slate-700/80 rounded-2xl w-full max-w-3xl shadow-2xl max-h-[92vh] overflow-y-auto">
        <div className="flex items-center justify-between px-5 sm:px-6 py-4 border-b border-slate-700/60 sticky top-0 bg-[#1E293B]">
          <h2 className="text-xl font-bold text-white">Group Details</h2>
          <button type="button" onClick={onClose} aria-label="Close" title="Close" className="h-9 w-9 rounded-lg text-slate-300 hover:bg-slate-700 hover:text-white text-xl">✕</button>
        </div>
        <div className="px-5 sm:px-6 py-5">
          {loading ? (
            <div className="text-center py-8 text-slate-300 text-sm">Loading...</div>
          ) : !detail ? (
            <div className="text-center py-8 text-slate-300 text-sm">
              <p className="mb-3">{error || 'Could not load group details.'}</p>
              <Button size="sm" onClick={() => setAttempt(a => a + 1)}>Retry</Button>
            </div>
          ) : (
            <div className="space-y-4">
              <div>
                <h3 className="text-2xl font-bold text-white mb-1 break-words">{detail.name}</h3>
                <StatusBadge status={detail.status} />
              </div>
              {detail.description && (
                <p className="text-slate-300 text-sm">{detail.description}</p>
              )}
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                <div className={cell}>
                  <p className="text-sm text-slate-400 mb-0.5">Manager</p>
                  <p className="text-base font-semibold text-white truncate" title={detail.manager?.name || ''}>{detail.manager?.name || '—'}</p>
                </div>
                <div className={cell}>
                  <p className="text-sm text-slate-400 mb-0.5">Members</p>
                  <p className="text-base font-semibold text-white">{detail.members?.length || 0}</p>
                </div>
                <div className={cell}>
                  <p className="text-sm text-slate-400 mb-0.5">Created</p>
                  <p className="text-base font-semibold text-white">{formatDate(detail.createdAt)}</p>
                </div>
              </div>
              {detail.members?.length > 0 && (
                <div>
                  <p className="text-sm font-bold text-slate-300 uppercase tracking-wider mb-2">Members</p>
                  <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
                    {detail.members.map(m => (
                      <div key={m.userId} className="flex items-center gap-3 bg-slate-900/60 rounded-xl px-4 py-2.5 border border-slate-700/40 min-w-0">
                        <div className="w-9 h-9 rounded-lg bg-indigo-600/20 flex items-center justify-center text-sm font-bold text-indigo-300 flex-shrink-0">
                          {m.name?.charAt(0)?.toUpperCase() || '?'}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-white truncate" title={m.name}>{m.name}</p>
                          <p className="text-sm text-slate-400 truncate" title={m.email}>{m.email}</p>
                        </div>
                        {m.jobRole && <span className="hidden sm:block max-w-[35%] truncate text-xs text-slate-300" title={m.jobRole}>{m.jobRole}</span>}
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

// ── Delete confirmation ───────────────────────────────────────────────────────
function DeleteGroupModal({ group, onClose, onConfirm }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const run = async () => {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      await onConfirm(group);
    } catch (err) {
      setError(err?.message || 'Could not delete the group');
      setBusy(false);
    }
  };
  return (
    <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-[100] p-4" role="dialog" aria-modal="true">
      <div className="bg-[#1E293B] border border-slate-700/80 rounded-2xl w-full max-w-md shadow-2xl p-6 text-center">
        <div className="text-4xl mb-3" aria-hidden="true">⚠️</div>
        <h3 className="text-xl font-bold text-white mb-1">Delete Group</h3>
        <p className="text-slate-300 text-sm mb-5">
          Delete <span className="text-white font-bold">"{group.name}"</span>? This cannot be undone.
        </p>
        {error ? <div role="alert" className="mb-4 rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-2.5 text-sm text-red-300">{error}</div> : null}
        <div className="flex flex-wrap justify-center gap-3">
          <Button onClick={onClose} disabled={busy}>Cancel</Button>
          <Button variant="danger" onClick={run} loading={busy}>{busy ? 'Deleting...' : 'Delete Group'}</Button>
        </div>
      </div>
    </div>
  );
}

// ── Main Component ────────────────────────────────────────────────────────────
export default function GroupManagement() {
  const { user, hasRole } = useAuth();
  const navigate = useNavigate();

  const [groups, setGroups] = useState([]);
  const [managers, setManagers] = useState([]);
  const [employees, setEmployees] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const { notify } = useNotification();
  const setToast = useCallback(({ message, type = 'info' }) => notify(message, type), [notify]);
  const [search, setSearch] = useState('');
  const [filterStatus, setFilterStatus] = useState('all');
  const [filterManager, setFilterManager] = useState('all');
  const [modal, setModal] = useState(null); // null | { mode: 'create' } | { mode: 'edit', group } | { mode: 'view', groupId } | { mode: 'delete', group }

  const showToast = useCallback((message, type = 'success') => setToast({ message, type }), [setToast]);

  const fetchAll = useCallback(async () => {
    setLoading(true);
    setLoadError('');
    try {
      const [groupsData, usersData] = await Promise.allSettled([
        authFetch('/api/groups'),
        authFetch('/api/users?light=1'),
      ]);

      // Keep the last known data for whichever request failed.
      if (groupsData.status === 'fulfilled') {
        const v = groupsData.value;
        setGroups(Array.isArray(v) ? v : (v?.groups || []));
      }
      if (usersData.status === 'fulfilled') {
        const v = usersData.value;
        const users = Array.isArray(v) ? v : (v?.users || []);
        // A user can hold "manager"/"employee" as a GRANTED ADDITIONAL access
        // (via Manage Access) without it being their primary role — filtering
        // on role alone silently hid every such user from these dropdowns even
        // though they can genuinely act as a manager/employee.
        setManagers(users.filter(u => u.role === 'manager' || (u.accesses || []).includes('manager')));
        setEmployees(users.filter(u => u.role === 'employee' || (u.accesses || []).includes('employee')));
      }

      const failed = [
        groupsData.status === 'rejected' && 'groups',
        usersData.status === 'rejected' && 'users',
      ].filter(Boolean);
      if (failed.length > 0) {
        setLoadError(`Failed to load ${failed.join(' and ')}. Showing the last known data.`);
      }
    } catch (err) {
      setLoadError(err?.message || 'Failed to load groups');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!user || !hasRole(['admin', 'manager'])) { navigate('/dashboard'); return; }
    fetchAll();
  }, [user, navigate, fetchAll]);

  const handleCreate = async (form) => {
    await authFetch('/api/groups', { method: 'POST', body: JSON.stringify(form) });
    showToast('Group created successfully');
    setModal(null);
    fetchAll();
  };

  const handleEdit = async (form) => {
    try {
      await authFetch(`/api/groups/${modal.group.id}`, {
        method: 'PUT',
        body: JSON.stringify({ ...form, expectedUpdatedAt: modal.group.updatedAt || null }),
      });
      showToast('Group updated successfully');
      setModal(null);
      fetchAll();
    } catch (err) {
      if (err.message?.includes('changed by someone else')) {
        showToast(err.message, 'error');
        setModal(null);
        fetchAll();
        return;
      }
      throw err;
    }
  };

  const handleDelete = async (group) => {
    await authFetch(`/api/groups/${group.id}`, { method: 'DELETE' });
    showToast('Group deleted', 'info');
    setModal(null);
    fetchAll();
  };

  const q = search.toLowerCase().trim();
  const filtered = groups.filter(g => {
    if (q && !g.name?.toLowerCase().includes(q) && !g.managerName?.toLowerCase().includes(q)) return false;
    if (filterStatus !== 'all') {
      const st = g.status || 'active';
      if (st !== filterStatus) return false;
    }
    if (filterManager !== 'all' && g.managerId !== filterManager) return false;
    return true;
  });
  const hasFilters = !!(search || filterStatus !== 'all' || filterManager !== 'all');
  const clearFilters = () => { setSearch(''); setFilterStatus('all'); setFilterManager('all'); };

  const activeCount = groups.filter(g => g.status !== 'inactive').length;
  const totalMembers = groups.reduce((sum, g) => sum + (g.employeeCount ?? g.employeeIds?.length ?? 0), 0);

  if (!user || !hasRole(['admin', 'manager'])) return null;
  const isAdmin = hasRole('admin');

  return (
    <PageContainer className="text-[#F8FAFC]">

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
        <DeleteGroupModal group={modal.group} onClose={() => setModal(null)} onConfirm={handleDelete} />
      )}

      <PageHeader
        icon="👥"
        title="Group Management"
        subtitle="Create groups, assign a manager and choose which employees belong to each group."
        actions={isAdmin ? <Button variant="primary" onClick={() => setModal({ mode: 'create' })}>Create Group</Button> : null}
      />

      {loadError ? (
        <div role="alert" className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-200">
          <span>{loadError}</span>
          <Button size="sm" variant="danger" onClick={fetchAll}>Retry</Button>
        </div>
      ) : null}

      {/* Summary Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-5">
        <StatCard label="Total Groups" value={groups.length} icon="🗂️" borderClass="border-indigo-500/30" bgClass="bg-indigo-500/5" textClass="text-indigo-300"
          description="All groups in your company." tooltip="Every group that exists in your company, active or inactive." />
        <StatCard label="Active" value={activeCount} icon="✅" borderClass="border-emerald-500/30" bgClass="bg-emerald-500/5" textClass="text-emerald-300"
          description="Groups currently in use." tooltip="Groups whose status is Active. Inactive groups are kept but not used for assignments." />
        <StatCard label="Total Members" value={totalMembers} icon="👤" borderClass="border-indigo-500/30" bgClass="bg-indigo-500/5" textClass="text-indigo-300"
          description="Employees across all groups." tooltip="Sum of members over all groups. An employee in two groups is counted twice." />
      </div>

      {/* Filters */}
      <div className="mb-5 flex flex-col gap-3 rounded-2xl border border-slate-700/60 bg-slate-800/40 p-3 sm:p-4 lg:flex-row lg:items-center">
        <div className="relative min-w-0 flex-1">
          <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400 text-sm" aria-hidden="true">🔍</span>
          <input
            value={search}
            aria-label="Search groups"
            onChange={e => setSearch(e.target.value)}
            placeholder="Search groups by name or manager..."
            className="w-full h-10 bg-slate-900/60 border border-slate-700 rounded-xl pl-10 pr-4 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500/60"
          />
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:flex lg:items-center">
          <SearchableSelect
            value={filterStatus}
            onChange={setFilterStatus}
            allLabel="All Statuses"
            options={[{ value: 'active', label: 'Active' }, { value: 'inactive', label: 'Inactive' }]}
          />
          <SearchableSelect
            value={filterManager}
            onChange={setFilterManager}
            allLabel="All Managers"
            options={managers.map(m => ({ value: m.userId || m.id, label: m.name || m.email }))}
          />
        </div>
        {hasFilters && <Button onClick={clearFilters}>Clear Filters</Button>}
      </div>

      {/* List */}
      {loading ? (
        <div className="bg-slate-800/40 border border-slate-700/60 rounded-2xl overflow-hidden divide-y divide-slate-700/40">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="px-5 py-4 flex items-center gap-4 animate-pulse">
              <div className="w-10 h-10 rounded-xl bg-slate-700/50 shrink-0" />
              <div className="flex-1 h-4 bg-slate-700/50 rounded" />
              <div className="w-24 h-4 bg-slate-700/40 rounded" />
              <div className="w-16 h-4 bg-slate-700/40 rounded" />
              <div className="w-16 h-6 bg-slate-700/50 rounded-lg" />
            </div>
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <div className="rounded-2xl border border-slate-700/60 bg-slate-800/40 text-center py-16 px-4 text-slate-300">
          <div className="text-5xl mb-3" aria-hidden="true">👥</div>
          <p className="text-base font-semibold mb-3">{hasFilters ? 'No groups match your filters.' : 'No groups yet.'}</p>
          {hasFilters ? (
            <Button onClick={clearFilters}>Clear Filters</Button>
          ) : isAdmin ? (
            <Button variant="primary" onClick={() => setModal({ mode: 'create' })}>Create your first group</Button>
          ) : null}
        </div>
      ) : (
        <div className="bg-slate-800/40 border border-slate-700/60 rounded-2xl overflow-hidden">
          <div className={`hidden lg:grid ${ROW_GRID} gap-x-4 px-5 py-3.5 border-b border-slate-700/60 text-xs font-bold text-slate-300 uppercase tracking-wider`}>
            <span>Group Name</span>
            <span>Manager</span>
            <span>Members</span>
            <span>Created</span>
            <span>Status</span>
            <span>Actions</span>
          </div>
          <div className="divide-y divide-slate-700/40">
            {filtered.map(g => (
              <div key={g.id} className={`grid grid-cols-1 items-center gap-x-4 gap-y-2 px-4 py-4 sm:px-5 ${ROW_GRID} hover:bg-slate-700/20 transition-colors`}>
                <div className="flex min-w-0 items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-indigo-600/20 border border-indigo-500/20 flex items-center justify-center text-base font-bold text-indigo-300 flex-shrink-0">
                    {g.name?.charAt(0)?.toUpperCase() || 'G'}
                  </div>
                  <div className="min-w-0">
                    <p className="font-semibold text-white text-base truncate" title={g.name}>{g.name}</p>
                    {g.description && <p className="text-sm text-slate-400 truncate" title={g.description}>{g.description}</p>}
                  </div>
                </div>
                <div className="min-w-0 text-sm text-slate-200 truncate" title={g.managerName || ''}>
                  <span className="lg:hidden text-slate-400">Manager: </span>{g.managerName || '—'}
                </div>
                <div className="text-sm font-semibold text-indigo-300">
                  <span className="lg:hidden font-normal text-slate-400">Members: </span>{g.employeeCount ?? (g.employeeIds?.length || 0)}
                </div>
                <div className="text-sm text-slate-300">
                  <span className="lg:hidden text-slate-400">Created: </span>{formatDate(g.createdAt)}
                </div>
                <div><StatusBadge status={g.status} /></div>
                <div>
                  <ActionMenu
                    label="Manage"
                    size="sm"
                    items={[
                      { label: 'View details', onClick: () => setModal({ mode: 'view', groupId: g.id }) },
                      { label: 'Edit group', onClick: () => setModal({ mode: 'edit', group: g }), hidden: !isAdmin },
                      { label: 'Delete group', onClick: () => setModal({ mode: 'delete', group: g }), danger: true, divider: true, hidden: !isAdmin },
                    ]}
                  />
                </div>
              </div>
            ))}
          </div>
          <div className="px-5 py-3 border-t border-slate-700/40 text-sm text-slate-400">
            Showing {filtered.length} of {groups.length} groups
          </div>
        </div>
      )}
    </PageContainer>
  );
}
