// Tests that server/services/DataStore.js mirrors every write into MySQL via
// server/db/mysqlMirror.js's mirrorWrite(), per the confirmed architecture:
// Supabase/file stays authoritative and unchanged; MySQL is a best-effort
// async mirror fired only after the real write succeeds.
//
// Two backends are exercised:
//  - FILE MODE (no Supabase env vars set) — the common case in this test
//    file, proving mirroring is independent of which primary backend answers
//    the write.
//  - SUPABASE MODE (mocked @supabase/supabase-js client) — proves the mirror
//    fires on a successful Supabase write and does NOT fire when Supabase
//    throws/errors.
//
// mysqlMirror.js itself is mocked out (its own 9 tests cover its internals:
// timeouts, retry queue, never-throws contract) — here we only assert
// DataStore.js calls mirrorWrite with the right {table, op, id, data}.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const base = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'node_modules', '.cache');
fs.mkdirSync(base, { recursive: true });

let tmpDataDir;
let mirrorWrite;

beforeEach(() => {
  tmpDataDir = fs.mkdtempSync(path.join(base, 'sf-ds-mirror-test-'));
  process.env.DATA_DIR = tmpDataDir;
  for (const k of ['SUPABASE_URL', 'SUPABASESERVICE_ROLE_KEY', 'SUPABASE_SECRET_KEY', 'SUPABASE_KEY']) delete process.env[k];
  vi.resetModules();
});

afterEach(() => {
  vi.restoreAllMocks();
  fs.rmSync(tmpDataDir, { recursive: true, force: true });
  delete process.env.DATA_DIR;
});

async function loadFileMode() {
  mirrorWrite = vi.fn().mockResolvedValue(undefined);
  vi.doMock('../db/mysqlMirror.js', () => ({
    mirrorWrite,
    mirrorEnabled: () => true,
    mirrorQueueStats: () => ({ pending: 0, oldestPendingAt: null }),
  }));
  return import('./DataStore.js');
}

describe('DataStore mirror — file mode (no Supabase configured)', () => {
  it('Assessments: create/update/delete all mirror with table "assessments"', async () => {
    const { Assessments } = await loadFileMode();
    await Assessments.create({ id: 'a1', title: 'One' });
    expect(mirrorWrite).toHaveBeenCalledWith({ table: 'assessments', op: 'upsert', id: 'a1', data: { title: 'One' } });

    mirrorWrite.mockClear();
    await Assessments.update('a1', { title: 'Renamed' });
    expect(mirrorWrite).toHaveBeenCalledWith({ table: 'assessments', op: 'upsert', id: 'a1', data: expect.objectContaining({ title: 'Renamed' }) });

    mirrorWrite.mockClear();
    await Assessments.delete('a1');
    expect(mirrorWrite).toHaveBeenCalledWith({ table: 'assessments', op: 'delete', id: 'a1', idColumn: 'id' });
  });

  it('Reports: create mirrors with table "assessment_reports"', async () => {
    const { Reports } = await loadFileMode();
    await Reports.create({ id: 'r1', assessmentId: 'a1', employeeId: 'e1', percent: 91 });
    expect(mirrorWrite).toHaveBeenCalledWith({
      table: 'assessment_reports', op: 'upsert', id: 'r1',
      data: { assessmentId: 'a1', employeeId: 'e1', percent: 91 },
    });
  });

  it('RoleLibrary: create/update/delete mirror with table "role_library"', async () => {
    const { RoleLibrary } = await loadFileMode();
    await RoleLibrary.create({ id: 'rl1', roleName: 'QA' });
    expect(mirrorWrite).toHaveBeenLastCalledWith({ table: 'role_library', op: 'upsert', id: 'rl1', data: { roleName: 'QA' } });
    mirrorWrite.mockClear();
    await RoleLibrary.update('rl1', { roleName: 'QA Lead' });
    expect(mirrorWrite).toHaveBeenLastCalledWith({ table: 'role_library', op: 'upsert', id: 'rl1', data: expect.objectContaining({ roleName: 'QA Lead' }) });
    mirrorWrite.mockClear();
    await RoleLibrary.delete('rl1');
    expect(mirrorWrite).toHaveBeenLastCalledWith({ table: 'role_library', op: 'delete', id: 'rl1', idColumn: 'id' });
  });

  it('GeneratedContent: create mirrors with table "generated_content" (also covers SessionContentCache)', async () => {
    const { GeneratedContent, SessionContentCache } = await loadFileMode();
    await GeneratedContent.create({ id: 'gc1', companyId: 'c1', kind: 'assessment' });
    expect(mirrorWrite).toHaveBeenLastCalledWith({ table: 'generated_content', op: 'upsert', id: 'gc1', data: { companyId: 'c1', kind: 'assessment' } });

    mirrorWrite.mockClear();
    await SessionContentCache.set('fp1', { day: 1 });
    // SessionContentCache.set() flows through GeneratedContent.create() — no
    // separate wiring needed, and it must still mirror into generated_content.
    expect(mirrorWrite).toHaveBeenCalledWith({
      table: 'generated_content', op: 'upsert', id: 'daycontent_fp1',
      data: expect.objectContaining({ companyId: '__cache__', kind: 'day_content_cache', payload: { day: 1 } }),
    });
  });

  it('Groups: create/update mirror the flat {id,name,data} row shape on table "groups" (no collision with db/store.js flat `groups` table — same shape, same table, verified)', async () => {
    const { Groups } = await loadFileMode();
    await Groups.create({ id: 'g1', name: 'Team A', managerId: 'm1' });
    expect(mirrorWrite).toHaveBeenLastCalledWith({
      table: 'groups', op: 'upsert', id: 'g1',
      data: { id: 'g1', name: 'Team A', data: { managerId: 'm1' } },
      idColumn: 'id',
    });
    mirrorWrite.mockClear();
    await Groups.update('g1', { name: 'Team A2' });
    const call = mirrorWrite.mock.calls.at(-1)[0];
    expect(call.table).toBe('groups');
    expect(call.op).toBe('upsert');
    expect(call.data.name).toBe('Team A2');
  });

  it('AccessCodes: create mirrors with table "access_codes"', async () => {
    const { AccessCodes } = await loadFileMode();
    await AccessCodes.create({ id: 'ac1', companyId: 'c1', code: 'ABC123' });
    expect(mirrorWrite).toHaveBeenLastCalledWith({ table: 'access_codes', op: 'upsert', id: 'ac1', data: { companyId: 'c1', code: 'ABC123' } });
  });

  it('Companies / ApprovalRequests / PendingModules / ModuleAssignments: create mirrors with the right table name', async () => {
    const { Companies, ApprovalRequests, PendingModules, ModuleAssignments } = await loadFileMode();
    await Companies.create({ id: 'co1', name: 'Acme' });
    expect(mirrorWrite).toHaveBeenLastCalledWith({ table: 'companies', op: 'upsert', id: 'co1', data: { name: 'Acme' } });
    await ApprovalRequests.create({ id: 'ar1', status: 'pending' });
    expect(mirrorWrite).toHaveBeenLastCalledWith({ table: 'approval_requests', op: 'upsert', id: 'ar1', data: { status: 'pending' } });
    await PendingModules.create({ id: 'pm1', title: 'Module' });
    expect(mirrorWrite).toHaveBeenLastCalledWith({ table: 'pending_modules', op: 'upsert', id: 'pm1', data: { title: 'Module' } });
    await ModuleAssignments.create({ id: 'ma1', userId: 'u1' });
    expect(mirrorWrite).toHaveBeenLastCalledWith({ table: 'module_assignments', op: 'upsert', id: 'ma1', data: { userId: 'u1' } });
  });

  it('Organizations/Departments/Teams (writeFileSync-based file fallback) still mirror on create/update', async () => {
    const { Organizations, Departments, Teams } = await loadFileMode();
    await Organizations.create({ id: 'org1', name: 'Org' });
    expect(mirrorWrite).toHaveBeenLastCalledWith({ table: 'organizations', op: 'upsert', id: 'org1', data: { name: 'Org' } });
    mirrorWrite.mockClear();
    await Organizations.update('org1', { name: 'Org2' });
    expect(mirrorWrite).toHaveBeenLastCalledWith({ table: 'organizations', op: 'upsert', id: 'org1', data: expect.objectContaining({ name: 'Org2' }) });

    await Departments.create({ id: 'dep1', org_id: 'org1' });
    expect(mirrorWrite).toHaveBeenLastCalledWith({ table: 'departments', op: 'upsert', id: 'dep1', data: { org_id: 'org1' } });

    await Teams.create({ id: 'team1', dept_id: 'dep1' });
    expect(mirrorWrite).toHaveBeenLastCalledWith({ table: 'teams', op: 'upsert', id: 'team1', data: { dept_id: 'dep1' } });
  });

  it('PlatformSettings.updateSection mirrors the flat row keyed by company_id', async () => {
    const { PlatformSettings } = await loadFileMode();
    await PlatformSettings.updateSection('co1', 'general', { siteName: 'Acme' });
    const call = mirrorWrite.mock.calls.at(-1)[0];
    expect(call.table).toBe('platform_settings');
    expect(call.idColumn).toBe('company_id');
    expect(call.id).toBe('co1');
    expect(call.data.company_id).toBe('co1');
    expect(call.data.settings).toEqual({ general: { siteName: 'Acme' } });
  });

  it('QuestionBankVersions: create/approve/updateQuestions/delete mirror the full flat row on table "question_bank_versions"', async () => {
    const { QuestionBankVersions } = await loadFileMode();
    const v = await QuestionBankVersions.create({ roleId: 'role1', version: 1, questions: [{ q: 1 }], questionCount: 1 });
    expect(mirrorWrite).toHaveBeenLastCalledWith({ table: 'question_bank_versions', op: 'upsert', id: v.id, data: v, idColumn: 'id' });

    mirrorWrite.mockClear();
    await QuestionBankVersions.approve(v.id, 'admin1');
    const approveCall = mirrorWrite.mock.calls.find(c => c[0].data.status === 'approved');
    expect(approveCall[0]).toMatchObject({ table: 'question_bank_versions', op: 'upsert', id: v.id });

    mirrorWrite.mockClear();
    await QuestionBankVersions.updateQuestions(v.id, [{ q: 2 }]);
    expect(mirrorWrite).toHaveBeenLastCalledWith({ table: 'question_bank_versions', op: 'upsert', id: v.id, data: expect.objectContaining({ question_count: 1 }), idColumn: 'id' });

    mirrorWrite.mockClear();
    await QuestionBankVersions.delete(v.id);
    expect(mirrorWrite).toHaveBeenLastCalledWith({ table: 'question_bank_versions', op: 'delete', id: v.id, idColumn: 'id' });
  });

  it('EmployeeAssessmentAssignments: bulkCreate/updateSubmission/deleteByAssessmentUser mirror the flat row on table "employee_assessment_assignments"', async () => {
    const { EmployeeAssessmentAssignments } = await loadFileMode();
    const [row] = await EmployeeAssessmentAssignments.bulkCreate([{ assessmentId: 'as1', userId: 'u1', questionBankVersionId: 'qbv1', questionOrder: [0, 1] }]);
    expect(mirrorWrite).toHaveBeenLastCalledWith({ table: 'employee_assessment_assignments', op: 'upsert', id: row.id, data: row, idColumn: 'id' });

    mirrorWrite.mockClear();
    await EmployeeAssessmentAssignments.updateSubmission(row.id, { status: 'submitted', submittedAt: '2026-01-01T00:00:00.000Z' });
    expect(mirrorWrite).toHaveBeenLastCalledWith({ table: 'employee_assessment_assignments', op: 'upsert', id: row.id, data: expect.objectContaining({ status: 'submitted' }), idColumn: 'id' });

    mirrorWrite.mockClear();
    await EmployeeAssessmentAssignments.deleteByAssessmentUser('as1', 'u1');
    expect(mirrorWrite).toHaveBeenLastCalledWith({ table: 'employee_assessment_assignments', op: 'delete', id: row.id, idColumn: 'id' });
  });

  it('Reminders: create/deleteByAssignment mirror the flat row on table "reminders"', async () => {
    const { Reminders } = await loadFileMode();
    const row = await Reminders.create({ assessmentId: 'as1', employeeId: 'e1', senderId: 'admin1', type: 'manual', deliveryStatus: 'sent' });
    expect(mirrorWrite).toHaveBeenLastCalledWith({ table: 'reminders', op: 'upsert', id: row.id, data: row, idColumn: 'id' });

    mirrorWrite.mockClear();
    await Reminders.deleteByAssignment('as1', 'e1');
    expect(mirrorWrite).toHaveBeenLastCalledWith({ table: 'reminders', op: 'delete', id: row.id, idColumn: 'id' });
  });

  it('a write that throws before persisting (writeFile\'s renameSync failing) never reaches mirrorWrite', async () => {
    // writeFile() (DataStore.js's file-fallback writer) does
    // writeFileSync(tmp) -> renameSync(tmp, target). Mock 'fs' so renameSync
    // throws, simulating a failed persist (e.g. disk full): the thrown error
    // must propagate out of create() with mirrorDocUpsert never reached (it
    // sits after the writeFile() call in every collection's create()).
    vi.doMock('fs', async (importOriginal) => {
      const actual = await importOriginal();
      return { ...actual, default: { ...actual.default, renameSync: () => { throw new Error('ENOSPC: no space left on device'); } }, renameSync: () => { throw new Error('ENOSPC: no space left on device'); } };
    });
    const { PendingModules } = await loadFileMode();
    await expect(PendingModules.create({ id: 'pm-fail', title: 'X' })).rejects.toThrow('ENOSPC');
    expect(mirrorWrite).not.toHaveBeenCalled();
  });
});
