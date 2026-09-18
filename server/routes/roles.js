/**
 * roles.js — Role Library (Job Role Master)
 * Company-scoped CRUD + bulk CSV/XLS import for job roles and JDs.
 *
 * Endpoints:
 *   GET    /api/roles              — list roles for company
 *   GET    /api/roles/search       — find by name (for auto-JD in user edit)
 *   GET    /api/roles/:id          — single role
 *   POST   /api/roles              — create role
 *   PUT    /api/roles/:id          — update role
 *   DELETE /api/roles/:id          — delete role
 *   POST   /api/roles/import       — bulk import CSV/XLS/XLSX
 */

import express from 'express';
import multer from 'multer';
import { randomUUID } from 'crypto';
import { createRequire } from 'module';
import { authenticate, requireRole, requirePermission } from '../middleware/auth.js';
import { RoleLibrary, EmployeeChecklists, Assessments, GeneratedContent, QuestionBankVersions, EmployeeAssessmentAssignments } from '../services/DataStore.js';
import { generateQuestionsFromJD, validateQuestionBank, generateQuestionsFromFiles, assessSourceQuality, MIN_SOURCE_CHARS } from '../services/AssessmentGenerator.js';
import UserStore from '../services/UserStore.js';
import GenerationJobs from '../services/GenerationJobs.js';
import { preprocessDocumentText, extractJDCoreContent, removeFilenameFromText } from '../utils/textPreprocessor.js';
import GeminiService from '../services/GeminiService.js';
import { ASSESSMENT_MIX, buildTypeSequence as buildAssessmentTypeSequence, mixCounts } from '../services/QuestionMix.js';

// Use createRequire so CJS packages (pdf-parse, mammoth) load correctly from ESM
const _require = createRequire(import.meta.url);

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

// ── helpers ───────────────────────────────────────────────────────────────────

function parseSkills(raw) {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw.filter(Boolean);
  return String(raw).split(/[,;|]/).map(s => s.trim()).filter(Boolean);
}

// Thin wrapper kept so this file's existing callers need no changes. The
// ratio itself now lives in services/QuestionMix.js — it used to be a fixed
// 50% MCQ / 25% fill / 25% subjective split reimplemented in seven places,
// and is now MCQ-dominant (90/8/2) in exactly one place.
function buildTypeSequence(num) {
  return buildAssessmentTypeSequence(num, ASSESSMENT_MIX);
}

// Build the per-file source list used by generateQuestionsFromFiles.
// Combines jdFiles + supportingFiles stored on the role document.
function buildFileSources(role) {
  const validJdFiles = (role.jdFiles || []).filter(f => f.text?.trim());
  const validSupportingFiles = (role.supportingFiles || []).filter(f => f.text?.trim());
  const totalFileCount = validJdFiles.length + validSupportingFiles.length;
  // Default per-file count when the admin didn't explicitly configure one:
  // an even share of a 50-question pool across all uploaded files (min 10
  // each), not a flat 5. A flat 5-per-file default meant a role with 2-3
  // files never reached anywhere near "50 questions by default," starving
  // regeneration/randomization of enough distinct content to draw from.
  // Files WITH an explicit questionCount are completely unaffected.
  const defaultPerFile = totalFileCount > 0 ? Math.max(10, Math.floor(50 / totalFileCount)) : 10;

  // Questions cite their source by the admin's friendly label when one is set
  // ("File 2 — Ops SOP v3"), falling back to the raw filename otherwise.
  const sourceName = (f, i) => {
    const position = `File ${i + 1}`;
    const label = (f.label || '').trim();
    return label ? `${position} — ${label}` : (f.name || position);
  };

  const sources = [];
  validJdFiles.forEach((f, i) => {
    sources.push({ name: sourceName(f, i), fileName: f.name, text: f.text, questionCount: parseInt(f.questionCount) || defaultPerFile, sourceType: 'jd', jobRole: role.roleName, skills: role.skills || [], stakeholder: !!f.stakeholder, processDelivery: !!f.processDelivery });
  });
  validSupportingFiles.forEach((f, i) => {
    sources.push({ name: sourceName(f, i), fileName: f.name, text: f.text, questionCount: parseInt(f.questionCount) || defaultPerFile, sourceType: 'supporting', jobRole: role.roleName, skills: role.skills || [], stakeholder: !!f.stakeholder, processDelivery: !!f.processDelivery });
  });
  return sources;
}

// Total question count requested across all file sources, or `fallback` when no files.
function filesTotalCount(role, fallback = 50) {
  const s = buildFileSources(role);
  return s.length > 0 ? s.reduce((acc, f) => acc + f.questionCount, 0) : fallback;
}

// Scales each source's questionCount by `ratio` and returns sources whose
// counts sum to EXACTLY `exactTotal` — largest-remainder apportionment, not
// independent per-file rounding. Independent `Math.round(count * ratio)` per
// file does not guarantee the sum equals the target (classic apportionment
// problem): e.g. counts 17/17/16 scaled by 0.96 round to 16/16/15 = 47, not
// the intended 48. generateQuestionsFromFiles produces exactly the sum of
// per-file counts, and regenerate-questions hard-aborts if that sum doesn't
// match aiTarget — so an off-by-a-few rounding error here previously made
// every regenerate on an affected role/lock-count fail with a spurious 500.
function apportionCounts(sources, ratio, exactTotal) {
  const scaled = sources.map(s => {
    const raw = Math.max(1, s.questionCount * ratio);
    return { source: s, floor: Math.max(1, Math.floor(raw)), remainder: raw - Math.floor(raw) };
  });
  let sum = scaled.reduce((acc, s) => acc + s.floor, 0);
  let deficit = exactTotal - sum;
  if (deficit > 0) {
    // Give the leftover units to the sources with the largest fractional
    // remainder first (standard largest-remainder / Hamilton apportionment).
    scaled.sort((a, b) => b.remainder - a.remainder);
    for (let i = 0; i < deficit; i++) scaled[i % scaled.length].floor += 1;
  } else if (deficit < 0) {
    // Scaling rounded UP more than needed (can happen since every source is
    // floored to a minimum of 1) — trim from the largest counts first so no
    // source drops below 1.
    scaled.sort((a, b) => b.floor - a.floor);
    let i = 0;
    while (deficit < 0 && i < scaled.length * 4) {
      const s = scaled[i % scaled.length];
      if (s.floor > 1) { s.floor -= 1; deficit += 1; }
      i++;
    }
  }
  return scaled.map(s => ({ ...s.source, questionCount: s.floor }));
}

// Unbiased Fisher-Yates shuffle — replaces the `sort(() => Math.random() - 0.5)`
// pattern used elsewhere in this codebase, which is both statistically biased
// and (in the old assignment code) was being used to resample/subset a bank
// rather than just reorder it. This only ever reorders; it never drops items.
// Shared by both auto-generation triggers (role create, role update with new
// files/JD) — creates a new draft version (never overwrites an existing one).
// If the role is currently LOCKED (has an approved version), this is a
// background job — it must NEVER touch role.questionBank, which is the
// frozen mirror of the locked/live bank employees are assigned from. The
// draft version row is still created silently (harmless prep an admin can
// review later via Regenerate), it's just not surfaced as if it were live.
// For a role that has never been locked yet, mirroring onto
// role.questionBank is still fine — it lets the Role Library UI preview the
// freshly generated bank immediately, before any explicit lock action
// (Issue 7/8: auto-generated banks are never auto-locked).
async function saveAutoGeneratedDraft(roleId, questions, { source } = {}) {
  const bank = questions.map((q, i) => ({ ...q, id: q.id || randomUUID(), order: i }));
  const validation = validateQuestionBank(bank, bank.length, { typeDist: ASSESSMENT_MIX });
  const version = await QuestionBankVersions.create({
    roleId,
    version: await QuestionBankVersions.getNextVersion(roleId),
    questions: bank,
    questionCount: bank.length,
    generationConfig: { source },
    validationReport: validation,
  });
  const approvedVersion = await QuestionBankVersions.getApproved(roleId);
  if (!approvedVersion) {
    await RoleLibrary.update(roleId, {
      questionBank: bank, questionBankGeneratedAt: new Date().toISOString(),
      questionBankCount: bank.length, updatedAt: new Date().toISOString(),
    });
  } else {
    console.log(`[saveAutoGeneratedDraft] Role ${roleId} is locked (v${approvedVersion.version}) — new draft v${version.version} created silently, questionBank mirror left untouched`);
  }
  return { bank, version, validation };
}

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// Distill a raw, possibly noisy JD (with company intro, benefits, legal
// boilerplate, etc.) down to ONLY Role / Responsibilities / Required Skills.
// Falls back to the raw text untouched if the LLM is unavailable or fails —
// this must never block role creation.
async function extractJDEssentials(rawText, roleName) {
  const text = (rawText || '').trim();
  if (!text || text.length < 40) return text; // too short to be worth extracting from

  const system = `You extract ONLY the substantive job-relevant content from a job description document. Discard everything else.`;
  const prompt = `From the job description below, extract ONLY:
1. Role / Title (if stated)
2. Responsibilities (bullet list)
3. Required Skills (bullet list)

STRICTLY IGNORE and DO NOT include: company introduction, "about us", benefits, perks, salary, location, legal/equal-opportunity text, application instructions, contact details, headers/footers, or any other unrelated content.

If a section is genuinely absent from the source, omit it — do not invent content.

=== ROLE NAME (context) ===
${roleName || 'Unknown'}

=== SOURCE DOCUMENT ===
${text}

Return ONLY the extracted content as plain text, formatted like:
Role: ...
Responsibilities:
- ...
Required Skills:
- ...`;

  try {
    const extracted = (await GeminiService.generateText(prompt, system))?.trim();
    if (extracted && extracted.length > 20) return extracted;
  } catch (e) {
    console.warn('[extractJDEssentials] LLM extraction failed, storing raw JD:', e.message);
  }
  return text; // graceful fallback — never block role creation on extraction failure
}

function normalise(row) {
  return {
    roleName:        (row.role_name || row.roleName || row.Role || row.title || '').trim(),
    department:      (row.department || row.Department || '').trim(),
    jobDescription:  (row.job_description || row.jobDescription || row.description || row.jd || '').trim(),
    skills:          parseSkills(row.skills || row.Skills || row.skill_list || ''),
    status:          (row.status || 'active').trim().toLowerCase(),
  };
}

async function parseFile(buffer, mimetype, originalname) {
  const ext = originalname?.split('.').pop()?.toLowerCase();
  if (ext === 'csv' || mimetype === 'text/csv' || mimetype === 'application/csv') {
    const text = buffer.toString('utf-8');
    const lines = text.split(/\r?\n/).filter(Boolean);
    if (lines.length < 2) return [];
    const headers = lines[0].split(',').map(h => h.trim().replace(/^"|"$/g, ''));
    return lines.slice(1).map(line => {
      const vals = line.match(/(".*?"|[^,]+|(?<=,)(?=,))/g) || line.split(',');
      const obj = {};
      headers.forEach((h, i) => { obj[h] = (vals[i] || '').replace(/^"|"$/g, '').trim(); });
      return obj;
    });
  }
  // XLS / XLSX
  const { read, utils } = await import('xlsx');
  const wb = read(buffer, { type: 'buffer' });
  const ws = wb.Sheets[wb.SheetNames[0]];
  return utils.sheet_to_json(ws, { defval: '' });
}

// Convert mammoth HTML output to structured plain text preserving headings/bullets/tables
function htmlToStructuredText(html) {
  if (!html) return '';
  return html
    .replace(/<h1[^>]*>/gi, '\n\n# ').replace(/<h2[^>]*>/gi, '\n\n## ').replace(/<h3[^>]*>/gi, '\n\n### ')
    .replace(/<h[456][^>]*>/gi, '\n\n#### ')
    .replace(/<\/h[1-6]>/gi, '\n')
    .replace(/<p[^>]*>/gi, '\n').replace(/<\/p>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<li[^>]*>/gi, '\n• ').replace(/<\/li>/gi, '')
    .replace(/<ul[^>]*>|<\/ul>|<ol[^>]*>|<\/ol>/gi, '\n')
    .replace(/<tr[^>]*>/gi, '\n').replace(/<\/tr>/gi, '')
    .replace(/<td[^>]*>|<th[^>]*>/gi, '\t').replace(/<\/td>|<\/th>/gi, '')
    .replace(/<strong[^>]*>|<b[^>]*>/gi, '**').replace(/<\/strong>|<\/b>/gi, '**')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&nbsp;/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

// Extract plain text from a file buffer — shared by parse-jd and supporting-doc endpoints
// Thrown for uploads that fail for a reason the USER can act on (wrong
// format, scanned/image-only, unsupported legacy format) — distinct from an
// unexpected server error, so the route can return a clear 400 with an
// actionable message instead of a generic 500 (previously every failure here
// landed on the same "Failed to parse file: ..." 500 response regardless of
// cause).
class UnsupportedFileError extends Error {
  constructor(message) { super(message); this.name = 'UnsupportedFileError'; this.statusCode = 400; }
}

const IMAGE_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'gif', 'bmp', 'tiff', 'tif', 'webp', 'heic', 'heif', 'svg']);

// Heuristic: legitimate extracted text should never contain NUL bytes, and
// should have very few other control characters. A buffer that decodes to
// mostly control/null bytes as "UTF-8 text" is actually binary content
// (an unrecognized image format, a corrupt file, etc.) that the catch-all
// text decode silently mangled into garbage rather than genuine text.
function looksLikeBinaryGarbage(buffer) {
  const sample = buffer.subarray(0, Math.min(buffer.length, 8000));
  if (sample.length === 0) return false;
  let nullCount = 0, controlCount = 0;
  for (let i = 0; i < sample.length; i++) {
    const b = sample[i];
    if (b === 0) nullCount++;
    else if (b < 9 || (b > 13 && b < 32)) controlCount++;
  }
  return nullCount > 0 || (controlCount / sample.length) > 0.05;
}

// RFC 4180-style CSV row splitter — handles quoted fields containing commas,
// newlines, and escaped ("") quotes, which the previous catch-all's raw
// `buffer.toString('utf-8')` left as literal unparsed text (usually harmless
// for simple CSVs, but silently wrong for any field with an embedded comma).
function parseCsvRows(text) {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else {
        field += c;
      }
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ',') {
      row.push(field); field = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field); field = '';
      if (row.some(f => f.trim() !== '')) rows.push(row);
      row = [];
    } else {
      field += c;
    }
  }
  if (field !== '' || row.length > 0) { row.push(field); if (row.some(f => f.trim() !== '')) rows.push(row); }
  return rows;
}

// Reformats parsed CSV rows into "Header: Value" blocks per record instead of
// raw comma-separated text — much more legible to the LLM than a flat comma
// soup, especially for wide sheets where positional columns are hard to infer
// without the header context repeated alongside each value.
function parseCsvToStructuredText(text) {
  const rows = parseCsvRows(text);
  if (rows.length === 0) return '';
  const header = rows[0];
  const dataRows = rows.slice(1);
  if (dataRows.length === 0) return header.join(', ');
  return dataRows.map((row, i) => {
    const pairs = header.map((h, colIdx) => `${(h || `Column${colIdx + 1}`).trim()}: ${(row[colIdx] || '').trim()}`).filter(p => !p.endsWith(': '));
    return `Row ${i + 1} — ${pairs.join(' | ')}`;
  }).join('\n');
}

async function extractTextFromBuffer(buffer, originalname) {
  const ext = (originalname?.split('.').pop() || '').toLowerCase();

  if (IMAGE_EXTENSIONS.has(ext)) {
    throw new UnsupportedFileError('This is an image file — text extraction from images (OCR) isn\'t supported yet. Please upload a text-based PDF, DOCX, or paste the content directly.');
  }

  if (ext === 'pdf') {
    const pdfParse = _require('pdf-parse');
    const result = await pdfParse(buffer);
    const text = result.text || '';
    if (!text.trim() && buffer.length > 5000) {
      // A substantial PDF with zero extractable text is almost always a
      // scanned/image-only PDF, not a genuinely empty document.
      throw new UnsupportedFileError('This PDF appears to be scanned/image-based with no extractable text (OCR isn\'t supported yet). Please upload a text-based PDF or DOCX, or paste the content directly.');
    }
    return text;
  }

  if (ext === 'docx') {
    const mammoth = _require('mammoth');
    const result = await mammoth.convertToHtml({ buffer });
    return htmlToStructuredText(result.value || '');
  }

  if (ext === 'doc') {
    const mammoth = _require('mammoth');
    const result = await mammoth.extractRawText({ buffer });
    return result.value || '';
  }

  if (ext === 'pptx' || ext === 'ppt') {
    // PPTX is a ZIP — extract text from ppt/slides/slide*.xml <a:t> tags.
    // Legacy .ppt (pre-2007) is an OLE/CFB binary, NOT a ZIP — AdmZip throws
    // when given one. Catch that specific failure and reject clearly instead
    // of letting it crash through to a generic 500.
    const AdmZip = _require('adm-zip');
    let zip;
    try {
      zip = new AdmZip(buffer);
    } catch (zipErr) {
      if (ext === 'ppt') {
        throw new UnsupportedFileError('Legacy .ppt format isn\'t supported — please save this file as .pptx (PowerPoint 2007+) and re-upload.');
      }
      throw zipErr;
    }
    // Normalize to forward slashes (adm-zip can use backslashes on Windows)
    const normName = e => e.entryName.replace(/\\/g, '/');
    const slideEntries = zip.getEntries().filter(e => /ppt\/slides\/slide\d+\.xml$/i.test(normName(e)));
    slideEntries.sort((a, b) => {
      const na = parseInt(normName(a).match(/slide(\d+)\.xml/i)?.[1] || '0');
      const nb = parseInt(normName(b).match(/slide(\d+)\.xml/i)?.[1] || '0');
      return na - nb;
    });
    const extractXmlText = xml => {
      // Match <a:t> tags — use [\s\S]*? to handle any whitespace/newlines inside the tag
      const matches = xml.match(/<a:t(?:\s[^>]*)?>[\s\S]*?<\/a:t>/g) || [];
      return matches
        .map(m => m.replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'"))
        .filter(t => t.trim())
        .join(' ');
    };
    const slideTexts = slideEntries.map(e => extractXmlText(e.getData().toString('utf-8'))).filter(Boolean);
    // Also grab notes slides if main slides yield nothing
    if (!slideTexts.length) {
      const noteEntries = zip.getEntries().filter(e => /ppt\/notesSlides\//.test(normName(e)) && normName(e).endsWith('.xml'));
      noteEntries.forEach(e => {
        const t = extractXmlText(e.getData().toString('utf-8'));
        if (t) slideTexts.push(t);
      });
    }
    return slideTexts.join('\n\n');
  }

  if (ext === 'xls' || ext === 'xlsx') {
    const { read, utils } = await import('xlsx');
    const wb = read(buffer, { type: 'buffer' });
    return wb.SheetNames.map(name => utils.sheet_to_csv(wb.Sheets[name])).join('\n\n');
  }

  if (ext === 'zip') {
    // Extract text from all supported files inside the ZIP
    const AdmZip = _require('adm-zip');
    const zip = new AdmZip(buffer);
    const parts = [];
    for (const entry of zip.getEntries()) {
      if (entry.isDirectory) continue;
      const baseName = entry.entryName.split('/').pop().split('\\').pop();
      const innerExt = (baseName.split('.').pop() || '').toLowerCase();
      if (!['pdf', 'docx', 'doc', 'pptx', 'txt', 'csv', 'xls', 'xlsx'].includes(innerExt)) continue;
      try {
        const innerText = await extractTextFromBuffer(entry.getData(), baseName);
        if (innerText?.trim()) parts.push(`--- ${entry.entryName} ---\n${innerText.trim()}`);
      } catch (_) { /* skip unreadable entries */ }
    }
    return parts.join('\n\n');
  }

  if (ext === 'csv') {
    return parseCsvToStructuredText(buffer.toString('utf-8'));
  }

  // txt, rtf, and any other/unrecognized extension — treated as plain
  // text. If the raw bytes actually look like binary content (an
  // unrecognized image format, a corrupt/unsupported file), reject clearly
  // instead of silently returning mangled garbage as if it were real text.
  if (looksLikeBinaryGarbage(buffer)) {
    throw new UnsupportedFileError('This file doesn\'t appear to contain readable text (it looks like a binary/image format that isn\'t supported yet). Please upload a text-based PDF, DOCX, or paste the content directly.');
  }
  return buffer.toString('utf-8');
}

// ── POST /api/roles/parse-jd — extract text from uploaded JD or supporting file ─
// Supports: PDF, DOCX, DOC, PPTX, TXT, RTF, CSV, XLS, XLSX, ZIP
// File is processed in-memory and immediately discarded — only extracted text returned
router.post('/parse-jd', authenticate, requireRole('admin', 'manager'), upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ success: false, error: 'No file uploaded' });
    const ext = (req.file.originalname?.split('.').pop() || '').toLowerCase();
    const fileType = req.query.type || req.body.fileType || 'supporting'; // 'jd' or 'supporting'

    let text = await extractTextFromBuffer(req.file.buffer, req.file.originalname);

    // Normalise line endings and collapse excessive blank lines
    text = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
    if (!text) return res.status(400).json({ success: false, error: 'Could not extract text from this file — make sure the file contains readable text' });

    // Remove filename from text (some parsers include it as the first line)
    text = removeFilenameFromText(text, req.file.originalname);

    // Apply document-type-specific preprocessing
    if (fileType === 'jd') {
      // JD: extract only roles/responsibilities/skills; strip everything else
      text = extractJDCoreContent(text);
    } else {
      // Supporting docs: remove headers/footers/metadata, keep all learning content
      text = preprocessDocumentText(text);
    }

    if (!text) return res.status(400).json({ success: false, error: 'Could not extract usable content from this file' });

    // Not an error — a short supporting doc can be perfectly valid alongside a
    // large JD — but flag it at upload time so the admin sees the problem while
    // they're still holding the file, rather than discovering it later as
    // mysteriously generic questions.
    const warning = text.length < MIN_SOURCE_CHARS
      ? `Only ${text.length} characters of text were extracted from this file. That is usually too little to generate specific questions from — check the file isn't a scanned image, or add more detail.`
      : null;

    res.json({ success: true, data: { text, length: text.length, ext, warning, uploadedBy: req.user.userId, uploadedByEmail: req.user.email } });
  } catch (e) {
    // UnsupportedFileError = the user needs to fix their upload (scanned
    // PDF, image, legacy .ppt) — a clear 400 with the actionable message,
    // not a generic 500 implying something broke on our end.
    if (e.statusCode === 400) {
      console.warn('[POST /api/roles/parse-jd] rejected:', e.message);
      return res.status(400).json({ success: false, error: e.message });
    }
    console.error('[POST /api/roles/parse-jd]', e);
    res.status(500).json({ success: false, error: `Failed to parse file: ${e.message}` });
  }
});

// ── GET /api/roles — list ─────────────────────────────────────────────────────
router.get('/', authenticate, requireRole('admin', 'manager'), async (req, res) => {
  try {
    const companyId = req.user.companyId || 'default';
    const roles = await RoleLibrary.getByCompany(companyId);
    const { department, status, q } = req.query;
    let filtered = roles;
    if (department) filtered = filtered.filter(r => r.department?.toLowerCase() === department.toLowerCase());
    if (status)     filtered = filtered.filter(r => r.status === status);
    if (q)          filtered = filtered.filter(r =>
      r.roleName?.toLowerCase().includes(q.toLowerCase()) ||
      r.department?.toLowerCase().includes(q.toLowerCase())
    );
    res.json({ success: true, data: filtered.sort((a, b) => a.roleName?.localeCompare(b.roleName)) });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// ── GET /api/roles/search — find by name (returns first match) ────────────────
router.get('/search', authenticate, async (req, res) => {
  try {
    const { role } = req.query;
    const companyId = req.user.companyId || 'default';
    if (!role) return res.json({ success: true, data: null });
    const match = await RoleLibrary.findByName(role, companyId);
    res.json({ success: true, data: match || null });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// ── GET /api/roles/:id ────────────────────────────────────────────────────────
router.get('/:id', authenticate, async (req, res) => {
  try {
    const role = await RoleLibrary.getById(req.params.id);
    if (!role) return res.status(404).json({ success: false, error: 'Role not found' });
    res.json({ success: true, data: role });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

/**
 * POST /api/roles/:id/generate-overview
 * Admin/Manager: turn the role's plain jobDescription text into a
 * structured overview (responsibilities, required/nice-to-have skills,
 * growth path, a day-in-the-life narrative) — the Job Library previously
 * rendered nothing but the raw JD string, with none of the depth already
 * expected of training-module content. Generated once and persisted on
 * the role (structuredOverview); pass { force: true } to regenerate.
 */
router.post('/:id/generate-overview', authenticate, requireRole('admin', 'manager'), async (req, res) => {
  try {
    const role = await RoleLibrary.getById(req.params.id);
    if (!role) return res.status(404).json({ success: false, error: 'Role not found' });
    if (role.structuredOverview && !req.body?.force) {
      return res.json({ success: true, data: role.structuredOverview, error: null });
    }
    if (!role.jobDescription?.trim()) {
      return res.status(400).json({ success: false, error: 'This role has no job description to generate an overview from' });
    }

    const prompt = `You are a career and org-design expert. Given this job description for the role "${role.roleName}"${role.department ? ` in the ${role.department} department` : ''}, produce a structured overview a training platform can show to employees and candidates.

Job Description:
${role.jobDescription.slice(0, 6000)}

Known skills tagged for this role: ${(role.skills || []).join(', ') || 'none listed'}

Return ONLY valid JSON:
{
  "summary": "2-3 sentence overview of what this role actually does day to day and why it matters to the org",
  "keyResponsibilities": ["4-6 specific, concrete responsibilities — not generic filler"],
  "requiredSkills": ["4-8 skills genuinely required, most important first"],
  "niceToHaveSkills": ["2-4 skills that help but aren't mandatory"],
  "careerGrowthPath": ["2-4 realistic next-role titles someone in this role could grow into, in rough order"],
  "dayInTheLife": "3-4 sentence narrative walking through a typical day or week in this role — specific, not generic"
}`;

    let overview = null;
    try {
      overview = await GeminiService.generateJSON(prompt, 'You are a career and org-design expert. Return only valid JSON, no markdown fences.');
    } catch (e) {
      console.warn('[roles generate-overview] LLM call failed:', e.message);
    }
    if (!overview?.summary) {
      return res.status(502).json({ success: false, error: 'Could not generate an overview right now — try again shortly' });
    }

    overview.generatedAt = new Date().toISOString();
    await RoleLibrary.update(role.id, { structuredOverview: overview });
    res.json({ success: true, data: overview, error: null });
  } catch (e) {
    console.error('[POST /api/roles/:id/generate-overview]', e.message);
    res.status(500).json({ success: false, error: 'Failed to generate role overview' });
  }
});

// ── POST /api/roles — create ──────────────────────────────────────────────────
router.post('/', authenticate, requireRole('admin'), requirePermission('roles.create'), async (req, res) => {
  try {
    const companyId = req.user.companyId || 'default';
    const { roleName, department, jobDescription, skills, status, jdFiles, supportingFiles, jdSources, supportingDocs } = req.body;
    if (!roleName?.trim()) return res.status(400).json({ success: false, error: 'Role name is required' });

    // Prevent EXACT duplicates only — findByName is intentionally fuzzy
    // (used elsewhere for JD/job-title auto-matching) and must not be used
    // here, since "Quality Analyst – IT Infra" and "Quality Analyst – LPO"
    // are legitimately different roles that happen to share words. Scoped by
    // department too — the same title in two different departments is a
    // legitimately distinct role.
    const existing = await RoleLibrary.findExactDuplicate(roleName, companyId, { department });
    if (existing) return res.status(409).json({ success: false, error: `Role "${roleName}"${department ? ` in ${department}` : ''} already exists in your company` });

    // Derive combined JD text: prefer jdFiles content, fall back to plain jobDescription
    const combinedJDText = Array.isArray(jdFiles) && jdFiles.length > 0
      ? jdFiles.map(f => f.text || '').filter(Boolean).join('\n\n')
      : (jobDescription || '').trim();

    const extractedJD = await extractJDEssentials(combinedJDText, roleName);

    const doc = {
      id: randomUUID(),
      companyId,
      roleName:        roleName.trim(),
      department:      (department || '').trim(),
      jobDescription:  extractedJD,
      skills:          parseSkills(skills),
      status:          status || 'active',
      jdFiles:         Array.isArray(jdFiles) ? jdFiles : [],
      supportingFiles: Array.isArray(supportingFiles) ? supportingFiles : [],
      jdSources:       Array.isArray(jdSources) ? jdSources : [],
      supportingDocs:  Array.isArray(supportingDocs) ? supportingDocs : [],
      createdAt:       new Date().toISOString(),
      updatedAt:       new Date().toISOString(),
      createdBy:       req.user.userId,
    };
    const saved = await RoleLibrary.create(doc);
    res.status(201).json({ success: true, data: saved });

    // Auto-generate question bank in background
    const fileSources = buildFileSources(doc);
    const targetCount = filesTotalCount(doc, 50);
    if (doc.jobDescription || fileSources.length > 0) {
      // Register the background run so the UI can poll real progress instead
      // of guessing from an empty question list (see GenerationJobs.js).
      GenerationJobs.start(doc.id, { total: targetCount, source: 'role-create' });
      setImmediate(async () => {
        try {
          const onProgress = (evt) => GenerationJobs.progress(doc.id, evt);
          let questions;
          if (fileSources.length > 0) {
            questions = await generateQuestionsFromFiles(fileSources, {
              jobRole: doc.roleName, skills: doc.skills, seed: `qbank-${doc.id}`,
              onProgress,
            });
          } else {
            questions = await generateQuestionsFromJD({
              jobRole: doc.roleName, jobDescription: doc.jobDescription,
              jdSkills: doc.skills, questionCount: targetCount,
              questionTypes: buildTypeSequence(targetCount),
              employeeSeed: `qbank-${doc.id}-${Date.now()}`,
              supportingDocs: doc.supportingDocs,
              onProgress,
            });
          }
          // Save whatever generation produced, even if it's short of target.
          // The old behavior discarded the ENTIRE bank on any count mismatch
          // ("Wrong count N/M — not saving"), which is why a role could end up
          // with zero questions after a generation run that actually succeeded
          // for most slots: one missing question threw away all the rest, with
          // no user-visible reason. A partial bank is reviewable and
          // regenerable; nothing is a dead end. The exact-count contract is
          // still enforced where it actually matters — at Approve/Lock time,
          // via validateQuestionBank's hard gate.
          if (questions?.length > 0) {
            const { bank, validation } = await saveAutoGeneratedDraft(doc.id, questions, { source: 'role-create' });
            if (bank.length !== targetCount) console.warn(`[auto-qbank] "${doc.roleName}": saved ${bank.length}/${targetCount} questions (short of target — draft saved anyway, regenerate to top up)`);
            if (!validation.passed) console.warn(`[auto-qbank] Validation hard failures for "${doc.roleName}" (draft saved, NOT approved):`, validation.hardFailures);
            console.log(`[auto-qbank] Generated ${bank.length} questions for role "${doc.roleName}"`);
            GenerationJobs.finish(doc.id, { versionId: null, count: bank.length });
          } else {
            console.error(`[auto-qbank] Generation returned no questions for "${doc.roleName}"`);
            GenerationJobs.fail(doc.id, new Error('Generation returned no questions'));
          }
        } catch (e) {
          console.error(`[auto-qbank] Failed for role "${doc.roleName}":`, e.message);
          GenerationJobs.fail(doc.id, e);
        }
      });
    }
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// ── PUT /api/roles/:id/document-text — save edited parsed text for one file ───
router.put('/:id/document-text', authenticate, requireRole('admin', 'manager'), async (req, res) => {
  try {
    const role = await RoleLibrary.getById(req.params.id);
    if (!role) return res.status(404).json({ success: false, error: 'Role not found' });

    const { fileId, text, fileType } = req.body;
    if (!fileId || typeof text !== 'string' || !['jd', 'supporting'].includes(fileType)) {
      return res.status(400).json({ success: false, error: 'fileId, text (string), and fileType (jd|supporting) are required' });
    }

    const trimmed = text.trim();
    const now = new Date().toISOString();
    let updates;

    if (fileType === 'jd') {
      if (!(role.jdFiles || []).some(f => f.id === fileId)) {
        return res.status(404).json({ success: false, error: 'File not found in jdFiles' });
      }
      const jdFiles = role.jdFiles.map(f =>
        f.id === fileId ? { ...f, text: trimmed, chars: trimmed.length, lastUpdatedBy: req.user.userId, lastUpdatedAt: now } : f
      );
      const jobDescription = jdFiles.map(f => f.text).filter(Boolean).join('\n\n');
      updates = { jdFiles, jobDescription, updatedAt: now };
    } else {
      if (!(role.supportingFiles || []).some(f => f.id === fileId)) {
        return res.status(404).json({ success: false, error: 'File not found in supportingFiles' });
      }
      const supportingFiles = role.supportingFiles.map(f =>
        f.id === fileId ? { ...f, text: trimmed, chars: trimmed.length, lastUpdatedBy: req.user.userId, lastUpdatedAt: now } : f
      );
      updates = { supportingFiles, updatedAt: now };
    }

    const updated = await RoleLibrary.update(req.params.id, updates);
    res.json({ success: true, data: updated });
  } catch (e) {
    console.error('[PUT /api/roles/:id/document-text]', e);
    res.status(500).json({ success: false, error: e.message });
  }
});

// ── DELETE /api/roles/:id/documents/:fileId — remove one uploaded file ────────
router.delete('/:id/documents/:fileId', authenticate, requireRole('admin', 'manager'), async (req, res) => {
  try {
    const role = await RoleLibrary.getById(req.params.id);
    if (!role) return res.status(404).json({ success: false, error: 'Role not found' });

    const { fileId } = req.params;
    const now = new Date().toISOString();
    let updates = null;

    if ((role.jdFiles || []).some(f => f.id === fileId)) {
      const jdFiles = role.jdFiles.filter(f => f.id !== fileId);
      const jobDescription = jdFiles.map(f => f.text).filter(Boolean).join('\n\n');
      updates = { jdFiles, jobDescription, updatedAt: now };
    } else if ((role.supportingFiles || []).some(f => f.id === fileId)) {
      const supportingFiles = role.supportingFiles.filter(f => f.id !== fileId);
      updates = { supportingFiles, updatedAt: now };
    } else {
      return res.status(404).json({ success: false, error: 'File not found in this role' });
    }

    const updated = await RoleLibrary.update(req.params.id, updates);
    res.json({ success: true, data: updated });
  } catch (e) {
    console.error('[DELETE /api/roles/:id/documents/:fileId]', e);
    res.status(500).json({ success: false, error: e.message });
  }
});

// ── PUT /api/roles/:id — update ───────────────────────────────────────────────
router.put('/:id', authenticate, requireRole('admin'), requirePermission('roles.edit'), async (req, res) => {
  try {
    const existing = await RoleLibrary.getById(req.params.id);
    if (!existing) return res.status(404).json({ success: false, error: 'Role not found' });

    const { roleName, department, jobDescription, skills, status, jdFiles, supportingFiles, jdSources, supportingDocs } = req.body;

    // Renaming a role (or moving it to a different department) had NO
    // duplicate check at all — could silently create a second role with the
    // same company+department+name as an existing one. Only check when the
    // name or department is actually changing.
    if (roleName !== undefined || department !== undefined) {
      const checkName = roleName !== undefined ? roleName : existing.roleName;
      const checkDept = department !== undefined ? department : existing.department;
      const dupe = await RoleLibrary.findExactDuplicate(checkName, existing.companyId || 'default', { department: checkDept, excludeId: existing.id });
      if (dupe) return res.status(409).json({ success: false, error: `Role "${checkName}"${checkDept ? ` in ${checkDept}` : ''} already exists in your company` });
    }

    // Derive combined JD text from jdFiles when provided
    let rawJDForExtract = jobDescription;
    if (Array.isArray(jdFiles) && jdFiles.length > 0) {
      rawJDForExtract = jdFiles.map(f => f.text || '').filter(Boolean).join('\n\n');
    }
    const extractedJD = rawJDForExtract !== undefined ? await extractJDEssentials((rawJDForExtract || '').trim(), roleName || existing.roleName) : undefined;

    const updates = {
      ...(roleName         !== undefined && { roleName: roleName.trim() }),
      ...(department       !== undefined && { department: department.trim() }),
      ...(rawJDForExtract  !== undefined && { jobDescription: extractedJD }),
      ...(skills           !== undefined && { skills: parseSkills(skills) }),
      ...(status           !== undefined && { status }),
      ...(jdFiles          !== undefined && { jdFiles: Array.isArray(jdFiles) ? jdFiles : [] }),
      ...(supportingFiles  !== undefined && { supportingFiles: Array.isArray(supportingFiles) ? supportingFiles : [] }),
      ...(jdSources        !== undefined && { jdSources: Array.isArray(jdSources) ? jdSources : [] }),
      ...(supportingDocs   !== undefined && { supportingDocs: Array.isArray(supportingDocs) ? supportingDocs : [] }),
      updatedAt: new Date().toISOString(),
    };
    const updated = await RoleLibrary.update(req.params.id, updates);
    res.json({ success: true, data: updated });

    // Regenerate when JD text, jdFiles, or supportingFiles changed
    const jdChanged   = extractedJD !== undefined && extractedJD !== existing.jobDescription;
    const filesChanged = jdFiles !== undefined || supportingFiles !== undefined;
    if (jdChanged || filesChanged) {
      const mergedRole = { ...existing, ...updates };
      const fileSources  = buildFileSources(mergedRole);
      const targetCount  = filesTotalCount(mergedRole, 50);
      const effectiveJD  = mergedRole.jobDescription;
      const effectiveRole = mergedRole.roleName;
      const effectiveSkills = mergedRole.skills || [];
      if (effectiveJD || fileSources.length > 0) {
        GenerationJobs.start(req.params.id, { total: targetCount, source: 'role-update' });
        setImmediate(async () => {
          try {
            const onProgress = (evt) => GenerationJobs.progress(req.params.id, evt);
            let questions;
            if (fileSources.length > 0) {
              questions = await generateQuestionsFromFiles(fileSources, {
                jobRole: effectiveRole, skills: effectiveSkills, seed: `qbank-${req.params.id}-upd`,
                onProgress,
              });
            } else {
              questions = await generateQuestionsFromJD({
                jobRole: effectiveRole, jobDescription: effectiveJD,
                jdSkills: effectiveSkills, questionCount: targetCount,
                questionTypes: buildTypeSequence(targetCount),
                employeeSeed: `qbank-${req.params.id}-upd-${Date.now()}`,
                supportingDocs: mergedRole.supportingDocs || [],
                onProgress,
              });
            }
            // Save partial results rather than discarding everything on a
            // count mismatch — see the role-create path for the full rationale.
            if (questions?.length > 0) {
              const { bank, validation } = await saveAutoGeneratedDraft(req.params.id, questions, { source: 'role-update' });
              if (bank.length !== targetCount) console.warn(`[auto-qbank] "${effectiveRole}": saved ${bank.length}/${targetCount} (short of target — draft saved anyway)`);
              if (!validation.passed) console.warn(`[auto-qbank] Validation hard failures for "${effectiveRole}" (draft saved, NOT approved):`, validation.hardFailures);
              console.log(`[auto-qbank] Regenerated ${bank.length} questions for role "${effectiveRole}" (files updated)`);
              GenerationJobs.finish(req.params.id, { count: bank.length });
            } else {
              console.error(`[auto-qbank] Generation returned no questions for "${effectiveRole}"`);
              GenerationJobs.fail(req.params.id, new Error('Generation returned no questions'));
            }
          } catch (e) {
            console.error(`[auto-qbank] Failed regen for role "${effectiveRole}":`, e.message);
            GenerationJobs.fail(req.params.id, e);
          }
        });
      }
    }
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// ── DELETE /api/roles/:id ─────────────────────────────────────────────────────
router.delete('/:id', authenticate, requireRole('admin'), requirePermission('roles.edit'), async (req, res) => {
  try {
    const existing = await RoleLibrary.getById(req.params.id);
    if (!existing) return res.status(404).json({ success: false, error: 'Role not found' });
    await RoleLibrary.delete(req.params.id);
    res.json({ success: true, data: { id: req.params.id } });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// ── POST /api/roles/import — bulk import ──────────────────────────────────────
router.post('/import', authenticate, requireRole('admin'), requirePermission('roles.import'), upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ success: false, error: 'No file uploaded' });
    const companyId = req.user.companyId || 'default';
    const rows = await parseFile(req.file.buffer, req.file.mimetype, req.file.originalname);

    const results = { created: 0, skipped: 0, errors: [] };
    const existing = await RoleLibrary.getByCompany(companyId);
    const existingNames = new Set(existing.map(r => r.roleName?.toLowerCase().trim()));
    const qbankQueue = [];

    for (const raw of rows) {
      const { roleName, department, jobDescription, skills, status } = normalise(raw);
      if (!roleName) { results.errors.push(`Skipped row — missing role name`); continue; }
      if (existingNames.has(roleName.toLowerCase())) { results.skipped++; continue; }

      const doc = {
        id: randomUUID(),
        companyId,
        roleName,
        department,
        jobDescription: await extractJDEssentials(jobDescription, roleName),
        skills,
        status: status || 'active',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        createdBy: req.user.userId,
      };
      await RoleLibrary.create(doc);
      existingNames.add(roleName.toLowerCase());
      results.created++;
      if (doc.jobDescription) qbankQueue.push(doc);
    }

    res.json({ success: true, data: results });

    // Auto-generate question banks sequentially (rate-limit safe)
    if (qbankQueue.length > 0) {
      setImmediate(async () => {
        for (const doc of qbankQueue) {
          try {
            const questions = await generateQuestionsFromJD({
              jobRole: doc.roleName,
              jobDescription: doc.jobDescription,
              jdSkills: doc.skills,
              questionCount: 50,
              questionTypes: buildTypeSequence(50),
              employeeSeed: `qbank-${doc.id}`,
            });
            if (questions?.length) {
              // Routed through the same helper as the other two auto-generation
              // triggers (role create/update) so bulk-imported roles also get a
              // real question_bank_versions row, not just a role.questionBank
              // write with no version history. This role is brand-new in this
              // same request, so it can never already be locked — the mirror
              // write always happens here, same as before.
              const { bank } = await saveAutoGeneratedDraft(doc.id, questions, { source: 'bulk-import' });
              console.log(`[auto-qbank] Generated ${bank.length} questions for imported role "${doc.roleName}"`);
            }
          } catch (err) {
            console.error(`[auto-qbank] Failed for imported role "${doc.roleName}":`, err.message);
          }
        }
      });
    }
  } catch (e) {
    console.error('[POST /api/roles/import]', e);
    res.status(500).json({ success: false, error: e.message });
  }
});

// ── GET /api/roles/:id/skills-gap?userId=xxx ──────────────────────────────────
// Returns required skills vs demonstrated skills for an employee in this role
router.get('/:id/skills-gap', authenticate, async (req, res) => {
  try {
    const role = await RoleLibrary.getById(req.params.id);
    if (!role) return res.status(404).json({ success: false, error: 'Role not found' });
    const required = role.skills || [];
    let demonstrated = [];
    if (req.query.userId) {
      const user = await UserStore.getUserById(req.query.userId);
      demonstrated = user?.jdSkills || [];
    }
    const missing  = required.filter(s => !demonstrated.some(d => d.toLowerCase() === s.toLowerCase()));
    const matched  = required.filter(s =>  demonstrated.some(d => d.toLowerCase() === s.toLowerCase()));
    const coverage = required.length ? Math.round((matched.length / required.length) * 100) : 100;
    res.json({ success: true, data: { required, demonstrated, missing, matched, coverage } });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// ── POST /api/roles/assign-checklist ─────────────────────────────────────────
// Assign onboarding checklist from a role to an employee (called on role assignment)
router.post('/assign-checklist', authenticate, requireRole('admin', 'manager'), async (req, res) => {
  try {
    const { userId, roleId } = req.body;
    if (!userId || !roleId) return res.status(400).json({ success: false, error: 'userId and roleId required' });
    const role = await RoleLibrary.getById(roleId);
    if (!role || !(role.onboardingChecklist || []).length) {
      return res.json({ success: true, data: null, message: 'Role has no checklist template' });
    }
    const items = (role.onboardingChecklist || []).map((item, i) => ({
      id: `${userId}-${i}-${Date.now()}`,
      title: item.title,
      description: item.description || '',
      dueDay: item.dueDay || null,
      completed: false,
      completedAt: null,
    }));
    const checklist = await EmployeeChecklists.upsert(userId, {
      roleId: role.id, roleName: role.roleName, items, assignedAt: new Date().toISOString(),
    });
    res.json({ success: true, data: checklist });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// ── GET /api/roles/checklist/:userId ─────────────────────────────────────────
router.get('/checklist/:userId', authenticate, async (req, res) => {
  try {
    const checklist = await EmployeeChecklists.getByUserId(req.params.userId);
    res.json({ success: true, data: checklist });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// ── PUT /api/roles/checklist/:userId/item/:itemId ─────────────────────────────
router.put('/checklist/:userId/item/:itemId', authenticate, async (req, res) => {
  try {
    const { completed } = req.body;
    const updated = await EmployeeChecklists.updateItem(req.params.userId, req.params.itemId, {
      completed: !!completed,
      completedAt: completed ? new Date().toISOString() : null,
    });
    res.json({ success: true, data: updated });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// ── POST /api/roles/:id/generate-assessment ───────────────────────────────────
// Generate and store a pre-assessment template for a role (admin-triggered bulk prep)
router.post('/:id/generate-assessment', authenticate, requireRole('admin'), requirePermission('questions.generate'), async (req, res) => {
  try {
    const role = await RoleLibrary.getById(req.params.id);
    if (!role) return res.status(404).json({ success: false, error: 'Role not found' });

    // 50 matches the bulk-generate default below; the old 10 here was part of
    // the platform-wide "everyone gets 10 questions" problem.
    const { questionCount = 50, questionTypes } = req.body;
    const companyId = req.user.companyId || 'default';

    // Prefer the per-file sources (jdFiles/supportingFiles) — the same path
    // regenerate-questions uses. The legacy `supportingDocs` array is only
    // rewritten on a full role save, so it goes stale the moment a file is
    // added or removed individually, which silently starved this endpoint of
    // the role's actual documents.
    const fileSources = buildFileSources(role);
    const sourceQuality = assessSourceQuality(
      fileSources.length > 0 ? fileSources : [{ name: 'Job description', text: role.jobDescription || '' }],
      questionCount
    );
    if (!sourceQuality.ok) {
      return res.status(400).json({ success: false, error: sourceQuality.reason, data: { sourceQuality } });
    }

    const questions = fileSources.length > 0
      ? await generateQuestionsFromFiles(fileSources, {
          jobRole: role.roleName,
          skills:  role.skills || [],
          seed:    `role-${role.id}-${Date.now()}`,
          questionTypes,
        })
      : await generateQuestionsFromJD({
          jobRole:        role.roleName,
          jobDescription: role.jobDescription || '',
          jdSkills:       role.skills || [],
          questionCount,
          questionTypes,
          employeeSeed:   `role-${role.id}-${Date.now()}`,
          supportingDocs: role.supportingDocs || [],
        });

    const assessmentId = randomUUID();
    const assessment = {
      id:             assessmentId,
      title:          `Pre-Assessment Template: ${role.roleName}`,
      roleId:         role.id,
      roleName:       role.roleName,
      targetUsers:    [],
      employeeAssignments: [],
      questionCount:  questions.length,
      questionTypes,
      questions,
      duration:       30,
      createdBy:      req.user.userId,
      companyId,
      isTemplate:     true,
      isAutoGenerated: true,
      createdAt:      new Date().toISOString(),
      updatedAt:      new Date().toISOString(),
      isActive:       true,
    };

    await Assessments.create(assessment);

    // Update role to store the template reference
    await RoleLibrary.update(role.id, {
      assessmentTemplateId: assessmentId,
      assessmentGeneratedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    await GeneratedContent.create({
      id:          randomUUID(),
      type:        'assessment_template',
      contentId:   assessmentId,
      roleId:      role.id,
      roleName:    role.roleName,
      companyId,
      status:      'active',
      generatedAt: new Date().toISOString(),
      trigger:     'admin_bulk_generate',
    });

    res.json({ success: true, data: { assessmentId, questions: questions.length, roleName: role.roleName } });
  } catch (e) {
    console.error('[POST /api/roles/:id/generate-assessment]', e);
    res.status(500).json({ success: false, error: e.message });
  }
});

// ── POST /api/roles/bulk-generate-assessments ─────────────────────────────────
// Generate assessment templates for ALL roles in company (admin bulk action)
router.post('/bulk-generate-assessments', authenticate, requireRole('admin'), requirePermission('questions.generate'), async (req, res) => {
  try {
    const companyId = req.user.companyId || 'default';
    const roles = await RoleLibrary.getByCompany(companyId);
    const activeRoles = roles.filter(r => r.status !== 'inactive' && !r.assessmentTemplateId);
    // Match the single-role generate-assessment endpoint's default (50) and
    // allow the caller to override it — this used to hardcode 10 with no way
    // to configure it, so every role bulk-generated through this endpoint
    // started life capped at 10 questions regardless of the platform's real
    // target assessment size.
    // A flat 3-element array here was the trigger for the generator's
    // round-robin padding, which produced ~33/33/33 regardless of intent.
    // A full-length sequence expresses the real target ratio instead.
    const { questionCount = 50 } = req.body;
    const questionTypes = req.body.questionTypes?.length === questionCount
      ? req.body.questionTypes
      : buildTypeSequence(questionCount);

    res.json({ success: true, data: { queued: activeRoles.length, message: 'Generation started in background' } });

    // Generate in background — non-blocking
    setImmediate(async () => {
      let done = 0;
      for (const role of activeRoles) {
        try {
          // Same per-file-source preference as /:id/generate-assessment —
          // `supportingDocs` alone goes stale after individual file changes.
          const bulkFileSources = buildFileSources(role);
          const questions = bulkFileSources.length > 0
            ? await generateQuestionsFromFiles(bulkFileSources, {
                jobRole: role.roleName,
                skills:  role.skills || [],
                seed:    `role-${role.id}-bulk-${Date.now()}`,
                questionTypes,
              })
            : await generateQuestionsFromJD({
                jobRole:        role.roleName,
                jobDescription: role.jobDescription || '',
                jdSkills:       role.skills || [],
                questionCount,
                questionTypes,
                employeeSeed:   `role-${role.id}-bulk-${Date.now()}`,
                supportingDocs: role.supportingDocs || [],
              });

          const assessmentId = randomUUID();
          await Assessments.create({
            id: assessmentId, title: `Pre-Assessment Template: ${role.roleName}`,
            roleId: role.id, roleName: role.roleName, targetUsers: [],
            employeeAssignments: [], questions, questionCount: questions.length,
            questionTypes: ['mcq'], duration: 30, createdBy: req.user.userId,
            companyId, isTemplate: true, isAutoGenerated: true,
            createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), isActive: true,
          });

          await RoleLibrary.update(role.id, {
            assessmentTemplateId: assessmentId,
            assessmentGeneratedAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          });

          done++;
          console.log(`[bulk-generate] ${done}/${activeRoles.length} — ${role.roleName}`);
        } catch (e) {
          console.error(`[bulk-generate] Failed for ${role.roleName}:`, e.message);
        }
      }
      console.log(`[bulk-generate] Complete: ${done}/${activeRoles.length} templates created`);
    });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// Resolves which question set a role's review/edit UI should operate on.
// Locked = has an approved version AND that IS the latest version (no newer
// draft exists yet) — editing is blocked. Otherwise the latest DRAFT version
// is the editable target. Roles with no version rows at all (pre-versioning
// legacy roles, or a brand-new role before its first generation completes)
// fall back to the legacy `role.questionBank` field directly, unchanged from
// prior behavior — this only tightens enforcement for roles that already
// have real version rows.
async function resolveQuestionEditTarget(roleId) {
  const existingVersions = await QuestionBankVersions.getByRole(roleId);
  if (existingVersions.length === 0) return { mode: 'legacy' };
  const latestVersion = existingVersions[existingVersions.length - 1];
  const approvedVersion = existingVersions.find(v => v.status === 'approved');
  const isLocked = !!approvedVersion && latestVersion.id === approvedVersion.id;
  if (isLocked) return { mode: 'locked', version: approvedVersion };
  return { mode: 'draft', version: latestVersion };
}

// ── GET /api/roles/:id/questions — get full question bank ─────────────────────
router.get('/:id/questions', authenticate, requireRole('admin', 'manager'), requirePermission('questions.edit'), async (req, res) => {
  try {
    const role = await RoleLibrary.getById(req.params.id);
    if (!role) return res.status(404).json({ success: false, error: 'Role not found' });
    const target = await resolveQuestionEditTarget(req.params.id);
    if (target.mode === 'legacy') {
      return res.json({ success: true, data: role.questionBank || [], locked: false, meta: { count: (role.questionBank || []).length, generatedAt: role.questionBankGeneratedAt } });
    }
    const questions = target.version.questions || [];
    res.json({
      success: true, data: questions, locked: target.mode === 'locked',
      versionId: target.version.id, version: target.version.version,
      meta: { count: questions.length, generatedAt: target.version.created_at, lockedAt: target.version.approved_at, lockedBy: target.version.approved_by },
    });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// Shared lock-block for the three mutating question-CRUD routes below —
// returns the editable draft version (or 'legacy') if allowed, or writes a
// 409 + audit log and returns null if the role is Locked.
async function requireEditableQuestions(req, res) {
  const role = await RoleLibrary.getById(req.params.id);
  if (!role) { res.status(404).json({ success: false, error: 'Role not found' }); return null; }
  const target = await resolveQuestionEditTarget(req.params.id);
  if (target.mode === 'locked') {
    await UserStore.logAuthEvent('assessment_modification_blocked', req.user.userId, {
      roleId: role.id, roleName: role.roleName, versionId: target.version.id, attemptedMethod: req.method,
    });
    res.status(409).json({ success: false, error: 'Assessment is locked. Click Regenerate to create an editable draft.', locked: true });
    return null;
  }
  return { role, target };
}

// Forces any question that is currently locked=true back to its stored,
// unchanged form regardless of what the client submitted for that id — a
// defense-in-depth guarantee that "locked questions must never change unless
// explicitly unlocked" holds even against a client trying to slip an edit
// through a bulk PUT, not just against the UI disabling the edit button.
function enforceLockedQuestions(storedQuestions, incomingQuestions) {
  const lockedById = new Map((storedQuestions || []).filter(q => q?.locked === true && q?.id).map(q => [q.id, q]));
  if (lockedById.size === 0) return incomingQuestions;
  return incomingQuestions.map(q => (q?.id && lockedById.has(q.id)) ? lockedById.get(q.id) : q);
}

// ── PUT /api/roles/:id/questions — replace entire question bank ───────────────
router.put('/:id/questions', authenticate, requireRole('admin', 'manager'), requirePermission('questions.edit'), async (req, res) => {
  try {
    const ctx = await requireEditableQuestions(req, res);
    if (!ctx) return;
    const { questions } = req.body;
    if (!Array.isArray(questions)) return res.status(400).json({ success: false, error: 'questions must be an array' });
    if (ctx.target.mode === 'draft') {
      const stored = ctx.target.version.questions || [];
      const enforced = enforceLockedQuestions(stored, questions);
      await recordRemovedQuestions(ctx.role, stored, enforced);
      await QuestionBankVersions.updateQuestions(ctx.target.version.id, enforced);
      return res.json({ success: true, data: enforced });
    } else {
      const stored = ctx.role.questionBank || [];
      const enforced = enforceLockedQuestions(stored, questions);
      await recordRemovedQuestions(ctx.role, stored, enforced);
      await RoleLibrary.update(req.params.id, { questionBank: enforced, questionBankCount: enforced.length, updatedAt: new Date().toISOString() });
      return res.json({ success: true, data: enforced });
    }
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// ── POST /api/roles/:id/questions — add single question ──────────────────────
router.post('/:id/questions', authenticate, requireRole('admin', 'manager'), requirePermission('questions.edit'), async (req, res) => {
  try {
    const ctx = await requireEditableQuestions(req, res);
    if (!ctx) return;
    const newQ = {
      id: randomUUID(),
      type: req.body.type || 'mcq',
      question: req.body.question || '',
      difficulty: req.body.difficulty || 'medium',
      options: req.body.options || ['A) ', 'B) ', 'C) ', 'D) '],
      answer: req.body.answer || '',
      explanation: req.body.explanation || '',
      skillArea: req.body.skillArea || 'General',
      isManual: true,
      createdAt: new Date().toISOString(),
    };
    if (ctx.target.mode === 'draft') {
      const qbank = [...(ctx.target.version.questions || []), newQ];
      await QuestionBankVersions.updateQuestions(ctx.target.version.id, qbank);
    } else {
      const qbank = [...(ctx.role.questionBank || []), newQ];
      await RoleLibrary.update(req.params.id, { questionBank: qbank, questionBankCount: qbank.length, updatedAt: new Date().toISOString() });
    }
    res.status(201).json({ success: true, data: newQ });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// ── DELETE /api/roles/:id/questions/:qid — remove one question ───────────────
// A deleted question is a deliberate "never show this again" signal — the
// admin looked at it and rejected it, which is a stronger signal than a
// regenerate simply not reproducing it by chance. Persisted independently of
// the live question bank (which loses all memory of a question the instant
// it's filtered out) so it keeps suppressing that content — and near-dupes of
// it, and its exact option/answer set — across every future regenerate, not
// just until the next version overwrites the bank. Deduped by normalized text
// and capped so a role deleted-into for years doesn't grow this unboundedly;
// oldest entries drop first since the most likely repeat offenders are recent.
const MAX_DELETED_QUESTIONS = 500;
async function recordDeletedQuestion(role, deletedQ) {
  if (!deletedQ?.question) return;
  const signature = {
    question: deletedQ.question,
    options: deletedQ.options || undefined,
    answer: deletedQ.answer || undefined,
    type: deletedQ.type || undefined,
  };
  const existing = Array.isArray(role.deletedQuestions) ? role.deletedQuestions : [];
  const normKey = deletedQ.question.trim().toLowerCase();
  if (existing.some(q => (q.question || '').trim().toLowerCase() === normKey)) return;
  const updated = [...existing, signature].slice(-MAX_DELETED_QUESTIONS);
  await RoleLibrary.update(role.id, { deletedQuestions: updated });
}

// Same "never show this again" guarantee as recordDeletedQuestion, but for
// PUT /:id/questions' bulk-replace path — that endpoint accepts an arbitrary
// full replacement array, so a question present in `stored` but absent from
// `enforced` (the submitted array, after locked-question enforcement) was
// just as deliberately removed as one deleted via the single-question DELETE
// route, and must be recorded the same way or it can silently reappear on a
// later regenerate.
async function recordRemovedQuestions(role, stored, enforced) {
  const keptIds = new Set(enforced.filter(q => q?.id).map(q => q.id));
  const removed = (stored || []).filter(q => q?.id && !keptIds.has(q.id));
  for (const q of removed) await recordDeletedQuestion(role, q);
}

router.delete('/:id/questions/:qid', authenticate, requireRole('admin', 'manager'), requirePermission('questions.edit'), async (req, res) => {
  try {
    const ctx = await requireEditableQuestions(req, res);
    if (!ctx) return;
    const sourceBank = ctx.target.mode === 'draft' ? (ctx.target.version.questions || []) : (ctx.role.questionBank || []);
    const target = sourceBank.find(q => q.id === req.params.qid);
    if (target?.locked === true) {
      return res.status(409).json({ success: false, error: 'This question is locked. Unlock it before deleting.', locked: true });
    }
    if (ctx.target.mode === 'draft') {
      const qbank = sourceBank.filter(q => q.id !== req.params.qid);
      await QuestionBankVersions.updateQuestions(ctx.target.version.id, qbank);
    } else {
      const qbank = sourceBank.filter(q => q.id !== req.params.qid);
      await RoleLibrary.update(req.params.id, { questionBank: qbank, questionBankCount: qbank.length, updatedAt: new Date().toISOString() });
    }
    await recordDeletedQuestion(ctx.role, target);
    res.json({ success: true, data: { id: req.params.qid } });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// Shared implementation for the lock/unlock toggle endpoints below — locking
// or unlocking a question is always allowed (it's editing/deleting a
// question's *content* that a lock should prevent, enforced above), so this
// does NOT go through requireEditableQuestions' whole-draft lock check; it
// only needs the same 'legacy' vs 'draft' resolution to know where to write.
async function setQuestionLock(req, res, locked) {
  try {
    const role = await RoleLibrary.getById(req.params.id);
    if (!role) return res.status(404).json({ success: false, error: 'Role not found' });
    const target = await resolveQuestionEditTarget(req.params.id);
    const sourceBank = target.mode === 'legacy' ? (role.questionBank || []) : (target.version.questions || []);
    const idx = sourceBank.findIndex(q => q.id === req.params.qid);
    if (idx === -1) return res.status(404).json({ success: false, error: 'Question not found' });

    const updated = [...sourceBank];
    updated[idx] = {
      ...updated[idx],
      locked,
      lockedAt: locked ? new Date().toISOString() : null,
      lockedBy: locked ? req.user.userId : null,
    };

    if (target.mode === 'legacy') {
      await RoleLibrary.update(req.params.id, { questionBank: updated, updatedAt: new Date().toISOString() });
    } else {
      await QuestionBankVersions.updateQuestions(target.version.id, updated);
    }

    await UserStore.logAuthEvent(locked ? 'question_locked' : 'question_unlocked', req.user.userId, {
      roleId: role.id, roleName: role.roleName, questionId: req.params.qid,
      versionId: target.mode === 'legacy' ? null : target.version.id,
    });

    res.json({ success: true, data: updated[idx] });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
}

// ── POST /api/roles/:id/questions/:qid/lock — lock one question ──────────────
// Locked questions are preserved byte-identical by regenerate-questions
// (never regenerated, never auto-replaced) until explicitly unlocked. Persists
// in the question's own object (locked/lockedAt/lockedBy), so it survives
// refresh/logout/restart/deployment exactly like every other question field.
router.post('/:id/questions/:qid/lock', authenticate, requireRole('admin', 'manager'), requirePermission('questions.edit'), (req, res) => setQuestionLock(req, res, true));

// ── POST /api/roles/:id/questions/:qid/unlock — unlock one question ──────────
router.post('/:id/questions/:qid/unlock', authenticate, requireRole('admin', 'manager'), requirePermission('questions.edit'), (req, res) => setQuestionLock(req, res, false));

// ── POST /api/roles/:id/regenerate-questions — re-generate question bank ──────
router.post('/:id/regenerate-questions', authenticate, requireRole('admin'), requirePermission('questions.edit'), async (req, res) => {
  try {
    const role = await RoleLibrary.getById(req.params.id);
    if (!role) return res.status(404).json({ success: false, error: 'Role not found' });

    // There is no assessment-level lock gate anymore — locking is per-question
    // (see POST/:id/questions/:qid/lock below). Regeneration is ALWAYS
    // available, unlimited, and never blocked by prior lock/approval state;
    // approved versions are never touched regardless (a regenerate only ever
    // creates a brand-new draft row), so there was never a real safety reason
    // to gate this — only a UX one, which is now handled by simply never
    // touching locked=true questions during regeneration (below).
    const existingVersions = await QuestionBankVersions.getByRole(req.params.id);
    const latestVersion = existingVersions[existingVersions.length - 1];
    const approvedVersion = existingVersions.find(v => v.status === 'approved');

    const { questionCount = 50, mode = 'all', updatedJdFiles, updatedSupportingFiles } = req.body;

    // Apply count updates if admin edited them in the regen panel — persist before generating
    let updatedRole = role;
    if (updatedJdFiles || updatedSupportingFiles) {
      const countUpdates = {};
      if (Array.isArray(updatedJdFiles)) {
        countUpdates.jdFiles = (role.jdFiles || []).map(f => {
          const u = updatedJdFiles.find(x => x.id === f.id);
          if (!u) return f;
          const updated = { ...f, questionCount: Math.max(1, parseInt(u.questionCount) || f.questionCount) };
          if (u.stakeholder !== undefined) updated.stakeholder = !!u.stakeholder;
          if (u.processDelivery !== undefined) updated.processDelivery = !!u.processDelivery;
          return updated;
        });
      }
      if (Array.isArray(updatedSupportingFiles)) {
        countUpdates.supportingFiles = (role.supportingFiles || []).map(f => {
          const u = updatedSupportingFiles.find(x => x.id === f.id);
          if (!u) return f;
          const updated = { ...f, questionCount: Math.max(1, parseInt(u.questionCount) || f.questionCount) };
          if (u.stakeholder !== undefined) updated.stakeholder = !!u.stakeholder;
          if (u.processDelivery !== undefined) updated.processDelivery = !!u.processDelivery;
          return updated;
        });
      }
      await RoleLibrary.update(req.params.id, { ...countUpdates, updatedAt: new Date().toISOString() });
      updatedRole = { ...role, ...countUpdates };
    }

    const fileSources = buildFileSources(updatedRole);
    const hasFiles = fileSources.length > 0;
    if (!hasFiles && !updatedRole.jobDescription) {
      return res.status(400).json({ success: false, error: 'Role has no job description or uploaded files — add a JD first' });
    }

    // Refuse to generate from source text too thin to ground questions in.
    // Without this the generator silently falls back to templated questions
    // and every regeneration produces a different-looking but equally generic
    // bank — the symptom of "regenerated 6 times, still generic".
    const qualitySources = hasFiles
      ? fileSources
      : [{ name: 'Job description', text: updatedRole.jobDescription || '' }];
    const sourceQuality = assessSourceQuality(qualitySources, filesTotalCount(updatedRole, 50));
    if (!sourceQuality.ok) {
      return res.status(400).json({
        success: false,
        error: sourceQuality.reason,
        data: { sourceQuality },
      });
    }

    // Read from the latest known version if one exists (new source of
    // truth), falling back to the legacy role.questionBank field for roles
    // created before versioning existed.
    const existingBank = latestVersion?.questions || role.questionBank || [];

    // Partial regeneration: questions individually marked locked=true (via
    // POST /:id/questions/:qid/lock) are ALWAYS preserved byte-identical,
    // regardless of mode — this is the primary preservation mechanism now,
    // replacing the old assessment-level lock. `ai-only` mode additionally
    // keeps manually-authored (isManual) questions that aren't already
    // locked, unchanged from its prior behavior. Deduped by id so a question
    // that's both locked AND manual isn't counted twice.
    const preservedById = new Map();
    for (const q of existingBank) if (q?.locked === true && q?.id) preservedById.set(q.id, q);
    if (mode === 'ai-only') {
      for (const q of existingBank) if (q?.isManual === true && q?.id && !preservedById.has(q.id)) preservedById.set(q.id, q);
    }
    const manualQuestions = [...preservedById.values()];

    // Cross-version diversity: bounded avoid-set (approved + latest draft
    // only — never full history) fed to the generator so a regenerate
    // rejects near-duplicates of what employees already saw, instead of
    // regenerating near-identical content for content that hasn't changed.
    // Deduped by id in case latest === approved. Includes locked questions
    // too — freshly generated content must not duplicate what's being kept.
    const avoidById = new Map();
    for (const q of (approvedVersion?.questions || [])) if (q?.id) avoidById.set(q.id, q);
    for (const q of (latestVersion?.questions || [])) if (q?.id) avoidById.set(q.id, q);
    // Deliberately-deleted questions must never come back — unlike the
    // approved/latest-version content above, this list survives forever
    // (independent of the live bank), so an admin's "no, not this one"
    // signal stays enforced across every future regenerate, not just until
    // the next version overwrites it. See recordDeletedQuestion above.
    const deletedQuestions = Array.isArray(role.deletedQuestions) ? role.deletedQuestions : [];
    const avoidQuestions = [...(avoidById.size > 0 ? [...avoidById.values()] : existingBank), ...deletedQuestions];

    // Fallback-padding combo high-water-mark from the previous generation, so
    // deterministic template content doesn't reproduce the same (skill,
    // template) pairing every regenerate — see AssessmentGenerator.js's
    // withFinalCombo/startingComboCounters for the full explanation.
    const priorComboCounters = latestVersion?.generationConfig?.finalComboCounters || null;

    const totalTarget = hasFiles ? filesTotalCount(updatedRole) : Math.min(Math.max(parseInt(questionCount) || 50, 5), 200);
    const aiTarget = Math.max(0, totalTarget - manualQuestions.length);

    // Edge case: every slot is already preserved (locked and/or, in ai-only
    // mode, manual) — nothing left to regenerate. Still a legitimate outcome
    // of "unlimited regeneration cycles," not an error — just nothing to do.
    if (aiTarget === 0) {
      return res.json({
        success: true,
        data: { count: manualQuestions.length, questions: manualQuestions },
        message: 'All questions are locked (or manually preserved) — nothing to regenerate.',
        noOp: true,
      });
    }

    // ── Respond IMMEDIATELY, generate in the background ──────────────────
    // Generation on Groq's free tier takes MINUTES (real budget ~8,000 TPM vs
    // ~30,000+ tokens for a full bank), but the client's fetch aborts at 30s
    // (and RETRIES, starting yet another competing generation) and the server
    // kills the response at 90s. A synchronous handler here could therefore
    // never succeed for a real-size bank — the visible bug was "Regenerate
    // All does nothing," with an occasional apparently-random success when an
    // abandoned run finally landed. The client now polls
    // GET /:id/generation-status instead; see GenerationJobs.js.
    const { job, created } = GenerationJobs.start(req.params.id, { total: totalTarget, source: `regenerate:${mode}` });
    if (!created) {
      // A run is already in flight for this role — join it rather than
      // launching a duplicate. This is what stops a retry storm from
      // multiplying rate-limit pressure and starving every run.
      return res.status(202).json({
        success: true,
        data: { jobId: job.jobId, status: job.status, done: job.done, total: job.total, alreadyRunning: true },
        message: 'Generation is already in progress for this role — tracking the existing run.',
      });
    }

    const userId = req.user.userId;
    res.status(202).json({
      success: true,
      data: { jobId: job.jobId, status: 'running', done: 0, total: totalTarget },
      message: 'Generation started. Poll GET /api/roles/:id/generation-status for progress.',
    });

    setImmediate(async () => {
      try {
        const onProgress = (evt) => GenerationJobs.progress(req.params.id, evt);
        let aiQuestions;
        if (hasFiles) {
          let genSources = fileSources;
          // Scale per-file counts proportionally whenever anything is being
          // preserved (locked questions in either mode, or manual questions in
          // ai-only mode) — not just ai-only+manual as before, since locking is
          // now the primary preservation mechanism in BOTH modes.
          if (manualQuestions.length > 0) {
            genSources = apportionCounts(fileSources, aiTarget / totalTarget, aiTarget);
          }
          aiQuestions = await generateQuestionsFromFiles(genSources, {
            jobRole: updatedRole.roleName, skills: updatedRole.skills || [], seed: `qbank-${updatedRole.id}-regen-${Date.now()}`,
            avoidQuestions,
            startingComboCountersBySource: (priorComboCounters && typeof priorComboCounters === 'object' && !('easy' in priorComboCounters)) ? priorComboCounters : {},
            onProgress,
          });
        } else {
          aiQuestions = await generateQuestionsFromJD({
            jobRole: updatedRole.roleName,
            jobDescription: updatedRole.jobDescription,
            jdSkills: updatedRole.skills || [],
            questionCount: aiTarget,
            // Was a 4th inlined copy of the old 50/25/25 math.
            questionTypes: buildTypeSequence(aiTarget),
            employeeSeed: `qbank-${updatedRole.id}-regen-${Date.now()}`,
            supportingDocs: updatedRole.supportingDocs || [],
            avoidQuestions,
            startingComboCounters: (priorComboCounters && 'easy' in priorComboCounters) ? priorComboCounters : null,
            onProgress,
          });
        }

        if (!Array.isArray(aiQuestions) || aiQuestions.length === 0) {
          console.error('[regenerate-questions] Generation returned nothing — existing bank untouched.');
          GenerationJobs.fail(req.params.id, new Error('Question generation returned no questions'));
          return;
        }

        // Captured before any array spreading below — spreading an array into a
        // new one drops non-index own properties like this.
        const finalComboCounters = aiQuestions.finalComboCounters || null;

        // A short count is NO LONGER a hard abort. Previously this threw away
        // the entire generated bank ("aborting, nothing saved") over a single
        // missing question, which is a large part of why regeneration appeared
        // to do nothing at all. A partial draft is reviewable and can be topped
        // up by regenerating again; discarding real work never helps the user.
        // The exact-count contract is still enforced at Approve/Lock time.
        if (aiQuestions.length !== aiTarget) {
          console.warn(`[regenerate-questions] Generated ${aiQuestions.length}/${aiTarget} — saving partial draft anyway (regenerate again to top up).`);
        }

        // Locked (and, in ai-only mode, manual) questions come first, verbatim —
        // their id/locked/lockedAt/lockedBy/isManual fields are preserved exactly
        // as they were; only `order` is reassigned. Freshly generated questions
        // fill the remaining slots.
        const finalQuestions = [...manualQuestions, ...aiQuestions];
        const bank = finalQuestions.map((q, i) => ({ ...q, id: q.id || randomUUID(), order: i }));

        const typeDist = ASSESSMENT_MIX;
        const validation = validateQuestionBank(bank, bank.length, { typeDist });
        // Validation NEVER blocks saving a draft — this is exactly what
        // "unlimited regeneration, must always succeed" requires. A draft is
        // provisional and reviewable. The hard quality gate lives entirely at
        // Approve/version-approve time, where publishing to production is the
        // actual point something should be blockable.
        if (!validation.passed) {
          console.warn(`[regenerate-questions] Validation soft failures (draft saved anyway — gate is at Approve, not here):`, validation.hardFailures);
        }

        // Never overwrite anything in place — every regenerate produces a brand new
        // DRAFT version. It only becomes the bank employees receive once an admin
        // explicitly approves it. This guarantees old approved versions and any
        // assessments/assignments built from them are never touched.
        const version = await QuestionBankVersions.create({
          roleId: req.params.id,
          version: await QuestionBankVersions.getNextVersion(req.params.id),
          questions: bank,
          questionCount: bank.length,
          generationConfig: { questionCount, mode, difficultyDist: { easy: 0.35, medium: 0.45, hard: 0.20 }, typeDist, fileSources: fileSources.map(f => ({ name: f.name, questionCount: f.questionCount, stakeholder: f.stakeholder, processDelivery: f.processDelivery })), finalComboCounters, lockedCount: manualQuestions.filter(q => q.locked === true).length, freshCount: aiQuestions.length },
          validationReport: validation,
        });

        // Mirror generation timestamp on the role for legacy UI reads, without
        // touching the legacy `questionBank` field (which still reflects the last
        // *approved* version, not this new draft). questionBankCount IS updated
        // when there's no approved version yet — the RoleLibrary table row's
        // "Approve" button (and the "Questions (N)" badge) gate on this exact
        // field, matching the pattern saveAutoGeneratedDraft already uses. Without
        // this, a role generated/regenerated via this endpoint (as opposed to the
        // role-create/role-update/bulk-import paths that call
        // saveAutoGeneratedDraft) never got a nonzero questionBankCount, so the
        // Approve button stayed hidden even after generation clearly succeeded.
        const roleUpdate = { questionBankGeneratedAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
        if (!approvedVersion) roleUpdate.questionBankCount = bank.length;
        await RoleLibrary.update(req.params.id, roleUpdate);
        await UserStore.logAuthEvent(mode === 'ai-only' ? 'assessment_ai_regenerated' : 'assessment_regenerated', userId, {
          roleId: role.id, roleName: role.roleName, newVersionId: version.id, newVersion: version.version,
          lockedCount: manualQuestions.filter(q => q.locked === true).length, freshCount: aiQuestions.length,
        });

        // Diagnostics the admin can actually act on: how much real source text
        // each file contributed, and how many questions are deterministic
        // template padding rather than content derived from those documents.
        // Without this, a bank that is 100% generic filler looks identical to
        // one fully grounded in the JD.
        const templateFallbackCount = bank.filter(q => q.isTemplateFallback).length;
        const diagnostics = {
          requested: bank.length,
          fromSource: bank.length - templateFallbackCount,
          templateFallback: templateFallbackCount,
          totalSourceChars: sourceQuality.totalChars,
          perFile: sourceQuality.perFile,
        };
        if (templateFallbackCount > 0) {
          console.warn(`[regenerate-questions] "${role.roleName}": ${templateFallbackCount}/${bank.length} questions are generic template padding — source text may be too thin or repetitive`);
        }

        GenerationJobs.finish(req.params.id, { versionId: version.id, count: bank.length, diagnostics });
        console.log(`[regenerate-questions] "${role.roleName}": saved v${version.version} with ${bank.length} questions (${diagnostics.fromSource} from source, ${templateFallbackCount} template)`);
      } catch (e) {
        console.error('[regenerate-questions background]', e);
        GenerationJobs.fail(req.params.id, e);
      }
    });
  } catch (e) {
    console.error('[POST /api/roles/:id/regenerate-questions]', e);
    if (!res.headersSent) res.status(500).json({ success: false, error: e.message });
    GenerationJobs.fail(req.params.id, e);
  }
});

// ── GET /api/roles/:id/generation-status — poll background generation ────────
// Companion to the async generate/regenerate flow above. Returns live job
// progress when a run is in flight, and otherwise reports what's actually
// persisted, so the client can always distinguish "still working" from
// "finished" from "nothing running" without relying on request timing.
router.get('/:id/generation-status', authenticate, requireRole('admin', 'manager'), async (req, res) => {
  try {
    const job = GenerationJobs.get(req.params.id);
    const versions = await QuestionBankVersions.getByRole(req.params.id);
    const latest = versions[versions.length - 1];
    const savedCount = latest?.questions?.length || 0;

    res.json({
      success: true,
      data: {
        status: job?.status || (savedCount > 0 ? 'done' : 'idle'),
        done: job?.done ?? savedCount,
        total: job?.total ?? savedCount,
        phase: job?.phase || null,
        throttleMs: job?.throttleMs || 0,
        error: job?.error || null,
        startedAt: job?.startedAt || null,
        savedCount,
        latestVersionId: latest?.id || null,
        diagnostics: job?.diagnostics || null,
      },
    });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// ── POST /api/roles/:id/versions/:versionId/approve — freeze a draft version ──
// The ONLY place a question_bank_versions row transitions to 'approved'. Any
// previously-approved version for this role is archived (never deleted), so
// employees already assigned against it keep resolving correctly.
router.post('/:id/versions/:versionId/approve', authenticate, requireRole('admin'), async (req, res) => {
  try {
    const role = await RoleLibrary.getById(req.params.id);
    if (!role) return res.status(404).json({ success: false, error: 'Role not found' });

    const version = await QuestionBankVersions.getById(req.params.versionId);
    if (!version || version.role_id !== req.params.id) {
      return res.status(404).json({ success: false, error: 'Question bank version not found for this role' });
    }
    if (version.status === 'approved') {
      return res.json({ success: true, data: version, message: 'Version already approved' });
    }
    if (version.validation_report && version.validation_report.passed === false) {
      return res.status(422).json({ success: false, error: 'Cannot approve a version that failed validation', validationReport: version.validation_report });
    }

    const approved = await QuestionBankVersions.approve(req.params.versionId, req.user.userId);

    // Mirror onto the role doc for backward compatibility with any code/UI
    // still reading role.questionBank directly — this is no longer the source
    // of truth for assignment, only a read-model mirror of the approved version.
    await RoleLibrary.update(req.params.id, {
      questionBank: approved.questions,
      questionBankCount: approved.question_count,
      currentApprovedVersionId: approved.id,
      updatedAt: new Date().toISOString(),
    });

    res.json({ success: true, data: approved });
  } catch (e) {
    console.error('[POST /api/roles/:id/versions/:versionId/approve]', e);
    res.status(500).json({ success: false, error: e.message });
  }
});

// ── GET /api/roles/:id/versions — list all question bank versions for a role ──
router.get('/:id/versions', authenticate, requireRole('admin', 'manager'), async (req, res) => {
  try {
    const versions = await QuestionBankVersions.getByRole(req.params.id);
    res.json({ success: true, data: versions });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// ── GET /api/roles/:id/history — regeneration/lock/unlock audit timeline ──────
// Every lock/unlock/regenerate/blocked-modification/question-lock event for
// this role, newest first. Reuses the existing audit-log infrastructure
// (UserStore.logAuthEvent, already called from every relevant action in this
// file) rather than a separate history table — roleId lives in each event's
// metadata, not a dedicated column.
router.get('/:id/history', authenticate, requireRole('admin', 'manager'), async (req, res) => {
  try {
    const role = await RoleLibrary.getById(req.params.id);
    if (!role) return res.status(404).json({ success: false, error: 'Role not found' });
    const logs = await UserStore.getAuditLogs({ roleId: req.params.id });
    res.json({ success: true, data: logs });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// ── GET /api/roles/:id/assignment-history — who was assigned which version ────
// Aggregates every Assessment created for this role (one per approve/lock
// cycle, each tagged fromRoleId + questionBankVersionId) together with its
// employee_assessment_assignments rows, so an admin can see the full
// version-by-version assignment timeline, not just the current live one.
router.get('/:id/assignment-history', authenticate, requireRole('admin', 'manager'), async (req, res) => {
  try {
    const role = await RoleLibrary.getById(req.params.id);
    if (!role) return res.status(404).json({ success: false, error: 'Role not found' });
    const { Assessments: AssessmentsStore } = await import('../services/DataStore.js');
    const allAssessments = await AssessmentsStore.getAll();
    const roleAssessments = (allAssessments || [])
      .filter(a => a.fromRoleId === req.params.id)
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

    const history = await Promise.all(roleAssessments.map(async (a) => {
      const assignments = await EmployeeAssessmentAssignments.getByAssessment(a.id);
      return {
        assessmentId: a.id,
        questionBankVersionId: a.questionBankVersionId || null,
        questionCount: a.questionCount,
        createdAt: a.createdAt,
        employeeCount: assignments.length,
        submittedCount: assignments.filter(r => r.status === 'submitted').length,
        employees: assignments.map(r => ({ userId: r.user_id, status: r.status, assignedAt: r.assigned_at, submittedAt: r.submitted_at })),
      };
    }));

    res.json({ success: true, data: history });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// ── POST /api/roles/:id/approve-assessment — create & auto-assign assessment ──
// ── Shared handler: "Lock Assessment" ──────────────────────────────────────
// Freezes a draft version (or auto-resolves the latest one), assigns it to
// every matching employee, and marks the role Locked. This is the ONLY place
// a version transitions to 'approved' via this route file's employee-facing
// flow (the lower-level /versions/:versionId/approve endpoint below shares
// the same QuestionBankVersions.approve() primitive but doesn't do
// assignment). Registered at both POST /:id/lock (primary, clear enterprise
// naming) and POST /:id/approve-assessment (kept as a backward-compatible
// alias — existing frontend/API consumers of the old name keep working).
async function handleLockAssessment(req, res) {
  try {
    const role = await RoleLibrary.getById(req.params.id);
    if (!role) return res.status(404).json({ success: false, error: 'Role not found' });

    // Resolve the version to lock. An explicit versionId (what the new
    // Lock-Assessment UI passes — the draft the admin just reviewed) is
    // honored first; otherwise auto-resolve the latest draft (created by
    // regenerate-questions) so this endpoint keeps working as a single-click
    // "make this bank live" action. Roles created before versioning existed
    // (legacy role.questionBank with no version rows at all) are migrated
    // in-place by wrapping that bank as version 1.
    let approvedVersion = null;
    if (req.body.versionId) {
      const requested = await QuestionBankVersions.getById(req.body.versionId);
      if (!requested || requested.role_id !== req.params.id) {
        return res.status(404).json({ success: false, error: 'Question bank version not found for this role' });
      }
      if (requested.status === 'approved') {
        approvedVersion = requested; // already locked — idempotent no-op re-lock
      } else {
        if (requested.validation_report && requested.validation_report.passed === false) {
          return res.status(422).json({ success: false, error: 'Cannot lock a version that failed validation', validationReport: requested.validation_report });
        }
        approvedVersion = await QuestionBankVersions.approve(requested.id, req.user.userId);
      }
      await RoleLibrary.update(req.params.id, {
        questionBank: approvedVersion.questions,
        questionBankCount: approvedVersion.question_count,
        currentApprovedVersionId: approvedVersion.id,
      });
    } else {
      approvedVersion = await QuestionBankVersions.getApproved(req.params.id);
    }
    if (!approvedVersion) {
      const versions = await QuestionBankVersions.getByRole(req.params.id);
      let draft = versions[versions.length - 1];
      if (!draft && (role.questionBank || []).length) {
        draft = await QuestionBankVersions.create({
          roleId: req.params.id,
          version: 1,
          questions: role.questionBank,
          questionCount: role.questionBank.length,
          generationConfig: { migratedFromLegacyRole: true },
          validationReport: validateQuestionBank(role.questionBank, role.questionBank.length),
        });
      }
      if (!draft) {
        return res.status(400).json({ success: false, error: 'This role has no question bank. Generate questions first.' });
      }
      approvedVersion = await QuestionBankVersions.approve(draft.id, req.user.userId);
      await RoleLibrary.update(req.params.id, {
        questionBank: approvedVersion.questions,
        questionBankCount: approvedVersion.question_count,
        currentApprovedVersionId: approvedVersion.id,
      });
    }

    const companyId = req.user.companyId || 'default';
    const { assessmentDate, duration = 30 } = req.body;
    const bank = approvedVersion.questions;
    // Every employee gets the FULL approved bank — count is never sampled or
    // subset — only the delivery ORDER is randomized per employee, and even
    // that is resolved at read-time, not baked into stored question content.
    const qCount = bank.length;

    // Find all employees with this job role in this company. Normalized the
    // same way RoleLibrary.findByName's tier-1 match does (case, whitespace,
    // -/_// all collapsed to a single space) — this used to be a bare `===`
    // after only .toLowerCase().trim(), so any employee whose job title had
    // a double space, a hyphen instead of a space, etc. silently failed this
    // exact-match and was permanently skipped by the ONE retroactive
    // assignment path in the app, with no error and no way to retry later.
    const normalizeRoleName = (s) => (s || '').toLowerCase().trim().replace(/[-_/]+/g, ' ').replace(/\s+/g, ' ');
    const targetRoleName = normalizeRoleName(role.roleName);
    const allUsers = await UserStore.getAllUsers({});
    const targets = allUsers.filter(u =>
      (u.role === 'employee' || u.userRole === 'employee') &&
      normalizeRoleName(u.jobRole) === targetRoleName &&
      (u.companyId || 'default') === companyId
    );

    if (targets.length === 0) {
      return res.status(400).json({ success: false, error: `No employees found with job role "${role.roleName}". Assign this role to employees first.` });
    }

    const assignedAt = new Date().toISOString();
    const newAssessment = {
      id: randomUUID(),
      title: `${role.roleName} Assessment`,
      targetUsers: targets.map(u => u.userId || u.id),
      // employeeAssignments no longer embeds question text — it's a thin
      // roster; the actual questions are resolved from
      // employee_assessment_assignments (questionBankVersionId + order) at
      // delivery time (see GET /api/assessments/my).
      employeeAssignments: targets.map(user => ({
        userId: user.userId || user.id,
        userName: user.name,
        userEmail: user.email,
        jobRole: user.jobRole || '',
        status: 'assigned',
        assignedAt,
        startedAt: null,
        submittedAt: null,
        score: null,
        report: null,
      })),
      questionCount: qCount,
      questionTypes: ['mcq', 'fill_blank', 'subjective'],
      difficulty: null,
      assessmentDate: assessmentDate || null,
      deadline: null,
      duration,
      createdBy: req.user.userId,
      companyId,
      createdAt: assignedAt,
      updatedAt: assignedAt,
      isActive: true,
      fromRoleId: role.id,
      questionBankVersionId: approvedVersion.id,
    };

    const { Assessments: AssessmentsStore } = await import('../services/DataStore.js');
    const saved = await AssessmentsStore.create(newAssessment);

    // One assignment row per employee: same version, distinct shuffle order.
    const bankIds = bank.map(q => q.id);
    await EmployeeAssessmentAssignments.bulkCreate(targets.map(user => ({
      assessmentId: newAssessment.id,
      userId: user.userId || user.id,
      questionBankVersionId: approvedVersion.id,
      questionOrder: shuffle(bankIds),
      status: 'assigned',
      assignedAt,
    })));

    console.log(`[lock-assessment] Assigned bank version ${approvedVersion.id} (${qCount}q) for role "${role.roleName}" → ${targets.length} employees`);

    // Persist approval/lock on the role itself — this is the durable state
    // the frontend's row highlight reflects (survives refresh/logout),
    // replacing the old client-only "Assessment Ready" flag that never
    // touched the DB. Field names kept as `approved`/`approvedAt` (not
    // renamed to `locked`) to avoid a data migration — the frontend
    // presents this as "Locked" without any backend field rename.
    const roleApproval = { approved: true, approvedAt: assignedAt, approvedBy: req.user.userId };
    await RoleLibrary.update(role.id, { ...roleApproval, lastApprovedAssessmentId: newAssessment.id, updatedAt: assignedAt });

    await UserStore.logAuthEvent('assessment_locked', req.user.userId, {
      roleId: role.id, roleName: role.roleName, versionId: approvedVersion.id,
      version: approvedVersion.version, questionCount: qCount, employeeCount: targets.length,
    });

    res.status(201).json({ success: true, data: saved || newAssessment, employeeCount: targets.length, roleApproval, locked: true, versionId: approvedVersion.id });
  } catch (e) {
    console.error('[lock-assessment]', e);
    res.status(500).json({ success: false, error: e.message });
  }
}

router.post('/:id/lock', authenticate, requireRole('admin', 'manager'), handleLockAssessment);
router.post('/:id/approve-assessment', authenticate, requireRole('admin', 'manager'), handleLockAssessment);

export default router;
