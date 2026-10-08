import React, { useEffect, useState, useCallback, useMemo } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { useNavigate, useLocation } from 'react-router-dom';
import { authFetch } from '../utils/authFetch.js';
import SearchableSelect from '../components/SearchableSelect.jsx';
import TabBar from '../components/TabBar.jsx';
import PageContainer from '../components/PageContainer.jsx';
import PageHeader from '../components/PageHeader.jsx';
import Button from '../components/Button.jsx';
import ModuleReports from './reports/ModuleReports.jsx';
import { useNotification } from '../contexts/NotificationContext.jsx';
import { ratingForReport, ratingStyle } from '../utils/assessmentRules.js';

// Every other page that makes a raw fetch (not via authFetch, which has its
// own internal BASE_URL) declares this locally — this file was missing it
// entirely, causing a ReferenceError on every raw fetch call below
// (EmployeeReportView's module pre-fetch, ModuleReport's data load).
const BASE_URL = import.meta.env.VITE_API_URL || (import.meta.env.PROD ? '' : 'http://localhost:3001');

// Dates in downloads read like "07 Oct 2026, 3:45 PM" in the company's reporting
// timezone (same as the server-built reports). Missing/invalid values become a dash.
const REPORT_TZ = import.meta.env.VITE_REPORT_TIMEZONE || 'Asia/Kolkata';
function fmtDateTime(v) {
  if (!v) return '—';
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return '—';
  try {
    const p = {};
    new Intl.DateTimeFormat('en-US', { timeZone: REPORT_TZ, day: '2-digit', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true })
      .formatToParts(d).forEach(x => { p[x.type] = x.value; });
    return `${p.day} ${p.month} ${p.year}, ${p.hour}:${p.minute} ${String(p.dayPeriod || '').toUpperCase()}`;
  } catch { return d.toLocaleString(); }
}
const numOrDash = (v, digits = 1) => (v === null || v === undefined || v === '' || !Number.isFinite(Number(v)) ? '—' : Math.round(Number(v) * 10 ** digits) / 10 ** digits);
const txt = (v) => { const t = String(v ?? '').trim(); return !t || t === 'undefined' || t === 'null' || t === 'NaN' ? '—' : t; };
function exportStatus(r) {
  const s = String(r.status || '').toLowerCase();
  if (s === 'submitted' || s === 'completed') return 'Completed';
  if (s === 'in_progress') return 'In progress';
  if (s === 'cancelled') return 'Cancelled';
  if (s === 'assigned') return 'Not started';
  return txt(r.status);
}

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
const TH_CLS = 'px-3 xl:px-4 py-3 text-left text-xs font-bold text-slate-400 uppercase tracking-wider select-none';
const TD_CLS = 'px-3 xl:px-4 py-3 text-sm text-slate-200 align-middle';
const PAGE_SIZE = 20;

function SortIcon({ active, dir }) {
  if (!active) return <span className="text-slate-500 text-xs ml-1">↕</span>;
  return <span className="text-indigo-400 text-xs ml-1">{dir === 'asc' ? '▲' : '▼'}</span>;
}

// Reports page for admins/managers: Training Reports (existing table) + Modules (engagement review)
function AdminReportsTabs({ user, navigate }) {
  const initial = new URLSearchParams(window.location.search).get('tab') === 'modules' ? 'modules' : 'training';
  const [tab, setTab] = useState(initial);
  return (
    <div className="bg-[#0F172A] min-h-screen">
      <PageContainer className="!pb-0">
        <TabBar active={tab} onChange={setTab} tabs={[{ key: 'training', label: 'Training Reports' }, { key: 'modules', label: 'Modules' }]} />
      </PageContainer>
      {tab === 'modules' ? <ModuleReports /> : <AdminReportView user={user} navigate={navigate} />}
    </div>
  );
}

// ─── Admin/Manager Report Table ───────────────────────────────────────────────
function AdminReportView({ user, navigate }) {
  const { notify } = useNotification();
  const { hasFeaturePermission } = useAuth();
  const [reports, setReports] = useState([]); // module reports (per-employee, with .assignments[])
  const [assessmentReports, setAssessmentReports] = useState([]);
  const [groups, setGroups] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [showDownloadModal, setShowDownloadModal] = useState(false);
  const [downloadingFmt, setDownloadingFmt] = useState(null);
  const [rowDownloadTarget, setRowDownloadTarget] = useState(null); // row awaiting format choice
  const [rowDownloadingFmt, setRowDownloadingFmt] = useState(null);

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
        staffId: '',
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
        assessmentId: r.assessmentId || '',
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
        staffId: r.staffId || r.employeeId || '',
        department: r.department || '',
        startedAt: r.startedAtResolved || null,
        timeTakenMin: Number.isFinite(Number(r.timeTakenSeconds)) ? Number(r.timeTakenSeconds) / 60 : null,
        rawScore: r.rawScore ?? r.score ?? null,
        rating: ratingForReport(r),
        strengths: (r.strengths || []).join('; '),
        weaknesses: (r.weakAreas || []).join('; '),
        skillGaps: (r.missingCompetencies || []).join('; '),
        recommendations: (r.improvementRecommendations || r.recommendedLearningAreas || []).map(x => (typeof x === 'string' ? x : x?.area || String(x))).join('; '),
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
      // simplified out of the on-screen table — so no data is lost by downloading.
      // Same column names as the server-built "Results" sheet.
      const headers = ['Employee ID', 'Employee Name', 'Email', 'Job Role', 'Department', 'Type', 'Assessment / Module', 'Status',
        'Assigned On', 'Due Date', 'Started At', 'Completed On', 'Time Taken (min)', 'Score %', 'Rating',
        'Progress %', 'Manager', 'Group', 'Strengths', 'Needs Improvement', 'Missing Skills', 'Recommendations'];
      const rows = sorted.map(r => {
        const isAssessment = r.type === 'assessment';
        const scoreVal = isAssessment ? (r.rawScore ?? r.score) : null;
        const hasScore = isAssessment && exportStatus(r) === 'Completed' && scoreVal !== null && scoreVal !== undefined;
        return [
          txt(r.staffId || r.employeeId), txt(r.employeeName), txt(r.email), txt(r.jobRole), txt(r.department),
          isAssessment ? 'Assessment' : 'Module', txt(r.name), exportStatus(r),
          fmtDateTime(r.assignedDate), fmtDateTime(r.deadline), fmtDateTime(r.startedAt), fmtDateTime(r.completedDate),
          numOrDash(r.timeTakenMin), hasScore ? numOrDash(scoreVal) : '—', hasScore ? (r.rating || '—') : '—',
          !isAssessment && r.progress != null ? numOrDash(r.progress, 0) : '—',
          txt(r.manager), txt(r.group), txt(r.strengths), txt(r.weaknesses), txt(r.skillGaps), txt(r.recommendations),
        ];
      });
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
      notify('Reports exported successfully', 'success');
    } catch (e) {
      notify(e.message || 'Export failed', 'error');
    } finally {
      setDownloadingFmt(null);
    }
  };

  // Downloads the FULL enterprise report (employee details, assessment details,
  // every question with answers/marks/result, performance analysis, linked
  // module info, and audit trail) for a single assessment row.
  const downloadSingleAssessmentReport = async (row, format) => {
    if (!row.assessmentId) { notify('This report cannot be downloaded (missing assessment reference).', 'error'); return; }
    setRowDownloadingFmt(format);
    try {
      const token = localStorage.getItem('auth_token');
      const BASE = import.meta.env.VITE_API_URL || (import.meta.env.PROD ? '' : 'http://localhost:3001');
      const res = await fetch(`${BASE}/api/assessments/${row.assessmentId}/reports/${row.employeeId}/download?format=${format}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error('Download failed');
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      const ext = format === 'pdf' ? 'pdf' : format === 'docx' ? 'docx' : 'xlsx';
      const safeName = (row.employeeName + '-' + row.name).replace(/[^a-zA-Z0-9-_ ]/g, '_');
      a.download = `${safeName}.${ext}`;
      a.click();
      URL.revokeObjectURL(url);
      setRowDownloadTarget(null);
      notify('Report downloaded successfully', 'success');
    } catch (e) {
      notify(e.message || 'Download failed', 'error');
    } finally {
      setRowDownloadingFmt(null);
    }
  };

  return (
    <div className="min-h-screen bg-[#0F172A] text-white px-3 sm:px-5 lg:px-6 2xl:px-8 py-6 w-full">
      <button onClick={() => navigate(-1)} className="text-slate-400 hover:text-white text-sm mb-6 flex items-center gap-2">← Back to Dashboard</button>

      <PageHeader
        title="Training Reports"
        subtitle={user?.role === 'manager' ? "Your team's training completion overview" : 'Platform-wide employee training completion overview'}
        actions={<>
          <Button variant="success" onClick={() => setShowDownloadModal(true)} disabled={!!downloadingFmt || !hasFeaturePermission('reports.export')}
            title={!hasFeaturePermission('reports.export') ? "You don't have permission to export reports" : undefined}>
            {downloadingFmt ? 'Downloading…' : 'Download All Reports'}
          </Button>
          <Button variant="secondary" onClick={loadReports}>Refresh</Button>
        </>}
      />

      {/* Table card */}
      <div className="rounded-2xl border border-slate-700/40 bg-slate-900/60 overflow-hidden">
        {/* Filter bar */}
        <div className="flex flex-col gap-3 px-5 py-4 border-b border-slate-700/40">
          <input type="text" placeholder="Search by employee, email, or assessment/module name..." value={search} onChange={e => setSearch(e.target.value)}
            className="w-full px-4 py-3 rounded-xl bg-slate-800 border border-slate-700 text-base text-white placeholder-slate-400 focus:outline-none focus:border-indigo-500" />
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
              <label className="text-sm text-slate-400">From</label>
              <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)}
                className="px-3 py-2 bg-slate-800 border border-slate-700/60 rounded-lg text-slate-300 text-sm focus:outline-none focus:border-indigo-500" />
            </div>
            <div className="flex items-center gap-1.5">
              <label className="text-sm text-slate-400">To</label>
              <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)}
                className="px-3 py-2 bg-slate-800 border border-slate-700/60 rounded-lg text-slate-300 text-sm focus:outline-none focus:border-indigo-500" />
            </div>
            {hasActiveFilters && (
              <button onClick={clearFilters}
                className="px-3 py-2 bg-slate-700/50 border border-slate-600/40 rounded-lg text-slate-300 text-sm font-semibold hover:text-white transition-colors">
                Clear Filters
              </button>
            )}
          </div>
          <p className="text-sm text-slate-400">
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
            <button onClick={loadReports} className="mt-4 px-4 py-3 rounded-lg bg-red-500/10 border border-red-500/30 text-red-300 text-sm hover:bg-red-500/20 transition-colors">Retry</button>
          </div>
        ) : sorted.length === 0 ? (
          <div className="py-16 text-center">
            <div className="text-5xl mb-4 opacity-20">📊</div>
            <p className="text-lg font-bold text-slate-400 mb-1">No Reports Found</p>
            <p className="text-sm text-slate-400">{hasActiveFilters ? 'Try adjusting or clearing your filters.' : 'Reports will appear once employees have assignments.'}</p>
          </div>
        ) : (
          <>
            {/* Simplified frontend view — Employee Name, ID, Email, Job Role, Assessment/Module,
                Status, Score, Progress, Completed Date + Actions. Every other field (Type,
                Deadline, Manager, Group, Assigned Date, etc.) is still stored and included in
                every export (PDF/Excel/DOC) below — nothing is deleted, only hidden from view. */}
            <div className="min-w-0">
              <table className="w-full border-collapse">
                <thead className="sticky top-0 z-10 bg-slate-900">
                  <tr className="border-b border-slate-700/40">
                    <th className={TH_CLS}><button onClick={() => toggleSort('employeeName')} className="flex items-center hover:text-white transition-colors">Employee Name<SortIcon active={sortCol === 'employeeName'} dir={sortDir} /></button></th>
                    <th className={`${TH_CLS} hidden xl:table-cell`}><button onClick={() => toggleSort('employeeId')} className="flex items-center hover:text-white transition-colors">Employee ID<SortIcon active={sortCol === 'employeeId'} dir={sortDir} /></button></th>
                    <th className={`${TH_CLS} hidden xl:table-cell`}><button onClick={() => toggleSort('jobRole')} className="flex items-center hover:text-white transition-colors">Job Role<SortIcon active={sortCol === 'jobRole'} dir={sortDir} /></button></th>
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
                    // Assessment scores are coloured by their rating band (the same scale the
                    // employee's report and the exports use); module completion % keeps its
                    // existing tiered coloring.
                    const valueColor = r.type === 'assessment'
                      ? ratingStyle(r.rating).text
                      : (displayValue >= 80 ? 'text-emerald-400' : displayValue >= 50 ? 'text-amber-400' : 'text-red-400');
                    return (
                      <tr key={r.id} className="hover:bg-slate-800/20 transition-all h-[52px]">
                        <td className={TD_CLS}>
                          <div className="flex items-center gap-2 min-w-0">
                            <div className="w-8 h-8 rounded-full bg-gradient-to-br from-indigo-500/30 to-purple-500/20 border border-indigo-500/20 flex items-center justify-center text-xs font-black text-indigo-300 flex-shrink-0">
                              {r.employeeName.charAt(0).toUpperCase()}
                            </div>
                            <div className="min-w-0"><span className="block font-semibold text-white truncate" title={r.employeeName}>{r.employeeName}</span><span className="xl:hidden block text-xs text-slate-400 truncate" title={`${r.staffId || r.employeeId || ''} ${r.jobRole || ''}`}>{r.staffId || r.employeeId}{r.jobRole ? ` · ${r.jobRole}` : ''}</span></div>
                          </div>
                        </td>
                        <td className={`${TD_CLS} hidden xl:table-cell text-slate-400 font-mono text-xs truncate max-w-[140px]`} title={r.staffId || r.employeeId}>{r.staffId || r.employeeId}</td>
                        <td className={`${TD_CLS} hidden xl:table-cell text-slate-400 truncate max-w-[130px]`} title={r.jobRole}>{r.jobRole}</td>
                        <td className={`${TD_CLS} truncate max-w-[320px]`} title={r.name}>
                          <span className="mr-1">{r.type === 'assessment' ? '📝' : '📚'}</span>{r.name}
                        </td>
                        <td className={TD_CLS}><span className="capitalize text-xs px-2 py-0.5 rounded bg-slate-700/40 border border-slate-600/40 whitespace-nowrap">{r.status}</span></td>
                        <td className={TD_CLS}>{r.score != null ? (
                          <span className="inline-flex items-center gap-1.5 min-w-0">
                            <span className={`text-xs font-bold ${valueColor}`}>{Math.round(r.score)}%</span>
                            {r.type === 'assessment' && r.rating && <span className={`truncate px-1.5 py-0.5 rounded text-xs font-bold ${ratingStyle(r.rating).chip}`} title={`Rating: ${r.rating}`}>{r.rating}</span>}
                          </span>
                        ) : <span className="text-slate-600">—</span>}</td>
                        <td className={TD_CLS}>
                          {r.progress != null ? (
                            <div className="flex items-center gap-2 min-w-[60px]">
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
                              className="px-3 py-2 rounded-lg border text-sm font-semibold transition-all whitespace-nowrap bg-indigo-600/20 border-indigo-500/30 text-indigo-300 hover:bg-indigo-600/30"
                            >
                              Download PDF
                            </button>
                          ) : (
                            <button
                              onClick={() => setRowDownloadTarget(r)}
                              disabled={!hasFeaturePermission('reports.download')}
                              title={!hasFeaturePermission('reports.download') ? "You don't have permission to download reports" : 'Download full report'}
                              className="px-3 py-2 rounded-lg border text-sm font-semibold whitespace-nowrap bg-slate-700/30 border-slate-600/30 text-slate-300 hover:bg-slate-700/50 hover:border-slate-500/50 disabled:opacity-40 disabled:cursor-not-allowed transition-all"
                            >
                              Download Report
                            </button>
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
                <p className="text-sm text-slate-400">Page {page} of {totalPages}</p>
                <div className="flex gap-1.5">
                  <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1}
                    className="px-4 py-2 rounded-lg bg-slate-800 border border-slate-700 text-slate-300 text-sm font-semibold disabled:opacity-30 hover:enabled:bg-slate-700 transition-colors">‹ Prev</button>
                  <button onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page === totalPages}
                    className="px-4 py-2 rounded-lg bg-slate-800 border border-slate-700 text-slate-300 text-sm font-semibold disabled:opacity-30 hover:enabled:bg-slate-700 transition-colors">Next ›</button>
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

      {rowDownloadTarget && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-[200] p-4 overflow-y-auto" onClick={e => e.target === e.currentTarget && !rowDownloadingFmt && setRowDownloadTarget(null)}>
          <div className="bg-[#1E293B] border border-slate-700 rounded-2xl w-full max-w-sm shadow-2xl p-6 my-8 max-h-[85vh] overflow-y-auto">
            <h3 className="text-lg font-bold text-white mb-1">Download Full Report</h3>
            <p className="text-slate-400 text-sm mb-1 truncate">{rowDownloadTarget.employeeName} — {rowDownloadTarget.name}</p>
            <p className="text-xs text-slate-500 mb-4">Includes employee details, full question-by-question breakdown, performance analysis, and audit trail</p>
            <div className="space-y-3">
              {[
                { fmt: 'xlsx', label: 'Excel (.xlsx)', icon: '📊', desc: 'Summary + question sheets' },
                { fmt: 'pdf',  label: 'PDF (.pdf)',   icon: '📄', desc: 'Complete formatted report' },
                { fmt: 'docx', label: 'Word (.docx)', icon: '📝', desc: 'Editable document' },
              ].map(({ fmt, label, icon, desc }) => (
                <button key={fmt} onClick={() => downloadSingleAssessmentReport(rowDownloadTarget, fmt)} disabled={!!rowDownloadingFmt}
                  className="w-full flex items-center gap-4 p-4 rounded-xl bg-slate-800/60 border border-slate-700 hover:border-indigo-500/50 hover:bg-slate-800 transition-all text-left disabled:opacity-50">
                  <span className="text-2xl">{icon}</span>
                  <div>
                    <p className="text-sm font-bold text-white">{rowDownloadingFmt === fmt ? 'Generating…' : label}</p>
                    <p className="text-xs text-slate-400">{desc}</p>
                  </div>
                </button>
              ))}
            </div>
            <button onClick={() => setRowDownloadTarget(null)} disabled={!!rowDownloadingFmt} className="mt-4 w-full py-2 text-sm text-slate-400 hover:text-white transition-colors disabled:opacity-40">Cancel</button>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Employee Report View ─────────────────────────────────────────────────────
// Was: fetched GET /api/report/:userId, which only ever had data for users
// onboarded through the old goal-based SmartAgent/learningUUID system —
// every employee onboarded through the current assessment/module system hit
// a 404 here and landed on a dead "Generate Report" button forever, since
// generateReport() posts into that same dead system. Replaced with a single
// page listing every past module and assessment this employee actually has,
// each linking to its own already-working report view (ModuleReport /
// Assessment.jsx's submitted-assessment view) — no old-system dependency.
function EmployeeReportView({ user, navigate }) {
  const [modules, setModules] = useState([]);
  const [assessments, setAssessments] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      try {
        const [assignRes, assessRes] = await Promise.allSettled([
          authFetch(`/api/assignments?userId=${user.userId || user.id}`),
          authFetch('/api/assessments/my?light=1'),
        ]);
        if (assignRes.status === 'fulfilled') {
          const raw = assignRes.value?.data ?? assignRes.value;
          const list = raw?.assignments || (Array.isArray(raw) ? raw : []);
          setModules(list.filter(a => (a.type || a.assignable_type) === 'module'));
        }
        if (assessRes.status === 'fulfilled') {
          const raw = assessRes.value?.data ?? assessRes.value;
          setAssessments(Array.isArray(raw) ? raw : (raw?.assessments || []));
        }
      } catch (_) {
      } finally {
        setLoading(false);
      }
    };
    if (user) load();
  }, [user]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#0F172A]">
        <div className="text-center">
          <div className="animate-spin text-indigo-400 text-4xl mb-4">⟳</div>
          <div className="text-slate-400 text-sm">Loading your history...</div>
        </div>
      </div>
    );
  }

  const hasNothing = modules.length === 0 && assessments.length === 0;

  return (
    <div className="min-h-screen bg-[#0F172A] text-white px-3 sm:px-5 lg:px-6 2xl:px-8 py-6 w-full">
      <button onClick={() => navigate(-1)} className="text-slate-400 hover:text-white text-sm mb-6 flex items-center gap-2">← Back to Dashboard</button>

      <div className="mb-8">
        <h1 className="text-3xl font-black text-white">My Learning History</h1>
        <p className="text-slate-400 text-base">Every module and assessment you've been assigned</p>
      </div>

      {hasNothing ? (
        <div className="text-center py-16">
          <div className="text-5xl mb-4">📄</div>
          <h2 className="text-xl font-black mb-2">Nothing here yet</h2>
          <p className="text-slate-400">You'll see your modules and assessments here once you're assigned some.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-5 items-start">
          {modules.length > 0 && (
            <div className="rounded-2xl border border-slate-700/40 bg-slate-900/60 p-4 sm:p-5">
              <h3 className="text-base font-bold text-slate-300 uppercase tracking-wider mb-4">Modules</h3>
              <div className="space-y-3">
                {modules.map((m, i) => (
                  <div key={m.id || i} className="flex items-center justify-between gap-3 p-4 rounded-xl bg-slate-800/40 border border-slate-700/30">
                    <div className="min-w-0">
                      <p className="font-semibold text-white truncate">{m.title || m.module_name || m.name || `Module #${i + 1}`}</p>
                      <p className="text-sm text-slate-400 mt-0.5">Status: {m.status || 'assigned'} · Progress: {m.progress || 0}%</p>
                    </div>
                    <button
                      onClick={() => navigate(`/report?moduleId=${m.assignable_id || m.module_id}&assignmentId=${m.id}`)}
                      className="flex-shrink-0 px-4 py-2 rounded-lg bg-slate-700/40 border border-slate-600/40 text-slate-200 hover:bg-slate-700/60 hover:text-white text-sm font-bold transition-all whitespace-nowrap"
                    >
                      View Report →
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {assessments.length > 0 && (
            <div className="rounded-2xl border border-slate-700/40 bg-slate-900/60 p-4 sm:p-5">
              <h3 className="text-base font-bold text-slate-300 uppercase tracking-wider mb-4">Assessments</h3>
              <div className="space-y-3">
                {assessments.map((a, i) => {
                  const id = a.id || a._id;
                  const isSubmitted = a.status === 'submitted' || a.status === 'completed';
                  const score = a.submission?.scoring?.score ?? a.scoring?.score ?? a.score ?? null;
                  return (
                    <div key={id || i} className="flex items-center justify-between gap-3 p-4 rounded-xl bg-slate-800/40 border border-slate-700/30">
                      <div className="min-w-0">
                        <p className="font-semibold text-white truncate">{a.title}</p>
                        <p className="text-sm text-slate-400 mt-0.5">
                          Status: {a.status || 'pending'}{score !== null ? ` · Score: ${Math.round(score)}%` : ''}
                        </p>
                      </div>
                      {isSubmitted && id && (
                        <button
                          onClick={() => navigate(`/assessment/${id}`)}
                          className="flex-shrink-0 px-4 py-2 rounded-lg bg-slate-700/40 border border-slate-600/40 text-slate-200 hover:bg-slate-700/60 hover:text-white text-sm font-bold transition-all whitespace-nowrap"
                        >
                          View Report →
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}

      <div className="text-center text-xs text-slate-500 mt-8">SkillForge AI · Corporate Training Platform · Confidential</div>
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

  // Full per-day breakdown, built from sessions + persisted sessionReports —
  // the same data ModuleSession.jsx's NotesPhase/ScorePhase already save.
  const mod = moduleData || {};
  const asn = assignmentData || {};
  const sessions = mod.sessions || mod.content?.sessions || [];
  const sessionProgress = asn.sessionProgress || {};
  const sessionReports = asn.progressData?.sessionReports || {};

  const dayRows = sessions.map((s, i) => {
    const report = sessionReports[i];
    const status = sessionProgress[i] === 'completed' ? 'completed' : (report ? 'completed' : 'not started');
    return {
      day: i + 1,
      title: s.title || s.topic || `Day ${i + 1}`,
      status,
      score: report?.score ?? null,
      correct: report?.correct ?? null,
      total: report?.total ?? null,
      completedAt: report?.completedAt || null,
      strengths: report?.strengths || [],
      weaknesses: report?.weaknesses || [],
    };
  });

  const completedRows = dayRows.filter(r => r.score !== null);
  const avgScore = completedRows.length > 0
    ? Math.round(completedRows.reduce((s, r) => s + r.score, 0) / completedRows.length)
    : null;
  const totalQuestions = completedRows.reduce((s, r) => s + (r.total || 0), 0);
  const totalCorrect = completedRows.reduce((s, r) => s + (r.correct || 0), 0);
  const allStrengths = [...new Set(completedRows.flatMap(r => r.strengths))];
  const allWeaknesses = [...new Set(completedRows.flatMap(r => r.weaknesses))];
  const bestDay = completedRows.length > 0 ? completedRows.reduce((a, b) => (b.score > a.score ? b : a)) : null;
  const worstDay = completedRows.length > 0 ? completedRows.reduce((a, b) => (b.score < a.score ? b : a)) : null;

  const downloadModuleReportPDF = () => {
    const sessionsCompleted = dayRows.filter(r => r.status === 'completed').length;
    const totalSessions = sessions.length;
    const rowsHtml = dayRows.map(r => `<tr>
      <td>Day ${r.day}</td>
      <td>${r.title}</td>
      <td><span class="badge ${r.status === 'completed' ? 'badge-completed' : 'badge-assigned'}">${r.status}</span></td>
      <td>${r.score !== null ? r.score + '%' : '—'}</td>
      <td>${r.correct !== null ? `${r.correct}/${r.total}` : '—'}</td>
      <td>${r.completedAt ? new Date(r.completedAt).toLocaleDateString() : '—'}</td>
    </tr>`).join('');
    const html = `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<title>Module Report — ${mod.title || 'Module'}</title>
<style>
  body { font-family: Arial, sans-serif; color: #1e293b; padding: 40px; max-width: 800px; margin: 0 auto; }
  h1 { color: #4f46e5; font-size: 24px; margin-bottom: 4px; }
  .meta { color: #64748b; font-size: 14px; margin-bottom: 24px; }
  .stat-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 16px; margin-bottom: 24px; }
  .stat { background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 10px; padding: 16px; text-align: center; }
  .stat-val { font-size: 24px; font-weight: 900; color: #4f46e5; }
  .stat-label { font-size: 11px; color: #94a3b8; text-transform: uppercase; letter-spacing: 1px; margin-top: 4px; }
  h2 { font-size: 14px; color: #64748b; text-transform: uppercase; letter-spacing: 1px; margin: 24px 0 12px; border-bottom: 1px solid #e2e8f0; padding-bottom: 8px; }
  table { width: 100%; border-collapse: collapse; font-size: 13px; }
  th { text-align: left; padding: 8px 12px; background: #f1f5f9; color: #64748b; font-size: 11px; text-transform: uppercase; letter-spacing: 0.5px; }
  td { padding: 10px 12px; border-bottom: 1px solid #f1f5f9; }
  .badge { display: inline-block; padding: 2px 8px; border-radius: 999px; font-size: 10px; font-weight: 700; }
  .badge-completed { background: #d1fae5; color: #065f46; }
  .badge-assigned { background: #dbeafe; color: #1e40af; }
  ul { margin: 4px 0; padding-left: 18px; font-size: 12px; }
  .footer { margin-top: 40px; text-align: center; color: #94a3b8; font-size: 11px; }
  @media print { body { padding: 20px; } }
</style>
</head>
<body>
<h1>SkillForge AI — Module Training Report</h1>
<div class="meta">${mod.title || 'Module'} · ${user?.name || user?.email || ''} · Generated ${new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}</div>
<div class="stat-grid">
  <div class="stat"><div class="stat-val">${asn.progress || 0}%</div><div class="stat-label">Progress</div></div>
  <div class="stat"><div class="stat-val">${sessionsCompleted}/${totalSessions || '—'}</div><div class="stat-label">Days Completed</div></div>
  <div class="stat"><div class="stat-val">${avgScore !== null ? avgScore + '%' : '—'}</div><div class="stat-label">Avg Quiz Score</div></div>
  <div class="stat"><div class="stat-val">${totalCorrect}/${totalQuestions || '—'}</div><div class="stat-label">Questions Correct</div></div>
</div>
<h2>Day-by-Day Performance</h2>
<table>
<thead><tr><th>Day</th><th>Title</th><th>Status</th><th>Score</th><th>Correct</th><th>Completed</th></tr></thead>
<tbody>${rowsHtml}</tbody>
</table>
${allStrengths.length > 0 ? `<h2>Strengths</h2><ul>${allStrengths.map(s => `<li>${s}</li>`).join('')}</ul>` : ''}
${allWeaknesses.length > 0 ? `<h2>Areas to Improve</h2><ul>${allWeaknesses.map(s => `<li>${s}</li>`).join('')}</ul>` : ''}
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

  const sessionsCompleted = dayRows.filter(r => r.status === 'completed').length;
  const totalSessions = sessions.length;
  const progress = asn.progress || 0;
  const statusColor = asn.status === 'completed' ? 'text-emerald-400' : asn.status === 'in_progress' ? 'text-amber-400' : 'text-slate-400';

  return (
    <div className="min-h-screen bg-[#0F172A] text-white px-3 sm:px-5 lg:px-6 2xl:px-8 py-6 w-full">
      <button
        onClick={() => navigate(`/module/${moduleId}/learn${assignmentId ? `?assignmentId=${assignmentId}` : ''}`)}
        className="text-slate-400 hover:text-white text-sm mb-6 flex items-center gap-2"
      >
        ← Back to Module
      </button>

      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-3xl font-black text-white">Module Report</h1>
          <p className="text-slate-400 text-base mt-0.5">{mod.title || 'Module Training Report'}</p>
        </div>
        <div className="flex flex-wrap gap-3">
          <button
            onClick={downloadModuleReportPDF}
            className="px-4 py-2 rounded-lg bg-slate-800/60 border border-slate-700/50 text-slate-300 hover:text-white text-sm font-medium transition-all"
          >
            Download Report
          </button>
          <button
            onClick={() => navigate(`/module/${moduleId}/learn${assignmentId ? `?assignmentId=${assignmentId}` : ''}`)}
            className="px-4 py-2 rounded-lg bg-indigo-600/20 border border-indigo-500/30 text-indigo-300 hover:bg-indigo-600/30 text-sm font-bold transition-all"
          >
            Back to Module
          </button>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <div className="rounded-2xl border border-indigo-500/20 bg-indigo-500/5 p-5">
          <p className="text-sm text-indigo-400 font-bold uppercase tracking-wider mb-1">Overall Progress</p>
          <p className="text-3xl font-black text-white">{progress}<span className="text-xl text-indigo-400">%</span></p>
        </div>
        <div className="rounded-2xl border border-emerald-500/20 bg-emerald-500/5 p-5">
          <p className="text-sm text-emerald-400 font-bold uppercase tracking-wider mb-1">Days Completed</p>
          <p className="text-3xl font-black text-white">{sessionsCompleted}<span className="text-xl text-slate-400">/{totalSessions || '—'}</span></p>
        </div>
        <div className="rounded-2xl border border-amber-500/20 bg-amber-500/5 p-5">
          <p className="text-sm text-amber-400 font-bold uppercase tracking-wider mb-1">Avg Quiz Score</p>
          <p className="text-3xl font-black text-white">{avgScore !== null ? <>{avgScore}<span className="text-xl text-amber-400">%</span></> : '—'}</p>
        </div>
        <div className="rounded-2xl border border-purple-500/20 bg-purple-500/5 p-5">
          <p className="text-sm text-purple-400 font-bold uppercase tracking-wider mb-1">Status</p>
          <p className={`text-xl font-black capitalize ${statusColor}`}>{asn.status || 'assigned'}</p>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
        <div className="rounded-xl border border-slate-700/40 bg-slate-900/60 p-4">
          <p className="text-sm text-slate-400 font-bold uppercase tracking-wider mb-1">Questions Answered</p>
          <p className="text-xl font-black text-white">{totalCorrect}<span className="text-sm text-slate-400">/{totalQuestions || '—'} correct</span></p>
        </div>
        <div className="rounded-xl border border-slate-700/40 bg-slate-900/60 p-4">
          <p className="text-sm text-slate-400 font-bold uppercase tracking-wider mb-1">Best Day</p>
          <p className="text-base font-bold text-white truncate">{bestDay ? `Day ${bestDay.day} — ${bestDay.score}%` : '—'}</p>
        </div>
        <div className="rounded-xl border border-slate-700/40 bg-slate-900/60 p-4">
          <p className="text-sm text-slate-400 font-bold uppercase tracking-wider mb-1">Needs Review</p>
          <p className="text-base font-bold text-white truncate">{worstDay ? `Day ${worstDay.day} — ${worstDay.score}%` : '—'}</p>
        </div>
      </div>

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

      {mod.description || mod.skills?.length > 0 ? (
        <div className="rounded-2xl border border-slate-700/40 bg-slate-900/60 p-6 mb-6">
          <h3 className="text-sm font-bold text-slate-400 uppercase tracking-wider mb-3">Module Details</h3>
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
      ) : null}

      {/* Score trend across completed days */}
      {completedRows.length > 0 && (
        <div className="rounded-2xl border border-slate-700/40 bg-slate-900/60 p-6 mb-6">
          <h3 className="text-sm font-bold text-slate-400 uppercase tracking-wider mb-4">Quiz Score by Day</h3>
          <div className="space-y-2.5">
            {completedRows.map(r => (
              <div key={r.day}>
                <div className="flex items-center justify-between text-sm text-slate-300 mb-1">
                  <span>Day {r.day} — {r.title}</span>
                  <span className="text-slate-400 font-semibold">{r.score}%</span>
                </div>
                <div className="h-2.5 rounded-full bg-slate-800 overflow-hidden">
                  <div
                    className={`h-full rounded-full ${r.score >= 70 ? 'bg-emerald-500' : r.score >= 40 ? 'bg-amber-500' : 'bg-rose-500'}`}
                    style={{ width: `${r.score}%` }}
                  />
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Day-by-day breakdown table */}
      <div className="rounded-2xl border border-slate-700/40 bg-slate-900/60 overflow-hidden mb-6">
        <div className="p-4 border-b border-slate-700/40">
          <h3 className="text-sm font-bold text-slate-400 uppercase tracking-wider">Day-by-Day Breakdown</h3>
        </div>
        <div className="min-w-0">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-slate-400 uppercase tracking-wider border-b border-slate-700/40">
                <th className="px-4 py-3">Day</th>
                <th className="px-4 py-3">Session</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Score</th>
                <th className="px-4 py-3">Correct</th>
                <th className="px-4 py-3">Completed</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-700/30">
              {dayRows.map(r => (
                <tr key={r.day}>
                  <td className="px-4 py-3 text-slate-400 font-semibold">{r.day}</td>
                  <td className="px-4 py-3 text-white font-medium max-w-md truncate" title={r.title}>{r.title}</td>
                  <td className="px-4 py-3">
                    <span className={`px-2 py-0.5 rounded-full text-xs font-bold border ${r.status === 'completed' ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400' : 'bg-slate-700/40 border-slate-600/40 text-slate-400'}`}>
                      {r.status}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-slate-300">{r.score !== null ? `${r.score}%` : '—'}</td>
                  <td className="px-4 py-3 text-slate-300">{r.correct !== null ? `${r.correct}/${r.total}` : '—'}</td>
                  <td className="px-4 py-3 text-slate-400 text-sm">{r.completedAt ? new Date(r.completedAt).toLocaleDateString() : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Strengths & weaknesses, aggregated across every completed day */}
      {(allStrengths.length > 0 || allWeaknesses.length > 0) && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-6">
          {allStrengths.length > 0 && (
            <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-5">
              <h3 className="text-sm font-bold text-emerald-400 uppercase tracking-wider mb-3">💪 Strengths</h3>
              <ul className="space-y-1.5">
                {allStrengths.map((s, i) => (
                  <li key={i} className="text-sm text-slate-300 leading-snug flex gap-2"><span className="text-emerald-400 flex-shrink-0">✓</span><span>{s}</span></li>
                ))}
              </ul>
            </div>
          )}
          {allWeaknesses.length > 0 && (
            <div className="rounded-xl border border-rose-500/20 bg-rose-500/5 p-5">
              <h3 className="text-sm font-bold text-rose-400 uppercase tracking-wider mb-3">🎯 Areas to Review</h3>
              <ul className="space-y-1.5">
                {allWeaknesses.map((s, i) => (
                  <li key={i} className="text-sm text-slate-300 leading-snug flex gap-2"><span className="text-rose-400 flex-shrink-0">✗</span><span>{s}</span></li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      <div className="text-center text-xs text-slate-500">SkillForge AI · Corporate Training Platform · Confidential</div>
    </div>
  );
}

// ─── Main Export ──────────────────────────────────────────────────────────────
export default function Report() {
  const { user, activeRole } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const searchParams = new URLSearchParams(location.search);
  const moduleId = searchParams.get('moduleId');
  const assignmentId = searchParams.get('assignmentId');

  useEffect(() => {
    if (!user) navigate('/');
  }, [user, navigate]);

  if (!user) return null;

  // Route by the CURRENTLY ACTIVE view, not whether the user merely holds
  // admin/manager access somewhere on their profile — hasRole(['admin',
  // 'manager']) checks the raw accesses list regardless of which view is
  // active, so an employee who'd been granted manager/admin access (but is
  // currently switched to Employee View) was always sent to the shared
  // admin/manager report screen instead of their own, no matter which view
  // they were actually looking at.
  const isAdminOrManager = activeRole === 'admin' || activeRole === 'manager' || activeRole === 'superadmin';

  // Employee accessing report from inside a module (via URL params)
  if (!isAdminOrManager && assignmentId) {
    return <ModuleReport moduleId={moduleId} assignmentId={assignmentId} user={user} navigate={navigate} />;
  }

  if (isAdminOrManager) {
    return <AdminReportsTabs user={user} navigate={navigate} />;
  }

  return <EmployeeReportView user={user} navigate={navigate} />;
}
