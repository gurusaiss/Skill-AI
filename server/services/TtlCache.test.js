import { describe, it, expect, afterEach } from 'vitest';
import { TtlCache } from './TtlCache.js';

function clock(start = 1000) {
  const c = { t: start, now: () => c.t };
  return c;
}

describe('TtlCache', () => {
  afterEach(() => { delete process.env.DISABLE_READ_CACHE; });

  it('serves from cache within the TTL and reloads after it', async () => {
    const c = clock();
    const cache = new TtlCache({ ttlMs: 5000, now: c.now });
    let loads = 0;
    const loader = async () => ++loads;
    expect(await cache.get('k', loader)).toBe(1);
    c.t += 4999;
    expect(await cache.get('k', loader)).toBe(1);
    c.t += 2;
    expect(await cache.get('k', loader)).toBe(2);
  });

  it('coalesces concurrent loads of the same key into one backend call', async () => {
    const cache = new TtlCache({ ttlMs: 5000 });
    let loads = 0;
    const loader = async () => { loads++; await new Promise(r => setTimeout(r, 20)); return 'v'; };
    const results = await Promise.all([1, 2, 3, 4, 5, 6].map(() => cache.get('k', loader)));
    expect(results).toEqual(['v', 'v', 'v', 'v', 'v', 'v']);
    expect(loads).toBe(1);
  });

  it('invalidate() makes the next read reload', async () => {
    const cache = new TtlCache({ ttlMs: 5000 });
    let n = 0;
    const loader = async () => ++n;
    expect(await cache.get('k', loader)).toBe(1);
    cache.invalidate('k');
    expect(await cache.get('k', loader)).toBe(2);
  });

  it('a load that started BEFORE an invalidation is never stored (no stale resurrection)', async () => {
    const cache = new TtlCache({ ttlMs: 5000 });
    let release;
    const slow = () => new Promise(r => { release = () => r('stale'); });
    const p = cache.get('k', slow);
    cache.invalidate('k');            // a write happened while the read was in flight
    release();
    expect(await p).toBe('stale');    // the caller that started it still gets its answer...
    let fresh = 0;
    expect(await cache.get('k', async () => { fresh++; return 'fresh'; })).toBe('fresh'); // ...but nobody else sees it
    expect(fresh).toBe(1);
  });

  it('invalidateAll() clears every key', async () => {
    const cache = new TtlCache({ ttlMs: 5000 });
    await cache.get('a', async () => 1);
    await cache.get('b', async () => 2);
    cache.invalidateAll();
    expect(await cache.get('a', async () => 10)).toBe(10);
    expect(await cache.get('b', async () => 20)).toBe(20);
  });

  it('validate() can reject an otherwise fresh entry (file mtime style check)', async () => {
    const cache = new TtlCache({ ttlMs: 5000 });
    let sig = 'a';
    let n = 0;
    const opts = { meta: () => sig, validate: (m) => m === sig };
    expect(await cache.get('k', async () => ++n, opts)).toBe(1);
    expect(await cache.get('k', async () => ++n, opts)).toBe(1);
    sig = 'b';
    expect(await cache.get('k', async () => ++n, opts)).toBe(2);
  });

  it('does not cache failures', async () => {
    const cache = new TtlCache({ ttlMs: 5000 });
    await expect(cache.get('k', async () => { throw new Error('boom'); })).rejects.toThrow('boom');
    expect(await cache.get('k', async () => 'ok')).toBe('ok');
  });

  it('DISABLE_READ_CACHE=1 turns it into a pass-through', async () => {
    process.env.DISABLE_READ_CACHE = '1';
    const cache = new TtlCache({ ttlMs: 5000 });
    let n = 0;
    await cache.get('k', async () => ++n);
    expect(await cache.get('k', async () => ++n)).toBe(2);
  });

  it('bounds the number of entries', async () => {
    const cache = new TtlCache({ ttlMs: 5000, maxEntries: 3 });
    for (let i = 0; i < 10; i++) await cache.get(`k${i}`, async () => i);
    expect(cache.stats().size).toBeLessThanOrEqual(3);
  });
});
