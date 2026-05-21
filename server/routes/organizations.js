/**
 * routes/organizations.js
 * Enterprise org hierarchy: Organizations → Departments → Teams
 */

import express from 'express';
import { randomUUID } from 'crypto';
import { authenticate, requireRole } from '../middleware/auth.js';
import { readFile, writeFile, mkdir, access } from 'fs/promises';
import { join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = fileURLToPath(new URL('..', import.meta.url)).replace(/\/$/, '');
const DATA_DIR = join(__dirname, 'data');

const router = express.Router();

// ─── File helpers ──────────────────────────────────────────────────────────

async function readJson(filename) {
  try {
    const txt = await readFile(join(DATA_DIR, filename), 'utf-8');
    return JSON.parse(txt);
  } catch {
    return null;
  }
}

async function writeJson(filename, data) {
  await mkdir(DATA_DIR, { recursive: true });
  await writeFile(join(DATA_DIR, filename), JSON.stringify(data, null, 2), 'utf-8');
}

// ─── Organizations ─────────────────────────────────────────────────────────

/**
 * GET /api/org/organizations
 */
router.get('/organizations', authenticate, requireRole('admin'), async (req, res) => {
  try {
    const f = await readJson('organizations.json') || { organizations: [] };
    res.json({ success: true, data: { organizations: f.organizations }, error: null });
  } catch (err) {
    res.status(500).json({ success: false, data: null, error: { message: err.message } });
  }
});

/**
 * POST /api/org/organizations
 */
router.post('/organizations', authenticate, requireRole('admin'), async (req, res) => {
  try {
    const { name, industry, size, description } = req.body;
    if (!name) return res.status(400).json({ success: false, data: null, error: { message: 'Name required' } });

    const f = await readJson('organizations.json') || { organizations: [] };
    const org = {
      id: randomUUID(),
      name,
      industry: industry || '',
      size: size || '',
      description: description || '',
      created_by: req.user.userId,
      created_at: new Date().toISOString(),
    };
    f.organizations.push(org);
    await writeJson('organizations.json', f);
    res.status(201).json({ success: true, data: { organization: org }, error: null });
  } catch (err) {
    res.status(500).json({ success: false, data: null, error: { message: err.message } });
  }
});

// ─── Departments ───────────────────────────────────────────────────────────

/**
 * GET /api/org/departments
 */
router.get('/departments', authenticate, async (req, res) => {
  try {
    const { org_id } = req.query;
    const f = await readJson('departments.json') || { departments: [] };
    let depts = f.departments;
    if (org_id) depts = depts.filter(d => d.org_id === org_id);
    res.json({ success: true, data: { departments: depts }, error: null });
  } catch (err) {
    res.status(500).json({ success: false, data: null, error: { message: err.message } });
  }
});

/**
 * POST /api/org/departments
 */
router.post('/departments', authenticate, requireRole('admin'), async (req, res) => {
  try {
    const { name, org_id, description, head_user_id } = req.body;
    if (!name) return res.status(400).json({ success: false, data: null, error: { message: 'Name required' } });

    const f = await readJson('departments.json') || { departments: [] };
    const dept = {
      id: randomUUID(),
      name,
      org_id: org_id || null,
      description: description || '',
      head_user_id: head_user_id || null,
      created_by: req.user.userId,
      created_at: new Date().toISOString(),
    };
    f.departments.push(dept);
    await writeJson('departments.json', f);
    res.status(201).json({ success: true, data: { department: dept }, error: null });
  } catch (err) {
    res.status(500).json({ success: false, data: null, error: { message: err.message } });
  }
});

/**
 * PUT /api/org/departments/:id
 */
router.put('/departments/:id', authenticate, requireRole('admin'), async (req, res) => {
  try {
    const { id } = req.params;
    const f = await readJson('departments.json') || { departments: [] };
    const idx = f.departments.findIndex(d => d.id === id);
    if (idx === -1) return res.status(404).json({ success: false, data: null, error: { message: 'Department not found' } });
    f.departments[idx] = { ...f.departments[idx], ...req.body, id, updated_at: new Date().toISOString() };
    await writeJson('departments.json', f);
    res.json({ success: true, data: { department: f.departments[idx] }, error: null });
  } catch (err) {
    res.status(500).json({ success: false, data: null, error: { message: err.message } });
  }
});

// ─── Teams ─────────────────────────────────────────────────────────────────

/**
 * GET /api/org/teams
 */
router.get('/teams', authenticate, async (req, res) => {
  try {
    const { dept_id, manager_id } = req.query;
    const f = await readJson('teams.json') || { teams: [] };
    let teams = f.teams;
    if (dept_id) teams = teams.filter(t => t.dept_id === dept_id);
    if (manager_id) teams = teams.filter(t => t.manager_id === manager_id);
    res.json({ success: true, data: { teams }, error: null });
  } catch (err) {
    res.status(500).json({ success: false, data: null, error: { message: err.message } });
  }
});

/**
 * POST /api/org/teams
 */
router.post('/teams', authenticate, requireRole('admin', 'manager'), async (req, res) => {
  try {
    const { name, dept_id, manager_id, description } = req.body;
    if (!name) return res.status(400).json({ success: false, data: null, error: { message: 'Name required' } });

    const f = await readJson('teams.json') || { teams: [] };
    const team = {
      id: randomUUID(),
      name,
      dept_id: dept_id || null,
      manager_id: manager_id || req.user.userId,
      description: description || '',
      member_ids: [],
      created_by: req.user.userId,
      created_at: new Date().toISOString(),
    };
    f.teams.push(team);
    await writeJson('teams.json', f);
    res.status(201).json({ success: true, data: { team }, error: null });
  } catch (err) {
    res.status(500).json({ success: false, data: null, error: { message: err.message } });
  }
});

/**
 * POST /api/org/teams/:id/members
 */
router.post('/teams/:id/members', authenticate, requireRole('admin', 'manager'), async (req, res) => {
  try {
    const { id } = req.params;
    const { userIds } = req.body;
    if (!userIds?.length) return res.status(400).json({ success: false, data: null, error: { message: 'userIds required' } });

    const f = await readJson('teams.json') || { teams: [] };
    const idx = f.teams.findIndex(t => t.id === id);
    if (idx === -1) return res.status(404).json({ success: false, data: null, error: { message: 'Team not found' } });

    const existing = new Set(f.teams[idx].member_ids || []);
    userIds.forEach(uid => existing.add(uid));
    f.teams[idx].member_ids = Array.from(existing);
    f.teams[idx].updated_at = new Date().toISOString();
    await writeJson('teams.json', f);
    res.json({ success: true, data: { team: f.teams[idx] }, error: null });
  } catch (err) {
    res.status(500).json({ success: false, data: null, error: { message: err.message } });
  }
});

/**
 * GET /api/org/analytics
 * Org-wide analytics for admin
 */
router.get('/analytics', authenticate, requireRole('admin'), async (req, res) => {
  try {
    const [deptF, teamF, orgF] = await Promise.all([
      readJson('departments.json'),
      readJson('teams.json'),
      readJson('organizations.json'),
    ]);

    res.json({
      success: true,
      data: {
        organizations: (orgF?.organizations || []).length,
        departments: (deptF?.departments || []).length,
        teams: (teamF?.teams || []).length,
        departments_list: deptF?.departments || [],
        teams_list: teamF?.teams || [],
      },
      error: null,
    });
  } catch (err) {
    res.status(500).json({ success: false, data: null, error: { message: err.message } });
  }
});

export default router;
