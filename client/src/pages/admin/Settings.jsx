import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { useNotification } from '../../contexts/NotificationContext.jsx';
import { authFetch } from '../../utils/authFetch.js';
import PageContainer from '../../components/PageContainer.jsx';
import PageHeader from '../../components/PageHeader.jsx';
import Button from '../../components/Button.jsx';

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

  const [settingsError, setSettingsError] = useState(false);
  const loadSettings = () => {
    setSettingsError(false);
    authFetch('/api/settings')
      .then(res => {
        const data = res?.data ?? res;
        if (data) {
          setGeneral(data.general || {});
          setSecurity(data.security || {});
          setNotifications(data.notifications || {});
        }
      })
      .catch(() => { setSettingsError(true); notifyError('Failed to load settings. Showing defaults.'); })
      .finally(() => setSettingsLoaded(true));
  };
  useEffect(() => { loadSettings(); }, []);

  useEffect(() => {
    if (activeSection !== 'agents' && activeSection !== 'integrations') return;
    authFetch('/api/health').then(setHealthInfo).catch(() => {});
  }, [activeSection]);

  const [activeUserCount, setActiveUserCount] = useState(null);
  useEffect(() => {
    if (activeSection !== 'billing') return;
    authFetch('/api/users?light=1')
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
    { id: 'agents',         label: 'Agent System',  icon: '🤖',  desc: 'Live status of the agent pipeline and models' },
    { id: 'integrations',   label: 'Integrations',  icon: '🔗',  desc: 'Database, LLM, Google OAuth, SMTP' },
    { id: 'billing',        label: 'Billing',       icon: '💳',  desc: 'Subscription plans, usage quotas, invoices' },
    { id: 'audit',          label: 'Audit Log',     icon: '📋',  desc: 'Full system event log and change history' },
    { id: 'backup',         label: 'Backup & Restore', icon: '💾', desc: 'Database snapshots, import / export' },
  ];

  const card = 'rounded-2xl border border-slate-700/60 bg-slate-800/40 p-4 sm:p-6';
  const labelCls = 'block text-xs font-bold text-slate-300 uppercase tracking-wider mb-1.5';
  const inputCls = 'w-full px-4 py-2.5 rounded-xl bg-slate-900 border border-slate-700 text-white text-sm focus:outline-none focus:border-indigo-500/60';
  const rowCls = 'flex items-center justify-between gap-4 rounded-xl bg-slate-900/50 border border-slate-700/40 p-4';
  const statBox = 'rounded-xl border border-slate-700/40 bg-slate-900/50 p-5 text-center';
  const statLabel = 'text-xs font-bold text-slate-400 uppercase tracking-wider mb-1';

  const SaveBar = ({ section, values }) => (
    <div className="mt-6 flex flex-wrap items-center justify-end gap-3">
      {!settingsLoaded ? <span className="text-sm text-slate-400">Loading current settings…</span> : null}
      <Button variant="primary" onClick={() => saveSection(section, values)} disabled={!settingsLoaded} loading={saving}>
        {saving ? 'Saving…' : 'Save Changes'}
      </Button>
    </div>
  );

  const Toggles = ({ items, state, setState }) => (
    <div className="grid grid-cols-1 gap-3 2xl:grid-cols-2">
      {items.map(item => (
        <label key={item.key} className={`${rowCls} cursor-pointer`}>
          <div className="min-w-0">
            <p className="text-sm font-semibold text-white">{item.label}</p>
            <p className="mt-0.5 text-sm text-slate-400">{item.desc}</p>
          </div>
          <input
            type="checkbox"
            checked={!!state[item.key]}
            onChange={(e) => setState(s => ({ ...s, [item.key]: e.target.checked }))}
            className="h-5 w-5 shrink-0 rounded border-slate-700 bg-slate-800 text-indigo-500 focus:ring-indigo-500"
          />
        </label>
      ))}
    </div>
  );

  return (
    <PageContainer>
      <PageHeader
        title="Settings"
        subtitle="Platform configuration. All changes are system-wide."
        actions={<Button variant="secondary" onClick={() => navigate('/admin/dashboard')}>← Back to Admin Dashboard</Button>}
      />

      {settingsError ? (
        <div role="alert" className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-200">
          <span>Could not load saved settings. The forms below show defaults, so saving now would overwrite your real values.</span>
          <Button size="sm" variant="danger" onClick={loadSettings}>Retry</Button>
        </div>
      ) : null}

      <div className="grid gap-5 lg:grid-cols-[minmax(0,300px)_minmax(0,1fr)]">
        {/* Section list */}
        <nav aria-label="Settings sections" className="grid grid-cols-1 content-start gap-2 sm:grid-cols-2 lg:grid-cols-1">
          {sections.map(s => (
            <button
              key={s.id}
              type="button"
              onClick={() => setActiveSection(s.id)}
              aria-current={activeSection === s.id ? 'page' : undefined}
              className={`w-full min-w-0 text-left flex items-start gap-3 px-4 py-3 rounded-xl transition-all border ${
                activeSection === s.id
                  ? 'bg-indigo-600/20 text-indigo-200 border-indigo-500/40'
                  : 'text-slate-300 hover:text-white hover:bg-slate-800/60 border-slate-700/50 bg-slate-800/30'
              }`}
            >
              <span className="text-xl leading-6" aria-hidden="true">{s.icon}</span>
              <span className="min-w-0">
                <span className="block text-sm font-bold">{s.label}</span>
                <span className="block text-sm text-slate-400">{s.desc}</span>
              </span>
            </button>
          ))}
        </nav>

        {/* Section content */}
        <div className="min-w-0 space-y-5">
          {activeSection === 'general' && (
            <div className={card}>
              <h2 className="text-xl font-black text-white mb-1">General Settings</h2>
              <p className="text-sm text-slate-400 mb-6">Core platform identity and default preferences.</p>

              <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
                <div>
                  <label htmlFor="set-name" className={labelCls}>Platform Name</label>
                  <input id="set-name" type="text" value={general.platformName ?? ''} onChange={(e) => setGeneral(g => ({ ...g, platformName: e.target.value }))} className={inputCls} />
                </div>
                <div>
                  <label htmlFor="set-tag" className={labelCls}>Tagline</label>
                  <input id="set-tag" type="text" value={general.tagline ?? ''} onChange={(e) => setGeneral(g => ({ ...g, tagline: e.target.value }))} className={inputCls} />
                </div>
                <div>
                  <label htmlFor="set-mail" className={labelCls}>Support Email</label>
                  <input id="set-mail" type="email" value={general.supportEmail ?? ''} onChange={(e) => setGeneral(g => ({ ...g, supportEmail: e.target.value }))} className={inputCls} />
                </div>
                <div>
                  <label htmlFor="set-role" className={labelCls}>Default User Role</label>
                  <select id="set-role" value={general.defaultUserRole ?? 'employee'} onChange={(e) => setGeneral(g => ({ ...g, defaultUserRole: e.target.value }))} className={inputCls}>
                    <option value="employee">Employee</option>
                    <option value="manager">Manager</option>
                    <option value="admin">Admin</option>
                  </select>
                </div>
                <div className={`${rowCls} xl:col-span-2`}>
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-white">Maintenance Mode</p>
                    <p className="text-sm text-slate-400">Flag stored for reference. It does not block requests yet.</p>
                  </div>
                  <Button
                    variant={general.maintenanceMode ? 'danger' : 'secondary'}
                    aria-pressed={!!general.maintenanceMode}
                    onClick={() => setGeneral(g => ({ ...g, maintenanceMode: !g.maintenanceMode }))}
                  >
                    {general.maintenanceMode ? 'Maintenance mode: ON' : 'Maintenance mode: OFF'}
                  </Button>
                </div>
              </div>
              <SaveBar section="general" values={general} />
            </div>
          )}

          {activeSection === 'security' && (
            <div className={card}>
              <h2 className="text-xl font-black text-white mb-1">Security Settings</h2>
              <p className="text-sm text-slate-400 mb-3">Authentication, sessions, and access control policies.</p>
              <p className="mb-6 rounded-xl border border-amber-500/30 bg-amber-500/5 px-4 py-3 text-sm text-amber-300">
                Strong-password rules and login rate-limiting are always enforced platform-wide regardless of these
                toggles. 2FA, single-session, and IP-whitelist policies are not built yet. They are saved for
                reference and future rollout.
              </p>

              <Toggles
                state={security}
                setState={setSecurity}
                items={[
                  { key: 'require2FAForAdmins',      label: 'Require 2FA for Admins',   desc: 'Force two-factor authentication for all admin accounts' },
                  { key: 'enforceStrongPasswords',    label: 'Enforce Strong Passwords', desc: 'Minimum 8 chars, uppercase, number, and symbol required' },
                  { key: 'singleSessionPerUser',      label: 'Single Session per User',  desc: 'Invalidate older sessions when a user logs in again' },
                  { key: 'autoLogoutOnInactivity',    label: 'Auto-logout after Inactivity', desc: 'End sessions after the configured timeout' },
                  { key: 'ipWhitelist',               label: 'IP Whitelist',             desc: 'Restrict admin access to approved IP ranges' },
                ]}
              />

              <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2">
                <div>
                  <label htmlFor="set-timeout" className={labelCls}>Session Timeout (minutes)</label>
                  <input
                    id="set-timeout"
                    type="number"
                    min="1"
                    value={security.sessionTimeoutMinutes ?? 60}
                    onChange={(e) => setSecurity(s => ({ ...s, sessionTimeoutMinutes: Number(e.target.value) }))}
                    className={inputCls}
                  />
                </div>
                <div>
                  <label htmlFor="set-attempts" className={labelCls}>Max Login Attempts</label>
                  <input
                    id="set-attempts"
                    type="number"
                    min="1"
                    value={security.maxLoginAttempts ?? 5}
                    onChange={(e) => setSecurity(s => ({ ...s, maxLoginAttempts: Number(e.target.value) }))}
                    className={inputCls}
                  />
                </div>
              </div>
              <SaveBar section="security" values={security} />
            </div>
          )}

          {activeSection === 'notifications' && (
            <div className={card}>
              <h2 className="text-xl font-black text-white mb-1">Notification Settings</h2>
              <p className="text-sm text-slate-400 mb-3">Control which events trigger email or in-app notifications.</p>
              <p className="mb-6 rounded-xl border border-amber-500/30 bg-amber-500/5 px-4 py-3 text-sm text-amber-300">
                "Manager Request Pending" is already sent unconditionally today. The others are not wired to a
                trigger yet. These toggles are saved for when they are.
              </p>

              <Toggles
                state={notifications}
                setState={setNotifications}
                items={[
                  { key: 'newUserRegistered',    label: 'New User Registered',       desc: 'Alert admins when a new user signs up' },
                  { key: 'moduleCreated',        label: 'Module Created',             desc: 'Notify managers when a new module is published' },
                  { key: 'assignmentCompleted',  label: 'Assignment Completed',       desc: 'Employee finishes a module or session' },
                  { key: 'quizScoreBelow60',     label: 'Quiz Score Below 60%',       desc: 'Alert employee and their manager on poor performance' },
                  { key: 'managerRequestPending',label: 'Manager Request Pending',    desc: 'Alert admin when a manager requests a new assignment' },
                  { key: 'weeklyDigest',         label: 'Weekly Digest',              desc: 'Send a weekly summary of team activity to all managers' },
                ]}
              />
              <SaveBar section="notifications" values={notifications} />
            </div>
          )}

          {activeSection === 'agents' && (
            <div className={card}>
              <h2 className="text-xl font-black text-white mb-1">Agent System Status</h2>
              <p className="text-sm text-slate-400 mb-6">
                Live status of the deployed agent pipeline (read-only). Per-agent temperature and model choice are
                fixed by the server deployment, not configurable per company.
              </p>

              {!healthInfo ? (
                <p className="text-sm text-slate-400">Loading live status…</p>
              ) : (
                <>
                  <div className="grid grid-cols-1 gap-4 mb-5 sm:grid-cols-3">
                    <div className={statBox}>
                      <p className={statLabel}>Active Agents</p>
                      <p className="text-2xl font-black text-white">{healthInfo.agentCount ?? '—'}</p>
                    </div>
                    <div className={statBox}>
                      <p className={statLabel}>Primary Model</p>
                      <p className="text-base font-black text-white break-all">{healthInfo.model ?? '—'}</p>
                    </div>
                    <div className={statBox}>
                      <p className={statLabel}>Gemini Keys</p>
                      <p className="text-2xl font-black text-white">{healthInfo.geminiKeys ?? '—'}</p>
                    </div>
                  </div>
                  <div className="grid grid-cols-1 gap-2 md:grid-cols-2 2xl:grid-cols-3">
                    {(healthInfo.agents || []).map(name => (
                      <div key={name} className={`${rowCls} !p-3.5`}>
                        <p className="min-w-0 truncate text-sm font-bold text-indigo-300" title={name}>{name}</p>
                        <span className="shrink-0 text-xs font-bold uppercase px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-300 border border-emerald-500/30">Active</span>
                      </div>
                    ))}
                  </div>
                  <div className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-slate-400">
                    <span>Groq fallback: <strong className={healthInfo.groq?.startsWith?.('enabled') ? 'text-emerald-400' : 'text-slate-300'}>{String(healthInfo.groq ?? '—')}</strong></span>
                    <span aria-hidden="true">·</span>
                    <span>Cerebras: <strong className={healthInfo.cerebras === 'enabled' ? 'text-emerald-400' : 'text-slate-300'}>{String(healthInfo.cerebras ?? '—')}</strong></span>
                  </div>
                </>
              )}
            </div>
          )}

          {activeSection === 'integrations' && (
            <div className={card}>
              <h2 className="text-xl font-black text-white mb-1">Integrations</h2>
              <p className="text-sm text-slate-400 mb-6">Live connection status (read-only). Credentials are set via server environment variables, not this page.</p>

              <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
                {[
                  { name: 'Database',          live: healthInfo && (healthInfo.db === 'supabase'),               desc: healthInfo ? (healthInfo.db === 'supabase' ? 'Supabase (primary)' : 'File-based fallback. SUPABASE_URL not set') : 'Checking…', icon: '🗄️' },
                  { name: 'LLM Provider',      live: healthInfo?.integrations?.llm,                              desc: healthInfo ? `${healthInfo.model || 'model'} · Groq: ${healthInfo.groq ?? '—'} · Cerebras: ${healthInfo.cerebras ?? '—'}` : 'Checking…', icon: '🧠' },
                  { name: 'Google OAuth',      live: healthInfo?.integrations?.googleOAuth,                      desc: 'Social login for users',                      icon: '🔑' },
                  { name: 'SMTP (Email)',      live: healthInfo?.integrations?.smtp,                             desc: 'Transaction and notification emails',         icon: '📧' },
                  { name: 'Stripe / Billing',  live: false,                                                      desc: 'Subscription and invoice payments. Not built yet', icon: '💳' },
                  { name: 'Slack / Teams',     live: false,                                                      desc: 'Push notifications to team channels. Not built yet', icon: '💬' },
                ].map(intg => ({
                  ...intg,
                  status: !healthInfo ? '…' : intg.live ? 'Connected' : 'Not Configured',
                  color: !healthInfo ? 'text-slate-400' : intg.live ? 'text-emerald-400' : 'text-red-400',
                })).map(intg => (
                  <div key={intg.name} className={rowCls}>
                    <div className="flex min-w-0 items-center gap-3">
                      <span className="text-2xl" aria-hidden="true">{intg.icon}</span>
                      <div className="min-w-0">
                        <p className="text-sm font-semibold text-white">{intg.name}</p>
                        <p className="mt-0.5 break-words text-sm text-slate-400">{intg.desc}</p>
                      </div>
                    </div>
                    <span className={`shrink-0 text-xs font-bold uppercase ${intg.color}`}>{intg.status}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {activeSection === 'billing' && (
            <div className={card}>
              <h2 className="text-xl font-black text-white mb-1">Billing &amp; Plans</h2>
              <p className="text-sm text-slate-400 mb-2">No payment provider is integrated yet. This page is informational.</p>
              <p className="text-sm text-slate-400 mb-6">Active Users reflects your real company headcount; Plan and Billing Period below are placeholders until a billing provider (e.g. Stripe) is connected.</p>

              <div className="grid grid-cols-1 gap-4 mb-6 sm:grid-cols-3">
                {[
                  { label: 'Current Plan', value: 'Enterprise' },
                  { label: 'Active Users',  value: activeUserCount ?? '…' },
                  { label: 'Billing Period', value: 'Monthly' },
                ].map(m => (
                  <div key={m.label} className={statBox}>
                    <p className={statLabel}>{m.label}</p>
                    <p className="text-2xl font-black text-white">{m.value}</p>
                  </div>
                ))}
              </div>

              <div className="grid grid-cols-1 gap-3 xl:grid-cols-3">
                {[
                  { plan: 'Starter', price: '$29 / mo', limit: 'Up to 25 users', active: false },
                  { plan: 'Professional', price: '$79 / mo', limit: 'Up to 100 users', active: false },
                  { plan: 'Enterprise', price: 'Custom', limit: 'Unlimited', active: true },
                ].map(p => (
                  <div key={p.plan} className={`rounded-xl border p-4 ${p.active ? 'border-indigo-500/50 bg-indigo-500/5' : 'border-slate-700/40 bg-slate-900/50'}`}>
                    <div className="flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-base font-bold text-white">{p.plan}</p>
                        <p className="mt-0.5 text-sm text-slate-400">{p.price} · {p.limit}</p>
                      </div>
                      {p.active
                        ? <span className="shrink-0 text-xs font-bold uppercase px-2.5 py-1 rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">Active</span>
                        : <Button size="sm" disabled title="Upgrades are not available until a billing provider is connected">Upgrade</Button>
                      }
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {activeSection === 'audit' && (
            <div className={card}>
              <h2 className="text-xl font-black text-white mb-1">Audit Log</h2>
              <p className="text-sm text-slate-400 mb-4">System-wide event timeline. Every admin action is recorded.</p>

              <div className="mb-4 flex flex-wrap items-center gap-3">
                <select
                  aria-label="Filter by event type"
                  value={auditEventType}
                  onChange={(e) => setAuditEventType(e.target.value)}
                  className="h-10 px-3 rounded-lg bg-slate-900/60 border border-slate-700/50 text-sm text-slate-200 focus:outline-none focus:border-indigo-500/50"
                >
                  <option value="">All event types</option>
                  {auditEventType && !auditEventTypes.includes(auditEventType) ? <option value={auditEventType}>{auditEventType}</option> : null}
                  {auditEventTypes.map(t => <option key={t} value={t}>{t}</option>)}
                </select>
                {auditEventType ? <Button size="sm" variant="ghost" onClick={() => setAuditEventType('')}>Clear filter</Button> : null}
                <span className="text-sm text-slate-400">Showing up to {auditLimit} events{auditEventType ? ` · ${auditEventType}` : ''}</span>
              </div>

              <div className="min-w-0">
                <table className="w-full table-fixed text-sm">
                  <thead>
                    <tr className="border-b border-slate-700/40 text-left">
                      <th className="w-[22%] py-2.5 px-3 text-slate-400 font-bold text-xs uppercase tracking-wider">Timestamp</th>
                      <th className="w-[18%] py-2.5 px-3 text-slate-400 font-bold text-xs uppercase tracking-wider">Actor</th>
                      <th className="w-[22%] py-2.5 px-3 text-slate-400 font-bold text-xs uppercase tracking-wider">Action</th>
                      <th className="py-2.5 px-3 text-slate-400 font-bold text-xs uppercase tracking-wider">Details</th>
                    </tr>
                  </thead>
                  <tbody>
                    {auditLoading ? (
                      <tr><td colSpan={4} className="py-8 px-3 text-center text-slate-400 text-sm">Loading audit log…</td></tr>
                    ) : auditLogs.length === 0 ? (
                      <tr><td colSpan={4} className="py-8 px-3 text-center text-slate-400 text-sm">{auditEventType ? 'No events match this filter.' : 'No events recorded yet.'}</td></tr>
                    ) : (
                      auditLogs.map((row, i) => (
                        <tr key={row.logId || i} className="border-b border-slate-700/30">
                          <td className="py-2.5 px-3 text-slate-300 text-sm">{row.timestamp ? new Date(row.timestamp).toLocaleString() : '—'}</td>
                          <td className="py-2.5 px-3 text-slate-200 text-sm truncate" title={row.userId || 'system'}>{row.userId || 'system'}</td>
                          <td className="py-2.5 px-3">
                            <span className="inline-block max-w-full truncate align-middle text-xs font-bold uppercase px-2 py-0.5 rounded-full bg-indigo-500/15 text-indigo-300 border border-indigo-500/30" title={row.eventType}>{row.eventType}</span>
                          </td>
                          <td className="py-2.5 px-3 text-slate-300 text-sm truncate" title={JSON.stringify(row.metadata ?? {})}>
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
                  <Button onClick={() => setAuditLimit(l => l + 50)}>Load 50 more</Button>
                </div>
              )}
            </div>
          )}

          {activeSection === 'backup' && (
            <div className={card}>
              <h2 className="text-xl font-black text-white mb-1">Backup &amp; Restore</h2>
              <p className="text-sm text-slate-400 mb-6">Export and import platform data safely.</p>

              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                {[
                  { key: 'full', label: 'Download Full Backup', desc: 'Export all data as a JSON snapshot', btn: 'Download backup', variant: 'success', onClick: handleDownloadFullBackup },
                  { key: 'restore', label: 'Upload Backup', desc: 'Restore platform state from a JSON file', btn: 'Upload backup', disabled: true, disabledNote: 'Not yet available. Restore requires careful review to avoid data loss. Contact support if you need to restore from a backup.' },
                  { key: 'users', label: 'Export Users CSV', desc: 'Download all users as a CSV spreadsheet', btn: 'Export users', onClick: handleExportUsersCsv },
                  { key: 'modules', label: 'Export Modules JSON', desc: 'Download all module definitions', btn: 'Export modules', onClick: handleExportModulesJson },
                ].map(item => (
                  <div key={item.key} className="rounded-xl border border-slate-700/40 bg-slate-900/50 p-4 sm:p-5">
                    <p className="text-base font-bold text-white mb-1">{item.label}</p>
                    <p className="text-sm text-slate-400 mb-4">{item.desc}</p>
                    <Button
                      variant={item.variant || 'secondary'}
                      onClick={item.onClick}
                      disabled={item.disabled || (exporting !== null && exporting !== item.key)}
                      loading={exporting === item.key}
                      title={item.disabledNote}
                    >
                      {exporting === item.key ? 'Exporting…' : item.btn}
                    </Button>
                  </div>
                ))}
              </div>

              <div className="mt-4 rounded-xl border border-amber-500/30 bg-amber-500/5 p-4 text-sm text-amber-300">
                Restore-from-backup is not yet available in this build. Downloaded backups are still safe to keep. Restoring will overwrite current users, modules, and assignment data once that feature ships, so always keep a fresh download before it does.
              </div>
            </div>
          )}
        </div>
      </div>
    </PageContainer>
  );
}
