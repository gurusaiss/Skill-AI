// Unit tests for the additive MySQL mirror calls in UserStore.js.
// server/db/mysqlMirror.js is mocked entirely (mirrorWrite is a spy) — no
// real network/DB. For "switch mode" (DB_BACKEND=mysql) cases, server/db/
// mysql.js is also mocked so the existing useMySQL() branch runs without a
// real pool. Each test resets modules so mock state never leaks.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const base = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'node_modules', '.cache');
fs.mkdirSync(base, { recursive: true });

let tmpDataDir;
let mirrorWriteSpy;

beforeEach(() => {
  tmpDataDir = fs.mkdtempSync(path.join(base, 'sf-userstore-mirror-'));
  process.env.DATA_DIR = tmpDataDir;
  for (const k of ['SUPABASE_URL', 'SUPABASESERVICE_ROLE_KEY', 'SUPABASE_SECRET_KEY', 'SUPABASE_KEY', 'DB_BACKEND']) {
    delete process.env[k];
  }
  vi.resetModules();
  mirrorWriteSpy = vi.fn().mockResolvedValue(undefined);
  vi.doMock('../db/mysqlMirror.js', () => ({
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
  const fakePool = { query: vi.fn().mockResolvedValue([[]]) };
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

describe('UserStore.js — mirror calls in file-mode (no Supabase, DB_BACKEND unset)', () => {
  it('_createUser mirrors the created row', async () => {
    const UserStore = (await import('./UserStore.js')).default;
    const u = await UserStore.createUser({ email: 'create@test.local', passwordHash: 'x', name: 'A', role: 'employee' });
    expect(mirrorWriteSpy).toHaveBeenCalledWith(expect.objectContaining({
      table: 'users',
      op: 'upsert',
      id: u.userId,
      idColumn: 'user_id',
      data: expect.objectContaining({ user_id: u.userId, email: 'create@test.local' }),
    }));
  });

  it('_updateUser mirrors the updated fields', async () => {
    const UserStore = (await import('./UserStore.js')).default;
    const u = await UserStore.createUser({ email: 'update@test.local', passwordHash: 'x', name: 'A', role: 'employee' });
    mirrorWriteSpy.mockClear();
    await UserStore.updateUser(u.userId, { name: 'Renamed' });
    expect(mirrorWriteSpy).toHaveBeenCalledWith(expect.objectContaining({
      table: 'users',
      op: 'upsert',
      id: u.userId,
      idColumn: 'user_id',
      data: expect.objectContaining({ user_id: u.userId, name: 'Renamed' }),
    }));
  });

  it('_deleteUser mirrors a delete', async () => {
    const UserStore = (await import('./UserStore.js')).default;
    const u = await UserStore.createUser({ email: 'delete@test.local', passwordHash: 'x', name: 'A', role: 'employee' });
    mirrorWriteSpy.mockClear();
    await UserStore.deleteUser(u.userId);
    expect(mirrorWriteSpy).toHaveBeenCalledWith(expect.objectContaining({
      table: 'users', op: 'delete', id: u.userId, idColumn: 'user_id',
    }));
  });

  it('_createAssignment mirrors the created row', async () => {
    const UserStore = (await import('./UserStore.js')).default;
    mirrorWriteSpy.mockClear();
    const a = await UserStore.createAssignment({ assignable_id: 'mod_1', type: 'module', assigned_to_user: 'u1' });
    expect(mirrorWriteSpy).toHaveBeenCalledWith(expect.objectContaining({
      table: 'assignments',
      op: 'upsert',
      id: a.id,
      idColumn: 'id',
      data: expect.objectContaining({ id: a.id, assignable_id: 'mod_1' }),
    }));
  });

  it('a primary-write failure does not call mirrorWrite', async () => {
    const UserStore = (await import('./UserStore.js')).default;
    await UserStore.createUser({ email: 'dup@test.local', passwordHash: 'x', name: 'A', role: 'employee' });
    mirrorWriteSpy.mockClear();
    await expect(
      UserStore.createUser({ email: 'dup@test.local', passwordHash: 'x', name: 'B', role: 'employee' })
    ).rejects.toThrow('Email already registered');
    expect(mirrorWriteSpy).not.toHaveBeenCalled();
  });

  it('_deleteAssignment on a missing row fails without mirroring', async () => {
    const UserStore = (await import('./UserStore.js')).default;
    mirrorWriteSpy.mockClear();
    await expect(UserStore.deleteAssignment('assign_does_not_exist')).rejects.toThrow('Assignment not found');
    expect(mirrorWriteSpy).not.toHaveBeenCalled();
  });

  it('the Groups cascade-delete TODO: deleting a user updates group membership, mirrored via DataStore.Groups.update (shared mysqlMirror mock)', async () => {
    const UserStore = (await import('./UserStore.js')).default;
    const { Groups } = await import('./DataStore.js');
    const u = await UserStore.createUser({ email: 'grouped@test.local', passwordHash: 'x', name: 'G', role: 'employee' });
    await Groups.create({ id: 'grp_test1', name: 'G1', employeeIds: [u.userId], managerId: null });
    mirrorWriteSpy.mockClear();

    await UserStore.deleteUser(u.userId);

    // The user delete itself mirrors a `users` delete...
    expect(mirrorWriteSpy).toHaveBeenCalledWith(expect.objectContaining({ table: 'users', op: 'delete', id: u.userId }));
    // ...and the group membership cleanup (Groups.update, in DataStore.js)
    // mirrors its own `groups` upsert with the user removed from employeeIds.
    const groupsCall = mirrorWriteSpy.mock.calls.find(([arg]) => arg.table === 'groups');
    expect(groupsCall).toBeTruthy();
    expect(groupsCall[0].data.data.employeeIds).not.toContain(u.userId);
  });
});

describe('UserStore.js — switch mode (DB_BACKEND=mysql): no redundant mirror write', () => {
  beforeEach(() => {
    process.env.DB_BACKEND = 'mysql';
    vi.doMock('../db/mysql.js', fakeMysqlModule);
  });

  it('_createUser does not call mirrorWrite a second time (switch already targets MySQL directly)', async () => {
    const UserStore = (await import('./UserStore.js')).default;
    await UserStore.createUser({ email: 'switch@test.local', passwordHash: 'x', name: 'S', role: 'employee' });
    expect(mirrorWriteSpy).not.toHaveBeenCalled();
  });

  it('_createAssignment does not call mirrorWrite a second time in switch mode', async () => {
    const UserStore = (await import('./UserStore.js')).default;
    await UserStore.createAssignment({ assignable_id: 'mod_1', type: 'module', assigned_to_user: 'u1' });
    expect(mirrorWriteSpy).not.toHaveBeenCalled();
  });
});
