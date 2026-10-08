/**
 * assessmentRoster.js - roster edits for ONE assessment: delete an employee's
 * assignment everywhere, edit their dates, and the "tombstone" that stops
 * auto-assignment from silently giving a deleted assignment back.
 *
 * Tombstone: `assessment.removedAssignments = [{ userId, removedAt, removedBy }]`.
 * Anything that adds employees on its own (autoAssignPreAssessment, the /my
 * self-heal, bulk lock/approve) must skip users for whom
 * isRemovedFromAssessment(assessment, userId) is true. Only an admin
 * explicitly assigning the employee again (POST /:id/assign) clears it.
 */
import {
  Assessments, Submissions, Reports, EmployeeAssessmentAssignments, Reminders,
} from './DataStore.js';
import UserStore from './UserStore.js';
import { parseWindowInput } from './assessmentSchedule.js';

// ---- pure helpers -----------------------------------------------------------

export function removedUserIds(assessment) {
  const list = Array.isArray(assessment?.removedAssignments) ? assessment.removedAssignments : [];
  return new Set(list.map(r => r?.userId).filter(Boolean));
}

export function isRemovedFromAssessment(assessment, userId) {
  if (!assessment || !userId) return false;
  return removedUserIds(assessment).has(userId);
}

/** Users removed from any of these assessments (e.g. every prior assessment of a role). */
export function collectRemovedUserIds(assessments) {
  const out = new Set();
  for (const a of assessments || []) for (const id of removedUserIds(a)) out.add(id);
  return out;
}

export function addTombstone(list, { userId, removedBy, removedAt }) {
  const rest = (Array.isArray(list) ? list : []).filter(r => r?.userId !== userId);
  return [...rest, { userId, removedAt, removedBy: removedBy || null }];
}

export function clearTombstones(list, userIds) {
  const drop = new Set(userIds);
  return (Array.isArray(list) ? list : []).filter(r => !drop.has(r?.userId));
}

/** The roster + targetUsers with one employee taken out. */
export function withoutEmployee(assessment, userId) {
  return {
    employeeAssignments: (assessment.employeeAssignments || []).filter(ea => ea.userId !== userId),
    targetUsers: (assessment.targetUsers || []).filter(id => id !== userId),
  };
}

/**
 * Validates an "edit dates" request for one roster entry. Same date rules as
 * reassign (parseWindowInput) but a finished attempt cannot be rescheduled.
 * Returns { error, status } or { startAt, dueAt, notes }.
 */
export function buildEditWindow(entry, body = {}) {
  if (!entry) return { error: 'Employee is not assigned to this assessment', status: 404 };
  if (entry.status === 'submitted') {
    return { error: 'This employee already completed the assessment. Use Reassign (retake) to give it again.', status: 400 };
  }
  const win = parseWindowInput({ startDate: body.startDate, endDate: body.endDate });
  if (win.error) return { error: win.error, status: 400 };
  let notes;
  if (body.notes !== undefined) {
    if (body.notes !== null && typeof body.notes !== 'string') return { error: 'Notes must be text', status: 400 };
    notes = body.notes === null ? '' : body.notes.trim().slice(0, 500);
  }
  return { startAt: win.startAt, dueAt: win.dueAt, notes };
}

// ---- stateful operations (DataStore; file mode in tests) --------------------

async function audit(eventType, actor, metadata) {
  try { await UserStore.logAuthEvent(eventType, actor?.userId || null, metadata); } catch (e) {
    console.warn(`[assessmentRoster] audit ${eventType} failed:`, e.message);
  }
}

/** Removes every stored trace of one employee's assignment except the audit event. */
async function purgeEmployeeData(assessmentId, userId) {
  const reportIds = await Reports.deleteByAssessmentUser(assessmentId, userId);
  const submissions = await Submissions.deleteByAssessmentUser(assessmentId, userId);
  await EmployeeAssessmentAssignments.deleteByAssessmentUser(assessmentId, userId);
  await Reminders.deleteByAssignment(assessmentId, userId);
  return { reports: reportIds.length, submissions };
}

/**
 * HARD delete of one employee's assignment. Order matters: the roster is
 * changed first (employee loses access at once), the rest is cleanup that is
 * safe to repeat. Calling again for an already-tombstoned user just re-runs the
 * cleanup, so a half-finished delete can be retried.
 * Returns { notFound } or { removed, hadResults, counts }.
 */
export async function deleteEmployeeAssignment({ assessmentId, userId, actor }) {
  const fresh = await Assessments.getById(assessmentId);
  if (!fresh) return { notFound: true };
  const entry = (fresh.employeeAssignments || []).find(ea => ea.userId === userId);
  const alreadyTombstoned = isRemovedFromAssessment(fresh, userId);
  if (!entry && !alreadyTombstoned && !(fresh.targetUsers || []).includes(userId)) return { notFound: true };

  const submittedBefore = entry?.status === 'submitted' || Boolean(entry?.scoring);
  const attemptsBefore = Array.isArray(entry?.attempts) ? entry.attempts.length : 0;

  if (!alreadyTombstoned || entry) {
    const removedAt = new Date().toISOString();
    await Assessments.update(assessmentId, {
      ...withoutEmployee(fresh, userId),
      removedAssignments: addTombstone(fresh.removedAssignments, { userId, removedAt, removedBy: actor?.userId }),
      updatedAt: removedAt,
    });
  }
  const counts = await purgeEmployeeData(assessmentId, userId);
  const hadResults = submittedBefore || counts.reports > 0 || counts.submissions > 0;

  await audit('assessment_assignment_deleted', actor, {
    assessmentId, assessmentTitle: fresh.title, userId,
    userName: entry?.userName || null, deletedBy: actor?.userId || null, deletedByRole: actor?.role || null,
    hadResults, previousStatus: entry?.status || null, previousAttempts: attemptsBefore, ...counts,
  });
  return { removed: true, hadResults, counts };
}

/**
 * Edits one employee's window (and notes) WITHOUT touching their attempt,
 * answers or status. Persists on the roster entry and the eaa row.
 */
export async function editEmployeeWindow({ assessmentId, userId, body, actor }) {
  const fresh = await Assessments.getById(assessmentId);
  if (!fresh) return { notFound: true };
  const idx = (fresh.employeeAssignments || []).findIndex(ea => ea.userId === userId);
  const built = buildEditWindow(idx >= 0 ? fresh.employeeAssignments[idx] : null, body);
  if (built.error) return built;

  const roster = [...fresh.employeeAssignments];
  const now = new Date().toISOString();
  roster[idx] = {
    ...roster[idx], startAt: built.startAt, dueAt: built.dueAt,
    ...(built.notes !== undefined ? { notes: built.notes } : {}),
    windowEditedAt: now, windowEditedBy: actor?.userId || null,
  };
  await Assessments.update(assessmentId, { employeeAssignments: roster, updatedAt: now });
  if (fresh.questionBankVersionId) {
    await EmployeeAssessmentAssignments.updateWindow(assessmentId, userId, { startAt: built.startAt, dueAt: built.dueAt });
  }
  await audit('assessment_assignment_dates_edited', actor, {
    assessmentId, userId, startAt: built.startAt, dueAt: built.dueAt,
  });
  return { entry: roster[idx], startAt: built.startAt, dueAt: built.dueAt };
}

/** Deletes the assessment and everything hanging off it. */
export async function deleteAssessmentCascade({ assessment, actor }) {
  const id = assessment.id;
  const reportIds = await Reports.deleteByAssessmentUser(id, null);
  const submissions = await Submissions.deleteByAssessmentUser(id, null);
  await EmployeeAssessmentAssignments.deleteByAssessmentUser(id, null);
  await Reminders.deleteByAssignment(id, null);
  await Assessments.delete(id);
  const roster = assessment.employeeAssignments || [];
  const counts = { reports: reportIds.length, submissions, employees: roster.length };
  await audit('assessment_deleted', actor, {
    assessmentId: id, assessmentTitle: assessment.title, deletedBy: actor?.userId || null,
    completedEmployees: roster.filter(ea => ea.status === 'submitted').length, ...counts,
  });
  return counts;
}
