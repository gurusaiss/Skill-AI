// Routes for managing packages, skill packages, groups, and learning tracks
// Supports both Supabase and file-based fallback storage

import express from 'express';
import { randomUUID } from 'crypto';
import { authenticate, requireRole } from '../middleware/auth.js';

// Import DB operations
import * as db from '../db/store.js';

const router = express.Router();

// ─────────────────────────────────────────────────────────────────────
// PACKAGES
// ─────────────────────────────────────────────────────────────────────

/** GET /api/content/packages - Get all published packages */
router.get('/packages', authenticate, async (req, res) => {
  try {
    const { category, type, difficulty } = req.query;
    const filters = {};
    if (category) filters.category = category;
    if (type) filters.type = type;
    if (difficulty) filters.difficulty = difficulty;

    const packages = await db.getPackages(filters);
    res.json({ success: true, data: { packages, count: packages.length }, error: null });
  } catch (error) {
    console.error('[Routes] Get packages error:', error.message);
    res.status(500).json({ success: false, data: null, error: { code: 'FETCH_ERROR', message: 'Failed to fetch packages' } });
  }
});

/** GET /api/content/packages/:id - Get single package */
router.get('/packages/:id', authenticate, async (req, res) => {
  try {
    const pkg = await db.getModules(); // Fallback - list modules
    // For now, return modules as package content
    res.json({ success: true, data: { modules: pkg }, error: null });
  } catch (error) {
    res.status(500).json({ success: false, data: null, error: { message: error.message } });
  }
});

/** POST /api/content/packages - Create package (admin only) */
router.post('/packages', authenticate, requireRole('admin'), async (req, res) => {
  try {
    const { name, description, type, category, difficulty, estimated_duration, modules, skills_covered, prerequisites } = req.body;

    if (!name || !description) {
      return res.status(400).json({ success: false, data: null, error: { code: 'VALIDATION_ERROR', message: 'Name and description are required' } });
    }

    const userId = req.user.learning_uuid || req.user.userId;
    const newPkg = await db.createPackage({
      name,
      description,
      type: type || 'custom',
      category,
      difficulty: difficulty || 'beginner',
      estimated_duration: estimated_duration || '30 days',
      modules: modules || [],
      skills_covered: skills_covered || [],
      prerequisites: prerequisites || [],
    }, userId);

    await db.logAuthEvent('package_created', req.user.userId, { packageId: newPkg.id, name });

    res.status(201).json({ success: true, data: { package: newPkg }, error: null });
  } catch (error) {
    console.error('[Routes] Create package error:', error.message);
    res.status(500).json({ success: false, data: null, error: { code: 'CREATE_ERROR', message: 'Failed to create package' } });
  }
});

/** PUT /api/content/packages/:id - Update package (admin only) */
router.put('/packages/:id', authenticate, requireRole('admin'), async (req, res) => {
  try {
    const { id } = req.params;
    const updates = { ...req.body };
    delete updates.id;

    const updated = await db.updatePackage(id, updates);

    if (!updated) {
      return res.status(404).json({ success: false, data: null, error: { code: 'NOT_FOUND', message: 'Package not found' } });
    }

    res.json({ success: true, data: { package: updated }, error: null });
  } catch (error) {
    console.error('[Routes] Update package error:', error.message);
    res.status(500).json({ success: false, data: null, error: { message: 'Failed to update package' } });
  }
});

/** DELETE /api/content/packages/:id - Delete package (admin only) */
router.delete('/packages/:id', authenticate, requireRole('admin'), async (req, res) => {
  try {
    const { id } = req.params;
    const result = await db.deletePackage(id);

    if (!result) {
      return res.status(404).json({ success: false, data: null, error: { code: 'NOT_FOUND', message: 'Package not found' } });
    }

    await db.logAuthEvent('package_deleted', req.user.userId, { packageId: id });
    res.json({ success: true, data: { message: 'Package deleted' }, error: null });
  } catch (error) {
    console.error('[Routes] Delete package error:', error.message);
    res.status(500).json({ success: false, data: null, error: { message: 'Failed to delete package' } });
  }
});

// ─────────────────────────────────────────────────────────────────────
// SKILL PACKAGES
// ─────────────────────────────────────────────────────────────────────

/** GET /api/content/skill-packages - Get all published skill packages */
router.get('/skill-packages', authenticate, async (req, res) => {
  try {
    const { domain, difficulty } = req.query;
    const filters = {};
    if (domain) filters.domain = domain;
    if (difficulty) filters.difficulty = difficulty;

    const skillPackages = await db.getSkillPackages(filters);
    res.json({ success: true, data: { skillPackages, count: skillPackages.length }, error: null });
  } catch (error) {
    console.error('[Routes] Get skill packages error:', error.message);
    res.status(500).json({ success: false, data: null, error: { message: 'Failed to fetch skill packages' } });
  }
});

/** POST /api/content/skill-packages - Create skill package (admin only) */
router.post('/skill-packages', authenticate, requireRole('admin'), async (req, res) => {
  try {
    const { name, description, domain, target_role, skills, estimated_duration, difficulty } = req.body;

    if (!name || !description) {
      return res.status(400).json({ success: false, data: null, error: { code: 'VALIDATION_ERROR', message: 'Name and description are required' } });
    }

    const userId = req.user.learning_uuid || req.user.userId;
    const newPkg = await db.createSkillPackage({
      name,
      description,
      domain,
      target_role,
      skills: skills || [],
      estimated_duration: estimated_duration || '14 days',
      difficulty: difficulty || 'intermediate',
    }, userId);

    await db.logAuthEvent('skill_package_created', req.user.userId, { skillPackageId: newPkg.id, name });

    res.status(201).json({ success: true, data: { skillPackage: newPkg }, error: null });
  } catch (error) {
    console.error('[Routes] Create skill package error:', error.message);
    res.status(500).json({ success: false, data: null, error: { message: 'Failed to create skill package' } });
  }
});

/** PUT /api/content/skill-packages/:id - Update skill package (admin only) */
router.put('/skill-packages/:id', authenticate, requireRole('admin'), async (req, res) => {
  try {
    const { id } = req.params;
    const updates = { ...req.body };
    delete updates.id;

    const updated = await db.updateSkillPackage(id, updates);

    if (!updated) {
      return res.status(404).json({ success: false, data: null, error: { code: 'NOT_FOUND', message: 'Skill package not found' } });
    }

    res.json({ success: true, data: { skillPackage: updated }, error: null });
  } catch (error) {
    console.error('[Routes] Update skill package error:', error.message);
    res.status(500).json({ success: false, data: null, error: { message: 'Failed to update skill package' } });
  }
});

// ─────────────────────────────────────────────────────────────────────
// LEARNING TRACKS
// ─────────────────────────────────────────────────────────────────────

/** GET /api/content/learning-tracks - Get all published learning tracks */
router.get('/learning-tracks', authenticate, async (req, res) => {
  try {
    const { track_type, difficulty } = req.query;
    const filters = {};
    if (track_type) filters.track_type = track_type;
    if (difficulty) filters.difficulty = difficulty;

    const tracks = await db.getLearningTracks(filters);
    res.json({ success: true, data: { tracks, count: tracks.length }, error: null });
  } catch (error) {
    console.error('[Routes] Get learning tracks error:', error.message);
    res.status(500).json({ success: false, data: null, error: { message: 'Failed to fetch learning tracks' } });
  }
});

/** POST /api/content/learning-tracks - Create learning track (admin only) */
router.post('/learning-tracks', authenticate, requireRole('admin'), async (req, res) => {
  try {
    const { name, description, goal, track_type, package_id, skill_package_id, stages, total_days, difficulty } = req.body;

    if (!name || !description) {
      return res.status(400).json({ success: false, data: null, error: { code: 'VALIDATION_ERROR', message: 'Name and description are required' } });
    }

    const userId = req.user.learning_uuid || req.user.userId;
    const newTrack = await db.createLearningTrack({
      name,
      description,
      goal,
      track_type: track_type || 'guided',
      package_id,
      skill_package_id,
      stages: stages || [],
      total_days: total_days || 21,
      difficulty: difficulty || 'beginner',
    }, userId);

    await db.logAuthEvent('learning_track_created', req.user.userId, { trackId: newTrack.id, name });

    res.status(201).json({ success: true, data: { learningTrack: newTrack }, error: null });
  } catch (error) {
    console.error('[Routes] Create learning track error:', error.message);
    res.status(500).json({ success: false, data: null, error: { message: 'Failed to create learning track' } });
  }
});

// ─────────────────────────────────────────────────────────────────────
// GROUPS
// ─────────────────────────────────────────────────────────────────────

/** GET /api/content/groups - Get all groups */
router.get('/groups', authenticate, async (req, res) => {
  try {
    const groups = await db.getGroups();
    res.json({ success: true, data: { groups: groups || [] }, error: null });
  } catch (error) {
    res.status(500).json({ success: false, data: null, error: { message: 'Failed to fetch groups' } });
  }
});

/** POST /api/content/groups - Create group (admin/manager only) */
router.post('/groups', authenticate, requireRole('admin', 'manager'), async (req, res) => {
  try {
    const { name, description, department } = req.body;

    if (!name) {
      return res.status(400).json({ success: false, data: null, error: { message: 'Group name is required' } });
    }

    const group = await db.createGroup({
      id: randomUUID(),
      name,
      description: description || '',
      department: department || '',
      created_by: req.user.userId,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });

    await db.logAuthEvent('group_created', req.user.userId, { groupId: group.id, name });

    res.status(201).json({ success: true, data: { group }, error: null });
  } catch (error) {
    console.error('[Routes] Create group error:', error.message);
    res.status(500).json({ success: false, data: null, error: { message: 'Failed to create group' } });
  }
});

/** POST /api/content/groups/:groupId/members - Add members to group (admin/manager) */
router.post('/groups/:groupId/members', authenticate, requireRole('admin', 'manager'), async (req, res) => {
  try {
    const { groupId } = req.params;
    const { userIds, roleInGroup } = req.body;

    if (!userIds || !Array.isArray(userIds) || userIds.length === 0) {
      return res.status(400).json({ success: false, data: null, error: { message: 'userIds array is required' } });
    }

    const memberships = await db.addGroupMembers(groupId, userIds, roleInGroup || 'member');

    res.status(201).json({ success: true, data: { memberships }, error: null });
  } catch (error) {
    console.error('[Routes] Add group members error:', error.message);
    res.status(500).json({ success: false, data: null, error: { message: 'Failed to add members' } });
  }
});

export default router;