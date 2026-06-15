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
