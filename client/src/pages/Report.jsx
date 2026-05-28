import React, { useEffect, useState, useCallback } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { useNavigate, useLocation } from 'react-router-dom';

const BASE_URL = import.meta.env.PROD ? '' : 'http://localhost:3001';

const authFetch = async (path, options = {}) => {
  const token = localStorage.getItem('auth_token');
  const res = await fetch(`${BASE_URL}${path}`, {
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(options.headers || {}),
    },
    ...options,
  });
  const text = await res.text();
  let data = null;
  if (text) {
    try { data = JSON.parse(text); } catch { throw new Error(`Server returned non-JSON (${res.status})`); }
  }
  if (!res.ok) {
    const msg = typeof data?.error === 'string' ? data.error : data?.error?.message || `Request failed (${res.status})`;
    throw new Error(msg);
  }
  return data?.data ?? data;
};

// ─── PDF Download helper ──────────────────────────────────────────────────────
function downloadReportPDF(employeeData) {
  const { employeeName, email, completionRate, completedAssignments, totalAssignments, assignments = [] } = employeeData;
  const html = `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<title>SkillForge Report — ${employeeName}</title>
<style>
  body { font-family: Arial, sans-serif; color: #1e293b; padding: 40px; max-width: 800px; margin: 0 auto; }
  h1 { color: #4f46e5; font-size: 24px; margin-bottom: 4px; }
  .meta { color: #64748b; font-size: 14px; margin-bottom: 24px; }
  .stat-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 16px; margin-bottom: 24px; }
  .stat { background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 10px; padding: 16px; text-align: center; }
  .stat-val { font-size: 28px; font-weight: 900; color: #4f46e5; }
  .stat-label { font-size: 11px; color: #94a3b8; text-transform: uppercase; letter-spacing: 1px; margin-top: 4px; }
  h2 { font-size: 14px; color: #64748b; text-transform: uppercase; letter-spacing: 1px; margin-bottom: 12px; border-bottom: 1px solid #e2e8f0; padding-bottom: 8px; }
  table { width: 100%; border-collapse: collapse; font-size: 13px; }
  th { text-align: left; padding: 8px 12px; background: #f1f5f9; color: #64748b; font-size: 11px; text-transform: uppercase; letter-spacing: 0.5px; }
  td { padding: 10px 12px; border-bottom: 1px solid #f1f5f9; }
  .badge { display: inline-block; padding: 2px 8px; border-radius: 999px; font-size: 10px; font-weight: 700; }
  .badge-completed { background: #d1fae5; color: #065f46; }
  .badge-progress { background: #fef3c7; color: #92400e; }
  .badge-assigned { background: #dbeafe; color: #1e40af; }
  .footer { margin-top: 40px; text-align: center; color: #94a3b8; font-size: 11px; }
  @media print { body { padding: 20px; } }
</style>
</head>
<body>
<h1>SkillForge AI — Training Report</h1>
<div class="meta">${employeeName} · ${email} · Generated ${new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}</div>
<div class="stat-grid">
  <div class="stat"><div class="stat-val">${totalAssignments}</div><div class="stat-label">Total Assignments</div></div>
  <div class="stat"><div class="stat-val">${completedAssignments}</div><div class="stat-label">Completed</div></div>
  <div class="stat"><div class="stat-val">${completionRate}%</div><div class="stat-label">Completion Rate</div></div>
</div>
${assignments.length > 0 ? `
<h2>Assignment Details</h2>
<table>
<thead><tr><th>Module</th><th>Status</th><th>Progress</th><th>Priority</th><th>Due Date</th></tr></thead>
<tbody>
${assignments.map(a => `<tr>
  <td>${a.moduleName || 'Unknown'}</td>
  <td><span class="badge ${a.status === 'completed' ? 'badge-completed' : a.status === 'in_progress' ? 'badge-progress' : 'badge-assigned'}">${a.status || 'assigned'}</span></td>
  <td>${a.progress || 0}%</td>
  <td>${a.priority || '—'}</td>
  <td>${a.dueDate ? new Date(a.dueDate).toLocaleDateString() : '—'}</td>
</tr>`).join('')}
</tbody>
</table>` : ''}
<div class="footer">SkillForge AI · Corporate Training Platform · Confidential</div>
</body>
</html>`;

  const blob = new Blob([html], { type: 'text/html' });
  const url = URL.createObjectURL(blob);
  const win = window.open(url, '_blank');
  if (win) {
    win.addEventListener('load', () => {
      setTimeout(() => { win.print(); URL.revokeObjectURL(url); }, 400);
    });
  }
}

// ─── Admin/Manager Report Table ───────────────────────────────────────────────
function AdminReportView({ user, navigate }) {
  const [reports, setReports] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [error, setError] = useState(null);

  const loadReports = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await authFetch('/api/report/all');
      setReports(data?.reports || []);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadReports(); }, [loadReports]);

  const filtered = reports.filter(r =>
    !search ||
    (r.employeeName || '').toLowerCase().includes(search.toLowerCase()) ||
    (r.email || '').toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="min-h-screen bg-[#0F172A] text-white px-4 sm:px-6 py-8 max-w-7xl mx-auto">
      <button onClick={() => navigate('/admin/dashboard')} className="text-slate-400 hover:text-white text-sm mb-6 flex items-center gap-2">← Back to Dashboard</button>

      <div className="mb-8 flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4">
        <div>
          <h1 className="text-3xl font-black text-white">Training Reports</h1>
          <p className="text-slate-400 text-sm mt-0.5">
            {user?.role === 'manager'
              ? 'Your team\'s training completion overview'
              : 'Platform-wide employee training completion overview'}
          </p>
        </div>
        <button onClick={loadReports} className="px-4 py-2 rounded-lg bg-slate-800/60 border border-slate-700/50 text-slate-400 hover:text-white text-sm font-medium transition-all">↻ Refresh</button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
        {[
          { label: user?.role === 'manager' ? 'Team Members' : 'Total Employees', value: reports.length, color: '#6366f1' },
          { label: 'Avg Completion', value: reports.length ? Math.round(reports.reduce((s, r) => s + r.completionRate, 0) / reports.length) + '%' : '0%', color: '#10b981' },
          { label: 'Fully Completed', value: reports.filter(r => r.completionRate === 100).length, color: '#f59e0b' },
          { label: 'Total Assignments', value: reports.reduce((s, r) => s + r.totalAssignments, 0), color: '#8b5cf6' },
        ].map((s, i) => (
          <div key={i} className="rounded-2xl border border-slate-700/40 bg-slate-800/30 p-5">
            <p className="text-xs font-bold text-slate-500 uppercase tracking-widest mb-1">{s.label}</p>
            <p className="text-2xl font-black" style={{ color: s.color }}>{s.value}</p>
          </div>
        ))}
      </div>

      {/* Table */}
      <div className="rounded-2xl border border-slate-700/40 bg-slate-900/60 overflow-hidden">
        <div className="flex items-center gap-3 px-5 py-4 border-b border-slate-700/40">
          <input type="text" placeholder="Search by name or email..." value={search} onChange={e => setSearch(e.target.value)}
            className="flex-1 px-4 py-2 rounded-xl bg-slate-800 border border-slate-700 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500" />
        </div>

        {/* Header */}
        <div className="hidden md:grid grid-cols-[2fr_2fr_1fr_1fr_1fr_1fr_auto] px-5 py-2 border-b border-slate-700/30 text-xs font-bold text-slate-500 uppercase tracking-widest">
          <span>Employee</span><span>Email</span><span>Total</span><span>Completed</span><span>Completion %</span><span>Last Activity</span><span></span>
        </div>

        {loading ? (
          <div className="p-8 text-center text-slate-500">
            <div className="animate-spin text-3xl mb-2">⟳</div>
            <p className="text-sm">Loading reports...</p>
          </div>
        ) : error ? (
          <div className="p-8 text-center text-red-400">{error}</div>
        ) : filtered.length === 0 ? (
          <div className="py-16 text-center">
            <div className="text-5xl mb-4 opacity-20">📊</div>
            <p className="text-lg font-bold text-slate-400 mb-1">No Reports Found</p>
            <p className="text-sm text-slate-600">Reports will appear once employees have assignments.</p>
          </div>
        ) : (
          <div className="divide-y divide-slate-700/30">
            {filtered.map((r, i) => {
              const rateColor = r.completionRate >= 80 ? 'text-emerald-400' : r.completionRate >= 50 ? 'text-amber-400' : 'text-red-400';
              return (
                <div key={r.userId || i} className="px-5 py-4 grid grid-cols-1 md:grid-cols-[2fr_2fr_1fr_1fr_1fr_1fr_auto] items-center gap-3 hover:bg-slate-800/20 transition-all">
                  {/* Employee */}
                  <div className="flex items-center gap-2 min-w-0">
                    <div className="w-7 h-7 rounded-full bg-gradient-to-br from-indigo-500/30 to-purple-500/20 border border-indigo-500/20 flex items-center justify-center text-xs font-black text-indigo-300 flex-shrink-0">
                      {(r.employeeName || '?').charAt(0).toUpperCase()}
                    </div>
                    <span className="text-sm font-semibold text-white truncate">{r.employeeName}</span>
                  </div>

                  <span className="text-xs text-slate-400 truncate">{r.email}</span>
                  <span className="text-sm font-bold text-slate-300">{r.totalAssignments}</span>
                  <span className="text-sm font-bold text-emerald-400">{r.completedAssignments}</span>

                  {/* Completion % with bar */}
                  <div>
                    <div className="flex items-center gap-2">
                      <div className="flex-1 h-1.5 rounded-full bg-slate-700 overflow-hidden">
                        <div className="h-full rounded-full transition-all" style={{ width: `${r.completionRate}%`, background: r.completionRate >= 80 ? '#10b981' : r.completionRate >= 50 ? '#f59e0b' : '#ef4444' }} />
                      </div>
                      <span className={`text-xs font-bold ${rateColor}`}>{r.completionRate}%</span>
                    </div>
                  </div>

                  <span className="text-xs text-slate-500">
                    {r.lastActivity ? new Date(r.lastActivity).toLocaleDateString() : '—'}
                  </span>

                  <button
                    onClick={() => downloadReportPDF(r)}
                    className="px-3 py-1.5 rounded-lg bg-indigo-600/20 border border-indigo-500/30 text-indigo-300 hover:bg-indigo-600/30 text-xs font-semibold transition-all whitespace-nowrap"
                  >
                    ↓ PDF
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Employee Report View ─────────────────────────────────────────────────────
function EmployeeReportView({ user, navigate }) {
  const [moduleContent, setModuleContent] = useState(null);
  const [report, setReport] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const loadModule = async () => {
      try {
        const token = localStorage.getItem('auth_token');
        const res = await fetch(`${BASE_URL}/api/assignments?userId=${user?.userId}`, {
          headers: { Authorization: `Bearer ${token}` }
        });
        const data = await res.json();
        const assignments = data.data?.assignments || data.assignments || [];
        if (assignments.length > 0) {
          const modId = assignments[0].assignable_id;
          const modRes = await fetch(`${BASE_URL}/api/modules/${modId}`, {
            headers: { Authorization: `Bearer ${token}` }
          });
          const modData = await modRes.json();
          setModuleContent(modData.data?.content || {});
        }
      } catch (_) {}
    };
    if (user) loadModule();
  }, [user]);

  useEffect(() => {
    loadReport();
  }, [user]);

  const loadReport = async () => {
    setLoading(true);
    try {
      const uid = user.userId || user.id;
      const data = await authFetch(`/api/report/${uid}`);
      setReport(data);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  const generateReport = async () => {
    setLoading(true);
    try {
      const uid = user.userId || user.id;
      await authFetch('/api/report/generate', { method: 'POST', body: JSON.stringify({ userId: uid }) });
      await loadReport();
    } catch (e) {
      alert(e.message || 'Failed to generate report');
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#0F172A]">
        <div className="text-center">
          <div className="animate-spin text-indigo-400 text-4xl mb-4">⟳</div>
          <div className="text-slate-400 text-sm">Loading report...</div>
        </div>
      </div>
    );
  }

  if (!report) {
    return (
      <div className="min-h-screen px-4 py-8 max-w-4xl mx-auto bg-[#0F172A] text-white">
        <button onClick={() => navigate('/dashboard')} className="text-slate-400 hover:text-white text-sm mb-6 flex items-center gap-2">← Back</button>
        <div className="text-center py-16">
          <div className="text-5xl mb-4">📄</div>
          <h1 className="text-2xl font-black mb-2">No Report Yet</h1>
          <p className="text-slate-400 mb-6">Generate your learning report to see analytics and insights.</p>
          <button onClick={generateReport} className="px-6 py-3 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-sm font-bold">Generate Report</button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#0F172A] text-white px-4 sm:px-6 py-8 max-w-5xl mx-auto">
      <button onClick={() => navigate('/dashboard')} className="text-slate-400 hover:text-white text-sm mb-6 flex items-center gap-2">← Back to Dashboard</button>

      <div className="mb-8 flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-black text-white">Learning Report</h1>
          <p className="text-slate-400 text-sm">Comprehensive analytics and insights</p>
        </div>
        <div className="flex gap-3">
          <button
            onClick={() => downloadReportPDF({
              employeeName: user.name || user.email,
              email: user.email,
              completionRate: report.stats?.avgScore || 0,
              completedAssignments: report.stats?.totalSessions || 0,
              totalAssignments: report.stats?.totalSessions || 0,
              assignments: (report.sessions || []).map(s => ({ moduleName: s.skillName, status: 'completed', progress: s.score })),
            })}
            className="px-4 py-2 rounded-lg bg-slate-800/60 border border-slate-700/50 text-slate-400 hover:text-white text-sm font-medium transition-all"
          >
            ↓ Download PDF
          </button>
          <button onClick={generateReport} className="px-4 py-2 rounded-lg bg-indigo-600/20 border border-indigo-500/30 text-indigo-300 hover:bg-indigo-600/30 text-sm font-bold transition-all">Regenerate</button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
        <div className="rounded-2xl border border-indigo-500/20 bg-indigo-500/5 p-6">
          <p className="text-xs text-indigo-400 font-bold uppercase tracking-widest mb-1">Total Sessions</p>
          <p className="text-4xl font-black text-white">{report.stats?.totalSessions || 0}</p>
        </div>
        <div className="rounded-2xl border border-emerald-500/20 bg-emerald-500/5 p-6">
          <p className="text-xs text-emerald-400 font-bold uppercase tracking-widest mb-1">Average Score</p>
          <p className="text-4xl font-black text-white">{report.stats?.avgScore || 0}<span className="text-2xl text-emerald-400">%</span></p>
        </div>
        <div className="rounded-2xl border border-purple-500/20 bg-purple-500/5 p-6">
          <p className="text-xs text-purple-400 font-bold uppercase tracking-widest mb-1">Best Score</p>
          <p className="text-4xl font-black text-white">{report.stats?.bestScore || 0}<span className="text-2xl text-purple-400">%</span></p>
        </div>
      </div>

      {report.goal && (
        <div className="rounded-2xl border border-slate-700/40 bg-slate-900/60 p-8 mb-6">
          <h3 className="text-sm font-bold text-slate-400 uppercase tracking-widest mb-4">Goal Overview</h3>
          <div className="text-lg font-bold text-white mb-1">{report.goal.goalText}</div>
          <div className="text-sm text-slate-400">Domain: {report.goal.domainLabel} · {report.goal.totalEstimatedDays} days · {report.skillTree?.skills?.length || 0} skills</div>
        </div>
      )}

      {report.sessions?.length > 0 && (
        <div className="rounded-2xl border border-slate-700/40 bg-slate-900/60 p-8 mb-6">
          <h3 className="text-sm font-bold text-slate-400 uppercase tracking-widest mb-4">Recent Sessions</h3>
          <div className="space-y-3">
            {report.sessions.slice(0, 5).map((s, i) => (
              <div key={i} className="flex items-center justify-between p-4 rounded-xl bg-slate-800/40 border border-slate-700/30">
                <div>
                  <p className="font-semibold text-white">Day {s.day} — {s.skillName}</p>
                  <p className="text-xs text-slate-500 mt-0.5">{s.completedAt ? new Date(s.completedAt).toLocaleDateString() : '—'}</p>
                </div>
                <div className="text-right">
                  <div className="text-xl font-black text-emerald-400">{s.score}%</div>
                  <div className="text-xs text-emerald-400/70 font-bold">{s.grade}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="text-center text-xs text-slate-500">Report generated from your learning activity</div>
    </div>
  );
}

// ─── Module-specific Report (employee accessing from module context) ──────────
function ModuleReport({ moduleId, assignmentId, user, navigate }) {
  const [moduleData, setModuleData] = useState(null);
  const [assignmentData, setAssignmentData] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const token = localStorage.getItem('auth_token');
    const headers = { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) };
    const fetches = [
      fetch(`${BASE_URL}/api/modules/${moduleId}`, { headers }).then(r => r.json()),
    ];
    if (assignmentId) {
      fetches.push(fetch(`${BASE_URL}/api/assignments/${assignmentId}`, { headers }).then(r => r.json()));
    }
    Promise.all(fetches)
      .then(([modJson, asnJson]) => {
        if (modJson?.success && modJson.data) setModuleData(modJson.data);
        if (asnJson?.success && asnJson.data) setAssignmentData(asnJson.data);
        else if (asnJson?.data) setAssignmentData(asnJson.data);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [moduleId, assignmentId]);

  const downloadModuleReportPDF = () => {
    const mod = moduleData || {};
    const asn = assignmentData || {};
    const sessionsCompleted = Object.values(asn.sessionProgress || {}).filter(s => s === 'completed').length;
    const totalSessions = (mod.sessions || []).length;
    const html = `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<title>Module Report — ${mod.title || 'Module'}</title>
<style>
  body { font-family: Arial, sans-serif; color: #1e293b; padding: 40px; max-width: 800px; margin: 0 auto; }
  h1 { color: #4f46e5; font-size: 24px; margin-bottom: 4px; }
  .meta { color: #64748b; font-size: 14px; margin-bottom: 24px; }
  .stat-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 16px; margin-bottom: 24px; }
  .stat { background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 10px; padding: 16px; text-align: center; }
  .stat-val { font-size: 28px; font-weight: 900; color: #4f46e5; }
  .stat-label { font-size: 11px; color: #94a3b8; text-transform: uppercase; letter-spacing: 1px; margin-top: 4px; }
  .footer { margin-top: 40px; text-align: center; color: #94a3b8; font-size: 11px; }
  @media print { body { padding: 20px; } }
</style>
</head>
<body>
<h1>SkillForge AI — Module Training Report</h1>
<div class="meta">${mod.title || 'Module'} · ${user?.name || user?.email || ''} · Generated ${new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}</div>
<div class="stat-grid">
  <div class="stat"><div class="stat-val">${asn.progress || 0}%</div><div class="stat-label">Progress</div></div>
  <div class="stat"><div class="stat-val">${sessionsCompleted}/${totalSessions || '—'}</div><div class="stat-label">Sessions Completed</div></div>
  <div class="stat"><div class="stat-val">${asn.status || 'assigned'}</div><div class="stat-label">Status</div></div>
</div>
${asn.dueDate ? `<p>Due Date: ${new Date(asn.dueDate).toLocaleDateString()}</p>` : ''}
<div class="footer">SkillForge AI · Corporate Training Platform · Confidential</div>
</body>
</html>`;
    const blob = new Blob([html], { type: 'text/html' });
    const url = URL.createObjectURL(blob);
    const win = window.open(url, '_blank');
    if (win) {
      win.addEventListener('load', () => {
        setTimeout(() => { win.print(); URL.revokeObjectURL(url); }, 400);
      });
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#0F172A]">
        <div className="text-center">
          <div className="animate-spin text-indigo-400 text-4xl mb-4">⟳</div>
          <div className="text-slate-400 text-sm">Loading module report...</div>
        </div>
      </div>
    );
  }

  const mod = moduleData || {};
  const asn = assignmentData || {};
  const sessionsCompleted = Object.values(asn.sessionProgress || {}).filter(s => s === 'completed').length;
  const totalSessions = (mod.sessions || []).length;
  const progress = asn.progress || 0;
  const statusColor = asn.status === 'completed' ? 'text-emerald-400' : asn.status === 'in_progress' ? 'text-amber-400' : 'text-slate-400';

  return (
    <div className="min-h-screen bg-[#0F172A] text-white px-4 sm:px-6 py-8 max-w-4xl mx-auto">
      <button
        onClick={() => navigate(`/module/${moduleId}/learn${assignmentId ? `?assignmentId=${assignmentId}` : ''}`)}
        className="text-slate-400 hover:text-white text-sm mb-6 flex items-center gap-2"
      >
        ← Back to Module
      </button>

      <div className="mb-8 flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-black text-white">Module Report</h1>
          <p className="text-slate-400 text-sm mt-0.5">{mod.title || 'Module Training Report'}</p>
        </div>
        <div className="flex gap-3">
          <button
            onClick={downloadModuleReportPDF}
            className="px-4 py-2 rounded-lg bg-slate-800/60 border border-slate-700/50 text-slate-400 hover:text-white text-sm font-medium transition-all"
          >
            ↓ Download Report
          </button>
          <button
            onClick={() => navigate(`/module/${moduleId}/learn${assignmentId ? `?assignmentId=${assignmentId}` : ''}`)}
            className="px-4 py-2 rounded-lg bg-indigo-600/20 border border-indigo-500/30 text-indigo-300 hover:bg-indigo-600/30 text-sm font-bold transition-all"
          >
            ← Back to Module
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
        <div className="rounded-2xl border border-indigo-500/20 bg-indigo-500/5 p-6">
          <p className="text-xs text-indigo-400 font-bold uppercase tracking-widest mb-1">Overall Progress</p>
          <p className="text-4xl font-black text-white">{progress}<span className="text-2xl text-indigo-400">%</span></p>
        </div>
        <div className="rounded-2xl border border-emerald-500/20 bg-emerald-500/5 p-6">
          <p className="text-xs text-emerald-400 font-bold uppercase tracking-widest mb-1">Sessions Completed</p>
          <p className="text-4xl font-black text-white">{sessionsCompleted}<span className="text-2xl text-slate-400">/{totalSessions || '—'}</span></p>
        </div>
        <div className="rounded-2xl border border-purple-500/20 bg-purple-500/5 p-6">
          <p className="text-xs text-purple-400 font-bold uppercase tracking-widest mb-1">Status</p>
          <p className={`text-2xl font-black capitalize ${statusColor}`}>{asn.status || 'assigned'}</p>
        </div>
      </div>

      <div className="rounded-2xl border border-slate-700/40 bg-slate-900/60 p-8 mb-6">
        <h3 className="text-sm font-bold text-slate-400 uppercase tracking-widest mb-4">Module Details</h3>
        <div className="text-lg font-bold text-white mb-1">{mod.title}</div>
        {mod.description && <div className="text-sm text-slate-400 mb-3">{mod.description}</div>}
        {mod.skills?.length > 0 && (
          <div className="flex flex-wrap gap-2 mt-2">
            {mod.skills.map((skill, i) => (
              <span key={i} className="px-3 py-1 rounded-full bg-indigo-500/10 border border-indigo-500/20 text-indigo-300 text-xs font-semibold">
                {skill}
              </span>
            ))}
          </div>
        )}
        {asn.dueDate && (
          <div className="mt-4 text-sm text-slate-400">
            Due: <span className="text-slate-200 font-semibold">{new Date(asn.dueDate).toLocaleDateString()}</span>
          </div>
        )}
      </div>

      {/* Progress bar */}
      <div className="rounded-2xl border border-slate-700/40 bg-slate-900/60 p-6 mb-6">
        <div className="flex justify-between text-sm mb-2">
          <span className="text-slate-400 font-medium">Module Completion</span>
          <span className="font-bold text-indigo-400">{progress}%</span>
        </div>
        <div className="h-3 bg-slate-800 rounded-full overflow-hidden">
          <div
            className="h-full rounded-full bg-gradient-to-r from-indigo-600 to-purple-600 transition-all duration-700"
            style={{ width: `${progress}%` }}
          />
        </div>
      </div>

      <div className="text-center text-xs text-slate-500">SkillForge AI · Corporate Training Platform · Confidential</div>
    </div>
  );
}

// ─── Main Export ──────────────────────────────────────────────────────────────
export default function Report() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const searchParams = new URLSearchParams(location.search);
  const moduleId = searchParams.get('moduleId');
  const assignmentId = searchParams.get('assignmentId');

  useEffect(() => {
    if (!user) navigate('/');
  }, [user, navigate]);

  if (!user) return null;

  const isAdminOrManager = user.role === 'admin' || user.role === 'manager';

  // Employee accessing report from inside a module (via URL params)
  if (!isAdminOrManager && assignmentId) {
    return <ModuleReport moduleId={moduleId} assignmentId={assignmentId} user={user} navigate={navigate} />;
  }

  if (isAdminOrManager) {
    return <AdminReportView user={user} navigate={navigate} />;
  }

  return <EmployeeReportView user={user} navigate={navigate} />;
}
