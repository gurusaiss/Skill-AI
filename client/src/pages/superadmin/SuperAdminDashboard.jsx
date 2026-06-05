import React, { useState, useEffect } from 'react';
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
  if (text) { try { data = JSON.parse(text); } catch { throw new Error(`Server error (${res.status})`); } }
  if (!res.ok) { throw new Error(typeof data?.error === 'string' ? data.error : data?.error?.message || `Request failed (${res.status})`); }
  return data?.data ?? data;
};

// ─── Toast ────────────────────────────────────────────────────────────────────

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

// ─── Plan badge ───────────────────────────────────────────────────────────────

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

// ─── Status badge ─────────────────────────────────────────────────────────────

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

// ─── Stat Card ────────────────────────────────────────────────────────────────

function StatCard({ icon, label, value, color = 'violet' }) {
  const colors = {
    violet:  'bg-violet-600/20 border-violet-500/20 text-violet-300',
    emerald: 'bg-emerald-600/20 border-emerald-500/20 text-emerald-300',
    purple:  'bg-purple-600/20 border-purple-500/20 text-purple-300',
    blue:    'bg-blue-600/20 border-blue-500/20 text-blue-300',
    indigo:  'bg-indigo-600/20 border-indigo-500/20 text-indigo-300',
    amber:   'bg-amber-600/20 border-amber-500/20 text-amber-300',
  };
  return (
    <div className="bg-[#1E293B] border border-slate-700/60 rounded-2xl p-5">
      <div className={`inline-flex items-center justify-center w-10 h-10 rounded-xl border text-lg mb-3 ${colors[color]}`}>
        {icon}
      </div>
      <div className="text-2xl font-bold text-white tabular-nums">{value ?? '—'}</div>
      <div className="text-slate-400 text-sm mt-0.5">{label}</div>
    </div>
  );
}

// ─── Temp Password Modal ──────────────────────────────────────────────────────

function TempPasswordModal({ company, onClose }) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    navigator.clipboard.writeText(company.tempPassword || '');
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };
  return (
    <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-[100] p-4">
      <div className="bg-slate-800 border border-slate-700/80 rounded-2xl w-full max-w-sm p-6 shadow-2xl text-center">
        <div className="text-4xl mb-3">🔑</div>
        <h3 className="text-lg font-bold text-white mb-1">Company Created!</h3>
        <p className="text-slate-400 text-sm mb-1">
          <span className="text-white font-semibold">{company.companyName}</span> is live.
        </p>
        <p className="text-slate-400 text-sm mb-4">
          Admin account: <span className="text-white font-semibold">{company.adminEmail}</span>
        </p>
        <p className="text-slate-500 text-xs mb-2">Temporary password:</p>
        <div className="bg-slate-900 rounded-xl p-3 font-mono text-amber-300 text-sm tracking-widest mb-4 border border-amber-500/30">
          {company.tempPassword}
        </div>
        <p className="text-slate-500 text-xs mb-4">⚠️ This is shown only once. The admin should change it after first login.</p>
        <div className="flex gap-3">
          <button
            onClick={copy}
            className={`flex-1 py-2.5 rounded-xl font-bold text-sm transition-colors ${copied ? 'bg-emerald-600 text-white' : 'bg-violet-600 hover:bg-violet-500 text-white'}`}
          >
            {copied ? '✓ Copied!' : '📋 Copy Password'}
          </button>
          <button
            onClick={onClose}
            className="flex-1 py-2.5 rounded-xl bg-slate-700 hover:bg-slate-600 text-white font-bold text-sm transition-colors"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Create Company Modal ─────────────────────────────────────────────────────

function CreateCompanyModal({ onClose, onCreated, setToast }) {
  const [form, setForm] = useState({
    companyName: '',
    domain: '',
    plan: 'trial',
    adminName: '',
    adminEmail: '',
    adminPassword: '',
  });
  const [saving, setSaving] = useState(false);

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!form.companyName.trim()) { setToast({ message: 'Company name is required', type: 'error' }); return; }
    if (!form.adminName.trim())   { setToast({ message: 'Admin full name is required', type: 'error' }); return; }
    if (!form.adminEmail.trim())  { setToast({ message: 'Admin email is required', type: 'error' }); return; }
    setSaving(true);
    try {
      const result = await authFetch('/api/superadmin/companies', {
        method: 'POST',
        body: JSON.stringify({
          companyName: form.companyName.trim(),
          domain: form.domain.trim() || undefined,
          plan: form.plan,
          adminName: form.adminName.trim(),
          adminEmail: form.adminEmail.trim(),
          adminPassword: form.adminPassword.trim() || undefined,
        }),
      });
      setToast({ message: 'Company created successfully', type: 'success' });
      onCreated(result);
      onClose();
    } catch (err) {
      setToast({ message: err.message, type: 'error' });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-[100] p-4">
      <div className="bg-[#1E293B] border border-slate-700/80 rounded-2xl w-full max-w-lg shadow-2xl">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-700/60">
          <h2 className="text-lg font-bold text-white">🏢 Create New Company</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-white transition-colors text-xl">✕</button>
        </div>
        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          <div>
            <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-1.5">
              Company Name <span className="text-red-400">*</span>
            </label>
            <input
              value={form.companyName}
              onChange={e => set('companyName', e.target.value)}
              placeholder="Acme Corp"
              className="w-full bg-slate-900/60 border border-slate-700 rounded-xl px-4 py-2.5 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-violet-500/60"
            />
          </div>
          <div>
            <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-1.5">Domain (optional)</label>
            <input
              value={form.domain}
              onChange={e => set('domain', e.target.value)}
              placeholder="acme.com"
              className="w-full bg-slate-900/60 border border-slate-700 rounded-xl px-4 py-2.5 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-violet-500/60"
            />
          </div>
          <div>
            <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-1.5">Plan</label>
            <select
              value={form.plan}
              onChange={e => set('plan', e.target.value)}
              className="w-full bg-slate-900/60 border border-slate-700 rounded-xl px-4 py-2.5 text-sm text-white focus:outline-none focus:border-violet-500/60"
            >
              <option value="trial">Trial</option>
              <option value="standard">Standard</option>
              <option value="enterprise">Enterprise</option>
            </select>
          </div>

          <div className="border-t border-slate-700/60 pt-4">
            <p className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-3">Admin Account</p>
            <div className="space-y-3">
              <div>
                <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-1.5">
                  Admin Full Name <span className="text-red-400">*</span>
                </label>
                <input
                  value={form.adminName}
                  onChange={e => set('adminName', e.target.value)}
                  placeholder="Jane Smith"
                  className="w-full bg-slate-900/60 border border-slate-700 rounded-xl px-4 py-2.5 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-violet-500/60"
                />
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-1.5">
                  Admin Email <span className="text-red-400">*</span>
                </label>
                <input
                  type="email"
                  value={form.adminEmail}
                  onChange={e => set('adminEmail', e.target.value)}
                  placeholder="admin@acme.com"
                  className="w-full bg-slate-900/60 border border-slate-700 rounded-xl px-4 py-2.5 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-violet-500/60"
                />
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-1.5">
                  Admin Password <span className="text-slate-600 font-normal normal-case">(auto-generated if blank)</span>
                </label>
                <input
                  type="password"
                  value={form.adminPassword}
                  onChange={e => set('adminPassword', e.target.value)}
                  placeholder="Leave blank to auto-generate"
                  className="w-full bg-slate-900/60 border border-slate-700 rounded-xl px-4 py-2.5 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-violet-500/60"
                />
              </div>
            </div>
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
              {saving ? 'Creating...' : 'Create Company'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ─── Edit Company Modal ───────────────────────────────────────────────────────

function EditCompanyModal({ company, onClose, onSaved, setToast }) {
  const [form, setForm] = useState({
    companyName: company.companyName || company.name || '',
    domain: company.domain || '',
    plan: company.plan || 'trial',
    status: company.status || 'active',
  });
  const [saving, setSaving] = useState(false);

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!form.companyName.trim()) { setToast({ message: 'Company name is required', type: 'error' }); return; }
    setSaving(true);
    try {
      await authFetch(`/api/superadmin/companies/${company.id}`, {
        method: 'PUT',
        body: JSON.stringify({
          companyName: form.companyName.trim(),
          domain: form.domain.trim() || undefined,
          plan: form.plan,
          status: form.status,
        }),
      });
      setToast({ message: 'Company updated', type: 'success' });
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
          <h2 className="text-lg font-bold text-white">✏️ Edit Company</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-white transition-colors text-xl">✕</button>
        </div>
        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          <div>
            <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-1.5">
              Company Name <span className="text-red-400">*</span>
            </label>
            <input
              value={form.companyName}
              onChange={e => set('companyName', e.target.value)}
              className="w-full bg-slate-900/60 border border-slate-700 rounded-xl px-4 py-2.5 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-violet-500/60"
            />
          </div>
          <div>
            <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-1.5">Domain</label>
            <input
              value={form.domain}
              onChange={e => set('domain', e.target.value)}
              placeholder="acme.com"
              className="w-full bg-slate-900/60 border border-slate-700 rounded-xl px-4 py-2.5 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-violet-500/60"
            />
          </div>
          <div>
            <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-1.5">Plan</label>
            <select
              value={form.plan}
              onChange={e => set('plan', e.target.value)}
              className="w-full bg-slate-900/60 border border-slate-700 rounded-xl px-4 py-2.5 text-sm text-white focus:outline-none focus:border-violet-500/60"
            >
              <option value="trial">Trial</option>
              <option value="standard">Standard</option>
              <option value="enterprise">Enterprise</option>
            </select>
          </div>
          <div>
            <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-1.5">Status</label>
            <select
              value={form.status}
              onChange={e => set('status', e.target.value)}
              className="w-full bg-slate-900/60 border border-slate-700 rounded-xl px-4 py-2.5 text-sm text-white focus:outline-none focus:border-violet-500/60"
            >
              <option value="active">Active</option>
              <option value="suspended">Suspended</option>
              <option value="inactive">Inactive</option>
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

// ─── Company Row Users Expansion ──────────────────────────────────────────────

function CompanyUsers({ companyId }) {
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    authFetch(`/api/superadmin/companies/${companyId}/users`)
      .then(data => setUsers(Array.isArray(data) ? data : (data?.users || [])))
      .catch(err => setError(err.message))
      .finally(() => setLoading(false));
  }, [companyId]);

  if (loading) return <div className="px-6 py-4 text-slate-400 text-sm">Loading users...</div>;
  if (error)   return <div className="px-6 py-4 text-red-400 text-sm">Error: {error}</div>;
  if (!users.length) return <div className="px-6 py-4 text-slate-500 text-sm">No users found for this company.</div>;

  return (
    <div className="px-6 pb-4">
      <div className="bg-slate-900/60 rounded-xl overflow-hidden border border-slate-700/40">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-700/40">
              <th className="text-left px-4 py-2 text-xs font-bold text-slate-500 uppercase tracking-wider">Name</th>
              <th className="text-left px-4 py-2 text-xs font-bold text-slate-500 uppercase tracking-wider">Email</th>
              <th className="text-left px-4 py-2 text-xs font-bold text-slate-500 uppercase tracking-wider">Role</th>
              <th className="text-left px-4 py-2 text-xs font-bold text-slate-500 uppercase tracking-wider">Status</th>
            </tr>
          </thead>
          <tbody>
            {users.map(u => (
              <tr key={u.id || u.userId} className="border-b border-slate-700/20 last:border-0">
                <td className="px-4 py-2 text-white">{u.name || u.fullName || '—'}</td>
                <td className="px-4 py-2 text-slate-400">{u.email}</td>
                <td className="px-4 py-2">
                  <span className={`text-xs font-semibold px-2 py-0.5 rounded-full border ${
                    u.role === 'admin' ? 'bg-purple-500/20 text-purple-300 border-purple-500/30' :
                    u.role === 'manager' ? 'bg-indigo-500/20 text-indigo-300 border-indigo-500/30' :
                    'bg-emerald-500/20 text-emerald-300 border-emerald-500/30'
                  }`}>{u.role}</span>
                </td>
                <td className="px-4 py-2">
                  <StatusBadge status={u.status} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function SuperAdminDashboard() {
  const { user } = useAuth();
  const navigate = useNavigate();

  const [stats, setStats]           = useState(null);
  const [companies, setCompanies]   = useState([]);
  const [loading, setLoading]       = useState(true);
  const [toast, setToast]           = useState(null);
  const [showCreate, setShowCreate] = useState(false);
  const [editCompany, setEditCompany] = useState(null);
  const [expandedRows, setExpandedRows] = useState({});
  const [tempPasswordData, setTempPasswordData] = useState(null);
  const [togglingId, setTogglingId] = useState(null);

  const fetchData = async () => {
    try {
      const [statsData, companiesData] = await Promise.all([
        authFetch('/api/superadmin/stats'),
        authFetch('/api/superadmin/companies'),
      ]);
      setStats(statsData);
      setCompanies(Array.isArray(companiesData) ? companiesData : (companiesData?.companies || []));
    } catch (err) {
      setToast({ message: err.message, type: 'error' });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchData(); }, []);

  const toggleExpand = (id) => {
    setExpandedRows(prev => ({ ...prev, [id]: !prev[id] }));
  };

  const handleToggleStatus = async (company) => {
    const newStatus = company.status === 'active' ? 'suspended' : 'active';
    setTogglingId(company.id);
    try {
      await authFetch(`/api/superadmin/companies/${company.id}`, {
        method: 'PUT',
        body: JSON.stringify({ status: newStatus }),
      });
      setCompanies(prev => prev.map(c => c.id === company.id ? { ...c, status: newStatus } : c));
      setToast({ message: `Company ${newStatus === 'active' ? 'activated' : 'suspended'}`, type: 'success' });
    } catch (err) {
      setToast({ message: err.message, type: 'error' });
    } finally {
      setTogglingId(null);
    }
  };

  const handleCompanyCreated = (result) => {
    fetchData();
    if (result?.tempPassword) {
      setTempPasswordData({
        companyName: result.companyName || result.company?.name,
        adminEmail: result.adminEmail || result.admin?.email,
        tempPassword: result.tempPassword,
      });
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-[#0F172A] flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin text-violet-400 text-4xl mb-4">⟳</div>
          <div className="text-slate-400 text-sm">Loading platform data...</div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#0F172A] text-[#F8FAFC]">
      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}
      {tempPasswordData && <TempPasswordModal company={tempPasswordData} onClose={() => setTempPasswordData(null)} />}
      {showCreate && (
        <CreateCompanyModal
          onClose={() => setShowCreate(false)}
          onCreated={handleCompanyCreated}
          setToast={setToast}
        />
      )}
      {editCompany && (
        <EditCompanyModal
          company={editCompany}
          onClose={() => setEditCompany(null)}
          onSaved={fetchData}
          setToast={setToast}
        />
      )}

      <div className="max-w-7xl mx-auto px-6 py-8 lg:px-8">

        {/* Page Header */}
        <div className="flex items-start justify-between mb-8">
          <div>
            <div className="flex items-center gap-3 mb-1">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-violet-600/20 border border-violet-500/20 text-xl">🌐</div>
              <div>
                <h1 className="text-2xl font-bold text-white">Super Admin Dashboard</h1>
                <p className="text-violet-400 text-sm font-semibold">SkillForge AI</p>
              </div>
            </div>
            <p className="text-slate-400 text-sm mt-1 ml-[52px]">Platform-wide overview — manage all companies and admins</p>
          </div>
          <button
            onClick={() => setShowCreate(true)}
            className="flex items-center gap-2 px-4 py-2.5 bg-violet-600 hover:bg-violet-500 rounded-xl text-white font-bold text-sm transition-colors shadow-lg"
          >
            <span>+</span> Create Company
          </button>
        </div>

        {/* Stats Grid */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-4 mb-8">
          <StatCard icon="🏢" label="Total Companies"  value={stats?.totalCompanies}         color="violet" />
          <StatCard icon="✅" label="Active Companies" value={stats?.activeCompanies}         color="emerald" />
          <StatCard icon="👑" label="Total Admins"     value={stats?.totalAdmins}             color="purple" />
          <StatCard icon="👥" label="Total Employees"  value={stats?.totalEmployees}          color="blue" />
          <StatCard icon="📊" label="Standard Plan"    value={stats?.byPlan?.standard ?? 0}  color="indigo" />
          <StatCard icon="⚡" label="Enterprise Plan"  value={stats?.byPlan?.enterprise ?? 0} color="amber" />
        </div>

        {/* Companies Table */}
        <div className="bg-[#1E293B] border border-slate-700/60 rounded-2xl overflow-hidden">
          <div className="px-6 py-4 border-b border-slate-700/60 flex items-center justify-between">
            <h2 className="text-base font-bold text-white">All Companies</h2>
            <span className="text-slate-500 text-sm">{companies.length} total</span>
          </div>

          {companies.length === 0 ? (
            <div className="px-6 py-16 text-center text-slate-500">
              <div className="text-4xl mb-3">🏢</div>
              <p className="text-sm">No companies yet. Create one to get started.</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-700/60">
                    <th className="text-left px-6 py-3 text-xs font-bold text-slate-500 uppercase tracking-wider">Company</th>
                    <th className="text-left px-4 py-3 text-xs font-bold text-slate-500 uppercase tracking-wider">Plan</th>
                    <th className="text-left px-4 py-3 text-xs font-bold text-slate-500 uppercase tracking-wider">Admin</th>
                    <th className="text-left px-4 py-3 text-xs font-bold text-slate-500 uppercase tracking-wider">Users</th>
                    <th className="text-left px-4 py-3 text-xs font-bold text-slate-500 uppercase tracking-wider">Employees</th>
                    <th className="text-left px-4 py-3 text-xs font-bold text-slate-500 uppercase tracking-wider">Status</th>
                    <th className="text-right px-6 py-3 text-xs font-bold text-slate-500 uppercase tracking-wider">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-700/30">
                  {companies.map(company => (
                    <React.Fragment key={company.id}>
                      <tr className="hover:bg-slate-700/20 transition-colors">
                        <td className="px-6 py-4">
                          <div>
                            <p className="font-semibold text-white">{company.companyName || company.name}</p>
                            {company.domain && <p className="text-xs text-slate-500 mt-0.5">{company.domain}</p>}
                          </div>
                        </td>
                        <td className="px-4 py-4">
                          <PlanBadge plan={company.plan} />
                        </td>
                        <td className="px-4 py-4">
                          <div>
                            <p className="text-white">{company.adminName || '—'}</p>
                            <p className="text-xs text-slate-500 mt-0.5">{company.adminEmail || ''}</p>
                          </div>
                        </td>
                        <td className="px-4 py-4 text-slate-300 tabular-nums">{company.userCount ?? company.totalUsers ?? '—'}</td>
                        <td className="px-4 py-4 text-slate-300 tabular-nums">{company.employeeCount ?? company.totalEmployees ?? '—'}</td>
                        <td className="px-4 py-4">
                          <StatusBadge status={company.status} />
                        </td>
                        <td className="px-6 py-4">
                          <div className="flex items-center justify-end gap-2">
                            <button
                              onClick={() => toggleExpand(company.id)}
                              className="px-3 py-1.5 rounded-lg bg-slate-700 hover:bg-slate-600 text-slate-300 hover:text-white text-xs font-semibold transition-colors"
                            >
                              {expandedRows[company.id] ? 'Hide Users' : 'View Users'}
                            </button>
                            <button
                              onClick={() => handleToggleStatus(company)}
                              disabled={togglingId === company.id}
                              className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors disabled:opacity-50 ${
                                company.status === 'active'
                                  ? 'bg-red-900/40 hover:bg-red-900/60 text-red-400 hover:text-red-300'
                                  : 'bg-emerald-900/40 hover:bg-emerald-900/60 text-emerald-400 hover:text-emerald-300'
                              }`}
                            >
                              {togglingId === company.id ? '...' : company.status === 'active' ? 'Suspend' : 'Activate'}
                            </button>
                            <button
                              onClick={() => setEditCompany(company)}
                              className="px-3 py-1.5 rounded-lg bg-violet-900/40 hover:bg-violet-900/60 text-violet-400 hover:text-violet-300 text-xs font-semibold transition-colors"
                            >
                              Edit
                            </button>
                          </div>
                        </td>
                      </tr>
                      {expandedRows[company.id] && (
                        <tr>
                          <td colSpan={7} className="bg-slate-800/40">
                            <CompanyUsers companyId={company.id} />
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
