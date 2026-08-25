/**
 * sanitize.js — lightweight input sanitization helpers
 * Applied at system boundaries (API request handlers) before any data is persisted.
 * React auto-escapes on render, but defense-in-depth applies here too.
 */

/**
 * Strip HTML tags, collapse whitespace, and enforce a max length.
 * Safe for: name, jobRole, department, phone, employeeId, description fields.
 * @param {unknown} value
 * @param {number}  maxLen  — default 500
 * @returns {string}
 */
export function sanitizeText(value, maxLen = 500) {
  if (typeof value !== 'string') return '';
  return value
    .replace(/<[^>]*>/g, ' ')   // strip HTML tags (stored XSS vectors)
    .replace(/[<>]/g, '')        // remove any remaining angle brackets
    .replace(/\s{2,}/g, ' ')     // collapse repeated whitespace
    .trim()
    .slice(0, maxLen);
}

/**
 * Normalise an email address — lowercase, trim, limit length.
 * Does NOT validate format (that's done separately with a regex).
 * @param {unknown} value
 * @returns {string}
 */
export function sanitizeEmail(value) {
  if (typeof value !== 'string') return '';
  return value.toLowerCase().trim().slice(0, 320);
}

/**
 * Sanitize a short identifier (employee ID, access code, etc.).
 * Allows only alphanumeric, dash, underscore — strips everything else.
 * @param {unknown} value
 * @param {number}  maxLen — default 100
 * @returns {string}
 */
export function sanitizeId(value, maxLen = 100) {
  if (typeof value !== 'string') return '';
  return value.replace(/[^a-zA-Z0-9\-_]/g, '').trim().slice(0, maxLen);
}

/**
 * Sanitize a phone number — keep digits, spaces, +, -, (, ) only.
 * @param {unknown} value
 * @returns {string}
 */
export function sanitizePhone(value) {
  if (typeof value !== 'string') return '';
  return value.replace(/[^0-9+\-() ]/g, '').trim().slice(0, 30);
}
