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

function formatDate(d) {
  if (!d) return '—';
  const dt = new Date(d);
  return isNaN(dt) ? '—' : dt.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
}

function CompanyStatusBadge({ status }) {
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

// ─── Main Component ───────────────────────────────────────────────────────────

export default function AdminManagement() {
  const { user } = useAuth();
  const navigate = useNavigate();

  const [admins, setAdmins]   = useState([]);
  const [loading, setLoading] = useState(true);
  const [toast, setToast]     = useState(null);
  const [search, setSearch]   = useState('');

  useEffect(() => {
    authFetch('/api/superadmin/admins')
      .then(data => setAdmins(Array.isArray(data) ? data : (data?.admins || [])))
      .catch(err => setToast({ message: err.message, type: 'error' }))
      .finally(() => setLoading(false));
  }, []);

  const filtered = admins.filter(a => {
    if (!search.trim()) return true;
    const q = search.toLowerCase();
    return (
      (a.name || a.fullName || '').toLowerCase().includes(q) ||
      (a.email || '').toLowerCase().includes(q) ||
      (a.companyName || a.company?.name || '').toLowerCase().includes(q)
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
            <p className="text-slate-400 text-sm mt-1 ml-[52px]">All admin accounts across all companies</p>
          </div>
          <button
            onClick={() => navigate('/superadmin/dashboard')}
            className="flex items-center gap-2 px-4 py-2.5 bg-slate-700 hover:bg-slate-600 rounded-xl text-white font-bold text-sm transition-colors"
          >
            ← Dashboard
          </button>
        </div>

        {/* Search */}
        <div className="mb-6">
          <div className="relative max-w-sm">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-sm">🔍</span>
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search by name, email, or company..."
              className="w-full bg-[#1E293B] border border-slate-700 rounded-xl pl-9 pr-4 py-2.5 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-violet-500/60"
            />
          </div>
        </div>

        {/* Admins Table */}
        <div className="bg-[#1E293B] border border-slate-700/60 rounded-2xl overflow-hidden">
          <div className="px-6 py-4 border-b border-slate-700/60 flex items-center justify-between">
            <h2 className="text-base font-bold text-white">All Admins</h2>
            <span className="text-slate-500 text-sm">{filtered.length} of {admins.length}</span>
          </div>

          {filtered.length === 0 ? (
            <div className="px-6 py-16 text-center text-slate-500">
              <div className="text-4xl mb-3">👑</div>
              <p className="text-sm">{search ? 'No admins match your search.' : 'No admins found.'}</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-700/60">
                    <th className="text-left px-6 py-3 text-xs font-bold text-slate-500 uppercase tracking-wider">Admin</th>
                    <th className="text-left px-4 py-3 text-xs font-bold text-slate-500 uppercase tracking-wider">Email</th>
                    <th className="text-left px-4 py-3 text-xs font-bold text-slate-500 uppercase tracking-wider">Company</th>
                    <th className="text-left px-4 py-3 text-xs font-bold text-slate-500 uppercase tracking-wider">Company Status</th>
                    <th className="text-left px-4 py-3 text-xs font-bold text-slate-500 uppercase tracking-wider">Last Login</th>
                    <th className="text-right px-6 py-3 text-xs font-bold text-slate-500 uppercase tracking-wider">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-700/30">
                  {filtered.map(admin => (
                    <tr key={admin.id || admin.userId} className="hover:bg-slate-700/20 transition-colors">
                      <td className="px-6 py-4">
                        <div className="flex items-center gap-3">
                          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-violet-600/20 border border-violet-500/20 text-violet-300 text-xs font-bold flex-shrink-0">
                            {(admin.name || admin.fullName || '?').charAt(0).toUpperCase()}
                          </div>
                          <span className="font-semibold text-white">{admin.name || admin.fullName || '—'}</span>
                        </div>
                      </td>
                      <td className="px-4 py-4 text-slate-400">{admin.email}</td>
                      <td className="px-4 py-4">
                        <span className="text-white">{admin.companyName || admin.company?.name || '—'}</span>
                      </td>
                      <td className="px-4 py-4">
                        <CompanyStatusBadge status={admin.companyStatus || admin.company?.status} />
                      </td>
                      <td className="px-4 py-4 text-slate-400">{formatDate(admin.lastLogin || admin.last_login)}</td>
                      <td className="px-6 py-4">
                        <div className="flex items-center justify-end gap-2">
                          <button
                            onClick={() => navigate('/superadmin/dashboard')}
                            className="px-3 py-1.5 rounded-lg bg-violet-900/40 hover:bg-violet-900/60 text-violet-400 hover:text-violet-300 text-xs font-semibold transition-colors"
                          >
                            View Company
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

        {/* Summary footer */}
        <div className="mt-4 text-center text-slate-600 text-xs">
          Admins are created via the <button onClick={() => navigate('/superadmin/dashboard')} className="text-violet-400 hover:text-violet-300 underline">Company creation</button> flow.
        </div>
      </div>
    </div>
  );
}
