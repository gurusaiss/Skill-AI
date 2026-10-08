/**
 * moduleReports.js - Reports > Modules.
 *
 *   GET /api/reports/modules                       list (filters + pagination)
 *   GET /api/reports/modules/export?format=...     consolidated download (same filters)
 *   GET /api/reports/modules/:assignmentId         full engagement detail
 *   GET /api/reports/modules/:assignmentId/download?format=xlsx|pdf|docx
 *
 * Access: admin / manager (a manager sees only their own team, an admin their
 * company), always through getVisibleEmployeeIds. Envelope {success,data,error}.
 */
import express from 'express';
import { authenticate, requireRole, requirePermission } from '../middleware/auth.js';
import { loadModuleRows, loadModuleDetail, loadDetails } from '../services/reports/moduleReportLoader.js';
import { filterRows, sortRows, summarizeRows, toJson } from '../services/reports/moduleReportData.js';
import { buildModuleWorkbook, buildConsolidatedModuleWorkbook, MAX_QUESTION_ROWS } from '../services/reports/moduleXlsx.js';
import { buildModulePdf, buildConsolidatedModulePdf } from '../services/reports/modulePdf.js';
import { buildModuleDocx, buildConsolidatedModuleDocx } from '../services/reports/moduleDocx.js';
import { safeFilename } from '../services/reports/reportData.js';

const router = express.Router();
const MIME = {
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  pdf: 'application/pdf',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  zip: 'application/zip',
};
const MAX_EXPORT_ROWS = 3000;
const MAX_ZIP_REPORTS = 150;

const fail = (res, code, status, message) => res.status(status).json({ success: false, data: null, error: { code, message } });
const send = (res, buf, ext, name) => {
  res.setHeader('Content-Type', MIME[ext]);
  res.setHeader('Content-Disposition', `attachment; filename="${name}.${ext}"`);
  return res.send(Buffer.isBuffer(buf) ? buf : Buffer.from(buf));
};

const FILTER_KEYS = ['status', 'employeeId', 'userId', 'moduleId', 'jobRole', 'department', 'manager', 'from', 'to', 'q'];
const pickFilters = (query) => Object.fromEntries(FILTER_KEYS.filter(k => query[k] !== undefined && query[k] !== '').map(k => [k, String(query[k]).slice(0, 120)]));
const describeFilters = (f) => {
  const parts = Object.entries({ status: f.status || 'completed', ...f }).filter(([, v]) => v).map(([k, v]) => `${k}: ${v}`);
  return [...new Set(parts)].join(' | ');
};

/** Dropdown values for the filter bar, from everything the caller may see. */
function buildOptions(rows) {
  const uniq = (fn) => [...new Set(rows.map(fn).filter(Boolean))].sort((a, b) => a.localeCompare(b));
  const emp = new Map(); const mods = new Map();
  for (const r of rows) {
    if (!emp.has(r.userId)) emp.set(r.userId, { userId: r.userId, employeeId: r.employeeId, name: r.name });
    if (r.moduleId && !mods.has(r.moduleId)) mods.set(r.moduleId, { id: r.moduleId, title: r.moduleTitle });
  }
  return {
    employees: [...emp.values()].sort((a, b) => a.name.localeCompare(b.name)),
    modules: [...mods.values()].sort((a, b) => a.title.localeCompare(b.title)),
    jobRoles: uniq(r => r.jobRole), departments: uniq(r => r.department), managers: uniq(r => r.managerName),
  };
}

router.get('/modules', authenticate, requireRole('admin', 'manager'), async (req, res) => {
  try {
    const { rows: all } = await loadModuleRows(req.user);
    const filtered = sortRows(filterRows(all, pickFilters(req.query)));
    const limit = Math.min(200, Math.max(1, parseInt(req.query.limit, 10) || 50));
    const offset = Math.max(0, parseInt(req.query.offset, 10) || 0);
    res.json({
      success: true,
      data: {
        rows: filtered.slice(offset, offset + limit).map(toJson),
        total: filtered.length, limit, offset,
        summary: summarizeRows(filtered),
        options: buildOptions(all),
      },
      error: null,
    });
  } catch (e) {
    console.error('[GET /api/reports/modules]', e);
    fail(res, 'MODULE_REPORT_ERROR', 500, 'Failed to load module reports');
  }
});

router.get('/modules/export', authenticate, requireRole('admin', 'manager'), requirePermission('reports.export'), async (req, res) => {
  try {
    const format = String(req.query.format || 'xlsx').toLowerCase();
    if (!['xlsx', 'pdf', 'docx', 'zip'].includes(format)) return fail(res, 'MODULE_REPORT_FORMAT', 400, 'Unsupported format. Use xlsx, pdf, docx or zip.');
    const filters = pickFilters(req.query);
    const { rows: all, company } = await loadModuleRows(req.user);
    const matched = sortRows(filterRows(all, filters));
    if (!matched.length) return fail(res, 'MODULE_REPORT_EMPTY', 404, 'No module records match these filters.');
    const rows = matched.slice(0, MAX_EXPORT_ROWS);
    const summary = summarizeRows(matched);
    const filtersText = describeFilters(filters);
    const name = `Module-Report-${new Date().toISOString().slice(0, 10)}`;
    const companyName = company?.name || '';

    if (format === 'xlsx') {
      const { records, truncated } = await loadDetails(req.user, rows, { maxQuestions: MAX_QUESTION_ROWS });
      const note = [
        matched.length > rows.length ? `Only the first ${rows.length} of ${matched.length} records are listed.` : '',
        truncated ? `Questions are limited to ${MAX_QUESTION_ROWS} rows per file; ${records.length} of ${rows.length} employee-modules are included in the Questions sheet. Narrow the filters or download single reports for the rest.` : '',
      ].filter(Boolean).join(' ');
      return send(res, buildConsolidatedModuleWorkbook({ rows, records, summary, truncatedNote: note, filtersText }), 'xlsx', name);
    }
    if (format === 'pdf') return send(res, await buildConsolidatedModulePdf({ rows, summary, company: companyName, filtersText }), 'pdf', name);
    if (format === 'docx') return send(res, await buildConsolidatedModuleDocx({ rows, summary, company: companyName, filtersText }), 'docx', name);

    // zip: the consolidated workbook plus one individual report per employee-module
    const AdmZip = (await import('adm-zip')).default;
    const zip = new AdmZip();
    const sub = String(req.query.subformat || 'pdf').toLowerCase() === 'docx' ? 'docx' : 'pdf';
    const { records } = await loadDetails(req.user, rows.slice(0, MAX_ZIP_REPORTS), { maxQuestions: MAX_QUESTION_ROWS * 4 });
    zip.addFile('Module-Report.xlsx', buildConsolidatedModuleWorkbook({ rows, records, summary, filtersText, truncatedNote: matched.length > MAX_ZIP_REPORTS ? `Individual reports are included for the first ${MAX_ZIP_REPORTS} records only.` : '' }));
    const used = new Set();
    for (const r of records) {
      try {
        const buf = sub === 'docx' ? await buildModuleDocx({ record: r }) : await buildModulePdf({ record: r });
        let base = safeFilename([r.name, r.employeeId, r.moduleTitle].filter(Boolean).join(' - '), `report-${r.assignmentId}`);
        while (used.has(base.toLowerCase())) base += '_';
        used.add(base.toLowerCase());
        zip.addFile(`${base}.${sub}`, buf);
      } catch (e) { console.warn('[module export ZIP] skipped one report:', e.message); }
    }
    return send(res, zip.toBuffer(), 'zip', name);
  } catch (e) {
    console.error('[GET /api/reports/modules/export]', e);
    fail(res, 'MODULE_REPORT_ERROR', 500, 'Export failed');
  }
});

router.get('/modules/:assignmentId', authenticate, requireRole('admin', 'manager'), async (req, res) => {
  try {
    const d = await loadModuleDetail(req.user, req.params.assignmentId);
    if (d.error === 'not_found') return fail(res, 'MODULE_REPORT_NOT_FOUND', 404, 'Module record not found');
    if (d.error === 'forbidden') return fail(res, 'AUTH_FORBIDDEN', 403, 'You cannot view this employee');
    res.json({ success: true, data: { record: toJson(d.record) }, error: null });
  } catch (e) {
    console.error('[GET /api/reports/modules/:id]', e);
    fail(res, 'MODULE_REPORT_ERROR', 500, 'Failed to load module report');
  }
});

router.get('/modules/:assignmentId/download', authenticate, requireRole('admin', 'manager'), requirePermission('reports.download'), async (req, res) => {
  try {
    const format = String(req.query.format || 'pdf').toLowerCase();
    if (!['xlsx', 'pdf', 'docx'].includes(format)) return fail(res, 'MODULE_REPORT_FORMAT', 400, 'Unsupported format. Use xlsx, pdf or docx.');
    const d = await loadModuleDetail(req.user, req.params.assignmentId);
    if (d.error === 'not_found') return fail(res, 'MODULE_REPORT_NOT_FOUND', 404, 'Module record not found');
    if (d.error === 'forbidden') return fail(res, 'AUTH_FORBIDDEN', 403, 'You cannot view this employee');
    const record = d.record;
    const name = safeFilename([record.name, record.employeeId, record.moduleTitle].filter(Boolean).join(' - '), 'Module-Report');
    if (format === 'xlsx') return send(res, buildModuleWorkbook({ record }), 'xlsx', name);
    if (format === 'pdf') return send(res, await buildModulePdf({ record }), 'pdf', name);
    return send(res, await buildModuleDocx({ record }), 'docx', name);
  } catch (e) {
    console.error('[GET /api/reports/modules/:id/download]', e);
    fail(res, 'MODULE_REPORT_ERROR', 500, 'Download failed');
  }
});

export default router;
