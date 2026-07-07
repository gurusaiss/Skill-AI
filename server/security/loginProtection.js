/**
 * loginProtection.js — Per-account brute-force lockout
 *
 * Tracks failed login attempts by email address.  After MAX_FAILURES consecutive
 * failures the account is locked for LOCKOUT_DURATION_MS.  A successful login
 * resets the counter immediately.
 *
 * Works in-memory (single-instance).  For multi-instance deployments, back this
 * with Redis using the same public API.
 */

const MAX_FAILURES      = 10;                   // lock after this many consecutive failures
const LOCKOUT_DURATION  = 15 * 60 * 1000;       // 15 minutes in ms
const WARNING_THRESHOLD = 5;                    // warn user how many attempts remain after this

const attempts = new Map(); // email (lower-cased) → { count: number, lockedUntil: number }

// Prune stale records every 30 minutes
setInterval(() => {
  const now = Date.now();
  for (const [email, rec] of attempts) {
    if (rec.lockedUntil <= now && rec.count < MAX_FAILURES) attempts.delete(email);
  }
}, 30 * 60 * 1000).unref();

function key(email) {
  return (email || '').toLowerCase().trim();
}

/**
 * Returns true if the account is currently locked.
 * Automatically clears an expired lock.
 * @param {string} email
 * @returns {boolean}
 */
export function isLocked(email) {
  const rec = attempts.get(key(email));
  if (!rec) return false;
  if (rec.lockedUntil > Date.now()) return true;
  // Lock has expired — evict so the counter resets cleanly
  attempts.delete(key(email));
  return false;
}

/**
 * Returns remaining lockout time in minutes (0 if not locked).
 * @param {string} email
 * @returns {number}
 */
export function getLockoutMinutes(email) {
  const rec = attempts.get(key(email));
  if (!rec || rec.lockedUntil <= Date.now()) return 0;
  return Math.ceil((rec.lockedUntil - Date.now()) / 60_000);
}

/**
 * Returns number of remaining attempts before lockout.
 * Returns null when not near the threshold.
 * @param {string} email
 * @returns {number|null}
 */
export function remainingAttempts(email) {
  const rec = attempts.get(key(email));
  if (!rec || rec.count < WARNING_THRESHOLD) return null;
  return Math.max(0, MAX_FAILURES - rec.count);
}

/**
 * Record one failed login attempt.  Locks the account when MAX_FAILURES is reached.
 * @param {string} email
 */
export function recordFailure(email) {
  const k = key(email);
  if (!k) return;
  const rec = attempts.get(k) || { count: 0, lockedUntil: 0 };
  rec.count += 1;
  if (rec.count >= MAX_FAILURES) {
    rec.lockedUntil = Date.now() + LOCKOUT_DURATION;
    console.warn(`[loginProtection] Account locked: ${k} after ${rec.count} failures`);
  }
  attempts.set(k, rec);
}

/**
 * Clear the failure record on successful login.
 * @param {string} email
 */
export function clearRecord(email) {
  if (email) attempts.delete(key(email));
}
