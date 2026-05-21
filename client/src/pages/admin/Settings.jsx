import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';

export default function Settings() {
  const { user, hasRole, logout } = useAuth();
  const navigate = useNavigate();

  // redirect if not admin
  useEffect(() => {
    if (!user || !hasRole('admin')) {
      navigate('/dashboard');
    }
  }, [user, hasRole, navigate]);

  if (!user || !hasRole('admin')) return null;

  const [activeSection, setActiveSection] = useState('general');
  const [saving, setSaving] = useState(false);

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

  const handleSave = () => {
    setSaving(true);
    setTimeout(() => { setSaving(false); alert('Settings saved successfully.'); }, 800);
  };

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
                    <input type="text" defaultValue="SkillForge AI" className="w-full px-4 py-2.5 rounded-xl bg-slate-900 border border-slate-700 text-white text-sm" />
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-slate-400 uppercase mb-1.5">Tagline</label>
                    <input type="text" defaultValue="Autonomous AI Learning Platform · 9-Agent System" className="w-full px-4 py-2.5 rounded-xl bg-slate-900 border border-slate-700 text-white text-sm" />
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-slate-400 uppercase mb-1.5">Support Email</label>
                    <input type="email" defaultValue="support@skillforge.ai" className="w-full px-4 py-2.5 rounded-xl bg-slate-900 border border-slate-700 text-white text-sm" />
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-slate-400 uppercase mb-1.5">Default User Role</label>
                    <select defaultValue="employee" className="w-full px-4 py-2.5 rounded-xl bg-slate-900 border border-slate-700 text-white text-sm">
                      <option value="employee">Employee</option>
                      <option value="manager">Manager</option>
                      <option value="admin">Admin</option>
                    </select>
                  </div>
                  <div className="flex items-center justify-between rounded-xl bg-slate-900/50 border border-slate-700/40 p-4">
                    <div>
                      <p className="text-sm font-semibold text-white">Maintenance Mode</p>
                      <p className="text-xs text-slate-500">Block all non-admin access while updating</p>
                    </div>
                    <button className="px-4 py-1.5 rounded-lg bg-slate-700 text-slate-300 text-xs font-bold hover:bg-slate-600">OFF</button>
                  </div>
                </div>

                <div className="mt-6 flex justify-end">
                  <button onClick={handleSave} disabled={saving} className="px-6 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-bold transition-all disabled:opacity-50">
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
                <p className="text-sm text-slate-400 mb-6">Authentication, sessions, and access control policies.</p>

                <div className="space-y-4">
                  {[
                    { label: 'Require 2FA for Admins',   desc: 'Force two-factor authentication for all admin accounts', defaultChecked: true },
                    { label: 'Enforce Strong Passwords', desc: 'Minimum 8 chars, uppercase, number, and symbol required', defaultChecked: true },
                    { label: 'Single Session per User',  desc: 'Invalidate older sessions when a user logs in again', defaultChecked: false },
                    { label: 'Auto-logout after Inactivity', desc: 'End sessions after 60 minutes of inactivity', defaultChecked: true },
                    { label: 'IP Whitelist',             desc: 'Restrict admin access to approved IP ranges', defaultChecked: false },
                  ].map(item => (
                    <label key={item.label} className="flex items-center justify-between rounded-xl bg-slate-900/50 border border-slate-700/40 p-4 cursor-pointer">
                      <div>
                        <p className="text-sm font-semibold text-white">{item.label}</p>
                        <p className="text-xs text-slate-500 mt-0.5">{item.desc}</p>
                      </div>
                      <input type="checkbox" defaultChecked={item.defaultChecked} className="w-5 h-5 rounded border-slate-700 bg-slate-800 text-indigo-500 focus:ring-indigo-500" />
                    </label>
                  ))}

                  <div>
                    <label className="block text-xs font-bold text-slate-400 uppercase mb-1.5">Session Timeout (minutes)</label>
                    <input type="number" defaultValue={60} className="w-full px-4 py-2.5 rounded-xl bg-slate-900 border border-slate-700 text-white text-sm" />
                  </div>

                  <div>
                    <label className="block text-xs font-bold text-slate-400 uppercase mb-1.5">Max Login Attempts</label>
                    <input type="number" defaultValue={5} className="w-full px-4 py-2.5 rounded-xl bg-slate-900 border border-slate-700 text-white text-sm" />
                  </div>
                </div>

                <div className="mt-6 flex justify-end">
                  <button onClick={handleSave} disabled={saving} className="px-6 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-bold transition-all disabled:opacity-50">
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
                <p className="text-sm text-slate-400 mb-6">Control which events trigger email or in-app notifications.</p>

                <div className="space-y-4">
                  {[
                    { label: 'New User Registered',       desc: 'Alert admins when a new user signs up', defaultOn: true },
                    { label: 'Module Created',             desc: 'Notify managers when a new module is published', defaultOn: true },
                    { label: 'Assignment Completed',       desc: 'Employee finishes a module or session', defaultOn: true },
                    { label: 'Quiz Score Below 60%',       desc: 'Alert employee and their manager on poor performance', defaultOn: true },
                    { label: 'Manager Request Pending',    desc: 'Alert admin when a manager requests a new assignment', defaultOn: false },
                    { label: 'Weekly Digest',              desc: 'Send a weekly summary of team activity to all managers', defaultOn: false },
                  ].map(item => (
                    <label key={item.label} className="flex items-center justify-between rounded-xl bg-slate-900/50 border border-slate-700/40 p-4 cursor-pointer">
                      <div>
                        <p className="text-sm font-semibold text-white">{item.label}</p>
                        <p className="text-xs text-slate-500 mt-0.5">{item.desc}</p>
                      </div>
                      <input type="checkbox" defaultChecked={item.defaultOn} className="w-5 h-5 rounded border-slate-700 bg-slate-800 text-indigo-500 focus:ring-indigo-500" />
                    </label>
                  ))}
                </div>

                <div className="mt-6 flex justify-end">
                  <button onClick={handleSave} disabled={saving} className="px-6 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-bold transition-all disabled:opacity-50">
                    {saving ? '⏳ Saving…' : 'Save Changes'}
                  </button>
                </div>
              </div>
            </div>
          )}

          {activeSection === 'agents' && (
            <div className="space-y-5">
              <div className="rounded-2xl border border-slate-700/50 bg-slate-800/30 p-6">
                <h2 className="text-lg font-black text-white mb-1">9-Agent System Settings</h2>
                <p className="text-sm text-slate-400 mb-6">Fine-tune each specialist agent and the orchestration pipeline.</p>

                {[
                  { name: 'GoalAgent',        role: 'Goal analysis & intent recognition',           temp: '0.2' },
                  { name: 'DecomposeAgent',   role: 'Skill tree decomposition & sequencing',        temp: '0.3' },
                  { name: 'DiagnosticAgent',  role: 'Diagnostic quiz generation',                   temp: '0.4' },
                  { name: 'ScoringAgent',     role: 'Gap scoring & mastery map computation',        temp: '0.1' },
                  { name: 'CurriculumAgent',  role: '14-day roadmap builder',                       temp: '0.3' },
                  { name: 'EvaluatorAgent',   role: 'Practice response evaluation & feedback',      temp: '0.2' },
                  { name: 'AdaptorAgent',     role: 'Real-time plan rebalancer',                    temp: '0.4' },
                  { name: 'MarketAgent',      role: 'Job market & career path intelligence',        temp: '0.5' },
                  { name: 'InterviewAgent',   role: 'Interview question & scenario generation',     temp: '0.5' },
                ].map(agent => (
                  <div key={agent.name} className="flex items-center justify-between rounded-xl bg-slate-900/50 border border-slate-700/40 p-4 mb-3">
                    <div>
                      <p className="text-sm font-bold text-indigo-300">{agent.name}</p>
                      <p className="text-[11px] text-slate-500 mt-0.5">{agent.role}</p>
                    </div>
                    <div className="flex items-center gap-3">
                      <label className="flex items-center gap-2">
                        <span className="text-[10px] text-slate-500 font-bold uppercase">Temperature</span>
                        <input type="number" step="0.1" min="0" max="1" defaultValue={agent.temp} className="w-16 px-2 py-1 rounded-lg bg-slate-800 border border-slate-700 text-white text-xs text-center" />
                      </label>
                      <label className="flex items-center gap-1.5">
                        <input type="checkbox" defaultChecked className="rounded border-slate-700 bg-slate-800 text-indigo-500" />
                        <span className="text-xs text-slate-300">Enabled</span>
                      </label>
                    </div>
                  </div>
                ))}

                <div className="mt-4">
                  <label className="block text-xs font-bold text-slate-400 uppercase mb-1.5">LLM Model</label>
                  <select defaultValue="gpt-4o" className="w-full px-4 py-2.5 rounded-xl bg-slate-900 border border-slate-700 text-white text-sm">
                    <option value="gpt-4o">GPT-4o</option>
                    <option value="gpt-4o-mini">GPT-4o Mini</option>
                    <option value="o3">o3</option>
                    <option value="claude-3.5-sonnet">Claude 3.5 Sonnet</option>
                  </select>
                </div>
              </div>

              <div className="mt-6 flex justify-end">
                <button onClick={handleSave} disabled={saving} className="px-6 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-bold transition-all disabled:opacity-50">
                  {saving ? '⏳ Saving…' : 'Save Changes'}
                </button>
              </div>
            </div>
          )}

          {activeSection === 'integrations' && (
            <div className="space-y-5">
              <div className="rounded-2xl border border-slate-700/50 bg-slate-800/30 p-6">
                <h2 className="text-lg font-black text-white mb-1">Integrations</h2>
                <p className="text-sm text-slate-400 mb-6">Connect SkillForge to your existing tools and services.</p>

                {[
                  { name: 'Supabase',          status: 'Connected',                                        color: 'text-emerald-400', desc: 'Primary database & auth provider',            icon: '🗄️' },
                  { name: 'OpenAI / LLM',      status: 'Connected',                                        color: 'text-emerald-400', desc: 'AI agent model provider',                     icon: '🧠' },
                  { name: 'Google OAuth',      status: 'Configured',                                       color: 'text-amber-400',   desc: 'Social login for users',                      icon: '🔑' },
                  { name: 'SMTP (Email)',      status: 'Not Configured',                                   color: 'text-red-400',     desc: 'Transaction and notification emails',         icon: '📧' },
                  { name: 'Stripe / Billing',  status: 'Not Configured',                                   color: 'text-red-400',     desc: 'Subscription and invoice payments',           icon: '💳' },
                  { name: 'Slack / Teams',     status: 'Not Configured',                                   color: 'text-red-400',     desc: 'Push notifications to team channels',         icon: '💬' },
                ].map(intg => (
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
                <p className="text-sm text-slate-400 mb-6">Manage subscriptions, usage limits, and invoices.</p>

                <div className="grid sm:grid-cols-3 gap-4 mb-6">
                  {[
                    { label: 'Current Plan', value: 'Enterprise', badge: 'bg-purple-500/20 text-purple-300 border-purple-500/30' },
                    { label: 'Active Users',  value: '—',          badge: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30' },
                    { label: 'Billing Period', value: 'Monthly',  badge: 'bg-indigo-500/20 text-indigo-300 border-indigo-500/30' },
                  ].map(m => (
                    <div key={m.label} className="rounded-xl border border-slate-700/40 bg-slate-900/50 p-5 text-center">
                      <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1">{m.label}</p>
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
                        ? <span className="text-[10px] font-bold uppercase px-2.5 py-1 rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">Active</span>
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
                <p className="text-sm text-slate-400 mb-6">System-wide event timeline — every admin action is recorded.</p>

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
                      {[
                        { time: '2026-05-19 01:42', actor: 'admin@skillforge.ai', action: 'ROLE_CHANGED',   detail: 'user-008 → manager' },
                        { time: '2026-05-18 16:10', actor: 'admin@skillforge.ai', action: 'MODULE_CREATED', detail: '"React Advanced"' },
                        { time: '2026-05-18 12:05', actor: 'manager@skillforge.ai', action: 'ASSIGNMENT_CREATED', detail: 'Mod-012 → emp-045' },
                        { time: '2026-05-17 09:30', actor: 'system', action: 'AUTO_SYNC', detail: 'Progress batch reconcile' },
                        { time: '2026-05-16 22:15', actor: 'admin@skillforge.ai', action: 'USER_DELETED', detail: 'user-012 self-deletion blocked' },
                      ].map((row, i) => (
                        <tr key={i} className="border-b border-slate-700/30">
                          <td className="py-2.5 px-3 text-slate-500 text-xs">{row.time}</td>
                          <td className="py-2.5 px-3 text-slate-300 text-xs">{row.actor}</td>
                          <td className="py-2.5 px-3">
                            <span className="text-[10px] font-bold uppercase px-2 py-0.5 rounded-full bg-indigo-500/15 text-indigo-300 border border-indigo-500/30">{row.action}</span>
                          </td>
                          <td className="py-2.5 px-3 text-slate-500 text-xs">{row.detail}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
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
                    { label: 'Download Full Backup',   desc: 'Export all data as a JSON snapshot', btn: '⬇️ Download',       btnStyle: 'bg-emerald-600/20 border-emerald-500/30 text-emerald-300 hover:bg-emerald-600/30' },
                    { label: 'Upload Backup',          desc: 'Restore platform state from a JSON file', btn: '⬆️ Upload', btnStyle: 'bg-indigo-600/20 border-indigo-500/30 text-indigo-300 hover:bg-indigo-600/30' },
                    { label: 'Export Users CSV',       desc: 'Download all users as a CSV spreadsheet', btn: '📄 Export',      btnStyle: 'bg-slate-700 border-slate-600 text-slate-300 hover:bg-slate-600' },
                    { label: 'Export Modules JSON',    desc: 'Download all module definitions', btn: '📚 Export',        btnStyle: 'bg-slate-700 border-slate-600 text-slate-300 hover:bg-slate-600' },
                  ].map(item => (
                    <div key={item.label} className="rounded-xl border border-slate-700/40 bg-slate-900/50 p-4">
                      <p className="text-sm font-bold text-white mb-1">{item.label}</p>
                      <p className="text-xs text-slate-500 mb-3">{item.desc}</p>
                      <button className={`px-3 py-2 rounded-lg border text-xs font-bold transition-all ${item.btnStyle}`}>{item.btn}</button>
                    </div>
                  ))}
                </div>

                <div className="mt-4 rounded-xl border border-amber-500/30 bg-amber-500/5 p-4 text-xs text-amber-300">
                  ⚠️ Restoring from backup will overwrite current users, modules, and assignment data. Always create a fresh download before importing.
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
