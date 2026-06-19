/**
 * adminDashboard.js — Live admin dashboard stats with company isolation
 */
import express from 'express';
import { authenticate, requireRole } from '../middleware/auth.js';
import UserStore from '../services/UserStore.js';
import { Companies, ApprovalRequests, AccessCodes } from '../services/DataStore.js';
import { randomUUID } from 'crypto';
import * as db from '../db/store.js';

const router = express.Router();

/**
 * GET /api/admin/dashboard
 * Live stats for admin's company
 */
router.get('/dashboard', authenticate, requireRole('admin'), async (req, res) => {
  try {
    const companyId = req.user.companyId || 'default';

    // 1. Company info
    const companies = await Companies.getAll();
    const company = companies.find(c => c.id === companyId) || {
      id: companyId,
      name: 'Your Company',
      plan: 'standard',
      status: 'active',
      domain: '',
    };

    // 2. Users for this company
    const allUsers = await UserStore.getAllUsers({});
    const companyUsers = allUsers.filter(u =>
      (u.companyId || 'default') === companyId && u.role !== 'superadmin'
    );
    const employees = companyUsers.filter(u => u.role === 'employee');
    const managers = companyUsers.filter(u => u.role === 'manager');
    const companyUserIds = new Set(companyUsers.map(u => u.userId || u.id));

    // 3. Assignments for company users
    const [assignmentsRaw, modulesRaw, requestsRaw, approvalsRaw] = await Promise.allSettled([
      UserStore.getAssignments({}),
      db.getModules(),
      UserStore.getAssignmentRequests({}),
      ApprovalRequests.getAll(),
    ]);

    const allAssignments = assignmentsRaw.status === 'fulfilled' ? (assignmentsRaw.value || []) : [];
    const allModules = modulesRaw.status === 'fulfilled' ? (modulesRaw.value || []) : [];
    const allRequests = requestsRaw.status === 'fulfilled' ? (requestsRaw.value || []) : [];
    const allApprovals = approvalsRaw.status === 'fulfilled' ? (approvalsRaw.value || []) : [];

    const companyAssignments = allAssignments.filter(a => companyUserIds.has(a.assigned_to_user));
    const completedAssignments = companyAssignments.filter(a => a.status === 'completed');
    const activeAssignments = companyAssignments.filter(a => a.status === 'in_progress');
    const pendingAssignments = companyAssignments.filter(a => a.status === 'assigned');
    const completionRate = companyAssignments.length > 0
      ? Math.round((completedAssignments.length / companyAssignments.length) * 100)
      : 0;

    // 4. Pending requests (both types)
    const pendingAssignmentRequests = allRequests.filter(r =>
      r.status === 'pending' && companyUserIds.has(r.manager_id)
    );
    const pendingApprovals = allApprovals.filter(a =>
      a.status === 'pending' && a.companyId === companyId
    );
    const totalPendingApprovals = pendingAssignmentRequests.length + pendingApprovals.length;

    // 5. Active users (last 30 days)
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
    const activeUsers = companyUsers.filter(u => u.lastLogin && u.lastLogin > thirtyDaysAgo).length;

    // 6. Modules count (global + company-specific)
    const companyModules = allModules.filter(m => !m.companyId || m.companyId === companyId);

    // 7. Recent activity: latest user logins + assignment completions
    const recentActivity = [
      ...companyUsers
        .filter(u => u.lastLogin)
        .map(u => ({ type: 'login', userId: u.userId, name: u.name, role: u.role, time: u.lastLogin })),
      ...companyAssignments
        .filter(a => a.status === 'completed' && a.updated_at)
        .map(a => {
          const u = companyUsers.find(u => (u.userId || u.id) === a.assigned_to_user);
          return { type: 'completed', userId: a.assigned_to_user, name: u?.name || 'Unknown', role: 'employee', time: a.updated_at };
        }),
    ]
      .sort((a, b) => (b.time || '') > (a.time || '') ? 1 : -1)
      .slice(0, 10);

    res.json({
      success: true,
      data: {
        company,
        stats: {
          totalUsers: companyUsers.length,
          employees: employees.length,
          managers: managers.length,
          totalModules: companyModules.length,
          totalAssignments: companyAssignments.length,
          completedAssignments: completedAssignments.length,
          activeAssignments: activeAssignments.length,
          pendingAssignments: pendingAssignments.length,
          completionRate,
          activeUsers,
          pendingApprovals: totalPendingApprovals,
        },
        recentActivity,
      },
      error: null,
    });
  } catch (e) {
    console.error('[admin/dashboard]', e);
    res.status(500).json({ success: false, data: null, error: e.message });
  }
});

// ── Access Code Management (company-scoped, admin/manager) ───────────────────

const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
function randSuffix(len = 4) {
  return Array.from({ length: len }, () => CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)]).join('');
}

/**
 * GET /api/admin/codes
 * List all access codes for the admin's company
 */
router.get('/codes', authenticate, requireRole('admin', 'manager'), async (req, res) => {
  try {
    const companyId = req.user.companyId || 'default';
    const codes = await AccessCodes.getByCompany(companyId);
    res.json({ success: true, data: codes || [], error: null });
  } catch (e) {
    res.status(500).json({ success: false, data: null, error: e.message });
  }
});

/**
 * POST /api/admin/codes
 * Create additional access code (admin only)
 */
router.post('/codes', authenticate, requireRole('admin'), async (req, res) => {
  try {
    const companyId = req.user.companyId || 'default';
    const { role = 'employee', label, maxUsage, expiresAt } = req.body;
    if (!['manager', 'employee'].includes(role)) {
      return res.status(400).json({ success: false, data: null, error: 'role must be manager or employee' });
    }
    const company = await Companies.getById(companyId);
    const initials = (company?.name || 'CO').trim().split(/\s+/).map(w => w[0]?.toUpperCase()).filter(Boolean).slice(0, 3).join('');
    const all = await AccessCodes.getAll();
    const usedCodes = new Set((all || []).map(c => c.code));
    const pfx = (initials || 'CO').slice(0, 3);
    const typeTag = role === 'manager' ? 'MGR' : 'EMP';
    let code;
    do { code = `${pfx}-${typeTag}-${randSuffix()}`; } while (usedCodes.has(code));
    const now = new Date().toISOString();
    const doc = { id: randomUUID(), companyId, code, role, isActive: true, usageCount: 0, maxUsage: maxUsage || null, expiresAt: expiresAt || null, label: label || `${role === 'manager' ? 'Manager' : 'Employee'} Code`, createdBy: req.user.userId, createdAt: now, updatedAt: now };
    const saved = await AccessCodes.create(doc);
    res.status(201).json({ success: true, data: saved || doc, error: null });
  } catch (e) {
    res.status(500).json({ success: false, data: null, error: e.message });
  }
});

/**
 * PUT /api/admin/codes/:codeId
 * Update code (disable, regenerate, set expiry) — admin only
 */
router.put('/codes/:codeId', authenticate, requireRole('admin'), async (req, res) => {
  try {
    const companyId = req.user.companyId || 'default';
    const existing = await AccessCodes.getById(req.params.codeId);
    if (!existing || existing.companyId !== companyId) {
      return res.status(404).json({ success: false, data: null, error: 'Code not found' });
    }
    const { isActive, label, maxUsage, expiresAt, regenerate } = req.body;
    const updates = { updatedAt: new Date().toISOString() };
    if (isActive !== undefined) updates.isActive = Boolean(isActive);
    if (label !== undefined) updates.label = label;
    if (maxUsage !== undefined) updates.maxUsage = maxUsage;
    if (expiresAt !== undefined) updates.expiresAt = expiresAt;
    if (regenerate) {
      const all = await AccessCodes.getAll();
      const usedCodes = new Set((all || []).filter(c => c.id !== existing.id).map(c => c.code));
      const company = await Companies.getById(companyId);
      const initials = (company?.name || 'CO').trim().split(/\s+/).map(w => w[0]?.toUpperCase()).filter(Boolean).slice(0, 3).join('');
      const pfx = (initials || 'CO').slice(0, 3);
      const typeTag = existing.role === 'manager' ? 'MGR' : 'EMP';
      let newCode;
      do { newCode = `${pfx}-${typeTag}-${randSuffix()}`; } while (usedCodes.has(newCode));
      updates.code = newCode;
      updates.usageCount = 0;
    }
    const updated = await AccessCodes.update(req.params.codeId, updates);
    res.json({ success: true, data: updated || { ...existing, ...updates }, error: null });
  } catch (e) {
    res.status(500).json({ success: false, data: null, error: e.message });
  }
});

/**
 * DELETE /api/admin/codes/:codeId
 * Delete an access code (admin only)
 */
router.delete('/codes/:codeId', authenticate, requireRole('admin'), async (req, res) => {
  try {
    const companyId = req.user.companyId || 'default';
    const existing = await AccessCodes.getById(req.params.codeId);
    if (!existing || existing.companyId !== companyId) {
      return res.status(404).json({ success: false, data: null, error: 'Code not found' });
    }
    await AccessCodes.delete(req.params.codeId);
    res.json({ success: true, data: { deleted: true }, error: null });
  } catch (e) {
    res.status(500).json({ success: false, data: null, error: e.message });
  }
});

export default router;
