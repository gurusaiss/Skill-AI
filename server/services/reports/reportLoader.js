/**
 * reportLoader.js — gathers the live records an export needs (users, managers,
 * groups, company, reminders, per-employee schedule rows) and hands them to the
 * pure builders in reportData.js. Everything saved at submit time wins; these
 * lookups only fill in gaps for older records.
 */
import UserStore from '../UserStore.js';
import { Assessments, Companies, Groups, EmployeeAssessmentAssignments, Reminders } from '../DataStore.js';
import { buildResultRow, buildSummary, pickReport, STATUS } from './reportData.js';

async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i], i);
    }
  });
  await Promise.all(workers);
  return out;
}

async function lookups(companyId) {
  let users = [];
  try {
    const res = await UserStore.getAllUsers(companyId ? { companyId } : {});
    users = Array.isArray(res) ? res : (res?.users || []);
  } catch { /* exports still work from snapshots */ }
  const groups = await Groups.getAll().catch(() => []);
  return {
    userById: new Map(users.map(u => [u.userId || u.id, u])),
    groups: Array.isArray(groups) ? groups : [],
  };
}

/**
 * Makes sure every id has its live user record in `userById`. The bulk list can
 * miss users (stale cache, paging, a failed bulk read), which used to leave the
 * Email (and staff ID / manager) blank for those employees. Missing ids are
 * fetched in one batch, then one by one as a last resort.
 */
export async function ensureUsers(userById, ids) {
  const missing = [...new Set((ids || []).filter(Boolean))].filter(id => !userById.get(id)?.email);
  if (!missing.length) return userById;
  try {
    for (const u of (await UserStore.getUsersByIds(missing)) || []) userById.set(u.userId || u.id, u);
  } catch { /* fall through to single lookups */ }
  for (const id of missing.filter(id => !userById.get(id)?.email)) {
    try { const u = await UserStore.getUserById(id); if (u) userById.set(id, u); } catch { /* snapshot data still applies */ }
  }
  return userById;
}

async function companyFor(id) {
  if (!id || id === 'default') return null;
  return Companies.getById(id).catch(() => null);
}

const remindersFor = (assessmentId, userId) => Reminders.getByAssignment(assessmentId, userId).catch(() => []);

/** One row per assigned employee of ONE assessment (completed or not). */
export async function loadAssessmentRows({ assessment, assignments, reports, companyId, now = new Date() }) {
  const { userById, groups } = await lookups(companyId);
  const company = await companyFor(assessment.companyId || companyId);
  const eaaRows = assessment.questionBankVersionId
    ? await EmployeeAssessmentAssignments.getByAssessment(assessment.id).catch(() => [])
    : [];
  const eaaByUser = new Map((eaaRows || []).map(r => [r.user_id, r]));
  await ensureUsers(userById, assignments.map(ea => ea.userId));
  const reportsByUser = new Map();
  for (const r of reports) {
    if (r.assessmentId !== assessment.id) continue;
    if (!reportsByUser.has(r.userId)) reportsByUser.set(r.userId, []);
    reportsByUser.get(r.userId).push(r);
  }

  const rows = await mapLimit(assignments, 10, async (ea) => {
    const user = userById.get(ea.userId) || null;
    const group = groups.find(g => (g.employeeIds || []).includes(ea.userId)) || null;
    const managerId = user?.managerId || group?.managerId;
    const manager = managerId ? (userById.get(managerId) || null) : null;
    const reminders = await remindersFor(assessment.id, ea.userId);
    return buildResultRow({
      assessment, ea, report: pickReport(reportsByUser.get(ea.userId), ea), eaaRow: eaaByUser.get(ea.userId) || null,
      user, manager, group, company, reminders, now,
    });
  });
  const summary = buildSummary(rows, assessment, company, now);
  return { rows, summary, company };
}

/** One row per SUBMISSION (report) across assessments. */
export async function loadSubmissionRows({ reports, companyId, now = new Date() }) {
  const { userById, groups } = await lookups(companyId);
  const assessmentCache = new Map();
  const getAssessment = async (id) => {
    if (!assessmentCache.has(id)) assessmentCache.set(id, await Assessments.getById(id).catch(() => null));
    return assessmentCache.get(id);
  };
  const companyCache = new Map();
  const getCompany = async (id) => {
    if (!companyCache.has(id)) companyCache.set(id, await companyFor(id));
    return companyCache.get(id);
  };

  // attempt numbers for old reports: order of submission per employee+assessment
  const sortedAll = reports.slice().sort((a, b) => new Date(a.submittedAt || 0) - new Date(b.submittedAt || 0));
  const attemptOf = new Map();
  const seen = new Map();
  for (const r of sortedAll) {
    const k = `${r.assessmentId}|${r.userId}`;
    const n = (seen.get(k) || 0) + 1;
    seen.set(k, n);
    attemptOf.set(r, n);
  }

  await ensureUsers(userById, sortedAll.map(r => r.userId));
  const rows = await mapLimit(sortedAll, 10, async (report) => {
    const assessment = (await getAssessment(report.assessmentId)) || { id: report.assessmentId, title: report.assessmentTitle };
    const rosterEa = (assessment.employeeAssignments || []).find(e => e.userId === report.userId) || {};
    const ea = {
      ...rosterEa,
      userId: report.userId,
      userName: rosterEa.userName || report.userName,
      jobRole: rosterEa.jobRole || report.jobRole,
      status: 'submitted',
      submittedAt: report.submittedAt,
      scoring: report,
      attemptNumber: report.attemptNumber ?? attemptOf.get(report) ?? 1,
      attemptStartedAt: report.attemptStartedAt ?? (rosterEa.status === 'submitted' && rosterEa.submittedAt === report.submittedAt ? rosterEa.attemptStartedAt : null),
    };
    const user = userById.get(report.userId) || null;
    const group = groups.find(g => (g.employeeIds || []).includes(report.userId)) || null;
    const managerId = user?.managerId || group?.managerId;
    const manager = managerId ? (userById.get(managerId) || null) : null;
    const company = await getCompany(assessment.companyId || report.companyId);
    const reminders = await remindersFor(report.assessmentId, report.userId);
    return buildResultRow({ assessment, ea, report, user, manager, group, company, reminders, now });
  });
  return { rows, summary: buildSummary(rows, {}, null, now) };
}

/**
 * Rows for employees who were assigned but have NOT submitted (not started, in
 * progress, overdue). `allowedIds` is the caller's visible-employee set (null =
 * everyone in the company); cancelled assignments are left out.
 */
export async function loadPendingRows({ assessments, allowedIds = null, companyId, now = new Date() }) {
  const { userById, groups } = await lookups(companyId);
  const pending = [];
  for (const assessment of assessments || []) {
    for (const ea of assessment.employeeAssignments || []) {
      if (!ea?.userId || ea.status === 'submitted' || ea.status === 'cancelled') continue;
      if (allowedIds && !allowedIds.has(ea.userId)) continue;
      pending.push({ assessment, ea });
    }
  }
  await ensureUsers(userById, pending.map(p => p.ea.userId));
  const companyCache = new Map();
  const eaaCache = new Map();
  const rows = await mapLimit(pending, 10, async ({ assessment, ea }) => {
    const cid = assessment.companyId || companyId;
    if (!companyCache.has(cid)) companyCache.set(cid, await companyFor(cid));
    if (assessment.questionBankVersionId && !eaaCache.has(assessment.id)) {
      eaaCache.set(assessment.id, new Map(((await EmployeeAssessmentAssignments.getByAssessment(assessment.id).catch(() => [])) || []).map(r => [r.user_id, r])));
    }
    const user = userById.get(ea.userId) || null;
    const group = groups.find(g => (g.employeeIds || []).includes(ea.userId)) || null;
    const managerId = user?.managerId || group?.managerId;
    const manager = managerId ? (userById.get(managerId) || null) : null;
    const reminders = await remindersFor(assessment.id, ea.userId);
    return buildResultRow({
      assessment, ea: { ...ea, status: ea.status === 'submitted' ? 'assigned' : ea.status }, report: null,
      eaaRow: eaaCache.get(assessment.id)?.get(ea.userId) || null,
      user, manager, group, company: companyCache.get(cid), reminders, now,
    });
  });
  return rows.filter(r => r.status !== STATUS.COMPLETED && r.status !== STATUS.CANCELLED);
}
