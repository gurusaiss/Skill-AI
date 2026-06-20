/**
 * AdminDashboard.jsx — Unified Admin Hub
 * Tabs: Overview | Access Codes | Approvals | Reports | Assignments
 */

import React, { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { authFetch } from '../../utils/authFetch.js';

// ── Utility UI ─────────────────────────────────────────────────────────────────

const Toast = ({ message, type, onClose }) => {
  useEffect(() => { const t = setTimeout(onClose, 4000); return () => clearTimeout(t); }, [onClose]);
  const colors = {
    success: 'bg-emerald-500/15 border-emerald-500/30 text-emerald-300',
    error:   'bg-red-500/15 border-red-500/30 text-red-300',
    info:    'bg-indigo-500/15 border-indigo-500/30 text-indigo-300',
  };
  return (
    <div className={`fixed top-6 right-6 z-50 flex items-center gap-3 px-5 py-3.5 rounded-xl border backdrop-blur-xl shadow-2xl ${colors[type] || colors.info}`}>
      <span className="text-sm font-semibold">{message}</span>
      <button onClick={onClose} className="ml-2 text-current/50 hover:text-current text-lg leading-none">&times;</button>
    </div>
  );
};

const Skeleton = ({ className = '' }) => (
  <div className={`animate-pulse rounded-lg bg-slate-700/40 ${className}`} />
);

const StatCard = ({ label, value, icon, borderClass, bgClass, textClass }) => (
  <div className={`rounded-xl border ${borderClass} ${bgClass} p-4`}>
    <div className="flex items-center justify-between">
      <div>
        <p className={`text-xs font-bold ${textClass} uppercase tracking-widest mb-2`}>{label}</p>
        <p className="text-2xl font-black text-white">{value}</p>
      </div>
      <div className="text-3xl opacity-50">{icon}</div>
    </div>
  </div>
);

// ── Access Code components ─────────────────────────────────────────────────────

function CopyBtn({ text }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      onClick={() => { navigator.clipboard.writeText(text || ''); setCopied(true); setTimeout(() => setCopied(false), 2000); }}
      className={`px-2.5 py-1 rounded-lg text-xs font-semibold transition-colors ${copied ? 'bg-emerald-600 text-white' : 'bg-slate-700 hover:bg-slate-600 text-slate-300 hover:text-white'}`}
    >
      {copied ? '✓ Copied' : '📋 Copy'}
    </button>
  );
}

function ShareBtn({ code }) {
  const share = () => {
    const msg = `Join our platform using this access code: ${code}`;
    if (navigator.share) {
      navigator.share({ title: 'Access Code', text: msg }).catch(() => {});
    } else {
      navigator.clipboard.writeText(msg);
    }
  };
  return (
    <button onClick={share} className="px-2.5 py-1 rounded-lg text-xs font-semibold bg-slate-700 hover:bg-slate-600 text-slate-300 hover:text-white transition-colors">
      📤 Share
    </button>
  );
}

function CodeCard({ code, busy, doAction, deleteCode }) {
  const styles = {
    manager: { badge: 'bg-amber-500/15 border-amber-500/40 text-amber-300', mono: 'text-amber-300', border: 'border-amber-500/20' },
    employee: { badge: 'bg-indigo-500/15 border-indigo-500/40 text-indigo-300', mono: 'text-indigo-300', border: 'border-indigo-500/20' },
  };
  const s = styles[code.role] || { badge: 'bg-slate-700 text-slate-300 border-slate-600', mono: 'text-white', border: 'border-slate-700' };
  const usagePct = code.maxUsage ? Math.min(100, ((code.usageCount || 0) / code.maxUsage) * 100) : 0;
  const expired = code.expiresAt && new Date(code.expiresAt) < new Date();

  return (
    <div className={`bg-slate-800/60 border rounded-xl p-4 transition-opacity ${!code.isActive ? 'opacity-50' : ''} ${s.border}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1.5 flex-wrap">
            <span className={`font-mono text-base font-bold tracking-widest ${s.mono}`}>{code.code}</span>
            <CopyBtn text={code.code} />
            <ShareBtn code={code.code} />
            <span className={`text-xs font-semibold px-2 py-0.5 rounded-full border ${s.badge}`}>{code.role}</span>
            {!code.isActive && <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-red-500/15 border border-red-500/40 text-red-300">Disabled</span>}
            {expired && <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-orange-500/15 border border-orange-500/40 text-orange-300">Expired</span>}
          </div>
          {code.label && <p className="text-xs text-slate-400 mb-1">{code.label}</p>}
          <div className="flex items-center gap-4 text-xs text-slate-500">
            <span>Signups: <span className="text-slate-200 font-semibold">{code.usageCount ?? 0}{code.maxUsage != null ? ` / ${code.maxUsage}` : ''}</span></span>
            {code.expiresAt && (
              <span>Expires: <span className={`font-semibold ${expired ? 'text-red-400' : 'text-slate-200'}`}>{new Date(code.expiresAt).toLocaleDateString()}</span></span>
            )}
          </div>
          {code.maxUsage != null && (
            <div className="mt-2 h-1.5 bg-slate-700 rounded-full overflow-hidden w-40">
              <div className={`h-full rounded-full transition-all ${usagePct >= 90 ? 'bg-red-500' : usagePct >= 60 ? 'bg-amber-500' : 'bg-emerald-500'}`} style={{ width: `${usagePct}%` }} />
            </div>
          )}
        </div>
        <div className="flex flex-col gap-1.5 flex-shrink-0">
          <button onClick={() => doAction(code.id, { regenerate: true }, 'regenerated')} disabled={!!busy}
            className="px-3 py-1.5 rounded-lg bg-violet-900/40 hover:bg-violet-900/60 text-violet-300 text-xs font-semibold transition-colors disabled:opacity-50 whitespace-nowrap">
            {busy === code.id + 'regenerated' ? '...' : '↻ Regen'}
          </button>
          <button onClick={() => doAction(code.id, { isActive: !code.isActive }, code.isActive ? 'disabled' : 'enabled')} disabled={!!busy}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors disabled:opacity-50 whitespace-nowrap ${code.isActive ? 'bg-red-900/30 hover:bg-red-900/50 text-red-400' : 'bg-emerald-900/30 hover:bg-emerald-900/50 text-emerald-400'}`}>
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

// ── Report helpers ─────────────────────────────────────────────────────────────

function classTag(label) {
  const l = (label || '').toLowerCase();
  if (l.includes('outstanding') || l.includes('excellent')) return 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30';
  if (l.includes('good')) return 'bg-sky-500/20 text-sky-300 border-sky-500/30';
  if (l.includes('average')) return 'bg-amber-500/20 text-amber-300 border-amber-500/30';
  if (l.includes('needs') || l.includes('critical')) return 'bg-red-500/20 text-red-300 border-red-500/30';
  return 'bg-slate-700/40 text-slate-300 border-slate-600/40';
}

function buildTimeline(empReports, empAssignments, modMap) {
  const events = [];
  for (const r of empReports) {
    if (r.createdAt) events.push({ date: new Date(r.createdAt), icon: '📝', label: `Assessment Completed — ${r.assessmentTitle || 'Assessment'}`, sub: r.score != null ? `Score: ${r.score}%` : '', color: 'text-emerald-400' });
  }
  for (const a of empAssignments) {
    if (a.assignedAt) events.push({ date: new Date(a.assignedAt), icon: '📚', label: `Module Assigned — ${modMap[a.moduleId]?.title || 'Module'}`, sub: '', color: 'text-indigo-400' });
    if (a.startedAt) events.push({ date: new Date(a.startedAt), icon: '▶️', label: `Module Started — ${modMap[a.moduleId]?.title || 'Module'}`, sub: '', color: 'text-amber-400' });
    if (a.completedAt) events.push({ date: new Date(a.completedAt), icon: '✅', label: `Module Completed — ${modMap[a.moduleId]?.title || 'Module'}`, sub: '', color: 'text-emerald-400' });
  }
  return events.sort((a, b) => a.date - b.date);
}

function exportEmployeePDF(emp, empReports, empAssignments, modMap) {
  const rows = empReports.map(r => `
    <tr>
      <td>${r.assessmentTitle || '—'}</td>
      <td>${r.score != null ? r.score + '%' : '—'}</td>
      <td>${r.performanceClassification?.label || '—'}</td>
      <td>${r.createdAt ? new Date(r.createdAt).toLocaleDateString() : '—'}</td>
    </tr>`).join('');
  const modRows = empAssignments.map(a => `
    <tr>
      <td>${modMap[a.moduleId]?.title || a.moduleId || '—'}</td>
      <td>${a.status || '—'}</td>
      <td>${a.assignedAt ? new Date(a.assignedAt).toLocaleDateString() : '—'}</td>
      <td>${a.completedAt ? new Date(a.completedAt).toLocaleDateString() : '—'}</td>
    </tr>`).join('');
  const html = `<!DOCTYPE html><html><head><title>Employee Report — ${emp.name || emp.email}</title>
    <style>
      body{font-family:Arial,sans-serif;padding:32px;color:#1e293b;max-width:900px;margin:0 auto}
      h1{color:#1e40af;font-size:22px;margin-bottom:4px}
      h2{color:#334155;font-size:15px;margin:24px 0 8px;border-bottom:2px solid #e2e8f0;padding-bottom:6px}
      .info{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:8px}
      .info-item{background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:10px}
      .info-item label{font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.05em;color:#64748b;display:block}
      .info-item span{font-size:14px;font-weight:600;color:#1e293b}
      table{width:100%;border-collapse:collapse;font-size:13px}
      th{background:#1e40af;color:white;padding:8px 10px;text-align:left;font-size:11px;text-transform:uppercase;letter-spacing:.05em}
      td{padding:8px 10px;border-bottom:1px solid #e2e8f0}
      tr:nth-child(even)td{background:#f8fafc}
      .footer{margin-top:32px;font-size:11px;color:#94a3b8;border-top:1px solid #e2e8f0;padding-top:12px}
    </style></head>
    <body>
    <h1>Employee Report — ${emp.name || '—'}</h1>
    <p style="color:#64748b;font-size:13px;margin-bottom:16px">Generated: ${new Date().toLocaleDateString()} &nbsp;|&nbsp; Job Role: ${emp.jobRole || '—'}</p>
    <h2>Employee Information</h2>
    <div class="info">
      <div class="info-item"><label>Full Name</label><span>${emp.name || '—'}</span></div>
      <div class="info-item"><label>Email</label><span>${emp.email || '—'}</span></div>
      <div class="info-item"><label>Job Role</label><span>${emp.jobRole || '—'}</span></div>
      <div class="info-item"><label>Employee ID</label><span>${emp.userId || emp.id || '—'}</span></div>
      <div class="info-item"><label>Join Date</label><span>${emp.createdAt ? new Date(emp.createdAt).toLocaleDateString() : '—'}</span></div>
      <div class="info-item"><label>Status</label><span>${emp.status || 'Active'}</span></div>
    </div>
    <h2>Assessment Reports (${empReports.length})</h2>
    ${empReports.length > 0 ? `<table><thead><tr><th>Assessment</th><th>Score</th><th>Classification</th><th>Date</th></tr></thead><tbody>${rows}</tbody></table>` : '<p style="color:#94a3b8">No assessments completed.</p>'}
    <h2>Learning Modules (${empAssignments.length})</h2>
    ${empAssignments.length > 0 ? `<table><thead><tr><th>Module</th><th>Status</th><th>Assigned</th><th>Completed</th></tr></thead><tbody>${modRows}</tbody></table>` : '<p style="color:#94a3b8">No modules assigned.</p>'}
    <div class="footer">SkillForge AI — Confidential Employee Report &nbsp;|&nbsp; ${new Date().toISOString()}</div>
    </body></html>`;
  const blob = new Blob([html], { type: 'text/html' });
  const url = URL.createObjectURL(blob);
  const w = window.open(url, '_blank');
  if (w) { w.onload = () => { w.focus(); w.print(); }; }
}

// ── Employee Detail Popup ──────────────────────────────────────────────────────

function EmployeeDetailPopup({ employee: emp, allReports, allAssignments, modules, users, onClose }) {
  const [detailTab, setDetailTab] = useState('info');
  const uid = emp.userId || emp.id;
  const empReports = allReports.filter(r => r.userId === uid).sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));
  const empAssignments = allAssignments.filter(a => a.userId === uid);
  const modMap = Object.fromEntries(modules.map(m => [m.id, m]));
  const timeline = buildTimeline(empReports, empAssignments, modMap);
  const manager = users.find(u => (u.userId || u.id) === emp.managerId || (u.userId || u.id) === emp.manager_id);
  const latestReport = empReports[0];
  const completedMods = empAssignments.filter(a => a.status === 'completed').length;

  const detailTabs = [
    { id: 'info', label: '👤 Info' },
    { id: 'assessments', label: `📝 Assessments (${empReports.length})` },
    { id: 'modules', label: `📚 Modules (${empAssignments.length})` },
    { id: 'timeline', label: '🕐 Timeline' },
  ];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" />
      <div className="relative w-full max-w-3xl max-h-[90vh] flex flex-col rounded-2xl border border-slate-700/60 bg-[#0F172A] shadow-2xl overflow-hidden" onClick={e => e.stopPropagation()}>

        {/* Header */}
        <div className="flex items-start justify-between p-5 border-b border-slate-700/50 bg-slate-800/40">
          <div className="flex items-center gap-3">
            <div className="w-11 h-11 rounded-xl bg-indigo-600/20 border border-indigo-500/30 flex items-center justify-center text-xl">👤</div>
            <div>
              <h2 className="text-base font-black text-white">{emp.name || '—'}</h2>
              <p className="text-xs text-slate-400">{emp.email} &nbsp;·&nbsp; {emp.jobRole || 'No role'}</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={() => exportEmployeePDF(emp, empReports, empAssignments, modMap)}
              className="px-3 py-1.5 rounded-lg bg-indigo-600/20 border border-indigo-500/30 text-indigo-300 hover:bg-indigo-600/30 text-xs font-bold transition-all flex items-center gap-1">
              ⬇ PDF
            </button>
            <button onClick={onClose} className="w-8 h-8 rounded-lg bg-slate-700/50 hover:bg-slate-700 text-slate-400 hover:text-white flex items-center justify-center transition-all">&times;</button>
          </div>
        </div>

        {/* Quick stats bar */}
        <div className="grid grid-cols-4 divide-x divide-slate-700/50 border-b border-slate-700/50">
          {[
            { label: 'Assessments', value: empReports.length, color: 'text-indigo-400' },
            { label: 'Latest Score', value: latestReport ? `${latestReport.score}%` : '—', color: latestReport?.score >= 70 ? 'text-emerald-400' : latestReport?.score ? 'text-amber-400' : 'text-slate-500' },
            { label: 'Avg Progress', value: empAssignments.length > 0 ? `${Math.round(empAssignments.reduce((s,a) => s+(a.progress||0),0)/empAssignments.length)}%` : '—', color: 'text-emerald-400' },
            { label: 'Classification', value: latestReport?.performanceClassification?.label || '—', color: 'text-slate-300' },
          ].map((s, i) => (
            <div key={i} className="py-3 px-4 text-center">
              <p className={`text-sm font-black ${s.color}`}>{s.value}</p>
              <p className="text-xs text-slate-600 font-semibold">{s.label}</p>
            </div>
          ))}
        </div>

        {/* Inner tabs */}
        <div className="flex gap-1 px-4 pt-3 pb-1 border-b border-slate-700/30 bg-slate-800/20">
          {detailTabs.map(t => (
            <button key={t.id} onClick={() => setDetailTab(t.id)}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all whitespace-nowrap ${detailTab === t.id ? 'bg-indigo-600 text-white' : 'text-slate-400 hover:text-white hover:bg-slate-700/40'}`}>
              {t.label}
            </button>
          ))}
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-5">

          {/* Info tab */}
          {detailTab === 'info' && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                {[
                  { label: 'Full Name', value: emp.name || '—' },
                  { label: 'Email', value: emp.email || '—' },
                  { label: 'Job Role', value: emp.jobRole || '—' },
                  { label: 'Employee ID', value: uid || '—' },
                  { label: 'Department', value: emp.department || '—' },
                  { label: 'Manager', value: manager?.name || emp.managerName || '—' },
                  { label: 'Join Date', value: emp.createdAt ? new Date(emp.createdAt).toLocaleDateString() : '—' },
                  { label: 'Status', value: emp.status || 'Active' },
                ].map(item => (
                  <div key={item.label} className="rounded-xl bg-slate-800/60 border border-slate-700/40 p-3">
                    <p className="text-xs font-bold text-slate-500 uppercase tracking-widest mb-0.5">{item.label}</p>
                    <p className="text-sm font-semibold text-white truncate" title={item.value}>{item.value}</p>
                  </div>
                ))}
              </div>
              {emp.jobDescription && (
                <div className="rounded-xl bg-slate-800/60 border border-slate-700/40 p-3">
                  <p className="text-xs font-bold text-slate-500 uppercase tracking-widest mb-1">Job Description</p>
                  <p className="text-xs text-slate-400 leading-relaxed line-clamp-4">{emp.jobDescription}</p>
                </div>
              )}
            </div>
          )}

          {/* Assessments tab */}
          {detailTab === 'assessments' && (
            <div className="space-y-3">
              {empReports.length === 0 ? (
                <div className="text-center py-10">
                  <div className="text-4xl mb-2 opacity-20">📝</div>
                  <p className="text-sm text-slate-500">No assessments completed yet</p>
                </div>
              ) : empReports.map(r => (
                <div key={r.id} className="rounded-xl bg-slate-800/60 border border-slate-700/40 p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-bold text-white truncate">{r.assessmentTitle || 'Assessment'}</p>
                      <p className="text-xs text-slate-500 mt-0.5">{r.createdAt ? new Date(r.createdAt).toLocaleDateString() : '—'}</p>
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0">
                      {r.score != null && (
                        <span className={`text-lg font-black ${r.score >= 80 ? 'text-emerald-400' : r.score >= 60 ? 'text-amber-400' : 'text-red-400'}`}>{r.score}%</span>
                      )}
                    </div>
                  </div>
                  {r.performanceClassification?.label && (
                    <span className={`mt-2 inline-block text-xs font-bold px-2.5 py-0.5 rounded-full border ${classTag(r.performanceClassification.label)}`}>
                      {r.performanceClassification.label}
                    </span>
                  )}
                  {r.weakAreas?.length > 0 && (
                    <div className="mt-2">
                      <p className="text-xs font-semibold text-slate-500 mb-1">Skill gaps:</p>
                      <div className="flex flex-wrap gap-1">
                        {r.weakAreas.slice(0, 5).map((w, i) => (
                          <span key={i} className="text-xs px-2 py-0.5 rounded-full bg-red-500/10 text-red-300 border border-red-500/20">{w}</span>
                        ))}
                      </div>
                    </div>
                  )}
                  {r.strongAreas?.length > 0 && (
                    <div className="mt-2">
                      <p className="text-xs font-semibold text-slate-500 mb-1">Strengths:</p>
                      <div className="flex flex-wrap gap-1">
                        {r.strongAreas.slice(0, 5).map((s, i) => (
                          <span key={i} className="text-xs px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-300 border border-emerald-500/20">{s}</span>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}

          {/* Modules tab */}
          {detailTab === 'modules' && (
            <div className="space-y-3">
              {empAssignments.length === 0 ? (
                <div className="text-center py-10">
                  <div className="text-4xl mb-2 opacity-20">📚</div>
                  <p className="text-sm text-slate-500">No modules assigned yet</p>
                </div>
              ) : empAssignments.map(a => {
                const mod = modMap[a.moduleId];
                return (
                  <div key={a.id || a.moduleId} className="rounded-xl bg-slate-800/60 border border-slate-700/40 p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-bold text-white truncate">{mod?.title || a.moduleId || 'Module'}</p>
                        {mod?.description && <p className="text-xs text-slate-500 mt-0.5 line-clamp-1">{mod.description}</p>}
                      </div>
                      <span className={`flex-shrink-0 text-xs font-bold px-2.5 py-0.5 rounded-full border capitalize ${
                        a.status === 'completed' ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30' :
                        a.status === 'in_progress' ? 'bg-amber-500/20 text-amber-300 border-amber-500/30' :
                        'bg-slate-700/40 text-slate-400 border-slate-600/40'
                      }`}>{a.status || 'assigned'}</span>
                    </div>
                    <div className="mt-2 flex items-center gap-4 text-xs text-slate-500">
                      {a.assignedAt && <span>Assigned: {new Date(a.assignedAt).toLocaleDateString()}</span>}
                      {a.startedAt && <span>Started: {new Date(a.startedAt).toLocaleDateString()}</span>}
                      {a.completedAt && <span>Completed: {new Date(a.completedAt).toLocaleDateString()}</span>}
                    </div>
                    {mod?.estimatedDuration && <p className="mt-1 text-xs text-slate-600">Duration: {mod.estimatedDuration}</p>}
                  </div>
                );
              })}
            </div>
          )}

          {/* Timeline tab */}
          {detailTab === 'timeline' && (
            <div>
              {timeline.length === 0 ? (
                <div className="text-center py-10">
                  <div className="text-4xl mb-2 opacity-20">🕐</div>
                  <p className="text-sm text-slate-500">No activity yet</p>
                </div>
              ) : (
                <div className="relative">
                  <div className="absolute left-4 top-0 bottom-0 w-0.5 bg-slate-700/50" />
                  <div className="space-y-4 pl-10">
                    {timeline.map((ev, i) => (
                      <div key={i} className="relative">
                        <div className="absolute -left-[26px] top-1 w-5 h-5 rounded-full bg-slate-800 border-2 border-slate-600 flex items-center justify-center text-[10px]">{ev.icon}</div>
                        <div className="rounded-xl bg-slate-800/60 border border-slate-700/40 p-3">
                          <p className={`text-sm font-semibold ${ev.color}`}>{ev.label}</p>
                          {ev.sub && <p className="text-xs text-slate-500 mt-0.5">{ev.sub}</p>}
                          <p className="text-xs text-slate-600 mt-0.5">{ev.date.toLocaleDateString()} {ev.date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

        </div>
      </div>
    </div>
  );
}

// ── Main AdminDashboard ────────────────────────────────────────────────────────

export default function AdminDashboard() {
  const { user } = useAuth();
  const navigate = useNavigate();

  // Core
  const [loading, setLoading] = useState(true);
  const [company, setCompany] = useState(null);
  const [toast, setToast] = useState(null);
  const [activeTab, setActiveTab] = useState('overview');
  const [stats, setStats] = useState(null);
  const [users, setUsers] = useState([]);
  const [modules, setModules] = useState([]);

  // Approvals
  const [pendingRequests, setPendingRequests] = useState([]);
  const [allRequests, setAllRequests] = useState([]);
  const [approvingId, setApprovingId] = useState(null);
  const [selectedRequest, setSelectedRequest] = useState(null);

  // Reports
  const [allReports, setAllReports] = useState([]);
  const [allAssignments, setAllAssignments] = useState([]);
  const [reportSearch, setReportSearch] = useState('');
  const [reportSort, setReportSort] = useState({ field: 'name', dir: 'asc' });
  const [selectedEmployee, setSelectedEmployee] = useState(null);

  // Access codes
  const [codes, setCodes] = useState([]);
  const [codesLoading, setCodesLoading] = useState(false);
  const [codeBusy, setCodeBusy] = useState(null);
  const [showNewForm, setShowNewForm] = useState(false);
  const [newCodeRole, setNewCodeRole] = useState('employee');
  const [newCodeLabel, setNewCodeLabel] = useState('');
  const [newCodeMax, setNewCodeMax] = useState('');
  const [newCodeExpiry, setNewCodeExpiry] = useState('');

  const showToast = useCallback((msg, type = 'info') => setToast({ message: msg, type }), []);

  useEffect(() => {
    if (!user || user.role !== 'admin') { navigate('/dashboard'); return; }
    loadAll();
    loadCodes();
  }, [user, navigate]);

  const loadAll = async () => {
    setLoading(true);
    try {
      authFetch('/api/admin/dashboard').then(d => { if (d?.company) setCompany(d.company); }).catch(() => {});

      const [usersRes, modulesRes, assignmentsRes, requestsRes, reportsRes] = await Promise.allSettled([
        authFetch('/api/users'),
        authFetch('/api/modules'),
        authFetch('/api/assignments'),
        authFetch('/api/assignments/requests'),
        authFetch('/api/assessments/reports/all').catch(() => []),
      ]);

      const usersData = usersRes.status === 'fulfilled' ? (usersRes.value?.users || usersRes.value || []) : [];
      const modulesData = modulesRes.status === 'fulfilled' ? (modulesRes.value?.modules || modulesRes.value || []) : [];
      const assignmentsData = assignmentsRes.status === 'fulfilled' ? (assignmentsRes.value?.assignments || assignmentsRes.value || []) : [];
      const requestsData = requestsRes.status === 'fulfilled' ? (requestsRes.value?.requests || requestsRes.value || []) : [];
      const reportsData = reportsRes.status === 'fulfilled' ? (reportsRes.value || []) : [];

      const uArr = Array.isArray(usersData) ? usersData : [];
      const mArr = Array.isArray(modulesData) ? modulesData : [];
      const aArr = Array.isArray(assignmentsData) ? assignmentsData : [];
      const rqArr = Array.isArray(requestsData) ? requestsData : [];
      const rpArr = Array.isArray(reportsData) ? reportsData : [];

      setUsers(uArr);
      setModules(mArr);
      setAllAssignments(aArr);
      setAllReports(rpArr);

      const reqArr = rqArr;
      setAllRequests(reqArr);
      setPendingRequests(reqArr.filter(r => r.status === 'pending'));

      const completedCount = aArr.filter(a => a.status === 'completed' || a.completed === true).length;
      const avgCompletionRate = aArr.length > 0 ? Math.round((completedCount / aArr.length) * 100) : 0;
      const avgAssessmentScore = rpArr.length > 0 ? Math.round(rpArr.reduce((s, r) => s + (r.score || 0), 0) / rpArr.length) : 0;

      setStats({
        totalUsers: uArr.length,
        totalAdmins: uArr.filter(u => u.role === 'admin').length,
        totalManagers: uArr.filter(u => u.role === 'manager').length,
        totalEmployees: uArr.filter(u => u.role === 'employee').length,
        activeSessions: aArr.filter(a => a.status === 'in_progress').length,
        completedModules: completedCount,
        totalModules: mArr.length,
        avgCompletionRate,
        totalAssignments: aArr.length,
        pendingAssignments: aArr.filter(a => a.status === 'assigned').length,
        pendingRequests: reqArr.filter(r => r.status === 'pending').length,
        assessmentsCompleted: rpArr.length,
        avgAssessmentScore,
      });
    } catch (err) {
      showToast(err.message || 'Failed to load dashboard', 'error');
    } finally {
      setLoading(false);
    }
  };

  const loadCodes = () => {
    setCodesLoading(true);
    authFetch('/api/admin/codes')
      .then(d => setCodes(Array.isArray(d) ? d : (d?.codes || [])))
      .catch(() => {})
      .finally(() => setCodesLoading(false));
  };

  // Approval handlers
  const approveRequest = async (id) => {
    setApprovingId(id);
    try {
      await authFetch(`/api/assignments/requests/${id}/approve`, { method: 'POST' });
      showToast('Request approved — assignment created', 'success');
      setPendingRequests(prev => prev.filter(r => r.id !== id));
      setAllRequests(prev => prev.map(r => r.id === id ? { ...r, status: 'approved' } : r));
      setStats(prev => prev ? { ...prev, pendingRequests: Math.max(0, prev.pendingRequests - 1) } : prev);
    } catch (err) { showToast(err.message || 'Failed to approve', 'error'); }
    finally { setApprovingId(null); }
  };

  const rejectRequest = async (id) => {
    setApprovingId(id);
    try {
      await authFetch(`/api/assignments/requests/${id}/reject`, { method: 'POST' });
      showToast('Request rejected', 'info');
      setPendingRequests(prev => prev.filter(r => r.id !== id));
      setAllRequests(prev => prev.map(r => r.id === id ? { ...r, status: 'rejected' } : r));
      setStats(prev => prev ? { ...prev, pendingRequests: Math.max(0, prev.pendingRequests - 1) } : prev);
    } catch (err) { showToast(err.message || 'Failed to reject', 'error'); }
    finally { setApprovingId(null); }
  };

  // Access code handlers
  const doCodeAction = async (codeId, payload, label) => {
    setCodeBusy(codeId + label);
    try {
      await authFetch(`/api/admin/codes/${codeId}`, { method: 'PUT', body: JSON.stringify(payload) });
      showToast(`Code ${label}`, 'success');
      loadCodes();
    } catch (err) { showToast(err.message, 'error'); }
    finally { setCodeBusy(null); }
  };

  const createCode = async () => {
    setCodeBusy('create');
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
      showToast('New access code created', 'success');
      setShowNewForm(false);
      setNewCodeLabel(''); setNewCodeMax(''); setNewCodeExpiry(''); setNewCodeRole('employee');
      loadCodes();
    } catch (err) { showToast(err.message, 'error'); }
    finally { setCodeBusy(null); }
  };

  const deleteCode = async (codeId) => {
    if (!window.confirm('Delete this access code? Users holding it can no longer sign up.')) return;
    setCodeBusy(codeId + 'del');
    try {
      await authFetch(`/api/admin/codes/${codeId}`, { method: 'DELETE' });
      showToast('Code deleted', 'success');
      loadCodes();
    } catch (err) { showToast(err.message, 'error'); }
    finally { setCodeBusy(null); }
  };

  // Report helpers
  const modMap = Object.fromEntries(modules.map(m => [m.id, m]));
  const employeeUsers = users.filter(u => u.role === 'employee');

  const getEmpLastActivity = (uid) => {
    const dates = [];
    allReports.filter(r => r.userId === uid).forEach(r => r.createdAt && dates.push(new Date(r.createdAt)));
    allAssignments.filter(a => a.userId === uid).forEach(a => {
      if (a.completedAt) dates.push(new Date(a.completedAt));
      else if (a.startedAt) dates.push(new Date(a.startedAt));
      else if (a.assignedAt) dates.push(new Date(a.assignedAt));
    });
    return dates.length > 0 ? dates.sort((a, b) => b - a)[0] : null;
  };

  const toggleSort = (field) => {
    setReportSort(prev => prev.field === field ? { field, dir: prev.dir === 'asc' ? 'desc' : 'asc' } : { field, dir: 'asc' });
  };

  const filteredEmployees = employeeUsers.filter(emp => {
    if (!reportSearch.trim()) return true;
    const q = reportSearch.toLowerCase();
    return (emp.name || '').toLowerCase().includes(q) || (emp.email || '').toLowerCase().includes(q) || (emp.jobRole || '').toLowerCase().includes(q);
  }).sort((a, b) => {
    const { field, dir } = reportSort;
    const uid_a = a.userId || a.id;
    const uid_b = b.userId || b.id;
    let av, bv;
    if (field === 'name') { av = (a.name || '').toLowerCase(); bv = (b.name || '').toLowerCase(); }
    else if (field === 'score') {
      av = allReports.filter(r => r.userId === uid_a).sort((x, y) => new Date(y.createdAt || 0) - new Date(x.createdAt || 0))[0]?.score ?? -1;
      bv = allReports.filter(r => r.userId === uid_b).sort((x, y) => new Date(y.createdAt || 0) - new Date(x.createdAt || 0))[0]?.score ?? -1;
    }
    else if (field === 'activity') {
      av = getEmpLastActivity(uid_a)?.getTime() ?? 0;
      bv = getEmpLastActivity(uid_b)?.getTime() ?? 0;
    }
    else { av = (a.jobRole || '').toLowerCase(); bv = (b.jobRole || '').toLowerCase(); }
    if (typeof av === 'number') return dir === 'asc' ? av - bv : bv - av;
    return dir === 'asc' ? av.localeCompare(bv) : bv.localeCompare(av);
  });

  if (!user || user.role !== 'admin') return null;

  const managerCodes = codes.filter(c => c.role === 'manager');
  const employeeCodes = codes.filter(c => c.role === 'employee');

  const tabs = [
    { id: 'overview',   label: '📊 Overview' },
    { id: 'codes',      label: '🔑 Access Codes' },
    { id: 'approvals',  label: `⏳ Approvals${stats?.pendingRequests ? ` (${stats.pendingRequests})` : ''}` },
    { id: 'reports',    label: '📈 Reports' },
    { id: 'assignments',label: '📋 Assignments' },
  ];

  const statCards = [
    { label: 'Total Users',       value: stats?.totalUsers ?? '—',             icon: '👥', borderClass: 'border-indigo-500/20',  bgClass: 'bg-indigo-500/5',  textClass: 'text-indigo-400' },
    { label: 'Managers',          value: stats?.totalManagers ?? '—',           icon: '👔', borderClass: 'border-sky-500/20',     bgClass: 'bg-sky-500/5',     textClass: 'text-sky-400' },
    { label: 'Employees',         value: stats?.totalEmployees ?? '—',          icon: '👨‍💼', borderClass: 'border-fuchsia-500/20', bgClass: 'bg-fuchsia-500/5', textClass: 'text-fuchsia-400' },
    { label: 'Active Sessions',   value: stats?.activeSessions ?? '—',          icon: '⚡', borderClass: 'border-amber-500/20',  bgClass: 'bg-amber-500/5',   textClass: 'text-amber-400' },
    { label: 'Modules',           value: stats?.totalModules ?? '—',            icon: '📚', borderClass: 'border-emerald-500/20', bgClass: 'bg-emerald-500/5', textClass: 'text-emerald-400' },
    { label: 'Avg Completion',    value: stats ? `${stats.avgCompletionRate}%` : '—', icon: '📊', borderClass: 'border-cyan-500/20', bgClass: 'bg-cyan-500/5', textClass: 'text-cyan-400' },
    { label: 'Completed',         value: stats?.completedModules ?? '—',        icon: '✅', borderClass: 'border-emerald-500/20', bgClass: 'bg-emerald-500/5', textClass: 'text-emerald-400' },
    { label: 'Pending Approvals', value: stats?.pendingRequests ?? '—',         icon: '⏳', borderClass: 'border-rose-500/20',   bgClass: 'bg-rose-500/5',    textClass: 'text-rose-400' },
    { label: 'Assessments Done',  value: stats?.assessmentsCompleted ?? '—',    icon: '📝', borderClass: 'border-amber-500/20',  bgClass: 'bg-amber-500/5',   textClass: 'text-amber-400' },
    { label: 'Avg Score',         value: stats?.avgAssessmentScore ? `${stats.avgAssessmentScore}%` : '—', icon: '🎯', borderClass: 'border-indigo-500/20', bgClass: 'bg-indigo-500/5', textClass: 'text-indigo-400' },
  ];

  return (
    <div className="min-h-screen bg-[#0F172A] px-4 sm:px-6 py-8 max-w-7xl mx-auto">
      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}

      {/* Employee detail popup */}
      {selectedEmployee && (
        <EmployeeDetailPopup
          employee={selectedEmployee}
          allReports={allReports}
          allAssignments={allAssignments}
          modules={modules}
          users={users}
          onClose={() => setSelectedEmployee(null)}
        />
      )}

      {/* Request detail popup (approvals) */}
      {selectedRequest && (() => {
        const req = selectedRequest;
        const manager = users.find(u => (u.userId || u.id) === req.manager_id);
        const employee = users.find(u => (u.userId || u.id) === req.employee_id);
        const mod = modules.find(m => m.id === req.module_id);
        return (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={() => setSelectedRequest(null)}>
            <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />
            <div className="relative w-full max-w-lg rounded-2xl border border-slate-700/60 bg-[#131C2E] shadow-2xl overflow-hidden" onClick={e => e.stopPropagation()}>
              <div className="flex items-center justify-between p-5 border-b border-slate-700/50">
                <div><h2 className="text-base font-black text-white">Assignment Request</h2><p className="text-xs text-slate-400 mt-0.5">Review and take action</p></div>
                <button onClick={() => setSelectedRequest(null)} className="w-8 h-8 rounded-lg bg-slate-700/50 hover:bg-slate-700 text-slate-400 hover:text-white flex items-center justify-center transition-all">&times;</button>
              </div>
              <div className="p-5 space-y-4">
                <div className="grid grid-cols-2 gap-3">
                  {[
                    { label: 'Module', value: mod?.title || req.module_id || '—', icon: '📚' },
                    { label: 'Status', value: req.status || 'pending', icon: '⏳', cls: 'capitalize' },
                    { label: 'Employee', value: employee?.name || req.employee_id || '—', icon: '👤' },
                    { label: 'Manager', value: manager?.name || req.manager_id || '—', icon: '👔' },
                    { label: 'Created', value: new Date(req.requested_at || req.created_at || Date.now()).toLocaleDateString(), icon: '📅' },
                    { label: 'Priority', value: req.priority || 'medium', icon: '🎯', cls: 'capitalize' },
                  ].map(item => (
                    <div key={item.label} className="rounded-lg bg-slate-800/50 border border-slate-700/40 p-3">
                      <p className="text-xs font-bold text-slate-500 uppercase tracking-widest mb-0.5">{item.icon} {item.label}</p>
                      <p className={`text-sm font-semibold text-white ${item.cls || ''}`}>{item.value}</p>
                    </div>
                  ))}
                </div>
              </div>
              {req.status === 'pending' && (
                <div className="flex gap-3 p-5 border-t border-slate-700/50">
                  <button onClick={() => { approveRequest(req.id); setSelectedRequest(null); }} disabled={approvingId === req.id}
                    className="flex-1 py-2.5 rounded-xl bg-emerald-600/20 border border-emerald-500/30 text-emerald-300 hover:bg-emerald-600/30 text-sm font-bold transition-all disabled:opacity-50">
                    ✓ Approve
                  </button>
                  <button onClick={() => { rejectRequest(req.id); setSelectedRequest(null); }} disabled={approvingId === req.id}
                    className="flex-1 py-2.5 rounded-xl bg-red-600/20 border border-red-500/30 text-red-300 hover:bg-red-600/30 text-sm font-bold transition-all disabled:opacity-50">
                    ✕ Reject
                  </button>
                </div>
              )}
            </div>
          </div>
        );
      })()}

      {/* Company Info Banner */}
      {company && (
        <div className="mb-5 flex items-center justify-between rounded-xl border border-indigo-500/20 bg-indigo-500/5 px-5 py-3">
          <div className="flex items-center gap-3">
            <span className="text-2xl">🏢</span>
            <div>
              <p className="font-bold text-white text-sm">{company.name}</p>
              <p className="text-xs text-slate-400">{company.domain || 'Admin Panel'} &nbsp;·&nbsp; <span className="text-slate-500">ID: {company.id || '—'}</span></p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-bold border ${
              company.plan === 'enterprise' ? 'bg-purple-500/20 text-purple-300 border-purple-500/30' :
              company.plan === 'standard'   ? 'bg-indigo-500/20 text-indigo-300 border-indigo-500/30' :
              'bg-amber-500/20 text-amber-300 border-amber-500/30'
            }`}>{company.plan ? company.plan.charAt(0).toUpperCase() + company.plan.slice(1) : 'Trial'}</span>
            <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-bold border ${company.status === 'active' ? 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30' : 'bg-red-500/20 text-red-400 border-red-500/30'}`}>
              {company.status ? company.status.charAt(0).toUpperCase() + company.status.slice(1) : 'Active'}
            </span>
            {stats?.pendingRequests > 0 && (
              <button onClick={() => setActiveTab('approvals')} className="ml-2 flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-bold bg-rose-500/20 text-rose-300 border border-rose-500/30 hover:bg-rose-500/30 transition-all">
                ⚠️ {stats.pendingRequests} Pending
              </button>
            )}
          </div>
        </div>
      )}

      {/* Page header */}
      <div className="mb-8 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 rounded-2xl bg-indigo-600/20 border border-indigo-500/30 flex items-center justify-center text-2xl">👑</div>
          <div>
            <h1 className="text-3xl font-black text-white">Admin Dashboard</h1>
            <p className="text-slate-400 text-sm">Platform-wide analytics &amp; enterprise control</p>
          </div>
        </div>
        <button onClick={() => { loadAll(); loadCodes(); }}
          className="px-4 py-2 rounded-xl bg-slate-800/60 border border-slate-700/50 text-slate-400 hover:text-white text-sm font-semibold transition-all flex items-center gap-2">
          <span className="text-base">↻</span> Refresh
        </button>
      </div>

      {/* Stats */}
      {loading ? (
        <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mb-8">{[...Array(10)].map((_, i) => <Skeleton key={i} className="h-24 rounded-xl" />)}</div>
      ) : (
        <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mb-8">
          {statCards.map((s, i) => <StatCard key={i} {...s} />)}
        </div>
      )}

      {/* Tabs */}
      <div className="flex gap-2 mb-6 overflow-x-auto pb-2">
        {tabs.map(tab => (
          <button key={tab.id} onClick={() => setActiveTab(tab.id)}
            className={`px-4 py-2 rounded-lg font-semibold whitespace-nowrap transition-all text-sm ${
              activeTab === tab.id
                ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-500/30'
                : 'bg-slate-800/50 border border-slate-700 text-slate-400 hover:text-white'
            }`}>
            {tab.label}
          </button>
        ))}
      </div>

      {/* ═══════════════════ OVERVIEW ═══════════════════ */}
      {activeTab === 'overview' && (
        <div className="space-y-6">
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
            {/* User Breakdown */}
            <div className="rounded-2xl border border-slate-700/50 bg-slate-800/30 p-6">
              <div className="flex items-center justify-between mb-5">
                <h3 className="text-xs font-bold text-slate-400 uppercase tracking-widest">User Breakdown</h3>
                <span className="text-2xl">👥</span>
              </div>
              <div className="space-y-3">
                {[
                  { label: 'Total Users', value: stats?.totalUsers || 0, bar: 100, color: 'bg-indigo-500' },
                  { label: 'Admins',    value: stats?.totalAdmins || 0, bar: stats?.totalUsers ? Math.round((stats.totalAdmins / stats.totalUsers) * 100) : 0, color: 'bg-rose-500' },
                  { label: 'Managers', value: stats?.totalManagers || 0, bar: stats?.totalUsers ? Math.round((stats.totalManagers / stats.totalUsers) * 100) : 0, color: 'bg-amber-500' },
                  { label: 'Employees',value: stats?.totalEmployees || 0, bar: stats?.totalUsers ? Math.round((stats.totalEmployees / stats.totalUsers) * 100) : 0, color: 'bg-emerald-500' },
                ].map((item, i) => (
                  <div key={i}>
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-sm text-slate-300">{item.label}</span>
                      <span className="text-sm font-bold text-white">{item.value}</span>
                    </div>
                    <div className="h-1.5 rounded-full bg-slate-700/50"><div className={`h-full rounded-full ${item.color} transition-all`} style={{ width: `${item.bar}%` }} /></div>
                  </div>
                ))}
              </div>
              <button onClick={() => navigate('/admin/users')} className="mt-5 w-full py-2 rounded-xl bg-slate-700/40 hover:bg-slate-700/70 text-xs font-bold text-slate-300 transition-all">Manage Users →</button>
            </div>

            {/* Learning Activity */}
            <div className="rounded-2xl border border-slate-700/50 bg-slate-800/30 p-6">
              <div className="flex items-center justify-between mb-5">
                <h3 className="text-xs font-bold text-slate-400 uppercase tracking-widest">Learning Activity</h3>
                <span className="text-2xl">📚</span>
              </div>
              <div className="space-y-4">
                {[
                  { label: 'Total Modules', value: stats?.totalModules || 0, icon: '📚', sub: 'in library' },
                  { label: 'Active Sessions', value: stats?.activeSessions || 0, icon: '⚡', sub: 'in progress' },
                  { label: 'Completed', value: stats?.completedModules || 0, icon: '✅', sub: 'finished' },
                  { label: 'Avg Completion', value: `${stats?.avgCompletionRate || 0}%`, icon: '📊', sub: 'overall rate' },
                ].map((item, i) => (
                  <div key={i} className="flex items-center gap-3">
                    <span className="text-xl w-8 flex-shrink-0">{item.icon}</span>
                    <div className="flex-1 min-w-0">
                      <p className="text-xs text-slate-500">{item.label}</p>
                      <p className="text-base font-black text-white leading-tight">{item.value} <span className="text-xs font-normal text-slate-500">{item.sub}</span></p>
                    </div>
                  </div>
                ))}
              </div>
              <button onClick={() => navigate('/admin/modules')} className="mt-5 w-full py-2 rounded-xl bg-slate-700/40 hover:bg-slate-700/70 text-xs font-bold text-slate-300 transition-all">Manage Modules →</button>
            </div>

            {/* Assignment Pipeline */}
            <div className="rounded-2xl border border-slate-700/50 bg-slate-800/30 p-6">
              <div className="flex items-center justify-between mb-5">
                <h3 className="text-xs font-bold text-slate-400 uppercase tracking-widest">Assignment Pipeline</h3>
                <span className="text-2xl">📋</span>
              </div>
              <div className="grid grid-cols-2 gap-3 mb-4">
                {[
                  { label: 'Total', value: stats?.totalAssignments || 0, color: 'border-indigo-500/30 bg-indigo-500/5 text-indigo-400' },
                  { label: 'In Progress', value: stats?.activeSessions || 0, color: 'border-amber-500/30 bg-amber-500/5 text-amber-400' },
                  { label: 'Completed', value: stats?.completedModules || 0, color: 'border-emerald-500/30 bg-emerald-500/5 text-emerald-400' },
                  { label: 'Pending', value: stats?.pendingAssignments || 0, color: 'border-sky-500/30 bg-sky-500/5 text-sky-400' },
                ].map((s, i) => (
                  <div key={i} className={`rounded-xl border p-3 text-center ${s.color}`}>
                    <p className="text-xl font-black">{s.value}</p>
                    <p className="text-xs font-bold opacity-70 uppercase tracking-wider mt-0.5">{s.label}</p>
                  </div>
                ))}
              </div>
              {stats?.pendingRequests > 0 && (
                <div className="rounded-xl bg-rose-500/10 border border-rose-500/20 p-3 mb-3 flex items-center justify-between">
                  <div>
                    <p className="text-xs font-bold text-rose-300">{stats.pendingRequests} Pending Approval{stats.pendingRequests > 1 ? 's' : ''}</p>
                    <p className="text-xs text-rose-400/60">Requires your review</p>
                  </div>
                  <button onClick={() => setActiveTab('approvals')} className="text-xs font-bold text-rose-300 hover:text-rose-200">Review →</button>
                </div>
              )}
              <button onClick={() => navigate('/admin/assignments')} className="w-full py-2 rounded-xl bg-slate-700/40 hover:bg-slate-700/70 text-xs font-bold text-slate-300 transition-all">Manage Assignments →</button>
            </div>
          </div>

          {/* Quick access codes preview on overview */}
          <div className="rounded-2xl border border-amber-500/20 bg-amber-500/5 p-5">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <span className="text-xl">🔑</span>
                <div>
                  <h3 className="text-sm font-black text-amber-300">Company Access Codes</h3>
                  <p className="text-xs text-slate-500">Share these codes to onboard your team</p>
                </div>
              </div>
              <button onClick={() => setActiveTab('codes')} className="px-3 py-1.5 rounded-lg bg-amber-500/20 border border-amber-500/30 text-amber-300 text-xs font-bold hover:bg-amber-500/30 transition-all">Manage All →</button>
            </div>
            {codesLoading ? (
              <div className="text-xs text-slate-500">Loading codes...</div>
            ) : codes.length === 0 ? (
              <p className="text-xs text-slate-500">No access codes yet. Go to Access Codes tab to create one.</p>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {[...managerCodes.slice(0, 1), ...employeeCodes.slice(0, 1)].map(code => (
                  <div key={code.id} className={`flex items-center justify-between rounded-xl border px-4 py-3 ${code.role === 'manager' ? 'border-amber-500/30 bg-amber-500/5' : 'border-indigo-500/30 bg-indigo-500/5'}`}>
                    <div>
                      <p className="text-xs font-bold text-slate-500 uppercase tracking-widest mb-0.5">{code.role} code</p>
                      <p className={`font-mono font-bold tracking-widest ${code.role === 'manager' ? 'text-amber-300' : 'text-indigo-300'}`}>{code.code}</p>
                      <p className="text-xs text-slate-600 mt-0.5">{code.usageCount || 0} signups{code.maxUsage ? ` / ${code.maxUsage}` : ''}</p>
                    </div>
                    <div className="flex gap-1.5">
                      <CopyBtn text={code.code} />
                      <ShareBtn code={code.code} />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ═══════════════════ ACCESS CODES ═══════════════════ */}
      {activeTab === 'codes' && (
        <div className="space-y-6">
          {/* Info banner */}
          <div className="rounded-xl bg-slate-800/50 border border-slate-700/40 p-4 text-sm text-slate-400">
            <p className="font-semibold text-slate-300 mb-1">🔑 How Access Codes Work</p>
            <p>Share these codes with your team. On signup: role is auto-assigned (Manager/Employee), user is linked to your company, JD is mapped and a pre-assessment is generated immediately.</p>
          </div>

          {/* Create new code */}
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-black text-white">All Access Codes ({codes.length})</h3>
            <button onClick={() => setShowNewForm(v => !v)}
              className="flex items-center gap-2 px-4 py-2 bg-violet-600 hover:bg-violet-500 rounded-xl text-white font-bold text-sm transition-colors">
              {showNewForm ? '✕ Cancel' : '+ New Code'}
            </button>
          </div>

          {showNewForm && (
            <div className="bg-slate-800/60 border border-violet-500/30 rounded-2xl p-5">
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
                  <input value={newCodeLabel} onChange={e => setNewCodeLabel(e.target.value)} placeholder="e.g. Engineering Team"
                    className="w-full bg-slate-900/60 border border-slate-700 rounded-xl px-4 py-2.5 text-sm text-white placeholder-slate-600 focus:outline-none focus:border-violet-500/60" />
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-1.5">Max Uses (optional)</label>
                  <input type="number" min="1" value={newCodeMax} onChange={e => setNewCodeMax(e.target.value)} placeholder="Unlimited"
                    className="w-full bg-slate-900/60 border border-slate-700 rounded-xl px-4 py-2.5 text-sm text-white placeholder-slate-600 focus:outline-none focus:border-violet-500/60" />
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-1.5">Expiry Date (optional)</label>
                  <input type="date" value={newCodeExpiry} onChange={e => setNewCodeExpiry(e.target.value)}
                    className="w-full bg-slate-900/60 border border-slate-700 rounded-xl px-4 py-2.5 text-sm text-white focus:outline-none focus:border-violet-500/60" />
                </div>
              </div>
              <div className="flex gap-3">
                <button onClick={() => setShowNewForm(false)} className="flex-1 py-2.5 rounded-xl bg-slate-700 hover:bg-slate-600 text-white font-bold text-sm transition-colors">Cancel</button>
                <button onClick={createCode} disabled={codeBusy === 'create'} className="flex-1 py-2.5 rounded-xl bg-violet-600 hover:bg-violet-500 disabled:opacity-60 text-white font-bold text-sm transition-colors">
                  {codeBusy === 'create' ? 'Creating...' : 'Create Code'}
                </button>
              </div>
            </div>
          )}

          {codesLoading ? (
            <div className="text-center py-12 text-slate-400">Loading codes...</div>
          ) : codes.length === 0 ? (
            <div className="text-center py-12 rounded-2xl border border-slate-700/40 bg-slate-800/20">
              <div className="text-4xl mb-3 opacity-20">🔑</div>
              <p className="text-slate-400 font-semibold">No access codes yet</p>
              <p className="text-slate-600 text-sm mt-1">Create your first code to start onboarding employees</p>
            </div>
          ) : (
            <div className="space-y-6">
              {/* Manager codes */}
              <div>
                <div className="flex items-center gap-2 mb-3">
                  <span className="text-xs font-bold text-amber-300 uppercase tracking-wider">Manager Codes</span>
                  <span className="text-xs text-slate-500">({managerCodes.length})</span>
                </div>
                {managerCodes.length === 0 ? (
                  <p className="text-slate-600 text-sm">No manager codes. Create one above.</p>
                ) : (
                  <div className="space-y-3">
                    {managerCodes.map(code => <CodeCard key={code.id} code={code} busy={codeBusy} doAction={doCodeAction} deleteCode={deleteCode} />)}
                  </div>
                )}
              </div>

              {/* Employee codes */}
              <div>
                <div className="flex items-center gap-2 mb-3">
                  <span className="text-xs font-bold text-indigo-300 uppercase tracking-wider">Employee Codes</span>
                  <span className="text-xs text-slate-500">({employeeCodes.length})</span>
                </div>
                {employeeCodes.length === 0 ? (
                  <p className="text-slate-600 text-sm">No employee codes. Create one above.</p>
                ) : (
                  <div className="space-y-3">
                    {employeeCodes.map(code => <CodeCard key={code.id} code={code} busy={codeBusy} doAction={doCodeAction} deleteCode={deleteCode} />)}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {/* ═══════════════════ APPROVALS ═══════════════════ */}
      {activeTab === 'approvals' && (
        <div className="space-y-4">
          <div className="grid grid-cols-3 gap-4">
            <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 p-4 text-center">
              <p className="text-2xl font-black text-amber-400">{pendingRequests.length}</p>
              <p className="text-xs font-bold text-amber-400/70 uppercase tracking-widest mt-0.5">Pending</p>
            </div>
            <div className="rounded-xl border border-indigo-500/20 bg-indigo-500/5 p-4 text-center">
              <p className="text-2xl font-black text-indigo-400">{allRequests.length}</p>
              <p className="text-xs font-bold text-indigo-400/70 uppercase tracking-widest mt-0.5">Total Requests</p>
            </div>
            <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-4 text-center">
              <p className="text-2xl font-black text-emerald-400">{allRequests.length - pendingRequests.length}</p>
              <p className="text-xs font-bold text-emerald-400/70 uppercase tracking-widest mt-0.5">Reviewed</p>
            </div>
          </div>

          <div className="rounded-2xl border border-slate-700/40 bg-[#111827] overflow-hidden shadow-xl">
            <div className="grid border-b border-slate-700/40 bg-slate-800/30 px-5 py-3" style={{ gridTemplateColumns: '2fr 1.5fr 1.5fr 1fr 160px' }}>
              {['Module', 'Employee', 'Manager', 'Date', 'Actions'].map(h => (
                <div key={h} className="text-xs font-bold text-slate-500 uppercase tracking-widest">{h}</div>
              ))}
            </div>

            {loading ? (
              <div className="divide-y divide-slate-700/20">
                {[...Array(3)].map((_, i) => (
                  <div key={i} className="px-5 py-4 flex items-center gap-4 animate-pulse">
                    <div className="flex-1 h-4 bg-slate-700/50 rounded" />
                    <div className="w-28 h-4 bg-slate-700/40 rounded" />
                    <div className="w-28 h-4 bg-slate-700/50 rounded" />
                    <div className="w-16 h-4 bg-slate-700/40 rounded" />
                    <div className="w-28 h-6 bg-slate-700/50 rounded-lg" />
                  </div>
                ))}
              </div>
            ) : pendingRequests.length === 0 ? (
              <div className="text-center py-16">
                <div className="text-5xl mb-3 opacity-20">✅</div>
                <p className="text-base font-bold text-slate-400">No Pending Requests</p>
                <p className="text-xs text-slate-600 mt-1">All assignment requests have been reviewed.</p>
              </div>
            ) : (
              <div className="divide-y divide-slate-700/20">
                {pendingRequests.map(req => {
                  const manager = users.find(u => (u.userId || u.id) === req.manager_id);
                  const employee = users.find(u => (u.userId || u.id) === req.employee_id);
                  const mod = modules.find(m => m.id === req.module_id);
                  return (
                    <div key={req.id} onClick={() => setSelectedRequest(req)}
                      className="group grid items-center px-5 py-4 hover:bg-slate-800/30 cursor-pointer transition-all"
                      style={{ gridTemplateColumns: '2fr 1.5fr 1.5fr 1fr 160px' }}>
                      <div className="min-w-0 pr-3">
                        <p className="text-sm font-semibold text-white truncate">{mod?.title || 'Unknown Module'}</p>
                        <p className="text-xs text-slate-600 truncate">{mod?.difficulty || 'Module Assignment'}</p>
                      </div>
                      <div className="min-w-0 pr-3">
                        <p className="text-sm text-slate-300 truncate">{employee?.name || '—'}</p>
                        <p className="text-xs text-slate-600 truncate">{employee?.email || req.employee_id || '—'}</p>
                      </div>
                      <div className="min-w-0 pr-3"><p className="text-sm text-slate-300 truncate">{manager?.name || '—'}</p></div>
                      <div className="text-xs text-slate-500 pr-3 whitespace-nowrap">{new Date(req.requested_at || req.created_at || Date.now()).toLocaleDateString()}</div>
                      <div className="flex gap-1.5">
                        <button onClick={e => { e.stopPropagation(); approveRequest(req.id); }} disabled={approvingId === req.id}
                          className="px-2.5 py-1.5 rounded-lg bg-emerald-600/20 border border-emerald-500/30 text-emerald-300 hover:bg-emerald-600/30 text-xs font-bold transition-all disabled:opacity-50">
                          {approvingId === req.id ? '…' : '✓'}
                        </button>
                        <button onClick={e => { e.stopPropagation(); rejectRequest(req.id); }} disabled={approvingId === req.id}
                          className="px-2.5 py-1.5 rounded-lg bg-red-600/20 border border-red-500/30 text-red-300 hover:bg-red-600/30 text-xs font-bold transition-all disabled:opacity-50">
                          ✕
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ═══════════════════ REPORTS ═══════════════════ */}
      {activeTab === 'reports' && (
        <div className="space-y-4">
          {/* Controls */}
          <div className="flex items-center gap-3 flex-wrap">
            <input
              value={reportSearch}
              onChange={e => setReportSearch(e.target.value)}
              placeholder="Search by name, email, or role..."
              className="flex-1 min-w-48 px-4 py-2.5 rounded-xl border border-slate-700/60 bg-slate-800/60 text-slate-100 placeholder-slate-500 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 focus:outline-none text-sm"
            />
            <span className="text-xs text-slate-500 whitespace-nowrap">{filteredEmployees.length} employee{filteredEmployees.length !== 1 ? 's' : ''}</span>
            <button onClick={loadAll} className="px-3 py-2.5 rounded-xl bg-slate-800/60 border border-slate-700 text-slate-400 hover:text-white text-xs font-semibold transition-all">↻ Refresh</button>
          </div>

          {/* Table */}
          <div className="rounded-2xl border border-slate-700/40 bg-[#111827] overflow-hidden shadow-xl overflow-x-auto">
            {/* Header */}
            <div className="min-w-[900px]">
              <div className="grid border-b border-slate-700/40 bg-slate-800/40 px-4 py-3"
                style={{ gridTemplateColumns: '1.8fr 1.2fr 1fr 1fr 1fr 0.8fr 1fr' }}>
                {[
                  { label: 'Employee', field: 'name' },
                  { label: 'Job Role', field: 'role' },
                  { label: 'Assessment', field: null },
                  { label: 'Score', field: 'score' },
                  { label: 'Classification', field: null },
                  { label: 'Modules', field: null },
                  { label: 'Last Activity', field: 'activity' },
                ].map(col => (
                  <button key={col.label}
                    onClick={() => col.field && toggleSort(col.field)}
                    className={`text-left text-xs font-bold uppercase tracking-widest flex items-center gap-1 ${col.field ? 'text-slate-400 hover:text-slate-200 cursor-pointer' : 'text-slate-500 cursor-default'}`}>
                    {col.label}
                    {col.field && reportSort.field === col.field && <span className="text-indigo-400">{reportSort.dir === 'asc' ? '↑' : '↓'}</span>}
                  </button>
                ))}
              </div>

              {/* Rows */}
              {loading ? (
                <div className="divide-y divide-slate-700/20">
                  {[...Array(5)].map((_, i) => <div key={i} className="px-4 py-4 h-16 animate-pulse bg-slate-800/10" />)}
                </div>
              ) : filteredEmployees.length === 0 ? (
                <div className="text-center py-16">
                  <div className="text-5xl mb-3 opacity-20">👥</div>
                  <p className="text-base font-bold text-slate-400">{reportSearch ? 'No employees match your search' : 'No employees found'}</p>
                </div>
              ) : (
                <div className="divide-y divide-slate-700/20">
                  {filteredEmployees.map(emp => {
                    const uid = emp.userId || emp.id;
                    const empReports = allReports.filter(r => r.userId === uid).sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));
                    const empAssignments = allAssignments.filter(a => a.userId === uid);
                    const latestReport = empReports[0];
                    const completedMods = empAssignments.filter(a => a.status === 'completed').length;
                    const lastActivity = getEmpLastActivity(uid);
                    const assessmentStatus = latestReport ? 'Completed' : empReports.length > 0 ? 'In Progress' : 'Not Started';

                    return (
                      <div key={uid} onClick={() => setSelectedEmployee(emp)}
                        className="grid items-center px-4 py-3.5 hover:bg-slate-800/40 cursor-pointer transition-all min-w-[900px]"
                        style={{ gridTemplateColumns: '1.8fr 1.2fr 1fr 1fr 1fr 0.8fr 1fr' }}>

                        {/* Employee */}
                        <div className="min-w-0 pr-3">
                          <p className="text-sm font-semibold text-white truncate">{emp.name || '—'}</p>
                          <p className="text-xs text-slate-500 truncate">{emp.email}</p>
                        </div>

                        {/* Job Role */}
                        <div className="min-w-0 pr-3">
                          <p className="text-xs text-slate-300 truncate">{emp.jobRole || '—'}</p>
                        </div>

                        {/* Assessment Status */}
                        <div>
                          <span className={`text-xs font-bold px-2 py-0.5 rounded-full border ${
                            assessmentStatus === 'Completed' ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30' :
                            assessmentStatus === 'In Progress' ? 'bg-amber-500/15 text-amber-300 border-amber-500/30' :
                            'bg-slate-700/40 text-slate-500 border-slate-600/40'
                          }`}>{assessmentStatus}</span>
                        </div>

                        {/* Score */}
                        <div>
                          {latestReport?.score != null ? (
                            <span className={`text-sm font-black ${latestReport.score >= 80 ? 'text-emerald-400' : latestReport.score >= 60 ? 'text-amber-400' : 'text-red-400'}`}>
                              {latestReport.score}%
                            </span>
                          ) : <span className="text-slate-600 text-sm">—</span>}
                        </div>

                        {/* Classification */}
                        <div>
                          {latestReport?.performanceClassification?.label ? (
                            <span className={`text-xs font-semibold px-2 py-0.5 rounded-full border ${classTag(latestReport.performanceClassification.label)}`}>
                              {latestReport.performanceClassification.label}
                            </span>
                          ) : <span className="text-slate-600 text-xs">—</span>}
                        </div>

                        {/* Module Progress */}
                        <div>
                          {empAssignments.length > 0 ? (() => {
                            const avgPct = Math.round(empAssignments.reduce((s, a) => s + (a.progress || 0), 0) / empAssignments.length);
                            return (
                              <>
                                <p className="text-sm font-semibold text-slate-300">{avgPct}%</p>
                                <div className="h-1 w-16 rounded-full bg-slate-700/50 mt-1 overflow-hidden">
                                  <div className="h-full rounded-full bg-emerald-500 transition-all duration-500" style={{ width: `${avgPct}%` }} />
                                </div>
                              </>
                            );
                          })() : <span className="text-slate-600 text-xs">—</span>}
                        </div>

                        {/* Last Activity */}
                        <div>
                          <p className="text-xs text-slate-400">
                            {lastActivity ? lastActivity.toLocaleDateString() : <span className="text-slate-600">No activity</span>}
                          </p>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>

          <p className="text-xs text-slate-600">Click any row to view full employee report • PDF download available in detail view</p>
        </div>
      )}

      {/* ═══════════════════ ASSIGNMENTS ═══════════════════ */}
      {activeTab === 'assignments' && (
        <div className="rounded-2xl border border-slate-700/40 bg-[#111827] p-6 shadow-xl">
          <h3 className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-5">Assignment Summary</h3>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
            {[
              { label: 'Total', value: stats?.totalAssignments || 0, borderCls: 'border-indigo-500/25', bgCls: 'bg-indigo-500/5', textCls: 'text-indigo-400' },
              { label: 'In Progress', value: stats?.activeSessions || 0, borderCls: 'border-amber-500/25', bgCls: 'bg-amber-500/5', textCls: 'text-amber-400' },
              { label: 'Completed', value: stats?.completedModules || 0, borderCls: 'border-emerald-500/25', bgCls: 'bg-emerald-500/5', textCls: 'text-emerald-400' },
              { label: 'Pending', value: stats?.pendingAssignments || 0, borderCls: 'border-sky-500/25', bgCls: 'bg-sky-500/5', textCls: 'text-sky-400' },
            ].map(s => (
              <div key={s.label} className={`p-4 rounded-xl border ${s.borderCls} ${s.bgCls} text-center`}>
                <p className={`text-xs font-bold ${s.textCls} uppercase tracking-widest mb-1`}>{s.label}</p>
                <p className="text-3xl font-black text-white">{s.value}</p>
              </div>
            ))}
          </div>
          <button onClick={() => navigate('/admin/assignments')} className="w-full py-3 rounded-xl bg-indigo-600/20 border border-indigo-500/30 text-indigo-300 hover:bg-indigo-600/30 transition-all text-sm font-bold">
            Manage All Assignments →
          </button>
        </div>
      )}
    </div>
  );
}
