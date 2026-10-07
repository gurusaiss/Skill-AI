/**
 * requestTiming.js - lightweight API request timing / observability.
 *
 *  - Adds a `Server-Timing: total;dur=<ms>` header to every /api response
 *    (written when headers are flushed, so it reflects time-to-first-byte).
 *  - Logs ONE line for any request slower than SLOW_MS (default 800 ms):
 *    method, route pattern, status, ms, response bytes. Never bodies, tokens,
 *    query strings or user ids (ids in unmatched paths are collapsed to :id).
 *  - Keeps a rolling in-memory window of the last WINDOW (500) requests and
 *    exposes the TOP_N (15) slowest route patterns via getPerformanceSummary()
 *    (count, avg, p95, max, avg bytes). No per-user data is stored.
 *
 * Mount it BEFORE compression() so counted bytes are the bytes on the wire.
 */

export const SLOW_MS = Number(process.env.SLOW_REQUEST_MS) || 800;
export const WINDOW = 500;
export const TOP_N = 15;

const ID_SEG = /^(?:[0-9a-f]{8}-[0-9a-f-]{27}|\d{2,}|[A-Za-z0-9_-]*\d[A-Za-z0-9_-]{6,})$/i;

/** Normalised route key, e.g. "GET /api/assessments/:id". */
export function routePattern(req) {
  const base = req.baseUrl || '';
  if (req.route && req.route.path !== undefined) {
    const p = typeof req.route.path === 'string' ? req.route.path : '(regex)';
    return `${req.method} ${base}${p === '/' ? '' : p}` || `${req.method} ${base}`;
  }
  const path = (req.originalUrl || req.url || '').split('?')[0];
  return `${req.method} ${path.split('/').map(s => (ID_SEG.test(s) ? ':id' : s)).join('/')}`;
}

export function createTimingAggregator({ window = WINDOW, topN = TOP_N } = {}) {
  const ring = new Array(window);
  let next = 0;
  let size = 0;

  function record(route, ms, bytes) {
    ring[next] = { route, ms, bytes };
    next = (next + 1) % window;
    if (size < window) size++;
  }

  function summary() {
    const groups = new Map();
    for (let i = 0; i < size; i++) {
      const e = ring[i];
      let g = groups.get(e.route);
      if (!g) { g = { route: e.route, times: [], bytes: 0 }; groups.set(e.route, g); }
      g.times.push(e.ms);
      g.bytes += e.bytes || 0;
    }
    const rows = [...groups.values()].map(g => {
      const t = g.times.sort((a, b) => a - b);
      const sum = t.reduce((s, x) => s + x, 0);
      const p95 = t[Math.min(t.length - 1, Math.ceil(t.length * 0.95) - 1)];
      return {
        route: g.route,
        count: t.length,
        avgMs: Math.round(sum / t.length),
        p95Ms: Math.round(p95),
        maxMs: Math.round(t[t.length - 1]),
        avgBytes: Math.round(g.bytes / t.length),
      };
    });
    rows.sort((a, b) => b.p95Ms - a.p95Ms || b.avgMs - a.avgMs);
    return { windowRequests: size, windowSize: window, slowThresholdMs: SLOW_MS, slowestRoutes: rows.slice(0, topN) };
  }

  function reset() { next = 0; size = 0; }
  return { record, summary, reset };
}

const aggregator = createTimingAggregator();
export const getPerformanceSummary = () => aggregator.summary();
export const resetPerformance = () => aggregator.reset();

export function requestTiming(req, res, next) {
  const start = process.hrtime.bigint();
  let bytes = 0;
  let route = null; // captured at header time, while req.baseUrl/req.route are still set

  const origWriteHead = res.writeHead;
  res.writeHead = function patchedWriteHead(...args) {
    if (route === null) route = routePattern(req);
    if (!res.headersSent && !res.getHeader('Server-Timing')) {
      const ms = Number(process.hrtime.bigint() - start) / 1e6;
      res.setHeader('Server-Timing', `total;dur=${ms.toFixed(1)}`);
    }
    return origWriteHead.apply(this, args);
  };

  const origWrite = res.write;
  const origEnd = res.end;
  res.write = function (chunk, ...rest) {
    if (chunk) bytes += typeof chunk === 'string' ? Buffer.byteLength(chunk) : (chunk.length || 0);
    return origWrite.call(this, chunk, ...rest);
  };
  res.end = function (chunk, ...rest) {
    if (chunk && typeof chunk !== 'function') bytes += typeof chunk === 'string' ? Buffer.byteLength(chunk) : (chunk.length || 0);
    return origEnd.call(this, chunk, ...rest);
  };

  res.on('finish', () => {
    const ms = Number(process.hrtime.bigint() - start) / 1e6;
    if (route === null) route = routePattern(req);
    if (!route.endsWith('/api/health')) aggregator.record(route, ms, bytes);
    if (ms >= SLOW_MS) {
      console.warn(`[slow] ${route} status=${res.statusCode} ${Math.round(ms)}ms bytes=${bytes}`);
    }
  });
  next();
}

export default requestTiming;
