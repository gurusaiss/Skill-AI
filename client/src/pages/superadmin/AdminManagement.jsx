import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { authFetch } from '../../utils/authFetch.js';

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

function formatDate(d) {
  if (!d) return '—';
  const dt = new Date(d);
  return isNaN(dt) ? '—' : dt.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
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
      {status ? status.charAt(0).toUpperCase() + status.slice(1) : 'Active'}
    </span>
  );
}

function StatMini({ label, value, color = 'slate' }) {
  const colors = {
    violet:  'text-violet-300',
    emerald: 'text-emerald-300',
    blue:    'text-blue-300',
    amber:   'text-amber-300',
    indigo:  'text-indigo-300',
    slate:   'text-slate-300',
  };
  return (
    <div className="bg-slate-900/60 rounded-xl p-3 text-center border border-slate-700/40">
      <div className={`text-xl font-bold tabular-nums ${colors[color]}`}>{value ?? '—'}</div>
      <div className="text-slate-500 text-xs mt-0.5">{label}</div>
    </div>
  );
}

// ─── Admin Detail Modal ───────────────────────────────────────────────────────

function AdminDetailModal({ admin, onClose, setToast, onRefresh }) {
  const [details, setDetails] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    authFetch(`/api/superadmin/admins/${admin.userId}/stats`)
      .then(d => setDetails(d))
      .catch(e => setError(e.message))
      .finally(() => setLoading(false));
  }, [admin.userId]);

  return (
    <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-[100] p-4">
      <div className="bg-[#1E293B] border border-slate-700/80 rounded-2xl w-full max-w-2xl shadow-2xl max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-700/60 sticky top-0 bg-[#1E293B] z-10">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-violet-600/20 border border-violet-500/20 text-violet-300 font-bold">
              {(admin.name || '?').charAt(0).toUpperCase()}
            </div>
            <div>
              <h2 className="text-lg font-bold text-white">{admin.name || '—'}</h2>
              <p className="text-slate-400 text-xs">{admin.email}</p>
            </div>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-white transition-colors text-xl">✕</button>
        </div>

        <div className="p-6">
          {loading && (
            <div className="text-center py-10">
              <div className="animate-spin text-violet-400 text-3xl mb-3">⟳</div>
              <div className="text-slate-400 text-sm">Loading live stats...</div>
            </div>
          )}
          {error && (
            <div className="text-center py-10 text-red-400 text-sm">{error}</div>
          )}
          {details && (
            <>
              {/* Company info */}
              <div className="bg-slate-900/60 rounded-xl p-4 border border-slate-700/40 mb-5">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-sm font-bold text-slate-300 uppercase tracking-wider">Company Details</h3>
                  <PlanBadge plan={details.company?.plan} />
                </div>
                <div className="grid grid-cols-2 gap-3 text-sm">
                  <div>
                    <span className="text-slate-500 text-xs">Company Name</span>
                    <p className="text-white font-semibold mt-0.5">{details.company?.name || '—'}</p>
                  </div>
                  <div>
                    <span className="text-slate-500 text-xs">Status</span>
                    <div className="mt-0.5"><StatusBadge status={details.company?.status} /></div>
                  </div>
                  <div>
                    <span className="text-slate-500 text-xs">Domain</span>
                    <p className="text-white mt-0.5">{details.company?.domain || '—'}</p>
                  </div>
                  <div>
                    <span className="text-slate-500 text-xs">Admin Since</span>
                    <p className="text-white mt-0.5">{formatDate(details.admin?.createdAt)}</p>
                  </div>
                  <div>
                    <span className="text-slate-500 text-xs">Last Login</span>
                    <p className="text-white mt-0.5">{formatDate(details.admin?.lastLogin)}</p>
                  </div>
                  <div>
                    <span className="text-slate-500 text-xs">Account Status</span>
                    <div className="mt-0.5"><StatusBadge status={details.admin?.status} /></div>
                  </div>
                </div>
              </div>

              {/* Stats Grid */}
              <h3 className="text-sm font-bold text-slate-300 uppercase tracking-wider mb-3">Live Company Stats</h3>
              <div className="grid grid-cols-4 gap-3 mb-5">
                <StatMini label="Total Users"   value={details.stats?.totalUsers}       color="violet" />
                <StatMini label="Employees"     value={details.stats?.employees}         color="emerald" />
                <StatMini label="Managers"      value={details.stats?.managers}          color="blue" />
                <StatMini label="Active (30d)"  value={details.stats?.activeUsers}       color="amber" />
              </div>
              <div className="grid grid-cols-4 gap-3 mb-5">
                <StatMini label="Modules"       value={details.stats?.totalModules}      color="indigo" />
                <StatMini label="Assignments"   value={details.stats?.totalAssignments}  color="violet" />
                <StatMini label="Completed"     value={details.stats?.completedAssignments} color="emerald" />
                <StatMini label="Completion %"  value={`${details.stats?.completionRate ?? 0}%`} color="amber" />
              </div>

              {/* Completion bar */}
              <div className="bg-slate-900/60 rounded-xl p-4 border border-slate-700/40">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-slate-400 text-sm">Overall Completion Rate</span>
                  <span className="text-white font-bold text-sm">{details.stats?.completionRate ?? 0}%</span>
                </div>
                <div className="w-full h-2 bg-slate-700 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-gradient-to-r from-violet-500 to-emerald-500 rounded-full transition-all duration-700"
                    style={{ width: `${details.stats?.completionRate ?? 0}%` }}
                  />
                </div>
              </div>
            </>
          )}
        </div>

        <div className="px-6 pb-6">
          <button
            onClick={onClose}
            className="w-full py-2.5 rounded-xl bg-slate-700 hover:bg-slate-600 text-white font-bold text-sm transition-colors"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Edit Admin Modal ─────────────────────────────────────────────────────────

function EditAdminModal({ admin, onClose, onSaved, setToast }) {
  const [form, setForm] = useState({
    name: admin.name || '',
    email: admin.email || '',
    status: admin.status || 'active',
  });
  const [saving, setSaving] = useState(false);
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!form.name.trim()) { setToast({ message: 'Name is required', type: 'error' }); return; }
    if (!form.email.trim()) { setToast({ message: 'Email is required', type: 'error' }); return; }
    setSaving(true);
    try {
      await authFetch(`/api/superadmin/admins/${admin.userId}`, {
        method: 'PUT',
        body: JSON.stringify({ name: form.name.trim(), email: form.email.trim(), status: form.status }),
      });
      setToast({ message: 'Admin updated successfully', type: 'success' });
      onSaved();
      onClose();
    } catch (err) {
      setToast({ message: err.message, type: 'error' });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-[100] p-4">
      <div className="bg-[#1E293B] border border-slate-700/80 rounded-2xl w-full max-w-md shadow-2xl">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-700/60">
          <h2 className="text-lg font-bold text-white">✏️ Edit Admin</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-white transition-colors text-xl">✕</button>
        </div>
        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          <div>
            <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-1.5">
              Full Name <span className="text-red-400">*</span>
            </label>
            <input
              value={form.name}
              onChange={e => set('name', e.target.value)}
              className="w-full bg-slate-900/60 border border-slate-700 rounded-xl px-4 py-2.5 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-violet-500/60"
            />
          </div>
          <div>
            <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-1.5">
              Email <span className="text-red-400">*</span>
            </label>
            <input
              type="email"
              value={form.email}
              onChange={e => set('email', e.target.value)}
              className="w-full bg-slate-900/60 border border-slate-700 rounded-xl px-4 py-2.5 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-violet-500/60"
            />
          </div>
          <div>
            <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-1.5">Status</label>
            <select
              value={form.status}
              onChange={e => set('status', e.target.value)}
              className="w-full bg-slate-900/60 border border-slate-700 rounded-xl px-4 py-2.5 text-sm text-white focus:outline-none focus:border-violet-500/60"
            >
              <option value="active">Active</option>
              <option value="inactive">Inactive</option>
              <option value="suspended">Suspended</option>
            </select>
          </div>
          <div className="flex gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 py-2.5 rounded-xl bg-slate-700 hover:bg-slate-600 text-white font-bold text-sm transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving}
              className="flex-1 py-2.5 rounded-xl bg-violet-600 hover:bg-violet-500 disabled:opacity-60 text-white font-bold text-sm transition-colors"
            >
              {saving ? 'Saving...' : 'Save Changes'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function AdminManagement() {
  const { user } = useAuth();
  const navigate = useNavigate();

  const [admins, setAdmins]       = useState([]);
  const [loading, setLoading]     = useState(true);
  const [toast, setToast]         = useState(null);
  const [search, setSearch]       = useState('');
  const [filterPlan, setFilterPlan] = useState('all');
  const [filterStatus, setFilterStatus] = useState('all');
  const [viewAdmin, setViewAdmin] = useState(null);
  const [editAdmin, setEditAdmin] = useState(null);

  const fetchAdmins = useCallback(() => {
    setLoading(true);
    authFetch('/api/superadmin/admins')
      .then(data => setAdmins(Array.isArray(data) ? data : (data?.admins || [])))
      .catch(err => setToast({ message: err.message, type: 'error' }))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { fetchAdmins(); }, [fetchAdmins]);

  const handleDelete = async (admin) => {
    if (!window.confirm(`Delete admin "${admin.name}"? Their company will remain but have no admin.`)) return;
    try {
      await authFetch(`/api/superadmin/admins/${admin.userId}`, { method: 'DELETE' });
      setToast({ message: 'Admin deleted', type: 'success' });
      fetchAdmins();
    } catch (err) {
      setToast({ message: err.message, type: 'error' });
    }
  };

  const filtered = admins.filter(a => {
    if (filterPlan !== 'all' && a.plan !== filterPlan) return false;
    if (filterStatus !== 'all' && a.companyStatus !== filterStatus) return false;
    if (!search.trim()) return true;
    const q = search.toLowerCase();
    return (
      (a.name || '').toLowerCase().includes(q) ||
      (a.email || '').toLowerCase().includes(q) ||
      (a.companyName || '').toLowerCase().includes(q)
    );
  });

  if (loading) {
    return (
      <div className="min-h-screen bg-[#0F172A] flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin text-violet-400 text-4xl mb-4">⟳</div>
          <div className="text-slate-400 text-sm">Loading admins...</div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#0F172A] text-[#F8FAFC]">
      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}
      {viewAdmin && (
        <AdminDetailModal
          admin={viewAdmin}
          onClose={() => setViewAdmin(null)}
          setToast={setToast}
          onRefresh={fetchAdmins}
        />
      )}
      {editAdmin && (
        <EditAdminModal
          admin={editAdmin}
          onClose={() => setEditAdmin(null)}
          onSaved={fetchAdmins}
          setToast={setToast}
        />
      )}

      <div className="max-w-7xl mx-auto px-6 py-8 lg:px-8">

        {/* Page Header */}
        <div className="flex items-start justify-between mb-8">
          <div>
            <div className="flex items-center gap-3 mb-1">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-violet-600/20 border border-violet-500/20 text-xl">👑</div>
              <div>
                <h1 className="text-2xl font-bold text-white">Admin Management</h1>
                <p className="text-violet-400 text-sm font-semibold">SkillForge AI</p>
              </div>
            </div>
            <p className="text-slate-400 text-sm mt-1 ml-[52px]">All admin accounts across all companies — click a row to view live stats</p>
          </div>
          <button
            onClick={() => navigate('/superadmin/dashboard')}
            className="flex items-center gap-2 px-4 py-2.5 bg-slate-700 hover:bg-slate-600 rounded-xl text-white font-bold text-sm transition-colors"
          >
            ← Platform
          </button>
        </div>

        {/* Summary Cards */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-6">
          <div className="bg-[#1E293B] border border-slate-700/60 rounded-2xl p-4 text-center">
            <div className="text-2xl font-bold text-violet-300 tabular-nums">{admins.length}</div>
            <div className="text-slate-400 text-xs mt-0.5">Total Admins</div>
          </div>
          <div className="bg-[#1E293B] border border-slate-700/60 rounded-2xl p-4 text-center">
            <div className="text-2xl font-bold text-emerald-300 tabular-nums">
              {admins.filter(a => a.companyStatus === 'active').length}
            </div>
            <div className="text-slate-400 text-xs mt-0.5">Active Companies</div>
          </div>
          <div className="bg-[#1E293B] border border-slate-700/60 rounded-2xl p-4 text-center">
            <div className="text-2xl font-bold text-amber-300 tabular-nums">
              {admins.filter(a => a.plan === 'trial').length}
            </div>
            <div className="text-slate-400 text-xs mt-0.5">Trial Plan</div>
          </div>
          <div className="bg-[#1E293B] border border-slate-700/60 rounded-2xl p-4 text-center">
            <div className="text-2xl font-bold text-purple-300 tabular-nums">
              {admins.filter(a => a.plan === 'enterprise').length}
            </div>
            <div className="text-slate-400 text-xs mt-0.5">Enterprise Plan</div>
          </div>
        </div>

        {/* Filter Bar */}
        <div className="flex flex-wrap items-center gap-3 mb-5">
          <div className="relative flex-1 min-w-[200px] max-w-xs">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-sm">🔍</span>
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search name, email, or company..."
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
          <select
            value={filterStatus}
            onChange={e => setFilterStatus(e.target.value)}
            className="bg-[#1E293B] border border-slate-700 rounded-xl px-3 py-2.5 text-sm text-white focus:outline-none focus:border-violet-500/60"
          >
            <option value="all">All Status</option>
            <option value="active">Active</option>
            <option value="suspended">Suspended</option>
          </select>
          <span className="text-slate-500 text-sm ml-auto">{filtered.length} of {admins.length}</span>
        </div>

        {/* Admins Table */}
        <div className="bg-[#1E293B] border border-slate-700/60 rounded-2xl overflow-hidden">
          {filtered.length === 0 ? (
            <div className="px-6 py-16 text-center text-slate-500">
              <div className="text-4xl mb-3">👑</div>
              <p className="text-sm">{search || filterPlan !== 'all' || filterStatus !== 'all' ? 'No admins match your filters.' : 'No admins found.'}</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-700/60 bg-slate-800/30">
                    <th className="text-left px-6 py-3 text-xs font-bold text-slate-500 uppercase tracking-wider">Admin</th>
                    <th className="text-left px-4 py-3 text-xs font-bold text-slate-500 uppercase tracking-wider">Company</th>
                    <th className="text-left px-4 py-3 text-xs font-bold text-slate-500 uppercase tracking-wider">Email</th>
                    <th className="text-left px-4 py-3 text-xs font-bold text-slate-500 uppercase tracking-wider">Status</th>
                    <th className="text-left px-4 py-3 text-xs font-bold text-slate-500 uppercase tracking-wider">Plan</th>
                    <th className="text-left px-4 py-3 text-xs font-bold text-slate-500 uppercase tracking-wider">Created</th>
                    <th className="text-right px-6 py-3 text-xs font-bold text-slate-500 uppercase tracking-wider">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-700/30">
                  {filtered.map(admin => (
                    <tr
                      key={admin.userId}
                      className="hover:bg-slate-700/20 transition-colors cursor-pointer"
                      onClick={() => setViewAdmin(admin)}
                    >
                      <td className="px-6 py-4">
                        <div className="flex items-center gap-3">
                          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-violet-600/20 border border-violet-500/20 text-violet-300 text-xs font-bold flex-shrink-0">
                            {(admin.name || '?').charAt(0).toUpperCase()}
                          </div>
                          <span className="font-semibold text-white">{admin.name || '—'}</span>
                        </div>
                      </td>
                      <td className="px-4 py-4">
                        <div>
                          <p className="text-white font-medium">{admin.companyName || '—'}</p>
                          <StatusBadge status={admin.companyStatus} />
                        </div>
                      </td>
                      <td className="px-4 py-4 text-slate-400">{admin.email}</td>
                      <td className="px-4 py-4">
                        <StatusBadge status={admin.status || 'active'} />
                      </td>
                      <td className="px-4 py-4">
                        <PlanBadge plan={admin.plan} />
                      </td>
                      <td className="px-4 py-4 text-slate-400 text-xs">{formatDate(admin.createdAt)}</td>
                      <td className="px-6 py-4">
                        <div className="flex items-center justify-end gap-2" onClick={e => e.stopPropagation()}>
                          <button
                            onClick={() => setViewAdmin(admin)}
                            className="px-3 py-1.5 rounded-lg bg-violet-900/40 hover:bg-violet-900/60 text-violet-400 hover:text-violet-300 text-xs font-semibold transition-colors"
                          >
                            View
                          </button>
                          <button
                            onClick={() => setEditAdmin(admin)}
                            className="px-3 py-1.5 rounded-lg bg-slate-700 hover:bg-slate-600 text-slate-300 hover:text-white text-xs font-semibold transition-colors"
                          >
                            Edit
                          </button>
                          <button
                            onClick={() => handleDelete(admin)}
                            className="px-3 py-1.5 rounded-lg bg-red-900/40 hover:bg-red-900/60 text-red-400 hover:text-red-300 text-xs font-semibold transition-colors"
                          >
                            Delete
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <div className="mt-4 text-center text-slate-600 text-xs">
          Admins are created via the{' '}
          <button onClick={() => navigate('/superadmin/dashboard')} className="text-violet-400 hover:text-violet-300 underline">
            Company creation
          </button>{' '}
          flow on the Platform page.
        </div>
      </div>
    </div>
  );
}
