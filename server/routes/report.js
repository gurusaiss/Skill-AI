import express from 'express';
import SmartAgent from '../agent/SmartAgent.js';
import { authenticate } from '../middleware/auth.js';
import UserStore from '../services/UserStore.js';

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
      error: error.message
    });
  }
});

/**
 * GET /api/report/all
 * Admin: list all employees with their assignment completion data
 */
router.get('/all', authenticate, async (req, res) => {
  try {
    if (req.user.role !== 'admin' && req.user.role !== 'manager') {
      return res.status(403).json({ success: false, data: null, error: 'Admin or manager access required' });
    }

    const UserStore = (await import('../services/UserStore.js')).default;
    const db = await import('../db/store.js');

    const [users, assignmentsRaw] = await Promise.allSettled([
      UserStore.getAllUsers(),
      db.getAssignments(),
    ]);

    const allUsers = users.status === 'fulfilled' ? (users.value || []) : [];
    const allAssignments = assignmentsRaw.status === 'fulfilled' ? (assignmentsRaw.value || []) : [];

    let targetUsers;
    if (req.user.role === 'admin') {
      targetUsers = allUsers.filter(u => u.role === 'employee');
    } else {
      // Manager: only show their assigned employees
      const UserStoreImport = (await import('../services/UserStore.js')).default;
      const managerEmployees = await UserStoreImport.getManagerEmployees(req.user.userId);
      const managerEmpIds = new Set(managerEmployees.map(e => e.userId || e.id));
      targetUsers = allUsers.filter(u => u.role === 'employee' && managerEmpIds.has(u.userId || u.id));
    }

    const reports = targetUsers.map(u => {
      const uid = u.userId || u.id;
      const userAssignments = allAssignments.filter(a =>
        (a.assigned_to_user || a.employee_id) === uid
      );
      const completed = userAssignments.filter(a => a.status === 'completed');
      const completionRate = userAssignments.length > 0
        ? Math.round((completed.length / userAssignments.length) * 100)
        : 0;

      return {
        userId: uid,
        employeeName: u.name || u.email || 'Unknown',
        email: u.email || '',
        totalAssignments: userAssignments.length,
        completedAssignments: completed.length,
        completionRate,
        lastActivity: userAssignments.reduce((latest, a) => {
          const d = a.updated_at || a.created_at;
          return (!latest || (d && d > latest)) ? d : latest;
        }, null),
        assignments: userAssignments.map(a => ({
          id: a.id,
          moduleName: a.title || a.name || 'Unknown Module',
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
    res.status(500).json({ success: false, data: null, error: error.message });
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
        error: error.message
      });
    }

    res.status(500).json({
      success: false,
      data: null,
      error: error.message
    });
  }
});

export default router;
