import React, { useState, useEffect, useRef, useMemo } from 'react';
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

  // JD file upload
  const [jdFile, setJdFile] = useState(null);
  const [jdUploading, setJdUploading] = useState(false);
  const [existingJDFile, setExistingJDFile] = useState(user.jobDescriptionFile || null);
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

  const managers = useMemo(() => users.filter(u => u.role === 'manager' && u.userId !== user.userId), [users, user.userId]);
  const isEmployee = form.role === 'employee';
  const isAdmin = currentUserRole === 'admin';

  useEffect(() => {
    if (user.role !== 'employee') return;
    authFetch(`/api/assignments/employee/${user.userId}/manager`)
      .then(d => { if (d?.managerId || d?.userId) { const id = d.managerId || d.userId; setCurrentManagerId(id); setAssignManagerId(id); } })
      .catch(() => {});
  }, [user.userId, user.role]);

  const f = (key) => (e) => setForm(prev => ({ ...prev, [key]: e.target.value }));

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

      // Upload JD file if selected
      if (jdFile) {
        await handleJDUpload();
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
        isFile: true, // skip Content-Type header so browser sets multipart boundary
        body: fd,
      });
      setExistingJDFile(result?.jobDescriptionFile || null);
      setJdFile(null);
      if (fileInputRef.current) fileInputRef.current.value = '';
      setToast({ message: 'JD file uploaded', type: 'success' });
    } catch (err) {
      setToast({ message: `Upload failed: ${err.message}`, type: 'error' });
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
  ];

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
                  <FieldLabel>Job Role</FieldLabel>
                  <input type="text" value={form.jobRole} onChange={f('jobRole')} className={inputCls} placeholder="e.g. Frontend Developer" />
                </div>
                <div>
                  <FieldLabel>Department</FieldLabel>
                  <input type="text" value={form.department} onChange={f('department')} className={inputCls} placeholder="e.g. Engineering" />
                </div>
              </div>

              <div>
                <FieldLabel>Company Name</FieldLabel>
                <input type="text" value={form.companyName} onChange={f('companyName')} className={inputCls} placeholder="e.g. Acme Corp" />
              </div>
            </>
          )}

          {/* ── JD TAB ── */}
          {activeSection === 'jd' && (
            <div className="space-y-5">
              {/* Notice */}
              <div className="flex items-start gap-3 p-3 bg-indigo-500/10 border border-indigo-500/30 rounded-xl text-sm text-indigo-300">
                <span className="text-lg">💡</span>
                <p>The Job Description is used to generate <strong>unique, role-specific assessment questions</strong> and training modules for this employee.</p>
              </div>

              {/* Job Role (quick edit also available here) */}
              <div>
                <FieldLabel>Job Role</FieldLabel>
                <input type="text" value={form.jobRole} onChange={f('jobRole')} className={inputCls} placeholder="e.g. Senior React Developer" />
              </div>

              {/* JD Text */}
              <div>
                <FieldLabel>Job Description (Text)</FieldLabel>
                <textarea
                  value={form.jobDescription}
                  onChange={f('jobDescription')}
                  rows={8}
                  className={`${inputCls} resize-y min-h-[120px] font-mono text-xs leading-relaxed`}
                  placeholder="Paste the full Job Description here. No character limit. The more detail, the better the AI-generated assessments…"
                />
                <p className="text-slate-600 text-xs mt-1">{form.jobDescription.length} characters · No limit</p>
              </div>

              {/* JD File Upload */}
              <div>
                <FieldLabel>Upload JD File</FieldLabel>
                <p className="text-slate-500 text-xs mb-2">Accepts PDF, DOCX, DOC, TXT, RTF — up to 50MB. Replaces the previous file.</p>

                {/* Existing file */}
                {existingJDFile && (
                  <div className="flex items-center gap-3 p-3 mb-3 bg-slate-900/60 rounded-xl border border-slate-700/60">
                    <span className="text-2xl">📎</span>
                    <div className="flex-1 min-w-0">
                      <p className="text-white text-sm font-medium truncate">{existingJDFile.name}</p>
                      <p className="text-slate-500 text-xs">{formatBytes(existingJDFile.size)} · Uploaded {formatDate(existingJDFile.uploadedAt)}</p>
                    </div>
                    <span className="text-xs bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 px-2 py-0.5 rounded-full">Active</span>
                  </div>
                )}

                {/* File picker */}
                <div
                  onClick={() => fileInputRef.current?.click()}
                  className={`border-2 border-dashed rounded-xl p-5 text-center cursor-pointer transition-colors
                    ${jdFile ? 'border-indigo-500 bg-indigo-500/10' : 'border-slate-600 hover:border-slate-500 bg-slate-900/40 hover:bg-slate-900/60'}`}
                >
                  {jdFile ? (
                    <>
                      <p className="text-indigo-300 font-semibold text-sm">{jdFile.name}</p>
                      <p className="text-slate-500 text-xs mt-1">{formatBytes(jdFile.size)} · Click to change</p>
                    </>
                  ) : (
                    <>
                      <p className="text-4xl mb-2">📂</p>
                      <p className="text-slate-300 text-sm font-semibold">Click to choose file</p>
                      <p className="text-slate-600 text-xs mt-1">PDF, DOCX, TXT and more</p>
                    </>
                  )}
                </div>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".pdf,.doc,.docx,.txt,.rtf,.odt"
                  className="hidden"
                  onChange={e => { if (e.target.files[0]) setJdFile(e.target.files[0]); }}
                />

                {/* Upload button (standalone) */}
                {jdFile && (
                  <button
                    onClick={handleJDUpload}
                    disabled={jdUploading}
                    className="mt-3 w-full py-2.5 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 rounded-xl text-white font-bold text-sm transition-colors flex items-center justify-center gap-2"
                  >
                    {jdUploading ? (
                      <><span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" /> Uploading…</>
                    ) : (
                      '⬆ Upload JD File Now'
                    )}
                  </button>
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
  const f = (key) => (e) => setForm(prev => ({ ...prev, [key]: e.target.value }));

  const handleCreate = async () => {
    if (!form.name.trim() || !form.email.trim()) { setToast({ message: 'Name and email are required', type: 'error' }); return; }
    setSaving(true);
    try {
      const user = await authFetch('/api/users', {
        method: 'POST',
        body: JSON.stringify({ ...form, name: form.name.trim(), email: form.email.trim() }),
      });
      setToast({ message: `User "${form.name}" created successfully`, type: 'success' });
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
              <input type="text" value={form.jobRole} onChange={f('jobRole')} className={inputCls} placeholder="e.g. Developer" />
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
          <div className="flex items-start gap-2 text-xs text-slate-500 bg-slate-900/50 rounded-xl p-3">
            <span>🔑</span>
            <span>A temporary password will be auto-generated and shown after creation. Share it with the user to let them log in and change it.</span>
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

// ─── Temp Password Modal ──────────────────────────────────────────────────────

function TempPasswordModal({ user, onClose }) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    navigator.clipboard.writeText(user.tempPassword || '');
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };
  return (
    <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-[100] p-4">
      <div className="bg-slate-800 border border-slate-700/80 rounded-2xl w-full max-w-sm p-6 shadow-2xl text-center">
        <div className="text-4xl mb-3">🔑</div>
        <h3 className="text-lg font-bold text-white mb-1">User Created!</h3>
        <p className="text-slate-400 text-sm mb-4">Share this temporary password with <span className="text-white font-semibold">{user.name}</span>:</p>
        <div className="bg-slate-900 rounded-xl p-3 font-mono text-amber-300 text-sm tracking-widest mb-4 border border-amber-500/30">
          {user.tempPassword}
        </div>
        <p className="text-slate-500 text-xs mb-4">⚠️ This is shown only once. The user should change it after first login.</p>
        <div className="flex gap-3">
          <button onClick={copy} className={`flex-1 py-2.5 rounded-xl font-bold text-sm transition-colors ${copied ? 'bg-emerald-600 text-white' : 'bg-indigo-600 hover:bg-indigo-500 text-white'}`}>
            {copied ? '✓ Copied!' : '📋 Copy Password'}
          </button>
          <button onClick={onClose} className="px-4 py-2.5 bg-slate-700 hover:bg-slate-600 rounded-xl text-slate-300 text-sm transition-colors">Done</button>
        </div>
      </div>
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function UserManagement() {
  const { user, hasRole } = useAuth();
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
  const [tempPasswordUser, setTempPasswordUser] = useState(null);

  const isAdmin = hasRole('admin');
  const isManager = user?.role === 'manager';
  const currentUserRole = user?.role;

  useEffect(() => {
    if (!isAdmin && !isManager) navigate('/dashboard');
  }, [isAdmin, isManager, navigate]);

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
    } catch { setToast({ message: 'Failed to load data', type: 'error' }); }
    finally { setLoading(false); }
  };

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 30_000);
    return () => clearInterval(interval);
  }, []);

  const staffUsers = useMemo(() => users.filter(u => u.role === 'admin' || u.role === 'manager'), [users]);
  const employeeUsers = useMemo(() => users.filter(u => u.role === 'employee'), [users]);

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
    if (newUser.tempPassword) setTempPasswordUser(newUser);
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
      {tempPasswordUser && (
        <TempPasswordModal user={tempPasswordUser} onClose={() => setTempPasswordUser(null)} />
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
              {/* Create button */}
              <button onClick={() => setShowCreate(true)}
                className="flex items-center gap-2 px-4 py-2.5 bg-indigo-600 hover:bg-indigo-500 rounded-xl text-white font-bold text-sm transition-colors shadow-lg shadow-indigo-500/20">
                ➕ Add User
              </button>
            </div>
          </div>
        </div>

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

                        <td className="py-3 px-4">
                          <div className="flex items-center gap-1.5 justify-end opacity-0 group-hover:opacity-100 transition-opacity">
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
