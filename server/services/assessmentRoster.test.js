// Roster delete / edit-dates / tombstone tests. File mode, temp DATA_DIR, no network.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const base = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'node_modules', '.cache');
fs.mkdirSync(base, { recursive: true });
const tmp = fs.mkdtempSync(path.join(base, 'sf-roster-test-'));
process.env.DATA_DIR = tmp;
for (const k of ['SUPABASE_URL', 'SUPABASESERVICE_ROLE_KEY', 'SUPABASE_SECRET_KEY', 'SUPABASE_KEY', 'DB_BACKEND']) delete process.env[k];

let DS, roster, autoAssign, schedule;
const A = 'as-1';
const future = (days) => new Date(Date.now() + days * 86400e3).toISOString();

beforeAll(async () => {
  DS = await import('./DataStore.js');
  roster = await import('./assessmentRoster.js');
  autoAssign = await import('./AssessmentAutoAssign.js');
  schedule = await import('./assessmentSchedule.js');
  fs.writeFileSync(path.join(tmp, 'role_library.json'), JSON.stringify([{ id: 'r1', roleName: 'QA Tester', companyId: 'default' }]));
  fs.writeFileSync(path.join(tmp, 'question_bank_versions.json'), JSON.stringify([{
    id: 'qbv1', role_id: 'r1', version: 1, status: 'approved',
    questions: Array.from({ length: 5 }, (_, i) => ({ id: `q${i}`, type: 'mcq', question: 'q', answer: 'A' })),
  }]));
});
afterAll(() => { fs.rmSync(tmp, { recursive: true, force: true }); });

async function seed() {
  await DS.Assessments.create({
    id: A, title: 'T', companyId: 'default', isActive: true, fromRoleId: 'r1', questionBankVersionId: 'qbv1',
    targetUsers: ['u1', 'u2'],
    employeeAssignments: [
      { userId: 'u1', userName: 'One', status: 'submitted', attempts: [{ attemptNumber: 1 }], scoring: { score: 80 } },
      { userId: 'u2', userName: 'Two', status: 'assigned' },
    ],
  });
  await DS.EmployeeAssessmentAssignments.bulkCreate([
    { assessmentId: A, userId: 'u1', questionBankVersionId: 'qbv1', questionOrder: ['q0'] },
    { assessmentId: A, userId: 'u2', questionBankVersionId: 'qbv1', questionOrder: ['q0'] },
  ]);
  await DS.Reports.create({ id: 'rep1', assessmentId: A, userId: 'u1' });
  await DS.Reports.create({ id: 'rep2', assessmentId: A, userId: 'u2' });
  await DS.Submissions.create({ id: 'sub1', assessmentId: A, userId: 'u1' });
  await DS.Reminders.create({ assessmentId: A, employeeId: 'u1', senderId: 'x', type: 'manual', deliveryStatus: 'sent' });
  await DS.Reminders.create({ assessmentId: A, employeeId: 'u2', senderId: 'x', type: 'manual', deliveryStatus: 'sent' });
}

describe('pure helpers', () => {
  it('tombstone add / lookup / clear', () => {
    let list = roster.addTombstone([], { userId: 'u1', removedAt: 'now', removedBy: 'admin' });
    list = roster.addTombstone(list, { userId: 'u1', removedAt: 'later', removedBy: 'admin' });
    expect(list).toHaveLength(1);
    expect(roster.isRemovedFromAssessment({ removedAssignments: list }, 'u1')).toBe(true);
    expect(roster.isRemovedFromAssessment({ removedAssignments: list }, 'u2')).toBe(false);
    expect(roster.isRemovedFromAssessment({}, 'u1')).toBe(false);
    expect(roster.clearTombstones(list, ['u1'])).toEqual([]);
    expect([...roster.collectRemovedUserIds([{ removedAssignments: list }, { removedAssignments: [{ userId: 'z' }] }])].sort()).toEqual(['u1', 'z']);
  });

  it('edit-dates validation: same rules as reassign, completed attempts refused', () => {
    expect(roster.buildEditWindow(null, {}).status).toBe(404);
    expect(roster.buildEditWindow({ status: 'submitted' }, { endDate: future(2) }).status).toBe(400);
    expect(roster.buildEditWindow({ status: 'assigned' }, {}).error).toMatch(/End date is required/);
    expect(roster.buildEditWindow({ status: 'assigned' }, { endDate: new Date(Date.now() - 1000).toISOString() }).error).toMatch(/future/);
    expect(roster.buildEditWindow({ status: 'assigned' }, { startDate: future(3), endDate: future(2) }).error).toMatch(/after the start/);
    expect(roster.buildEditWindow({ status: 'assigned' }, { endDate: 'nope' }).error).toMatch(/not a valid/);
    const ok = roster.buildEditWindow({ status: 'in_progress' }, { startDate: future(1), endDate: future(5), notes: '  hi ' });
    expect(ok.error).toBeUndefined();
    expect(ok.notes).toBe('hi');
    expect(schedule.parseWindowInput({ endDate: future(1) }).dueAt).toBeTruthy();
  });
});

describe('deleteEmployeeAssignment', () => {
  it('removes the roster entry, eaa row, report, submission, reminders and tombstones', async () => {
    await seed();
    const out = await roster.deleteEmployeeAssignment({ assessmentId: A, userId: 'u1', actor: { userId: 'admin1', role: 'admin' } });
    expect(out.removed).toBe(true);
    expect(out.hadResults).toBe(true);
    const a = await DS.Assessments.getById(A);
    expect(a.employeeAssignments.map(e => e.userId)).toEqual(['u2']);
    expect(a.targetUsers).toEqual(['u2']);
    expect(a.removedAssignments.map(r => r.userId)).toEqual(['u1']);
    expect(a.removedAssignments[0].removedBy).toBe('admin1');
    expect((await DS.EmployeeAssessmentAssignments.getByAssessment(A)).map(r => r.user_id)).toEqual(['u2']);
    expect((await DS.Reports.getAll()).map(r => r.id)).toEqual(['rep2']);
    expect(await DS.Submissions.getAll()).toEqual([]);
    expect(await DS.Reminders.getByAssignment(A, 'u1')).toEqual([]);
    expect(await DS.Reminders.getByAssignment(A, 'u2')).toHaveLength(1);
  });

  it('is retry-safe and 404s for strangers', async () => {
    const again = await roster.deleteEmployeeAssignment({ assessmentId: A, userId: 'u1', actor: { userId: 'admin1' } });
    expect(again.removed).toBe(true);
    expect((await roster.deleteEmployeeAssignment({ assessmentId: A, userId: 'ghost', actor: {} })).notFound).toBe(true);
    expect((await roster.deleteEmployeeAssignment({ assessmentId: 'nope', userId: 'u1', actor: {} })).notFound).toBe(true);
  });

  it('auto-assign skips a tombstoned employee (versioned branch) and never re-creates eaa', async () => {
    const before = await DS.EmployeeAssessmentAssignments.getByAssessment(A);
    await autoAssign.autoAssignPreAssessment({ userId: 'u1', id: 'u1', name: 'One', email: 'u1@x', jobRole: 'QA Tester', companyId: 'default' });
    const a = await DS.Assessments.getById(A);
    expect(a.employeeAssignments.map(e => e.userId)).toEqual(['u2']);
    expect(await DS.EmployeeAssessmentAssignments.getByAssessment(A)).toHaveLength(before.length);
    expect(await DS.Assessments.getAll()).toHaveLength(1);
  });

  it('auto-assign still adds a different new joiner', async () => {
    await autoAssign.autoAssignPreAssessment({ userId: 'u9', id: 'u9', name: 'New', email: 'u9@x', jobRole: 'QA Tester', companyId: 'default' });
    const a = await DS.Assessments.getById(A);
    expect(a.employeeAssignments.map(e => e.userId).sort()).toEqual(['u2', 'u9']);
  });
});

describe('editEmployeeWindow', () => {
  it('changes dates on roster and eaa row without touching status', async () => {
    const end = future(10);
    const out = await roster.editEmployeeWindow({ assessmentId: A, userId: 'u2', body: { startDate: future(-1), endDate: end }, actor: { userId: 'admin1' } });
    expect(out.error).toBeUndefined();
    const a = await DS.Assessments.getById(A);
    const e = a.employeeAssignments.find(x => x.userId === 'u2');
    expect(e.dueAt).toBe(end);
    expect(e.status).toBe('assigned');
    expect((await DS.EmployeeAssessmentAssignments.getOne(A, 'u2')).due_at).toBe(end);
  });

  it('rejects a tombstoned/unknown employee', async () => {
    const out = await roster.editEmployeeWindow({ assessmentId: A, userId: 'u1', body: { endDate: future(3) }, actor: {} });
    expect(out.status).toBe(404);
  });
});

describe('deleteAssessmentCascade', () => {
  it('removes the assessment and all dependent rows', async () => {
    const a = await DS.Assessments.getById(A);
    const counts = await roster.deleteAssessmentCascade({ assessment: a, actor: { userId: 'admin1' } });
    expect(counts.employees).toBe(2);
    expect(await DS.Assessments.getById(A)).toBeNull();
    expect(await DS.EmployeeAssessmentAssignments.getByAssessment(A)).toEqual([]);
    expect(await DS.Reports.getAll()).toEqual([]);
    expect(await DS.Reminders.getByAssignment(A, 'u2')).toEqual([]);
  });
});
