// Integration test for the DataStore / UserStore read caches (file mode, temp DATA_DIR).
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// Under node_modules (git-ignored, same drive as the repo) rather than the OS temp dir.
const base = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'node_modules', '.cache');
fs.mkdirSync(base, { recursive: true });
const tmp = fs.mkdtempSync(path.join(base, 'sf-cache-test-'));
process.env.DATA_DIR = tmp;
for (const k of ['SUPABASE_URL', 'SUPABASESERVICE_ROLE_KEY', 'SUPABASE_SECRET_KEY', 'SUPABASE_KEY', 'DB_BACKEND', 'DISABLE_READ_CACHE']) delete process.env[k];

let Assessments, UserStore, clearReadCache;

beforeAll(async () => {
  ({ Assessments, clearReadCache } = await import('./DataStore.js'));
  UserStore = (await import('./UserStore.js')).default;
});
afterAll(() => { fs.rmSync(tmp, { recursive: true, force: true }); });

describe('DataStore.getAll cache', () => {
  it('sees its own writes immediately (create / update / delete invalidate)', async () => {
    clearReadCache();
    expect(await Assessments.getAll()).toEqual([]);
    await Assessments.create({ id: 'a1', title: 'One' });
    expect((await Assessments.getAll()).map(a => a.id)).toEqual(['a1']);
    await Assessments.update('a1', { title: 'Renamed' });
    expect((await Assessments.getAll())[0].title).toBe('Renamed');
    await Assessments.delete('a1');
    expect(await Assessments.getAll()).toEqual([]);
  });

  it('notices a file changed by a writer that bypasses DataStore (mtime/size check)', async () => {
    clearReadCache();
    await Assessments.getAll();
    fs.writeFileSync(path.join(tmp, 'assessments.json'), JSON.stringify([{ id: 'ext', title: 'External' }, { id: 'ext2' }]));
    expect((await Assessments.getAll()).map(a => a.id)).toEqual(['ext', 'ext2']);
  });

  it('returns a copy of the array so callers can mutate it safely', async () => {
    clearReadCache();
    const first = await Assessments.getAll();
    first.push({ id: 'junk' });
    expect((await Assessments.getAll()).some(a => a.id === 'junk')).toBe(false);
  });
});

describe('UserStore auth cache (getUserByIdCached)', () => {
  it('reflects role / permission changes made through updateUser immediately', async () => {
    const u = await UserStore.createUser({ email: 'cache@test.local', passwordHash: 'x', name: 'C', role: 'employee' });
    const a = await UserStore.getUserByIdCached(u.userId);
    expect(a.role).toBe('employee');
    await UserStore.updateUser(u.userId, { role: 'manager', permissions: { granted: [], revoked: ['assessments.create'] } });
    const b = await UserStore.getUserByIdCached(u.userId);
    expect(b.role).toBe('manager');
    expect(b.permissions.revoked).toContain('assessments.create');
  });

  it('a deleted user stops authenticating immediately; "not found" is never cached', async () => {
    const u = await UserStore.createUser({ email: 'gone@test.local', passwordHash: 'x', name: 'G', role: 'employee' });
    expect(await UserStore.getUserByIdCached(u.userId)).toBeTruthy();
    await UserStore.deleteUser(u.userId);
    expect(await UserStore.getUserByIdCached(u.userId)).toBeNull();
    expect(await UserStore.getUserByIdCached('nope')).toBeNull();
  });

  it('getAllUsers cache is invalidated by createUser and filters by role in memory', async () => {
    const before = (await UserStore.getAllUsers({})).length;
    await UserStore.createUser({ email: 'new1@test.local', passwordHash: 'x', name: 'N', role: 'trainer' });
    const after = await UserStore.getAllUsers({});
    expect(after.length).toBe(before + 1);
    expect((await UserStore.getAllUsers({ role: 'trainer' })).every(x => x.role === 'trainer')).toBe(true);
  });
});
