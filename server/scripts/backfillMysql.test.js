// Unit tests for the one-time MySQL backfill script
// (server/scripts/backfillMysql.mjs).
//
// No real MySQL server exists to test against — '../db/mysql.js' is mocked
// entirely (same pattern server/db/mysqlMirror.test.js already uses). All
// reads go through a temporary DATA_DIR seeded with synthetic file-mode
// data (server/data/*.json is never touched) — never through Supabase,
// since SUPABASE_URL/SUPABASE_KEY are left unset in this test environment.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const base = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'node_modules', '.cache');
fs.mkdirSync(base, { recursive: true });

let tmpDataDir;

function writeJson(name, data) {
  fs.writeFileSync(path.join(tmpDataDir, name), JSON.stringify(data, null, 2));
}

// Seeds a small but representative slice of every tier the script handles:
// doc-style collections (companies), row-style collections needing reshaping
// (groups), per-key-enumerated collections (platform_settings,
// assessment_thresholds, employee_checklists), UserStore (users — including
// a manager_id edge that exercises the two-pass write — assignments, audit
// logs), and db/store.js's family (modules, packages, group_memberships,
// notifications), plus question_bank_versions/employee_assessment_
// assignments/reminders for the foreign-key ordering story.
function seedData() {
  writeJson('users.json', {
    users: [
      { userId: 'u1', email: 'manager@x.com', passwordHash: 'h', name: 'Manager', role: 'manager', companyId: 'c1' },
      { userId: 'u2', email: 'emp@x.com', passwordHash: 'h', name: 'Employee', role: 'employee', companyId: 'c1', managerId: 'u1' },
    ],
    nextUserId: 3,
  });
  writeJson('assignments.json', {
    assignments: [
      { id: 'a1', type: 'module', assignable_id: 'mod1', assignable_type: 'module', assigned_to_user: 'u2', assigned_by: 'u1', status: 'assigned', progress: 0, title: 'Mod One' },
    ],
    nextAssignmentId: 2,
  });
  writeJson('assignment_requests.json', { requests: [], nextId: 1 });
  writeJson('audit.json', {
    logs: [{ logId: 'log_1', eventType: 'login', userId: 'u1', timestamp: new Date().toISOString(), metadata: {} }],
    nextLogId: 2,
  });
  writeJson('groups.json', [{ id: 'g1', name: 'Group One', managerId: 'u1', memberIds: ['u2'] }]);
  writeJson('companies.json', [{ id: 'c1', name: 'Acme', companyCode: 'ACME' }]);
  writeJson('organizations.json', { organizations: [] });
  writeJson('departments.json', { departments: [] });
  writeJson('teams.json', { teams: [] });
  writeJson('question_bank_versions.json', [
    { id: 'qbv1', role_id: 'role1', version: 1, status: 'approved', questions: [{ q: 1 }], question_count: 1 },
  ]);
  writeJson('employee_assessment_assignments.json', [
    { id: 'eaa1', assessment_id: 'as1', user_id: 'u2', question_bank_version_id: 'qbv1', question_order: [1], status: 'assigned', assigned_at: new Date().toISOString() },
  ]);
  writeJson('reminders.json', [
    { id: 'rem1', assessment_id: 'as1', employee_id: 'u2', sender_id: 'u1', type: 'manual', sent_at: new Date().toISOString(), delivery_status: 'sent', error_message: null },
  ]);
  writeJson('platform_settings.json', [{ companyId: 'c1', settings: { general: { theme: 'dark' } }, updatedAt: new Date().toISOString() }]);
  writeJson('assessment_thresholds.json', [{ id: 'c1', thresholds: { expert: 90 }, updatedAt: new Date().toISOString() }]);
  writeJson('employee_checklists.json', [{ id: 'u2', roleId: 'role1', roleName: 'Role One', items: [{ id: 'i1', title: 'Step 1', completed: false }] }]);
  writeJson('modules.json', { modules: [{ id: 'mod1', title: 'Mod One', description: 'd', category: 'General', difficulty: 'beginner', estimatedDuration: '30 days', skills: ['x'], tasks: [], resources: [], completionCriteria: 'done', createdBy: 'u1', companyId: 'c1' }] });
  writeJson('packages.json', { packages: [{ id: 'pkg1', category: 'cat', createdBy: 'u1', createdAt: new Date().toISOString(), extraField: 'hello' }], nextId: 2 });
  writeJson('skill_packages.json', { skill_packages: [] });
  writeJson('learning_tracks.json', { learning_tracks: [] });
  writeJson('group_memberships.json', { memberships: [{ id: 'gm1', group_id: 'g1', user_id: 'u2', role_in_group: 'member', joined_at: new Date().toISOString() }] });
  writeJson('notifications.json', { notifications: [{ id: 'notif1', user_id: 'u2', read: false, created_at: new Date().toISOString(), title: 'Hello' }] });
  // Everything else the script touches (assessments, assessment_submissions,
  // assessment_reports, pending_modules, module_assignments, approval_requests,
  // user_jd_profiles, activation_tokens, role_library, generated_content,
  // access_codes, generated_modules, question_bank_archives) is left unseeded
  // — DataStore.js's readFileRecords()/getAllHealed() return [] for a missing
  // file, which is itself a useful assertion: the script must not choke on
  // collections that are empty in a given deployment.
}

beforeEach(() => {
  tmpDataDir = fs.mkdtempSync(path.join(base, 'sf-backfill-test-'));
  process.env.DATA_DIR = tmpDataDir;
  delete process.env.SUPABASE_URL;
  delete process.env.SUPABASESERVICE_ROLE_KEY;
  delete process.env.SUPABASE_SECRET_KEY;
  delete process.env.SUPABASE_KEY;
  delete process.env.DB_BACKEND;
  seedData();
  vi.resetModules();
});

afterEach(() => {
  vi.restoreAllMocks();
  fs.rmSync(tmpDataDir, { recursive: true, force: true });
  delete process.env.DATA_DIR;
  const argvIdx = process.argv.indexOf('--dry-run');
  if (argvIdx !== -1) process.argv.splice(argvIdx, 1);
});

function mockConfiguredPool({ upsertRow } = {}) {
  vi.doMock('../db/mysql.js', () => ({
    getPool: () => ({ fake: true }),
    upsertRow: upsertRow || vi.fn().mockResolvedValue({}),
    deleteRow: vi.fn(),
  }));
}

describe('backfillMysql.mjs — refuses to run when MySQL is unconfigured', () => {
  it('throws instead of silently no-opping', async () => {
    vi.doMock('../db/mysql.js', () => ({
      getPool: () => null,
      upsertRow: vi.fn(),
      deleteRow: vi.fn(),
    }));
    const { main } = await import('./backfillMysql.mjs');
    await expect(main()).rejects.toThrow(/MySQL is not configured/);
  });
});

describe('backfillMysql.mjs --dry-run', () => {
  it('reports counts and writes nothing', async () => {
    process.argv.push('--dry-run');
    const upsertRow = vi.fn().mockResolvedValue({});
    mockConfiguredPool({ upsertRow });
    const { main } = await import('./backfillMysql.mjs');
    const summary = await main();

    expect(upsertRow).not.toHaveBeenCalled();
    expect(summary.failures).toEqual([]);
    expect(summary.totalWritten).toBe(0);
    expect(summary.totalRead).toBeGreaterThan(0);
    expect(summary.counts.users.read).toBe(2);
    expect(summary.counts.groups.read).toBe(1);
    expect(summary.counts.modules.read).toBe(1);
  });
});

describe('backfillMysql.mjs real run', () => {
  it('calls upsertRow for every row across a representative sample of collections, respecting foreign-key order', async () => {
    const calls = [];
    const upsertRow = vi.fn().mockImplementation(async (table, row) => {
      calls.push({ table, row });
      return row;
    });
    mockConfiguredPool({ upsertRow });
    const { main } = await import('./backfillMysql.mjs');
    const summary = await main();

    expect(summary.failures).toEqual([]);
    expect(summary.totalWritten).toBe(summary.totalRead);

    // users must be written (manager-less pass) before anything referencing
    // users(user_id) — assignments, group_memberships, notifications — and
    // groups must be written before group_memberships.
    const tableOrder = calls.map(c => c.table);
    const firstUsersIdx = tableOrder.indexOf('users');
    const firstGroupsIdx = tableOrder.indexOf('groups');
    const firstAssignmentsIdx = tableOrder.indexOf('assignments');
    const firstGroupMembershipsIdx = tableOrder.indexOf('group_memberships');
    const firstNotificationsIdx = tableOrder.indexOf('notifications');
    expect(firstUsersIdx).toBeLessThan(firstAssignmentsIdx);
    expect(firstUsersIdx).toBeLessThan(firstGroupMembershipsIdx);
    expect(firstUsersIdx).toBeLessThan(firstNotificationsIdx);
    expect(firstGroupsIdx).toBeLessThan(firstGroupMembershipsIdx);

    // The two users.manager_id passes: pass 1 (no manager_id key at all) for
    // both users, then a pass-2 update carrying manager_id only for u2.
    const userRows = calls.filter(c => c.table === 'users').map(c => c.row);
    expect(userRows.filter(r => r.user_id === 'u1')).toHaveLength(1);
    expect(userRows.filter(r => r.user_id === 'u2')).toHaveLength(2); // pass 1 + pass 2
    expect(userRows[0]).not.toHaveProperty('manager_id');
    const managerPass = userRows.find(r => r.manager_id !== undefined);
    expect(managerPass).toEqual({ user_id: 'u2', manager_id: 'u1' });

    // Representative row-shaping checks.
    const groupRow = calls.find(c => c.table === 'groups').row;
    expect(groupRow).toEqual({ id: 'g1', name: 'Group One', data: { managerId: 'u1', memberIds: ['u2'] } });

    const moduleRow = calls.find(c => c.table === 'modules').row;
    expect(moduleRow.id).toBe('mod1');
    expect(moduleRow.estimated_duration).toBe(30);
    expect(moduleRow.created_by).toBe('u1');

    const packageRow = calls.find(c => c.table === 'packages').row;
    expect(packageRow.id).toBe('pkg1');
    expect(packageRow.category).toBe('cat');
    // splitPackageRow's knownCols is ['id', 'category'] here (same as the
    // live createPackage()), so createdBy/createdAt land in `extra` too —
    // duplicated with the top-level created_by/created_at this script also
    // sets, exactly like the live mirror writes already do.
    expect(packageRow.extra).toMatchObject({ extraField: 'hello', createdBy: 'u1' });

    const notifRow = calls.find(c => c.table === 'notifications').row;
    expect(notifRow).toMatchObject({ id: 'notif1', user_id: 'u2', read: false });
    expect(notifRow.payload).toMatchObject({ title: 'Hello' });

    const eaaRow = calls.find(c => c.table === 'employee_assessment_assignments').row;
    expect(eaaRow.id).toBe('eaa1');

    const reminderRow = calls.find(c => c.table === 'reminders').row;
    expect(reminderRow.id).toBe('rem1');

    const settingsRow = calls.find(c => c.table === 'platform_settings').row;
    expect(settingsRow).toMatchObject({ company_id: 'c1' });

    const thresholdRow = calls.find(c => c.table === 'assessment_thresholds').row;
    expect(thresholdRow.id).toBe('c1');

    const checklistRow = calls.find(c => c.table === 'employee_checklists').row;
    expect(checklistRow.id).toBe('u2');
  });

  it('is idempotent — a second run against the same seed data succeeds with no errors', async () => {
    const upsertRow = vi.fn().mockResolvedValue({});
    mockConfiguredPool({ upsertRow });
    const { main } = await import('./backfillMysql.mjs');

    const first = await main();
    expect(first.failures).toEqual([]);
    const firstCallCount = upsertRow.mock.calls.length;

    const second = await main();
    expect(second.failures).toEqual([]);
    expect(second.totalRead).toBe(first.totalRead);
    // Same rows read and (re-)written again — upsertRow is called the same
    // number of times both runs, proving nothing was skipped or duplicated.
    expect(upsertRow.mock.calls.length).toBe(firstCallCount * 2);
  });

  it('catches a failure on one row, reports it in the summary, and keeps going', async () => {
    const upsertRow = vi.fn().mockImplementation(async (table, row) => {
      if (table === 'modules' && row.id === 'mod1') throw new Error('simulated connection reset');
      return row;
    });
    mockConfiguredPool({ upsertRow });
    const { main } = await import('./backfillMysql.mjs');
    const summary = await main();

    expect(summary.failures).toEqual([{ table: 'modules', id: 'mod1', error: 'simulated connection reset' }]);
    // Every other collection still got written despite the one failure —
    // packages (a different table processed after modules) must still show up.
    expect(upsertRow).toHaveBeenCalledWith('packages', expect.objectContaining({ id: 'pkg1' }));
    expect(summary.totalWritten).toBe(summary.totalRead - 1);
  });
});
