import React, { useEffect, useState, useMemo, useCallback, useRef } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { useNavigate } from 'react-router-dom';
import { authFetch } from '../../utils/authFetch.js';
import SearchableSelect from '../../components/SearchableSelect.jsx';
import { useNotification } from '../../contexts/NotificationContext.jsx';
import PageContainer from '../../components/PageContainer.jsx';
import PageHeader from '../../components/PageHeader.jsx';
import Button from '../../components/Button.jsx';
import ActionMenu from '../../components/ActionMenu.jsx';
import StatCard from '../../components/StatCard.jsx';

const statusConfig = {
  assigned:    { bg: 'bg-blue-500/15',    text: 'text-blue-300',    border: 'border-blue-500/30',    label: 'Assigned' },
  pending:     { bg: 'bg-amber-500/15',   text: 'text-amber-300',   border: 'border-amber-500/30',   label: 'Pending' },
  in_progress: { bg: 'bg-violet-500/15',  text: 'text-violet-300',  border: 'border-violet-500/30',  label: 'In Progress' },
  completed:   { bg: 'bg-emerald-500/15', text: 'text-emerald-300', border: 'border-emerald-500/30', label: 'Completed' },
  overdue:     { bg: 'bg-red-500/15',     text: 'text-red-300',     border: 'border-red-500/30',     label: 'Overdue' },
  cancelled:   { bg: 'bg-slate-500/15',   text: 'text-slate-300',   border: 'border-slate-500/30',   label: 'Cancelled' },
  rejected:    { bg: 'bg-rose-500/15',    text: 'text-rose-300',    border: 'border-rose-500/30',    label: 'Rejected' },
};

const priorityConfig = {
  low:    { dot: 'bg-slate-400',  text: 'text-slate-300',  label: 'Low' },
  medium: { dot: 'bg-blue-400',   text: 'text-blue-300',   label: 'Medium' },
  high:   { dot: 'bg-orange-400', text: 'text-orange-300', label: 'High' },
  urgent: { dot: 'bg-red-500',    text: 'text-red-300',    label: 'Urgent' },
};

// 6 columns at lg, 8 at xl (Assigned By + Created appear once there is room;
// below xl they are shown as a secondary line under the employee name).
const ROW_GRID = 'lg:grid-cols-[minmax(0,2fr)_minmax(0,2.4fr)_minmax(0,0.9fr)_minmax(0,1fr)_minmax(0,1.1fr)_auto] xl:grid-cols-[minmax(0,2fr)_minmax(0,2.4fr)_minmax(0,0.9fr)_minmax(0,1fr)_minmax(0,1.1fr)_minmax(0,1.4fr)_minmax(0,0.9fr)_auto]';
const LABEL = 'text-xs font-bold text-slate-300 uppercase tracking-wider mb-1.5 block';
const FIELD = 'w-full px-3 py-2.5 rounded-xl bg-slate-800 border border-slate-700 text-white text-sm focus:border-indigo-500 focus:outline-none';

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
const fmtDate = (d) => {
  if (!d) return '—';
  const dt = new Date(d);
  return isNaN(dt) ? '—' : dt.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: '2-digit' });
};

export default function AssignmentManagement() {
  const { user, hasRole } = useAuth();
  const navigate = useNavigate();

  const [assignments, setAssignments] = useState([]);
  const [users, setUsers] = useState([]);
  const [modules, setModules] = useState([]);
  const [groups, setGroups] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [lastRefreshed, setLastRefreshed] = useState(null);
  const { notify } = useNotification();
  const setToast = useCallback(({ message, type = 'info' }) => notify(message, type), [notify]);
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [filterStatus, setFilterStatus] = useState('all');
  const [filterMandatory, setFilterMandatory] = useState('all'); // 'all' | 'mandatory' | 'optional'
  const [filterEmployee, setFilterEmployee] = useState('all'); // 'all' | employeeId
  const [search, setSearch] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [busyId, setBusyId] = useState(null); // assignment being cancelled/deleted
  const [showPendingModal, setShowPendingModal] = useState(false);
  const loadedOnce = useRef(false);

  const isAdmin = hasRole('admin');
  const isManager = hasRole('manager');

  const showToast = useCallback((message, type = 'info') => setToast({ message, type }), [setToast]);

  const loadAll = useCallback(async () => {
    // Only the very first load shows the skeleton; the 30s background refresh
    // must not blank the table.
    if (!loadedOnce.current) setLoading(true);
    try {
      const [assignRes, userRes, modRes, grRes] = await Promise.allSettled([
        authFetch('/api/assignments'),
        authFetch('/api/users?light=1'),
        authFetch('/api/modules?limit=1000'),
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
      const failed = [
        assignRes.status === 'rejected' && 'assignments',
        userRes.status === 'rejected' && 'employees',
        modRes.status === 'rejected' && 'modules',
        grRes.status === 'rejected' && 'groups',
      ].filter(Boolean);
      setLoadError(failed.length ? `Could not load ${failed.join(', ')}. Showing the last known data.` : '');
      setLastRefreshed(new Date());
    } catch (e) {
      setLoadError(e?.message || 'Failed to load data');
    } finally {
      loadedOnce.current = true;
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!user || (!isAdmin && !isManager)) { navigate('/dashboard'); return undefined; }
    loadAll();
    // refresh every 30s, but only while the tab is visible (hidden tabs used to re-download everything)
    const interval = setInterval(() => { if (document.visibilityState === 'visible') loadAll(); }, 30000);
    return () => clearInterval(interval);
  }, [user, navigate, isAdmin, isManager, loadAll]);

  const employees = useMemo(() => users.filter(u => u.role === 'employee'), [users]);

  // Filter out completely invalid/phantom rows (no ID, no employee, no module)
  const isValidAssignment = useCallback((a) => {
    const hasId = Boolean(a.id);
    const hasEmployee = Boolean(a.assigned_to_user || a.employee_id);
    const hasModule = Boolean(a.assignable_id || a.module_id);
    return hasId && (hasEmployee || hasModule);
  }, []);

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

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return assignments.filter(a => {
      if (!isValidAssignment(a)) return false;
      const moduleId = a.assignable_id || a.module_id;
      const moduleName = getModuleName(moduleId).toLowerCase();
      const employeeName = getUserName(a.assigned_to_user || a.employee_id).toLowerCase();
      const matchesSearch = !q || moduleName.includes(q) || employeeName.includes(q);
      const matchesStatus = filterStatus === 'all' || a.status === filterStatus;
      const matchesMandatory = filterMandatory === 'all' ? true
        : filterMandatory === 'mandatory' ? (a.isMandatory === true || a.mandatory === true)
        : (a.isMandatory !== true && a.mandatory !== true);
      const employeeId = a.assigned_to_user || a.employee_id;
      const matchesEmployee = filterEmployee === 'all' ? true
        : (employeeId === filterEmployee || a.assignedTo === filterEmployee);
      return matchesSearch && matchesStatus && matchesMandatory && matchesEmployee;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [assignments, search, filterStatus, filterMandatory, filterEmployee, users, modules, isValidAssignment]);

  const hasFilters = !!(search || filterStatus !== 'all' || filterMandatory !== 'all' || filterEmployee !== 'all');
  const clearFilters = () => { setSearch(''); setFilterStatus('all'); setFilterMandatory('all'); setFilterEmployee('all'); };

  const stats = useMemo(() => ({
    total: assignments.length,
    active: assignments.filter(a => a.status === 'in_progress' || a.status === 'active').length,
    completed: assignments.filter(a => a.status === 'completed' || a.completed === true).length,
    pending: assignments.filter(a => a.status === 'assigned' || a.status === 'pending').length,
    overdue: assignments.filter(a => a.status !== 'completed' && a.completed !== true && a.due_date && new Date(a.due_date) < new Date()).length,
  }), [assignments]);

  const pendingList = useMemo(() => assignments.filter(a => a.status === 'pending' || a.status === 'assigned'), [assignments]);

  const closeCreate = () => { if (submitting) return; setShowCreate(false); setForm(EMPTY_FORM); };

  const handleCreate = async (e) => {
    e.preventDefault();
    if (submitting) return;
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
    if (busyId) return;
    if (!window.confirm('Cancel this assignment? The employee will no longer see it as active.')) return;
    setBusyId(id);
    try {
      await authFetch(`/api/assignments/${id}`, { method: 'PUT', body: JSON.stringify({ status: 'cancelled' }) });
      setAssignments(prev => prev.map(a => a.id === id ? { ...a, status: 'cancelled' } : a));
      showToast('Assignment cancelled', 'info');
    } catch (e) {
      showToast(e.message || 'Failed to cancel', 'error');
    } finally {
      setBusyId(null);
    }
  };

  const deleteAssignment = async (id) => {
    if (busyId) return;
    if (!window.confirm('Permanently delete this assignment? This cannot be undone.')) return;
    setBusyId(id);
    try {
      await authFetch(`/api/assignments/${id}`, { method: 'DELETE' });
      setAssignments(prev => prev.filter(a => a.id !== id));
      showToast('Assignment deleted', 'info');
    } catch (e) {
      showToast(e.message || 'Failed to delete assignment', 'error');
    } finally {
      setBusyId(null);
    }
  };

  const PriorityCell = ({ priority }) => {
    const pcfg = priorityConfig[priority] || priorityConfig.medium;
    return (
      <div className="flex items-center gap-1.5">
        <span className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${pcfg.dot}`} />
        <span className={`text-sm font-semibold ${pcfg.text}`}>{pcfg.label}</span>
      </div>
    );
  };

  return (
    <PageContainer className="text-white">

      {/* ── Header ── */}
      <PageHeader
        icon="📋"
        title="Assignment Management"
        subtitle={isAdmin ? 'Create and manage learning assignments across the organisation' : 'Request module assignments for your team'}
        actions={(
          <>
            <Button onClick={() => navigate(isAdmin ? '/admin/dashboard' : '/manager/dashboard')}>← Back to Dashboard</Button>
            <Button variant="primary" onClick={() => setShowCreate(true)}>
              {isAdmin ? 'New Assignment' : 'Request Assignment'}
            </Button>
          </>
        )}
      />

      {loadError ? (
        <div role="alert" className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-200">
          <span>{loadError}</span>
          <Button size="sm" variant="danger" onClick={loadAll}>Retry</Button>
        </div>
      ) : null}

      {/* ── Stat Cards ── */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-4 mb-5">
        <StatCard label="Total" value={stats.total} icon="📋" borderClass="border-indigo-500/25" bgClass="bg-indigo-500/5" textClass="text-indigo-300"
          description="All assignments." tooltip="Every assignment record in your scope, whatever its status." />
        <button type="button" onClick={() => setShowPendingModal(true)} className="block text-left rounded-xl focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-400" aria-label="Open the list of pending assignments">
          <StatCard label="Pending" value={stats.pending} icon="⏳" borderClass="border-sky-500/25 hover:border-sky-400/50" bgClass="bg-sky-500/5" textClass="text-sky-300" className="h-full transition-colors"
            description="Assigned, not started. Click to view." tooltip="Assignments with status Assigned or Pending. Click to see the full list." />
        </button>
        <StatCard label="In Progress" value={stats.active} icon="⚡" borderClass="border-amber-500/25" bgClass="bg-amber-500/5" textClass="text-amber-300"
          description="Employees working on them now." tooltip="Assignments that an employee has started but not finished." />
        <StatCard label="Completed" value={stats.completed} icon="✅" borderClass="border-emerald-500/25" bgClass="bg-emerald-500/5" textClass="text-emerald-300"
          description="Finished assignments." tooltip="Assignments marked completed by the employee." />
        <StatCard label="Overdue" value={stats.overdue} icon="🚨" borderClass="border-red-500/25" bgClass="bg-red-500/5" textClass="text-red-300" className="col-span-2 lg:col-span-1"
          description="Past due date, not finished." tooltip="Assignments with a due date in the past that are not completed." />
      </div>

      {/* ── Table Card ── */}
      <div className="rounded-2xl border border-slate-700/60 bg-slate-800/40 overflow-hidden shadow-xl">

        {/* Toolbar */}
        <div className="flex flex-col gap-3 px-4 sm:px-5 py-4 border-b border-slate-700/50 bg-slate-800/30 lg:flex-row lg:items-center">
          <div className="relative min-w-0 flex-1">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-sm" aria-hidden="true">🔍</span>
            <input
              type="text"
              aria-label="Search assignments"
              placeholder="Search by module or employee name..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="w-full h-10 pl-9 pr-4 rounded-xl bg-slate-800/80 border border-slate-700/60 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500/60 transition-colors"
            />
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3 lg:flex lg:items-center">
            <SearchableSelect
              value={filterStatus}
              onChange={setFilterStatus}
              allLabel="All Status"
              options={[
                { value: 'assigned', label: 'Assigned' },
                { value: 'pending', label: 'Pending Approval' },
                { value: 'in_progress', label: 'In Progress' },
                { value: 'completed', label: 'Completed' },
                { value: 'overdue', label: 'Overdue' },
                { value: 'cancelled', label: 'Cancelled' },
              ]}
            />
            <SearchableSelect
              value={filterMandatory}
              onChange={setFilterMandatory}
              allLabel="All Types"
              options={[{ value: 'mandatory', label: 'Mandatory' }, { value: 'optional', label: 'Optional' }]}
            />
            <SearchableSelect
              value={filterEmployee}
              onChange={setFilterEmployee}
              allLabel="All Employees"
              options={employees.map(emp => ({ value: emp.userId || emp.id, label: emp.name || emp.email }))}
            />
          </div>
          <div className="flex flex-wrap gap-2">
            {hasFilters && <Button onClick={clearFilters}>Clear Filters</Button>}
            <Button onClick={loadAll} loading={loading}>Refresh</Button>
          </div>
        </div>

        {/* Column Headers */}
        <div className={`hidden lg:grid ${ROW_GRID} gap-x-3 px-5 xl:px-6 py-3 border-b border-slate-700/40 bg-slate-800/50`}>
          <div className="text-xs font-bold text-slate-300 uppercase tracking-wider">Employee</div>
          <div className="text-xs font-bold text-slate-300 uppercase tracking-wider">Module</div>
          <div className="text-xs font-bold text-slate-300 uppercase tracking-wider">Priority</div>
          <div className="text-xs font-bold text-slate-300 uppercase tracking-wider">Due Date</div>
          <div className="text-xs font-bold text-slate-300 uppercase tracking-wider">Status</div>
          <div className="hidden xl:block text-xs font-bold text-slate-300 uppercase tracking-wider">Assigned By</div>
          <div className="hidden xl:block text-xs font-bold text-slate-300 uppercase tracking-wider">Created</div>
          <div className="text-xs font-bold text-slate-300 uppercase tracking-wider">Actions</div>
        </div>

        {/* Rows */}
        {loading ? (
          <div className="divide-y divide-slate-700/20">
            {Array.from({ length: 5 }).map((_, i) => <SkeletonRow key={i} />)}
          </div>
        ) : filtered.length === 0 ? (
          <div className="py-16 px-4 text-center">
            <div className="text-6xl mb-4 opacity-30" aria-hidden="true">📋</div>
            <p className="text-lg font-bold text-slate-200 mb-1">No Assignments Found</p>
            <p className="text-sm text-slate-400 mb-4">
              {assignments.length === 0 ? 'Create your first assignment to get started.' : 'No assignments match your filters.'}
            </p>
            {hasFilters ? <Button onClick={clearFilters}>Clear Filters</Button>
              : <Button variant="primary" onClick={() => setShowCreate(true)}>{isAdmin ? 'New Assignment' : 'Request Assignment'}</Button>}
          </div>
        ) : (
          <div className="divide-y divide-slate-700/30">
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
              const rowBusy = busyId === a.id;

              return (
                <div
                  key={a.id || idx}
                  className={`grid grid-cols-1 items-center gap-x-3 gap-y-2 px-4 py-4 sm:px-5 xl:px-6 hover:bg-slate-700/20 transition-colors ${ROW_GRID} ${rowBusy ? 'opacity-60' : ''}`}
                >
                  {/* Employee */}
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="w-10 h-10 rounded-full bg-gradient-to-br from-indigo-600/40 to-purple-600/30 border border-indigo-500/30 flex items-center justify-center text-sm font-black text-indigo-200 flex-shrink-0 shadow-sm">
                      {empInitial}
                    </div>
                    <div className="min-w-0">
                      <p className="text-base font-semibold text-white truncate leading-tight" title={empName}>{empName}</p>
                      <p className="text-sm text-slate-400 truncate xl:hidden" title={`Assigned by ${assignedByName}`}>
                        By {assignedByName} · {fmtDate(createdDate)}
                      </p>
                      <p className="hidden xl:block text-sm text-slate-400 truncate capitalize">{a.type || 'module'}</p>
                    </div>
                  </div>

                  {/* Module */}
                  <div className="min-w-0">
                    <p className="text-base font-medium text-slate-100 truncate leading-tight" title={getModuleName(moduleId)}>{getModuleName(moduleId)}</p>
                    {pct > 0 && (
                      <div className="flex items-center gap-2 mt-1">
                        <div className="flex-1 h-1.5 rounded-full bg-slate-700/60 overflow-hidden">
                          <div className="h-full bg-indigo-500 rounded-full" style={{ width: `${Math.min(100, pct)}%` }} />
                        </div>
                        <span className="text-sm text-slate-300 flex-shrink-0">{pct}%</span>
                      </div>
                    )}
                  </div>

                  {/* Priority */}
                  <div><span className="lg:hidden text-sm text-slate-400 mr-2">Priority</span><span className="inline-block align-middle"><PriorityCell priority={priority} /></span></div>

                  {/* Due Date */}
                  <div>
                    <span className="lg:hidden text-sm text-slate-400 mr-2">Due</span>
                    {a.due_date ? (
                      <span className={`text-sm font-medium ${isOverdue ? 'text-red-300' : 'text-slate-200'}`}>
                        {fmtDate(a.due_date)}
                        {isOverdue && <span className="ml-1" title="Overdue">⚠</span>}
                      </span>
                    ) : (
                      <span className="text-sm text-slate-400">No deadline</span>
                    )}
                  </div>

                  {/* Status Badge */}
                  <div>
                    <span className={`inline-flex items-center px-2.5 py-1 rounded-lg text-xs font-bold uppercase tracking-wide border ${cfg.bg} ${cfg.text} ${cfg.border}`}>
                      {cfg.label}
                    </span>
                  </div>

                  {/* Assigned By */}
                  <div className="hidden xl:block min-w-0">
                    <p className="text-sm text-slate-300 truncate" title={assignedByName}>{assignedByName}</p>
                  </div>

                  {/* Created Date */}
                  <div className="hidden xl:block">
                    <p className="text-sm text-slate-300">{fmtDate(createdDate)}</p>
                  </div>

                  {/* Actions */}
                  <div>
                    <ActionMenu
                      label="Manage"
                      size="sm"
                      items={[
                        { label: `View as ${empName}`, onClick: () => navigate(`/module/${moduleId}/learn?assignmentId=${a.id}`), hidden: !moduleId },
                        { label: 'Edit module', onClick: () => navigate(`/admin/modules?edit=${moduleId}`), hidden: !moduleId },
                        { label: 'Cancel assignment', onClick: () => cancelAssignment(a.id), hidden: status === 'completed' || status === 'cancelled', disabled: !!busyId, divider: true },
                        { label: 'Delete permanently', onClick: () => deleteAssignment(a.id), hidden: !isAdmin, danger: true, disabled: !!busyId },
                      ]}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* Footer count */}
        {!loading && filtered.length > 0 && (
          <div className="px-5 sm:px-6 py-3 border-t border-slate-700/30 bg-slate-800/20 flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm text-slate-400">
              Showing <span className="text-slate-200 font-semibold">{filtered.length}</span> of <span className="text-slate-200 font-semibold">{assignments.length}</span> assignments
            </p>
            {lastRefreshed ? (
              <p className="text-sm text-slate-400">Last refreshed: {lastRefreshed.toLocaleTimeString()}</p>
            ) : null}
          </div>
        )}
      </div>

      {/* Pending Assignments Modal */}
      {showPendingModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4" role="dialog" aria-modal="true" onClick={e => e.target === e.currentTarget && setShowPendingModal(false)}>
          <div className="bg-slate-900 border border-slate-700 rounded-2xl w-full max-w-4xl max-h-[88vh] flex flex-col shadow-2xl">
            {/* Header */}
            <div className="flex items-center justify-between px-5 sm:px-6 py-4 border-b border-slate-700 shrink-0">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-sky-500/15 border border-sky-500/25 flex items-center justify-center text-lg">⏳</div>
                <div>
                  <h3 className="text-xl font-black text-white">Pending Assignments</h3>
                  <p className="text-sm text-slate-400 mt-0.5">{stats.pending} assignment{stats.pending !== 1 ? 's' : ''} awaiting action</p>
                </div>
              </div>
              <button type="button" aria-label="Close" title="Close" onClick={() => setShowPendingModal(false)} className="text-slate-300 hover:text-white w-9 h-9 rounded-lg hover:bg-slate-800 flex items-center justify-center transition-colors">✕</button>
            </div>

            {/* Table */}
            <div className="overflow-y-auto flex-1">
              {pendingList.length === 0 ? (
                <div className="py-16 text-center">
                  <div className="text-5xl mb-3 opacity-30" aria-hidden="true">✅</div>
                  <p className="text-slate-200 font-semibold">All caught up!</p>
                  <p className="text-slate-400 text-sm mt-1">No pending assignments at this time.</p>
                </div>
              ) : (
                <>
                  <div className="hidden md:grid md:grid-cols-[minmax(0,1.8fr)_minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1.2fr)] gap-x-3 px-6 py-3 border-b border-slate-700/40 bg-slate-800/40 text-xs font-bold text-slate-300 uppercase tracking-wider">
                    <span>Employee</span>
                    <span>Module</span>
                    <span>Priority</span>
                    <span>Due Date</span>
                    <span>Assigned By</span>
                  </div>
                  <div className="divide-y divide-slate-700/30">
                    {pendingList.map((a, idx) => {
                      const employeeId = a.assigned_to_user || a.employee_id;
                      const moduleId = a.assignable_id || a.module_id;
                      const empName = getUserName(employeeId);
                      const isOverdue = a.due_date && new Date(a.due_date) < new Date();
                      return (
                        <div
                          key={a.id || idx}
                          className="grid grid-cols-1 md:grid-cols-[minmax(0,1.8fr)_minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1.2fr)] px-5 sm:px-6 py-4 items-center gap-x-3 gap-y-1.5 hover:bg-slate-800/30 transition-colors"
                        >
                          <div className="flex items-center gap-2.5 min-w-0">
                            <div className="w-9 h-9 rounded-full bg-gradient-to-br from-sky-600/40 to-indigo-600/30 border border-sky-500/30 flex items-center justify-center text-sm font-black text-sky-200 flex-shrink-0">
                              {empName !== '—' ? empName.charAt(0).toUpperCase() : '?'}
                            </div>
                            <p className="text-sm font-semibold text-white truncate" title={empName}>{empName}</p>
                          </div>
                          {moduleId ? (
                            <button type="button" onClick={() => navigate(`/admin/modules?edit=${moduleId}`)} title="Edit this module"
                              className="text-sm text-slate-200 hover:text-indigo-300 truncate text-left transition-colors">
                              {getModuleName(moduleId)}
                            </button>
                          ) : (
                            <p className="text-sm text-slate-200 truncate">{getModuleName(moduleId)}</p>
                          )}
                          <PriorityCell priority={a.priority || 'medium'} />
                          <div>
                            {a.due_date ? (
                              <span className={`text-sm font-medium ${isOverdue ? 'text-red-300' : 'text-slate-200'}`}>
                                {fmtDate(a.due_date)}{isOverdue && ' ⚠'}
                              </span>
                            ) : <span className="text-sm text-slate-400">No deadline</span>}
                          </div>
                          <p className="text-sm text-slate-300 truncate">{getUserName(a.assigned_by || a.manager_id)}</p>
                        </div>
                      );
                    })}
                  </div>
                </>
              )}
            </div>

            {/* Footer */}
            <div className="px-5 sm:px-6 py-4 border-t border-slate-700 shrink-0 flex flex-wrap items-center justify-between gap-3">
              <p className="text-sm text-slate-400">
                Showing <span className="text-slate-200 font-semibold">{pendingList.length}</span> pending assignment{pendingList.length !== 1 ? 's' : ''}
              </p>
              <Button onClick={() => setShowPendingModal(false)}>Close</Button>
            </div>
          </div>
        </div>
      )}

      {/* Create Modal */}
      {showCreate && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4" role="dialog" aria-modal="true">
          <div className="bg-slate-900 border border-slate-700 rounded-2xl p-5 sm:p-6 w-full max-w-2xl max-h-[92vh] overflow-y-auto shadow-2xl">
            <div className="flex items-center justify-between mb-5">
              <div>
                <h3 className="text-xl font-black text-white">
                  {isAdmin ? 'New Assignment' : 'Request Assignment'}
                </h3>
                <p className="text-sm text-slate-400 mt-0.5">
                  {isAdmin ? 'Assign a module directly to an employee' : 'Submit a request for admin approval'}
                </p>
              </div>
              <button type="button" aria-label="Close" title="Close" onClick={closeCreate} className="text-slate-300 hover:text-white w-9 h-9 rounded-lg hover:bg-slate-800 text-xl transition-colors">✕</button>
            </div>

            <form onSubmit={handleCreate} className="space-y-4">
              {/* Module Select */}
              <div>
                <label htmlFor="asg-module" className={LABEL}>
                  Select Module <span className="text-red-400">*</span>
                </label>
                <select
                  id="asg-module"
                  value={form.moduleId}
                  onChange={e => setForm({ ...form, moduleId: e.target.value })}
                  className={FIELD}
                  required
                >
                  <option value="">— Select a module —</option>
                  {modules.map(m => (
                    <option key={m.id} value={m.id}>{m.title || m.name || 'Untitled'}</option>
                  ))}
                </select>
                {modules.length === 0 && (
                  <p className="text-sm text-amber-300 mt-1">No modules yet. Create one first.</p>
                )}
              </div>

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                {/* Assign To Employee */}
                <div>
                  <label htmlFor="asg-emp" className={LABEL}>Assign To Employee</label>
                  <select
                    id="asg-emp"
                    value={form.employeeId}
                    onChange={e => setForm({ ...form, employeeId: e.target.value, groupId: '' })}
                    className={FIELD}
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
                  <label htmlFor="asg-group" className={LABEL}>
                    Or a Group <span className="text-slate-400 normal-case font-normal">(optional)</span>
                  </label>
                  <select
                    id="asg-group"
                    value={form.groupId}
                    onChange={e => setForm({ ...form, groupId: e.target.value, employeeId: '' })}
                    className={FIELD}
                  >
                    <option value="">— No group —</option>
                    {groups.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}
                  </select>
                </div>

                <div>
                  <label htmlFor="asg-prio" className={LABEL}>Priority</label>
                  <select
                    id="asg-prio"
                    value={form.priority}
                    onChange={e => setForm({ ...form, priority: e.target.value })}
                    className={FIELD}
                  >
                    <option value="low">Low</option>
                    <option value="medium">Medium</option>
                    <option value="high">High</option>
                    <option value="urgent">Urgent</option>
                  </select>
                </div>
                <div>
                  <label htmlFor="asg-due" className={LABEL}>Due Date</label>
                  <input
                    id="asg-due"
                    type="date"
                    value={form.dueDate}
                    onChange={e => setForm({ ...form, dueDate: e.target.value })}
                    min={new Date().toISOString().split('T')[0]}
                    className={FIELD}
                  />
                </div>
              </div>

              {/* Role hint */}
              {!isAdmin && isManager && (
                <div className="flex items-start gap-2 p-3 rounded-xl bg-amber-500/10 border border-amber-500/25">
                  <span className="text-amber-300 text-sm" aria-hidden="true">⚠️</span>
                  <p className="text-sm text-amber-200">As a manager, your request will be sent to an admin for approval before the assignment is created.</p>
                </div>
              )}

              <div className="flex flex-wrap justify-end gap-3 pt-1">
                <Button onClick={closeCreate} disabled={submitting}>Cancel</Button>
                <Button type="submit" variant="primary" loading={submitting}>
                  {submitting ? 'Submitting...' : isAdmin ? 'Create Assignment' : 'Submit Request'}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}
    </PageContainer>
  );
}
