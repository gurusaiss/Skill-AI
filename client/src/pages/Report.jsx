import React, { useEffect, useState, useCallback, useMemo } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { useNavigate, useLocation } from 'react-router-dom';
import { authFetch } from '../utils/authFetch.js';
import SearchableSelect from '../components/SearchableSelect.jsx';

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

// ─── Shared table styling tokens (used by the standardized Reports table) ─────
const TH_CLS = 'px-3 py-2.5 text-left text-xs font-bold text-slate-400 uppercase tracking-wider whitespace-nowrap select-none';
const TD_CLS = 'px-3 py-3 text-sm text-slate-200 align-middle';
const PAGE_SIZE = 20;

function SortIcon({ active, dir }) {
  if (!active) return <span className="text-slate-600 text-[10px] ml-1">↕</span>;
  return <span className="text-indigo-400 text-[10px] ml-1">{dir === 'asc' ? '▲' : '▼'}</span>;
}

// ─── Admin/Manager Report Table ───────────────────────────────────────────────
function AdminReportView({ user, navigate }) {
  const [reports, setReports] = useState([]); // module reports (per-employee, with .assignments[])
  const [assessmentReports, setAssessmentReports] = useState([]);
  const [groups, setGroups] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [showDownloadModal, setShowDownloadModal] = useState(false);
  const [downloadingFmt, setDownloadingFmt] = useState(null);

  // Filters
  const [search, setSearch] = useState('');
  const [reportType, setReportType] = useState('all'); // all | assessment | module
  const [nameFilter, setNameFilter] = useState('all');
  const [employeeFilter, setEmployeeFilter] = useState('all');
  const [groupFilter, setGroupFilter] = useState('all');
  const [managerFilter, setManagerFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');

  // Sort + pagination
  const [sortCol, setSortCol] = useState('completedDate');
  const [sortDir, setSortDir] = useState('desc');
  const [page, setPage] = useState(1);

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
    try {
      const arData = await authFetch('/api/assessments/reports/all');
      setAssessmentReports(Array.isArray(arData) ? arData : []);
    } catch { /* non-fatal */ }
    try {
      const gData = await authFetch('/api/groups');
      setGroups(gData?.data?.groups || gData?.groups || []);
    } catch { /* non-fatal — manager/group filters just stay empty */ }
  }, []);

  useEffect(() => { loadReports(); }, [loadReports]);

  // Employee → { group, manager } lookup
  const employeeMeta = useMemo(() => {
    const map = {};
    groups.forEach(g => {
      (g.employeeIds || []).forEach(eid => { map[eid] = { group: g.name || '—', manager: g.managerName || '—' }; });
    });
    return map;
  }, [groups]);

  // Flatten both data sources into one unified row shape
  const allRows = useMemo(() => {
    const moduleRows = reports.flatMap(r =>
      (r.assignments || []).map(a => ({
        id: `m-${r.userId}-${a.id}`,
        type: 'module',
        employeeId: r.userId || '—',
        employeeName: r.employeeName || '—',
        email: r.email || '—',
        jobRole: r.jobRole || '—',
        name: a.moduleName || 'Unknown Module',
        status: a.status || 'assigned',
        score: null, // modules track progress, not a graded score
        progress: a.progress || 0,
        scoreOrCompletion: a.progress || 0, // unified field kept for sorting
        assignedDate: null,
        deadline: a.dueDate || null,
        completedDate: a.status === 'completed' ? (a.dueDate || null) : null,
        manager: employeeMeta[r.userId]?.manager || '—',
        group: employeeMeta[r.userId]?.group || '—',
      }))
    );
    const assessmentRows = assessmentReports.map(r => {
      const uid = r.userId || r.user_id;
      return {
        id: `a-${r.id || uid}-${r.assessmentId || ''}`,
        type: 'assessment',
        employeeId: uid || '—',
        employeeName: r.employeeName || r.userName || '—',
        email: r.email || r.userEmail || '—',
        jobRole: r.jobRole || '—',
        name: r.assessmentTitle || r.title || 'Untitled Assessment',
        status: r.status || 'submitted',
        score: r.score ?? r.completionRate ?? 0,
        progress: null, // assessments are graded, not progress-tracked
        scoreOrCompletion: r.score ?? r.completionRate ?? 0, // unified field kept for sorting
        assignedDate: r.assignedAt || null,
        deadline: r.deadline || null,
        completedDate: r.submittedAt || r.completedAt || null,
        manager: employeeMeta[uid]?.manager || '—',
        group: employeeMeta[uid]?.group || '—',
      };
    });
    return [...moduleRows, ...assessmentRows];
  }, [reports, assessmentReports, employeeMeta]);

  // Dynamic dropdown option lists — always derived from the currently selected report type
  const typeScopedRows = useMemo(() => reportType === 'all' ? allRows : allRows.filter(r => r.type === reportType), [allRows, reportType]);
  const nameOptions = useMemo(() => [...new Set(typeScopedRows.map(r => r.name).filter(Boolean))].sort(), [typeScopedRows]);
  const employeeOptions = useMemo(() => [...new Set(allRows.map(r => r.employeeName).filter(Boolean))].sort(), [allRows]);
  const groupOptions = useMemo(() => [...new Set(allRows.map(r => r.group).filter(g => g && g !== '—'))].sort(), [allRows]);
  const managerOptions = useMemo(() => [...new Set(allRows.map(r => r.manager).filter(m => m && m !== '—'))].sort(), [allRows]);
  const statusOptions = useMemo(() => [...new Set(allRows.map(r => r.status).filter(Boolean))].sort(), [allRows]);

  // Reset the name filter whenever report type changes, since its options change
  useEffect(() => { setNameFilter('all'); }, [reportType]);
  // Reset to page 1 whenever any filter changes
  useEffect(() => { setPage(1); }, [search, reportType, nameFilter, employeeFilter, groupFilter, managerFilter, statusFilter, dateFrom, dateTo]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return allRows.filter(r => {
      if (reportType !== 'all' && r.type !== reportType) return false;
      if (nameFilter !== 'all' && r.name !== nameFilter) return false;
      if (employeeFilter !== 'all' && r.employeeName !== employeeFilter) return false;
      if (groupFilter !== 'all' && r.group !== groupFilter) return false;
      if (managerFilter !== 'all' && r.manager !== managerFilter) return false;
      if (statusFilter !== 'all' && r.status !== statusFilter) return false;
      if (q && !(r.employeeName.toLowerCase().includes(q) || r.email.toLowerCase().includes(q) || r.name.toLowerCase().includes(q))) return false;
      const dateVal = r.completedDate || r.deadline || r.assignedDate;
      if (dateFrom && (!dateVal || new Date(dateVal) < new Date(dateFrom))) return false;
      if (dateTo && (!dateVal || new Date(dateVal) > new Date(dateTo + 'T23:59:59'))) return false;
      return true;
    });
  }, [allRows, search, reportType, nameFilter, employeeFilter, groupFilter, managerFilter, statusFilter, dateFrom, dateTo]);

  const sorted = useMemo(() => {
    const arr = [...filtered];
    arr.sort((a, b) => {
      let av = a[sortCol], bv = b[sortCol];
      if (['scoreOrCompletion', 'score', 'progress'].includes(sortCol)) { av = av || 0; bv = bv || 0; }
      else if (['assignedDate', 'deadline', 'completedDate'].includes(sortCol)) { av = av ? new Date(av).getTime() : 0; bv = bv ? new Date(bv).getTime() : 0; }
      else { av = (av || '').toString().toLowerCase(); bv = (bv || '').toString().toLowerCase(); }
      if (av < bv) return sortDir === 'asc' ? -1 : 1;
      if (av > bv) return sortDir === 'asc' ? 1 : -1;
      return 0;
    });
    return arr;
  }, [filtered, sortCol, sortDir]);

  const totalPages = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE));
  const pageRows = sorted.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  const toggleSort = (col) => {
    if (sortCol === col) setSortDir(d => (d === 'asc' ? 'desc' : 'asc'));
    else { setSortCol(col); setSortDir('asc'); }
  };

  const hasActiveFilters = reportType !== 'all' || nameFilter !== 'all' || employeeFilter !== 'all' || groupFilter !== 'all' || managerFilter !== 'all' || statusFilter !== 'all' || dateFrom || dateTo || search;
  const clearFilters = () => {
    setSearch(''); setReportType('all'); setNameFilter('all'); setEmployeeFilter('all');
    setGroupFilter('all'); setManagerFilter('all'); setStatusFilter('all'); setDateFrom(''); setDateTo('');
  };

  const filterSummaryText = () => {
    const parts = [];
    if (reportType !== 'all') parts.push(`Type=${reportType}`);
    if (nameFilter !== 'all') parts.push(`Name=${nameFilter}`);
    if (employeeFilter !== 'all') parts.push(`Employee=${employeeFilter}`);
    if (groupFilter !== 'all') parts.push(`Group=${groupFilter}`);
    if (managerFilter !== 'all') parts.push(`Manager=${managerFilter}`);
    if (statusFilter !== 'all') parts.push(`Status=${statusFilter}`);
    if (dateFrom) parts.push(`From=${dateFrom}`);
    if (dateTo) parts.push(`To=${dateTo}`);
    if (search) parts.push(`Search="${search}"`);
    return parts.join(', ');
  };

  // Exports EXACTLY the filtered + sorted rows currently on screen (all pages, not just the visible page)
  const downloadFiltered = async (format) => {
    setDownloadingFmt(format);
    setShowDownloadModal(false);
    try {
      // Exports always include the FULL record — every field stored, even ones
      // simplified out of the on-screen table (Type, Assigned Date, Deadline,
      // Manager, Group) — so no data is ever lost by downloading a report.
      const headers = ['Employee Name', 'Employee ID', 'Email', 'Job Role', 'Type', 'Assessment / Module', 'Status', 'Score', 'Progress', 'Assigned Date', 'Deadline', 'Completed Date', 'Manager', 'Group'];
      const rows = sorted.map(r => [
        r.employeeName, r.employeeId, r.email, r.jobRole, r.type === 'assessment' ? 'Assessment' : 'Module', r.name,
        r.status,
        r.score != null ? `${Math.round(r.score)}%` : '—',
        r.progress != null ? `${Math.round(r.progress)}%` : '—',
        r.assignedDate ? new Date(r.assignedDate).toLocaleDateString() : '—',
        r.deadline ? new Date(r.deadline).toLocaleDateString() : '—',
        r.completedDate ? new Date(r.completedDate).toLocaleDateString() : '—',
        r.manager, r.group,
      ]);
      const token = localStorage.getItem('auth_token');
      const BASE = import.meta.env.VITE_API_URL || (import.meta.env.PROD ? '' : 'http://localhost:3001');
      const res = await fetch(`${BASE}/api/assessments/export-filtered-reports`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ format, title: 'Training Reports', headers, rows, filterSummary: filterSummaryText() }),
      });
      if (!res.ok) throw new Error('Export failed');
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      const ext = format === 'pdf' ? 'pdf' : format === 'doc' ? 'docx' : 'xlsx';
      a.download = `Training-Reports.${ext}`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      alert(e.message || 'Export failed');
    } finally {
      setDownloadingFmt(null);
    }
  };

  return (
    <div className="min-h-screen bg-[#0F172A] text-white px-4 sm:px-6 py-8 max-w-7xl mx-auto">
      <button onClick={() => navigate('/admin/dashboard')} className="text-slate-400 hover:text-white text-sm mb-6 flex items-center gap-2">← Back to Dashboard</button>

      <div className="mb-6 flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4">
        <div>
          <h1 className="text-3xl font-black text-white">Training Reports</h1>
          <p className="text-slate-400 text-sm mt-0.5">
            {user?.role === 'manager'
              ? 'Your team\'s training completion overview'
              : 'Platform-wide employee training completion overview'}
          </p>
        </div>
        <div className="flex gap-2">
          <button onClick={() => setShowDownloadModal(true)} disabled={!!downloadingFmt}
            className="px-4 py-2 rounded-lg bg-teal-600/20 border border-teal-500/30 text-teal-300 hover:bg-teal-600/40 text-sm font-medium transition-all disabled:opacity-40">
            {downloadingFmt ? 'Downloading…' : '⬇ Download All Reports'}
          </button>
          <button onClick={loadReports} className="px-4 py-2 rounded-lg bg-slate-800/60 border border-slate-700/50 text-slate-400 hover:text-white text-sm font-medium transition-all">↻ Refresh</button>
        </div>
      </div>

      {/* Table card */}
      <div className="rounded-2xl border border-slate-700/40 bg-slate-900/60 overflow-hidden">
        {/* Filter bar */}
        <div className="flex flex-col gap-3 px-5 py-4 border-b border-slate-700/40">
          <input type="text" placeholder="Search by employee, email, or assessment/module name..." value={search} onChange={e => setSearch(e.target.value)}
            className="w-full px-4 py-2 rounded-xl bg-slate-800 border border-slate-700 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500" />
          <div className="flex flex-wrap gap-2 items-center">
            <SearchableSelect value={reportType} onChange={setReportType} allLabel="All Report Types"
              options={[{ value: 'module', label: 'Module' }, { value: 'assessment', label: 'Assessment' }]} />
            <SearchableSelect value={nameFilter} onChange={setNameFilter}
              allLabel={reportType === 'assessment' ? 'All Assessments' : reportType === 'module' ? 'All Modules' : 'All Assessments / Modules'}
              options={nameOptions} />
            <SearchableSelect value={employeeFilter} onChange={setEmployeeFilter} allLabel="All Employees" options={employeeOptions} />
            <SearchableSelect value={groupFilter} onChange={setGroupFilter} allLabel="All Groups" options={groupOptions} />
            <SearchableSelect value={managerFilter} onChange={setManagerFilter} allLabel="All Managers" options={managerOptions} />
            <SearchableSelect value={statusFilter} onChange={setStatusFilter} allLabel="All Statuses"
              options={statusOptions.map(s => ({ value: s, label: s.charAt(0).toUpperCase() + s.slice(1) }))} />
            <div className="flex items-center gap-1.5">
              <label className="text-xs text-slate-500">From</label>
              <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)}
                className="px-3 py-1.5 bg-slate-800 border border-slate-700/60 rounded-lg text-slate-300 text-xs focus:outline-none focus:border-indigo-500" />
            </div>
            <div className="flex items-center gap-1.5">
              <label className="text-xs text-slate-500">To</label>
              <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)}
                className="px-3 py-1.5 bg-slate-800 border border-slate-700/60 rounded-lg text-slate-300 text-xs focus:outline-none focus:border-indigo-500" />
            </div>
            {hasActiveFilters && (
              <button onClick={clearFilters}
                className="px-3 py-1.5 bg-slate-700/50 border border-slate-600/40 rounded-lg text-slate-400 text-xs font-semibold hover:text-white transition-colors">
                ✕ Clear Filters
              </button>
            )}
          </div>
          <p className="text-xs text-slate-500">
            Showing <span className="text-slate-300 font-semibold">{sorted.length}</span> of <span className="text-slate-400">{allRows.length}</span> total records
            {hasActiveFilters && ' (filtered)'}
          </p>
        </div>

        {/* Table */}
        {loading ? (
          <div className="p-8 text-center text-slate-500">
            <div className="animate-spin text-3xl mb-2">⟳</div>
            <p className="text-sm">Loading reports...</p>
          </div>
        ) : error ? (
          <div className="p-8 text-center text-red-400">
            <p className="font-semibold mb-1">Failed to load reports</p>
            <p className="text-sm text-red-400/70">{error}</p>
            <button onClick={loadReports} className="mt-4 px-4 py-2 rounded-lg bg-red-500/10 border border-red-500/30 text-red-300 text-sm hover:bg-red-500/20 transition-colors">Retry</button>
          </div>
        ) : sorted.length === 0 ? (
          <div className="py-16 text-center">
            <div className="text-5xl mb-4 opacity-20">📊</div>
            <p className="text-lg font-bold text-slate-400 mb-1">No Reports Found</p>
            <p className="text-sm text-slate-600">{hasActiveFilters ? 'Try adjusting or clearing your filters.' : 'Reports will appear once employees have assignments.'}</p>
          </div>
        ) : (
          <>
            {/* Simplified frontend view — Employee Name, ID, Email, Job Role, Assessment/Module,
                Status, Score, Progress, Completed Date + Actions. Every other field (Type,
                Deadline, Manager, Group, Assigned Date, etc.) is still stored and included in
                every export (PDF/Excel/DOC) below — nothing is deleted, only hidden from view. */}
            <div className="overflow-x-auto">
              <table className="w-full border-collapse">
                <thead className="sticky top-0 z-10 bg-slate-900">
                  <tr className="border-b border-slate-700/40">
                    <th className={TH_CLS}><button onClick={() => toggleSort('employeeName')} className="flex items-center hover:text-white transition-colors">Employee Name<SortIcon active={sortCol === 'employeeName'} dir={sortDir} /></button></th>
                    <th className={TH_CLS}><button onClick={() => toggleSort('employeeId')} className="flex items-center hover:text-white transition-colors">Employee ID<SortIcon active={sortCol === 'employeeId'} dir={sortDir} /></button></th>
                    <th className={TH_CLS}><button onClick={() => toggleSort('jobRole')} className="flex items-center hover:text-white transition-colors">Job Role<SortIcon active={sortCol === 'jobRole'} dir={sortDir} /></button></th>
                    <th className={TH_CLS}><button onClick={() => toggleSort('name')} className="flex items-center hover:text-white transition-colors">Assessment / Module<SortIcon active={sortCol === 'name'} dir={sortDir} /></button></th>
                    <th className={TH_CLS}><button onClick={() => toggleSort('status')} className="flex items-center hover:text-white transition-colors">Status<SortIcon active={sortCol === 'status'} dir={sortDir} /></button></th>
                    <th className={TH_CLS}><button onClick={() => toggleSort('score')} className="flex items-center hover:text-white transition-colors">Score<SortIcon active={sortCol === 'score'} dir={sortDir} /></button></th>
                    <th className={TH_CLS}><button onClick={() => toggleSort('progress')} className="flex items-center hover:text-white transition-colors">Progress<SortIcon active={sortCol === 'progress'} dir={sortDir} /></button></th>
                    <th className={TH_CLS}><button onClick={() => toggleSort('completedDate')} className="flex items-center hover:text-white transition-colors">Completion Date<SortIcon active={sortCol === 'completedDate'} dir={sortDir} /></button></th>
                    <th className={`${TH_CLS} text-right`}>Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-700/30">
                  {pageRows.map(r => {
                    const displayValue = Math.round(r.scoreOrCompletion || 0);
                    const valueColor = displayValue >= 80 ? 'text-emerald-400' : displayValue >= 50 ? 'text-amber-400' : 'text-red-400';
                    return (
                      <tr key={r.id} className="hover:bg-slate-800/20 transition-all h-[52px]">
                        <td className={TD_CLS}>
                          <div className="flex items-center gap-2 min-w-0">
                            <div className="w-6 h-6 rounded-full bg-gradient-to-br from-indigo-500/30 to-purple-500/20 border border-indigo-500/20 flex items-center justify-center text-[10px] font-black text-indigo-300 flex-shrink-0">
                              {r.employeeName.charAt(0).toUpperCase()}
                            </div>
                            <span className="font-semibold text-white truncate" title={r.employeeName}>{r.employeeName}</span>
                          </div>
                        </td>
                        <td className={`${TD_CLS} text-slate-500 font-mono text-xs truncate max-w-[100px]`} title={r.employeeId}>{r.employeeId}</td>
                        <td className={`${TD_CLS} text-slate-400 truncate max-w-[130px]`} title={r.jobRole}>{r.jobRole}</td>
                        <td className={`${TD_CLS} truncate max-w-[200px]`} title={r.name}>
                          <span className="mr-1">{r.type === 'assessment' ? '📝' : '📚'}</span>{r.name}
                        </td>
                        <td className={TD_CLS}><span className="capitalize text-xs px-2 py-0.5 rounded bg-slate-700/40 border border-slate-600/40 whitespace-nowrap">{r.status}</span></td>
                        <td className={TD_CLS}>{r.score != null ? <span className={`text-xs font-bold ${valueColor}`}>{Math.round(r.score)}%</span> : <span className="text-slate-600">—</span>}</td>
                        <td className={TD_CLS}>
                          {r.progress != null ? (
                            <div className="flex items-center gap-2 min-w-[90px]">
                              <div className="flex-1 h-1.5 rounded-full bg-slate-700 overflow-hidden">
                                <div className="h-full rounded-full transition-all" style={{ width: `${Math.min(r.progress, 100)}%`, background: r.progress >= 80 ? '#10b981' : r.progress >= 50 ? '#f59e0b' : '#ef4444' }} />
                              </div>
                              <span className={`text-xs font-bold ${valueColor}`}>{Math.round(r.progress)}%</span>
                            </div>
                          ) : <span className="text-slate-600">—</span>}
                        </td>
                        <td className={`${TD_CLS} text-slate-400 whitespace-nowrap`}>{r.completedDate ? new Date(r.completedDate).toLocaleDateString() : '—'}</td>
                        <td className={`${TD_CLS} text-right`}>
                          {r.type === 'module' ? (
                            <button
                              onClick={() => downloadReportPDF({ employeeName: r.employeeName, email: r.email, completionRate: displayValue, completedAssignments: r.status === 'completed' ? 1 : 0, totalAssignments: 1, assignments: [{ moduleName: r.name, status: r.status, progress: displayValue, dueDate: r.deadline }] })}
                              className="px-3 py-1.5 rounded-lg border text-xs font-semibold transition-all whitespace-nowrap bg-indigo-600/20 border-indigo-500/30 text-indigo-300 hover:bg-indigo-600/30"
                            >
                              ↓ PDF
                            </button>
                          ) : (
                            <span className="px-3 py-1.5 rounded-lg border text-xs font-semibold whitespace-nowrap bg-slate-700/30 border-slate-600/30 text-slate-500">📊 {displayValue}%</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* Pagination */}
            {totalPages > 1 && (
              <div className="flex items-center justify-between px-5 py-3 border-t border-slate-700/40">
                <p className="text-xs text-slate-500">Page {page} of {totalPages}</p>
                <div className="flex gap-1.5">
                  <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1}
                    className="px-3 py-1.5 rounded-lg bg-slate-800 border border-slate-700 text-slate-300 text-xs font-semibold disabled:opacity-30 hover:enabled:bg-slate-700 transition-colors">‹ Prev</button>
                  <button onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page === totalPages}
                    className="px-3 py-1.5 rounded-lg bg-slate-800 border border-slate-700 text-slate-300 text-xs font-semibold disabled:opacity-30 hover:enabled:bg-slate-700 transition-colors">Next ›</button>
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {showDownloadModal && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-[200] p-4 overflow-y-auto" onClick={e => e.target === e.currentTarget && setShowDownloadModal(false)}>
          <div className="bg-[#1E293B] border border-slate-700 rounded-2xl w-full max-w-sm shadow-2xl p-6 my-8 max-h-[85vh] overflow-y-auto">
            <h3 className="text-lg font-bold text-white mb-1">Download Reports</h3>
            <p className="text-slate-400 text-sm mb-2">Exports exactly the {sorted.length} filtered record{sorted.length === 1 ? '' : 's'} currently shown</p>
            {hasActiveFilters && <p className="text-xs text-indigo-400/80 mb-4 truncate">Filters: {filterSummaryText()}</p>}
            <div className="space-y-3 mt-4">
              {[
                { fmt: 'xlsx', label: 'Excel (.xlsx)', icon: '📊', desc: 'Spreadsheet with all data' },
                { fmt: 'pdf',  label: 'PDF (.pdf)',   icon: '📄', desc: 'Formatted printable report' },
                { fmt: 'doc',  label: 'Word (.docx)', icon: '📝', desc: 'Editable document' },
              ].map(({ fmt, label, icon, desc }) => (
                <button key={fmt} onClick={() => downloadFiltered(fmt)} disabled={!!downloadingFmt}
                  className="w-full flex items-center gap-4 p-4 rounded-xl bg-slate-800/60 border border-slate-700 hover:border-indigo-500/50 hover:bg-slate-800 transition-all text-left disabled:opacity-50">
                  <span className="text-2xl">{icon}</span>
                  <div>
                    <p className="text-sm font-bold text-white">{label}</p>
                    <p className="text-xs text-slate-400">{desc}</p>
                  </div>
                </button>
              ))}
            </div>
            <button onClick={() => setShowDownloadModal(false)} className="mt-4 w-full py-2 text-sm text-slate-400 hover:text-white transition-colors">Cancel</button>
          </div>
        </div>
      )}
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
  const { user, hasRole } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const searchParams = new URLSearchParams(location.search);
  const moduleId = searchParams.get('moduleId');
  const assignmentId = searchParams.get('assignmentId');

  useEffect(() => {
    if (!user) navigate('/');
  }, [user, navigate]);

  if (!user) return null;

  const isAdminOrManager = hasRole(['admin', 'manager']);

  // Employee accessing report from inside a module (via URL params)
  if (!isAdminOrManager && assignmentId) {
    return <ModuleReport moduleId={moduleId} assignmentId={assignmentId} user={user} navigate={navigate} />;
  }

  if (isAdminOrManager) {
    return <AdminReportView user={user} navigate={navigate} />;
  }

  return <EmployeeReportView user={user} navigate={navigate} />;
}
