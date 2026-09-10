/**
 * routes/modules.js
 * Module management routes - fully Supabase integrated
 * pending_modules + module_assignments → DataStore (Supabase / JSON fallback)
 * approved modules → db/store.js (Supabase)
 */

import express from 'express';
import { authenticate, requireRole } from '../middleware/auth.js';
import multer from 'multer';
import * as db from '../db/store.js';
import UserStore from '../services/UserStore.js';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { randomUUID } from 'crypto';
import { PendingModules, ModuleAssignments, Groups } from '../services/DataStore.js';
import GeminiService from '../services/GeminiService.js';
import LLMCache from '../services/LLMCache.js';
import { ensureAllSessionQuizzes } from '../services/SessionQuizGenerator.js';
import { startDeepContentJob, generateSessionContent, hasDeepContent } from '../services/SessionContentGenerator.js';

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 50 * 1024 * 1024 } });

const __moduleDir = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__moduleDir, '../data');

const router = express.Router();

// Tenant scoping: a module with a companyId belongs to that company only.
// Superadmin is global; a module with no companyId is treated as shared/global content.
function canAccessModule(actor, module) {
  if (!actor || !module) return false;
  if (actor.role === 'superadmin') return true;
  if (!module.companyId) return true;
  const actorCompany = actor.companyId || 'default';
  if (actorCompany === 'default') return true;
  return actorCompany === module.companyId;
}

/**
 * GET /api/modules
 * Get all modules (with pagination and filtering) - from Supabase or file fallback
 */
router.get('/', authenticate, async (req, res) => {
  try {
    const { category, difficulty, limit = 50, offset = 0 } = req.query;
    const filters = {};
    if (category) filters.category = category;
    if (difficulty) filters.difficulty = difficulty;

    const allModules = await db.getModules(filters);
    // Company isolation: filter modules by companyId
    const companyId = req.user?.companyId;
    const modules = (companyId && companyId !== 'default')
      ? allModules.filter(m => !m.companyId || m.companyId === companyId)
      : allModules;
    const total = modules.length;
    const paginated = modules.slice(parseInt(offset), parseInt(offset) + parseInt(limit));

    res.json({
      success: true,
      data: {
        modules: paginated,
        total,
        count: paginated.length,
        offset: parseInt(offset),
        limit: parseInt(limit),
      },
    });
  } catch (error) {
    console.error('Error fetching modules:', error);
    res.status(500).json({ success: false, error: { message: 'Failed to fetch modules' } });
  }
});

/**
 * GET /api/modules/pending
 * Admin/Manager: get all pending auto-generated modules awaiting approval
 * NOTE: must be before /:id
 */
router.get('/pending', authenticate, async (req, res) => {
  try {
    if (!['admin', 'manager'].includes(req.user.role)) {
      return res.status(403).json({ success: false, error: { message: 'Admin/Manager only' } });
    }
    const all = await PendingModules.getAll();
    const companyId = req.user?.companyId;
    const pendings = all.filter(p =>
      p.status === 'pending_approval' &&
      (!companyId || companyId === 'default' || !p.companyId || p.companyId === companyId)
    );
    res.json({ success: true, data: pendings, error: null });
  } catch (e) {
    res.status(500).json({ success: false, error: { message: 'Failed to fetch pending modules' } });
  }
});

/**
 * GET /api/modules/my-assignments
 * Employee: get all modules assigned to them (mandatory + optional)
 * NOTE: must be before /:id
 */
router.get('/my-assignments', authenticate, async (req, res) => {
  try {
    const all = await ModuleAssignments.getAll();
    const assignments = all.filter(a => a.userId === req.user.userId);
    const enriched = await Promise.all(assignments.map(async a => {
      const mod = await db.getModuleById(a.moduleId).catch(() => null);
      return { ...a, module: mod };
    }));
    res.json({ success: true, data: enriched, error: null });
  } catch (e) {
    res.status(500).json({ success: false, error: { message: 'Failed to fetch assignments' } });
  }
});

/**
 * GET /api/modules/assignments/all
 * Admin/Manager: all module assignments with progress
 * NOTE: must be before /:id
 */
router.get('/assignments/all', authenticate, async (req, res) => {
  try {
    if (!['admin', 'manager'].includes(req.user.role)) {
      return res.status(403).json({ success: false, error: { message: 'Admin/Manager only' } });
    }
    const assignments = await ModuleAssignments.getAll();
    const companyId = req.user?.companyId || 'default';

    if (companyId === 'default') {
      return res.json({ success: true, data: assignments, error: null });
    }

    const allUsers = await UserStore.getAllUsers({});
    const companyUserIds = new Set(
      allUsers
        .filter(u => (u.companyId || 'default') === companyId)
        .map(u => u.userId || u.id)
    );

    let allowedIds = companyUserIds;

    // Manager: restrict further to group employees only
    if (req.user.role === 'manager') {
      const allGroups = await Groups.getAll();
      const myGroups = allGroups.filter(g =>
        g.managerId === req.user.userId &&
        (g.companyId || 'default') === companyId
      );
      allowedIds = new Set(myGroups.flatMap(g => g.employeeIds || []));
    }

    const filtered = assignments.filter(a => allowedIds.has(a.userId || a.assigned_to_user));
    res.json({ success: true, data: filtered, error: null });
  } catch (e) {
    res.status(500).json({ success: false, error: { message: 'Failed to fetch' } });
  }
});

/**
 * GET /api/modules/:id
 * Get single module by ID (includes full content)
 */
router.get('/:id', authenticate, async (req, res) => {
  try {
    const { id } = req.params;
    let module = await db.getModuleById(id).catch(() => null);

    // Fallback: check pending_modules (auto-generated, awaiting approval)
    if (!module) {
      try {
        const allPending = await PendingModules.getAll();
        const pending = allPending.find(p => p.id === id || p.moduleId === id);
        if (pending?.module) {
          module = {
            id,
            title: pending.module.title,
            description: pending.module.description || '',
            category: pending.module.category || 'Training',
            difficulty: pending.module.difficulty || 'intermediate',
            estimatedDuration: pending.module.estimatedDuration || '5 days',
            skills: pending.module.skills || [],
            sessions: pending.module.sessions || [],
            content: { sessions: pending.module.sessions || [], objectives: pending.module.objectives || [] },
            companyId: pending.companyId || null,
            _isPending: true,
          };
        }
      } catch { /* non-fatal */ }
    }

    if (!module) {
      return res.status(404).json({ success: false, error: { message: 'Module not found' } });
    }
    if (!canAccessModule(req.user, module)) {
      return res.status(403).json({ success: false, error: { message: 'Access denied' } });
    }

    // Self-heal legacy modules created before quizzes were guaranteed at
    // creation time: kick off a non-blocking backfill so the FIRST day an
    // employee opens still has to fall back to a live generation, but every
    // subsequent day (and every other employee on this module) no longer
    // does once this completes and persists — instead of every single day
    // permanently requiring its own live call forever.
    const sessionsToCheck = module.sessions || module.content?.sessions || [];
    const needsBackfill = !module._isPending && sessionsToCheck.some(s => !Array.isArray(s.quiz) || s.quiz.length < 3);
    if (needsBackfill) {
      setImmediate(async () => {
        try {
          const filled = await ensureAllSessionQuizzes(sessionsToCheck, { moduleTitle: module.title, moduleDescription: module.description });
          await db.updateModule(id, { sessions: filled, content: { ...(module.content || {}), sessions: filled } });
        } catch (e) {
          console.warn(`[modules/:id backfill] Failed for module ${id}:`, e.message);
        }
      });
    }

    res.json({ success: true, data: module });
  } catch (error) {
    console.error('Error fetching module:', error);
    res.status(500).json({ success: false, error: { message: 'Failed to fetch module' } });
  }
});

/**
 * POST /api/modules/import
 * Import module from uploaded file or external link (admin/manager/trainer)
 */
router.post('/import', authenticate, requireRole('admin', 'manager', 'trainer'), upload.single('file'), async (req, res) => {
  try {
    const user = req.user;
    let extractedText = '';
    let sessionTitle = '';
    let importedFrom = '';
    let sectionsExtracted = 0;
    let fileType = '';

    if (req.file) {
      // File upload mode
      const mime = req.file.mimetype;
      const origName = req.file.originalname || '';
      const ext = origName.split('.').pop().toLowerCase();
      fileType = ext;
      importedFrom = origName;

      if (mime === 'application/pdf' || ext === 'pdf') {
        try {
          const pdfParse = (await import('pdf-parse')).default;
          const result = await pdfParse(req.file.buffer);
          extractedText = result.text || '';
        } catch (e) { return res.status(500).json({ success: false, data: null, error: `PDF parse failed: ${e.message}` }); }
      } else if (mime === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' || ext === 'docx') {
        try {
          const mammoth = (await import('mammoth')).default;
          const result = await mammoth.extractRawText({ buffer: req.file.buffer });
          extractedText = result.value || '';
        } catch (e) { return res.status(500).json({ success: false, data: null, error: `DOCX parse failed: ${e.message}` }); }
      } else if (mime === 'application/vnd.ms-excel' || mime === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' || ext === 'xlsx' || ext === 'xls') {
        try {
          const { default: XLSX } = await import('xlsx');
          const wb = XLSX.read(req.file.buffer, { type: 'buffer' });
          extractedText = wb.SheetNames.map(name => {
            const ws = wb.Sheets[name];
            return `Sheet: ${name}\n` + XLSX.utils.sheet_to_csv(ws);
          }).join('\n\n');
        } catch (e) { return res.status(500).json({ success: false, data: null, error: `XLSX parse failed: ${e.message}` }); }
      } else if (mime === 'text/plain' || mime === 'text/csv' || ext === 'txt' || ext === 'csv') {
        extractedText = req.file.buffer.toString('utf-8');
      } else if (ext === 'zip') {
        try {
          const AdmZip = (await import('adm-zip')).default;
          const zip = new AdmZip(req.file.buffer);
          const entries = zip.getEntries().filter(e => !e.isDirectory);
          const texts = [];
          for (const entry of entries) {
            const entryExt = entry.entryName.split('.').pop().toLowerCase();
            if (['txt','csv','md'].includes(entryExt)) {
              texts.push(`--- ${entry.entryName} ---\n${entry.getData().toString('utf-8')}`);
            } else if (entryExt === 'pdf') {
              try {
                const pdfParse = (await import('pdf-parse')).default;
                const r = await pdfParse(entry.getData());
                texts.push(`--- ${entry.entryName} ---\n${r.text}`);
              } catch {}
            } else if (entryExt === 'docx') {
              try {
                const mammoth = (await import('mammoth')).default;
                const r = await mammoth.extractRawText({ buffer: entry.getData() });
                texts.push(`--- ${entry.entryName} ---\n${r.value}`);
              } catch {}
            }
          }
          extractedText = texts.join('\n\n');
        } catch (e) { return res.status(500).json({ success: false, data: null, error: `ZIP extraction failed: ${e.message}` }); }
      } else if (['ppt','pptx','doc'].includes(ext)) {
        // No parser available — store as reference only
        extractedText = `[${origName} — content reference only, no text extraction available for ${ext.toUpperCase()} files]`;
      } else {
        return res.status(400).json({ success: false, data: null, error: `Unsupported file type: ${ext}` });
      }

      sessionTitle = origName.replace(/\.[^.]+$/, '');
    } else {
      // External link mode
      const { externalUrl, linkTitle, linkType } = req.body;
      if (!externalUrl) return res.status(400).json({ success: false, data: null, error: 'No file or externalUrl provided' });
      extractedText = `[External ${linkType || 'link'}: ${externalUrl}]`;
      sessionTitle = linkTitle || externalUrl;
      importedFrom = externalUrl;
      fileType = linkType || 'link';
    }

    // Split extracted text into sessions by sections/paragraphs
    const rawSections = extractedText.split(/\n{2,}/).map(s => s.trim()).filter(Boolean);
    const sessions = rawSections.slice(0, 50).map((content, i) => ({
      id: randomUUID(),
      title: `Section ${i + 1}`,
      type: 'reading',
      content,
      duration: Math.max(5, Math.ceil(content.length / 500) * 5),
    }));
    sectionsExtracted = sessions.length;

    const newModule = await db.createModule({
      title: (req.body.title || sessionTitle || 'Imported Module').slice(0, 200),
      description: req.body.description || `Imported from ${importedFrom}`,
      category: req.body.category || 'General',
      difficulty: req.body.difficulty || 'beginner',
      estimatedDuration: sessions.reduce((s, x) => s + (x.duration || 5), 0),
      skills: [],
      tasks: [],
      resources: [],
      completionCriteria: 'Complete all sessions',
      content: { sessions, importedFrom, importedAt: new Date().toISOString(), fileType },
      companyId: user.companyId || null,
      targetRoles: [],
    }, user.userId || user.id);

    res.status(201).json({ success: true, data: { module: newModule, source: importedFrom, sectionsExtracted, textLength: extractedText.length }, error: null });
  } catch (e) {
    console.error('[POST /api/modules/import]', e);
    res.status(500).json({ success: false, data: null, error: e.message });
  }
});

/**
 * POST /api/modules
 * Create new module (admin/manager) - persists to Supabase
 */
router.post('/', authenticate, async (req, res) => {
  try {
    const user = req.user;

    if (user.role !== 'admin' && user.role !== 'manager') {
      return res.status(403).json({ success: false, error: { message: 'Only admins and managers can create modules' } });
    }

    const { title, description, category, difficulty, estimatedDuration, skills, tasks, resources, completionCriteria, content, targetRoles } = req.body;

    if (!title) {
      return res.status(400).json({ success: false, error: { message: 'Module title is required' } });
    }

    const newModule = await db.createModule({
      title,
      description: description || `Learn ${title}`,
      category: category || 'General',
      difficulty: difficulty || 'beginner',
      estimatedDuration: estimatedDuration || '7 days',
      skills: skills || [],
      tasks: tasks || [],
      resources: resources || [],
      completionCriteria: completionCriteria || 'Complete all tasks',
      progressTracking: true,
      content: content || {},
      companyId: req.user.companyId || null,
      targetRoles: Array.isArray(targetRoles) ? targetRoles : [],
    }, user.userId || user.id);

    res.status(201).json({ success: true, data: newModule });
  } catch (error) {
    console.error('Error creating module:', error);
    res.status(500).json({ success: false, error: { message: 'Failed to create module' } });
  }
});

/**
 * PUT /api/modules/:id
 * Update module (admin/manager) - persists to Supabase
 */
router.put('/:id', authenticate, async (req, res) => {
  try {
    const user = req.user;
    const { id } = req.params;

    if (user.role !== 'admin' && user.role !== 'manager') {
      return res.status(403).json({ success: false, error: { message: 'Only admins and managers can update modules' } });
    }

    const existingModule = await db.getModuleById(id).catch(() => null);
    if (existingModule && !canAccessModule(user, existingModule)) {
      return res.status(403).json({ success: false, error: { message: 'Access denied' } });
    }

    const updatedModule = await db.updateModule(id, req.body);

    if (!updatedModule) {
      return res.status(404).json({ success: false, error: { message: 'Module not found' } });
    }

    res.json({ success: true, data: updatedModule });
  } catch (error) {
    console.error('Error updating module:', error);
    res.status(500).json({ success: false, error: { message: 'Failed to update module' } });
  }
});

/**
 * POST /api/modules/:id/generate-content
 * Use AI to generate full learning content for a module
 */
router.post('/:id/generate-content', authenticate, async (req, res) => {
  try {
    const { id } = req.params;
    let module = await db.getModuleById(id);

    // Module missing from DB (ephemeral file lost on server restart) — recreate from request body
    if (!module && req.body?.title) {
      try {
        module = await db.createModule({
          title: req.body.title,
          description: req.body.description || `Training module: ${req.body.title}`,
          category: req.body.category || 'Training',
          difficulty: req.body.difficulty || 'intermediate',
          estimatedDuration: req.body.estimatedDuration || '7 days',
          skills: req.body.skills || [],
          content: {},
          companyId: req.user.companyId || null,
        }, null);
        // Re-save with the original ID so the assignment still points to it
        if (module && module.id !== id) {
          await db.updateModule(module.id, { id });
          module = { ...module, id };
        }
      } catch (recreateErr) {
        console.warn('[generate-content] Could not recreate module:', recreateErr.message);
      }
    }

    if (!module) {
      return res.status(404).json({ success: false, error: { message: 'Module not found' } });
    }

    const title = module.title || 'Learning Module';
    const description = module.description || '';
    const skills = Array.isArray(module.skills) ? module.skills : [];
    const difficulty = module.difficulty || 'intermediate';
    const durationStr = module.estimatedDuration || module.duration || '7 days';
    const daysMatch = durationStr.match(/(\d+)/);
    const numSessions = Math.min(Math.max(parseInt(daysMatch?.[1]) || 7, 3), 14);

    // Pull role/JD context from module metadata if available
    const jobRole = module.content?.jobRole || module.category || '';
    const jdContext = (module.content?.jobDescription || '').slice(0, 1500);
    const assessmentGaps = Array.isArray(module.content?.weakAreas) ? module.content.weakAreas : [];
    const assessmentContext = assessmentGaps.length
      ? `Assessment identified these specific skill gaps: ${assessmentGaps.join(', ')}`
      : '';

    const systemPrompt = `You are an expert corporate Learning & Development specialist who designs training for ALL job functions — HR, Operations, Finance, Sales, Marketing, Customer Success, Procurement, IT, Engineering, Legal, Healthcare, and any other domain.

CRITICAL RULES:
1. Match the training content to the specific domain of the module title and job role — never inject irrelevant content.
2. All sessions must directly address skills and knowledge gaps relevant to this exact role and module topic.
3. Examples, scenarios, and definitions must come from the correct industry/domain.
4. Build sessions progressively: foundational → applied → advanced.
5. Write like a specific subject-matter expert briefing one named employee, not a generic corporate-training template. Reference the actual job description wording, the actual assessment gap wording, or the actual role's real tools/systems/terminology wherever they were given — avoid interchangeable filler phrasing ("plays a crucial role", "in today's fast-paced environment", "it is important to note") that could be pasted into any other role's module unchanged.
6. Always return valid JSON.`;

    const userPrompt = `Create a complete learning curriculum for this training module.

=== MODULE CONTEXT ===
Title: "${title}"
Description: ${description}
Job Role: ${jobRole || 'Professional'}
Skills to develop: ${skills.join(', ') || 'Core role competencies'}
Difficulty: ${difficulty}
Sessions needed: ${numSessions}
${assessmentContext}
${jdContext ? `Job Description context:\n${jdContext}` : ''}

=== GENERATION INSTRUCTIONS ===
1. Every session must address a specific skill, competency, or knowledge area from the module's domain.
2. Content must be immediately applicable — not abstract theory.
3. Examples must match the role's industry and day-to-day responsibilities, and should reference specifics from the job description / assessment gaps above where possible rather than generic industry examples.
4. Definitions should be real domain-specific terms (not generic management jargon unless that IS the domain).
5. If assessment gaps are provided, structure early sessions to address the most critical gaps first — and vary which gap each session targets, so sessions don't repeat the same one or two skills across the whole module.
6. Build sessions progressively so each builds on the previous.
7. "visual": include one ONLY when it genuinely helps this session's specific content — a flowchart for a real sequential process in this domain, a bar/pie chart only for genuinely comparable/proportional data relevant to the topic (e.g. time allocation, category breakdown, relative frequency). Set "type": "none" and omit flowSteps/data when neither fits naturally — do not force a chart onto content that has no real comparative or sequential structure.
8. Do not include a hands-on exercise, case study, or generic "learning tips" section — the platform renders those separately; focus this response entirely on explanation/keyPoints/definitions/visual/quiz.

Generate a JSON object:
{
  "sessions": [
    {
      "title": "Day N: <specific skill/topic from this domain>",
      "description": "What this session covers and why it matters for this role",
      "objective": "By end of this session, the learner will be able to [specific action relevant to their job]",
      "topics": ["specific topic 1", "specific topic 2", "specific topic 3"],
      "keyPoints": [
        "Actionable insight directly applicable to this role — be specific, not generic",
        "Key insight 2",
        "Key insight 3",
        "Key insight 4",
        "Key insight 5",
        "Key insight 6",
        "Key insight 7"
      ],
      "definitions": [
        {"term": "Domain-specific term", "definition": "Clear, accurate definition from this field, in this role's own vocabulary"},
        {"term": "Another term", "definition": "Explanation"},
        {"term": "A third term", "definition": "Explanation"},
        {"term": "A fourth term", "definition": "Explanation"}
      ],
      "explanation": "2-3 paragraphs written like a subject-matter expert mentoring someone in this specific role. Include real-world context from the correct industry, why this matters for job performance, and practical application examples from the actual domain.",
      "notes": "Practical tips, common mistakes professionals in this role make, and how to avoid them.",
      "duration": "45 min",
      "visual": {
        "type": "flowchart | bar | pie | none",
        "title": "Short title for this visual, specific to the session topic",
        "flowSteps": ["Only when type is flowchart: 3-6 short sequential step labels representing a real process in this domain"],
        "data": [{"label": "Only when type is bar or pie: short category label", "value": 0}]
      },
      "quiz": [
        {"question": "Scenario-based MCQ testing this session's topic in this role's context", "options": ["A) ...", "B) ...", "C) ...", "D) ..."], "answer": "A", "explanation": "Why A is correct"},
        {"question": "Second question testing a different aspect of this session", "options": ["A) ...", "B) ...", "C) ...", "D) ..."], "answer": "B", "explanation": "Explanation"},
        {"question": "Third question", "options": ["A) ...", "B) ...", "C) ...", "D) ..."], "answer": "A", "explanation": "Explanation"}
      ]
    }
  ],
  "roadmap": [
    {"title": "Foundation", "description": "Core concepts and vocabulary for this domain", "duration": "Days 1-${Math.ceil(numSessions/3)}"},
    {"title": "Application", "description": "Applying skills to real role scenarios", "duration": "Days ${Math.ceil(numSessions/3)+1}-${Math.ceil(2*numSessions/3)}"},
    {"title": "Mastery", "description": "Advanced application and independent practice", "duration": "Days ${Math.ceil(2*numSessions/3)+1}-${numSessions}"}
  ],
  "projects": [
    {"title": "Role-specific project title", "description": "A realistic project this employee would complete in their actual job — with specific deliverables", "difficulty": "${difficulty}"},
    {"title": "Practical application project", "description": "Applies module skills to a real workplace scenario from this role's domain", "difficulty": "intermediate"}
  ],
  "resources": [
    {"title": "Relevant resource for this domain", "type": "article/video/book/tool/framework", "description": "Why this specific resource helps this role"},
    {"title": "Another domain-specific resource", "type": "tool", "description": "How it applies to the role"}
  ]
}

IMPORTANT: Create exactly ${numSessions} sessions. All content must be specific to "${title}" and the ${jobRole || 'professional'} role — not generic.`;

    let generated = null;

    const cacheKey = `module_content_${id}_${LLMCache.hash(skills.join(',') + jobRole + assessmentGaps.join(',') + jdContext.slice(0, 100))}`;
    const cached = LLMCache.get(cacheKey);
    if (cached) {
      generated = cached;
    } else {
      try {
        const result = await GeminiService.generateJSON(userPrompt, systemPrompt, { maxTokens: 8000 });
        if (result?.sessions && Array.isArray(result.sessions) && result.sessions.length > 0) {
          generated = result;
          LLMCache.set(cacheKey, generated, LLMCache.TTL.MODULE);
        }
      } catch (err) {
        console.warn('[modules/generate-content] LLM failed:', err.message);
      }
    }

    // Structured fallback if AI unavailable
    if (!generated) {
      const sessionTopics = skills.length > 0 ? skills : [title];
      // Non-wrapping topic distribution. This used to be
      // `sessionTopics[i % sessionTopics.length]`, which meant a 3-skill,
      // 12-day module produced each day FOUR times over — the single biggest
      // source of the "every day looks the same" complaint. Once the distinct
      // skills are used up, later days get an explicit progression stage
      // instead of restarting the list.
      const STAGES = ['Applied', 'Advanced', 'In Practice', 'Review & Integration'];
      const topicFor = (i) => {
        if (i < sessionTopics.length) return sessionTopics[i];
        const cycle = Math.floor(i / sessionTopics.length) - 1;
        const base = sessionTopics[i % sessionTopics.length];
        return `${base} — ${STAGES[Math.min(cycle, STAGES.length - 1)]}`;
      };
      generated = {
        sessions: Array.from({ length: numSessions }, (_, i) => {
          const topicName = topicFor(i) || title;
          return {
            title: `Day ${i + 1}: ${topicName} ${i === 0 ? 'Fundamentals' : i < numSessions / 2 ? 'Core Concepts' : 'Advanced Application'}`,
            description: `Deep dive into ${topicName} — covering practical techniques and real-world applications.`,
            objective: `Understand and apply ${topicName} concepts in professional scenarios.`,
            topics: [topicName, `${topicName} best practices`, `${topicName} in practice`],
            keyPoints: [
              `${topicName} is essential for ${title} professionals`,
              `Core ${topicName} principles follow established industry standards`,
              `Practical application of ${topicName} requires both theory and hands-on practice`,
              `Common ${topicName} mistakes can be avoided with proper understanding`,
              `${topicName} integrates with broader ${title} workflows`,
            ],
            definitions: [
              { term: topicName, definition: `A core component of ${title} that enables professionals to ${description || 'achieve business objectives'}.` },
              { term: `${topicName} framework`, definition: `The structured approach to implementing ${topicName} in organizational contexts.` },
            ],
            explanation: `${topicName} is a foundational element of ${title}. Understanding it deeply allows professionals to make better decisions and deliver higher quality outcomes.\n\nIn practice, ${topicName} is applied across various scenarios in corporate environments. Organizations that master ${topicName} see measurable improvements in efficiency, quality, and team performance.\n\nThis session builds your practical understanding through concrete examples and real-world case studies from industry leaders.`,
            notes: `• Focus on understanding the "why" behind each concept, not just the "how"\n• Try to connect these concepts to challenges you face in your current role\n• The quiz that follows will test your understanding of the specific topics covered here`,
            duration: '45 min',
          };
        }),
        roadmap: [
          { title: 'Foundation', description: `Establish core ${title} knowledge and vocabulary`, duration: `Days 1-${Math.ceil(numSessions / 3)}` },
          { title: 'Application', description: `Apply ${title} skills in controlled scenarios`, duration: `Days ${Math.ceil(numSessions / 3) + 1}-${Math.ceil(2 * numSessions / 3)}` },
          { title: 'Mastery', description: `Advanced ${title} techniques and independent practice`, duration: `Days ${Math.ceil(2 * numSessions / 3) + 1}-${numSessions}` },
        ],
        projects: [
          { title: `${title} Implementation Project`, description: `Apply everything you've learned to complete a real-world ${title} project from start to finish.`, difficulty },
          { title: `${title} Case Study Analysis`, description: `Analyze a real company's approach to ${title} and present your findings and recommendations.`, difficulty: 'intermediate' },
        ],
        resources: skills.slice(0, 3).map(skill => ({
          title: `${skill} — Official Documentation`,
          type: 'reference',
          description: `Comprehensive reference for ${skill} concepts and best practices`,
        })),
      };
    }

    // Normalize embedded quiz question types — the LLM prompt asks for MCQ
    // questions but doesn't reliably stamp a `type` field on the JSON it
    // returns, and neither did the deterministic fallback above. The
    // employee-facing quiz renderer (ModuleSession.jsx) gates strictly on
    // `type === 'mcq'`/`'fill_blank'`/`'subjective'` to decide what to show;
    // without this, a question with real options but no `type` rendered a
    // "Multiple Choice" header with a completely blank, unanswerable answer
    // area. Client-side also normalizes defensively, but fixing it at the
    // source means the persisted data is correct for any future consumer.
    const KNOWN_QUIZ_TYPES = new Set(['mcq', 'fill_blank', 'subjective']);
    if (Array.isArray(generated.sessions)) {
      generated.sessions.forEach(session => {
        if (!Array.isArray(session.quiz)) return;
        session.quiz.forEach(q => {
          if (!KNOWN_QUIZ_TYPES.has(q.type)) {
            q.type = Array.isArray(q.options) && q.options.length > 0 ? 'mcq' : 'subjective';
          }
        });
      });

      // Top up any session whose quiz came back missing/short (the single
      // big content-generation call above can truncate or omit a session's
      // quiz once the response nears its token budget) — in parallel, so
      // every day already has a real quiz saved before any employee opens a
      // specific day, instead of that day falling back to a live "Generating
      // your knowledge quiz…" LLM call on first open.
      generated.sessions = await ensureAllSessionQuizzes(generated.sessions, { moduleTitle: title, moduleDescription: description });
    }

    // Save generated content to module via Supabase
    await db.updateModule(id, {
      sessions: generated.sessions,
      content: {
        ...(module.content || {}),
        sessions: generated.sessions,
        roadmap: generated.roadmap || [],
        projects: generated.projects || [],
        resources: generated.resources || [],
        contentGeneratedAt: new Date().toISOString(),
      },
    });

    // Deepen each day in the background — one call per day, so each day gets
    // its own full token budget rather than 1/Nth of one shared response.
    // Not awaited: 14 sequential ~8k-token calls would add minutes to this
    // request, and day-locking means later days aren't reachable yet anyway.
    startDeepContentJob(id, {
      moduleTitle: title,
      moduleDescription: description,
      jobRole,
      jdContext,
      gaps: assessmentGaps,
      difficulty,
    });

    const updatedModule = await db.getModuleById(id);
    res.json({ success: true, data: updatedModule });
  } catch (error) {
    console.error('[modules/generate-content] Error:', error);
    res.status(500).json({ success: false, error: { message: 'Failed to generate content' } });
  }
});

/**
 * POST /api/modules/:id/sessions/:index/ensure-content
 * On-demand safety net + legacy self-heal: generates deep content for ONE day
 * if it is still thin. The background job normally lands content long before
 * a day unlocks, so this covers only the rare race and pre-existing modules
 * created before per-day generation existed. Cost is paid only for days
 * someone actually opens.
 */
router.post('/:id/sessions/:index/ensure-content', authenticate, async (req, res) => {
  try {
    const { id, index } = req.params;
    const idx = parseInt(index, 10);
    if (!Number.isFinite(idx) || idx < 0) {
      return res.status(400).json({ success: false, error: { message: 'Invalid session index' } });
    }

    const module = await db.getModuleById(id).catch(() => null);
    if (!module) return res.status(404).json({ success: false, error: { message: 'Module not found' } });
    if (!canAccessModule(req.user, module)) {
      return res.status(403).json({ success: false, error: { message: 'Access denied' } });
    }

    const sessions = module.content?.sessions || module.sessions || [];
    const session = sessions[idx];
    if (!session) return res.status(404).json({ success: false, error: { message: 'Session not found' } });

    if (hasDeepContent(session)) {
      return res.json({ success: true, data: { session, alreadyDeep: true } });
    }

    // Earlier days' coverage feeds the avoid-list so a single regenerated day
    // still doesn't repeat what the employee has already read.
    const avoid = { titles: [], subtopics: [], coveredTerms: [], companies: [] };
    sessions.slice(0, idx).forEach(s => {
      if (s?.title) avoid.titles.push(s.title);
      (s?.subtopics || []).forEach(st => avoid.subtopics.push(typeof st === 'string' ? st : st?.name));
      (s?.coveredTerms || []).forEach(t => avoid.coveredTerms.push(t));
      (s?.blocks || []).filter(b => b?.type === 'example' && b.company).forEach(b => avoid.companies.push(b.company));
    });

    const content = await generateSessionContent({
      moduleTitle: module.title,
      moduleDescription: module.description,
      jobRole: module.content?.jobRole || module.category || '',
      jdContext: module.content?.jobDescription || '',
      gaps: module.content?.assessmentGaps || module.skills || [],
      difficulty: module.difficulty,
      dayNumber: session.dayNumber || idx + 1,
      totalDays: sessions.length,
      skeleton: session,
      avoid,
    });

    if (!content) {
      // Generation unavailable — the caller keeps rendering the existing
      // (thin) session rather than being shown an error.
      return res.json({ success: true, data: { session, generated: false } });
    }

    const merged = { ...session, ...content, duration: `${content.durationMinutes} min` };
    const updatedSessions = sessions.map((s, i) => (i === idx ? merged : s));
    await db.updateModule(id, {
      sessions: updatedSessions,
      content: { ...(module.content || {}), sessions: updatedSessions },
    });

    res.json({ success: true, data: { session: merged, generated: true } });
  } catch (e) {
    console.error('[modules/ensure-content]', e.message);
    res.status(500).json({ success: false, error: { message: 'Failed to prepare session content' } });
  }
});

/**
 * DELETE /api/modules/:id
 * Delete module (admin only) - persists to Supabase
 */
router.delete('/:id', authenticate, async (req, res) => {
  try {
    const user = req.user;
    const { id } = req.params;

    if (user.role !== 'admin') {
      return res.status(403).json({ success: false, error: { message: 'Only admins can delete modules' } });
    }

    const existingModule = await db.getModuleById(id).catch(() => null);
    if (existingModule && !canAccessModule(user, existingModule)) {
      return res.status(403).json({ success: false, error: { message: 'Access denied' } });
    }

    const deleted = await db.deleteModule(id);

    if (!deleted) {
      return res.status(404).json({ success: false, error: { message: 'Module not found' } });
    }

    // Cancel any assignments pointing at the now-deleted module instead of
    // leaving them dangling — an employee opening one would otherwise hit a
    // 404/broken module view with no indication why.
    try {
      const allAssignments = await UserStore.getAssignments({});
      const affected = allAssignments.filter(a => a.assignable_id === id || a.assignableId === id);
      await Promise.all(affected.map(a => UserStore.updateAssignment(a.id, { status: 'cancelled' })));
    } catch (e) {
      console.warn('[modules/delete] Failed to cancel dangling assignments:', e.message);
    }

    res.json({ success: true, message: 'Module deleted', data: { id } });
  } catch (error) {
    console.error('Error deleting module:', error);
    res.status(500).json({ success: false, error: { message: 'Failed to delete module' } });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// AUTO-GENERATED MODULES FROM ASSESSMENT REPORT
// ─────────────────────────────────────────────────────────────────────────────

/**
 * POST /api/modules/auto-generate
 * Auto-generate a module from an assessment report — stored as PENDING (needs approval)
 */
router.post('/auto-generate', authenticate, async (req, res) => {
  try {
    if (!['admin', 'manager'].includes(req.user.role)) {
      return res.status(403).json({ success: false, error: { message: 'Admin/Manager only' } });
    }

    const { assessmentReportId, userId, jobRole, weakAreas = [], assessmentTitle } = req.body;
    if (!userId) return res.status(400).json({ success: false, error: { message: 'userId required' } });

    const user = await UserStore.getUserById(userId);
    const skills = Array.isArray(weakAreas) && weakAreas.length > 0 ? weakAreas : ['Core Skills'];

    // Use pre-extracted JD text — no file parsing
    const jdContext = (user?.jobDescription || '').slice(0, 2000);
    const jdSkillsCtx = (user?.jdSkills || []).join(', ');

    let moduleContent = null;
    try {
      const prompt = `Design a targeted remedial training module for an employee based on their assessment results.

=== EMPLOYEE CONTEXT ===
Job Role: ${jobRole || 'Professional'}
${jdSkillsCtx ? `Skills from their JD: ${jdSkillsCtx}` : ''}
${jdContext ? `Their Job Description:\n${jdContext}` : ''}

=== ASSESSMENT RESULTS ===
Assessment: ${assessmentTitle || 'Role Assessment'}
Skill gaps identified (areas where employee underperformed): ${skills.join(', ')}

=== MODULE DESIGN INSTRUCTIONS ===
1. The module must DIRECTLY address the specific skill gaps identified in the assessment.
2. Every session topic must connect to either a gap area OR a prerequisite required to close that gap.
3. Content must be appropriate for the employee's actual job role — do NOT generate content from unrelated domains.
4. If the role is non-technical (HR, Operations, Finance, Sales, etc.), generate domain-appropriate content — not software/coding content.
5. Sessions must build progressively from foundational to applied to advanced.
6. Each session's quiz must test the specific gap topic covered in that session.
7. Use realistic workplace scenarios from the employee's actual domain in examples and quiz questions.

Return JSON:
{
  "title": "targeted module title that clearly describes what skill gap is being addressed",
  "description": "1-2 sentence description: what gap this addresses, why it matters for this specific role",
  "objectives": [
    "Specific, measurable learning outcome 1 — what employee will be able to DO after this module",
    "Specific, measurable learning outcome 2",
    "Specific, measurable learning outcome 3"
  ],
  "estimatedDuration": "X days",
  "sessions": [
    {
      "title": "Session title — specific to the gap topic",
      "duration": "45 mins",
      "topics": ["specific topic relevant to gap and role", "another topic", "practical application"],
      "keyPoints": [
        "Actionable insight specific to this role and gap — not generic advice",
        "Key concept 2",
        "Key concept 3"
      ],
      "quiz": [
        {
          "question": "Scenario-based question testing the gap skill in context of the employee's actual job role",
          "options": ["A) correct approach", "B) plausible wrong answer", "C) another wrong answer", "D) another wrong answer"],
          "answer": "A",
          "explanation": "Why this is correct for someone in this role"
        },
        {
          "question": "Second quiz question testing a different aspect of this gap",
          "options": ["A) ...", "B) ...", "C) ...", "D) ..."],
          "answer": "B",
          "explanation": "Explanation"
        },
        {
          "question": "Third quiz question",
          "options": ["A) ...", "B) ...", "C) ...", "D) ..."],
          "answer": "A",
          "explanation": "Explanation"
        }
      ]
    }
  ]
}`;
        const result = await GeminiService.generateJSON(prompt, '', { maxTokens: 4000 });
        if (result?.sessions && Array.isArray(result.sessions)) {
          moduleContent = result;
          // Same quiz-type normalization as /generate-content — see comment
          // there. This module's sessions get copied verbatim into the
          // final module on approval without going through that route again.
          const KNOWN_QUIZ_TYPES = new Set(['mcq', 'fill_blank', 'subjective']);
          moduleContent.sessions.forEach(session => {
            if (!Array.isArray(session.quiz)) return;
            session.quiz.forEach(q => {
              if (!KNOWN_QUIZ_TYPES.has(q.type)) {
                q.type = Array.isArray(q.options) && q.options.length > 0 ? 'mcq' : 'subjective';
              }
            });
          });
          // Top up any session whose quiz came back missing/short — see the
          // matching comment in /:id/generate-content. This module gets
          // copied verbatim into the real module on approval, so this is the
          // only chance to fill gaps before an employee ever sees a day.
          moduleContent.sessions = await ensureAllSessionQuizzes(moduleContent.sessions, { moduleTitle: moduleContent.title, moduleDescription: moduleContent.description });
        }
    } catch (e) { console.warn('[auto-generate] AI failed:', e.message); }

    const pending = {
      id: randomUUID(),
      type: 'auto_generated',
      isMandatory: true,
      status: 'pending_approval',
      targetUserId: userId,
      targetUserName: user?.name || '',
      employeeName: user?.name || '',
      companyId: req.user.companyId || null,
      jobRole: jobRole || '',
      jobDescription: user?.jobDescription || '',
      assessmentReportId: assessmentReportId || null,
      assessmentTitle: assessmentTitle || '',
      weakAreas: skills,
      module: {
        title: moduleContent?.title || `Remedial Training: ${skills[0]}`,
        description: moduleContent?.description || `Targeted training for ${jobRole} covering ${skills.join(', ')}`,
        category: jobRole || 'Training',
        difficulty: 'intermediate',
        estimatedDuration: moduleContent?.estimatedDuration || '5 days',
        skills,
        objectives: moduleContent?.objectives || [`Improve ${skills.join(', ')} skills`],
        sessions: moduleContent?.sessions || skills.map(s => ({ title: s, topics: [s], duration: '30 mins' })),
        isMandatory: true,
      },
      createdAt: new Date().toISOString(),
      createdBy: req.user.userId,
    };

    // Persist to Supabase via DataStore
    const saved = await PendingModules.create(pending);
    res.status(201).json({ success: true, data: saved || pending, error: null });
  } catch (e) {
    console.error('[POST /modules/auto-generate]', e);
    res.status(500).json({ success: false, error: { message: 'Failed to auto-generate module' } });
  }
});

/**
 * POST /api/modules/pending/:id/approve
 * Approve a pending module → creates the real module + assigns to employee
 */
router.post('/pending/:id/approve', authenticate, async (req, res) => {
  try {
    if (!['admin', 'manager'].includes(req.user.role)) {
      return res.status(403).json({ success: false, error: { message: 'Admin/Manager only' } });
    }

    const pending = await PendingModules.getById(req.params.id);
    if (!pending) return res.status(404).json({ success: false, error: { message: 'Pending module not found' } });

    // Idempotency guard: approval is a multi-step write (module -> assignment ->
    // pending status) with no transaction across them. If a prior attempt already
    // succeeded (e.g. the admin retried after a network timeout, or double-clicked
    // before the button disabled), re-running this would create a duplicate module
    // and a duplicate assignment. Short-circuit here instead.
    if (pending.status === 'approved' && pending.moduleId) {
      const existingModule = await db.getModuleById(pending.moduleId).catch(() => null);
      return res.json({ success: true, data: { module: existingModule, alreadyApproved: true }, error: null });
    }

    // Create the real module in Supabase
    const newModule = await db.createModule({
      title: pending.module.title,
      description: pending.module.description,
      category: pending.module.category,
      difficulty: pending.module.difficulty,
      estimatedDuration: pending.module.estimatedDuration,
      skills: pending.module.skills,
      tasks: pending.module.sessions?.map(s => ({ title: s.title, duration: s.duration, type: 'session' })) || [],
      resources: [],
      completionCriteria: 'Complete all sessions',
      progressTracking: true,
      companyId: pending.companyId || req.user.companyId || null,
      content: {
        isMandatory: true,
        sessions: pending.module.sessions,
        objectives: pending.module.objectives,
        assessmentSource: pending.assessmentReportId,
        // Preserve JD + assessment context so regeneration stays specific
        weakAreas: pending.weakAreas || [],
        jobRole: pending.jobRole || '',
        jobDescription: pending.jobDescription || '',
        assessmentTitle: pending.assessmentTitle || '',
      },
    }, req.user.userId);

    const moduleId = newModule?.id;
    if (!moduleId) {
      return res.status(500).json({ success: false, error: { message: 'Module creation failed — no ID returned' } });
    }

    // Now that this pending module is a real, assigned module, deepen its
    // days in the background. Deliberately NOT done at /auto-generate time:
    // a pending module may never be approved, so generating 14 days of
    // content up front would be spent on something nobody ever reads.
    startDeepContentJob(moduleId, {
      moduleTitle: pending.module.title,
      moduleDescription: pending.module.description,
      jobRole: pending.jobRole || '',
      jdContext: pending.jobDescription || '',
      gaps: pending.weakAreas || [],
      difficulty: pending.module.difficulty,
    });

    // Write module assignment to Supabase via DataStore
    const moduleAssignment = {
      id: randomUUID(),
      moduleId,
      userId: pending.targetUserId,
      isMandatory: true,
      assignedAt: new Date().toISOString(),
      assignedBy: req.user.userId,
      status: 'assigned',
    };
    await ModuleAssignments.create(moduleAssignment);

    // Also write to main assignments system (visible on Employee dashboard)
    try {
      const moduleTitle = pending.module.title || `Training: ${pending.weakAreas?.[0] || pending.jobRole || 'Skills'}`;
      await UserStore.createAssignment({
        type: 'module',
        assignable_id: moduleId,
        assignable_type: 'module',
        assigned_by: req.user.userId,
        assigned_to_user: pending.targetUserId,
        priority: 'high',
        status: 'assigned',
        progress: 0,
        isMandatory: true,
        title: moduleTitle,
        name: moduleTitle,
        module_name: moduleTitle,
        description: pending.module.description || '',
        moduleRef: {
          id: moduleId,
          title: moduleTitle,
          skills: pending.module.skills || [],
          estimatedDuration: pending.module.estimatedDuration || '5 days',
        },
      });
    } catch (e) {
      console.warn('[modules/approve] Could not write to main assignments:', e.message);
    }

    // Mark pending as approved in Supabase
    await PendingModules.update(req.params.id, {
      status: 'approved',
      approvedAt: new Date().toISOString(),
      approvedBy: req.user.userId,
      moduleId,
    });

    res.json({ success: true, data: { module: newModule, assignment: moduleAssignment }, error: null });
  } catch (e) {
    console.error('[POST /modules/pending/:id/approve]', e);
    res.status(500).json({ success: false, error: { message: 'Failed to approve module' } });
  }
});

/**
 * POST /api/modules/pending/:id/reject
 * Reject a pending module
 */
router.post('/pending/:id/reject', authenticate, async (req, res) => {
  try {
    if (!['admin', 'manager'].includes(req.user.role)) {
      return res.status(403).json({ success: false, error: { message: 'Admin/Manager only' } });
    }
    const pending = await PendingModules.getById(req.params.id);
    if (!pending) return res.status(404).json({ success: false, error: { message: 'Not found' } });

    const updated = await PendingModules.update(req.params.id, {
      status: 'rejected',
      rejectedAt: new Date().toISOString(),
      rejectedBy: req.user.userId,
      reason: req.body.reason || '',
    });
    res.json({ success: true, data: updated || pending, error: null });
  } catch (e) {
    res.status(500).json({ success: false, error: { message: 'Failed to reject' } });
  }
});

/**
 * POST /api/modules/assign
 * Manually assign modules to users or groups
 */
router.post('/assign', authenticate, async (req, res) => {
  try {
    if (!['admin', 'manager'].includes(req.user.role)) {
      return res.status(403).json({ success: false, error: { message: 'Admin/Manager only' } });
    }

    const { moduleIds = [], targetUserIds = [], targetGroupId, isMandatory = false } = req.body;
    if (!moduleIds.length) return res.status(400).json({ success: false, error: { message: 'At least one module required' } });

    let allUserIds = [...targetUserIds];

    // Resolve group members via Supabase (or file fallback)
    if (targetGroupId) {
      try {
        const memberships = await db.getGroupMemberships(targetGroupId);
        const memberIds = memberships.map(m => m.user_id || m.userId).filter(Boolean);
        allUserIds = [...new Set([...allUserIds, ...memberIds])];
      } catch { /* skip */ }
    }

    const existingAssignments = await ModuleAssignments.getAll();
    const created = [];

    // Pre-fetch module metadata for embedding into assignments
    const moduleMetaMap = {};
    for (const moduleId of moduleIds) {
      try {
        const mod = await db.getModuleById(moduleId);
        if (mod) moduleMetaMap[moduleId] = mod;
      } catch { /* non-fatal */ }
    }

    for (const userId of allUserIds) {
      for (const moduleId of moduleIds) {
        // Skip duplicates
        const exists = existingAssignments.some(a => a.moduleId === moduleId && a.userId === userId);
        if (exists) continue;

        const mod = moduleMetaMap[moduleId];
        const moduleTitle = mod?.title || `Module ${moduleId}`;

        const assignment = {
          id: randomUUID(),
          moduleId,
          userId,
          isMandatory: !!isMandatory,
          assignedAt: new Date().toISOString(),
          assignedBy: req.user.userId,
          status: 'assigned',
        };
        await ModuleAssignments.create(assignment);

        // Also write to main assignments table (Supabase) so it appears in employee dashboard
        try {
          const dueDate = new Date();
          dueDate.setDate(dueDate.getDate() + 30);
          await UserStore.createAssignment({
            type: 'module',
            assignable_id: moduleId,
            assignable_type: 'module',
            assigned_by: req.user.userId,
            assigned_to_user: userId,
            priority: isMandatory ? 'high' : 'medium',
            due_date: dueDate.toISOString(),
            status: 'assigned',
            progress: 0,
            isMandatory: !!isMandatory,
            title: moduleTitle,
            name: moduleTitle,
            module_name: moduleTitle,
            description: mod?.description || '',
            moduleRef: {
              id: moduleId,
              title: moduleTitle,
              skills: mod?.skills || [],
              estimatedDuration: mod?.estimatedDuration || '30 days',
            },
          });
        } catch (e) {
          console.warn('[POST /modules/assign] Could not write to main assignments:', e.message);
        }

        created.push(assignment);
      }
    }

    res.json({ success: true, data: { assigned: created.length, assignments: created }, error: null });
  } catch (e) {
    console.error('[POST /modules/assign]', e);
    res.status(500).json({ success: false, error: { message: 'Assignment failed' } });
  }
});

export default router;
