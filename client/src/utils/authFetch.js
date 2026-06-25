/**
 * Shared authFetch utility used by all pages.
 * - 30s timeout per attempt (prevents infinite "Loading...")
 * - Retries up to 2x on network errors (covers Render cold-start)
 * - Returns unwrapped data (data?.data ?? data) matching page expectations
 * - Only throws on HTTP errors (no retry); retries on network failures
 */

const BASE_URL = import.meta.env.VITE_API_URL || (import.meta.env.PROD ? '' : 'http://localhost:3001');

const sleep = ms => new Promise(r => setTimeout(r, ms));

export const authFetch = async (path, options = {}) => {
  const token = localStorage.getItem('auth_token');
  // Don't set Content-Type for FormData — the browser must set it automatically
  // so it includes the multipart boundary. Overriding it breaks file uploads.
  const activeRole = localStorage.getItem('active_role');
  const headers = {
    ...(options.body instanceof FormData ? {} : { 'Content-Type': 'application/json' }),
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...(activeRole ? { 'X-Active-Role': activeRole } : {}),
    ...(options.headers || {}),
  };

  const TIMEOUT_MS = 30000;
  const MAX_NETWORK_RETRIES = 2;
  let lastErr;

  for (let attempt = 0; attempt <= MAX_NETWORK_RETRIES; attempt++) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), TIMEOUT_MS);

    try {
      const res = await fetch(`${BASE_URL}${path}`, {
        ...options,
        headers,
        signal: options.signal ?? controller.signal,
      });

      clearTimeout(timeoutId);

      const text = await res.text();
      let data = null;
      if (text) {
        try {
          data = JSON.parse(text);
        } catch {
          throw new Error(`Server returned non-JSON (${res.status}). Please try again.`);
        }
      }

      if (!res.ok) {
        const msg = typeof data?.error === 'string'
          ? data.error
          : (data?.error?.message || data?.message || `Request failed (${res.status})`);
        // HTTP errors are not retried
        throw new Error(msg);
      }

      return data?.data ?? data;
    } catch (err) {
      clearTimeout(timeoutId);
      lastErr = err;

      const isNetworkError = err.name === 'AbortError'
        || err.name === 'TypeError'
        || err.message.includes('fetch');

      // Retry only network errors, not HTTP errors
      if (!isNetworkError || attempt >= MAX_NETWORK_RETRIES) {
        if (err.name === 'AbortError') {
          throw new Error('Request timed out. The server may be waking up — please try again.');
        }
        throw err;
      }

      await sleep(2000 * (attempt + 1));
    }
  }

  throw lastErr;
};
