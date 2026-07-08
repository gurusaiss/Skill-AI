/**
 * fetchJDUrl.js — Fetch and extract text from a public JD URL
 * Supports: Google Drive, Google Docs, OneDrive, Dropbox, direct file URLs
 *
 * All links must be publicly accessible (no login required).
 * Text is extracted once and stored — URL is never re-fetched during assessments.
 */

import { parseJDFile } from './parseJDFile.js';
import { writeFileSync, unlinkSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { randomUUID } from 'crypto';

// ── SSRF protection ────────────────────────────────────────────────────────────
// Cloud-provider hosts we unconditionally trust for file downloads.
const TRUSTED_CLOUD_HOSTS = new Set([
  'drive.usercontent.google.com',
  'docs.google.com',
  'dl.dropboxusercontent.com',
  'www.dropbox.com',
  '1drv.ms',
  'onedrive.live.com',
]);

// Private / loopback IPv4 ranges.
const PRIVATE_IPV4_RE = [
  /^127\./,                               // loopback
  /^10\./,                                // RFC 1918
  /^192\.168\./,                          // RFC 1918
  /^172\.(1[6-9]|2\d|3[01])\./,          // RFC 1918
  /^169\.254\./,                          // link-local / cloud metadata
  /^0\./,                                 // "this" network
  /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./, // CGNAT (RFC 6598)
];

// Hostnames that should never be reachable.
const BLOCKED_HOSTNAMES = new Set([
  'localhost',
  'metadata.google.internal',
  'instance-data',
  '169.254.169.254',  // AWS / Azure / GCP instance-metadata endpoint
]);

/**
 * Throw if `urlString` resolves to a private / internal host.
 * Cloud-provider sources are always allowed.
 * @param {string} urlString
 * @param {string} source — from resolveDownloadUrl()
 */
function assertNotSsrf(urlString, source) {
  // Trusted cloud providers are always safe regardless of domain
  const CLOUD_SOURCES = new Set(['google_drive', 'google_docs', 'google_sheets', 'dropbox', 'onedrive']);
  if (CLOUD_SOURCES.has(source)) return;

  let parsed;
  try {
    parsed = new URL(urlString);
  } catch {
    throw new Error('Invalid URL');
  }

  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    throw new Error(`Unsupported URL protocol: ${parsed.protocol}`);
  }

  const hostname = parsed.hostname.toLowerCase();

  // Block explicit blocked hostnames
  if (BLOCKED_HOSTNAMES.has(hostname)) {
    throw new Error('Access to this URL is not allowed');
  }

  // Block if hostname looks like a private IPv4 address
  if (PRIVATE_IPV4_RE.some(re => re.test(hostname))) {
    throw new Error('Access to internal/private network addresses is not allowed');
  }

  // Block IPv6 loopback / ULA
  if (hostname === '::1' || /^fc[0-9a-f]{2}:/i.test(hostname) || /^fd[0-9a-f]{2}:/i.test(hostname)) {
    throw new Error('Access to internal/private network addresses is not allowed');
  }

  // Must be a domain name or public IP — allow only if not in trusted-cloud set
  // (for any source other than those above, we've already passed all checks)
}

/**
 * Convert a share link to a direct-download URL.
 * Returns the resolved URL and the guessed file extension.
 */
function resolveDownloadUrl(rawUrl) {
  const url = rawUrl.trim();

  // ── Google Drive file share link ─────────────────────────────────────────
  // https://drive.google.com/file/d/{ID}/view  OR  /open?id={ID}
  const driveFile = url.match(/drive\.google\.com\/(?:file\/d\/|open\?id=)([a-zA-Z0-9_-]{10,})/);
  if (driveFile) {
    // confirm=t bypasses the virus-scan confirmation page Google shows for large files
    return {
      downloadUrl: `https://drive.usercontent.google.com/download?id=${driveFile[1]}&export=download&authuser=0&confirm=t`,
      ext: '',           // content-type will tell us
      source: 'google_drive',
    };
  }

  // ── Google Docs (document) ────────────────────────────────────────────────
  const googleDoc = url.match(/docs\.google\.com\/document\/d\/([a-zA-Z0-9_-]{10,})/);
  if (googleDoc) {
    return {
      downloadUrl: `https://docs.google.com/document/d/${googleDoc[1]}/export?format=txt`,
      ext: '.txt',
      source: 'google_docs',
    };
  }

  // ── Google Sheets ─────────────────────────────────────────────────────────
  const googleSheet = url.match(/docs\.google\.com\/spreadsheets\/d\/([a-zA-Z0-9_-]{10,})/);
  if (googleSheet) {
    return {
      downloadUrl: `https://docs.google.com/spreadsheets/d/${googleSheet[1]}/export?format=csv`,
      ext: '.txt',
      source: 'google_sheets',
    };
  }

  // ── Dropbox ───────────────────────────────────────────────────────────────
  // https://www.dropbox.com/s/{HASH}/file.pdf?dl=0  →  dl=1
  if (url.includes('dropbox.com')) {
    const direct = url
      .replace('www.dropbox.com', 'dl.dropboxusercontent.com')
      .replace(/[?&]dl=0/, '')
      .concat(url.includes('?') ? '&dl=1' : '?dl=1');
    return { downloadUrl: direct, ext: '', source: 'dropbox' };
  }

  // ── OneDrive / SharePoint short link ─────────────────────────────────────
  // https://1drv.ms/...  or  https://onedrive.live.com/...
  if (url.includes('1drv.ms') || url.includes('onedrive.live.com') || url.includes('sharepoint.com')) {
    const sep = url.includes('?') ? '&' : '?';
    return {
      downloadUrl: url.includes('download=1') ? url : `${url}${sep}download=1`,
      ext: '',
      source: 'onedrive',
    };
  }

  // ── Direct file URL (ends in known extension) ─────────────────────────────
  const extMatch = url.match(/\.(pdf|docx?|txt|rtf|odt)(\?|#|$)/i);
  return {
    downloadUrl: url,
    ext: extMatch ? `.${extMatch[1].toLowerCase()}` : '',
    source: 'direct',
  };
}

/**
 * Infer file extension from Content-Type header
 */
function extFromContentType(ct = '') {
  if (ct.includes('pdf'))         return '.pdf';
  if (ct.includes('msword'))      return '.doc';
  if (ct.includes('wordprocessingml') || ct.includes('openxmlformats')) return '.docx';
  if (ct.includes('text/plain'))  return '.txt';
  if (ct.includes('rtf'))         return '.rtf';
  return '.txt'; // safe fallback — treat as plain text
}

/**
 * Fetch a public JD URL and extract all text.
 * Returns { text, sourceType, resolvedUrl }
 */
export async function fetchJDFromUrl(rawUrl) {
  const { downloadUrl, ext: hintExt, source } = resolveDownloadUrl(rawUrl);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30_000); // 30s timeout

  // SSRF guard — must run before any network I/O
  assertNotSsrf(downloadUrl, source);

  let response;
  try {
    response = await fetch(downloadUrl, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; SkillForge/1.0)',
        'Accept': 'application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain,*/*',
      },
      redirect: 'follow',
    });
  } finally {
    clearTimeout(timer);
  }

  if (!response.ok) {
    throw new Error(`Could not fetch URL (HTTP ${response.status}). Make sure the link is set to "Anyone with the link can view".`);
  }

  const contentType = response.headers.get('content-type') || '';
  const ext = hintExt || extFromContentType(contentType);

  // If plain text / HTML-ish content, decode directly
  if (ext === '.txt' || contentType.includes('text/')) {
    const text = await response.text();
    // Strip HTML tags if any (Google Docs export sometimes includes minimal HTML)
    const clean = text.replace(/<[^>]+>/g, ' ').replace(/\s{3,}/g, '\n').trim();
    return { text: clean, source };
  }

  // Binary formats — write to a temp file, parse, delete
  const arrayBuffer = await response.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);

  if (buffer.length < 100) {
    throw new Error('Downloaded file appears empty. Check that the link grants public access.');
  }

  const tmpName = `jd-${randomUUID().slice(0, 8)}${ext || '.bin'}`;
  const tmpPath = join(tmpdir(), tmpName);

  try {
    writeFileSync(tmpPath, buffer);
    const text = await parseJDFile(tmpPath, tmpName);
    if (!text || text.length < 30) {
      throw new Error('Could not extract text from this file. Try PDF, DOCX, or TXT format.');
    }
    return { text, source };
  } finally {
    try { unlinkSync(tmpPath); } catch {}
  }
}
