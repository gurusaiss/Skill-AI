/**
 * adminDashboard.js — Live admin dashboard stats with company isolation
 */
import express from 'express';
import { authenticate, requireRole } from '../middleware/auth.js';
import UserStore from '../services/UserStore.js';
import { Companies, ApprovalRequests, AccessCodes, Groups, Assessments, Reports } from '../services/DataStore.js';
import { randomUUID } from 'crypto';
import * as db from '../db/store.js';
import { MANAGER_TIER_ROLES } from '../services/roleCapability.js';
import { ratingForReport, ratingDistribution } from '../services/grading.js';

const router = express.Router();

/**
 * GET /api/admin/export
 * Full company data export (admin only) — users, modules, assignments,
 * groups, assessments, and reports scoped to the admin's own company.
 * Intended as a manual backup/portability mechanism: the platform previously
 * had no way for an admin to independently verify or export their own data
 * outside of per-assessment report downloads.
 */
router.get('/export', authenticate, requireRole('admin'), async (req, res) => {
  try {
    const companyId = req.user.companyId || 'default';
    const inCompany = (c) => (c || 'default') === companyId;

    const [allUsers, allModules, allAssignments, allGroups, allAssessments, allReports] = await Promise.all([
      UserStore.getAllUsers({}),
      db.getModules({}),
      UserStore.getAssignments({}),
      Groups.getAll(),
      Assessments.getAll(),
      Reports.getAll(),
    ]);

    const users = (allUsers || []).filter(u => inCompany(u.companyId)).map(u => {
      const { passwordHash, otp, otpExpires, resetToken, resetTokenExpires, ...safe } = u;
      return safe;
    });
    const companyUserIds = new Set(users.map(u => u.userId || u.id));

    const modulesList = (Array.isArray(allModules) ? allModules : allModules?.modules || [])
      .filter(m => !m.companyId || inCompany(m.companyId));
    const moduleIds = new Set(modulesList.map(m => m.id));

    const assignments = (allAssignments || []).filter(a =>
      companyUserIds.has(a.assigned_to_user) || companyUserIds.has(a.assigned_by)
    );
    const groups = (allGroups || []).filter(g => inCompany(g.companyId));
    const assessments = (allAssessments || []).filter(a => inCompany(a.companyId));
    const reports = (allReports || []).filter(r => inCompany(r.companyId));

    await UserStore.logAuthEvent('data_export', req.user.userId, {
      companyId, counts: { users: users.length, modules: modulesList.length, assignments: assignments.length, groups: groups.length, assessments: assessments.length, reports: reports.length },
      ipAddress: req.ip,
    });

    res.setHeader('Content-Disposition', `attachment; filename="skillforge-export-${companyId}-${new Date().toISOString().slice(0, 10)}.json"`);
    res.json({
      success: true,
      data: {
        exportedAt: new Date().toISOString(),
        companyId,
        users,
        modules: modulesList,
        assignments,
        groups,
        assessments,
        reports,
      },
      error: null,
    });
  } catch (error) {
    console.error('[admin/export] error:', error.message);
    res.status(500).json({ success: false, data: null, error: 'Failed to export data' });
  }
});

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
      name: '',
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
    const managers = companyUsers.filter(u => MANAGER_TIER_ROLES.includes(u.role));
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
    // DEFINITIONS (kept identical on every dashboard):
    //  - cancelled assignments are excluded from every rate.
    //  - completionRate = completed / non-cancelled assignments.
    //  - avgProgress    = mean progress (completed counts as 100) over non-cancelled assignments.
    const liveAssignments = companyAssignments.filter(a => a.status !== 'cancelled');
    const completionRate = liveAssignments.length > 0
      ? Math.round((completedAssignments.length / liveAssignments.length) * 100)
      : 0;
    const avgProgress = liveAssignments.length > 0
      ? Math.round(liveAssignments.reduce((sum, a) => sum + (a.status === 'completed' ? 100 : Math.min(100, Math.max(0, Number(a.progress) || 0))), 0) / liveAssignments.length)
      : 0;
    const cancelledAssignments = companyAssignments.length - liveAssignments.length;

    // 4. Pending requests (both types)
    const pendingAssignmentRequests = allRequests.filter(r =>
      r.status === 'pending' && companyUserIds.has(r.manager_id)
    );
    const pendingApprovals = allApprovals.filter(a =>
      a.status === 'pending' && a.companyId === companyId
    );
    const totalPendingApprovals = pendingAssignmentRequests.length + pendingApprovals.length;

    // Assessments: distinct (assessmentId,userId) pairs, latest report per pair
    let assessmentsCompleted = 0;
    let avgAssessmentScore = null;
    // Rating distribution (Expert / Intermediate / Basic / No Rating) of the latest report per employee+assessment.
    let assessmentRatings = ratingDistribution([]);
    // Real activity per day for the last 7 days (oldest first), local server time.
    const dayKey = (d) => `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
    const weeklyActivity = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() - i);
      weeklyActivity.push({ key: dayKey(d), day: d.toLocaleDateString('en-US', { weekday: 'short' }), completions: 0, submissions: 0 });
    }
    const bumpDay = (iso, field) => {
      if (!iso) return;
      const t = new Date(iso);
      if (isNaN(t.getTime())) return;
      const slot = weeklyActivity.find(w => w.key === dayKey(t));
      if (slot) slot[field]++;
    };
    companyAssignments.filter(a => a.status === 'completed').forEach(a => bumpDay(a.updated_at, 'completions'));
    try {
      const reports = (await Reports.getAll()) || [];
      reports.filter(r => companyUserIds.has(r.userId)).forEach(r => bumpDay(r.submittedAt || r.generatedAt, 'submissions'));
      const latest = new Map();
      for (const r of reports) {
        if (!companyUserIds.has(r.userId)) continue;
        const k = `${r.assessmentId}|${r.userId}`;
        const t = r.submittedAt || r.generatedAt || '';
        const prev = latest.get(k);
        if (!prev || t >= (prev.submittedAt || prev.generatedAt || '')) latest.set(k, r);
      }
      const rows = [...latest.values()];
      assessmentsCompleted = rows.length;
      const scores = rows.map(r => Number(r.rawScore ?? r.score)).filter(n => Number.isFinite(n));
      assessmentRatings = ratingDistribution(rows.map(r => ratingForReport(r)));
      if (scores.length) avgAssessmentScore = Math.round(scores.reduce((a, b) => a + b, 0) / scores.length);
    } catch (e) { console.warn('[admin/dashboard] reports stats failed:', e.message); }

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
          cancelledAssignments,
          completionRate,
          avgProgress,
          assessmentsCompleted,
          avgAssessmentScore,
          assessmentRatings,
          topRatingSharePct: assessmentsCompleted ? Math.round(((assessmentRatings[0].count + assessmentRatings[1].count) / assessmentsCompleted) * 100) : null,
          pendingRequests: pendingAssignmentRequests.length,
          admins: companyUsers.filter(u => u.role === 'admin').length,
          otherRoles: companyUsers.length - employees.length - managers.length - companyUsers.filter(u => u.role === 'admin').length,
          weeklyActivity: weeklyActivity.map(({ key, ...rest }) => rest),
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
