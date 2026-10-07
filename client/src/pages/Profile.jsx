import React, { useState, useEffect, useMemo } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { useNavigate } from 'react-router-dom';
import { useNotification } from '../contexts/NotificationContext.jsx';
import { authFetch, sanitizeError } from '../utils/authFetch.js';

// Must stay in sync with server/services/roleCapability.js MANAGER_TIER_ROLES.
const MANAGER_TIER_ROLES = [
  'manager', 'leadership',
  'senior-training-development-manager', 'senior-quality-manager',
  'senior-training-manager', 'senior-operations-manager',
  'assistant-manager-ops', 'assistant-manager-quality', 'assistant-manager-training',
  'wfm', 'lead',
];

const ID_RE = /^[A-Za-z0-9_-]+$/;
const PHONE_RE = /^[0-9+\-() ]{5,30}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const inputCls = 'w-full px-4 py-3 rounded-xl border border-slate-700 bg-[#060B14] text-slate-100 placeholder-slate-600 focus:border-indigo-500 focus:outline-none transition-colors';
const readOnlyCls = 'w-full px-4 py-3 rounded-xl border border-slate-800 bg-slate-900/60 text-slate-300 cursor-not-allowed';

function formatRole(role) {
  if (!role) return '';
  return role.split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
}
function formatDateTime(d, withTime) {
  if (!d) return withTime ? 'Never' : '—';
  const dt = new Date(d);
  if (isNaN(dt)) return withTime ? 'Never' : '—';
  return withTime
    ? dt.toLocaleString('en-US', { year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
    : dt.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
}

function Field({ label, hint, error, children }) {
  return (
    <div>
      <label className="block text-sm font-semibold text-slate-300 mb-2">{label}</label>
      {children}
      {error ? <p className="text-xs text-red-400 mt-1">{error}</p> : hint ? <p className="text-xs text-slate-500 mt-1">{hint}</p> : null}
    </div>
  );
}

/**
 * Profile Page Component
 *
 * Lets a user view and edit their own details (full CRUD on their own record
 * except delete, which is admin-only in User Management):
 * - Employee ID / Manager ID, name, email, phone, department, job role
 * - Read-only: company, role, status, join date, last login, reports-to
 * - Change password (with current password verification)
 */
export default function Profile() {
  const { user, updateProfile, logout } = useAuth();
  const navigate = useNavigate();
  const { notify } = useNotification();

  // Full record from GET /api/users/:id — the source of truth for this page.
  const [profile, setProfile] = useState(null);
  const [form, setForm] = useState({ employeeId: '', name: '', email: '', phone: '', department: '', jobRole: '' });
  const [fieldErrors, setFieldErrors] = useState({});
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [saveOk, setSaveOk] = useState('');

  // Password form
  const [editingPassword, setEditingPassword] = useState(false);
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [pwLoading, setPwLoading] = useState(false);
  const [pwError, setPwError] = useState('');
  const [pwSuccess, setPwSuccess] = useState('');

  // Relations
  const [managers, setManagers] = useState([]);
  const [employeeCount, setEmployeeCount] = useState(null);
  const [loadingRelations, setLoadingRelations] = useState(true);
  const [showFullJD, setShowFullJD] = useState(false);

  const isAdmin = user?.role === 'admin' || user?.role === 'superadmin';
  const isManagerTier = MANAGER_TIER_ROLES.includes(user?.role);
  const idLabel = isManagerTier ? 'Manager ID' : 'Employee ID';

  const loadProfile = async () => {
    if (!user?.userId) return null;
    const data = await authFetch(`/api/users/${user.userId}`);
    const p = data?.data ?? data;
    if (p) {
      setProfile(p);
      setForm({
        employeeId: p.employeeId || '',
        name: p.name || '',
        email: p.email || '',
        phone: p.phone || '',
        department: p.department || '',
        jobRole: p.jobRole || '',
      });
    }
    return p;
  };

  // Load the full record once the user is known.
  useEffect(() => {
    if (!user?.userId) return;
    loadProfile().catch(() => {
      // Fall back to whatever the session already knows.
      setProfile(prev => prev || user);
      setForm(prev => ({ ...prev, name: user.name || '', email: user.email || '', employeeId: user.employeeId || '', phone: user.phone || '', department: user.department || '', jobRole: user.jobRole || '' }));
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.userId]);

  // Manager(s) / report count
  useEffect(() => {
    if (!user?.userId) return;
    let cancelled = false;
    (async () => {
      try {
        if (user.role !== 'admin' && user.role !== 'superadmin') {
          try {
            const res = await authFetch(`/api/assignments/employee/${user.userId}/manager`);
            const list = res?.managers || res?.data?.managers || [];
            if (!cancelled) setManagers(list);
          } catch { /* fall back to profile.managerName below */ }
        }
        if (isManagerTier) {
          try {
            const res = await authFetch(`/api/assignments/manager/${user.userId}/employees`);
            if (!cancelled) setEmployeeCount(res?.count ?? res?.employees?.length ?? res?.data?.count ?? 0);
          } catch { /* ignore */ }
        }
      } finally {
        if (!cancelled) setLoadingRelations(false);
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.userId, user?.role]);

  // Employee/Manager ID: editable by the user only while empty (mirrors the
  // server rule); admins can always edit their own.
  const savedEmployeeId = profile?.employeeId || '';
  const canEditId = isAdmin || !savedEmployeeId;

  const displayedManagers = useMemo(() => {
    if (managers.length > 0) return managers;
    if (profile?.managerId && (profile.managerName || profile.managerEmail)) {
      return [{ userId: profile.managerId, name: profile.managerName, email: profile.managerEmail }];
    }
    return [];
  }, [managers, profile]);

  const setField = (key) => (e) => {
    setForm(prev => ({ ...prev, [key]: e.target.value }));
    setFieldErrors(prev => ({ ...prev, [key]: undefined }));
    setSaveOk('');
  };

  const validate = () => {
    const errs = {};
    if (!form.name.trim()) errs.name = 'Name cannot be empty';
    if (!form.email.trim()) errs.email = 'Email cannot be empty';
    else if (!EMAIL_RE.test(form.email.trim())) errs.email = 'Enter a valid email address';
    if (form.phone.trim() && !PHONE_RE.test(form.phone.trim())) errs.phone = 'Phone may only contain digits, spaces, + - ( ) (5-30 characters)';
    if (canEditId && form.employeeId.trim() && !ID_RE.test(form.employeeId.trim())) errs.employeeId = 'Only letters, numbers, dashes and underscores';
    return errs;
  };

  const handleSave = async (e) => {
    e.preventDefault();
    setSaveError('');
    setSaveOk('');
    const errs = validate();
    setFieldErrors(errs);
    if (Object.keys(errs).length > 0) return;

    // Send only what changed so an untouched field can never be rejected.
    const base = profile || {};
    const updates = {};
    if (form.name.trim() !== (base.name || '')) updates.name = form.name.trim();
    if (form.email.trim() !== (base.email || '')) updates.email = form.email.trim();
    if (form.phone.trim() !== (base.phone || '')) updates.phone = form.phone.trim();
    if (form.department.trim() !== (base.department || '')) updates.department = form.department.trim();
    if (form.jobRole.trim() !== (base.jobRole || '')) updates.jobRole = form.jobRole.trim();
    if (canEditId && form.employeeId.trim() !== savedEmployeeId) updates.employeeId = form.employeeId.trim();

    if (Object.keys(updates).length === 0) {
      setSaveOk('No changes to save');
      return;
    }

    setSaving(true);
    try {
      await updateProfile(updates);
      await loadProfile().catch(() => {});
      const msg = updates.email
        ? 'Profile saved. Your login email is now the new address.'
        : 'Profile saved successfully';
      setSaveOk(msg);
      notify('Profile saved successfully', 'success');
    } catch (err) {
      const m = sanitizeError(err?.message) || 'Failed to save profile';
      setSaveError(m);
      notify(m, 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleReset = () => {
    if (profile) {
      setForm({
        employeeId: profile.employeeId || '',
        name: profile.name || '',
        email: profile.email || '',
        phone: profile.phone || '',
        department: profile.department || '',
        jobRole: profile.jobRole || '',
      });
    }
    setFieldErrors({});
    setSaveError('');
    setSaveOk('');
  };

  // Handle password change
  const handleChangePassword = async (e) => {
    e.preventDefault();
    setPwError('');
    setPwSuccess('');
    setPwLoading(true);

    try {
      if (!currentPassword || !newPassword || !confirmPassword) {
        throw new Error('All password fields are required');
      }
      if (newPassword !== confirmPassword) {
        throw new Error('New passwords do not match');
      }
      if (newPassword.length < 8) {
        throw new Error('Password must be at least 8 characters');
      }

      const token = localStorage.getItem('auth_token');
      const baseUrl = import.meta.env.VITE_API_URL || (import.meta.env.PROD ? '' : 'http://localhost:3001');

      const response = await fetch(`${baseUrl}/api/auth/change-password`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ currentPassword, newPassword }),
      });

      const data = await response.json();
      if (!response.ok) {
        throw new Error(sanitizeError(data.error?.message) || 'Failed to change password');
      }

      setPwSuccess('Password changed successfully');
      notify('Password changed successfully', 'success');
      setEditingPassword(false);
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
    } catch (err) {
      setPwError(err.message || 'Failed to change password');
    } finally {
      setPwLoading(false);
    }
  };

  const handleCancelPassword = () => {
    setEditingPassword(false);
    setCurrentPassword('');
    setNewPassword('');
    setConfirmPassword('');
    setPwError('');
    setPwSuccess('');
  };

  if (!user) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin text-indigo-400 text-4xl mb-4">⟳</div>
          <div className="text-slate-400 text-sm">Loading profile...</div>
        </div>
      </div>
    );
  }

  const p = profile || user;
  const status = p.status || 'active';
  const statusCls = status === 'active'
    ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30'
    : status === 'blocked'
      ? 'bg-red-500/20 text-red-300 border-red-500/30'
      : 'bg-slate-500/20 text-slate-300 border-slate-500/30';

  return (
    <div className="min-h-screen bg-[#060B14] py-8 px-4">
      {/* Background gradient */}
      <div className="fixed inset-0 pointer-events-none">
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[800px] h-[500px] rounded-full bg-indigo-600/10 blur-[120px]" />
        <div className="absolute bottom-0 right-0 w-[400px] h-[400px] rounded-full bg-purple-600/8 blur-[100px]" />
      </div>

      <div className="relative max-w-4xl mx-auto">
        {/* Header */}
        <div className="mb-8">
          <button
            onClick={() => navigate('/dashboard')}
            className="text-slate-400 hover:text-slate-300 text-sm mb-4 flex items-center gap-2 transition-colors"
          >
            ← Back to Dashboard
          </button>
          <h1 className="text-4xl font-black tracking-tight mb-2">
            <span className="bg-gradient-to-r from-indigo-400 via-purple-400 to-cyan-400 bg-clip-text text-transparent">
              Profile Settings
            </span>
          </h1>
          <p className="text-slate-400">Manage your account information and preferences</p>
        </div>

        {/* Personal & Work Details */}
        <form onSubmit={handleSave} noValidate className="rounded-2xl border border-slate-700/60 bg-slate-900/70 backdrop-blur p-8 mb-6">
          <h2 className="text-2xl font-bold text-white mb-6">Personal &amp; Work Details</h2>

          {saveError && (
            <div role="alert" className="mb-6 p-4 rounded-xl bg-red-500/10 border border-red-500/30 text-red-300 text-sm">{saveError}</div>
          )}
          {saveOk && (
            <div role="status" className="mb-6 p-4 rounded-xl bg-emerald-500/10 border border-emerald-500/30 text-emerald-300 text-sm">{saveOk}</div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 gap-5 mb-6">
            <Field
              label={idLabel}
              error={fieldErrors.employeeId}
              hint={canEditId
                ? (savedEmployeeId ? 'Unique within your company' : `Set your ${idLabel.toLowerCase()} once — after that only your admin can change it`)
                : 'Ask your admin to change this'}
            >
              {canEditId ? (
                <input type="text" aria-label={idLabel} value={form.employeeId} onChange={setField('employeeId')} maxLength={50} className={inputCls} placeholder="e.g. EMP-1001" autoComplete="off" />
              ) : (
                <input type="text" aria-label={idLabel} value={savedEmployeeId} readOnly disabled className={readOnlyCls} />
              )}
            </Field>

            <Field label="Full Name" error={fieldErrors.name}>
              <input type="text" aria-label="Full Name" value={form.name} onChange={setField('name')} className={inputCls} placeholder="Enter your name" />
            </Field>

            <Field label="Email" error={fieldErrors.email} hint="This is your login email. Changing it takes effect immediately.">
              <input type="email" aria-label="Email" value={form.email} onChange={setField('email')} className={inputCls} placeholder="you@company.com" autoComplete="off" />
            </Field>

            <Field label="Phone" error={fieldErrors.phone}>
              <input type="tel" aria-label="Phone" value={form.phone} onChange={setField('phone')} maxLength={30} className={inputCls} placeholder="+1 555 123 4567" autoComplete="off" />
            </Field>

            <Field label="Department">
              <input type="text" aria-label="Department" value={form.department} onChange={setField('department')} maxLength={200} className={inputCls} placeholder="e.g. Engineering" autoComplete="off" />
            </Field>

            <Field label="Job Role">
              <input type="text" aria-label="Job Role" value={form.jobRole} onChange={setField('jobRole')} maxLength={200} className={inputCls} placeholder="e.g. Frontend Developer" autoComplete="off" />
            </Field>

            <Field label="Company" hint="Set by your organisation's super admin">
              <input type="text" aria-label="Company" value={p.companyName || user.company?.name || ''} readOnly disabled className={readOnlyCls} placeholder="—" />
            </Field>

            <Field label="Role">
              <div className="px-4 py-3">
                <span className="inline-block px-3 py-1.5 bg-gradient-to-r from-indigo-500/20 to-purple-500/20 border border-indigo-500/30 text-indigo-300 rounded-lg text-sm font-bold">
                  {formatRole(p.role || user.role)}
                </span>
              </div>
            </Field>
          </div>

          {/* Read-only account facts */}
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3 mb-6">
            <div className="p-3 bg-[#060B14] border border-slate-700 rounded-xl">
              <p className="text-xs text-slate-500 uppercase tracking-wider mb-1">Status</p>
              <span className={`px-2 py-0.5 rounded-full text-xs font-semibold border capitalize ${statusCls}`}>{status}</span>
            </div>
            <div className="p-3 bg-[#060B14] border border-slate-700 rounded-xl">
              <p className="text-xs text-slate-500 uppercase tracking-wider mb-1">Joined</p>
              <p className="text-white font-semibold text-sm">{formatDateTime(p.createdAt, false)}</p>
            </div>
            <div className="p-3 bg-[#060B14] border border-slate-700 rounded-xl">
              <p className="text-xs text-slate-500 uppercase tracking-wider mb-1">Last Login</p>
              <p className="text-white font-semibold text-sm">{formatDateTime(p.lastLogin, true)}</p>
            </div>
            <div className="p-3 bg-[#060B14] border border-slate-700 rounded-xl">
              <p className="text-xs text-slate-500 uppercase tracking-wider mb-1">Onboarding</p>
              <p className={`font-semibold text-sm ${p.onboardingComplete ? 'text-emerald-400' : 'text-amber-400'}`}>{p.onboardingComplete ? 'Complete' : 'Pending'}</p>
            </div>
          </div>

          <div className="flex gap-2">
            <button
              type="submit"
              disabled={saving}
              className="px-6 py-3 rounded-xl font-bold text-sm bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-500 hover:to-purple-500 text-white transition-all disabled:opacity-40 disabled:cursor-not-allowed active:scale-[0.98]"
            >
              {saving ? 'Saving...' : 'Save Changes'}
            </button>
            <button
              type="button"
              onClick={handleReset}
              disabled={saving}
              className="px-4 py-3 rounded-xl font-semibold text-sm border border-slate-700 bg-slate-800/50 text-slate-300 hover:bg-slate-800 hover:border-slate-600 transition-all disabled:opacity-40"
            >
              Reset
            </button>
          </div>
        </form>

        {/* Reporting & Job Description */}
        <div className="rounded-2xl border border-slate-700/60 bg-slate-900/70 backdrop-blur p-8 mb-6">
          <h2 className="text-2xl font-bold text-white mb-6">Reporting &amp; Job Description</h2>

          {/* Reports to */}
          {user.role !== 'admin' && user.role !== 'superadmin' && (
            <div className="mb-6">
              <label className="block text-sm font-semibold text-slate-300 mb-2">
                Reports To
              </label>
              {loadingRelations && displayedManagers.length === 0 ? (
                <span className="text-slate-500">Loading...</span>
              ) : displayedManagers.length > 0 ? (
                <div className="space-y-2">
                  {displayedManagers.map((m, i) => (
                    <div key={m.userId || m.id || i} className="flex items-center gap-3 p-4 bg-[#060B14] border border-slate-700 rounded-xl">
                      <div className="w-12 h-12 rounded-full bg-gradient-to-br from-indigo-600/30 to-purple-600/30 border border-indigo-500/40 flex items-center justify-center text-xl">
                        👤
                      </div>
                      <div>
                        <p className="text-slate-100 font-bold">{m.name || 'Unknown'}</p>
                        <p className="text-slate-400 text-sm">{m.email}</p>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <span className="text-slate-500">No manager assigned</span>
              )}
            </div>
          )}

          {/* Employee Count (for managers) */}
          {isManagerTier && (
            <div className="mb-6">
              <label className="block text-sm font-semibold text-slate-300 mb-2">
                Assigned Employees
              </label>
              {loadingRelations && employeeCount === null ? (
                <span className="text-slate-500">Loading...</span>
              ) : (
                <div className="flex items-center gap-3 p-4 bg-[#060B14] border border-slate-700 rounded-xl">
                  <span className="text-4xl font-black bg-gradient-to-r from-indigo-400 to-purple-400 bg-clip-text text-transparent">
                    {employeeCount || 0}
                  </span>
                  <span className="text-slate-400">employees assigned to you</span>
                </div>
              )}
            </div>
          )}

          {/* JD */}
          {(p.jobDescription || p.jobDescriptionFile) ? (
            <div className="space-y-3">
              <label className="block text-sm font-semibold text-slate-300">Job Description</label>
              {p.jobDescriptionFile && (
                <div className="flex items-center gap-3 p-3 bg-[#060B14] border border-slate-700 rounded-xl">
                  <span className="text-2xl">📎</span>
                  <div className="flex-1 min-w-0">
                    <p className="text-white text-sm font-medium truncate">{p.jobDescriptionFile.name}</p>
                    <p className="text-slate-500 text-xs">
                      {p.jobDescriptionFile.size ? `${(p.jobDescriptionFile.size / 1024).toFixed(1)} KB · ` : ''}
                      Uploaded JD
                    </p>
                  </div>
                  <span className="px-2 py-0.5 rounded-full text-xs bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 shrink-0">✓ JD</span>
                </div>
              )}
              {p.jobDescription && (
                <div className="p-3 bg-[#060B14] border border-slate-700 rounded-xl">
                  <p className={`text-slate-300 text-sm leading-relaxed whitespace-pre-wrap ${!showFullJD && p.jobDescription.length > 300 ? 'line-clamp-4' : ''}`}>
                    {p.jobDescription}
                  </p>
                  {p.jobDescription.length > 300 && (
                    <button type="button" onClick={() => setShowFullJD(v => !v)} className="text-indigo-400 text-xs mt-2 hover:text-indigo-300 transition-colors">
                      {showFullJD ? '▲ Show less' : '▼ View full job description'}
                    </button>
                  )}
                </div>
              )}
            </div>
          ) : (
            <p className="text-slate-500 text-sm">No job description on file.</p>
          )}

          {/* Change Password Button */}
          {!editingPassword && (
            <button
              type="button"
              onClick={() => setEditingPassword(true)}
              className="mt-6 text-sm text-indigo-400 hover:text-indigo-300 transition-colors font-semibold"
            >
              Change Password
            </button>
          )}
          {pwSuccess && !editingPassword && (
            <div className="mt-4 p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/30 text-emerald-300 text-sm">{pwSuccess}</div>
          )}
        </div>

        {/* Change Password Form */}
        {editingPassword && (
          <div className="rounded-2xl border border-slate-700/60 bg-slate-900/70 backdrop-blur p-8 mb-6">
            <h2 className="text-2xl font-bold text-white mb-6">Change Password</h2>
            {pwError && (
              <div role="alert" className="mb-4 p-4 rounded-xl bg-red-500/10 border border-red-500/30 text-red-300 text-sm">{pwError}</div>
            )}
            <form onSubmit={handleChangePassword}>
              <div className="mb-4">
                <label className="block text-sm font-semibold text-slate-300 mb-2">
                  Current Password
                </label>
                <input
                  type="password"
                  value={currentPassword}
                  onChange={(e) => setCurrentPassword(e.target.value)}
                  className={inputCls}
                  placeholder="Enter current password"
                  required
                />
              </div>
              <div className="mb-4">
                <label className="block text-sm font-semibold text-slate-300 mb-2">
                  New Password
                </label>
                <input
                  type="password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  className={inputCls}
                  placeholder="Enter new password (min 8 characters)"
                  required
                />
              </div>
              <div className="mb-6">
                <label className="block text-sm font-semibold text-slate-300 mb-2">
                  Confirm New Password
                </label>
                <input
                  type="password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  className={inputCls}
                  placeholder="Confirm new password"
                  required
                />
              </div>
              <div className="flex gap-2">
                <button
                  type="submit"
                  disabled={pwLoading}
                  className="px-4 py-3 rounded-xl font-bold text-sm bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-500 hover:to-purple-500 text-white transition-all disabled:opacity-40 disabled:cursor-not-allowed active:scale-[0.98]"
                >
                  {pwLoading ? 'Changing...' : 'Change Password'}
                </button>
                <button
                  type="button"
                  onClick={handleCancelPassword}
                  className="px-4 py-3 rounded-xl font-semibold text-sm border border-slate-700 bg-slate-800/50 text-slate-300 hover:bg-slate-800 hover:border-slate-600 transition-all"
                >
                  Cancel
                </button>
              </div>
            </form>
          </div>
        )}

        {/* Logout Button */}
        <div className="rounded-2xl border border-slate-700/60 bg-slate-900/70 backdrop-blur p-8">
          <h2 className="text-2xl font-bold text-white mb-4">Account Actions</h2>
          <button
            onClick={logout}
            className="px-6 py-3 rounded-xl font-bold text-sm bg-red-600/20 border border-red-500/30 text-red-400 hover:bg-red-600/30 hover:border-red-500/40 transition-all active:scale-[0.98]"
          >
            Logout
          </button>
        </div>
      </div>
    </div>
  );
}
