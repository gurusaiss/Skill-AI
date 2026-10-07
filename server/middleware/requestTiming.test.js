import { describe, it, expect } from 'vitest';
import { createTimingAggregator, routePattern, TOP_N } from './requestTiming.js';

describe('createTimingAggregator', () => {
  it('computes count / avg / p95 / max / avg bytes per route', () => {
    const agg = createTimingAggregator({ window: 500, topN: 15 });
    for (let i = 1; i <= 100; i++) agg.record('GET /api/a', i, 1000);
    agg.record('GET /api/b', 5, 10);
    const s = agg.summary();
    const a = s.slowestRoutes.find(r => r.route === 'GET /api/a');
    expect(a).toMatchObject({ count: 100, avgMs: 51, p95Ms: 95, maxMs: 100, avgBytes: 1000 });
    expect(s.windowRequests).toBe(101);
  });

  it('sorts slowest first and caps at topN', () => {
    const agg = createTimingAggregator({ window: 500, topN: 15 });
    for (let i = 0; i < 20; i++) agg.record(`GET /api/r${i}`, (i + 1) * 10, 1);
    const s = agg.summary();
    expect(s.slowestRoutes).toHaveLength(TOP_N);
    expect(s.slowestRoutes[0].route).toBe('GET /api/r19');
    expect(s.slowestRoutes[0].p95Ms).toBeGreaterThanOrEqual(s.slowestRoutes[1].p95Ms);
  });

  it('keeps only the last `window` requests (rolling)', () => {
    const agg = createTimingAggregator({ window: 10, topN: 15 });
    for (let i = 0; i < 10; i++) agg.record('GET /old', 1000, 1);
    for (let i = 0; i < 10; i++) agg.record('GET /new', 1, 1);
    const s = agg.summary();
    expect(s.windowRequests).toBe(10);
    expect(s.slowestRoutes.map(r => r.route)).toEqual(['GET /new']);
  });

  it('stores no per-user data (only route, ms, bytes aggregates)', () => {
    const agg = createTimingAggregator();
    agg.record('GET /api/x', 1, 1);
    expect(Object.keys(agg.summary().slowestRoutes[0]).sort()).toEqual(['avgBytes', 'avgMs', 'count', 'maxMs', 'p95Ms', 'route']);
  });
});

describe('routePattern', () => {
  it('uses the matched express route pattern, not the concrete id', () => {
    expect(routePattern({ method: 'GET', baseUrl: '/api/assessments', route: { path: '/:id' }, originalUrl: '/api/assessments/abc?token=secret' }))
      .toBe('GET /api/assessments/:id');
    expect(routePattern({ method: 'GET', baseUrl: '/api/assessments', route: { path: '/' }, originalUrl: '/api/assessments?full=1' }))
      .toBe('GET /api/assessments');
  });

  it('collapses ids and drops the query string for unmatched paths', () => {
    const p = routePattern({ method: 'GET', originalUrl: '/api/users/auth_user_12345678/x?secret=1' });
    expect(p).toBe('GET /api/users/:id/x');
  });
});
