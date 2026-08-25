/**
 * groups.js — Company-scoped group management
 */
import express from 'express';
import { authenticate, requireRole } from '../middleware/auth.js';
import { randomUUID } from 'crypto';
import UserStore from '../services/UserStore.js';
import { Groups } from '../services/DataStore.js';

const router = express.Router();

/**
 * GET /api/groups
 * Admin: list all groups for their company
 */
router.get('/', authenticate, requireRole('admin', 'manager'), async (req, res) => {
  try {
    const companyId = req.user.companyId || 'default';
    const isManager = req.user.role === 'manager';
    const all = await Groups.getAll();
    const groups = all.filter(g =>
      (g.companyId || 'default') === companyId &&
      (!isManager || g.managerId === req.user.userId)
    );

    // Enrich with current member count
    const allUsers = await UserStore.getAllUsers({});
    const enriched = groups.map(g => ({
      ...g,
      employeeCount: (g.employeeIds || []).length,
      managerName: g.managerName || (allUsers.find(u => (u.userId || u.id) === g.managerId)?.name || '—'),
    }));

    res.json({ success: true, data: { groups: enriched, total: enriched.length }, error: null });
  } catch (e) {
    console.error('[groups GET /]', e);
    res.status(500).json({ success: false, data: null, error: e.message });
  }
});

/**
 * GET /api/groups/:id
 * Get single group with full member details
 */
router.get('/:id', authenticate, requireRole('admin', 'manager'), async (req, res) => {
  try {
    const group = await Groups.getById(req.params.id);
    if (!group) return res.status(404).json({ success: false, data: null, error: 'Group not found' });
    if ((group.companyId || 'default') !== (req.user.companyId || 'default')) {
      return res.status(403).json({ success: false, data: null, error: 'Access denied' });
    }
    if (req.user.role === 'manager' && group.managerId !== req.user.userId) {
      return res.status(403).json({ success: false, data: null, error: 'Access denied — not your group' });
    }

    const allUsers = await UserStore.getAllUsers({});
    const companyId = req.user.companyId || 'default';
    const members = allUsers.filter(u =>
      (group.employeeIds || []).includes(u.userId || u.id) &&
      (u.companyId || 'default') === companyId
    ).map(u => ({
      userId: u.userId || u.id,
      name: u.name,
      email: u.email,
      jobRole: u.jobRole || '',
      role: u.role,
    }));

    const manager = allUsers.find(u => (u.userId || u.id) === group.managerId);

    res.json({
      success: true,
      data: {
        ...group,
        members,
        manager: manager ? { userId: manager.userId, name: manager.name, email: manager.email } : null,
      },
      error: null,
    });
  } catch (e) {
    res.status(500).json({ success: false, data: null, error: e.message });
  }
});

/**
 * POST /api/groups
 * Admin creates a group
 */
router.post('/', authenticate, requireRole('admin'), async (req, res) => {
  try {
    const { name, managerId, description, employeeIds = [] } = req.body;
    if (!name || !name.trim()) {
      return res.status(400).json({ success: false, data: null, error: 'Group name is required' });
    }

    const companyId = req.user.companyId || 'default';
    const allUsers = await UserStore.getAllUsers({});

    // Validate manager belongs to same company
    if (managerId) {
      const manager = allUsers.find(u => (u.userId || u.id) === managerId);
      if (!manager || (manager.companyId || 'default') !== companyId) {
        return res.status(400).json({ success: false, data: null, error: 'Manager must belong to your company' });
      }
    }

    // Validate all employees belong to same company
    for (const empId of employeeIds) {
      const emp = allUsers.find(u => (u.userId || u.id) === empId);
      if (!emp || (emp.companyId || 'default') !== companyId) {
        return res.status(400).json({ success: false, data: null, error: `Employee ${empId} does not belong to your company` });
      }
    }

    const manager = managerId ? allUsers.find(u => (u.userId || u.id) === managerId) : null;
    const group = {
      id: `group_${randomUUID().slice(0, 10)}`,
      name: name.trim(),
      description: description || '',
      managerId: managerId || null,
      managerName: manager?.name || '',
      employeeIds,
      companyId,
      createdBy: req.user.userId,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      status: 'active',
    };

    const saved = await Groups.create(group);
    res.status(201).json({ success: true, data: saved, error: null });
  } catch (e) {
    console.error('[groups POST /]', e);
    res.status(500).json({ success: false, data: null, error: e.message });
  }
});

/**
 * PUT /api/groups/:id
 * Admin updates a group
 */
router.put('/:id', authenticate, requireRole('admin'), async (req, res) => {
  try {
    const existing = await Groups.getById(req.params.id);
    if (!existing) return res.status(404).json({ success: false, data: null, error: 'Group not found' });
    if ((existing.companyId || 'default') !== (req.user.companyId || 'default')) {
      return res.status(403).json({ success: false, data: null, error: 'Access denied' });
    }

    const { name, managerId, description, employeeIds, status } = req.body;
    const companyId = req.user.companyId || 'default';
    const allUsers = await UserStore.getAllUsers({});

    const updates = { updatedAt: new Date().toISOString() };
    if (name) updates.name = name.trim();
    if (description !== undefined) updates.description = description;
    if (status) updates.status = status;

    if (managerId !== undefined) {
      if (managerId) {
        const manager = allUsers.find(u => (u.userId || u.id) === managerId);
        if (!manager || (manager.companyId || 'default') !== companyId) {
          return res.status(400).json({ success: false, data: null, error: 'Manager must belong to your company' });
        }
        updates.managerId = managerId;
        updates.managerName = manager.name;
      } else {
        updates.managerId = null;
        updates.managerName = '';
      }
    }

    if (employeeIds !== undefined) {
      for (const empId of employeeIds) {
        const emp = allUsers.find(u => (u.userId || u.id) === empId);
        if (!emp || (emp.companyId || 'default') !== companyId) {
          return res.status(400).json({ success: false, data: null, error: `Employee ${empId} does not belong to your company` });
        }
      }
      updates.employeeIds = employeeIds;
    }

    const updated = await Groups.update(req.params.id, updates);
    res.json({ success: true, data: updated || { ...existing, ...updates }, error: null });
  } catch (e) {
    res.status(500).json({ success: false, data: null, error: e.message });
  }
});

/**
 * DELETE /api/groups/:id
 * Admin deletes a group
 */
router.delete('/:id', authenticate, requireRole('admin'), async (req, res) => {
  try {
    const existing = await Groups.getById(req.params.id);
    if (!existing) return res.status(404).json({ success: false, data: null, error: 'Group not found' });
    if ((existing.companyId || 'default') !== (req.user.companyId || 'default')) {
      return res.status(403).json({ success: false, data: null, error: 'Access denied' });
    }
    await Groups.delete(req.params.id);
    res.json({ success: true, data: { deleted: true, id: req.params.id }, error: null });
  } catch (e) {
    res.status(500).json({ success: false, data: null, error: e.message });
  }
});

export default router;
