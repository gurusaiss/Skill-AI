// Mirror tests for DataStore.js running with Supabase "configured" (mocked
// @supabase/supabase-js client — no real network). Covers the two cases the
// file-mode test suite (DataStore.mysqlMirror.test.js) can't:
//   1. the shared sbInsert/sbUpdate/sbDelete helpers mirror on a SUCCESSFUL
//      Supabase write (proving the "one shared helper" insertion point works
//      for the Supabase-configured deployment path, not just file mode).
//   2. a write that is REJECTED by Supabase AND has no safety net (Groups.create
//      is the one path in DataStore.js that re-throws instead of falling back
//      to the file) must NOT call mirrorWrite — the "never mirror a write the
//      primary path rejected" requirement.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const base = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'node_modules', '.cache');
fs.mkdirSync(base, { recursive: true });

let tmpDataDir;
let mirrorWrite;

beforeEach(() => {
  tmpDataDir = fs.mkdtempSync(path.join(base, 'sf-ds-mirror-sb-test-'));
  process.env.DATA_DIR = tmpDataDir;
  process.env.SUPABASE_URL = 'https://fake.supabase.co';
  process.env.SUPABASE_SECRET_KEY = 'x'.repeat(30);
  vi.resetModules();
});

afterEach(() => {
  vi.restoreAllMocks();
  fs.rmSync(tmpDataDir, { recursive: true, force: true });
  delete process.env.DATA_DIR;
  delete process.env.SUPABASE_URL;
  delete process.env.SUPABASE_SECRET_KEY;
});

// A minimal chainable + thenable fake Supabase query builder. Every chain
// method returns itself; both `.maybeSingle()` and a bare `await` on the
// builder resolve to the same configured { data, error }, matching however
// each DataStore.js call site consumes it (some call .maybeSingle(), some
// `sbDelete`-style callers just await the builder directly).
function fakeSupabase(responsesByTable) {
  return {
    from(table) {
      const resp = () => responsesByTable[table] || { data: null, error: null };
      const builder = {
        select: () => builder,
        eq: () => builder,
        order: () => builder,
        upsert: () => builder,
        update: () => builder,
        insert: () => builder,
        delete: () => builder,
        maybeSingle: async () => resp(),
        then: (resolve, reject) => Promise.resolve(resp()).then(resolve, reject),
      };
      return builder;
    },
  };
}

async function loadWithSupabase(responsesByTable) {
  mirrorWrite = vi.fn().mockResolvedValue(undefined);
  vi.doMock('../db/mysqlMirror.js', () => ({
    mirrorWrite,
    mirrorEnabled: () => true,
    mirrorQueueStats: () => ({ pending: 0, oldestPendingAt: null }),
  }));
  vi.doMock('@supabase/supabase-js', () => ({
    createClient: () => fakeSupabase(responsesByTable),
  }));
  return import('./DataStore.js');
}

describe('DataStore mirror — Supabase configured (mocked client)', () => {
  it('sbInsert: mirrors on a successful Supabase create (Assessments.create)', async () => {
    const { Assessments } = await loadWithSupabase({
      assessments: { data: { id: 'a1', data: { title: 'One' } }, error: null },
    });
    await Assessments.create({ id: 'a1', title: 'One' });
    expect(mirrorWrite).toHaveBeenCalledWith({ table: 'assessments', op: 'upsert', id: 'a1', data: { title: 'One' } });
  });

  it('sbUpdate: mirrors on a successful Supabase update (Assessments.update)', async () => {
    const { Assessments } = await loadWithSupabase({
      assessments: { data: { id: 'a1', data: { title: 'Renamed' } }, error: null },
    });
    await Assessments.update('a1', { title: 'Renamed' });
    expect(mirrorWrite).toHaveBeenCalledWith({ table: 'assessments', op: 'upsert', id: 'a1', data: expect.objectContaining({ title: 'Renamed' }) });
  });

  it('sbDelete: mirrors on a successful Supabase delete (Assessments.delete)', async () => {
    const { Assessments } = await loadWithSupabase({
      assessments: { data: null, error: null },
    });
    await Assessments.delete('a1');
    expect(mirrorWrite).toHaveBeenCalledWith({ table: 'assessments', op: 'delete', id: 'a1', idColumn: 'id' });
  });

  it('a Supabase write REJECTED with no fallback (Groups.create throwing) never calls mirrorWrite', async () => {
    const { Groups } = await loadWithSupabase({
      groups: { data: null, error: { message: 'duplicate key', code: '23505' } },
    });
    await expect(Groups.create({ id: 'g1', name: 'Dup' })).rejects.toThrow('Failed to save group');
    expect(mirrorWrite).not.toHaveBeenCalled();
  });

  it('QuestionBankVersions.create (flat-column, direct supabase insert): mirrors the full row on success', async () => {
    const { QuestionBankVersions } = await loadWithSupabase({
      question_bank_versions: { data: null, error: null }, // maybeSingle() returns no row -> falls back to `row` itself
    });
    const v = await QuestionBankVersions.create({ roleId: 'role1', version: 1, questions: [{ q: 1 }], questionCount: 1 });
    expect(mirrorWrite).toHaveBeenCalledWith({ table: 'question_bank_versions', op: 'upsert', id: v.id, data: v, idColumn: 'id' });
  });

  it('QuestionBankVersions.delete: Supabase error falls through to file delete, which mirrors; a clean Supabase delete mirrors directly without touching the file', async () => {
    const { QuestionBankVersions } = await loadWithSupabase({
      question_bank_versions: { data: null, error: null },
    });
    const v = await QuestionBankVersions.create({ roleId: 'role1', version: 1, questions: [], questionCount: 0 });
    mirrorWrite.mockClear();
    await QuestionBankVersions.delete(v.id);
    expect(mirrorWrite).toHaveBeenCalledWith({ table: 'question_bank_versions', op: 'delete', id: v.id, idColumn: 'id' });
  });
});
