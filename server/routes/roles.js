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
import { authenticate, requireRole } from '../middleware/auth.js';
import { RoleLibrary, EmployeeChecklists, Assessments, GeneratedContent } from '../services/DataStore.js';
import { generateQuestionsFromJD, validateQuestionBank, generateQuestionsFromFiles } from '../services/AssessmentGenerator.js';
import UserStore from '../services/UserStore.js';

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

// Build a question-type sequence honoring the platform's fixed 50% MCQ / 25%
// fill-in-the-blank / 25% subjective split. Shared by every question-generation
// trigger (manual regenerate, auto-create, auto-update) so they never drift.
function buildTypeSequence(num) {
  const mcqCount = Math.ceil(num * 0.50);
  const fillCount = Math.round(num * 0.25);
  const subjCount = num - mcqCount - fillCount;
  return [
    ...Array(mcqCount).fill('mcq'),
    ...Array(fillCount).fill('fill_blank'),
    ...Array(subjCount).fill('subjective'),
  ];
}

// Build the per-file source list used by generateQuestionsFromFiles.
// Combines jdFiles + supportingFiles stored on the role document.
function buildFileSources(role) {
  const sources = [];
  for (const f of (role.jdFiles || [])) {
    if (f.text?.trim()) {
      sources.push({ name: f.name, text: f.text, questionCount: parseInt(f.questionCount) || 5, sourceType: 'jd', jobRole: role.roleName, skills: role.skills || [] });
    }
  }
  for (const f of (role.supportingFiles || [])) {
    if (f.text?.trim()) {
      sources.push({ name: f.name, text: f.text, questionCount: parseInt(f.questionCount) || 5, sourceType: 'supporting', jobRole: role.roleName, skills: role.skills || [] });
    }
  }
  return sources;
}

// Total question count requested across all file sources, or `fallback` when no files.
function filesTotalCount(role, fallback = 50) {
  const s = buildFileSources(role);
  return s.length > 0 ? s.reduce((acc, f) => acc + f.questionCount, 0) : fallback;
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
${text.slice(0, 12000)}

Return ONLY the extracted content as plain text, formatted like:
Role: ...
Responsibilities:
- ...
Required Skills:
- ...`;

  try {
    const groqKey = process.env.GROQ_API_KEY;
    if (groqKey?.length > 10) {
      const r = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${groqKey}` },
        body: JSON.stringify({
          model: 'llama-3.3-70b-versatile',
          messages: [{ role: 'system', content: system }, { role: 'user', content: prompt }],
          temperature: 0.2,
          max_tokens: 2000,
        }),
        signal: AbortSignal.timeout(20000),
      });
      if (r.ok) {
        const d = await r.json();
        const extracted = d.choices?.[0]?.message?.content?.trim();
        if (extracted && extracted.length > 20) return extracted;
      }
    }
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
async function extractTextFromBuffer(buffer, originalname) {
  const ext = (originalname?.split('.').pop() || '').toLowerCase();

  if (ext === 'pdf') {
    const pdfParse = _require('pdf-parse');
    const result = await pdfParse(buffer);
    return result.text || '';
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
    // PPTX is a ZIP — extract text from ppt/slides/slide*.xml <a:t> tags
    const AdmZip = _require('adm-zip');
    const zip = new AdmZip(buffer);
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

  // txt, rtf, csv and anything else text-based
  return buffer.toString('utf-8');
}

// ── POST /api/roles/parse-jd — extract text from uploaded JD or supporting file ─
// Supports: PDF, DOCX, DOC, PPTX, TXT, RTF, CSV, XLS, XLSX, ZIP
// File is processed in-memory and immediately discarded — only extracted text returned
router.post('/parse-jd', authenticate, requireRole('admin', 'manager'), upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ success: false, error: 'No file uploaded' });
    const ext = (req.file.originalname?.split('.').pop() || '').toLowerCase();

    let text = await extractTextFromBuffer(req.file.buffer, req.file.originalname);

    // Normalise line endings and collapse excessive blank lines
    text = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
    if (!text) return res.status(400).json({ success: false, error: 'Could not extract text from this file — make sure the file contains readable text' });

    res.json({ success: true, data: { text, length: text.length, ext, uploadedBy: req.user.userId, uploadedByEmail: req.user.email } });
  } catch (e) {
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

// ── POST /api/roles — create ──────────────────────────────────────────────────
router.post('/', authenticate, requireRole('admin'), async (req, res) => {
  try {
    const companyId = req.user.companyId || 'default';
    const { roleName, department, jobDescription, skills, status, jdFiles, supportingFiles, jdSources, supportingDocs } = req.body;
    if (!roleName?.trim()) return res.status(400).json({ success: false, error: 'Role name is required' });

    // Prevent duplicates within company
    const existing = await RoleLibrary.findByName(roleName, companyId);
    if (existing) return res.status(409).json({ success: false, error: `Role "${roleName}" already exists in your company` });

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
      setImmediate(async () => {
        try {
          let questions;
          if (fileSources.length > 0) {
            questions = await generateQuestionsFromFiles(fileSources, {
              jobRole: doc.roleName, skills: doc.skills, seed: `qbank-${doc.id}`,
            });
          } else {
            questions = await generateQuestionsFromJD({
              jobRole: doc.roleName, jobDescription: doc.jobDescription,
              jdSkills: doc.skills, questionCount: targetCount,
              questionTypes: buildTypeSequence(targetCount),
              employeeSeed: `qbank-${doc.id}-${Date.now()}`,
              supportingDocs: doc.supportingDocs,
            });
          }
          if (questions?.length === targetCount) {
            const { valid, errors: ve } = validateQuestionBank(questions, targetCount);
            if (!valid) console.warn(`[auto-qbank] Soft validation warnings for "${doc.roleName}":`, ve);
            const bank = questions.map((q, i) => ({ ...q, id: q.id || randomUUID(), order: i }));
            await RoleLibrary.update(doc.id, {
              questionBank: bank, questionBankGeneratedAt: new Date().toISOString(),
              questionBankCount: bank.length, updatedAt: new Date().toISOString(),
            });
            console.log(`[auto-qbank] Generated ${bank.length} questions for role "${doc.roleName}"`);
          } else {
            console.error(`[auto-qbank] Wrong count ${questions?.length}/${targetCount} for "${doc.roleName}" — not saving`);
          }
        } catch (e) {
          console.error(`[auto-qbank] Failed for role "${doc.roleName}":`, e.message);
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

// ── PUT /api/roles/:id — update ───────────────────────────────────────────────
router.put('/:id', authenticate, requireRole('admin'), async (req, res) => {
  try {
    const existing = await RoleLibrary.getById(req.params.id);
    if (!existing) return res.status(404).json({ success: false, error: 'Role not found' });

    const { roleName, department, jobDescription, skills, status, jdFiles, supportingFiles, jdSources, supportingDocs } = req.body;

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
        setImmediate(async () => {
          try {
            let questions;
            if (fileSources.length > 0) {
              questions = await generateQuestionsFromFiles(fileSources, {
                jobRole: effectiveRole, skills: effectiveSkills, seed: `qbank-${req.params.id}-upd`,
              });
            } else {
              questions = await generateQuestionsFromJD({
                jobRole: effectiveRole, jobDescription: effectiveJD,
                jdSkills: effectiveSkills, questionCount: targetCount,
                questionTypes: buildTypeSequence(targetCount),
                employeeSeed: `qbank-${req.params.id}-upd-${Date.now()}`,
                supportingDocs: mergedRole.supportingDocs || [],
              });
            }
            if (questions?.length === targetCount) {
              const { valid, errors: ve } = validateQuestionBank(questions, targetCount);
              if (!valid) console.warn(`[auto-qbank] Soft validation warnings for "${effectiveRole}" (update):`, ve);
              const bank = questions.map((q, i) => ({ ...q, id: q.id || randomUUID(), order: i }));
              await RoleLibrary.update(req.params.id, {
                questionBank: bank, questionBankGeneratedAt: new Date().toISOString(),
                questionBankCount: bank.length, updatedAt: new Date().toISOString(),
              });
              console.log(`[auto-qbank] Regenerated ${bank.length} questions for role "${effectiveRole}" (files updated)`);
            } else {
              console.error(`[auto-qbank] Wrong count ${questions?.length}/${targetCount} for "${effectiveRole}" — not saving`);
            }
          } catch (e) {
            console.error(`[auto-qbank] Failed regen for role "${effectiveRole}":`, e.message);
          }
        });
      }
    }
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// ── DELETE /api/roles/:id ─────────────────────────────────────────────────────
router.delete('/:id', authenticate, requireRole('admin'), async (req, res) => {
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
router.post('/import', authenticate, requireRole('admin'), upload.single('file'), async (req, res) => {
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
              const bank = questions.map((q, i) => ({ ...q, id: q.id || randomUUID(), order: i }));
              await RoleLibrary.update(doc.id, {
                questionBank: bank,
                questionBankGeneratedAt: new Date().toISOString(),
                questionBankCount: bank.length,
                updatedAt: new Date().toISOString(),
              });
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
router.post('/:id/generate-assessment', authenticate, requireRole('admin'), async (req, res) => {
  try {
    const role = await RoleLibrary.getById(req.params.id);
    if (!role) return res.status(404).json({ success: false, error: 'Role not found' });

    const { questionCount = 10, questionTypes = ['mcq'] } = req.body;
    const companyId = req.user.companyId || 'default';

    const questions = await generateQuestionsFromJD({
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
router.post('/bulk-generate-assessments', authenticate, requireRole('admin'), async (req, res) => {
  try {
    const companyId = req.user.companyId || 'default';
    const roles = await RoleLibrary.getByCompany(companyId);
    const activeRoles = roles.filter(r => r.status !== 'inactive' && !r.assessmentTemplateId);

    res.json({ success: true, data: { queued: activeRoles.length, message: 'Generation started in background' } });

    // Generate in background — non-blocking
    setImmediate(async () => {
      let done = 0;
      for (const role of activeRoles) {
        try {
          const questions = await generateQuestionsFromJD({
            jobRole:        role.roleName,
            jobDescription: role.jobDescription || '',
            jdSkills:       role.skills || [],
            questionCount:  10,
            questionTypes:  ['mcq'],
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

// ── GET /api/roles/:id/questions — get full question bank ─────────────────────
router.get('/:id/questions', authenticate, requireRole('admin', 'manager'), async (req, res) => {
  try {
    const role = await RoleLibrary.getById(req.params.id);
    if (!role) return res.status(404).json({ success: false, error: 'Role not found' });
    res.json({ success: true, data: role.questionBank || [], meta: { count: (role.questionBank || []).length, generatedAt: role.questionBankGeneratedAt } });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// ── PUT /api/roles/:id/questions — replace entire question bank ───────────────
router.put('/:id/questions', authenticate, requireRole('admin', 'manager'), async (req, res) => {
  try {
    const role = await RoleLibrary.getById(req.params.id);
    if (!role) return res.status(404).json({ success: false, error: 'Role not found' });
    const { questions } = req.body;
    if (!Array.isArray(questions)) return res.status(400).json({ success: false, error: 'questions must be an array' });
    await RoleLibrary.update(req.params.id, { questionBank: questions, questionBankCount: questions.length, updatedAt: new Date().toISOString() });
    res.json({ success: true, data: questions });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// ── POST /api/roles/:id/questions — add single question ──────────────────────
router.post('/:id/questions', authenticate, requireRole('admin', 'manager'), async (req, res) => {
  try {
    const role = await RoleLibrary.getById(req.params.id);
    if (!role) return res.status(404).json({ success: false, error: 'Role not found' });
    const qbank = [...(role.questionBank || [])];
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
    qbank.push(newQ);
    await RoleLibrary.update(req.params.id, { questionBank: qbank, questionBankCount: qbank.length, updatedAt: new Date().toISOString() });
    res.status(201).json({ success: true, data: newQ });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// ── DELETE /api/roles/:id/questions/:qid — remove one question ───────────────
router.delete('/:id/questions/:qid', authenticate, requireRole('admin', 'manager'), async (req, res) => {
  try {
    const role = await RoleLibrary.getById(req.params.id);
    if (!role) return res.status(404).json({ success: false, error: 'Role not found' });
    const qbank = (role.questionBank || []).filter(q => q.id !== req.params.qid);
    await RoleLibrary.update(req.params.id, { questionBank: qbank, questionBankCount: qbank.length, updatedAt: new Date().toISOString() });
    res.json({ success: true, data: { id: req.params.qid } });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// ── POST /api/roles/:id/regenerate-questions — re-generate question bank ──────
router.post('/:id/regenerate-questions', authenticate, requireRole('admin'), async (req, res) => {
  try {
    const role = await RoleLibrary.getById(req.params.id);
    if (!role) return res.status(404).json({ success: false, error: 'Role not found' });

    const { questionCount = 50, mode = 'all', updatedJdFiles, updatedSupportingFiles } = req.body;

    // Apply count updates if admin edited them in the regen panel — persist before generating
    let updatedRole = role;
    if (updatedJdFiles || updatedSupportingFiles) {
      const countUpdates = {};
      if (Array.isArray(updatedJdFiles)) {
        countUpdates.jdFiles = (role.jdFiles || []).map(f => {
          const u = updatedJdFiles.find(x => x.id === f.id);
          return u ? { ...f, questionCount: Math.max(1, parseInt(u.questionCount) || f.questionCount) } : f;
        });
      }
      if (Array.isArray(updatedSupportingFiles)) {
        countUpdates.supportingFiles = (role.supportingFiles || []).map(f => {
          const u = updatedSupportingFiles.find(x => x.id === f.id);
          return u ? { ...f, questionCount: Math.max(1, parseInt(u.questionCount) || f.questionCount) } : f;
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

    // Preserve manually edited questions for ai-only mode
    const existingBank = role.questionBank || [];
    const manualQuestions = mode === 'ai-only' ? existingBank.filter(q => q.isManual === true) : [];

    const totalTarget = hasFiles ? filesTotalCount(updatedRole) : Math.min(Math.max(parseInt(questionCount) || 50, 5), 200);
    const aiTarget = mode === 'ai-only' ? Math.max(0, totalTarget - manualQuestions.length) : totalTarget;

    // Edge case: all slots already filled by manual questions
    if (aiTarget === 0) {
      const bank = manualQuestions.slice(0, totalTarget).map((q, i) => ({ ...q, order: i }));
      await RoleLibrary.update(req.params.id, { questionBank: bank, questionBankCount: bank.length, questionBankGeneratedAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
      return res.json({ success: true, data: { count: bank.length, questions: bank } });
    }

    let aiQuestions;
    if (hasFiles) {
      let genSources = fileSources;
      // Scale per-file counts proportionally when preserving manual questions
      if (mode === 'ai-only' && manualQuestions.length > 0) {
        const ratio = aiTarget / totalTarget;
        genSources = fileSources.map(s => ({ ...s, questionCount: Math.max(1, Math.round(s.questionCount * ratio)) }));
      }
      aiQuestions = await generateQuestionsFromFiles(genSources, {
        jobRole: updatedRole.roleName, skills: updatedRole.skills || [], seed: `qbank-${updatedRole.id}-regen-${Date.now()}`,
      });
    } else {
      const mcqCount = Math.ceil(aiTarget * 0.50);
      const fillCount = Math.round(aiTarget * 0.25);
      const subjCount = aiTarget - mcqCount - fillCount;
      aiQuestions = await generateQuestionsFromJD({
        jobRole: updatedRole.roleName,
        jobDescription: updatedRole.jobDescription,
        jdSkills: updatedRole.skills || [],
        questionCount: aiTarget,
        questionTypes: [...Array(mcqCount).fill('mcq'), ...Array(fillCount).fill('fill_blank'), ...Array(subjCount).fill('subjective')],
        employeeSeed: `qbank-${updatedRole.id}-regen-${Date.now()}`,
        supportingDocs: updatedRole.supportingDocs || [],
      });
    }

    if (!Array.isArray(aiQuestions)) {
      return res.status(500).json({ success: false, error: 'Question generation failed. Existing bank preserved.' });
    }

    // Count validation: strict for 'all' mode, lenient for 'ai-only'
    if (mode === 'all' && aiQuestions.length !== aiTarget) {
      console.error(`[regenerate-questions] Generated ${aiQuestions.length}/${aiTarget} — aborting save, existing bank preserved.`);
      return res.status(500).json({ success: false, error: `Question generation returned ${aiQuestions.length} of ${aiTarget} requested questions. Existing question bank was not modified — please retry.` });
    }

    if (mode === 'all') {
      const { valid, errors: valErrors } = validateQuestionBank(aiQuestions, aiTarget);
      if (valid === false) {
        const hardErrors = valErrors.filter(e => e.startsWith('Count:') || (e.startsWith('Question') && e.includes('missing')));
        if (hardErrors.length > 0) {
          console.error(`[regenerate-questions] Validation hard errors — aborting save:`, hardErrors);
          return res.status(500).json({ success: false, error: 'Generated question bank failed validation. Existing bank preserved. Please retry.' });
        }
        console.warn(`[regenerate-questions] Validation soft warnings (proceeding with save):`, valErrors);
      }
    }

    const finalQuestions = mode === 'ai-only' ? [...manualQuestions, ...aiQuestions] : aiQuestions;
    const bank = finalQuestions.map((q, i) => ({ ...q, id: q.id || randomUUID(), order: i }));
    const updated = await RoleLibrary.update(req.params.id, {
      questionBank: bank,
      questionBankGeneratedAt: new Date().toISOString(),
      questionBankCount: bank.length,
      updatedAt: new Date().toISOString(),
    });
    if (!updated) {
      console.error(`[regenerate-questions] RoleLibrary.update returned falsy for role ${req.params.id}`);
      return res.status(500).json({ success: false, error: 'Failed to save regenerated question bank. Please retry.' });
    }
    res.json({ success: true, data: { count: bank.length, questions: bank } });
  } catch (e) {
    console.error('[POST /api/roles/:id/regenerate-questions]', e);
    res.status(500).json({ success: false, error: e.message });
  }
});

// ── POST /api/roles/:id/approve-assessment — create & auto-assign assessment ──
router.post('/:id/approve-assessment', authenticate, requireRole('admin', 'manager'), async (req, res) => {
  try {
    const role = await RoleLibrary.getById(req.params.id);
    if (!role) return res.status(404).json({ success: false, error: 'Role not found' });
    if (!(role.questionBank || []).length) {
      return res.status(400).json({ success: false, error: 'This role has no question bank. Generate questions first.' });
    }

    const companyId = req.user.companyId || 'default';
    const { questionCount = 10, assessmentDate, duration = 30 } = req.body;
    const qCount = Math.min(Math.max(parseInt(questionCount) || 10, 5), role.questionBank.length);

    // Find all employees with this job role in this company
    const allUsers = await UserStore.getAllUsers({});
    const targets = allUsers.filter(u =>
      (u.role === 'employee' || u.userRole === 'employee') &&
      u.jobRole?.toLowerCase().trim() === role.roleName.toLowerCase().trim() &&
      (u.companyId || 'default') === companyId
    );

    if (targets.length === 0) {
      return res.status(400).json({ success: false, error: `No employees found with job role "${role.roleName}". Assign this role to employees first.` });
    }

    // Build per-employee assignments from the question bank (preserve 50% MCQ, 25% fill_blank, 25% subjective)
    const assignedAt = new Date().toISOString();
    const bank = role.questionBank;
    const mcqPool  = bank.filter(q => !q.type || q.type === 'mcq');
    const fillPool = bank.filter(q => q.type === 'fill_blank');
    const subjPool = bank.filter(q => q.type === 'subjective');
    const mcqTarget  = Math.ceil(qCount * 0.50);
    const fillTarget = Math.round(qCount * 0.25);
    const subjTarget = qCount - mcqTarget - fillTarget;
    const pickRandom = (pool, n) => [...pool].sort(() => Math.random() - 0.5).slice(0, n);
    const employeeAssignments = targets.map(user => {
      const mcqs  = pickRandom(mcqPool,  Math.min(mcqTarget, mcqPool.length));
      const fills = pickRandom(fillPool, Math.min(fillTarget, fillPool.length));
      const subjs = pickRandom(subjPool, Math.min(subjTarget, subjPool.length));
      // Fill shortfalls from MCQ pool (most abundant)
      let questions = [...mcqs, ...fills, ...subjs];
      if (questions.length < qCount) {
        const extra = pickRandom(mcqPool.filter(q => !mcqs.includes(q)), qCount - questions.length);
        questions = [...questions, ...extra];
      }
      questions = questions.sort(() => Math.random() - 0.5).slice(0, qCount);
      return {
        userId: user.userId || user.id,
        userName: user.name,
        userEmail: user.email,
        jobRole: user.jobRole || '',
        questions,
        status: 'assigned',
        assignedAt,
        startedAt: null,
        submittedAt: null,
        score: null,
        report: null,
      };
    });

    const newAssessment = {
      id: randomUUID(),
      title: `${role.roleName} Assessment`,
      targetUsers: targets.map(u => u.userId || u.id),
      employeeAssignments,
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
    };

    const { Assessments: AssessmentsStore } = await import('../services/DataStore.js');
    const saved = await AssessmentsStore.create(newAssessment);
    console.log(`[approve-assessment] Created assessment for role "${role.roleName}" → ${targets.length} employees`);

    // Persist approval on the role itself — this is the durable state the
    // frontend's row highlight reflects (survives refresh/logout), replacing
    // the old client-only "Assessment Ready" flag that never touched the DB.
    const roleApproval = { approved: true, approvedAt: assignedAt, approvedBy: req.user.userId };
    await RoleLibrary.update(role.id, { ...roleApproval, lastApprovedAssessmentId: newAssessment.id, updatedAt: assignedAt });

    res.status(201).json({ success: true, data: saved || newAssessment, employeeCount: targets.length, roleApproval });
  } catch (e) {
    console.error('[POST /api/roles/:id/approve-assessment]', e);
    res.status(500).json({ success: false, error: e.message });
  }
});

export default router;
