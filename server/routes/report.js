import express from 'express';
import SmartAgent from '../agent/SmartAgent.js';
import { authenticate } from '../middleware/auth.js';
import UserStore from '../services/UserStore.js';
import { getVisibleEmployeeIds, canActAsManager } from '../services/ManagerScope.js';

const router = express.Router();
const agent = new SmartAgent();

/**
 * POST /api/report/generate
 * Generate report for user
 */
router.post('/generate', authenticate, async (req, res) => {
  try {
    const { userId } = req.body;

    if (!userId) {
      return res.status(400).json({
        success: false,
        data: null,
        error: 'userId is required'
      });
    }

    // Authorization: users can only generate their own report, admins can generate any
    if (req.user.role !== 'admin' && req.user.userId !== userId) {
      return res.status(403).json({
        success: false,
        data: null,
        error: 'Access denied'
      });
    }

    const user = await UserStore.getUserById(req.user.userId);
    const report = await agent.generateReport(user.learningUUID);

    res.json({
      success: true,
      data: report,
      error: null
    });
  } catch (error) {
    console.error('[POST /api/report/generate]', error);
    res.status(500).json({
      success: false,
      data: null,
      error: 'Failed to generate report'
    });
  }
});

/**
 * GET /api/report/all
 * Admin: list all employees with their assignment completion data
 */
router.get('/all', authenticate, async (req, res) => {
  try {
    // Raw role check previously hard-rejected an access-grant manager
    // (primary role employee, accesses:['manager']) even though they pass
    // this same check everywhere else in the app.
    if (req.user.role !== 'admin' && req.user.role !== 'superadmin' && !canActAsManager(req.user)) {
      return res.status(403).json({ success: false, data: null, error: 'Admin or manager access required' });
    }

    const UserStore = (await import('../services/UserStore.js')).default;
    const db = await import('../db/store.js');

    const [users, assignmentsRaw, modulesRaw] = await Promise.allSettled([
      UserStore.getAllUsers(),
      db.getAssignments(),
      db.getModules(),
    ]);

    const allUsers = users.status === 'fulfilled' ? (users.value || []) : [];
    const allAssignments = assignmentsRaw.status === 'fulfilled' ? (assignmentsRaw.value || []) : [];
    const allModules = modulesRaw.status === 'fulfilled' ? (modulesRaw.value || []) : [];

    // Build a quick lookup map: moduleId → title
    const moduleNameMap = {};
    (Array.isArray(allModules) ? allModules : allModules.modules || []).forEach(m => {
      const id = m.id || m.module_id;
      if (id) moduleNameMap[id] = m.title || m.name || 'Unknown Module';
    });

    let targetUsers;
    if (req.user.role === 'admin' || req.user.role === 'superadmin') {
      const adminCompanyId = req.user.companyId || 'default';
      targetUsers = allUsers.filter(u =>
        u.role === 'employee' &&
        (adminCompanyId === 'default' || (u.companyId || 'default') === adminCompanyId)
      );
    } else {
      // Manager: union of Groups membership AND the durable manager_id path
      // (getVisibleEmployeeIds) — this was Groups-only, so an employee linked
      // via the Assign Manager dropdown or bulk import (which only ever set
      // manager_id, never created a Group) never appeared in this manager's
      // module/assignment report list, even though the assessment-report
      // list next to it (already fixed) showed them correctly.
      const managerCompanyId = req.user.companyId || 'default';
      const managerEmpIds = await getVisibleEmployeeIds(req.user);
      targetUsers = managerEmpIds.size === 0
        ? []
        : allUsers.filter(u =>
            u.role === 'employee' &&
            managerEmpIds.has(u.userId || u.id) &&
            (managerCompanyId === 'default' || (u.companyId || 'default') === managerCompanyId)
          );
    }

    const reports = targetUsers.map(u => {
      const uid = u.userId || u.id;
      const userAssignments = allAssignments.filter(a =>
        (a.assigned_to_user || a.employee_id) === uid
      );

      // Deduplicate to ensure each module displays ONLY its single latest status
      const uniqueMap = new Map();
      const statusRank = { completed: 3, in_progress: 2, ongoing: 2, assigned: 1, pending: 1, cancelled: 0 };
      for (const a of userAssignments) {
        const modKey = String(a.assignable_id || a.module_id || a.id).trim().toLowerCase();
        const existing = uniqueMap.get(modKey);
        if (!existing) {
          uniqueMap.set(modKey, a);
        } else {
          const candRank = statusRank[String(a.status || '').toLowerCase()] ?? 1;
          const existRank = statusRank[String(existing.status || '').toLowerCase()] ?? 1;
          if (candRank > existRank) {
            uniqueMap.set(modKey, a);
          } else if (candRank === existRank) {
            const candTime = new Date(a.updated_at || a.completed_at || a.created_at || 0).getTime();
            const existTime = new Date(existing.updated_at || existing.completed_at || existing.created_at || 0).getTime();
            if (candTime >= existTime) uniqueMap.set(modKey, a);
          }
        }
      }
      const dedupedAssignments = [...uniqueMap.values()];
      const completed = dedupedAssignments.filter(a => a.status === 'completed');
      const completionRate = dedupedAssignments.length > 0
        ? Math.round((completed.length / dedupedAssignments.length) * 100)
        : 0;

      return {
        userId: uid,
        employeeName: u.name || u.email || 'Unknown',
        email: u.email || '',
        totalAssignments: dedupedAssignments.length,
        completedAssignments: completed.length,
        completionRate,
        lastActivity: dedupedAssignments.reduce((latest, a) => {
          const d = a.updated_at || a.created_at;
          return (!latest || (d && d > latest)) ? d : latest;
        }, null),
        jobRole: u.jobRole || u.job_role || '',
        assignments: dedupedAssignments.map(a => ({
          id: a.id,
          // Resolve module name from the module lookup map
          moduleName: a.module_name || a.title || a.name
            || moduleNameMap[a.assignable_id || a.module_id]
            || a.assignable_type || 'Unknown Module',
          assignableId: a.assignable_id,
          assignableType: a.assignable_type,
          status: a.status,
          progress: a.progress || 0,
          dueDate: a.due_date,
          priority: a.priority,
        })),
      };
    });

    res.json({ success: true, data: { reports, total: reports.length }, error: null });
  } catch (error) {
    console.error('[GET /api/report/all]', error);
    res.status(500).json({ success: false, data: null, error: 'Failed to load reports' });
  }
});

/**
 * GET /api/report/:userId
 * Get report for user
 */
router.get('/:userId', authenticate, async (req, res) => {
  try {
    const { userId } = req.params;

    // Authorization: users can only view their own report, admins can view any
    if (req.user.role !== 'admin' && req.user.userId !== userId) {
      return res.status(403).json({
        success: false,
        data: null,
        error: 'Access denied'
      });
    }

    const user = await UserStore.getUserById(req.user.userId);
    const session = await agent.loadSession(user.learningUUID);

    if (!session.report) {
      return res.status(404).json({
        success: false,
        data: null,
        error: 'Report not yet generated'
      });
    }

    res.json({
      success: true,
      data: session.report,
      error: null
    });
  } catch (error) {
    console.error('[GET /api/report/:userId]', error);

    if (error.message.includes('not found')) {
      return res.status(404).json({
        success: false,
        data: null,
        error: 'Report not found'
      });
    }

    res.status(500).json({
      success: false,
      data: null,
      error: 'Failed to load report'
    });
  }
});

export default router;
