/**
 * server/db/mysqlMirror.js — best-effort async MySQL mirror.
 *
 * Architecture (confirmed, do not re-litigate): Supabase/file stays the
 * ONE authoritative read/write path, completely unchanged. MySQL is a
 * second datastore that every write SHOULD also reach, but:
 *   - a mirror failure must never fail/slow the caller's request
 *   - a failed mirror write is queued and retried later in the background
 *   - when MySQL isn't configured at all, this module costs ~0: no pool,
 *     no timer, no extra awaits beyond one cheap getPool() null-check.
 *
 * This module is intentionally independent of DB_BACKEND. DB_BACKEND picks
 * which store ANSWERS READS (Supabase/file vs MySQL-as-primary, in
 * UserStore.js/db/store.js today). The mirror runs regardless of that
 * switch — its only gate is "is a MySQL pool obtainable" (mirrorEnabled()).
 */
import fs from 'fs';
import path from 'path';
import { getPool, upsertRow, deleteRow } from './mysql.js';
import { DATA_DIR } from '../config/dataDir.js';

const QUEUE_FILE = path.join(DATA_DIR, 'mysql-mirror-queue.jsonl');
const WRITE_TIMEOUT_MS = parseInt(process.env.MYSQL_MIRROR_TIMEOUT_MS || '2000', 10);
const SWEEP_INTERVAL_MS = parseInt(process.env.MYSQL_MIRROR_RETRY_MS || '120000', 10);
const MAX_ATTEMPTS = 20;
const WARN_THROTTLE_MS = 10000;

// ── mirrorEnabled() ──────────────────────────────────────────────────────────
// getPool() is already O(1) when MySQL isn't configured (two env lookups,
// no connection attempt — mysql2 pools connect lazily), so there is nothing
// cheaper to cache here; calling it directly keeps "unconfigured" truly free
// and still reflects getPool()'s own periodic retry (see mysql.js) without
// mysqlMirror.js needing a second timer for that.
export function mirrorEnabled() {
  return getPool() !== null;
}

// ── sweep timer ──────────────────────────────────────────────────────────────
// Only ever started once, and only once a pool has actually been obtained —
// if MySQL was never configured, no timer is created at all (zero background
// overhead). This means mirroring that becomes configured/reachable only
// AFTER this process booted and never once succeeded won't self-start a
// sweep; in practice env vars are set at process start, so this tradeoff
// keeps the implementation simple rather than chasing a hot-reload story.
let _sweepStarted = false;
function ensureSweepStarted() {
  if (_sweepStarted) return;
  _sweepStarted = true;
  const timer = setInterval(() => {
    if (mirrorEnabled()) drainMirrorQueue().catch(() => {});
  }, SWEEP_INTERVAL_MS);
  if (typeof timer.unref === 'function') timer.unref(); // never blocks process exit
}

// ── rate-limited warning log ──────────────────────────────────────────────────
const _lastWarnAt = new Map();
function warnOnce(key, msg) {
  const now = Date.now();
  const last = _lastWarnAt.get(key) || 0;
  if (now - last < WARN_THROTTLE_MS) return;
  _lastWarnAt.set(key, now);
  console.warn(msg);
}

function withTimeout(promise, ms) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`mirror write timed out after ${ms}ms`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

// Two calling conventions share this one `data` param, distinguished by
// whether `data` already contains the id column:
//   - doc-style tables (id, company_id?, data JSON, ...): pass the raw JS
//     payload as `data` — it does NOT contain `idColumn` — and this builds
//     the row as { [idColumn]: id, data }. (company_id/other indexed
//     columns aren't set this way; mirror is write-only/not a read source
//     yet, so that's acceptable for now — a future enhancement can pass a
//     pre-built row the same way flat tables do.)
//   - flat-column tables (users, assignments, ...): pass the COMPLETE row
//     object you already build for the existing `useMySQL()` branch as
//     `data` — since it contains `idColumn`, it's used as-is, unwrapped.
function buildRow({ id, data, idColumn }) {
  if (data && typeof data === 'object' && !Array.isArray(data) && Object.prototype.hasOwnProperty.call(data, idColumn)) {
    return data;
  }
  return { [idColumn]: id, data };
}

async function runWrite({ table, op, id, data, idColumn = 'id' }) {
  if (op === 'delete') {
    await deleteRow(table, id, idColumn);
  } else {
    // upsertRow (mysql.js) already JSON.stringifies any object-valued column
    // via its internal serializeValue().
    await upsertRow(table, buildRow({ id, data, idColumn }), null);
  }
}

// ── persistent retry queue (JSON-lines file) ─────────────────────────────────
function appendToQueue(entry) {
  try {
    fs.mkdirSync(path.dirname(QUEUE_FILE), { recursive: true });
    fs.appendFileSync(QUEUE_FILE, JSON.stringify(entry) + '\n');
  } catch (e) {
    // Last-ditch: if we can't even persist the retry, log and drop — a
    // mirror write must never throw out to the caller.
    warnOnce('queue-write-failed', `[mysqlMirror] failed to persist retry entry: ${e.message}`);
  }
}

function readQueueLines() {
  try {
    if (!fs.existsSync(QUEUE_FILE)) return [];
    const raw = fs.readFileSync(QUEUE_FILE, 'utf8');
    return raw
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean)
      .map((l) => {
        try {
          return JSON.parse(l);
        } catch {
          return null;
        }
      })
      .filter(Boolean);
  } catch {
    return [];
  }
}

function writeQueueLines(entries) {
  try {
    fs.mkdirSync(path.dirname(QUEUE_FILE), { recursive: true });
    if (entries.length === 0) {
      // Keep the file absent when empty rather than writing an empty file —
      // mirrorQueueStats()/drain both treat "no file" the same as "empty".
      if (fs.existsSync(QUEUE_FILE)) fs.unlinkSync(QUEUE_FILE);
      return;
    }
    fs.writeFileSync(QUEUE_FILE, entries.map((e) => JSON.stringify(e)).join('\n') + '\n');
  } catch (e) {
    warnOnce('queue-rewrite-failed', `[mysqlMirror] failed to rewrite retry queue: ${e.message}`);
  }
}

function enqueueRetry({ table, op, id, data, idColumn, attempts = 0 }) {
  appendToQueue({ table, op, id, data, idColumn, failedAt: new Date().toISOString(), attempts });
}

// ── mirrorWrite() ─────────────────────────────────────────────────────────────
// Fire-and-forget from the caller's point of view: callers MAY await this
// (it resolves in at most WRITE_TIMEOUT_MS), but it never throws and never
// needs to be awaited for the caller's own request to complete correctly.
export async function mirrorWrite({ table, op = 'upsert', id, data, idColumn = 'id' }) {
  if (!mirrorEnabled()) return; // zero overhead path when MySQL isn't configured
  ensureSweepStarted();
  try {
    await withTimeout(runWrite({ table, op, id, data, idColumn }), WRITE_TIMEOUT_MS);
  } catch (e) {
    warnOnce(`${table}:${op}`, `[mysqlMirror] write failed for ${table}/${id} (queued for retry): ${e.message}`);
    enqueueRetry({ table, op, id, data, idColumn });
  }
}

// ── drainMirrorQueue() ─────────────────────────────────────────────────────────
let _draining = false;
export async function drainMirrorQueue() {
  if (_draining) return { drained: 0, remaining: null, skipped: true };
  if (!mirrorEnabled()) return { drained: 0, remaining: null, skipped: true };
  _draining = true;
  try {
    // Read-then-truncate so entries appended by concurrent mirrorWrite()
    // calls while we're draining land in a fresh file, not in the batch
    // we're about to process.
    const entries = readQueueLines();
    if (entries.length === 0) return { drained: 0, remaining: 0 };
    writeQueueLines([]);

    const survivors = [];
    let drained = 0;
    for (const entry of entries) {
      try {
        await withTimeout(runWrite(entry), WRITE_TIMEOUT_MS);
        drained++;
      } catch (e) {
        const attempts = (entry.attempts || 0) + 1;
        if (attempts >= MAX_ATTEMPTS) {
          console.error(`[mysqlMirror] dropping retry entry for ${entry.table}/${entry.id} after ${attempts} attempts: ${e.message}`);
        } else {
          survivors.push({ ...entry, attempts, failedAt: new Date().toISOString() });
        }
      }
    }
    // Re-merge survivors with anything appended during this drain.
    const appendedDuringDrain = readQueueLines();
    writeQueueLines([...survivors, ...appendedDuringDrain]);
    return { drained, remaining: survivors.length + appendedDuringDrain.length };
  } finally {
    _draining = false;
  }
}

// ── mirrorQueueStats() ─────────────────────────────────────────────────────────
export function mirrorQueueStats() {
  const entries = readQueueLines();
  if (entries.length === 0) return { pending: 0, oldestPendingAt: null };
  let oldest = null;
  for (const e of entries) {
    if (e.failedAt && (!oldest || e.failedAt < oldest)) oldest = e.failedAt;
  }
  return { pending: entries.length, oldestPendingAt: oldest };
}

export const __internal = { QUEUE_FILE };
