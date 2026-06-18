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
import { authenticate, requireRole } from '../middleware/auth.js';
import { RoleLibrary, EmployeeChecklists, Assessments, GeneratedContent } from '../services/DataStore.js';
import { generateQuestionsFromJD } from '../services/AssessmentGenerator.js';
import UserStore from '../services/UserStore.js';

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

// ── helpers ───────────────────────────────────────────────────────────────────

function parseSkills(raw) {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw.filter(Boolean);
  return String(raw).split(/[,;|]/).map(s => s.trim()).filter(Boolean);
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
    const { roleName, department, jobDescription, skills, status } = req.body;
    if (!roleName?.trim()) return res.status(400).json({ success: false, error: 'Role name is required' });

    // Prevent duplicates within company
    const existing = await RoleLibrary.findByName(roleName, companyId);
    if (existing) return res.status(409).json({ success: false, error: `Role "${roleName}" already exists in your company` });

    const doc = {
      id: randomUUID(),
      companyId,
      roleName:       roleName.trim(),
      department:     (department || '').trim(),
      jobDescription: (jobDescription || '').trim(),
      skills:         parseSkills(skills),
      status:         status || 'active',
      createdAt:      new Date().toISOString(),
      updatedAt:      new Date().toISOString(),
      createdBy:      req.user.userId,
    };
    const saved = await RoleLibrary.create(doc);
    res.status(201).json({ success: true, data: saved });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// ── PUT /api/roles/:id — update ───────────────────────────────────────────────
router.put('/:id', authenticate, requireRole('admin'), async (req, res) => {
  try {
    const existing = await RoleLibrary.getById(req.params.id);
    if (!existing) return res.status(404).json({ success: false, error: 'Role not found' });

    const { roleName, department, jobDescription, skills, status } = req.body;
    const updates = {
      ...(roleName        !== undefined && { roleName: roleName.trim() }),
      ...(department      !== undefined && { department: department.trim() }),
      ...(jobDescription  !== undefined && { jobDescription: jobDescription.trim() }),
      ...(skills          !== undefined && { skills: parseSkills(skills) }),
      ...(status          !== undefined && { status }),
      updatedAt: new Date().toISOString(),
    };
    const updated = await RoleLibrary.update(req.params.id, updates);
    res.json({ success: true, data: updated });
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

    for (const raw of rows) {
      const { roleName, department, jobDescription, skills, status } = normalise(raw);
      if (!roleName) { results.errors.push(`Skipped row — missing role name`); continue; }
      if (existingNames.has(roleName.toLowerCase())) { results.skipped++; continue; }

      const doc = {
        id: randomUUID(),
        companyId,
        roleName,
        department,
        jobDescription,
        skills,
        status: status || 'active',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        createdBy: req.user.userId,
      };
      await RoleLibrary.create(doc);
      existingNames.add(roleName.toLowerCase());
      results.created++;
    }

    res.json({ success: true, data: results });
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

export default router;
