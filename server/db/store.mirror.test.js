// Unit tests for the additive MySQL mirror calls in server/db/store.js.
// ./mysqlMirror.js is mocked entirely (mirrorWrite is a spy) — no real
// network/DB. For "switch mode" (DB_BACKEND=mysql) cases, ./mysql.js is
// also mocked so the existing useMySQL() branches run without a real pool.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const base = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'node_modules', '.cache');
fs.mkdirSync(base, { recursive: true });

let tmpDataDir;
let mirrorWriteSpy;

beforeEach(() => {
  tmpDataDir = fs.mkdtempSync(path.join(base, 'sf-store-mirror-'));
  process.env.DATA_DIR = tmpDataDir;
  for (const k of ['SUPABASE_URL', 'SUPABASESERVICE_ROLE_KEY', 'SUPABASE_SECRET_KEY', 'SUPABASE_KEY', 'DB_BACKEND']) {
    delete process.env[k];
  }
  vi.resetModules();
  mirrorWriteSpy = vi.fn().mockResolvedValue(undefined);
  vi.doMock('./mysqlMirror.js', () => ({
    mirrorWrite: mirrorWriteSpy,
    mirrorEnabled: () => true,
  }));
});

afterEach(() => {
  vi.restoreAllMocks();
  fs.rmSync(tmpDataDir, { recursive: true, force: true });
  delete process.env.DATA_DIR;
  delete process.env.DB_BACKEND;
});

function fakeMysqlModule() {
  const fakePool = { query: vi.fn().mockResolvedValue([[], undefined]) };
  return {
    getPool: () => fakePool,
    insertRow: vi.fn().mockImplementation(async (table, row) => row),
    upsertRow: vi.fn().mockImplementation(async (table, row) => row),
    updateRow: vi.fn().mockImplementation(async (table, id, updates, idColumn = 'id') => ({ [idColumn]: id, ...updates })),
    deleteRow: vi.fn().mockResolvedValue(true),
    selectById: vi.fn().mockResolvedValue(null),
    selectWhere: vi.fn().mockResolvedValue([]),
    selectAll: vi.fn().mockResolvedValue([]),
  };
}

describe('db/store.js — mirror calls in file-mode (no Supabase, DB_BACKEND unset)', () => {
  it('createModule mirrors into the flat `modules` table', async () => {
    const store = await import('./store.js');
    const mod = await store.createModule({ title: 'T1', category: 'General', difficulty: 'beginner' }, 'creator1');
    expect(mirrorWriteSpy).toHaveBeenCalledWith(expect.objectContaining({
      table: 'modules',
      op: 'upsert',
      id: mod.id,
      idColumn: 'id',
      data: expect.objectContaining({ id: mod.id, title: 'T1', created_by: 'creator1' }),
    }));
  });

  it('createNotification mirrors into the `notifications` table', async () => {
    const store = await import('./store.js');
    const notif = await store.createNotification({ user_id: 'u1', type: 'info', message: 'hi' });
    expect(mirrorWriteSpy).toHaveBeenCalledWith(expect.objectContaining({
      table: 'notifications',
      op: 'upsert',
      id: notif.id,
      idColumn: 'id',
      data: expect.objectContaining({
        id: notif.id,
        user_id: 'u1',
        read: false,
        payload: expect.objectContaining({ type: 'info', message: 'hi' }),
      }),
    }));
  });

  it('createAssignment / updateAssignment / createAssignmentRequest / createGroup all mirror their own tables', async () => {
    const store = await import('./store.js');
    mirrorWriteSpy.mockClear();
    const a = await store.createAssignment({ id: 'assign_x1', assigned_to_user: 'u1', status: 'assigned' });
    expect(mirrorWriteSpy).toHaveBeenCalledWith(expect.objectContaining({ table: 'assignments', op: 'upsert', id: a.id }));

    mirrorWriteSpy.mockClear();
    await store.updateAssignment(a.id, { status: 'completed' });
    expect(mirrorWriteSpy).toHaveBeenCalledWith(expect.objectContaining({ table: 'assignments', op: 'upsert', id: a.id, data: expect.objectContaining({ status: 'completed' }) }));

    mirrorWriteSpy.mockClear();
    const req = await store.createAssignmentRequest({ manager_id: 'm1', module_id: 'mod_1' });
    expect(mirrorWriteSpy).toHaveBeenCalledWith(expect.objectContaining({ table: 'assignment_requests', op: 'upsert', id: req.id }));

    mirrorWriteSpy.mockClear();
    const g = await store.createGroup({ id: 'grp_store1', name: 'Group1', managerId: null, employeeIds: [] });
    expect(mirrorWriteSpy).toHaveBeenCalledWith(expect.objectContaining({
      table: 'groups', op: 'upsert', id: g.id,
      data: expect.objectContaining({ id: g.id, name: 'Group1' }),
    }));
  });

  it('a primary-write failure does not call mirrorWrite (markNotificationRead on a missing notification)', async () => {
    const store = await import('./store.js');
    mirrorWriteSpy.mockClear();
    await expect(store.markNotificationRead('notif_missing', 'u1')).rejects.toThrow('Notification not found');
    expect(mirrorWriteSpy).not.toHaveBeenCalled();
  });
});

describe('db/store.js — switch mode (DB_BACKEND=mysql): no redundant mirror write', () => {
  beforeEach(() => {
    process.env.DB_BACKEND = 'mysql';
    vi.doMock('./mysql.js', fakeMysqlModule);
  });

  it('createModule does not call mirrorWrite a second time (switch already targets MySQL directly)', async () => {
    const store = await import('./store.js');
    await store.createModule({ title: 'T2', category: 'General' }, 'creator1');
    expect(mirrorWriteSpy).not.toHaveBeenCalled();
  });

  it('createNotification does not call mirrorWrite a second time in switch mode', async () => {
    const store = await import('./store.js');
    await store.createNotification({ user_id: 'u1', type: 'info', message: 'hi' });
    expect(mirrorWriteSpy).not.toHaveBeenCalled();
  });
});
