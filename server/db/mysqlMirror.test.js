// Unit tests for the MySQL async mirror (server/db/mysqlMirror.js).
// No real network/DB: '../db/mysql.js' is mocked entirely. Each test resets
// modules so the mirror's module-level state (sweep-started flag, drain
// lock, warning throttle) never leaks between cases.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const base = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'node_modules', '.cache');
fs.mkdirSync(base, { recursive: true });

let tmpDataDir;

beforeEach(() => {
  tmpDataDir = fs.mkdtempSync(path.join(base, 'sf-mirror-test-'));
  process.env.DATA_DIR = tmpDataDir;
  vi.resetModules();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
  fs.rmSync(tmpDataDir, { recursive: true, force: true });
  delete process.env.DATA_DIR;
});

function queueFile() {
  return path.join(tmpDataDir, 'mysql-mirror-queue.jsonl');
}

describe('mirrorEnabled() / zero overhead when unconfigured', () => {
  it('is false and mirrorWrite is a true no-op when no pool is configured', async () => {
    vi.doMock('./mysql.js', () => ({
      getPool: () => null,
      upsertRow: vi.fn(),
      deleteRow: vi.fn(),
    }));
    const { mirrorEnabled, mirrorWrite } = await import('./mysqlMirror.js');
    expect(mirrorEnabled()).toBe(false);

    const start = Date.now();
    for (let i = 0; i < 1000; i++) {
      // eslint-disable-next-line no-await-in-loop
      await mirrorWrite({ table: 'users', op: 'upsert', id: `u${i}`, data: { id: `u${i}` } });
    }
    expect(Date.now() - start).toBeLessThan(500); // near-instant, no real waiting
    expect(fs.existsSync(queueFile())).toBe(false); // nothing queued, nothing attempted
  });

  it('starts no timer at all while unconfigured', async () => {
    vi.useFakeTimers();
    vi.doMock('./mysql.js', () => ({
      getPool: () => null,
      upsertRow: vi.fn(),
      deleteRow: vi.fn(),
    }));
    const { mirrorWrite } = await import('./mysqlMirror.js');
    for (let i = 0; i < 50; i++) {
      // eslint-disable-next-line no-await-in-loop
      await mirrorWrite({ table: 'users', op: 'upsert', id: `u${i}`, data: { id: `u${i}` } });
    }
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe('mirrorWrite() with a healthy pool', () => {
  it('upserts successfully and never queues', async () => {
    const upsertRow = vi.fn().mockResolvedValue({});
    vi.doMock('./mysql.js', () => ({
      getPool: () => ({ fake: true }),
      upsertRow,
      deleteRow: vi.fn(),
    }));
    const { mirrorWrite, mirrorEnabled, mirrorQueueStats } = await import('./mysqlMirror.js');
    expect(mirrorEnabled()).toBe(true);
    await mirrorWrite({ table: 'generated_content', op: 'upsert', id: 'gc1', data: { foo: 'bar' } });
    expect(upsertRow).toHaveBeenCalledTimes(1);
    expect(upsertRow.mock.calls[0][0]).toBe('generated_content');
    expect(upsertRow.mock.calls[0][1]).toEqual({ id: 'gc1', data: { foo: 'bar' } });
    expect(mirrorQueueStats()).toEqual({ pending: 0, oldestPendingAt: null });
  });

  it('passes a flat row through as-is when it already contains the id column', async () => {
    const upsertRow = vi.fn().mockResolvedValue({});
    vi.doMock('./mysql.js', () => ({
      getPool: () => ({ fake: true }),
      upsertRow,
      deleteRow: vi.fn(),
    }));
    const { mirrorWrite } = await import('./mysqlMirror.js');
    const flatRow = { id: 'u1', email: 'a@b.com', name: 'A' };
    await mirrorWrite({ table: 'users', op: 'upsert', id: 'u1', data: flatRow });
    expect(upsertRow.mock.calls[0][1]).toBe(flatRow);
  });

  it('catches a failure (incl. timeout) without throwing, and queues the entry', async () => {
    const upsertRow = vi.fn().mockRejectedValue(new Error('connection reset'));
    vi.doMock('./mysql.js', () => ({
      getPool: () => ({ fake: true }),
      upsertRow,
      deleteRow: vi.fn(),
    }));
    const { mirrorWrite, mirrorQueueStats } = await import('./mysqlMirror.js');
    await expect(
      mirrorWrite({ table: 'users', op: 'upsert', id: 'u1', data: { id: 'u1' } })
    ).resolves.toBeUndefined();
    const stats = mirrorQueueStats();
    expect(stats.pending).toBe(1);
    expect(stats.oldestPendingAt).toBeTruthy();
  });
});

describe('drainMirrorQueue()', () => {
  async function loadWithPool(upsertRow, deleteRow = vi.fn()) {
    vi.doMock('./mysql.js', () => ({
      getPool: () => ({ fake: true }),
      upsertRow,
      deleteRow,
    }));
    return import('./mysqlMirror.js');
  }

  it('drains a queued entry successfully on next attempt', async () => {
    const upsertRow = vi.fn().mockRejectedValueOnce(new Error('boom')).mockResolvedValue({});
    const { mirrorWrite, drainMirrorQueue, mirrorQueueStats } = await loadWithPool(upsertRow);
    await mirrorWrite({ table: 'users', op: 'upsert', id: 'u1', data: { id: 'u1' } });
    expect(mirrorQueueStats().pending).toBe(1);

    const result = await drainMirrorQueue();
    expect(result.drained).toBe(1);
    expect(mirrorQueueStats().pending).toBe(0);
    expect(fs.existsSync(queueFile())).toBe(false);
  });

  it('keeps failing entries with incremented attempts, and drops after the cap', async () => {
    const upsertRow = vi.fn().mockRejectedValue(new Error('still down'));
    const { } = await loadWithPool(upsertRow); // ensure mock registered before writing queue by hand
    // Seed a queue entry one attempt away from the cap (20).
    fs.mkdirSync(tmpDataDir, { recursive: true });
    fs.writeFileSync(
      queueFile(),
      JSON.stringify({ table: 'users', op: 'upsert', id: 'u1', data: { id: 'u1' }, idColumn: 'id', failedAt: new Date().toISOString(), attempts: 19 }) + '\n'
    );
    const { drainMirrorQueue, mirrorQueueStats } = await import('./mysqlMirror.js');
    const result = await drainMirrorQueue();
    expect(result.drained).toBe(0);
    expect(mirrorQueueStats().pending).toBe(0); // dropped, not kept, after hitting the cap
  });

  it('two concurrent drains never double-process the same entries', async () => {
    let concurrentCalls = 0;
    let maxConcurrent = 0;
    const upsertRow = vi.fn().mockImplementation(async () => {
      concurrentCalls++;
      maxConcurrent = Math.max(maxConcurrent, concurrentCalls);
      await new Promise((r) => setTimeout(r, 20));
      concurrentCalls--;
      return {};
    });
    const { mirrorWrite, drainMirrorQueue, mirrorQueueStats } = await loadWithPool(
      vi.fn().mockRejectedValueOnce(new Error('x'))
    );
    await mirrorWrite({ table: 'users', op: 'upsert', id: 'u1', data: { id: 'u1' } });
    expect(mirrorQueueStats().pending).toBe(1);

    // Swap in the slow/instrumented upsertRow for the drain itself.
    vi.doMock('./mysql.js', () => ({ getPool: () => ({ fake: true }), upsertRow, deleteRow: vi.fn() }));
    vi.resetModules();
    fs.writeFileSync(
      queueFile(),
      JSON.stringify({ table: 'users', op: 'upsert', id: 'u1', data: { id: 'u1' }, idColumn: 'id', failedAt: new Date().toISOString(), attempts: 0 }) + '\n'
    );
    const mod = await import('./mysqlMirror.js');
    const [r1, r2] = await Promise.all([mod.drainMirrorQueue(), mod.drainMirrorQueue()]);
    const skippedCount = [r1, r2].filter((r) => r.skipped).length;
    expect(skippedCount).toBe(1); // exactly one call was turned away by the lock
    expect(maxConcurrent).toBe(1); // never two in-flight writes for the same entry
  });
});

describe('delete op', () => {
  it('routes to deleteRow, not upsertRow', async () => {
    const upsertRow = vi.fn().mockResolvedValue({});
    const deleteRow = vi.fn().mockResolvedValue(true);
    vi.doMock('./mysql.js', () => ({ getPool: () => ({ fake: true }), upsertRow, deleteRow }));
    const { mirrorWrite } = await import('./mysqlMirror.js');
    await mirrorWrite({ table: 'users', op: 'delete', id: 'u1', idColumn: 'id' });
    expect(deleteRow).toHaveBeenCalledWith('users', 'u1', 'id');
    expect(upsertRow).not.toHaveBeenCalled();
  });
});
