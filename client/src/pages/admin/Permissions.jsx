import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { useNavigate } from 'react-router-dom';
import { authFetch } from '../../utils/authFetch.js';
import { useNotification } from '../../contexts/NotificationContext.jsx';

// ─── Helpers ────────────────────────────────────────────────────────────────

function getAvatarInitials(name) {
  if (!name) return '?';
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0][0]?.toUpperCase() || '?';
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function formatRoleLabel(role) {
  if (!role) return 'Unknown';
  return role.split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
}

// Effective on/off state for one permission key, given the resolved server
// data. "granted"/"revoked" are explicit per-user overrides; anything not in
// either list falls through to the role default.
function getPermState(key, { roleDefaults, granted, revoked }) {
  if (revoked.includes(key)) return 'revoked';
  if (granted.includes(key)) return 'granted';
  if (roleDefaults.includes(key)) return 'default-on';
  return 'default-off';
}

const STATE_STYLES = {
  'default-on':  { active: true,  bg: 'bg-slate-700/40', border: 'border-slate-600/60', text: 'text-slate-200', check: 'bg-slate-600 border-slate-500', suffix: '(default)' },
  granted:       { active: true,  bg: 'bg-emerald-500/10', border: 'border-emerald-500/40', text: 'text-emerald-300', check: 'bg-emerald-500/20 border-emerald-500/50', suffix: '(granted)' },
  revoked:       { active: false, bg: 'bg-red-500/10', border: 'border-red-500/40', text: 'text-red-300', check: 'bg-red-500/20 border-red-500/50', suffix: '(revoked)' },
  'default-off': { active: false, bg: 'bg-slate-900/40', border: 'border-slate-700/50', text: 'text-slate-400', check: 'border-slate-600 bg-slate-800', suffix: '' },
};

// The 3 platform-wide role buckets whose default permission set is editable
// from this page (server: EDITABLE_ROLE_DEFAULT_KEYS in
// server/services/permissions.js — keep in sync).
const ROLE_PRESETS = [
  { key: 'admin',    label: 'Admin',    icon: '🛡️', color: 'indigo' },
  { key: 'manager',  label: 'Manager',  icon: '👔', color: 'purple' },
  { key: 'employee', label: 'Employee', icon: '👤', color: 'cyan' },
];
const PRESET_COLOR_CLASSES = {
  indigo: { border: 'border-indigo-500/50', bg: 'bg-indigo-500/10', text: 'text-indigo-300', btn: 'bg-indigo-600 hover:bg-indigo-500' },
  purple: { border: 'border-purple-500/50', bg: 'bg-purple-500/10', text: 'text-purple-300', btn: 'bg-purple-600 hover:bg-purple-500' },
  cyan:   { border: 'border-cyan-500/50',   bg: 'bg-cyan-500/10',   text: 'text-cyan-300',   btn: 'bg-cyan-600 hover:bg-cyan-500' },
};

export default function Permissions() {
  const { hasRole } = useAuth();
  const navigate = useNavigate();
  const { notify } = useNotification();
  const setToast = useCallback(({ message, type = 'info' }) => notify(message, type), [notify]);

  const [users, setUsers] = useState([]);
  const [catalog, setCatalog] = useState([]);
  const [loadingUsers, setLoadingUsers] = useState(true);
  const [search, setSearch] = useState('');
  const [selectedUser, setSelectedUser] = useState(null);

  const [permData, setPermData] = useState(null); // { role, roleDefaults, granted, revoked, resolved }
  const [loadingPerms, setLoadingPerms] = useState(false);
  const [saving, setSaving] = useState(false);

  // Multi-select: a checkbox per row, independent of the existing "click a
  // row to view that one user's resolved permissions" flow. Selecting 2+
  // users switches the right panel into bulk-edit mode.
  const [bulkSelected, setBulkSelected] = useState(new Set());
  const [bulkMode, setBulkMode] = useState(false);
  // Per-permission 3-state draft for bulk mode: key → 'grant' | 'revoke',
  // absent = unchanged. One plain object (not two separate Sets) so a
  // three-way cycle can be computed atomically from a single previous-state
  // read — there's no single "current" permission state to show when the
  // selected users don't necessarily share the same role/overrides, so bulk
  // mode is an override instruction ("set these ON, set these OFF for
  // everyone selected"), not a view of anyone's existing state.
  const [bulkOverrides, setBulkOverrides] = useState({});
  const [bulkSaving, setBulkSaving] = useState(false);

  // Role-default presets (Admin / Manager / Employee): the platform-wide
  // baseline permission set for each role, editable here and applied
  // instantly to every user of that role (minus their own per-user
  // overrides). Separate from the per-user granted/revoked state above.
  const [roleDefaults, setRoleDefaults] = useState({ admin: [], manager: [], employee: [] });
  const [loadingRoleDefaults, setLoadingRoleDefaults] = useState(true);
  const [editingPreset, setEditingPreset] = useState(null); // role key or null
  const [presetDraft, setPresetDraft] = useState([]);
  const [savingPreset, setSavingPreset] = useState(false);

  useEffect(() => {
    if (!hasRole('admin')) navigate('/dashboard');
  }, [navigate]);

  useEffect(() => {
    (async () => {
      setLoadingUsers(true);
      setLoadingRoleDefaults(true);
      try {
        const [usersRes, catalogRes, roleDefaultsRes] = await Promise.allSettled([
          authFetch('/api/users'),
          authFetch('/api/permissions/catalog'),
          authFetch('/api/permissions/role-defaults'),
        ]);
        if (usersRes.status === 'fulfilled') {
          const u = usersRes.value;
          setUsers(Array.isArray(u) ? u : u?.users || u?.data || []);
        }
        if (catalogRes.status === 'fulfilled') {
          const c = catalogRes.value;
          setCatalog(c?.catalog || []);
        }
        if (roleDefaultsRes.status === 'fulfilled') {
          const r = roleDefaultsRes.value;
          setRoleDefaults({ admin: r?.admin || [], manager: r?.manager || [], employee: r?.employee || [] });
        }
      } catch (e) {
        setToast({ message: 'Failed to load permissions data', type: 'error' });
      } finally {
        setLoadingUsers(false);
        setLoadingRoleDefaults(false);
      }
    })();
  }, []);

  const filteredUsers = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return users;
    return users.filter(u => u.name?.toLowerCase().includes(q) || u.email?.toLowerCase().includes(q));
  }, [users, search]);

  const categories = useMemo(() => {
    const map = {};
    catalog.forEach(p => {
      if (!map[p.category]) map[p.category] = [];
      map[p.category].push(p);
    });
    return map;
  }, [catalog]);

  const allPermissionKeys = useMemo(() => catalog.map(p => p.key), [catalog]);

  const selectUser = async (u) => {
    setSelectedUser(u);
    setPermData(null);
    setLoadingPerms(true);
    try {
      const data = await authFetch(`/api/users/${u.userId}/permissions`);
      setPermData(data);
    } catch (e) {
      setToast({ message: e.message || 'Failed to load user permissions', type: 'error' });
    } finally {
      setLoadingPerms(false);
    }
  };

  // Clicking always toggles the EFFECTIVE on/off state. Whether that means
  // adding to granted or revoked depends on whether the key is a role default.
  const togglePermission = (key) => {
    if (!permData) return;
    const state = getPermState(key, permData);
    setPermData(prev => {
      const granted = new Set(prev.granted);
      const revoked = new Set(prev.revoked);
      if (state === 'default-on') {
        // turning off a role default → revoke it
        revoked.add(key);
      } else if (state === 'granted') {
        // turning off an explicit grant → back to (off) role default
        granted.delete(key);
      } else if (state === 'revoked') {
        // turning back on → clear the revoke, back to (on) role default
        revoked.delete(key);
      } else {
        // default-off → explicitly grant
        granted.add(key);
      }
      return { ...prev, granted: [...granted], revoked: [...revoked] };
    });
  };

  const handleSave = async () => {
    if (!selectedUser || !permData) return;
    setSaving(true);
    try {
      const updated = await authFetch(`/api/users/${selectedUser.userId}/permissions`, {
        method: 'PUT',
        body: JSON.stringify({ granted: permData.granted, revoked: permData.revoked }),
      });
      setPermData(updated);
      setToast({ message: `Permissions updated for ${selectedUser.name}`, type: 'success' });
    } catch (e) {
      setToast({ message: e.message || 'Failed to update permissions', type: 'error' });
    } finally {
      setSaving(false);
    }
  };

  // ── Bulk multi-user selection ─────────────────────────────────────────────
  const toggleBulkSelected = (userId) => {
    setBulkSelected(prev => {
      const next = new Set(prev);
      if (next.has(userId)) next.delete(userId); else next.add(userId);
      return next;
    });
  };

  const openBulkEdit = () => {
    setBulkOverrides({});
    setBulkMode(true);
    setSelectedUser(null);
    setPermData(null);
  };

  // Cycles a permission through: unchanged → grant → revoke → unchanged.
  // One atomic object update, so there's no cross-state-read ordering issue.
  const cycleBulkPermission = (key) => {
    setBulkOverrides(prev => {
      const next = { ...prev };
      if (next[key] === 'grant') next[key] = 'revoke';
      else if (next[key] === 'revoke') delete next[key];
      else next[key] = 'grant';
      return next;
    });
  };

  const handleBulkSave = async () => {
    if (bulkSelected.size === 0) return;
    const bulkGrant = Object.keys(bulkOverrides).filter(k => bulkOverrides[k] === 'grant');
    const bulkRevoke = Object.keys(bulkOverrides).filter(k => bulkOverrides[k] === 'revoke');
    if (bulkGrant.length === 0 && bulkRevoke.length === 0) {
      setToast({ message: 'No permission changes selected', type: 'error' });
      return;
    }
    setBulkSaving(true);
    try {
      const res = await authFetch('/api/users/permissions/bulk', {
        method: 'PUT',
        body: JSON.stringify({
          userIds: [...bulkSelected],
          granted: bulkGrant,
          revoked: bulkRevoke,
        }),
      });
      const failedCount = res?.failed?.length || 0;
      if (failedCount > 0) {
        setToast({ message: `Applied to ${res.succeeded.length} user(s) — ${failedCount} failed (see console for details)`, type: 'error' });
        console.error('[Permissions bulk] Failures:', res.failed);
      } else {
        setToast({ message: `Permissions updated for ${res.succeeded.length} user(s)`, type: 'success' });
        setBulkMode(false);
        setBulkSelected(new Set());
        setBulkOverrides({});
      }
    } catch (e) {
      setToast({ message: e.message || 'Bulk update failed', type: 'error' });
    } finally {
      setBulkSaving(false);
    }
  };

  // ── Role-default presets ────────────────────────────────────────────────
  const openPresetEditor = (role) => {
    setEditingPreset(role);
    setPresetDraft(roleDefaults[role] || []);
  };

  const togglePresetKey = (key) => {
    setPresetDraft(prev => prev.includes(key) ? prev.filter(k => k !== key) : [...prev, key]);
  };

  const savePresetEditor = async () => {
    if (!editingPreset) return;
    setSavingPreset(true);
    try {
      const res = await authFetch(`/api/permissions/role-defaults/${editingPreset}`, {
        method: 'PUT',
        body: JSON.stringify({ granted: presetDraft }),
      });
      setRoleDefaults(prev => ({ ...prev, [editingPreset]: res?.granted || presetDraft }));
      setToast({ message: `Default permissions updated for ${editingPreset}`, type: 'success' });
      setEditingPreset(null);
    } catch (e) {
      setToast({ message: e.message || 'Failed to save role defaults', type: 'error' });
    } finally {
      setSavingPreset(false);
    }
  };

  // Forces the currently-viewed user's EFFECTIVE permission set to exactly
  // match one of the 3 presets, regardless of that user's own base role:
  // explicitly grant everything the preset has and explicitly revoke
  // everything it doesn't. This is a local draft only — Save Permissions
  // still needs to be clicked to persist it, same as any other checkbox edit.
  const applyPresetToUser = (role) => {
    if (!permData) return;
    const desired = new Set(roleDefaults[role] || []);
    const granted = allPermissionKeys.filter(k => desired.has(k));
    const revoked = allPermissionKeys.filter(k => !desired.has(k));
    setPermData(prev => ({ ...prev, granted, revoked }));
    setToast({ message: `Draft set to ${role} defaults — click Save Permissions to apply`, type: 'info' });
  };

  // Same idea for bulk mode — sets every catalog key as an explicit
  // grant/revoke override so all selected users end up with an identical,
  // predictable effective set after Apply, regardless of their own roles.
  const applyPresetToBulk = (role) => {
    const desired = new Set(roleDefaults[role] || []);
    const next = {};
    for (const key of allPermissionKeys) next[key] = desired.has(key) ? 'grant' : 'revoke';
    setBulkOverrides(next);
    setToast({ message: `Draft set to ${role} defaults for all selected — click Apply to save`, type: 'info' });
  };

  return (
    <div className="min-h-screen bg-slate-950 text-white p-6 md:p-8">
      <div className="max-w-6xl mx-auto">
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-white flex items-center gap-2">🔐 Permissions</h1>
          <p className="text-slate-400 text-sm mt-1">Grant or revoke specific platform capabilities per user, on top of their role's defaults.</p>
        </div>

        {/* Role-default presets: platform-wide baseline for Admin / Manager /
            Employee, editable here like Users or Modules manage their own
            records. Every user of that role inherits this set unless they
            have their own per-user grant/revoke override. */}
        <div className="mb-6">
          <h2 className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">Role Default Permissions</h2>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            {ROLE_PRESETS.map(({ key, label, icon, color }) => {
              const c = PRESET_COLOR_CLASSES[color];
              const count = roleDefaults[key]?.length || 0;
              return (
                <div key={key} className={`rounded-2xl border ${c.border} ${c.bg} p-4 flex items-center justify-between`}>
                  <div>
                    <p className={`text-sm font-black ${c.text} flex items-center gap-1.5`}>{icon} {label}</p>
                    <p className="text-xs text-slate-400 mt-0.5">{loadingRoleDefaults ? 'Loading…' : `${count} permission${count !== 1 ? 's' : ''} by default`}</p>
                  </div>
                  <button
                    onClick={() => openPresetEditor(key)}
                    className={`px-3 py-1.5 rounded-lg text-white text-xs font-bold transition-colors flex-shrink-0 ${c.btn}`}
                  >
                    Edit Defaults
                  </button>
                </div>
              );
            })}
          </div>
        </div>

        {bulkSelected.size > 0 && (
          <div className="mb-4 flex items-center justify-between gap-3 bg-indigo-500/10 border border-indigo-500/30 rounded-xl px-4 py-3">
            <p className="text-sm text-indigo-200 font-semibold">{bulkSelected.size} user{bulkSelected.size !== 1 ? 's' : ''} selected</p>
            <div className="flex gap-2">
              <button onClick={openBulkEdit} className="px-4 py-1.5 bg-indigo-600 hover:bg-indigo-500 rounded-lg text-white text-xs font-bold transition-colors">
                Apply Permissions to Selected →
              </button>
              <button onClick={() => { setBulkSelected(new Set()); setBulkMode(false); }} className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 rounded-lg text-slate-300 text-xs font-bold transition-colors">
                Clear
              </button>
            </div>
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-[320px_1fr] gap-6">
          {/* User picker */}
          <div className="bg-slate-900/60 border border-slate-800 rounded-2xl overflow-hidden flex flex-col max-h-[75vh]">
            <div className="p-3 border-b border-slate-800">
              <input
                type="text"
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Search users…"
                aria-label="Search users"
                className="w-full px-3 py-2 bg-slate-950 border border-slate-700 rounded-lg text-sm text-white placeholder-slate-600 focus:outline-none focus:border-indigo-500"
              />
            </div>
            <div className="overflow-y-auto flex-1">
              {loadingUsers ? (
                <div className="p-6 text-center text-slate-500 text-sm">Loading users…</div>
              ) : filteredUsers.length === 0 ? (
                <div className="p-6 text-center text-slate-500 text-sm">No users found</div>
              ) : filteredUsers.map(u => (
                <div
                  key={u.userId}
                  className={`w-full flex items-center gap-2 px-3 py-2.5 border-b border-slate-800/60 transition-colors ${selectedUser?.userId === u.userId && !bulkMode ? 'bg-indigo-500/15' : 'hover:bg-slate-800/60'}`}
                >
                  <input
                    type="checkbox"
                    aria-label={`Select ${u.name}`}
                    checked={bulkSelected.has(u.userId)}
                    onChange={() => toggleBulkSelected(u.userId)}
                    onClick={e => e.stopPropagation()}
                    className="w-4 h-4 rounded border-slate-600 bg-slate-800 accent-indigo-500 flex-shrink-0"
                  />
                  <button
                    onClick={() => selectUser(u)}
                    className="flex-1 flex items-center gap-3 text-left min-w-0"
                  >
                    <div className="w-8 h-8 rounded-full bg-slate-700 flex items-center justify-center text-xs font-bold text-slate-200 flex-shrink-0">
                      {getAvatarInitials(u.name)}
                    </div>
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-white truncate">{u.name}</p>
                      <p className="text-xs text-slate-500 truncate">{formatRoleLabel(u.role)}</p>
                    </div>
                  </button>
                </div>
              ))}
            </div>
          </div>

          {/* Permission checklist */}
          <div className="bg-slate-900/60 border border-slate-800 rounded-2xl p-5 min-h-[300px]">
            {bulkMode ? (
              <>
                <div className="flex items-center justify-between mb-5 pb-4 border-b border-slate-800">
                  <div>
                    <h3 className="text-lg font-bold text-white">Bulk Edit — {bulkSelected.size} user{bulkSelected.size !== 1 ? 's' : ''}</h3>
                    <p className="text-slate-400 text-sm">Click a permission to cycle: unchanged → grant → revoke → unchanged. Only changed permissions are applied.</p>
                  </div>
                  <div className="flex gap-2 flex-shrink-0">
                    <button
                      onClick={() => { setBulkMode(false); setBulkOverrides({}); }}
                      className="px-4 py-2.5 bg-slate-800 hover:bg-slate-700 rounded-xl text-slate-300 font-bold text-sm transition-colors"
                    >
                      Cancel
                    </button>
                    <button
                      onClick={handleBulkSave}
                      disabled={bulkSaving}
                      className="px-5 py-2.5 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 rounded-xl text-white font-bold text-sm transition-colors flex items-center gap-2"
                    >
                      {bulkSaving ? <><span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" /> Applying…</> : `✓ Apply to ${bulkSelected.size} User${bulkSelected.size !== 1 ? 's' : ''}`}
                    </button>
                  </div>
                </div>

                <div className="mb-6 flex items-center gap-3 flex-wrap">
                  <span className="text-xs font-bold text-slate-500 uppercase tracking-wider">Set all selected to:</span>
                  {ROLE_PRESETS.map(({ key, label, icon, color }) => {
                    const c = PRESET_COLOR_CLASSES[color];
                    return (
                      <button
                        key={key}
                        onClick={() => applyPresetToBulk(key)}
                        className={`px-4 py-2 rounded-xl border ${c.border} ${c.bg} ${c.text} font-black text-sm transition-transform hover:scale-105 flex items-center gap-1.5`}
                      >
                        {icon} {label}
                      </button>
                    );
                  })}
                </div>

                <div className="space-y-6">
                  {Object.entries(categories).map(([category, perms]) => (
                    <div key={category}>
                      <h4 className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">{category}</h4>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                        {perms.map(p => {
                          const override = bulkOverrides[p.key];
                          const state = override === 'grant' ? 'granted' : override === 'revoke' ? 'revoked' : 'default-off';
                          const s = STATE_STYLES[state];
                          const suffix = override === 'grant' ? '(will grant)' : override === 'revoke' ? '(will revoke)' : '';
                          return (
                            <button
                              type="button"
                              key={p.key}
                              onClick={() => cycleBulkPermission(p.key)}
                              className={`flex items-start gap-3 p-3 rounded-xl border cursor-pointer transition-all text-left ${override ? s.bg : 'bg-slate-900/40'} ${override ? s.border : 'border-slate-700/50'}`}
                            >
                              <div className={`w-5 h-5 rounded border-2 flex items-center justify-center flex-shrink-0 mt-0.5 transition-all ${override ? s.check : 'border-slate-600 bg-slate-800'}`}>
                                {override === 'grant' && <span className="text-xs text-white font-bold">✓</span>}
                                {override === 'revoke' && <span className="text-xs text-white font-bold">✕</span>}
                              </div>
                              <div className="min-w-0">
                                <p className={`text-sm font-bold ${override ? s.text : 'text-slate-400'}`}>{p.label} {suffix && <span className="text-[10px] font-normal opacity-70">{suffix}</span>}</p>
                                <p className="text-xs text-slate-500 mt-0.5">{p.description}</p>
                              </div>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  ))}
                </div>
              </>
            ) : !selectedUser ? (
              <div className="flex items-center justify-center h-full text-slate-500 text-sm py-16">Select a user to manage their permissions, or check multiple users to bulk-edit</div>
            ) : loadingPerms || !permData ? (
              <div className="flex items-center justify-center h-full text-slate-500 text-sm py-16">Loading permissions…</div>
            ) : (
              <>
                <div className="flex items-center justify-between mb-5 pb-4 border-b border-slate-800">
                  <div>
                    <h3 className="text-lg font-bold text-white">{selectedUser.name}</h3>
                    <p className="text-slate-400 text-sm">{selectedUser.email} · <span className="capitalize">{formatRoleLabel(permData.role)}</span></p>
                  </div>
                  <button
                    onClick={handleSave}
                    disabled={saving}
                    className="px-5 py-2.5 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 rounded-xl text-white font-bold text-sm transition-colors flex items-center gap-2"
                  >
                    {saving ? <><span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" /> Saving…</> : '✓ Save Permissions'}
                  </button>
                </div>

                <div className="mb-6 flex items-center gap-3 flex-wrap">
                  <span className="text-xs font-bold text-slate-500 uppercase tracking-wider">Quick-set to:</span>
                  {ROLE_PRESETS.map(({ key, label, icon, color }) => {
                    const c = PRESET_COLOR_CLASSES[color];
                    return (
                      <button
                        key={key}
                        onClick={() => applyPresetToUser(key)}
                        className={`px-4 py-2 rounded-xl border ${c.border} ${c.bg} ${c.text} font-black text-sm transition-transform hover:scale-105 flex items-center gap-1.5`}
                      >
                        {icon} {label}
                      </button>
                    );
                  })}
                </div>

                <div className="space-y-6">
                  {Object.entries(categories).map(([category, perms]) => (
                    <div key={category}>
                      <h4 className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">{category}</h4>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                        {perms.map(p => {
                          const state = getPermState(p.key, permData);
                          const s = STATE_STYLES[state];
                          return (
                            <label
                              key={p.key}
                              className={`flex items-start gap-3 p-3 rounded-xl border cursor-pointer transition-all ${s.bg} ${s.border}`}
                            >
                              <div className={`w-5 h-5 rounded border-2 flex items-center justify-center flex-shrink-0 mt-0.5 transition-all ${s.active ? s.check : 'border-slate-600 bg-slate-800'}`}>
                                {s.active && <span className="text-xs text-white font-bold">✓</span>}
                              </div>
                              <input type="checkbox" className="hidden" checked={s.active} onChange={() => togglePermission(p.key)} />
                              <div className="min-w-0">
                                <p className={`text-sm font-bold ${s.text}`}>{p.label} {s.suffix && <span className="text-[10px] font-normal opacity-70">{s.suffix}</span>}</p>
                                <p className="text-xs text-slate-500 mt-0.5">{p.description}</p>
                              </div>
                            </label>
                          );
                        })}
                      </div>
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>
        </div>
      </div>

      {/* Role-default preset editor */}
      {editingPreset && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-4" onClick={() => setEditingPreset(null)}>
          <div
            className="bg-slate-900 border border-slate-700 rounded-2xl p-6 max-w-2xl w-full max-h-[85vh] overflow-y-auto"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-5 pb-4 border-b border-slate-800">
              <div>
                <h3 className="text-lg font-bold text-white flex items-center gap-2">
                  {ROLE_PRESETS.find(r => r.key === editingPreset)?.icon} Default Permissions — {ROLE_PRESETS.find(r => r.key === editingPreset)?.label}
                </h3>
                <p className="text-slate-400 text-sm mt-1">Every {editingPreset} user gets these by default, unless overridden per-user.</p>
              </div>
              <div className="flex gap-2 flex-shrink-0">
                <button onClick={() => setEditingPreset(null)} className="px-4 py-2.5 bg-slate-800 hover:bg-slate-700 rounded-xl text-slate-300 font-bold text-sm transition-colors">
                  Cancel
                </button>
                <button
                  onClick={savePresetEditor}
                  disabled={savingPreset}
                  className="px-5 py-2.5 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 rounded-xl text-white font-bold text-sm transition-colors flex items-center gap-2"
                >
                  {savingPreset ? <><span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" /> Saving…</> : '✓ Save Defaults'}
                </button>
              </div>
            </div>

            <div className="space-y-6">
              {Object.entries(categories).map(([category, perms]) => (
                <div key={category}>
                  <h4 className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">{category}</h4>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                    {perms.map(p => {
                      const active = presetDraft.includes(p.key);
                      return (
                        <label
                          key={p.key}
                          className={`flex items-start gap-3 p-3 rounded-xl border cursor-pointer transition-all ${active ? 'bg-emerald-500/10 border-emerald-500/40' : 'bg-slate-900/40 border-slate-700/50'}`}
                        >
                          <div className={`w-5 h-5 rounded border-2 flex items-center justify-center flex-shrink-0 mt-0.5 transition-all ${active ? 'bg-emerald-500/20 border-emerald-500/50' : 'border-slate-600 bg-slate-800'}`}>
                            {active && <span className="text-xs text-white font-bold">✓</span>}
                          </div>
                          <input type="checkbox" className="hidden" checked={active} onChange={() => togglePresetKey(p.key)} />
                          <div className="min-w-0">
                            <p className={`text-sm font-bold ${active ? 'text-emerald-300' : 'text-slate-400'}`}>{p.label}</p>
                            <p className="text-xs text-slate-500 mt-0.5">{p.description}</p>
                          </div>
                        </label>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
