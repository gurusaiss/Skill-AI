/**
 * refreshTokenStore.js — Rotating refresh token registry
 *
 * Each refresh token is a 40-byte random hex string.  Only its SHA-256 hash is
 * stored so that a compromised in-memory dump cannot be replayed.
 *
 * Rotation: every successful `/api/auth/refresh` call issues a NEW token and
 * revokes the old one.  Reuse of an already-rotated token triggers full
 * revocation of all tokens for that user (token-reuse detection).
 *
 * TTL: 30 days.  Expires entries are pruned every 60 minutes.
 */

import crypto from 'crypto';

const REFRESH_TOKEN_TTL = 30 * 24 * 60 * 60 * 1000; // 30 days

// tokenHash → { userId, expiresAt }
const store = new Map();

// Track recently-revoked hashes for a short window so we can detect reuse
const revoked = new Map(); // tokenHash → revokedAt
const REUSE_DETECT_WINDOW = 5 * 60 * 1000; // 5 minutes

setInterval(() => {
  const now = Date.now();
  for (const [h, rec] of store) if (rec.expiresAt <= now) store.delete(h);
  for (const [h, t]   of revoked) if (now - t > REUSE_DETECT_WINDOW) revoked.delete(h);
}, 60 * 60 * 1000).unref();

function sha256(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

/**
 * Generate a fresh refresh token for a user and persist it.
 * @param {string} userId
 * @returns {string} raw refresh token (caller must send to client and store nowhere else)
 */
export function generateRefreshToken(userId) {
  const raw = crypto.randomBytes(40).toString('hex');
  store.set(sha256(raw), { userId, expiresAt: Date.now() + REFRESH_TOKEN_TTL });
  return raw;
}

/**
 * Verify a refresh token.
 * Returns the userId if valid, null otherwise.
 * On reuse of a revoked token, ALL tokens for that user are revoked (breach response).
 * @param {string} raw — the raw token sent by the client
 * @returns {string|null}
 */
export function verifyRefreshToken(raw) {
  if (!raw) return null;
  const h = sha256(raw);

  // Reuse detection — token was already rotated/revoked
  if (revoked.has(h)) {
    const userId = revoked.get(h)?.userId;
    if (userId) {
      console.warn(`[refreshTokenStore] Refresh token reuse detected for user ${userId} — revoking all tokens`);
      revokeAllForUser(userId);
    }
    return null;
  }

  const rec = store.get(h);
  if (!rec) return null;
  if (rec.expiresAt <= Date.now()) {
    store.delete(h);
    return null;
  }
  return rec.userId;
}

/**
 * Revoke a single refresh token (call on logout or after rotation).
 * @param {string} raw
 */
export function revokeRefreshToken(raw) {
  if (!raw) return;
  const h = sha256(raw);
  const rec = store.get(h);
  if (rec) {
    revoked.set(h, { userId: rec.userId, at: Date.now() });
    store.delete(h);
  }
}

/**
 * Revoke ALL refresh tokens for a user.
 * Call on password change, admin lockout, or detected token reuse.
 * @param {string} userId
 */
export function revokeAllForUser(userId) {
  for (const [h, rec] of store) {
    if (rec.userId === userId) {
      revoked.set(h, { userId, at: Date.now() });
      store.delete(h);
    }
  }
}

/** Diagnostic use only. */
export function _storeSize() { return store.size; }
