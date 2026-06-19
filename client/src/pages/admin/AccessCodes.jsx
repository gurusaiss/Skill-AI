import React, { useState, useEffect } from 'react';
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

function CopyBtn({ text }) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    navigator.clipboard.writeText(text || '');
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };
  return (
    <button onClick={copy} title="Copy to clipboard"
      className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${copied ? 'bg-emerald-600 text-white' : 'bg-slate-700 hover:bg-slate-600 text-slate-300 hover:text-white'}`}>
      {copied ? '✓ Copied' : '📋 Copy'}
    </button>
  );
}

const ROLE_STYLE = {
  manager: { badge: 'bg-amber-500/15 border-amber-500/40 text-amber-300', code: 'text-amber-300', border: 'border-amber-500/30', bg: 'bg-amber-600/10 border-amber-500/20' },
  employee: { badge: 'bg-indigo-500/15 border-indigo-500/40 text-indigo-300', code: 'text-indigo-300', border: 'border-indigo-500/30', bg: 'bg-indigo-600/10 border-indigo-500/20' },
};

export default function AccessCodes() {
  const { user } = useAuth();
  const [codes, setCodes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(null);
  const [toast, setToast] = useState(null);
  const [showNewForm, setShowNewForm] = useState(false);
  const [newCodeRole, setNewCodeRole] = useState('employee');
  const [newCodeLabel, setNewCodeLabel] = useState('');
  const [newCodeMax, setNewCodeMax] = useState('');
  const [newCodeExpiry, setNewCodeExpiry] = useState('');

  const fetchCodes = () => {
    setLoading(true);
    authFetch('/api/admin/codes')
      .then(d => setCodes(Array.isArray(d) ? d : (d?.codes || [])))
      .catch(err => setToast({ message: err.message, type: 'error' }))
      .finally(() => setLoading(false));
  };

  useEffect(() => { fetchCodes(); }, []);

  const doAction = async (codeId, payload, label) => {
    setBusy(codeId + label);
    try {
      await authFetch(`/api/admin/codes/${codeId}`, {
        method: 'PUT', body: JSON.stringify(payload),
      });
      setToast({ message: `Code ${label}`, type: 'success' });
      fetchCodes();
    } catch (err) {
      setToast({ message: err.message, type: 'error' });
    } finally {
      setBusy(null);
    }
  };

  const createCode = async () => {
    setBusy('create');
    try {
      await authFetch('/api/admin/codes', {
        method: 'POST',
        body: JSON.stringify({
          role: newCodeRole,
          label: newCodeLabel.trim() || undefined,
          maxUsage: newCodeMax ? parseInt(newCodeMax) : undefined,
          expiresAt: newCodeExpiry || undefined,
        }),
      });
      setToast({ message: 'New access code created', type: 'success' });
      setShowNewForm(false);
      setNewCodeRole('employee');
      setNewCodeLabel('');
      setNewCodeMax('');
      setNewCodeExpiry('');
      fetchCodes();
    } catch (err) {
      setToast({ message: err.message, type: 'error' });
    } finally {
      setBusy(null);
    }
  };

  const deleteCode = async (codeId) => {
    if (!window.confirm('Delete this access code? Users holding it can no longer sign up.')) return;
    setBusy(codeId + 'del');
    try {
      await authFetch(`/api/admin/codes/${codeId}`, { method: 'DELETE' });
      setToast({ message: 'Code deleted', type: 'success' });
      fetchCodes();
    } catch (err) {
      setToast({ message: err.message, type: 'error' });
    } finally {
      setBusy(null);
    }
  };

  const managers = codes.filter(c => c.role === 'manager');
  const employees = codes.filter(c => c.role === 'employee');

  return (
    <div className="min-h-screen bg-[#0F172A] text-[#F8FAFC] p-6 lg:p-8">
      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}

      <div className="max-w-4xl mx-auto">
        {/* Header */}
        <div className="flex items-start justify-between mb-8">
          <div>
            <div className="flex items-center gap-3 mb-1">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-amber-600/20 border border-amber-500/20 text-xl">🔑</div>
              <div>
                <h1 className="text-2xl font-bold text-white">Access Codes</h1>
                <p className="text-slate-400 text-sm">Manage onboarding codes for your company</p>
              </div>
            </div>
          </div>
          <button
            onClick={() => setShowNewForm(v => !v)}
            className="flex items-center gap-2 px-4 py-2.5 bg-violet-600 hover:bg-violet-500 rounded-xl text-white font-bold text-sm transition-colors">
            {showNewForm ? '✕ Cancel' : '+ New Code'}
          </button>
        </div>

        {/* Info banner */}
        <div className="bg-slate-800/60 border border-slate-700/40 rounded-2xl p-4 mb-6 text-sm text-slate-400">
          <p>Share these codes with your team. When someone signs up using an access code:</p>
          <ul className="mt-2 space-y-1 ml-4 list-disc text-slate-500">
            <li>Their <span className="text-white">role is auto-assigned</span> (Manager or Employee) based on the code type</li>
            <li>They are <span className="text-white">automatically linked to your company</span></li>
            <li>Their <span className="text-white">JD is mapped</span> and a <span className="text-white">pre-assessment is generated</span> immediately</li>
          </ul>
        </div>

        {/* New code form */}
        {showNewForm && (
          <div className="bg-[#1E293B] border border-violet-500/30 rounded-2xl p-5 mb-6">
            <h3 className="text-sm font-bold text-white mb-4">Create New Access Code</h3>
            <div className="grid grid-cols-2 gap-4 mb-4">
              <div>
                <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-1.5">Role Type</label>
                <select value={newCodeRole} onChange={e => setNewCodeRole(e.target.value)}
                  className="w-full bg-slate-900/60 border border-slate-700 rounded-xl px-4 py-2.5 text-sm text-white focus:outline-none focus:border-violet-500/60">
                  <option value="employee">Employee</option>
                  <option value="manager">Manager</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-1.5">Label (optional)</label>
                <input value={newCodeLabel} onChange={e => setNewCodeLabel(e.target.value)}
                  placeholder="e.g. Engineering Team"
                  className="w-full bg-slate-900/60 border border-slate-700 rounded-xl px-4 py-2.5 text-sm text-white placeholder-slate-600 focus:outline-none focus:border-violet-500/60" />
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-1.5">Max Uses (optional)</label>
                <input type="number" min="1" value={newCodeMax} onChange={e => setNewCodeMax(e.target.value)}
                  placeholder="Unlimited"
                  className="w-full bg-slate-900/60 border border-slate-700 rounded-xl px-4 py-2.5 text-sm text-white placeholder-slate-600 focus:outline-none focus:border-violet-500/60" />
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-1.5">Expiry Date (optional)</label>
                <input type="date" value={newCodeExpiry} onChange={e => setNewCodeExpiry(e.target.value)}
                  className="w-full bg-slate-900/60 border border-slate-700 rounded-xl px-4 py-2.5 text-sm text-white focus:outline-none focus:border-violet-500/60" />
              </div>
            </div>
            <div className="flex gap-3">
              <button onClick={() => setShowNewForm(false)}
                className="flex-1 py-2.5 rounded-xl bg-slate-700 hover:bg-slate-600 text-white font-bold text-sm transition-colors">
                Cancel
              </button>
              <button onClick={createCode} disabled={busy === 'create'}
                className="flex-1 py-2.5 rounded-xl bg-violet-600 hover:bg-violet-500 disabled:opacity-60 text-white font-bold text-sm transition-colors">
                {busy === 'create' ? 'Creating...' : 'Create Code'}
              </button>
            </div>
          </div>
        )}

        {loading ? (
          <div className="text-center py-16 text-slate-400">Loading codes...</div>
        ) : (
          <div className="space-y-6">
            {/* Manager codes */}
            <section>
              <div className="flex items-center gap-2 mb-3">
                <span className="text-xs font-bold text-amber-300 uppercase tracking-wider">Manager Codes</span>
                <span className="text-xs text-slate-500">({managers.length})</span>
              </div>
              {managers.length === 0 ? (
                <p className="text-slate-600 text-sm">No manager codes.</p>
              ) : (
                <div className="space-y-3">
                  {managers.map(code => <CodeCard key={code.id} code={code} companyId={companyId} busy={busy} doAction={doAction} deleteCode={deleteCode} />)}
                </div>
              )}
            </section>

            {/* Employee codes */}
            <section>
              <div className="flex items-center gap-2 mb-3">
                <span className="text-xs font-bold text-indigo-300 uppercase tracking-wider">Employee Codes</span>
                <span className="text-xs text-slate-500">({employees.length})</span>
              </div>
              {employees.length === 0 ? (
                <p className="text-slate-600 text-sm">No employee codes.</p>
              ) : (
                <div className="space-y-3">
                  {employees.map(code => <CodeCard key={code.id} code={code} companyId={companyId} busy={busy} doAction={doAction} deleteCode={deleteCode} />)}
                </div>
              )}
            </section>
          </div>
        )}
      </div>
    </div>
  );
}

function CodeCard({ code, companyId, busy, doAction, deleteCode }) {
  const ROLE_STYLE = {
    manager: { badge: 'bg-amber-500/15 border-amber-500/40 text-amber-300', code: 'text-amber-300', border: 'border-amber-500/20' },
    employee: { badge: 'bg-indigo-500/15 border-indigo-500/40 text-indigo-300', code: 'text-indigo-300', border: 'border-indigo-500/20' },
  };
  const s = ROLE_STYLE[code.role] || { badge: 'bg-slate-700 text-slate-300 border-slate-600', code: 'text-white', border: 'border-slate-700' };
  const usagePct = code.maxUsage ? Math.min(100, ((code.usageCount || 0) / code.maxUsage) * 100) : 0;

  return (
    <div className={`bg-[#1E293B] border rounded-2xl p-5 transition-opacity ${!code.isActive ? 'opacity-50' : ''} ${s.border}`}>
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1 min-w-0">
          {/* Code string */}
          <div className="flex items-center gap-2 mb-2 flex-wrap">
            <span className={`font-mono text-lg font-bold tracking-widest ${s.code}`}>{code.code}</span>
            <CopyBtn text={code.code} />
            <span className={`text-xs font-semibold px-2 py-0.5 rounded-full border ${s.badge}`}>{code.role}</span>
            {!code.isActive && (
              <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-red-500/15 border border-red-500/40 text-red-300">Disabled</span>
            )}
          </div>

          {/* Label + meta */}
          {code.label && <p className="text-xs text-slate-400 mb-2">{code.label}</p>}

          <div className="flex items-center gap-6 text-xs text-slate-500">
            <div>
              <span>Signups: </span>
              <span className="text-slate-200 font-semibold">{code.usageCount ?? 0}</span>
              {code.maxUsage != null && <span> / {code.maxUsage}</span>}
            </div>
            {code.expiresAt && (
              <div>
                <span>Expires: </span>
                <span className={`font-semibold ${new Date(code.expiresAt) < new Date() ? 'text-red-400' : 'text-slate-200'}`}>
                  {new Date(code.expiresAt).toLocaleDateString()}
                </span>
              </div>
            )}
            <div>
              <span>Created: </span>
              <span className="text-slate-200">{new Date(code.createdAt).toLocaleDateString()}</span>
            </div>
          </div>

          {/* Usage bar */}
          {code.maxUsage != null && (
            <div className="mt-2.5 h-1.5 bg-slate-800 rounded-full overflow-hidden w-48">
              <div className={`h-full rounded-full transition-all ${usagePct >= 90 ? 'bg-red-500' : usagePct >= 60 ? 'bg-amber-500' : 'bg-emerald-500'}`}
                style={{ width: `${usagePct}%` }} />
            </div>
          )}
        </div>

        {/* Actions */}
        <div className="flex flex-col gap-2 flex-shrink-0">
          <button onClick={() => doAction(code.id, { regenerate: true }, 'regenerated')}
            disabled={!!busy}
            className="px-3 py-1.5 rounded-lg bg-violet-900/40 hover:bg-violet-900/60 text-violet-300 text-xs font-semibold transition-colors disabled:opacity-50 whitespace-nowrap">
            {busy === code.id + 'regenerated' ? '...' : '↻ Regenerate'}
          </button>
          <button onClick={() => doAction(code.id, { isActive: !code.isActive }, code.isActive ? 'disabled' : 'enabled')}
            disabled={!!busy}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors disabled:opacity-50 whitespace-nowrap ${
              code.isActive ? 'bg-red-900/30 hover:bg-red-900/50 text-red-400' : 'bg-emerald-900/30 hover:bg-emerald-900/50 text-emerald-400'
            }`}>
            {code.isActive ? 'Disable' : 'Enable'}
          </button>
          <button onClick={() => deleteCode(code.id)} disabled={!!busy}
            className="px-3 py-1.5 rounded-lg bg-slate-700/60 hover:bg-red-900/40 text-slate-400 hover:text-red-400 text-xs font-semibold transition-colors disabled:opacity-50">
            Delete
          </button>
        </div>
      </div>
    </div>
  );
}
