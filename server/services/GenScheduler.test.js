import { describe, it, expect } from 'vitest';
import { PriorityQueue, TimeBudget, TaskPool, mapPool } from './GenScheduler.js';

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

describe('PriorityQueue', () => {
  it('pops highest priority first, FIFO among equals', () => {
    const q = new PriorityQueue();
    q.push('a', 1); q.push('b', 5); q.push('c', 5); q.push('d', 3);
    expect([q.pop(), q.pop(), q.pop(), q.pop(), q.pop()]).toEqual(['b', 'c', 'd', 'a', undefined]);
  });
  it('removeWhere keeps order', () => {
    const q = new PriorityQueue();
    [1, 2, 3, 4].forEach(n => q.push(n, n));
    expect(q.removeWhere(n => n % 2 === 0)).toHaveLength(2);
    expect([q.pop(), q.pop()]).toEqual([3, 1]);
  });
});

describe('TimeBudget', () => {
  it('uses the injected clock', () => {
    let t = 1000; const b = new TimeBudget(500, () => t);
    expect(b.expired).toBe(false); expect(b.remainingMs).toBe(500);
    t = 1400; expect(b.hasRoom(100)).toBe(true); expect(b.hasRoom(200)).toBe(false);
    t = 1600; expect(b.expired).toBe(true); expect(b.remainingMs).toBe(0); expect(b.fractionUsed()).toBe(1);
  });
});

describe('TaskPool', () => {
  it('never exceeds the concurrency limit and runs by priority', async () => {
    let active = 0, max = 0; const order = [];
    const pool = new TaskPool({ concurrency: 2, run: async (t) => { active++; max = Math.max(max, active); order.push(t); await sleep(5); active--; } });
    [['low', 1], ['high', 9], ['mid', 5], ['mid2', 5], ['x', 0]].forEach(([t, p]) => pool.add(t, p));
    const r = await pool.drain();
    expect(max).toBeLessThanOrEqual(2);
    expect(order.slice(0, 2)).toEqual(['high', 'mid']);
    expect(r.finished).toBe(5);
  });
  it('skips tasks and supports follow-up tasks from onDone', async () => {
    const ran = [];
    const pool = new TaskPool({
      concurrency: 1, shouldSkip: (t) => t === 'skip', run: async (t) => { ran.push(t); },
      onDone: (t) => { if (t === 'first') pool.add('follow', 1); },
    });
    pool.add('first', 5); pool.add('skip', 4);
    const r = await pool.drain();
    expect(ran).toEqual(['first', 'follow']);
    expect(r.skipped).toBe(1);
  });
  it('stops at the time budget and abandons in-flight work instead of waiting for it', async () => {
    const budget = new TimeBudget(60);
    const done = [];
    const pool = new TaskPool({ concurrency: 2, budget, run: async (t) => { await sleep(t); done.push(t); } });
    pool.add(5, 9); pool.add(500, 8); pool.add(7, 1); pool.add(7, 0);
    const t0 = Date.now();
    const r = await pool.drain();
    expect(Date.now() - t0).toBeLessThan(300); // did not wait for the 500 ms task
    expect(r.expired).toBe(true);
    expect(done).not.toContain(500);
  });
});

describe('mapPool', () => {
  it('preserves order and bounds concurrency; errors do not abort', async () => {
    let active = 0, max = 0;
    const res = await mapPool([30, 1, 20, 2, 3], 2, async (ms, i) => { active++; max = Math.max(max, active); await sleep(ms); active--; if (i === 3) throw new Error('x'); return ms; });
    expect(max).toBeLessThanOrEqual(2);
    expect(res[0]).toBe(30); expect(res[1]).toBe(1); expect(res[3].error).toBeTruthy(); expect(res[4]).toBe(3);
  });
});
