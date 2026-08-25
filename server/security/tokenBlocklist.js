/**
 * tokenBlocklist.js — Server-side JWT revocation registry
 *
 * When a user logs out, their current token is added here so it is rejected on
 * subsequent requests even if it has not yet expired.  The Map is pruned every
 * 15 minutes so stale entries never accumulate.
 *
 * Trade-off: in-memory, so it is cleared on process restart (acceptable for a
 * single-instance deploy on Render free tier). Multi-instance deployments
 * should replace this with a Redis set.
 */

const blocklist = new Map(); // raw token string → expiry timestamp (ms since epoch)

// Prune expired entries every 15 minutes so memory stays bounded
setInterval(() => {
  const now = Date.now();
  for (const [token, exp] of blocklist) {
    if (exp <= now) blocklist.delete(token);
  }
}, 15 * 60 * 1000).unref(); // .unref() so the interval never keeps the process alive

/**
 * Add a token to the blocklist.
 * Automatically reads the `exp` claim from the JWT payload to set the TTL;
 * falls back to a 7-day TTL if decoding fails.
 * @param {string} token — raw JWT string
 */
export function addToBlocklist(token) {
  if (!token) return;
  try {
    // Decode payload without verifying signature (we just need the exp timestamp)
    const parts = token.split('.');
    if (parts.length !== 3) return;
    const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
    const expiresAt = typeof payload.exp === 'number' ? payload.exp * 1000 : Date.now() + 7 * 24 * 60 * 60 * 1000;
    if (expiresAt > Date.now()) {
      blocklist.set(token, expiresAt);
    }
  } catch {
    // Malformed token — add with default 7-day TTL
    blocklist.set(token, Date.now() + 7 * 24 * 60 * 60 * 1000);
  }
}

/**
 * Check whether a token has been explicitly revoked.
 * @param {string} token — raw JWT string
 * @returns {boolean}
 */
export function isBlocklisted(token) {
  if (!token || !blocklist.has(token)) return false;
  const exp = blocklist.get(token);
  if (exp <= Date.now()) {
    blocklist.delete(token); // lazy cleanup
    return false;
  }
  return true;
}

/** Exposed only for testing/monitoring — do not call in production routes. */
export function _blocklistSize() {
  return blocklist.size;
}
