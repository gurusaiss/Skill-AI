/**
 * reportLoader.js — gathers the live records an export needs (users, managers,
 * groups, company, reminders, per-employee schedule rows) and hands them to the
 * pure builders in reportData.js. Everything saved at submit time wins; these
 * lookups only fill in gaps for older records.
 */
import UserStore from '../UserStore.js';
import { Assessments, Companies, Groups, EmployeeAssessmentAssignments, Reminders } from '../DataStore.js';
import { buildResultRow, buildSummary, pickReport } from './reportData.js';

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
