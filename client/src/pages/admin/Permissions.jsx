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

  useEffect(() => {
    if (!hasRole('admin')) navigate('/dashboard');
  }, [navigate]);

  useEffect(() => {
    (async () => {
      setLoadingUsers(true);
      try {
        const [usersRes, catalogRes] = await Promise.allSettled([
          authFetch('/api/users'),
          authFetch('/api/permissions/catalog'),
        ]);
        if (usersRes.status === 'fulfilled') {
          const u = usersRes.value;
          setUsers(Array.isArray(u) ? u : u?.users || u?.data || []);
        }
        if (catalogRes.status === 'fulfilled') {
          const c = catalogRes.value;
          setCatalog(c?.catalog || []);
        }
      } catch (e) {
        setToast({ message: 'Failed to load permissions data', type: 'error' });
      } finally {
        setLoadingUsers(false);
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

  return (
    <div className="min-h-screen bg-slate-950 text-white p-6 md:p-8">
      <div className="max-w-6xl mx-auto">
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-white flex items-center gap-2">🔐 Permissions</h1>
          <p className="text-slate-400 text-sm mt-1">Grant or revoke specific platform capabilities per user, on top of their role's defaults.</p>
        </div>

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
                <button
                  key={u.userId}
                  onClick={() => selectUser(u)}
                  className={`w-full flex items-center gap-3 px-3 py-2.5 text-left border-b border-slate-800/60 transition-colors ${selectedUser?.userId === u.userId ? 'bg-indigo-500/15' : 'hover:bg-slate-800/60'}`}
                >
                  <div className="w-8 h-8 rounded-full bg-slate-700 flex items-center justify-center text-xs font-bold text-slate-200 flex-shrink-0">
                    {getAvatarInitials(u.name)}
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-white truncate">{u.name}</p>
                    <p className="text-xs text-slate-500 truncate">{formatRoleLabel(u.role)}</p>
                  </div>
                </button>
              ))}
            </div>
          </div>

          {/* Permission checklist */}
          <div className="bg-slate-900/60 border border-slate-800 rounded-2xl p-5 min-h-[300px]">
            {!selectedUser ? (
              <div className="flex items-center justify-center h-full text-slate-500 text-sm py-16">Select a user to manage their permissions</div>
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
    </div>
  );
}
