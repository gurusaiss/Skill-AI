import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { useNotification } from '../../contexts/NotificationContext.jsx';
import { authFetch } from '../../utils/authFetch.js';

function downloadJson(data, filename) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function downloadCsv(rows, headers, filename) {
  const escape = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const lines = [headers.join(','), ...rows.map(r => headers.map(h => escape(r[h])).join(','))];
  const blob = new Blob([lines.join('\n')], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export default function Settings() {
  const { user, hasRole, logout } = useAuth();
  const navigate = useNavigate();

  // redirect if not admin
  useEffect(() => {
    if (!user || !hasRole('admin')) {
      navigate('/dashboard');
    }
  }, [user, hasRole, navigate]);

  const { success, error: notifyError } = useNotification();
  const [activeSection, setActiveSection] = useState('general');
  const [saving, setSaving] = useState(false);
  const [exporting, setExporting] = useState(null); // which export button is in flight
  const [auditLogs, setAuditLogs] = useState([]);
  const [auditLoading, setAuditLoading] = useState(false);
  const [auditLimit, setAuditLimit] = useState(50);
  const [auditEventType, setAuditEventType] = useState('');
  const [settingsLoaded, setSettingsLoaded] = useState(false);
  const [general, setGeneral] = useState({});
  const [security, setSecurity] = useState({});
  const [notifications, setNotifications] = useState({});
  const [healthInfo, setHealthInfo] = useState(null);

  useEffect(() => {
    authFetch('/api/settings')
      .then(res => {
        const data = res?.data ?? res;
        if (data) {
          setGeneral(data.general || {});
          setSecurity(data.security || {});
          setNotifications(data.notifications || {});
        }
      })
      .catch(() => notifyError('Failed to load settings — showing defaults'))
      .finally(() => setSettingsLoaded(true));
  }, []);

  useEffect(() => {
    if (activeSection !== 'agents' && activeSection !== 'integrations') return;
    authFetch('/api/health').then(setHealthInfo).catch(() => {});
  }, [activeSection]);

  const [activeUserCount, setActiveUserCount] = useState(null);
  useEffect(() => {
    if (activeSection !== 'billing') return;
    authFetch('/api/users')
      .then(res => {
        const data = res?.data ?? res;
        const list = data?.users || (Array.isArray(data) ? data : []);
        setActiveUserCount(list.filter(u => u.status !== 'inactive').length);
      })
      .catch(() => {});
  }, [activeSection]);

  const saveSection = (section, values) => {
    setSaving(true);
    authFetch(`/api/settings/${section}`, { method: 'PUT', body: JSON.stringify(values) })
      .then(() => success('Settings saved.'))
      .catch(err => notifyError(err.message || 'Failed to save settings'))
      .finally(() => setSaving(false));
  };

  useEffect(() => {
    if (activeSection !== 'audit') return;
    let cancelled = false;
    setAuditLoading(true);
    const qs = new URLSearchParams({ limit: String(auditLimit) });
    if (auditEventType) qs.set('eventType', auditEventType);
    authFetch(`/api/audit/logs?${qs.toString()}`)
      .then(res => { if (!cancelled) setAuditLogs(res?.logs || []); })
      .catch(() => { if (!cancelled) notifyError('Failed to load audit log'); })
      .finally(() => { if (!cancelled) setAuditLoading(false); });
    return () => { cancelled = true; };
  }, [activeSection, auditLimit, auditEventType]);

  const auditEventTypes = [...new Set(auditLogs.map(r => r.eventType).filter(Boolean))].sort();

  // Must come after every hook above — calling hooks conditionally (i.e.
  // after an early return) violates the Rules of Hooks and crashes the page
  // with a "change in the order of Hooks" error the moment `user` flips from
  // not-yet-loaded to loaded across renders, which this early return used to
  // sit above.
  if (!user || !hasRole('admin')) return null;

  const runExport = async (kind, fn) => {
    setExporting(kind);
    try {
      await fn();
      success('Export downloaded.');
    } catch (err) {
      notifyError(err.message || 'Export failed');
    } finally {
      setExporting(null);
    }
  };

  const handleDownloadFullBackup = () => runExport('full', async () => {
    const data = await authFetch('/api/admin/export');
    downloadJson(data, `skillforge-backup-${new Date().toISOString().slice(0, 10)}.json`);
  });

  const handleExportUsersCsv = () => runExport('users', async () => {
    const data = await authFetch('/api/admin/export');
    downloadCsv(
      data.users || [],
      ['userId', 'name', 'email', 'role', 'jobRole', 'department', 'status', 'createdAt'],
      `skillforge-users-${new Date().toISOString().slice(0, 10)}.csv`
    );
  });

  const handleExportModulesJson = () => runExport('modules', async () => {
    const data = await authFetch('/api/admin/export');
    downloadJson(data.modules || [], `skillforge-modules-${new Date().toISOString().slice(0, 10)}.json`);
  });

  const sections = [
    { id: 'general',        label: 'General',       icon: '⚙️',  desc: 'Platform name, logo, and default settings' },
    { id: 'security',       label: 'Security',      icon: '🔐',  desc: 'Password policy, 2FA, session timeout' },
    { id: 'notifications',  label: 'Notifications', icon: '🔔',  desc: 'Email and in-app notification preferences' },
    { id: 'agents',         label: 'Agent System',  icon: '🤖',  desc: '9-agent pipeline, model selection, temperature' },
    { id: 'integrations',   label: 'Integrations',  icon: '🔗',  desc: 'Supabase, OpenAI, Google OAuth, SMTP' },
    { id: 'billing',        label: 'Billing',       icon: '💳',  desc: 'Subscription plans, usage quotas, invoices' },
    { id: 'audit',          label: 'Audit Log',     icon: '📋',  desc: 'Full system event log and change history' },
    { id: 'backup',         label: 'Backup & Restore', icon: '💾', desc: 'Database snapshots, import / export' },
  ];

  return (
    <div className="min-h-screen bg-[#0F172A] text-white px-4 sm:px-6 py-8 max-w-7xl mx-auto">
      <div className="mb-8">
        <button onClick={() => navigate('/admin/dashboard')} className="text-slate-400 hover:text-white text-sm mb-3 flex items-center gap-2">
          ← Back to Admin Dashboard
        </button>
        <h1 className="text-3xl font-black text-white mb-1">Settings</h1>
        <p className="text-slate-400 text-sm">Platform configuration — all changes are system-wide.</p>
      </div>

      <div className="grid lg:grid-cols-[240px_1fr] gap-6">
        {/* Left sidebar — section list */}
        <div className="space-y-1">
          {sections.map(s => (
            <button
              key={s.id}
              onClick={() => setActiveSection(s.id)}
              className={`w-full text-left flex items-center gap-2.5 px-3.5 py-2.5 rounded-xl text-sm font-semibold transition-all ${
                activeSection === s.id
                  ? 'bg-indigo-600/20 text-indigo-300 border border-indigo-500/30'
                  : 'text-slate-400 hover:text-white hover:bg-slate-800/60 border border-transparent'
              }`}
            >
              <span>{s.icon}</span>
              {s.label}
            </button>
          ))}
        </div>

        {/* Right panel — section content */}
        <div className="space-y-5">
          {activeSection === 'general' && (
            <div className="space-y-5">
              <div className="rounded-2xl border border-slate-700/50 bg-slate-800/30 p-6">
                <h2 className="text-lg font-black text-white mb-1">General Settings</h2>
                <p className="text-sm text-slate-400 mb-6">Core platform identity and default preferences.</p>

                <div className="space-y-4">
                  <div>
                    <label className="block text-xs font-bold text-slate-400 uppercase mb-1.5">Platform Name</label>
                    <input type="text" value={general.platformName ?? ''} onChange={(e) => setGeneral(g => ({ ...g, platformName: e.target.value }))} className="w-full px-4 py-2.5 rounded-xl bg-slate-900 border border-slate-700 text-white text-sm" />
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-slate-400 uppercase mb-1.5">Tagline</label>
                    <input type="text" value={general.tagline ?? ''} onChange={(e) => setGeneral(g => ({ ...g, tagline: e.target.value }))} className="w-full px-4 py-2.5 rounded-xl bg-slate-900 border border-slate-700 text-white text-sm" />
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-slate-400 uppercase mb-1.5">Support Email</label>
                    <input type="email" value={general.supportEmail ?? ''} onChange={(e) => setGeneral(g => ({ ...g, supportEmail: e.target.value }))} className="w-full px-4 py-2.5 rounded-xl bg-slate-900 border border-slate-700 text-white text-sm" />
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-slate-400 uppercase mb-1.5">Default User Role</label>
                    <select value={general.defaultUserRole ?? 'employee'} onChange={(e) => setGeneral(g => ({ ...g, defaultUserRole: e.target.value }))} className="w-full px-4 py-2.5 rounded-xl bg-slate-900 border border-slate-700 text-white text-sm">
                      <option value="employee">Employee</option>
                      <option value="manager">Manager</option>
                      <option value="admin">Admin</option>
                    </select>
                  </div>
                  <div className="flex items-center justify-between rounded-xl bg-slate-900/50 border border-slate-700/40 p-4">
                    <div>
                      <p className="text-sm font-semibold text-white">Maintenance Mode</p>
                      <p className="text-xs text-slate-500">Flag stored for reference — not yet wired to block requests</p>
                    </div>
                    <button
                      onClick={() => setGeneral(g => ({ ...g, maintenanceMode: !g.maintenanceMode }))}
                      className={`px-4 py-1.5 rounded-lg text-xs font-bold ${general.maintenanceMode ? 'bg-amber-600/80 text-white hover:bg-amber-600' : 'bg-slate-700 text-slate-300 hover:bg-slate-600'}`}
                    >
                      {general.maintenanceMode ? 'ON' : 'OFF'}
                    </button>
                  </div>
                </div>

                <div className="mt-6 flex justify-end">
                  <button onClick={() => saveSection('general', general)} disabled={saving || !settingsLoaded} className="px-6 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-bold transition-all disabled:opacity-50">
                    {saving ? '⏳ Saving…' : 'Save Changes'}
                  </button>
                </div>
              </div>
            </div>
          )}

          {activeSection === 'security' && (
            <div className="space-y-5">
              <div className="rounded-2xl border border-slate-700/50 bg-slate-800/30 p-6">
                <h2 className="text-lg font-black text-white mb-1">Security Settings</h2>
                <p className="text-sm text-slate-400 mb-2">Authentication, sessions, and access control policies.</p>
                <p className="text-xs text-amber-400/80 mb-6">
                  Strong-password rules and login rate-limiting are always enforced platform-wide regardless of these
                  toggles. 2FA, single-session, and IP-whitelist policies aren't built yet — these are saved for
                  reference and future rollout.
                </p>

                <div className="space-y-4">
                  {[
                    { key: 'require2FAForAdmins',      label: 'Require 2FA for Admins',   desc: 'Force two-factor authentication for all admin accounts' },
                    { key: 'enforceStrongPasswords',    label: 'Enforce Strong Passwords', desc: 'Minimum 8 chars, uppercase, number, and symbol required' },
                    { key: 'singleSessionPerUser',      label: 'Single Session per User',  desc: 'Invalidate older sessions when a user logs in again' },
                    { key: 'autoLogoutOnInactivity',    label: 'Auto-logout after Inactivity', desc: 'End sessions after the configured timeout' },
                    { key: 'ipWhitelist',               label: 'IP Whitelist',             desc: 'Restrict admin access to approved IP ranges' },
                  ].map(item => (
                    <label key={item.key} className="flex items-center justify-between rounded-xl bg-slate-900/50 border border-slate-700/40 p-4 cursor-pointer">
                      <div>
                        <p className="text-sm font-semibold text-white">{item.label}</p>
                        <p className="text-xs text-slate-500 mt-0.5">{item.desc}</p>
                      </div>
                      <input
                        type="checkbox"
                        checked={!!security[item.key]}
                        onChange={(e) => setSecurity(s => ({ ...s, [item.key]: e.target.checked }))}
                        className="w-5 h-5 rounded border-slate-700 bg-slate-800 text-indigo-500 focus:ring-indigo-500"
                      />
                    </label>
                  ))}

                  <div>
                    <label className="block text-xs font-bold text-slate-400 uppercase mb-1.5">Session Timeout (minutes)</label>
                    <input
                      type="number"
                      value={security.sessionTimeoutMinutes ?? 60}
                      onChange={(e) => setSecurity(s => ({ ...s, sessionTimeoutMinutes: Number(e.target.value) }))}
                      className="w-full px-4 py-2.5 rounded-xl bg-slate-900 border border-slate-700 text-white text-sm"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-bold text-slate-400 uppercase mb-1.5">Max Login Attempts</label>
                    <input
                      type="number"
                      value={security.maxLoginAttempts ?? 5}
                      onChange={(e) => setSecurity(s => ({ ...s, maxLoginAttempts: Number(e.target.value) }))}
                      className="w-full px-4 py-2.5 rounded-xl bg-slate-900 border border-slate-700 text-white text-sm"
                    />
                  </div>
                </div>

                <div className="mt-6 flex justify-end">
                  <button onClick={() => saveSection('security', security)} disabled={saving || !settingsLoaded} className="px-6 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-bold transition-all disabled:opacity-50">
                    {saving ? '⏳ Saving…' : 'Save Changes'}
                  </button>
                </div>
              </div>
            </div>
          )}

          {activeSection === 'notifications' && (
            <div className="space-y-5">
              <div className="rounded-2xl border border-slate-700/50 bg-slate-800/30 p-6">
                <h2 className="text-lg font-black text-white mb-1">Notification Settings</h2>
                <p className="text-sm text-slate-400 mb-2">Control which events trigger email or in-app notifications.</p>
                <p className="text-xs text-amber-400/80 mb-6">
                  "Manager Request Pending" is already sent unconditionally today. The others aren't wired to a
                  trigger yet — these toggles are saved for when they are.
                </p>

                <div className="space-y-4">
                  {[
                    { key: 'newUserRegistered',    label: 'New User Registered',       desc: 'Alert admins when a new user signs up' },
                    { key: 'moduleCreated',        label: 'Module Created',             desc: 'Notify managers when a new module is published' },
                    { key: 'assignmentCompleted',  label: 'Assignment Completed',       desc: 'Employee finishes a module or session' },
                    { key: 'quizScoreBelow60',     label: 'Quiz Score Below 60%',       desc: 'Alert employee and their manager on poor performance' },
                    { key: 'managerRequestPending',label: 'Manager Request Pending',    desc: 'Alert admin when a manager requests a new assignment' },
                    { key: 'weeklyDigest',         label: 'Weekly Digest',              desc: 'Send a weekly summary of team activity to all managers' },
                  ].map(item => (
                    <label key={item.key} className="flex items-center justify-between rounded-xl bg-slate-900/50 border border-slate-700/40 p-4 cursor-pointer">
                      <div>
                        <p className="text-sm font-semibold text-white">{item.label}</p>
                        <p className="text-xs text-slate-500 mt-0.5">{item.desc}</p>
                      </div>
                      <input
                        type="checkbox"
                        checked={!!notifications[item.key]}
                        onChange={(e) => setNotifications(n => ({ ...n, [item.key]: e.target.checked }))}
                        className="w-5 h-5 rounded border-slate-700 bg-slate-800 text-indigo-500 focus:ring-indigo-500"
                      />
                    </label>
                  ))}
                </div>

                <div className="mt-6 flex justify-end">
                  <button onClick={() => saveSection('notifications', notifications)} disabled={saving || !settingsLoaded} className="px-6 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-bold transition-all disabled:opacity-50">
                    {saving ? '⏳ Saving…' : 'Save Changes'}
                  </button>
                </div>
              </div>
            </div>
          )}

          {activeSection === 'agents' && (
            <div className="space-y-5">
              <div className="rounded-2xl border border-slate-700/50 bg-slate-800/30 p-6">
                <h2 className="text-lg font-black text-white mb-1">Agent System Status</h2>
                <p className="text-sm text-slate-400 mb-6">
                  Live status of the deployed agent pipeline — read-only. Per-agent temperature and model choice are
                  fixed by the server deployment, not configurable per company.
                </p>

                {!healthInfo ? (
                  <p className="text-sm text-slate-500">Loading live status…</p>
                ) : (
                  <>
                    <div className="grid sm:grid-cols-3 gap-4 mb-5">
                      <div className="rounded-xl border border-slate-700/40 bg-slate-900/50 p-4 text-center">
                        <p className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-1">Active Agents</p>
                        <p className="text-xl font-black text-white">{healthInfo.agentCount ?? '—'}</p>
                      </div>
                      <div className="rounded-xl border border-slate-700/40 bg-slate-900/50 p-4 text-center">
                        <p className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-1">Primary Model</p>
                        <p className="text-sm font-black text-white break-all">{healthInfo.model ?? '—'}</p>
                      </div>
                      <div className="rounded-xl border border-slate-700/40 bg-slate-900/50 p-4 text-center">
                        <p className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-1">Gemini Keys</p>
                        <p className="text-xl font-black text-white">{healthInfo.geminiKeys ?? '—'}</p>
                      </div>
                    </div>
                    <div className="space-y-2">
                      {(healthInfo.agents || []).map(name => (
                        <div key={name} className="flex items-center justify-between rounded-xl bg-slate-900/50 border border-slate-700/40 p-3.5">
                          <p className="text-sm font-bold text-indigo-300">{name}</p>
                          <span className="text-xs font-bold uppercase px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-300 border border-emerald-500/30">Active</span>
                        </div>
                      ))}
                    </div>
                    <div className="mt-4 flex items-center gap-3 text-xs text-slate-500">
                      <span>Groq fallback: <strong className={healthInfo.groq?.startsWith('enabled') ? 'text-emerald-400' : 'text-slate-400'}>{healthInfo.groq}</strong></span>
                      <span>·</span>
                      <span>Cerebras: <strong className={healthInfo.cerebras === 'enabled' ? 'text-emerald-400' : 'text-slate-400'}>{healthInfo.cerebras}</strong></span>
                    </div>
                  </>
                )}
              </div>
            </div>
          )}

          {activeSection === 'integrations' && (
            <div className="space-y-5">
              <div className="rounded-2xl border border-slate-700/50 bg-slate-800/30 p-6">
                <h2 className="text-lg font-black text-white mb-1">Integrations</h2>
                <p className="text-sm text-slate-400 mb-6">Live connection status — read-only. Credentials are set via server environment variables, not this UI.</p>

                {[
                  { name: 'Database',          live: healthInfo && (healthInfo.db === 'supabase'),               desc: healthInfo ? (healthInfo.db === 'supabase' ? 'Supabase (primary)' : 'File-based fallback — SUPABASE_URL not set') : 'Checking…', icon: '🗄️' },
                  { name: 'LLM Provider',      live: healthInfo?.integrations?.llm,                              desc: healthInfo ? `${healthInfo.model || 'model'} · Groq: ${healthInfo.groq} · Cerebras: ${healthInfo.cerebras}` : 'Checking…', icon: '🧠' },
                  { name: 'Google OAuth',      live: healthInfo?.integrations?.googleOAuth,                      desc: 'Social login for users',                      icon: '🔑' },
                  { name: 'SMTP (Email)',      live: healthInfo?.integrations?.smtp,                             desc: 'Transaction and notification emails',         icon: '📧' },
                  { name: 'Stripe / Billing',  live: false,                                                      desc: 'Subscription and invoice payments — not built yet', icon: '💳' },
                  { name: 'Slack / Teams',     live: false,                                                      desc: 'Push notifications to team channels — not built yet', icon: '💬' },
                ].map(intg => ({
                  ...intg,
                  status: !healthInfo ? '…' : intg.live ? 'Connected' : 'Not Configured',
                  color: !healthInfo ? 'text-slate-500' : intg.live ? 'text-emerald-400' : 'text-red-400',
                })).map(intg => (
                  <div key={intg.name} className="flex items-center justify-between rounded-xl bg-slate-900/50 border border-slate-700/40 p-4 mb-3">
                    <div className="flex items-center gap-3">
                      <span className="text-2xl">{intg.icon}</span>
                      <div>
                        <p className="text-sm font-semibold text-white">{intg.name}</p>
                        <p className="text-xs text-slate-500 mt-0.5">{intg.desc}</p>
                      </div>
                    </div>
                    <span className={`text-xs font-bold uppercase ${intg.color}`}>{intg.status}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {activeSection === 'billing' && (
            <div className="space-y-5">
              <div className="rounded-2xl border border-slate-700/50 bg-slate-800/30 p-6">
                <h2 className="text-lg font-black text-white mb-1">Billing & Plans</h2>
                <p className="text-sm text-slate-400 mb-2">No payment provider is integrated yet — this page is informational.</p>
                <p className="text-xs text-slate-500 mb-6">Active Users reflects your real company headcount; Plan and Billing Period below are placeholders until a billing provider (e.g. Stripe) is connected.</p>

                <div className="grid sm:grid-cols-3 gap-4 mb-6">
                  {[
                    { label: 'Current Plan', value: 'Enterprise', badge: 'bg-purple-500/20 text-purple-300 border-purple-500/30' },
                    { label: 'Active Users',  value: activeUserCount ?? '…', badge: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30' },
                    { label: 'Billing Period', value: 'Monthly',  badge: 'bg-indigo-500/20 text-indigo-300 border-indigo-500/30' },
                  ].map(m => (
                    <div key={m.label} className="rounded-xl border border-slate-700/40 bg-slate-900/50 p-5 text-center">
                      <p className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-1">{m.label}</p>
                      <p className="text-xl font-black text-white">{m.value}</p>
                    </div>
                  ))}
                </div>

                {[
                  { plan: 'Starter', price: '$29 / mo', limit: 'Up to 25 users', active: false },
                  { plan: 'Professional', price: '$79 / mo', limit: 'Up to 100 users', active: false },
                  { plan: 'Enterprise', price: 'Custom', limit: 'Unlimited', active: true },
                ].map(p => (
                  <div key={p.plan} className={`rounded-xl border p-4 mb-3 ${p.active ? 'border-indigo-500/50 bg-indigo-500/5' : 'border-slate-700/40 bg-slate-900/50'}`}>
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-sm font-bold text-white">{p.plan}</p>
                        <p className="text-xs text-slate-500 mt-0.5">{p.price} · {p.limit}</p>
                      </div>
                      {p.active
                        ? <span className="text-xs font-bold uppercase px-2.5 py-1 rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">Active</span>
                        : <button className="px-3 py-1.5 rounded-lg bg-slate-700 text-slate-300 text-xs font-bold hover:bg-slate-600">Upgrade</button>
                      }
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {activeSection === 'audit' && (
            <div className="space-y-5">
              <div className="rounded-2xl border border-slate-700/50 bg-slate-800/30 p-6">
                <h2 className="text-lg font-black text-white mb-1">Audit Log</h2>
                <p className="text-sm text-slate-400 mb-4">System-wide event timeline — every admin action is recorded.</p>

                <div className="flex items-center gap-3 mb-4">
                  <select
                    value={auditEventType}
                    onChange={(e) => setAuditEventType(e.target.value)}
                    className="px-3 py-2 rounded-lg bg-slate-900/60 border border-slate-700/50 text-sm text-slate-300 focus:outline-none focus:border-indigo-500/50"
                  >
                    <option value="">All event types</option>
                    {auditEventTypes.map(t => <option key={t} value={t}>{t}</option>)}
                  </select>
                  <span className="text-xs text-slate-500">Showing up to {auditLimit} events{auditEventType ? ` · ${auditEventType}` : ''}</span>
                </div>

                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-slate-700/40 text-left">
                        <th className="py-2.5 px-3 text-slate-500 font-bold text-xs uppercase tracking-wider">Timestamp</th>
                        <th className="py-2.5 px-3 text-slate-500 font-bold text-xs uppercase tracking-wider">Actor</th>
                        <th className="py-2.5 px-3 text-slate-500 font-bold text-xs uppercase tracking-wider">Action</th>
                        <th className="py-2.5 px-3 text-slate-500 font-bold text-xs uppercase tracking-wider">Details</th>
                      </tr>
                    </thead>
                    <tbody>
                      {auditLoading ? (
                        <tr><td colSpan={4} className="py-6 px-3 text-center text-slate-500 text-xs">Loading audit log…</td></tr>
                      ) : auditLogs.length === 0 ? (
                        <tr><td colSpan={4} className="py-6 px-3 text-center text-slate-500 text-xs">No events recorded yet.</td></tr>
                      ) : (
                        auditLogs.map((row) => (
                          <tr key={row.logId} className="border-b border-slate-700/30">
                            <td className="py-2.5 px-3 text-slate-500 text-xs whitespace-nowrap">{row.timestamp ? new Date(row.timestamp).toLocaleString() : '—'}</td>
                            <td className="py-2.5 px-3 text-slate-300 text-xs">{row.userId || 'system'}</td>
                            <td className="py-2.5 px-3">
                              <span className="text-xs font-bold uppercase px-2 py-0.5 rounded-full bg-indigo-500/15 text-indigo-300 border border-indigo-500/30">{row.eventType}</span>
                            </td>
                            <td className="py-2.5 px-3 text-slate-500 text-xs max-w-xs truncate" title={JSON.stringify(row.metadata)}>
                              {Object.entries(row.metadata || {}).slice(0, 2).map(([k, v]) => `${k}: ${typeof v === 'object' ? JSON.stringify(v) : v}`).join(', ') || '—'}
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
                {!auditLoading && auditLogs.length >= auditLimit && (
                  <div className="mt-4 text-center">
                    <button
                      onClick={() => setAuditLimit(l => l + 50)}
                      className="px-4 py-2 rounded-lg bg-slate-700/40 border border-slate-600/40 text-slate-300 text-xs font-bold hover:bg-slate-700/60 transition-all"
                    >
                      Load 50 more
                    </button>
                  </div>
                )}
              </div>
            </div>
          )}

          {activeSection === 'backup' && (
            <div className="space-y-5">
              <div className="rounded-2xl border border-slate-700/50 bg-slate-800/30 p-6">
                <h2 className="text-lg font-black text-white mb-1">Backup &amp; Restore</h2>
                <p className="text-sm text-slate-400 mb-6">Export and import platform data safely.</p>

                <div className="grid sm:grid-cols-2 gap-4">
                  {[
                    { key: 'full', label: 'Download Full Backup', desc: 'Export all data as a JSON snapshot', btn: '⬇️ Download', busyBtn: 'Exporting…', btnStyle: 'bg-emerald-600/20 border-emerald-500/30 text-emerald-300 hover:bg-emerald-600/30', onClick: handleDownloadFullBackup },
                    { key: 'restore', label: 'Upload Backup', desc: 'Restore platform state from a JSON file', btn: '⬆️ Upload', btnStyle: 'bg-slate-800 border-slate-700 text-slate-500 cursor-not-allowed', disabled: true, disabledNote: 'Not yet available — restore requires careful review to avoid data loss. Contact support if you need to restore from a backup.' },
                    { key: 'users', label: 'Export Users CSV', desc: 'Download all users as a CSV spreadsheet', btn: '📄 Export', busyBtn: 'Exporting…', btnStyle: 'bg-slate-700 border-slate-600 text-slate-300 hover:bg-slate-600', onClick: handleExportUsersCsv },
                    { key: 'modules', label: 'Export Modules JSON', desc: 'Download all module definitions', btn: '📚 Export', busyBtn: 'Exporting…', btnStyle: 'bg-slate-700 border-slate-600 text-slate-300 hover:bg-slate-600', onClick: handleExportModulesJson },
                  ].map(item => (
                    <div key={item.key} className="rounded-xl border border-slate-700/40 bg-slate-900/50 p-4">
                      <p className="text-sm font-bold text-white mb-1">{item.label}</p>
                      <p className="text-xs text-slate-500 mb-3">{item.desc}</p>
                      <button
                        onClick={item.onClick}
                        disabled={item.disabled || exporting === item.key}
                        title={item.disabledNote}
                        className={`px-3 py-2 rounded-lg border text-xs font-bold transition-all disabled:opacity-60 ${item.btnStyle}`}
                      >
                        {exporting === item.key ? item.busyBtn : item.btn}
                      </button>
                    </div>
                  ))}
                </div>

                <div className="mt-4 rounded-xl border border-amber-500/30 bg-amber-500/5 p-4 text-xs text-amber-300">
                  ⚠️ Restore-from-backup is not yet available in this build. Downloaded backups are still safe to keep — restoring will overwrite current users, modules, and assignment data once that feature ships, so always keep a fresh download before it does.
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
