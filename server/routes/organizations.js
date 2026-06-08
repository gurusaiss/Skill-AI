/**
 * routes/organizations.js
 * Enterprise org hierarchy: Organizations → Departments → Teams
 * All data persisted to Supabase via DataStore (falls back to JSON files)
 */

import express from 'express';
import { randomUUID } from 'crypto';
import { authenticate, requireRole } from '../middleware/auth.js';
import { Organizations, Departments, Teams } from '../services/DataStore.js';

const router = express.Router();

// ─── Organizations ─────────────────────────────────────────────────────────

/**
 * GET /api/org/organizations
 */
router.get('/organizations', authenticate, requireRole('admin'), async (req, res) => {
  try {
    const organizations = await Organizations.getAll();
    res.json({ success: true, data: { organizations }, error: null });
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

    const org = {
      id: randomUUID(),
      name,
      industry: industry || '',
      size: size || '',
      description: description || '',
      created_by: req.user.userId,
      created_at: new Date().toISOString(),
    };

    const saved = await Organizations.create(org);
    res.status(201).json({ success: true, data: { organization: saved || org }, error: null });
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
    const depts = await Departments.getAll(org_id || null);
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

    const dept = {
      id: randomUUID(),
      name,
      org_id: org_id || null,
      description: description || '',
      head_user_id: head_user_id || null,
      created_by: req.user.userId,
      created_at: new Date().toISOString(),
    };

    const saved = await Departments.create(dept);
    res.status(201).json({ success: true, data: { department: saved || dept }, error: null });
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
    const updates = { ...req.body, id, updated_at: new Date().toISOString() };
    const updated = await Departments.update(id, updates);
    if (!updated) return res.status(404).json({ success: false, data: null, error: { message: 'Department not found' } });
    res.json({ success: true, data: { department: updated }, error: null });
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
    const teams = await Teams.getAll(dept_id || null, manager_id || null);
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

    const saved = await Teams.create(team);
    res.status(201).json({ success: true, data: { team: saved || team }, error: null });
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

    const team = await Teams.getById(id);
    if (!team) return res.status(404).json({ success: false, data: null, error: { message: 'Team not found' } });

    const existing = new Set(team.member_ids || []);
    userIds.forEach(uid => existing.add(uid));
    const updated = await Teams.update(id, {
      member_ids: Array.from(existing),
      updated_at: new Date().toISOString(),
    });

    res.json({ success: true, data: { team: updated || team }, error: null });
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
    const [orgs, depts, teams] = await Promise.all([
      Organizations.getAll(),
      Departments.getAll(),
      Teams.getAll(),
    ]);

    res.json({
      success: true,
      data: {
        organizations: orgs.length,
        departments: depts.length,
        teams: teams.length,
        departments_list: depts,
        teams_list: teams,
      },
      error: null,
    });
  } catch (err) {
    res.status(500).json({ success: false, data: null, error: { message: err.message } });
  }
});

export default router;
