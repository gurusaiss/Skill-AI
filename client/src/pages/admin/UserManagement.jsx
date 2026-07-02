import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { useNavigate } from 'react-router-dom';
import { authFetch } from '../../utils/authFetch.js';

// ─── Helpers ────────────────────────────────────────────────────────────────

function getAvatarInitials(name) {
  if (!name) return '?';
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0][0]?.toUpperCase() || '?';
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}
function formatDate(d) {
  if (!d) return '—';
  const dt = new Date(d);
  return isNaN(dt) ? '—' : dt.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
}
function formatBytes(bytes) {
  if (!bytes) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

const ROLE_RANK = { admin: 0, manager: 1, employee: 2 };
function getRoleBadge(role) {
  switch (role) {
    case 'admin':    return 'bg-purple-500/20 text-purple-300 border-purple-500/30';
    case 'manager':  return 'bg-indigo-500/20 text-indigo-300 border-indigo-500/30';
    case 'employee': return 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30';
    default:         return 'bg-slate-500/20 text-slate-300 border-slate-500/30';
  }
}
function getStatusBadge(s) {
  if (s === 'active')   return 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30';
  if (s === 'blocked')  return 'bg-red-500/20 text-red-400 border-red-500/30';
  return 'bg-slate-500/20 text-slate-400 border-slate-500/30';
}
function getAvatarColor(role) {
  if (role === 'admin')    return 'bg-purple-600/30 border-purple-500/40 text-purple-300';
  if (role === 'manager')  return 'bg-indigo-600/30 border-indigo-500/40 text-indigo-300';
  return 'bg-emerald-600/30 border-emerald-500/40 text-emerald-300';
}

// ─── Toast ───────────────────────────────────────────────────────────────────

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

// ─── Field label ─────────────────────────────────────────────────────────────

function FieldLabel({ children, required }) {
  return (
    <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-1.5">
      {children} {required && <span className="text-red-400">*</span>}
    </label>
  );
}

// ─── Input classes ───────────────────────────────────────────────────────────

const inputCls = 'w-full px-3 py-2.5 bg-slate-900 border border-slate-700 rounded-xl text-white placeholder-slate-600 focus:outline-none focus:border-indigo-500 transition-colors text-sm';
const selectCls = 'w-full px-3 py-2.5 bg-slate-900 border border-slate-700 rounded-xl text-white focus:outline-none focus:border-indigo-500 transition-colors text-sm';

// ─── Detail Modal ─────────────────────────────────────────────────────────────

function DetailModal({ user, assignments, onClose, onEdit, onDeleteSuccess, setToast }) {
  const [manager, setManager] = useState(null);
  const [loadingManager, setLoadingManager] = useState(false);
  const [showFullJD, setShowFullJD] = useState(false);

  const userAssignments = useMemo(
    () => assignments.filter(a => a.employeeId === user.userId || a.userId === user.userId),
    [assignments, user.userId]
  );

  useEffect(() => {
    if (user.role !== 'employee') return;
    setLoadingManager(true);
    authFetch(`/api/assignments/employee/${user.userId}/manager`)
      .then(d => {
        // Handle various response shapes from the API
        const mgr = d?.manager || d?.data?.manager || d?.managerData || d;
        setManager(mgr && (mgr.name || mgr.managerName || mgr.email) ? mgr : null);
      })
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
    } catch (err) { setToast({ message: err.message, type: 'error' }); }
  };

  const hasJD = !!(user.jobDescription || user.jobDescriptionFile);

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
                {user.jobRole && <span className="px-2.5 py-0.5 rounded-full text-xs font-semibold border bg-amber-500/20 text-amber-300 border-amber-500/30">{user.jobRole}</span>}
                {user.department && <span className="px-2.5 py-0.5 rounded-full text-xs font-semibold border bg-cyan-500/20 text-cyan-300 border-cyan-500/30">{user.department}</span>}
              </div>
            </div>
          </div>
          <button onClick={onClose} className="text-slate-500 hover:text-white p-1 rounded-lg hover:bg-slate-700 transition-colors shrink-0">✕</button>
        </div>

        <div className="p-6 space-y-5">
          {/* Basic info grid */}
          <div className="grid grid-cols-2 gap-3">
            <div className="bg-slate-900/60 rounded-xl p-3">
              <p className="text-slate-500 text-xs uppercase tracking-wider mb-1">Joined</p>
              <p className="text-slate-200 text-sm font-medium">{formatDate(user.createdAt)}</p>
            </div>
            <div className="bg-slate-900/60 rounded-xl p-3">
              <p className="text-slate-500 text-xs uppercase tracking-wider mb-1">Onboarding</p>
              <p className={`text-sm font-semibold ${user.onboardingComplete ? 'text-emerald-400' : 'text-amber-400'}`}>
                {user.onboardingComplete ? '✓ Complete' : '⏳ Pending'}
              </p>
            </div>
            {user.jobRole && (
              <div className="bg-slate-900/60 rounded-xl p-3">
                <p className="text-slate-500 text-xs uppercase tracking-wider mb-1">Job Role</p>
                <p className="text-white text-sm font-medium">{user.jobRole}</p>
              </div>
            )}
            {user.department && (
              <div className="bg-slate-900/60 rounded-xl p-3">
                <p className="text-slate-500 text-xs uppercase tracking-wider mb-1">Department</p>
                <p className="text-white text-sm font-medium">{user.department}</p>
              </div>
            )}
          </div>

          {/* JD Section — only show if JD exists */}
          {hasJD && (
            <div>
              <h3 className="text-slate-300 font-semibold text-sm uppercase tracking-wider mb-3 flex items-center gap-2">
                <span className="w-5 h-5 rounded bg-amber-500/20 flex items-center justify-center text-amber-400 text-xs">📄</span>
                Job Description
              </h3>
              <div className="bg-slate-900/60 rounded-xl p-4 space-y-3">
                {user.jobDescriptionFile && (
                  <div className="flex items-center gap-3 p-2.5 bg-slate-800 rounded-lg border border-slate-700/60">
                    <span className="text-2xl">📎</span>
                    <div className="flex-1 min-w-0">
                      <p className="text-white text-sm font-medium truncate">{user.jobDescriptionFile.name}</p>
                      <p className="text-slate-500 text-xs">{formatBytes(user.jobDescriptionFile.size)} · {formatDate(user.jobDescriptionFile.uploadedAt)}</p>
                    </div>
                    <button
                      onClick={async () => {
                        try {
                          const token = localStorage.getItem('auth_token');
                          const base = import.meta.env.VITE_API_URL || (import.meta.env.PROD ? '' : 'http://localhost:3001');
                          const res = await fetch(`${base}/api/users/${user.userId}/jd-file`, {
                            headers: { Authorization: `Bearer ${token}` }
                          });
                          if (!res.ok) throw new Error('Download failed');
                          const blob = await res.blob();
                          const url = URL.createObjectURL(blob);
                          const a = document.createElement('a');
                          a.href = url;
                          a.download = user.jobDescriptionFile.name;
                          a.click();
                          URL.revokeObjectURL(url);
                        } catch (err) {
                          alert('Download failed: ' + err.message);
                        }
                      }}
                      className="flex items-center gap-1.5 px-3 py-1.5 bg-indigo-600/20 hover:bg-indigo-600/40 border border-indigo-500/30 rounded-lg text-indigo-300 text-xs font-semibold transition-colors shrink-0"
                    >
                      ⬇ Download
                    </button>
                  </div>
                )}
                {user.jobDescription && (
                  <div>
                    <p className={`text-slate-300 text-sm leading-relaxed whitespace-pre-wrap ${!showFullJD && user.jobDescription.length > 300 ? 'line-clamp-4' : ''}`}>
                      {user.jobDescription}
                    </p>
                    {user.jobDescription.length > 300 && (
                      <button onClick={() => setShowFullJD(v => !v)} className="text-indigo-400 text-xs mt-1 hover:text-indigo-300">
                        {showFullJD ? '▲ Show less' : '▼ Show full JD'}
                      </button>
                    )}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Assigned Modules */}
          <div>
            <h3 className="text-slate-300 font-semibold text-sm uppercase tracking-wider mb-3 flex items-center gap-2">
              <span className="w-5 h-5 rounded bg-indigo-500/20 flex items-center justify-center text-indigo-400 text-xs">M</span>
              Assigned Modules <span className="text-slate-600 font-normal normal-case">({userAssignments.length})</span>
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
                        <p className="text-white text-sm font-medium truncate">{a.title || a.moduleName || 'Module'}</p>
                        <ProgressBar pct={pct} />
                      </div>
                      <span className={`px-2 py-0.5 rounded-full text-xs font-semibold border shrink-0 ${a.completed ? 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30' : 'bg-slate-500/20 text-slate-400 border-slate-500/30'}`}>
                        {a.completed ? 'done' : (a.status || 'active')}
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Manager */}
          {user.role === 'employee' && (
            <div>
              <h3 className="text-slate-300 font-semibold text-sm uppercase tracking-wider mb-3 flex items-center gap-2">
                <span className="w-5 h-5 rounded bg-purple-500/20 flex items-center justify-center text-purple-400 text-xs">👤</span>
                Manager
              </h3>
              <div className="bg-slate-900/60 rounded-xl p-3">
                {loadingManager ? <div className="h-4 bg-slate-700 rounded animate-pulse w-32" />
                  : manager ? (
                    <div className="flex items-center gap-3">
                      <div className={`w-8 h-8 rounded-lg border flex items-center justify-center text-sm font-bold ${getAvatarColor('manager')}`}>
                        {getAvatarInitials(manager.name || manager.managerName)}
                      </div>
                      <div>
                        <p className="text-white text-sm font-medium">{manager.name || manager.managerName}</p>
                        <p className="text-slate-500 text-xs">{manager.role ? `${manager.role} · ` : ''}{manager.email || ''}</p>
                      </div>
                    </div>
                  ) : <p className="text-slate-500 text-sm italic">No manager assigned</p>}
              </div>
            </div>
          )}
        </div>

        <div className="px-6 pb-6 flex gap-3">
          <button onClick={() => { onClose(); onEdit(user); }} className="flex-1 px-4 py-2.5 bg-indigo-600 hover:bg-indigo-500 rounded-xl text-white font-semibold text-sm transition-colors">
            ✏️ Edit User
          </button>
          <button onClick={handleDelete} className="px-4 py-2.5 bg-red-600/20 hover:bg-red-600/40 border border-red-500/30 rounded-xl text-red-400 font-semibold text-sm transition-colors">
            🗑️ Delete
          </button>
          <button onClick={onClose} className="px-4 py-2.5 bg-slate-700 hover:bg-slate-600 rounded-xl text-slate-300 text-sm transition-colors">Close</button>
        </div>
      </div>
    </div>
  );
}

// ─── Edit Modal ───────────────────────────────────────────────────────────────
// Full edit: name, email, role, jobRole, department, jobDescription + JD file upload

function EditModal({ user, modules, users, assignments, onClose, onSaved, setToast, currentUserRole }) {
  const [form, setForm] = useState({
    name: user.name || '',
    email: user.email || '',
    role: user.role || 'employee',
    status: user.status || 'active',
    jobRole: user.jobRole || '',
    department: user.department || '',
    jobDescription: user.jobDescription || '',
    companyName: user.companyName || '',
  });
  const [saving, setSaving] = useState(false);
  const [resending, setResending] = useState(false);

  const handleResendInvite = async () => {
    setResending(true);
    try {
      const res = await authFetch(`/api/users/${user.userId}/resend-invite`, { method: 'POST' });
      if (res?.emailSent) {
        setToast({ message: `Activation email resent to ${user.email}`, type: 'success' });
      } else {
        setToast({ message: `Email failed: ${res?.emailError || 'check SMTP config'}`, type: 'error' });
      }
    } catch (err) { setToast({ message: err.message, type: 'error' }); }
    finally { setResending(false); }
  };

  // JD upload / URL
  const [jdInputMode, setJdInputMode] = useState('file'); // 'file' | 'url'
  const [jdFile, setJdFile] = useState(null);
  const [jdUrl, setJdUrl] = useState('');
  const [jdUploading, setJdUploading] = useState(false);
  const [jdResult, setJdResult] = useState(null); // { extractedChars, skillsFound }
  const [existingJDFile, setExistingJDFile] = useState(user.jobDescriptionFile || null);
  const [existingJDSkills, setExistingJDSkills] = useState(user.jdSkills || []);
  const [existingJDSourceUrl, setExistingJDSourceUrl] = useState(user.jdSourceUrl || '');
  const fileInputRef = useRef(null);

  // Module/Manager assignment — preload current module from assignments prop
  const [assignModuleId, setAssignModuleId] = useState(() => {
    const current = assignments.find(a =>
      (a.employeeId === user.userId || a.userId === user.userId) &&
      (a.type === 'module' || a.assignable_type === 'module')
    );
    return current?.assignable_id || current?.assignableId || current?.moduleId || '';
  });
  const [assignManagerId, setAssignManagerId] = useState('');
  const [currentManagerId, setCurrentManagerId] = useState(null);
  const [assigning, setAssigning] = useState(false);
  const [activeSection, setActiveSection] = useState('profile'); // 'profile' | 'jd' | 'assign'
  // Additional job roles
  const [additionalRoles, setAdditionalRoles] = useState(user.additionalJobRoles || []);
  const [addRoleForm, setAddRoleForm] = useState({ roleName: '', department: '', jobDescription: '' });
  const [addingRole, setAddingRole] = useState(false);
  const [showAddRoleForm, setShowAddRoleForm] = useState(false);

  const managers = useMemo(() => users.filter(u => u.role === 'manager' && u.userId !== user.userId), [users, user.userId]);
  const isEmployee = form.role === 'employee';
  const isAdmin = currentUserRole === 'admin';

  useEffect(() => {
    if (user.role !== 'employee') return;
    authFetch(`/api/assignments/employee/${user.userId}/manager`)
      .then(d => { if (d?.managerId || d?.userId) { const id = d.managerId || d.userId; setCurrentManagerId(id); setAssignManagerId(id); } })
      .catch(() => {});
  }, [user.userId, user.role]);

  // Auto-fetch JD from Role Library when job role changes
  const [roleLibLookup, setRoleLibLookup] = useState(false);
  const roleLibTimeout = useRef(null);
  const handleJobRoleChange = e => {
    const val = e.target.value;
    setForm(prev => ({ ...prev, jobRole: val }));
    clearTimeout(roleLibTimeout.current);
    if (!val.trim()) return;
    roleLibTimeout.current = setTimeout(async () => {
      try {
        setRoleLibLookup(true);
        const match = await authFetch(`/api/roles/search?role=${encodeURIComponent(val.trim())}`);
        if (match?.id) {
          setForm(prev => ({
            ...prev,
            department:     prev.department || match.department || prev.department,
            jobDescription: match.jobDescription || prev.jobDescription,
          }));
          if ((match.skills || []).length > 0) setExistingJDSkills(match.skills);
          setToast({ message: `JD auto-filled from Role Library: "${match.roleName}"`, type: 'success' });
        }
      } catch {}
      finally { setRoleLibLookup(false); }
    }, 800);
  };

  const f = (key) => (e) => {
    if (key === 'jobRole') return handleJobRoleChange(e);
    setForm(prev => ({ ...prev, [key]: e.target.value }));
  };

  const handleAddJobRole = async () => {
    if (!addRoleForm.roleName.trim()) { setToast({ message: 'Role name is required', type: 'error' }); return; }
    setAddingRole(true);
    try {
      const res = await authFetch(`/api/users/${user.userId}/job-roles`, {
        method: 'POST',
        body: JSON.stringify(addRoleForm),
      });
      const newRole = res?.role || { roleName: addRoleForm.roleName, id: Date.now() };
      setAdditionalRoles(prev => [...prev, newRole]);
      setAddRoleForm({ roleName: '', department: '', jobDescription: '' });
      setShowAddRoleForm(false);
      setToast({ message: `"${newRole.roleName}" added. Assessment workflow triggered.`, type: 'success' });
    } catch (e) { setToast({ message: e.message || 'Failed to add role', type: 'error' }); }
    finally { setAddingRole(false); }
  };

  const handleRemoveJobRole = async (roleId, roleName) => {
    if (!window.confirm(`Remove "${roleName}" from this user?`)) return;
    try {
      await authFetch(`/api/users/${user.userId}/job-roles/${roleId}`, { method: 'DELETE' });
      setAdditionalRoles(prev => prev.filter(r => r.id !== roleId));
      setToast({ message: `"${roleName}" removed`, type: 'success' });
    } catch (e) { setToast({ message: e.message || 'Failed to remove role', type: 'error' }); }
  };

  const handleSave = async () => {
    if (!form.name.trim()) { setToast({ message: 'Name is required', type: 'error' }); return; }
    setSaving(true);
    try {
      // Update profile (all fields in one call)
      await authFetch(`/api/users/${user.userId}`, {
        method: 'PUT',
        body: JSON.stringify({
          name: form.name.trim(),
          email: form.email.trim(),
          status: form.status,
          jobRole: form.jobRole.trim(),
          department: form.department.trim(),
          jobDescription: form.jobDescription, // no trim — preserve formatting
          companyName: form.companyName.trim(),
        }),
      });

      // Role change — separate call (admin only)
      if (isAdmin && form.role !== user.role) {
        await authFetch(`/api/users/${user.userId}/role`, { method: 'PUT', body: JSON.stringify({ role: form.role }) });
      }

      setToast({ message: `${form.name} updated successfully`, type: 'success' });
      onSaved();
      onClose();
    } catch (err) {
      setToast({ message: err.message, type: 'error' });
    } finally {
      setSaving(false);
    }
  };

  const handleJDUpload = async () => {
    if (!jdFile) return;
    setJdUploading(true);
    try {
      const fd = new FormData();
      fd.append('jd', jdFile);
      const result = await authFetch(`/api/users/${user.userId}/jd-upload`, {
        method: 'POST',
        isFile: true,
        body: fd,
      });
      setExistingJDFile(result?.user?.jobDescriptionFile || null);
      setExistingJDSkills(result?.skillsFound || []);
      setExistingJDSourceUrl('');
      setJdResult({ extractedChars: result?.extractedChars, skillsFound: result?.skillsFound || [] });
      if (result?.user?.jobDescription) {
        setForm(prev => ({ ...prev, jobDescription: result.user.jobDescription }));
      }
      setJdFile(null);
      if (fileInputRef.current) fileInputRef.current.value = '';
      setToast({ message: `JD extracted: ${result?.extractedChars?.toLocaleString()} chars, ${result?.skillsFound?.length || 0} skills found`, type: 'success' });
      onSaved();
    } catch (err) {
      setToast({ message: `Upload failed: ${err.message}`, type: 'error' });
    } finally {
      setJdUploading(false);
    }
  };

  const handleJDUrl = async () => {
    if (!jdUrl.trim()) return;
    setJdUploading(true);
    try {
      const result = await authFetch(`/api/users/${user.userId}/jd-url`, {
        method: 'POST',
        body: JSON.stringify({ url: jdUrl.trim() }),
      });
      setExistingJDFile(null);
      setExistingJDSkills(result?.skillsFound || []);
      setExistingJDSourceUrl(jdUrl.trim());
      setJdResult({ extractedChars: result?.extractedChars, skillsFound: result?.skillsFound || [] });
      // Sync form so the "Current JD" status card shows the extracted text immediately
      if (result?.user?.jobDescription) {
        setForm(prev => ({ ...prev, jobDescription: result.user.jobDescription }));
      }
      setJdUrl('');
      setToast({ message: `JD fetched: ${result?.extractedChars?.toLocaleString()} chars, ${result?.skillsFound?.length || 0} skills found`, type: 'success' });
      onSaved();
    } catch (err) {
      setToast({ message: err.message, type: 'error' });
    } finally {
      setJdUploading(false);
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
    } catch (err) { setToast({ message: err.message, type: 'error' }); }
    finally { setAssigning(false); }
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
      setCurrentManagerId(assignManagerId);
      onSaved();
    } catch (err) { setToast({ message: err.message, type: 'error' }); }
    finally { setAssigning(false); }
  };

  const SECTIONS = [
    { id: 'profile', label: '👤 Profile' },
    { id: 'jd', label: '📄 Job Description' },
    ...(isEmployee ? [{ id: 'assign', label: '📦 Assignments' }] : []),
    ...(isEmployee ? [{ id: 'gap', label: '🎯 Skills Gap' }] : []),
    ...(isEmployee ? [{ id: 'checklist', label: '✅ Onboarding' }] : []),
  ];

  // Skills gap data
  const [gapData, setGapData] = useState(null);
  const [gapLoading, setGapLoading] = useState(false);
  const loadGap = useCallback(async () => {
    if (gapData || gapLoading) return;
    setGapLoading(true);
    try { const d = await authFetch(`/api/users/${user.userId}/skills-gap`); setGapData(d?.data ?? d); }
    catch {} finally { setGapLoading(false); }
  }, [user.userId, gapData, gapLoading]);

  // Checklist
  const [checklistData, setChecklistData] = useState(null);
  const [clLoading, setClLoading] = useState(false);
  const loadChecklist = useCallback(async () => {
    if (checklistData || clLoading) return;
    setClLoading(true);
    try { const d = await authFetch(`/api/users/${user.userId}/checklist`); setChecklistData(d?.data ?? d); }
    catch {} finally { setClLoading(false); }
  }, [user.userId, checklistData, clLoading]);

  useEffect(() => {
    if (activeSection === 'gap') loadGap();
    if (activeSection === 'checklist') loadChecklist();
  }, [activeSection]);

  return (
    <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-50 p-4" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="bg-slate-800 border border-slate-700/80 rounded-2xl w-full max-w-xl max-h-[92vh] flex flex-col shadow-2xl">

        {/* Header */}
        <div className="p-5 border-b border-slate-700/60 flex items-center justify-between shrink-0">
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

        {/* Section tabs */}
        <div className="flex gap-1 px-5 pt-4 shrink-0">
          {SECTIONS.map(s => (
            <button key={s.id} onClick={() => setActiveSection(s.id)}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${activeSection === s.id ? 'bg-indigo-600 text-white' : 'bg-slate-700/50 text-slate-400 hover:text-white hover:bg-slate-700'}`}>
              {s.label}
            </button>
          ))}
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-5 space-y-4">

          {/* ── PROFILE TAB ── */}
          {activeSection === 'profile' && (
            <>
              <div>
                <FieldLabel required>Full Name</FieldLabel>
                <input type="text" value={form.name} onChange={f('name')} className={inputCls} placeholder="John Doe" />
              </div>

              <div>
                <FieldLabel>Email</FieldLabel>
                <input type="email" value={form.email} onChange={f('email')} className={inputCls} placeholder="john@company.com" />
              </div>

              <div className="grid grid-cols-2 gap-4">
                {isAdmin && (
                  <div>
                    <FieldLabel>Role</FieldLabel>
                    <select value={form.role} onChange={f('role')} className={selectCls}>
                      <option value="admin">Admin</option>
                      <option value="manager">Manager</option>
                      <option value="employee">Employee</option>
                    </select>
                  </div>
                )}
                <div>
                  <FieldLabel>Status</FieldLabel>
                  <select value={form.status} onChange={f('status')} className={selectCls}>
                    <option value="active">Active</option>
                    <option value="inactive">Inactive</option>
                    <option value="blocked">Blocked</option>
                  </select>
                </div>
              </div>

              {/* Job Role + Department */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <FieldLabel>Primary Job Role {roleLibLookup && <span className="text-indigo-400 text-xs ml-1">↻ looking up…</span>}</FieldLabel>
                  <input type="text" value={form.jobRole} onChange={f('jobRole')} className={inputCls} placeholder="e.g. Frontend Developer" />
                  <p className="text-xs text-slate-600 mt-0.5">JD auto-fills from Role Library on match</p>
                </div>
                <div>
                  <FieldLabel>Department</FieldLabel>
                  <input type="text" value={form.department} onChange={f('department')} className={inputCls} placeholder="e.g. Engineering" />
                </div>
              </div>

              {/* Additional Job Roles */}
              <div className="pt-1">
                <div className="flex items-center justify-between mb-2">
                  <FieldLabel>Additional Job Roles</FieldLabel>
                  <button type="button" onClick={() => setShowAddRoleForm(v => !v)}
                    className="text-xs text-indigo-400 hover:text-indigo-300 font-semibold transition-colors">
                    {showAddRoleForm ? '✕ Cancel' : '+ Add Job Role'}
                  </button>
                </div>
                {additionalRoles.length > 0 && (
                  <div className="space-y-1.5 mb-2">
                    {additionalRoles.map(r => (
                      <div key={r.id} className="flex items-center justify-between px-3 py-2 rounded-lg bg-slate-800/60 border border-slate-700/50">
                        <div>
                          <span className="text-sm text-white font-medium">{r.roleName}</span>
                          {r.department && <span className="text-xs text-slate-500 ml-2">· {r.department}</span>}
                        </div>
                        <button type="button" onClick={() => handleRemoveJobRole(r.id, r.roleName)}
                          className="text-slate-500 hover:text-red-400 text-xs transition-colors ml-2">✕</button>
                      </div>
                    ))}
                  </div>
                )}
                {additionalRoles.length === 0 && !showAddRoleForm && (
                  <p className="text-xs text-slate-600 mb-2">No additional roles. Click "+ Add Job Role" to assign multiple roles.</p>
                )}
                {showAddRoleForm && (
                  <div className="rounded-xl border border-indigo-500/30 bg-slate-800/40 p-3 space-y-2">
                    <input type="text" placeholder="Role Name (required)" value={addRoleForm.roleName}
                      onChange={e => setAddRoleForm(p => ({ ...p, roleName: e.target.value }))}
                      className="w-full px-3 py-1.5 rounded-lg bg-slate-900 border border-slate-700 text-white text-sm focus:border-indigo-500 focus:outline-none" />
                    <input type="text" placeholder="Department (optional)" value={addRoleForm.department}
                      onChange={e => setAddRoleForm(p => ({ ...p, department: e.target.value }))}
                      className="w-full px-3 py-1.5 rounded-lg bg-slate-900 border border-slate-700 text-white text-sm focus:border-indigo-500 focus:outline-none" />
                    <textarea placeholder="Job Description (optional — triggers auto-assessment)" value={addRoleForm.jobDescription}
                      onChange={e => setAddRoleForm(p => ({ ...p, jobDescription: e.target.value }))}
                      rows={2}
                      className="w-full px-3 py-2 rounded-lg bg-slate-900 border border-slate-700 text-white text-sm focus:border-indigo-500 focus:outline-none resize-y" />
                    <button type="button" onClick={handleAddJobRole} disabled={addingRole}
                      className="w-full py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-bold transition-colors disabled:opacity-50">
                      {addingRole ? 'Adding…' : '✓ Add & Trigger Assessment'}
                    </button>
                  </div>
                )}
              </div>

              <div>
                <FieldLabel>Company Name</FieldLabel>
                <input type="text" value={form.companyName} onChange={f('companyName')} className={inputCls} placeholder="e.g. Acme Corp" />
              </div>

              <div className="pt-1 border-t border-slate-700/40">
                <p className="text-xs text-slate-500 mb-2">Resend activation email if the user hasn't set up their account yet.</p>
                <button
                  type="button"
                  onClick={handleResendInvite}
                  disabled={resending}
                  className="flex items-center gap-2 px-4 py-2 bg-indigo-600/20 hover:bg-indigo-600/40 border border-indigo-500/30 rounded-xl text-indigo-300 text-sm font-semibold transition-colors disabled:opacity-50"
                >
                  {resending ? <><span className="w-3.5 h-3.5 border-2 border-indigo-300/30 border-t-indigo-300 rounded-full animate-spin" /> Sending…</> : '📧 Resend Invitation Email'}
                </button>
              </div>
            </>
          )}

          {/* ── JD TAB ── */}
          {activeSection === 'jd' && (
            <div className="space-y-4">
              <div className="flex items-start gap-3 p-3 bg-indigo-500/10 border border-indigo-500/30 rounded-xl text-sm text-indigo-300">
                <span className="text-lg">💡</span>
                <p>Text is extracted once and stored — no file kept on server. Used for assessments and modules.</p>
              </div>

              <div>
                <FieldLabel>Job Role</FieldLabel>
                <input type="text" value={form.jobRole} onChange={f('jobRole')} className={inputCls} placeholder="e.g. Senior React Developer" />
              </div>

              {/* Current JD status */}
              {(existingJDFile || existingJDSourceUrl || form.jobDescription) && (
                <div className="bg-emerald-500/10 border border-emerald-500/30 rounded-xl p-3 space-y-2">
                  <p className="text-xs font-bold text-emerald-400 uppercase tracking-wider">Current JD</p>
                  {existingJDSourceUrl && (
                    <p className="text-xs text-slate-400 truncate">🔗 {existingJDSourceUrl}</p>
                  )}
                  {existingJDFile?.name && (
                    <p className="text-xs text-slate-400">📎 {existingJDFile.name} · {formatBytes(existingJDFile.size)}</p>
                  )}
                  {form.jobDescription && (
                    <p className="text-xs text-slate-400">{form.jobDescription.length.toLocaleString()} chars stored</p>
                  )}
                  {existingJDSkills.length > 0 && (
                    <div className="flex flex-wrap gap-1 mt-1">
                      {existingJDSkills.slice(0, 12).map(s => (
                        <span key={s} className="px-2 py-0.5 rounded-full bg-indigo-500/15 border border-indigo-500/30 text-indigo-300 text-xs">{s}</span>
                      ))}
                      {existingJDSkills.length > 12 && <span className="text-slate-500 text-xs">+{existingJDSkills.length - 12} more</span>}
                    </div>
                  )}
                </div>
              )}

              {/* Result banner after fresh extract */}
              {jdResult && (
                <div className="bg-emerald-600/20 border border-emerald-500/40 rounded-xl p-3">
                  <p className="text-emerald-300 font-semibold text-sm">✓ JD saved to database</p>
                  <p className="text-emerald-400/70 text-xs mt-0.5">{jdResult.extractedChars?.toLocaleString()} chars · {jdResult.skillsFound?.length || 0} skills extracted</p>
                </div>
              )}

              {/* Mode selector */}
              <div>
                <p className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">Update JD via</p>
                <div className="flex gap-2 mb-3">
                  {[{ id: 'file', label: '📂 Upload File' }, { id: 'url', label: '🔗 Paste Link' }, { id: 'text', label: '✏️ Paste Text' }].map(m => (
                    <button key={m.id} type="button" onClick={() => setJdInputMode(m.id)}
                      className={`flex-1 py-2 rounded-lg text-xs font-bold transition-colors ${jdInputMode === m.id ? 'bg-indigo-600 text-white' : 'bg-slate-700/60 text-slate-400 hover:text-white'}`}>
                      {m.label}
                    </button>
                  ))}
                </div>

                {/* File mode */}
                {jdInputMode === 'file' && (
                  <>
                    <p className="text-slate-500 text-xs mb-2">PDF, DOCX, DOC, TXT, RTF — up to 50MB. Text is extracted and stored; file is deleted.</p>
                    <div onClick={() => fileInputRef.current?.click()}
                      className={`border-2 border-dashed rounded-xl p-5 text-center cursor-pointer transition-colors ${jdFile ? 'border-indigo-500 bg-indigo-500/10' : 'border-slate-600 hover:border-slate-500 bg-slate-900/40'}`}>
                      {jdFile ? (
                        <>
                          <p className="text-indigo-300 font-semibold text-sm">{jdFile.name}</p>
                          <p className="text-slate-500 text-xs mt-1">{formatBytes(jdFile.size)} · Click to change</p>
                        </>
                      ) : (
                        <>
                          <p className="text-4xl mb-2">📂</p>
                          <p className="text-slate-300 text-sm font-semibold">Click to choose file</p>
                          <p className="text-slate-600 text-xs mt-1">PDF, DOCX, DOC, TXT, RTF</p>
                        </>
                      )}
                    </div>
                    <input ref={fileInputRef} type="file" accept=".pdf,.doc,.docx,.txt,.rtf,.odt" className="hidden"
                      onChange={e => { if (e.target.files[0]) setJdFile(e.target.files[0]); }} />
                    {jdFile && (
                      <button onClick={handleJDUpload} disabled={jdUploading}
                        className="mt-3 w-full py-2.5 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 rounded-xl text-white font-bold text-sm transition-colors flex items-center justify-center gap-2">
                        {jdUploading ? <><span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" /> Extracting…</> : '⬆ Extract & Save JD'}
                      </button>
                    )}
                  </>
                )}

                {/* URL mode */}
                {jdInputMode === 'url' && (
                  <>
                    <p className="text-slate-500 text-xs mb-2">Google Drive, OneDrive, Dropbox, or any public direct link. Must be publicly accessible (no login).</p>
                    <input type="url" value={jdUrl} onChange={e => setJdUrl(e.target.value)}
                      placeholder="https://drive.google.com/file/d/... or https://..."
                      className={`${inputCls} font-mono text-xs`} />
                    <div className="flex flex-wrap gap-1.5 mt-2">
                      {['Google Drive', 'Google Docs', 'OneDrive', 'Dropbox', 'Direct PDF/DOCX'].map(hint => (
                        <span key={hint} className="text-xs text-slate-500 bg-slate-700/40 px-2 py-0.5 rounded-full">{hint}</span>
                      ))}
                    </div>
                    <button onClick={handleJDUrl} disabled={!jdUrl.trim() || jdUploading}
                      className="mt-3 w-full py-2.5 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 rounded-xl text-white font-bold text-sm transition-colors flex items-center justify-center gap-2">
                      {jdUploading ? <><span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" /> Fetching…</> : '🔗 Fetch & Save JD'}
                    </button>
                  </>
                )}

                {/* Text paste mode */}
                {jdInputMode === 'text' && (
                  <>
                    <textarea value={form.jobDescription} onChange={f('jobDescription')} rows={8}
                      className={`${inputCls} resize-y min-h-[120px] font-mono text-xs leading-relaxed`}
                      placeholder="Paste the full Job Description here. No character limit…" />
                    <p className="text-slate-600 text-xs mt-1">{form.jobDescription.length.toLocaleString()} chars · Saved when you click Save Changes below</p>
                  </>
                )}
              </div>
            </div>
          )}

          {/* ── ASSIGN TAB ── */}
          {activeSection === 'assign' && isEmployee && (
            <div className="space-y-5">
              {/* Assign Module */}
              <div>
                <FieldLabel>Assign Module</FieldLabel>
                <div className="flex gap-2">
                  <select value={assignModuleId} onChange={e => setAssignModuleId(e.target.value)} className={`flex-1 ${selectCls}`}>
                    <option value="">Select module…</option>
                    {modules.map(m => <option key={m.id} value={m.id}>{m.title}</option>)}
                  </select>
                  <button onClick={handleAssignModule} disabled={!assignModuleId || assigning}
                    className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 rounded-xl text-white text-sm font-semibold transition-colors whitespace-nowrap">
                    {assigning ? '…' : 'Assign'}
                  </button>
                </div>
              </div>

              {/* Assign Manager */}
              <div>
                <FieldLabel>Assign Manager</FieldLabel>
                {currentManagerId && (
                  <p className="text-xs text-slate-500 mb-2">Current: <span className="text-indigo-400 font-medium">{managers.find(m => m.userId === currentManagerId)?.name || 'Unknown'}</span></p>
                )}
                <div className="flex gap-2">
                  <select value={assignManagerId} onChange={e => setAssignManagerId(e.target.value)} className={`flex-1 ${selectCls}`}>
                    <option value="">Select manager…</option>
                    {managers.map(m => <option key={m.userId} value={m.userId}>{m.name}{m.userId === currentManagerId ? ' ✓' : ''}</option>)}
                  </select>
                  <button onClick={handleAssignManager} disabled={!assignManagerId || assigning || assignManagerId === currentManagerId}
                    className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 rounded-xl text-white text-sm font-semibold transition-colors whitespace-nowrap">
                    {assigning ? '…' : assignManagerId === currentManagerId ? '✓ Set' : 'Assign'}
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Skills Gap Panel */}
          {activeSection === 'gap' && isEmployee && (
            <div className="space-y-4">
              {gapLoading && <p className="text-slate-400 text-sm">Analysing skills gap…</p>}
              {!gapLoading && !gapData && <p className="text-slate-500 text-sm">No role defined or role not found in Role Library.</p>}
              {gapData && (
                <>
                  <div className="flex items-center justify-between">
                    <p className="text-sm font-semibold text-white">{gapData.roleName || 'Unknown Role'}</p>
                    {gapData.coverage !== null && (
                      <span className={`px-2 py-0.5 rounded-full text-xs font-bold ${gapData.coverage >= 80 ? 'bg-emerald-500/20 text-emerald-300' : gapData.coverage >= 50 ? 'bg-amber-500/20 text-amber-300' : 'bg-red-500/20 text-red-300'}`}>
                        {gapData.coverage}% coverage
                      </span>
                    )}
                  </div>
                  {!gapData.roleFound && <p className="text-xs text-amber-400">Role not found in Role Library. Add it to enable full skills tracking.</p>}
                  {gapData.required.length === 0 && gapData.roleFound && <p className="text-xs text-slate-500">Role has no required skills defined in Role Library.</p>}
                  {gapData.matched.length > 0 && (
                    <div>
                      <p className="text-xs text-slate-400 mb-1.5">Demonstrated ({gapData.matched.length})</p>
                      <div className="flex flex-wrap gap-1.5">
                        {gapData.matched.map(s => <span key={s} className="px-2 py-0.5 rounded-full text-xs bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">{s}</span>)}
                      </div>
                    </div>
                  )}
                  {gapData.missing.length > 0 && (
                    <div>
                      <p className="text-xs text-slate-400 mb-1.5">Missing ({gapData.missing.length})</p>
                      <div className="flex flex-wrap gap-1.5">
                        {gapData.missing.map(s => <span key={s} className="px-2 py-0.5 rounded-full text-xs bg-red-500/20 text-red-300 border border-red-500/30">{s}</span>)}
                      </div>
                    </div>
                  )}
                </>
              )}
            </div>
          )}

          {/* Onboarding Checklist Panel */}
          {activeSection === 'checklist' && isEmployee && (
            <div className="space-y-3">
              {clLoading && <p className="text-slate-400 text-sm">Loading checklist…</p>}
              {!clLoading && !checklistData && <p className="text-slate-500 text-sm">No checklist assigned. Go to Role Library → edit the role → add Onboarding Checklist items, then assign employee to that role.</p>}
              {checklistData && (
                <>
                  <div className="flex items-center justify-between mb-2">
                    <p className="text-xs text-slate-400">Checklist for: <span className="text-white font-medium">{checklistData.roleName}</span></p>
                    <span className="text-xs text-slate-500">{(checklistData.items || []).filter(i => i.completed).length}/{(checklistData.items || []).length} done</span>
                  </div>
                  {(checklistData.items || []).map(item => (
                    <div key={item.id} className={`flex gap-3 p-3 rounded-lg border ${item.completed ? 'border-emerald-500/30 bg-emerald-500/5' : 'border-slate-700 bg-[#0F172A]'}`}>
                      <div className="mt-0.5">{item.completed ? '✅' : '⬜'}</div>
                      <div className="flex-1">
                        <p className={`text-sm font-medium ${item.completed ? 'line-through text-slate-500' : 'text-white'}`}>{item.title}</p>
                        {item.description && <p className="text-xs text-slate-500 mt-0.5">{item.description}</p>}
                        {item.dueDay && <p className="text-xs text-indigo-400 mt-0.5">Due: Day {item.dueDay}</p>}
                      </div>
                    </div>
                  ))}
                </>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 pb-5 pt-3 border-t border-slate-700/40 flex gap-3 shrink-0">
          <button onClick={handleSave} disabled={saving}
            className="flex-1 px-4 py-2.5 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 rounded-xl text-white font-bold text-sm transition-colors flex items-center justify-center gap-2">
            {saving ? <><span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" /> Saving…</> : '✓ Save Changes'}
          </button>
          <button onClick={onClose} className="px-4 py-2.5 bg-slate-700 hover:bg-slate-600 rounded-xl text-slate-300 text-sm transition-colors">Cancel</button>
        </div>
      </div>
    </div>
  );
}

// ─── Create User Modal ────────────────────────────────────────────────────────

function CreateUserModal({ onClose, onCreated, setToast, currentUserRole }) {
  const [form, setForm] = useState({ name: '', email: '', role: 'employee', jobRole: '', department: '', jobDescription: '', companyName: '' });
  const [saving, setSaving] = useState(false);
  const [roleOptions, setRoleOptions] = useState([]);
  const [additionalRoles, setAdditionalRoles] = useState([]);
  const [addRoleForm, setAddRoleForm] = useState({ roleName: '', department: '' });
  const [showAddRoleForm, setShowAddRoleForm] = useState(false);
  const f = (key) => (e) => setForm(prev => ({ ...prev, [key]: e.target.value }));

  useEffect(() => {
    authFetch('/api/roles').then(res => {
      const list = Array.isArray(res) ? res : res?.roles || res?.data || [];
      setRoleOptions(list.map(r => ({ name: r.roleName || r.name || '', dept: r.department || '' })).filter(r => r.name));
    }).catch(() => {});
  }, []);

  const handleCreate = async () => {
    if (!form.name.trim() || !form.email.trim()) { setToast({ message: 'Name and email are required', type: 'error' }); return; }
    setSaving(true);
    try {
      const user = await authFetch('/api/users', {
        method: 'POST',
        body: JSON.stringify({ ...form, name: form.name.trim(), email: form.email.trim() }),
      });
      // Add additional job roles after user creation
      for (const ar of additionalRoles) {
        try {
          await authFetch(`/api/users/${user.id}/job-roles`, {
            method: 'POST',
            body: JSON.stringify({ roleName: ar.roleName, department: ar.department }),
          });
        } catch (e) { console.warn('Failed to add extra role:', ar.roleName, e.message); }
      }
      onCreated(user);
      onClose();
    } catch (err) { setToast({ message: err.message, type: 'error' }); }
    finally { setSaving(false); }
  };

  return (
    <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-50 p-4" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="bg-slate-800 border border-slate-700/80 rounded-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto shadow-2xl">
        <div className="p-5 border-b border-slate-700/60 flex items-center justify-between">
          <div>
            <h2 className="text-lg font-bold text-white">➕ Create New User</h2>
            <p className="text-slate-500 text-xs mt-0.5">User will be able to log in immediately</p>
          </div>
          <button onClick={onClose} className="text-slate-500 hover:text-white p-1 rounded-lg hover:bg-slate-700 transition-colors">✕</button>
        </div>

        <div className="p-5 space-y-4">
          <div>
            <FieldLabel required>Full Name</FieldLabel>
            <input type="text" value={form.name} onChange={f('name')} className={inputCls} placeholder="Jane Smith" />
          </div>
          <div>
            <FieldLabel required>Email</FieldLabel>
            <input type="email" value={form.email} onChange={f('email')} className={inputCls} placeholder="jane@company.com" />
          </div>
          {currentUserRole === 'admin' && (
            <div>
              <FieldLabel>Role</FieldLabel>
              <select value={form.role} onChange={f('role')} className={selectCls}>
                <option value="employee">Employee</option>
                <option value="manager">Manager</option>
                <option value="admin">Admin</option>
              </select>
            </div>
          )}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <FieldLabel>Job Role</FieldLabel>
              <input
                type="text"
                list="create-role-options"
                value={form.jobRole}
                onChange={e => {
                  const val = e.target.value;
                  setForm(prev => ({ ...prev, jobRole: val }));
                  const match = roleOptions.find(r => r.name.toLowerCase() === val.toLowerCase());
                  if (match?.dept) setForm(prev => ({ ...prev, jobRole: val, department: prev.department || match.dept }));
                }}
                className={inputCls}
                placeholder="e.g. Developer"
                autoComplete="off"
              />
              <datalist id="create-role-options">
                {roleOptions.map(r => <option key={r.name} value={r.name}>{r.dept ? `${r.name} — ${r.dept}` : r.name}</option>)}
              </datalist>
            </div>
            <div>
              <FieldLabel>Department</FieldLabel>
              <input type="text" value={form.department} onChange={f('department')} className={inputCls} placeholder="e.g. Engineering" />
            </div>
          </div>
          <div>
            <FieldLabel>Job Description</FieldLabel>
            <textarea value={form.jobDescription} onChange={f('jobDescription')} rows={4}
              className={`${inputCls} resize-y`}
              placeholder="Paste Job Description here (optional — can be added/uploaded later)" />
          </div>
          {/* Additional Job Roles */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <FieldLabel>Additional Job Roles</FieldLabel>
              <button onClick={() => setShowAddRoleForm(v => !v)}
                className="text-xs text-emerald-400 hover:text-emerald-300 transition-colors">
                {showAddRoleForm ? '− Cancel' : '+ Add More Job Role'}
              </button>
            </div>
            {additionalRoles.length > 0 && (
              <div className="space-y-1.5 mb-2">
                {additionalRoles.map((ar, idx) => (
                  <div key={idx} className="flex items-center justify-between bg-slate-900/60 rounded-lg px-3 py-2">
                    <div>
                      <span className="text-sm text-white font-medium">{ar.roleName}</span>
                      {ar.department && <span className="text-xs text-slate-400 ml-2">· {ar.department}</span>}
                    </div>
                    <button onClick={() => setAdditionalRoles(prev => prev.filter((_, i) => i !== idx))}
                      className="text-slate-500 hover:text-red-400 text-xs transition-colors">✕</button>
                  </div>
                ))}
              </div>
            )}
            {showAddRoleForm && (
              <div className="bg-slate-900/50 rounded-xl p-3 space-y-2">
                <div className="grid grid-cols-2 gap-2">
                  <input type="text" list="create-add-role-options" value={addRoleForm.roleName}
                    onChange={e => setAddRoleForm(prev => ({ ...prev, roleName: e.target.value }))}
                    className={inputCls} placeholder="Role name" autoComplete="off" />
                  <datalist id="create-add-role-options">
                    {roleOptions.map(r => <option key={r.name} value={r.name} />)}
                  </datalist>
                  <input type="text" value={addRoleForm.department}
                    onChange={e => setAddRoleForm(prev => ({ ...prev, department: e.target.value }))}
                    className={inputCls} placeholder="Department (optional)" />
                </div>
                <button
                  onClick={() => {
                    if (!addRoleForm.roleName.trim()) return;
                    setAdditionalRoles(prev => [...prev, { roleName: addRoleForm.roleName.trim(), department: addRoleForm.department.trim() }]);
                    setAddRoleForm({ roleName: '', department: '' });
                    setShowAddRoleForm(false);
                  }}
                  className="w-full py-1.5 bg-emerald-700 hover:bg-emerald-600 rounded-lg text-white text-xs font-medium transition-colors">
                  Add Role
                </button>
              </div>
            )}
          </div>

          <div className="flex items-start gap-2 text-xs text-slate-500 bg-slate-900/50 rounded-xl p-3">
            <span>📧</span>
            <span>An activation email will be sent to the user's email. They click the link to set their own password and log in.</span>
          </div>
        </div>

        <div className="px-5 pb-5 flex gap-3">
          <button onClick={handleCreate} disabled={saving}
            className="flex-1 py-2.5 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 rounded-xl text-white font-bold text-sm transition-colors flex items-center justify-center gap-2">
            {saving ? <><span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" /> Creating…</> : '✓ Create User'}
          </button>
          <button onClick={onClose} className="px-4 py-2.5 bg-slate-700 hover:bg-slate-600 rounded-xl text-slate-300 text-sm transition-colors">Cancel</button>
        </div>
      </div>
    </div>
  );
}

// ─── Bulk Import Modal ────────────────────────────────────────────────────────

const IMPORT_TEMPLATE_CSV = `name,email,system_role,employee_id,job_role,department,job_description,company_name,password,phone,manager_email
# MANDATORY: name, email
# OPTIONAL: system_role (admin/manager/employee - default: employee), employee_id, job_role, department, job_description, company_name, password, phone, manager_email
# IMMUTABLE (never changes after creation): email
# If email already exists -> existing user will be UPDATED with the provided fields
# If email is new -> a new user will be CREATED
Jane Smith,jane@company.com,employee,EMP001,Frontend Developer,Engineering,Builds React UIs,Acme Corp,,+91-9876543210,
John Doe,john@company.com,employee,EMP002,Data Analyst,Analytics,Analyzes business data,Acme Corp,,+91-9123456789,
Sara Lee,sara@company.com,manager,MGR001,Engineering Manager,Engineering,Leads frontend team,Acme Corp,,,
`;

function ImportModal({ onClose, onImported, setToast }) {
  const [step, setStep] = useState('upload'); // upload | preview | result
  const [file, setFile] = useState(null);
  const [dragOver, setDragOver] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [preview, setPreview] = useState(null); // { preview[], summary{} }
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState(null);
  const fileRef = useRef(null);

  const downloadTemplate = () => {
    const blob = new Blob([IMPORT_TEMPLATE_CSV], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'skillforge-user-import-template.csv';
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleFile = (f) => {
    if (!f) return;
    const ext = f.name.split('.').pop().toLowerCase();
    if (!['csv', 'xls', 'xlsx'].includes(ext)) {
      setToast({ message: 'Only CSV, XLS, XLSX files are supported', type: 'error' });
      return;
    }
    setFile(f);
  };

  const handlePreview = async () => {
    if (!file) return;
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append('file', file);
      const res = await authFetch('/api/users/bulk-import/preview', { method: 'POST', body: fd, isFile: true });
      setPreview(res);
      setStep('preview');
    } catch (e) {
      setToast({ message: e.message || 'Failed to parse file', type: 'error' });
    } finally { setUploading(false); }
  };

  const handleImport = async () => {
    const validRows = preview.preview.filter(r => r.status === 'valid' || r.status === 'update');
    if (!validRows.length) return;
    setImporting(true);
    try {
      const res = await authFetch('/api/users/bulk-import', {
        method: 'POST',
        body: JSON.stringify({ rows: validRows }),
      });
      setResult(res);
      setStep('result');
      onImported();
      // Auto-download credential Excel if returned
      if (res?.credentialExcel) {
        try {
          const bin = atob(res.credentialExcel);
          const bytes = new Uint8Array(bin.length);
          for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
          const blob = new Blob([bytes], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url; a.download = `employee-credentials-${Date.now()}.xlsx`; a.click();
          URL.revokeObjectURL(url);
        } catch (_) {}
      }
    } catch (e) {
      setToast({ message: e.message || 'Import failed', type: 'error' });
    } finally { setImporting(false); }
  };

  const validCount   = preview?.preview.filter(r => r.status === 'valid' || r.status === 'update').length || 0;
  const invalidCount = preview?.preview.filter(r => r.status === 'error').length || 0;

  return (
    <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-50 p-4" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="bg-slate-800 border border-slate-700/80 rounded-2xl w-full max-w-3xl max-h-[90vh] flex flex-col shadow-2xl">

        {/* Header */}
        <div className="p-5 border-b border-slate-700/60 flex items-center justify-between shrink-0">
          <div>
            <h2 className="text-lg font-bold text-white">📥 Bulk Import Users</h2>
            <p className="text-slate-500 text-xs mt-0.5">Upload CSV, XLS, or XLSX. New emails create users; existing emails update users automatically.</p>
          </div>
          <button onClick={onClose} className="text-slate-500 hover:text-white p-1 rounded-lg hover:bg-slate-700 transition-colors">✕</button>
        </div>

        {/* Step: Upload */}
        {step === 'upload' && (
          <div className="p-6 space-y-5 flex-1 overflow-y-auto">
            {/* Template download */}
            <div className="flex items-start gap-3 p-4 bg-indigo-500/10 border border-indigo-500/30 rounded-xl">
              <span className="text-2xl">📋</span>
              <div className="flex-1">
                <p className="text-indigo-300 font-semibold text-sm mb-1">Download the import template first</p>
                <p className="text-slate-400 text-xs mb-3">Fill in user data following the column headers. Supported columns: name, email, role, employee_id, job_role, department, job_description, company_name, password, phone, manager_email</p>
                <button onClick={downloadTemplate} className="flex items-center gap-2 px-3 py-1.5 bg-indigo-600/30 hover:bg-indigo-600/50 border border-indigo-500/40 rounded-lg text-indigo-300 text-xs font-bold transition-colors">
                  ⬇ Download Template (CSV)
                </button>
              </div>
            </div>

            {/* Drop zone */}
            <div
              onClick={() => fileRef.current?.click()}
              onDrop={e => { e.preventDefault(); setDragOver(false); handleFile(e.dataTransfer.files[0]); }}
              onDragOver={e => { e.preventDefault(); setDragOver(true); }}
              onDragLeave={() => setDragOver(false)}
              className={`border-2 border-dashed rounded-2xl p-10 text-center cursor-pointer transition-all ${dragOver ? 'border-indigo-500 bg-indigo-500/10' : file ? 'border-emerald-500/60 bg-emerald-500/5' : 'border-slate-600 hover:border-slate-500 hover:bg-slate-700/20'}`}
            >
              <input ref={fileRef} type="file" accept=".csv,.xls,.xlsx" className="hidden" onChange={e => handleFile(e.target.files[0])} />
              {file ? (
                <>
                  <div className="text-4xl mb-3">✅</div>
                  <p className="text-emerald-400 font-bold text-sm">{file.name}</p>
                  <p className="text-slate-500 text-xs mt-1">{(file.size / 1024).toFixed(1)} KB · Click to change</p>
                </>
              ) : (
                <>
                  <div className="text-4xl mb-3">📂</div>
                  <p className="text-slate-300 font-semibold text-sm">Drop file here or click to browse</p>
                  <p className="text-slate-500 text-xs mt-1">CSV, XLS, XLSX · Max 10 MB</p>
                </>
              )}
            </div>

            <div className="flex gap-3">
              <button onClick={onClose} className="flex-1 py-2.5 bg-slate-700 hover:bg-slate-600 rounded-xl text-white font-bold text-sm transition-colors">Cancel</button>
              <button onClick={handlePreview} disabled={!file || uploading}
                className="flex-1 py-2.5 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 rounded-xl text-white font-bold text-sm transition-colors flex items-center justify-center gap-2">
                {uploading ? <><span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" /> Parsing…</> : '→ Preview Import'}
              </button>
            </div>
          </div>
        )}

        {/* Step: Preview */}
        {step === 'preview' && preview && (
          <div className="flex flex-col flex-1 overflow-hidden">
            {/* Summary bar */}
            <div className="px-5 py-3 border-b border-slate-700/60 flex items-center gap-4 shrink-0">
              <span className="text-sm text-slate-400">{preview.summary.total} rows found</span>
              <span className="px-2.5 py-0.5 rounded-full bg-emerald-500/20 text-emerald-400 text-xs font-bold border border-emerald-500/30">{validCount} valid</span>
              {invalidCount > 0 && <span className="px-2.5 py-0.5 rounded-full bg-red-500/20 text-red-400 text-xs font-bold border border-red-500/30">{invalidCount} will be skipped</span>}
            </div>

            {/* Preview table */}
            <div className="flex-1 overflow-auto p-4">
              <table className="w-full text-xs">
                <thead className="sticky top-0 bg-slate-800">
                  <tr className="border-b border-slate-700/60">
                    <th className="py-2 px-3 text-left text-slate-400 font-bold uppercase tracking-wider">#</th>
                    <th className="py-2 px-3 text-left text-slate-400 font-bold uppercase tracking-wider">Name</th>
                    <th className="py-2 px-3 text-left text-slate-400 font-bold uppercase tracking-wider">Email</th>
                    <th className="py-2 px-3 text-left text-slate-400 font-bold uppercase tracking-wider">Role</th>
                    <th className="py-2 px-3 text-left text-slate-400 font-bold uppercase tracking-wider">Dept</th>
                    <th className="py-2 px-3 text-left text-slate-400 font-bold uppercase tracking-wider">Job Role</th>
                    <th className="py-2 px-3 text-left text-slate-400 font-bold uppercase tracking-wider">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-700/30">
                  {preview.preview.map(row => (
                    <tr key={row.rowNum} className={row.status === 'error' ? 'bg-red-500/5' : row.status === 'update' ? 'bg-amber-500/5 hover:bg-amber-500/10' : 'hover:bg-slate-700/20'}>
                      <td className="py-2 px-3 text-slate-500">{row.rowNum}</td>
                      <td className="py-2 px-3 text-white font-medium">{row.name || '—'}</td>
                      <td className="py-2 px-3 text-slate-300">{row.email || '—'}</td>
                      <td className="py-2 px-3">
                        <span className={`px-2 py-0.5 rounded-full text-xs font-bold border ${
                          row.role === 'admin' ? 'bg-purple-500/20 text-purple-300 border-purple-500/30' :
                          row.role === 'manager' ? 'bg-indigo-500/20 text-indigo-300 border-indigo-500/30' :
                          'bg-emerald-500/20 text-emerald-300 border-emerald-500/30'
                        }`}>{row.role || 'employee'}</span>
                      </td>
                      <td className="py-2 px-3 text-slate-400">{row.department || '—'}</td>
                      <td className="py-2 px-3 text-slate-400">{row.jobRole || '—'}</td>
                      <td className="py-2 px-3">
                        {row.status === 'valid'
                          ? <span className="text-emerald-400 font-bold">✓ Ready</span>
                          : row.status === 'update'
                          ? <span className="px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-300 border border-amber-500/30 text-xs font-bold">UPDATE</span>
                          : <span className="text-red-400 font-bold" title={row.errors?.join(', ')}>✕ {row.errors?.[0]}</span>
                        }
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="p-4 border-t border-slate-700/60 flex gap-3 shrink-0">
              <button onClick={() => setStep('upload')} className="px-4 py-2.5 bg-slate-700 hover:bg-slate-600 rounded-xl text-white font-bold text-sm transition-colors">← Back</button>
              <button onClick={handleImport} disabled={validCount === 0 || importing}
                className="flex-1 py-2.5 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 rounded-xl text-white font-bold text-sm transition-colors flex items-center justify-center gap-2">
                {importing ? <><span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" /> Importing…</> : `Import ${validCount} User${validCount !== 1 ? 's' : ''}`}
              </button>
            </div>
          </div>
        )}

        {/* Step: Result */}
        {step === 'result' && result && (
          <div className="p-6 space-y-5 flex-1 overflow-y-auto">
            <div className="text-center">
              <div className="text-5xl mb-3">{result.created > 0 ? '🎉' : '⚠️'}</div>
              <h3 className="text-xl font-bold text-white mb-1">Import Complete</h3>
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div className="bg-emerald-500/10 border border-emerald-500/30 rounded-xl p-4 text-center">
                <p className="text-3xl font-black text-emerald-400">{result.created}</p>
                <p className="text-xs text-emerald-300 font-bold mt-1">Created</p>
              </div>
              <div className="bg-amber-500/10 border border-amber-500/30 rounded-xl p-4 text-center">
                <p className="text-3xl font-black text-amber-400">{result.skipped}</p>
                <p className="text-xs text-amber-300 font-bold mt-1">Skipped</p>
              </div>
              <div className="bg-red-500/10 border border-red-500/30 rounded-xl p-4 text-center">
                <p className="text-3xl font-black text-red-400">{result.failed}</p>
                <p className="text-xs text-red-300 font-bold mt-1">Failed</p>
              </div>
            </div>
            {result.results?.created?.length > 0 && (
              <div>
                <p className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">Created Users</p>
                <div className="bg-slate-900/60 rounded-xl divide-y divide-slate-700/40 max-h-48 overflow-y-auto">
                  {result.results.created.map(u => (
                    <div key={u.userId} className="flex items-center justify-between px-4 py-2.5">
                      <div>
                        <p className="text-sm font-medium text-white">{u.name}</p>
                        <p className="text-xs text-slate-500">{u.email}</p>
                      </div>
                      {u.tempPassword && (
                        <span className="font-mono text-xs text-amber-300 bg-amber-500/10 px-2 py-1 rounded-lg border border-amber-500/20">{u.tempPassword}</span>
                      )}
                    </div>
                  ))}
                </div>
                {result.credentialExcel && (
                  <button
                    onClick={() => {
                      try {
                        const bin = atob(result.credentialExcel);
                        const bytes = new Uint8Array(bin.length);
                        for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
                        const blob = new Blob([bytes], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
                        const url = URL.createObjectURL(blob);
                        const a = document.createElement('a');
                        a.href = url; a.download = 'employee-credentials.xlsx'; a.click();
                        URL.revokeObjectURL(url);
                      } catch (_) {}
                    }}
                    className="mt-3 w-full py-2.5 bg-emerald-600 hover:bg-emerald-500 rounded-xl text-white font-bold text-sm transition-colors flex items-center justify-center gap-2"
                  >
                    ⬇ Download Credentials Excel (Name / Email / Password)
                  </button>
                )}
              </div>
            )}
            {result.results?.skipped?.length > 0 && (
              <div>
                <p className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">Skipped</p>
                <div className="bg-slate-900/60 rounded-xl divide-y divide-slate-700/40 max-h-32 overflow-y-auto">
                  {result.results.skipped.map((s, i) => (
                    <div key={i} className="flex items-center justify-between px-4 py-2">
                      <span className="text-xs text-slate-400">{s.row?.email || '—'}</span>
                      <span className="text-xs text-amber-400">{s.reason}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
            <button onClick={onClose} className="w-full py-2.5 bg-indigo-600 hover:bg-indigo-500 rounded-xl text-white font-bold text-sm transition-colors">Done</button>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Manager Mapping Modal ────────────────────────────────────────────────────

const MANAGER_MAPPING_TEMPLATE = `Employee Email,Manager Email\njane@company.com,manager@company.com\n`;

function ManagerMappingModal({ onClose, onDone, setToast }) {
  const [step, setStep] = useState('upload');
  const [rows, setRows] = useState([]);
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState(null);
  const fileRef = useRef(null);

  const downloadTemplate = () => {
    const blob = new Blob([MANAGER_MAPPING_TEMPLATE], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = 'manager-mapping-template.csv'; a.click(); URL.revokeObjectURL(url);
  };

  const handleFile = async (file) => {
    if (!file) return;
    const text = await file.text();
    const lines = text.trim().split('\n').filter(Boolean);
    if (lines.length < 2) { setToast({ message: 'File empty or no data rows', type: 'error' }); return; }
    const headers = lines[0].split(',').map(h => h.replace(/"/g,'').trim().toLowerCase().replace(/\s+/g,'_'));
    const parsed = lines.slice(1).map(line => {
      const cols = line.split(',').map(c => c.replace(/"/g,'').trim());
      const row = {};
      headers.forEach((h, i) => { row[h] = cols[i] || ''; });
      return { employeeEmail: row.employee_email || row.employeeemail || row.employee || '', managerEmail: row.manager_email || row.manageremail || row.manager || '' };
    }).filter(r => r.employeeEmail || r.managerEmail);
    setRows(parsed);
    setStep('preview');
  };

  const handleSubmit = async () => {
    setSubmitting(true);
    try {
      const data = await authFetch('/api/users/bulk-manager-mapping', { method: 'POST', body: JSON.stringify({ rows }) });
      setResult(data);
      setStep('result');
      onDone();
    } catch (e) {
      setToast({ message: e.message || 'Mapping failed', type: 'error' });
    } finally { setSubmitting(false); }
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
      <div className="bg-[#0F172A] border border-slate-700 rounded-2xl w-full max-w-lg shadow-2xl overflow-hidden flex flex-col max-h-[85vh]">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-700/60 flex-shrink-0">
          <h2 className="text-lg font-bold text-white">🔗 Import Manager Mapping</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-white text-xl">✕</button>
        </div>
        <div className="flex-1 overflow-y-auto p-6 space-y-4">
          {step === 'upload' && (
            <>
              <p className="text-sm text-slate-400">Upload a CSV with Employee Email and Manager Email columns. The system will update manager assignments and add employees to the manager's group.</p>
              <button onClick={downloadTemplate} className="w-full py-2.5 rounded-xl border border-indigo-500/40 bg-indigo-500/10 text-indigo-300 text-sm font-bold hover:bg-indigo-500/20 transition-colors">⬇ Download Template</button>
              <div onClick={() => fileRef.current?.click()} className="border-2 border-dashed border-slate-600 rounded-xl p-8 text-center cursor-pointer hover:border-indigo-500 transition-colors">
                <p className="text-slate-400 text-sm">Click to upload CSV</p>
                <input ref={fileRef} type="file" accept=".csv,.xlsx" className="hidden" onChange={e => e.target.files[0] && handleFile(e.target.files[0])} />
              </div>
            </>
          )}
          {step === 'preview' && (
            <>
              <p className="text-sm text-slate-400">{rows.length} mapping rows found. Review and confirm.</p>
              <div className="rounded-xl border border-slate-700/50 overflow-hidden max-h-64 overflow-y-auto">
                <table className="w-full text-xs">
                  <thead><tr className="bg-slate-800"><th className="px-3 py-2 text-left text-slate-400">#</th><th className="px-3 py-2 text-left text-slate-400">Employee Email</th><th className="px-3 py-2 text-left text-slate-400">Manager Email</th></tr></thead>
                  <tbody>{rows.map((r, i) => <tr key={i} className="border-t border-slate-700/40"><td className="px-3 py-2 text-slate-500">{i+1}</td><td className="px-3 py-2 text-white">{r.employeeEmail}</td><td className="px-3 py-2 text-indigo-300">{r.managerEmail}</td></tr>)}</tbody>
                </table>
              </div>
              <div className="flex gap-3">
                <button onClick={() => setStep('upload')} className="px-5 py-2.5 rounded-xl bg-slate-800 border border-slate-700 text-sm font-bold text-slate-300">← Back</button>
                <button onClick={handleSubmit} disabled={submitting || !rows.length} className="flex-1 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-sm font-bold text-white disabled:opacity-40">
                  {submitting ? 'Mapping…' : `Map ${rows.length} Employees →`}
                </button>
              </div>
            </>
          )}
          {step === 'result' && result && (
            <div className="space-y-4">
              <div className="grid grid-cols-3 gap-3 text-center">
                <div className="rounded-xl bg-emerald-500/10 border border-emerald-500/30 p-4"><p className="text-2xl font-black text-emerald-300">{result.mapped}</p><p className="text-xs text-emerald-400 mt-0.5">Mapped</p></div>
                <div className="rounded-xl bg-amber-500/10 border border-amber-500/30 p-4"><p className="text-2xl font-black text-amber-300">{result.skipped}</p><p className="text-xs text-amber-400 mt-0.5">Skipped</p></div>
                <div className="rounded-xl bg-red-500/10 border border-red-500/30 p-4"><p className="text-2xl font-black text-red-300">{result.errors}</p><p className="text-xs text-red-400 mt-0.5">Errors</p></div>
              </div>
              {result.results?.errors?.length > 0 && (
                <div className="rounded-xl bg-red-500/5 border border-red-500/20 p-4 max-h-48 overflow-y-auto">
                  <p className="text-xs font-bold text-red-400 mb-2">Errors</p>
                  {result.results.errors.map((e, i) => <p key={i} className="text-xs text-red-300 mb-1">{e.row?.employeeEmail}: {e.reason}</p>)}
                </div>
              )}
              <button onClick={onClose} className="w-full py-2.5 rounded-xl bg-slate-700 hover:bg-slate-600 text-sm font-bold text-white">Done</button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Bulk Update Modal ────────────────────────────────────────────────────────

const BULK_UPDATE_TEMPLATE = `Email,Job Role,Department,Manager Email,Group,Access Rights\njane@company.com,Senior Developer,Engineering,manager@company.com,Dev Team,\n`;

function BulkUpdateModal({ onClose, onDone, setToast }) {
  const [step, setStep] = useState('upload');
  const [rows, setRows] = useState([]);
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState(null);
  const fileRef = useRef(null);

  const downloadTemplate = () => {
    const blob = new Blob([BULK_UPDATE_TEMPLATE], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = 'bulk-update-template.csv'; a.click(); URL.revokeObjectURL(url);
  };

  const handleFile = async (file) => {
    if (!file) return;
    const text = await file.text();
    const lines = text.trim().split('\n').filter(Boolean);
    if (lines.length < 2) { setToast({ message: 'File empty or no data rows', type: 'error' }); return; }
    const headers = lines[0].split(',').map(h => h.replace(/"/g,'').trim().toLowerCase().replace(/\s+/g,'_'));
    const parsed = lines.slice(1).map(line => {
      const cols = line.split(',').map(c => c.replace(/"/g,'').trim());
      const row = {};
      headers.forEach((h, i) => { row[h] = cols[i] || ''; });
      return { email: row.email || '', jobRole: row.job_role || '', department: row.department || '', managerEmail: row.manager_email || '', group: row.group || '', accessRights: row.access_rights || '' };
    }).filter(r => r.email);
    setRows(parsed);
    setStep('preview');
  };

  const handleSubmit = async () => {
    setSubmitting(true);
    try {
      const data = await authFetch('/api/users/bulk-update', { method: 'POST', body: JSON.stringify({ rows }) });
      setResult(data);
      setStep('result');
      onDone();
    } catch (e) {
      setToast({ message: e.message || 'Update failed', type: 'error' });
    } finally { setSubmitting(false); }
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
      <div className="bg-[#0F172A] border border-slate-700 rounded-2xl w-full max-w-lg shadow-2xl overflow-hidden flex flex-col max-h-[85vh]">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-700/60 flex-shrink-0">
          <h2 className="text-lg font-bold text-white">✏️ Bulk Update Users</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-white text-xl">✕</button>
        </div>
        <div className="flex-1 overflow-y-auto p-6 space-y-4">
          {step === 'upload' && (
            <>
              <p className="text-sm text-slate-400">Upload a CSV to update user fields. Only non-empty columns are updated — existing values are preserved.</p>
              <div className="rounded-xl bg-slate-800/50 border border-slate-700/40 p-3 text-xs text-slate-400">
                <span className="font-bold text-slate-300">Updatable fields: </span>Job Role, Department, Manager Email, Group, Access Rights (admin/manager/trainer)
              </div>
              <button onClick={downloadTemplate} className="w-full py-2.5 rounded-xl border border-indigo-500/40 bg-indigo-500/10 text-indigo-300 text-sm font-bold hover:bg-indigo-500/20 transition-colors">⬇ Download Template</button>
              <div onClick={() => fileRef.current?.click()} className="border-2 border-dashed border-slate-600 rounded-xl p-8 text-center cursor-pointer hover:border-indigo-500 transition-colors">
                <p className="text-slate-400 text-sm">Click to upload CSV</p>
                <input ref={fileRef} type="file" accept=".csv,.xlsx" className="hidden" onChange={e => e.target.files[0] && handleFile(e.target.files[0])} />
              </div>
            </>
          )}
          {step === 'preview' && (
            <>
              <p className="text-sm text-slate-400">{rows.length} rows found. Only non-empty fields will be updated.</p>
              <div className="rounded-xl border border-slate-700/50 overflow-hidden max-h-64 overflow-y-auto">
                <table className="w-full text-xs">
                  <thead><tr className="bg-slate-800"><th className="px-3 py-2 text-left text-slate-400">#</th><th className="px-3 py-2 text-left text-slate-400">Email</th><th className="px-3 py-2 text-left text-slate-400">Job Role</th><th className="px-3 py-2 text-left text-slate-400">Dept</th></tr></thead>
                  <tbody>{rows.map((r, i) => <tr key={i} className="border-t border-slate-700/40"><td className="px-3 py-2 text-slate-500">{i+1}</td><td className="px-3 py-2 text-white">{r.email}</td><td className="px-3 py-2 text-indigo-300">{r.jobRole || '—'}</td><td className="px-3 py-2 text-slate-400">{r.department || '—'}</td></tr>)}</tbody>
                </table>
              </div>
              <div className="flex gap-3">
                <button onClick={() => setStep('upload')} className="px-5 py-2.5 rounded-xl bg-slate-800 border border-slate-700 text-sm font-bold text-slate-300">← Back</button>
                <button onClick={handleSubmit} disabled={submitting || !rows.length} className="flex-1 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-sm font-bold text-white disabled:opacity-40">
                  {submitting ? 'Updating…' : `Update ${rows.length} Users →`}
                </button>
              </div>
            </>
          )}
          {step === 'result' && result && (
            <div className="space-y-4">
              <div className="grid grid-cols-3 gap-3 text-center">
                <div className="rounded-xl bg-emerald-500/10 border border-emerald-500/30 p-4"><p className="text-2xl font-black text-emerald-300">{result.updated}</p><p className="text-xs text-emerald-400 mt-0.5">Updated</p></div>
                <div className="rounded-xl bg-amber-500/10 border border-amber-500/30 p-4"><p className="text-2xl font-black text-amber-300">{result.skipped}</p><p className="text-xs text-amber-400 mt-0.5">Skipped</p></div>
                <div className="rounded-xl bg-red-500/10 border border-red-500/30 p-4"><p className="text-2xl font-black text-red-300">{result.errors}</p><p className="text-xs text-red-400 mt-0.5">Errors</p></div>
              </div>
              {result.results?.errors?.length > 0 && (
                <div className="rounded-xl bg-red-500/5 border border-red-500/20 p-4 max-h-48 overflow-y-auto">
                  <p className="text-xs font-bold text-red-400 mb-2">Errors</p>
                  {result.results.errors.map((e, i) => <p key={i} className="text-xs text-red-300 mb-1">{e.row?.email}: {e.reason}</p>)}
                </div>
              )}
              <button onClick={onClose} className="w-full py-2.5 rounded-xl bg-slate-700 hover:bg-slate-600 text-sm font-bold text-white">Done</button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Invite Result Modal ──────────────────────────────────────────────────────

function InviteResultModal({ user, onClose }) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    navigator.clipboard.writeText(user.activationUrl || '');
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  if (user.emailSent) {
    return (
      <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-[100] p-4">
        <div className="bg-slate-800 border border-emerald-500/40 rounded-2xl w-full max-w-sm p-6 shadow-2xl text-center">
          <div className="text-4xl mb-3">✅</div>
          <h3 className="text-lg font-bold text-white mb-1">Invitation Sent!</h3>
          <p className="text-slate-400 text-sm mb-2">
            An activation email has been sent to <span className="text-emerald-400 font-semibold">{user.email}</span>
          </p>
          <p className="text-slate-500 text-xs mb-5">The user will click the link in the email to set their password and log in. The link expires in 72 hours.</p>
          <button onClick={onClose} className="w-full py-2.5 bg-emerald-600 hover:bg-emerald-500 rounded-xl text-white font-bold text-sm transition-colors">Done</button>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-[100] p-4">
      <div className="bg-slate-800 border border-amber-500/40 rounded-2xl w-full max-w-sm p-6 shadow-2xl text-center">
        <div className="text-4xl mb-3">⚠️</div>
        <h3 className="text-lg font-bold text-white mb-1">User Created — Email Failed</h3>
        <p className="text-slate-400 text-sm mb-1">
          <span className="text-white font-semibold">{user.name}</span> was created but the invitation email could not be delivered to <span className="text-amber-300">{user.email}</span>.
        </p>
        {user.emailError && <p className="text-red-400 text-xs mb-3 bg-red-500/10 rounded-lg p-2">{user.emailError}</p>}
        <p className="text-slate-500 text-xs mb-3">Share this activation link manually — it expires in 72 hours:</p>
        <div className="bg-slate-900 rounded-xl p-3 text-indigo-300 text-xs font-mono break-all mb-4 border border-indigo-500/30 text-left">
          {user.activationUrl}
        </div>
        <div className="flex gap-3">
          <button onClick={copy} className={`flex-1 py-2.5 rounded-xl font-bold text-sm transition-colors ${copied ? 'bg-emerald-600 text-white' : 'bg-indigo-600 hover:bg-indigo-500 text-white'}`}>
            {copied ? '✓ Copied!' : '📋 Copy Link'}
          </button>
          <button onClick={onClose} className="px-4 py-2.5 bg-slate-700 hover:bg-slate-600 rounded-xl text-slate-300 text-sm transition-colors">Done</button>
        </div>
        <p className="text-slate-600 text-xs mt-3">Check Render logs and verify SMTP env vars are set correctly.</p>
      </div>
    </div>
  );
}

// ─── Manage Access Modal ──────────────────────────────────────────────────────

const ACCESS_OPTIONS = [
  { value: 'admin',    label: 'Admin',    desc: 'Full platform management', color: 'purple' },
  { value: 'manager',  label: 'Manager',  desc: 'Team & group management',  color: 'indigo' },
  { value: 'employee', label: 'Employee', desc: 'Learner access',           color: 'emerald' },
];

function ManageAccessModal({ user: targetUser, onClose, onSaved, setToast }) {
  const [selected, setSelected] = useState(targetUser.accesses || []);
  const [saving, setSaving] = useState(false);

  const toggle = (val) => setSelected(p => p.includes(val) ? p.filter(x => x !== val) : [...p, val]);

  const handleSave = async () => {
    setSaving(true);
    try {
      const updated = await authFetch(`/api/users/${targetUser.userId}/accesses`, {
        method: 'PUT',
        body: JSON.stringify({ accesses: selected }),
      });
      onSaved(updated);
      setToast({ message: `Access updated for ${targetUser.name}`, type: 'success' });
      onClose();
    } catch (e) {
      setToast({ message: e.message || 'Failed to update access', type: 'error' });
    } finally {
      setSaving(false);
    }
  };

  const colorMap = { purple: { bg: 'bg-purple-500/10', border: 'border-purple-500/40', text: 'text-purple-300', check: 'bg-purple-500/20 border-purple-500/50' }, indigo: { bg: 'bg-indigo-500/10', border: 'border-indigo-500/40', text: 'text-indigo-300', check: 'bg-indigo-500/20 border-indigo-500/50' }, emerald: { bg: 'bg-emerald-500/10', border: 'border-emerald-500/40', text: 'text-emerald-300', check: 'bg-emerald-500/20 border-emerald-500/50' } };

  return (
    <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-[100] p-4" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="bg-slate-800 border border-slate-700/80 rounded-2xl w-full max-w-md shadow-2xl">
        <div className="p-5 border-b border-slate-700/60 flex items-center justify-between">
          <div>
            <h3 className="text-lg font-bold text-white">Manage Access</h3>
            <p className="text-slate-400 text-sm mt-0.5">{targetUser.name} · <span className="capitalize">{targetUser.role}</span></p>
          </div>
          <button onClick={onClose} className="text-slate-500 hover:text-white p-1 rounded-lg hover:bg-slate-700 transition-colors">✕</button>
        </div>

        <div className="p-5 space-y-3">
          <p className="text-xs text-slate-500">Grant additional platform access. The user can switch between views without logging out.</p>
          {ACCESS_OPTIONS.filter(opt => opt.value !== targetUser.role).map(opt => {
            const active = selected.includes(opt.value);
            const c = colorMap[opt.color];
            return (
              <label key={opt.value} className={`flex items-center gap-4 p-4 rounded-xl border cursor-pointer transition-all ${active ? `${c.bg} ${c.border}` : 'bg-slate-900/40 border-slate-700/50 hover:border-slate-600'}`}>
                <div className={`w-5 h-5 rounded border-2 flex items-center justify-center flex-shrink-0 transition-all ${active ? `${c.check} border-current` : 'border-slate-600 bg-slate-800'}`}>
                  {active && <span className="text-xs text-white font-bold">✓</span>}
                </div>
                <input type="checkbox" className="hidden" checked={active} onChange={() => toggle(opt.value)} />
                <div>
                  <p className={`text-sm font-bold ${active ? c.text : 'text-slate-300'}`}>{opt.label}</p>
                  <p className="text-xs text-slate-500">{opt.desc}</p>
                </div>
              </label>
            );
          })}
          <div className="pt-1 p-3 bg-slate-900/40 rounded-xl border border-slate-700/40 text-xs text-slate-500">
            <span className="text-slate-400 font-semibold">Current base role:</span> <span className="capitalize text-slate-300">{targetUser.role}</span> (unchanged)
          </div>
        </div>

        <div className="px-5 pb-5 flex gap-3">
          <button onClick={handleSave} disabled={saving}
            className="flex-1 py-2.5 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 rounded-xl text-white font-bold text-sm transition-colors flex items-center justify-center gap-2">
            {saving ? <><span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" /> Saving…</> : '✓ Save Access'}
          </button>
          <button onClick={onClose} className="px-4 py-2.5 bg-slate-700 hover:bg-slate-600 rounded-xl text-slate-300 text-sm transition-colors">Cancel</button>
        </div>
      </div>
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function UserManagement() {
  const { user, hasRole, activeRole } = useAuth();
  const navigate = useNavigate();

  const [users, setUsers] = useState([]);
  const [assignments, setAssignments] = useState([]);
  const [modules, setModules] = useState([]);
  const [loading, setLoading] = useState(true);
  const [lastRefreshed, setLastRefreshed] = useState(null);
  const [toast, setToast] = useState(null);
  const [activeTab, setActiveTab] = useState('employees');
  const [search, setSearch] = useState('');
  const [sortBy, setSortBy] = useState('name');
  const [sortDir, setSortDir] = useState('asc');
  const [detailUser, setDetailUser] = useState(null);
  const [editUser, setEditUser] = useState(null);
  const [showCreate, setShowCreate] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [inviteResultUser, setInviteResultUser] = useState(null);
  const [manageAccessUser, setManageAccessUser] = useState(null);

  // View follows the effective (switched) role so admins acting as manager see the
  // manager-scoped variant, and vice versa. Access is still gated by hasRole below.
  const isManager = activeRole === 'manager';
  const isAdmin = !isManager && hasRole('admin');
  const currentUserRole = activeRole || user?.role;

  useEffect(() => {
    if (!hasRole('admin') && !hasRole('manager')) navigate('/dashboard');
  }, [navigate]);

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
        const freshUsers = Array.isArray(u) ? u : u?.users || u?.data || [];
        setUsers(freshUsers);
        // Keep open panels in sync with fresh data
        const findFresh = (prev) => prev ? freshUsers.find(x => (x.userId || x.id) === (prev.userId || prev.id)) || prev : null;
        setDetailUser(findFresh);
        setEditUser(findFresh);
      }
      if (assignmentsData.status === 'fulfilled') {
        const a = assignmentsData.value;
        setAssignments(Array.isArray(a) ? a : a?.assignments || a?.data || []);
      }
      if (modulesData.status === 'fulfilled') {
        const m = modulesData.value;
        setModules(Array.isArray(m) ? m : m?.modules || m?.data || []);
      }
    } catch { setToast({ message: 'Failed to load data', type: 'error' }); }
    finally { setLoading(false); }
  };

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 30_000);
    return () => clearInterval(interval);
  }, []);

  const staffUsers = useMemo(() => users.filter(u => ['admin', 'manager'].includes(u.role)), [users]);
  const employeeUsers = useMemo(() => users.filter(u => u.role === 'employee'), [users]);

  const roleCounts = useMemo(() => {
    const counts = {};
    employeeUsers.forEach(u => {
      if (u.jobRole && u.jobRole.trim()) {
        const key = u.jobRole.trim();
        counts[key] = (counts[key] || 0) + 1;
      }
    });
    return Object.entries(counts).sort((a, b) => b[1] - a[1]);
  }, [employeeUsers]);

  const getUserAssignments = (userId) => assignments.filter(a => a.employeeId === userId || a.userId === userId);

  const displayedUsers = useMemo(() => {
    const list = activeTab === 'staff' ? staffUsers : employeeUsers;
    const q = search.toLowerCase();
    let filtered = q
      ? list.filter(u => u.name?.toLowerCase().includes(q) || u.email?.toLowerCase().includes(q) || u.jobRole?.toLowerCase().includes(q) || u.department?.toLowerCase().includes(q))
      : list;

    filtered = [...filtered].sort((a, b) => {
      let aVal, bVal;
      if (sortBy === 'role') {
        const d = (ROLE_RANK[a.role] ?? 99) - (ROLE_RANK[b.role] ?? 99);
        if (d !== 0) return sortDir === 'asc' ? d : -d;
        aVal = a.name || ''; bVal = b.name || '';
      } else if (sortBy === 'assignments') {
        aVal = getUserAssignments(a.userId).length;
        bVal = getUserAssignments(b.userId).length;
      } else {
        aVal = (a[sortBy] || '').toString().toLowerCase();
        bVal = (b[sortBy] || '').toString().toLowerCase();
      }
      if (aVal < bVal) return sortDir === 'asc' ? -1 : 1;
      if (aVal > bVal) return sortDir === 'asc' ? 1 : -1;
      return 0;
    });
    return filtered;
  }, [users, assignments, activeTab, search, sortBy, sortDir]);

  const handleSort = (col) => {
    if (sortBy === col) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortBy(col); setSortDir('asc'); }
  };

  const handleUserCreated = (newUser) => {
    setUsers(prev => [newUser, ...prev]);
    setInviteResultUser(newUser);
  };

  if (loading && users.length === 0) {
    return (
      <div className="min-h-screen bg-[#0F172A] flex items-center justify-center">
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

      {detailUser && (
        <DetailModal user={detailUser} assignments={assignments} onClose={() => setDetailUser(null)}
          onEdit={u => { setDetailUser(null); setEditUser(u); }}
          onDeleteSuccess={id => setUsers(prev => prev.filter(u => u.userId !== id))}
          setToast={setToast} />
      )}
      {editUser && (
        <EditModal user={editUser} modules={modules} users={users} assignments={assignments}
          onClose={() => setEditUser(null)} onSaved={fetchData} setToast={setToast} currentUserRole={currentUserRole} />
      )}
      {showCreate && (
        <CreateUserModal onClose={() => setShowCreate(false)} onCreated={handleUserCreated} setToast={setToast} currentUserRole={currentUserRole} />
      )}
      {showImport && (
        <ImportModal onClose={() => setShowImport(false)} onImported={fetchData} setToast={setToast} />
      )}

      {inviteResultUser && (
        <InviteResultModal user={inviteResultUser} onClose={() => setInviteResultUser(null)} />
      )}
      {manageAccessUser && isAdmin && (
        <ManageAccessModal
          user={manageAccessUser}
          onClose={() => setManageAccessUser(null)}
          onSaved={updatedUser => setUsers(prev => prev.map(u => u.userId === updatedUser.userId ? { ...u, ...updatedUser } : u))}
          setToast={setToast}
        />
      )}

      <div className="max-w-7xl mx-auto p-6 lg:p-8">

        {/* Page header */}
        <div className="mb-8">
          <button onClick={() => navigate('/admin/dashboard')} className="text-slate-500 hover:text-slate-300 text-sm flex items-center gap-1.5 mb-5 transition-colors">← Back to Dashboard</button>
          <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
            <div>
              <h1 className="text-3xl font-black text-white tracking-tight">User Management</h1>
              <p className="text-slate-400 mt-1">Manage users, roles, job roles, JDs, and assignments</p>
            </div>
            <div className="flex items-center gap-3">
              {/* Stats */}
              <div className="flex gap-2 text-sm">
                <div className="bg-slate-800 border border-slate-700/60 rounded-xl px-3 py-2 text-center">
                  <div className="text-xl font-bold text-white">{users.length}</div>
                  <div className="text-slate-500 text-xs">Total</div>
                </div>
                <div className="bg-slate-800 border border-slate-700/60 rounded-xl px-3 py-2 text-center">
                  <div className="text-xl font-bold text-emerald-300">{employeeUsers.length}</div>
                  <div className="text-slate-500 text-xs">Employees</div>
                </div>
                <div className="bg-slate-800 border border-slate-700/60 rounded-xl px-3 py-2 text-center">
                  <div className="text-xl font-bold text-sky-300">{staffUsers.length}</div>
                  <div className="text-slate-500 text-xs">Staff</div>
                </div>
              </div>
              {/* Import button */}
              <button onClick={() => setShowImport(true)}
                className="flex items-center gap-2 px-4 py-2.5 bg-emerald-700 hover:bg-emerald-600 border border-emerald-600 rounded-xl text-white font-bold text-sm transition-colors shadow-lg shadow-emerald-900/30">
                📥 Bulk Import
              </button>
              {/* Create button */}
              <button onClick={() => setShowCreate(true)}
                className="flex items-center gap-2 px-4 py-2.5 bg-indigo-600 hover:bg-indigo-500 rounded-xl text-white font-bold text-sm transition-colors shadow-lg shadow-indigo-500/20">
                ➕ Add User
              </button>
            </div>
          </div>
        </div>

        {/* Job Role Distribution */}
        {roleCounts.length > 0 && (
          <div className="mb-5 p-3 bg-slate-800/50 border border-slate-700/50 rounded-xl">
            <p className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">Job Role Distribution</p>
            <div className="flex flex-wrap gap-2">
              {roleCounts.map(([role, count]) => (
                <span key={role} className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-indigo-500/15 text-indigo-300 border border-indigo-500/25">
                  {role}
                  <span className="bg-indigo-500/30 text-indigo-200 rounded-full px-1.5 py-0.5 text-xs font-bold leading-none">{count}</span>
                </span>
              ))}
            </div>
          </div>
        )}

        {/* Controls */}
        <div className="flex flex-col sm:flex-row gap-3 mb-5">
          <div className="flex bg-slate-800/60 border border-slate-700/60 rounded-xl p-1 gap-1">
            {[
              { id: 'employees', label: 'Employees', count: employeeUsers.length },
              { id: 'staff', label: 'Staff', count: staffUsers.length },
            ].map(tab => (
              <button key={tab.id} onClick={() => { setActiveTab(tab.id); setSortBy('name'); setSearch(''); }}
                className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold transition-all ${activeTab === tab.id ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-500/25' : 'text-slate-400 hover:text-white'}`}>
                {tab.label}
                <span className={`px-1.5 py-0.5 rounded-md text-xs ${activeTab === tab.id ? 'bg-indigo-500/50' : 'bg-slate-700 text-slate-500'}`}>{tab.count}</span>
              </button>
            ))}
          </div>

          <div className="flex-1 relative">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500 text-sm">🔍</span>
            <input type="text" value={search} onChange={e => setSearch(e.target.value)}
              placeholder="Search name, email, job role, department…"
              className="w-full pl-9 pr-4 py-2.5 bg-slate-800 border border-slate-700/60 rounded-xl text-white placeholder-slate-500 text-sm focus:outline-none focus:border-indigo-500 transition-colors" />
          </div>

          <div className="flex items-center gap-2 text-slate-500 text-sm whitespace-nowrap">
            <span>{displayedUsers.length} shown</span>
            <button onClick={fetchData} className="flex items-center gap-1 px-2.5 py-1 rounded-lg border border-slate-700/50 bg-slate-800/40 hover:bg-slate-700/50 hover:text-white transition-all text-xs font-medium">
              <span className={loading ? 'animate-spin' : ''}>↻</span> Refresh
            </button>
          </div>
        </div>

        {/* Table */}
        {displayedUsers.length === 0 ? (
          <div className="bg-[#111827] border border-slate-700/40 rounded-2xl p-16 text-center shadow-xl">
            <div className="text-5xl mb-4 opacity-20">👤</div>
            <h3 className="text-lg font-bold text-slate-400 mb-1">{search ? 'No results found' : 'No users yet'}</h3>
            <p className="text-slate-600 text-sm">{search ? 'Try a different search term' : 'Click "+ Add User" to create the first user'}</p>
          </div>
        ) : (
          <div className="bg-[#111827] border border-slate-700/40 rounded-2xl overflow-hidden shadow-xl">
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-slate-800/30 border-b border-slate-700/40">
                  <tr>
                    <th className={thClass}><button onClick={() => handleSort('name')} className={thBtn}>Name <SortIcon column="name" sortBy={sortBy} sortDir={sortDir} /></button></th>
                    <th className={thClass}><button onClick={() => handleSort('email')} className={thBtn}>Email <SortIcon column="email" sortBy={sortBy} sortDir={sortDir} /></button></th>
                    {activeTab === 'employees' ? (
                      <>
                        <th className={thClass}><button onClick={() => handleSort('jobRole')} className={thBtn}>Job Role <SortIcon column="jobRole" sortBy={sortBy} sortDir={sortDir} /></button></th>
                        <th className={thClass}><button onClick={() => handleSort('department')} className={thBtn}>Dept <SortIcon column="department" sortBy={sortBy} sortDir={sortDir} /></button></th>
                        <th className={thClass}><span className={thBtn}>JD</span></th>
                        <th className={thClass}><button onClick={() => handleSort('assignments')} className={thBtn}>Modules <SortIcon column="assignments" sortBy={sortBy} sortDir={sortDir} /></button></th>
                      </>
                    ) : (
                      <>
                        <th className={thClass}><button onClick={() => handleSort('role')} className={thBtn}>Role <SortIcon column="role" sortBy={sortBy} sortDir={sortDir} /></button></th>
                        <th className={thClass}><button onClick={() => handleSort('status')} className={thBtn}>Status <SortIcon column="status" sortBy={sortBy} sortDir={sortDir} /></button></th>
                      </>
                    )}
                    <th className={thClass}><span className={thBtn}>Access</span></th>
                    <th className={`${thClass} text-right pr-5`}><span className="text-xs font-bold text-slate-500 uppercase tracking-wider">Actions</span></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-700/20">
                  {displayedUsers.map(u => {
                    const userAssignments = getUserAssignments(u.userId);
                    const isSelf = u.userId === user?.userId;
                    const hasJD = !!(u.jobDescription || u.jobDescriptionFile);

                    return (
                      <tr key={u.userId} className="hover:bg-slate-800/30 transition-colors group">
                        <td className="py-3 px-4">
                          <button onClick={() => setDetailUser(u)} className="flex items-center gap-3 text-left group/name">
                            <div className={`w-9 h-9 rounded-xl border flex items-center justify-center text-sm font-bold shrink-0 ${getAvatarColor(u.role)}`}>
                              {getAvatarInitials(u.name)}
                            </div>
                            <div>
                              <span className="text-white font-semibold text-sm group-hover/name:text-indigo-300 transition-colors">
                                {u.name}{isSelf && <span className="ml-1.5 text-xs text-slate-500">(you)</span>}
                              </span>
                            </div>
                          </button>
                        </td>
                        <td className="py-3 px-4"><span className="text-slate-400 text-sm">{u.email}</span></td>

                        {activeTab === 'employees' ? (
                          <>
                            <td className="py-3 px-4">
                              {u.jobRole
                                ? <span className="px-2 py-0.5 rounded-lg text-xs font-medium bg-amber-500/15 text-amber-300 border border-amber-500/25">{u.jobRole}</span>
                                : <span className="text-slate-600 text-xs italic">—</span>}
                            </td>
                            <td className="py-3 px-4"><span className="text-slate-400 text-sm">{u.department || '—'}</span></td>
                            <td className="py-3 px-4">
                              {hasJD
                                ? <span className="px-2 py-0.5 rounded-lg text-xs font-medium bg-emerald-500/15 text-emerald-400 border border-emerald-500/25">✓ JD</span>
                                : <span className="px-2 py-0.5 rounded-lg text-xs bg-slate-700/50 text-slate-500 border border-slate-700">No JD</span>}
                            </td>
                            <td className="py-3 px-4">
                              <span className="text-slate-300 text-sm font-medium">{userAssignments.length}</span>
                              <span className="text-slate-600 text-xs ml-1">assigned</span>
                            </td>
                          </>
                        ) : (
                          <>
                            <td className="py-3 px-4">
                              <span className={`px-2.5 py-1 rounded-lg text-xs font-semibold border capitalize ${getRoleBadge(u.role)}`}>{u.role}</span>
                            </td>
                            <td className="py-3 px-4">
                              <span className={`px-2.5 py-1 rounded-lg text-xs font-semibold border capitalize ${getStatusBadge(u.status || 'active')}`}>{u.status || 'active'}</span>
                            </td>
                          </>
                        )}

                        {/* Access column */}
                        <td className="py-3 px-4">
                          <div className="flex flex-wrap gap-1">
                            {(u.accesses || []).length === 0
                              ? <span className="text-slate-600 text-xs">—</span>
                              : (u.accesses || []).map(a => (
                                  <span key={a} className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-cyan-500/15 text-cyan-300 border border-cyan-500/25 capitalize">{a}</span>
                                ))}
                          </div>
                        </td>

                        <td className="py-3 px-4">
                          <div className="flex items-center gap-1.5 justify-end opacity-0 group-hover:opacity-100 transition-opacity">
                            {isAdmin && (
                              <button onClick={() => setManageAccessUser(u)} title="Manage Access" className="w-8 h-8 flex items-center justify-center rounded-lg bg-cyan-600/10 hover:bg-cyan-600/30 text-cyan-400 border border-cyan-600/20 hover:border-cyan-500/40 transition-all text-sm">🔑</button>
                            )}
                            <button onClick={() => setEditUser(u)} title="Edit" className="w-8 h-8 flex items-center justify-center rounded-lg bg-blue-600/10 hover:bg-blue-600/30 text-blue-400 border border-blue-600/20 hover:border-blue-500/40 transition-all text-sm">✏️</button>
                            {!isSelf && (
                              <button onClick={async () => {
                                if (!window.confirm(`Delete "${u.name}"?`)) return;
                                try { await authFetch(`/api/users/${u.userId}`, { method: 'DELETE' }); setUsers(prev => prev.filter(x => x.userId !== u.userId)); setToast({ message: `${u.name} deleted`, type: 'success' }); }
                                catch (err) { setToast({ message: err.message, type: 'error' }); }
                              }} title="Delete" className="w-8 h-8 flex items-center justify-center rounded-lg bg-red-600/10 hover:bg-red-600/30 text-red-400 border border-red-600/20 hover:border-red-500/40 transition-all text-sm">🗑️</button>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div className="px-6 py-3 border-t border-slate-700/30 bg-slate-800/10 flex items-center justify-between">
              <p className="text-xs text-slate-600">
                Showing <span className="text-slate-400 font-semibold">{displayedUsers.length}</span> of{' '}
                <span className="text-slate-400 font-semibold">{activeTab === 'staff' ? staffUsers.length : employeeUsers.length}</span>{' '}
                {activeTab === 'staff' ? 'staff' : 'employees'}
                {lastRefreshed && <span className="ml-3 text-slate-700">· Refreshed {lastRefreshed.toLocaleTimeString()}</span>}
              </p>
              <button onClick={fetchData} className="text-xs text-slate-600 hover:text-slate-400 transition-colors flex items-center gap-1">↻ Refresh</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
