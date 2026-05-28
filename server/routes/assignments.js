import express from 'express';
import { authenticate, requireRole } from '../middleware/auth.js';
import UserStore from '../services/UserStore.js';
import * as db from '../db/store.js';

const router = express.Router();

/**
 * POST /api/assignments/manager/:managerId/employees
 * Assign employees to a manager (admin only)
 */
router.post('/manager/:managerId/employees', authenticate, requireRole('admin'), async (req, res) => {
  try {
    const { managerId } = req.params;
    const { employeeIds } = req.body;

    if (!employeeIds || !Array.isArray(employeeIds) || employeeIds.length === 0) {
      return res.status(400).json({
        success: false,
        data: null,
        error: { code: 'ASSIGNMENT_INVALID_INPUT', message: 'employeeIds must be a non-empty array' },
      });
    }

    const assignments = await UserStore.assignEmployeesToManager(managerId, employeeIds, req.user.userId);

    await UserStore.logAuthEvent('manager_assigned', managerId, {
      assignedBy: req.user.userId,
      managerId,
      employeeIds,
      assignmentCount: assignments.length,
      ipAddress: req.ip,
    });

    res.status(201).json({
      success: true,
      data: {
        assignments,
        message: `Successfully assigned ${assignments.length} employee(s) to manager`,
      },
      error: null,
    });
  } catch (error) {
    if (error.message.includes('not found') || error.message.includes('role')) {
      return res.status(400).json({
        success: false,
        data: null,
        error: { code: 'ASSIGNMENT_VALIDATION_ERROR', message: error.message },
      });
    }
    console.error('[Assignment Routes] Assign employees error:', error.message);
    res.status(500).json({
      success: false,
      data: null,
      error: { code: 'ASSIGNMENT_ERROR', message: 'Failed to assign employees' },
    });
  }
});

/**
 * DELETE /api/assignments/manager/:managerId/employee/:employeeId
 * Remove employee from manager (admin only)
 */
router.delete('/manager/:managerId/employee/:employeeId', authenticate, requireRole('admin'), async (req, res) => {
  try {
    const { managerId, employeeId } = req.params;

    await UserStore.removeEmployeeFromManager(managerId, employeeId);

    await UserStore.logAuthEvent('manager_removed', managerId, {
      removedBy: req.user.userId,
      managerId,
      employeeId,
      ipAddress: req.ip,
    });

    res.json({
      success: true,
      data: { message: 'Employee removed from manager successfully' },
      error: null,
    });
  } catch (error) {
    if (error.message === 'Assignment not found') {
      return res.status(404).json({
        success: false,
        data: null,
        error: { code: 'ASSIGNMENT_NOT_FOUND', message: 'Assignment not found' },
      });
    }
    console.error('[Assignment Routes] Remove employee error:', error.message);
    res.status(500).json({
      success: false,
      data: null,
      error: { code: 'ASSIGNMENT_ERROR', message: 'Failed to remove employee' },
    });
  }
});

/**
 * GET /api/assignments/manager/:managerId/employees
 * Get manager's assigned employees (self or admin)
 */
router.get('/manager/:managerId/employees', authenticate, async (req, res) => {
  try {
    const { managerId } = req.params;

    if (req.user.userId !== managerId && req.user.role !== 'admin') {
      return res.status(403).json({
        success: false,
        data: null,
        error: { code: 'AUTH_FORBIDDEN', message: 'You can only view your own assigned employees' },
      });
    }

    const employees = await UserStore.getManagerEmployees(managerId);

    const sanitizedEmployees = employees.map(emp => ({
      userId: emp.userId || emp.id,
      email: emp.email,
      name: emp.name,
      role: emp.role,
      learningUUID: emp.learningUUID,
      emailVerified: emp.emailVerified,
      createdAt: emp.createdAt,
      lastLogin: emp.lastLogin,
    }));

    res.json({
      success: true,
      data: {
        managerId,
        employees: sanitizedEmployees,
        count: sanitizedEmployees.length,
      },
      error: null,
    });
  } catch (error) {
    console.error('[Assignment Routes] Get manager employees error:', error.message);
    res.status(500).json({
      success: false,
      data: null,
      error: { code: 'ASSIGNMENT_ERROR', message: 'Failed to get assigned employees' },
    });
  }
});

/**
 * GET /api/assignments/employee/:employeeId/manager
 * Get employee's assigned manager(s) (self or admin)
 */
router.get('/employee/:employeeId/manager', authenticate, async (req, res) => {
  try {
    const { employeeId } = req.params;

    if (req.user.userId !== employeeId && req.user.role !== 'admin') {
      return res.status(403).json({
        success: false,
        data: null,
        error: { code: 'AUTH_FORBIDDEN', message: 'You can only view your own assigned manager' },
      });
    }

    const managers = await UserStore.getEmployeeManagers(employeeId);

    const sanitizedManagers = managers.map(mgr => ({
      userId: mgr.userId || mgr.id,
      email: mgr.email,
      name: mgr.name,
      role: mgr.role,
      createdAt: mgr.createdAt,
    }));

    res.json({
      success: true,
      data: {
        employeeId,
        managers: sanitizedManagers,
        count: sanitizedManagers.length,
      },
      error: null,
    });
  } catch (error) {
    console.error('[Assignment Routes] Get employee managers error:', error.message);
    res.status(500).json({
      success: false,
      data: null,
      error: { code: 'ASSIGNMENT_ERROR', message: 'Failed to get assigned managers' },
    });
  }
});

/**
 * POST /api/assignments/content - Assign content to user/group
 * Supports assigning packages, skill_packages, learning_tracks, or modules
 */
router.post('/content', authenticate, async (req, res) => {
  try {
    const { type, assignableId, assignedToUser, assignedToGroup, priority, dueDate } = req.body;

    const validTypes = ['package', 'skill_package', 'learning_track', 'module'];
    if (!validTypes.includes(type)) {
      return res.status(400).json({
        success: false,
        data: null,
        error: { code: 'ASSIGNMENT_INVALID_TYPE', message: `Type must be one of: ${validTypes.join(', ')}` },
      });
    }

    if (!assignedToUser && !assignedToGroup) {
      return res.status(400).json({
        success: false,
        data: null,
        error: { code: 'ASSIGNMENT_NO_TARGET', message: 'Must specify assignedToUser or assignedToGroup' },
      });
    }

    // Check if requester has permission
    if (req.user.role !== 'admin' && req.user.role !== 'manager') {
      return res.status(403).json({
        success: false,
        data: null,
        error: { code: 'AUTH_FORBIDDEN', message: 'Only admins and managers can assign content' },
      });
    }

    const assignment = await UserStore.createAssignment({
      type,
      assignable_id: assignableId,
      assignable_type: type,
      assigned_by: req.user.userId || req.user.id,
      assigned_to_user: assignedToUser || null,
      assigned_to_group: assignedToGroup || null,
      assigned_by_manager: req.user.role === 'manager' ? req.user.userId : null,
      priority: priority || 'medium',
      due_date: dueDate || null,
      status: 'assigned',
      progress: 0,
    });

    await UserStore.logAuthEvent('content_assigned', req.user.userId, {
      assignmentId: assignment.id,
      type,
      assignableId,
      assignedToUser,
      assignedToGroup,
    });

    // Notify the assigned employee
    if (assignedToUser) {
      try {
        await db.createNotification({
          user_id: assignedToUser,
          title: 'New Learning Assignment',
          message: 'A new module has been assigned to you. Check your dashboard to get started.',
          type: 'assignment',
          action_url: '/dashboard',
          read: false,
        });
      } catch (_) {}
    }

    res.status(201).json({
      success: true,
      data: { assignment, message: 'Content assigned successfully' },
      error: null,
    });
  } catch (error) {
    console.error('[Assignment Routes] Assign content error:', error.message);
    res.status(500).json({
      success: false,
      data: null,
      error: { code: 'ASSIGNMENT_ERROR', message: 'Failed to assign content' },
    });
  }
});

/**
 * GET /api/assignments/dashboard - Get assignment dashboard summary
 * NOTE: must be registered BEFORE /:id to avoid Express wildcard match
 */
router.get('/dashboard', authenticate, async (req, res) => {
  try {
    const userId = req.user.userId || req.user.id;

    const allAssignments = await UserStore.getAssignments({});
    const userAssignments = allAssignments.filter(
      a => a.assigned_to_user === userId || a.assigned_by === userId
    );

    const summary = {
      total: userAssignments.length,
      assigned: userAssignments.filter(a => a.status === 'assigned').length,
      inProgress: userAssignments.filter(a => a.status === 'in_progress').length,
      completed: userAssignments.filter(a => a.status === 'completed').length,
      overdue: userAssignments.filter(a => a.status === 'overdue').length,
      avgProgress: userAssignments.length > 0
        ? Math.round(userAssignments.reduce((sum, a) => sum + (a.progress || 0), 0) / userAssignments.length)
        : 0,
    };

    res.json({ success: true, data: { summary, assignments: userAssignments }, error: null });
  } catch (error) {
    console.error('[Assignment Routes] Dashboard error:', error.message);
    res.status(500).json({
      success: false,
      data: null,
      error: { code: 'ASSIGNMENT_ERROR', message: 'Failed to get assignment dashboard' },
    });
  }
});

/**
 * GET /api/assignments/requests
 * Admin gets all pending requests
 * NOTE: must be registered BEFORE /:id to avoid Express wildcard match
 */
router.get('/requests', authenticate, requireRole('admin'), async (req, res) => {
  try {
    // Return all requests; client filters by status
    const requests = await UserStore.getAssignmentRequests({});
    res.json({ success: true, data: { requests } });
  } catch (error) {
    res.status(500).json({ success: false, error: { message: 'Failed to fetch requests' } });
  }
});

/**
 * POST /api/assignments/requests/:id/approve
 * Admin approves a request
 * NOTE: must be registered BEFORE /:id to avoid Express wildcard match
 */
router.post('/requests/:id/approve', authenticate, requireRole('admin'), async (req, res) => {
  try {
    const { id } = req.params;
    const updated = await UserStore.updateAssignmentRequest(id, {
      status: 'approved',
      decided_by: req.user.userId,
    });

    // Auto-create the actual assignment
    await UserStore.createAssignment({
      type: 'module',
      assignable_id: updated.module_id,
      assignable_type: 'module',
      assigned_to_user: updated.employee_id,
      assigned_by: req.user.userId,
      assigned_by_manager: updated.manager_id,
      status: 'assigned',
      progress: 0,
    });

    // Notify the employee
    try {
      await db.createNotification({
        user_id: updated.employee_id,
        title: 'New Learning Assignment',
        message: 'A new module has been assigned to you. Check your dashboard to get started.',
        type: 'assignment',
        action_url: '/dashboard',
        read: false,
      });
    } catch (_) {}

    res.json({ success: true, data: { request: updated } });
  } catch (error) {
    res.status(500).json({ success: false, error: { message: 'Failed to approve' } });
  }
});

/**
 * POST /api/assignments/requests/:id/reject
 * Admin rejects a request
 * NOTE: must be registered BEFORE /:id to avoid Express wildcard match
 */
router.post('/requests/:id/reject', authenticate, requireRole('admin'), async (req, res) => {
  try {
    const { id } = req.params;
    const updated = await UserStore.updateAssignmentRequest(id, {
      status: 'rejected',
      decided_by: req.user.userId,
    });

    // Notify the manager
    try {
      await db.createNotification({
        user_id: updated.manager_id,
        title: 'Assignment Request Rejected',
        message: 'Your module assignment request has been rejected by an administrator.',
        type: 'rejection',
        action_url: '/admin/assignments',
        read: false,
      });
    } catch (_) {}

    res.json({ success: true, data: { request: updated } });
  } catch (error) {
    res.status(500).json({ success: false, error: { message: 'Failed to reject' } });
  }
});

/**
 * GET /api/assignments - Get all assignments (with filters)
 */
router.get('/', authenticate, async (req, res) => {
  try {
    const { userId, groupId, status, type } = req.query;

    const filters = {};
    if (userId) filters.user_id = userId;
    if (groupId) filters.group_id = groupId;
    if (status) filters.status = status;
    if (type) filters.type = type;

    // Restrict non-admins to their own assignments
    if (req.user.role !== 'admin') {
      if (!userId && !groupId) {
        filters.user_id = req.user.userId || req.user.id;
      }
      // Managers can only see their team's assignments
      if (req.user.role === 'manager' && !userId) {
        const employees = await UserStore.getManagerEmployees(req.user.userId);
        const employeeIds = employees.map(e => e.userId || e.id);
        // Return all assignments for these employees
        const allAssignments = await UserStore.getAssignments({});
        const filtered = allAssignments.filter(a =>
          employeeIds.includes(a.assigned_to_user) ||
          a.assigned_by === req.user.userId
        );
        return res.json({ success: true, data: { assignments: filtered, count: filtered.length }, error: null });
      }
    }

    const assignments = await UserStore.getAssignments(filters);

    res.json({
      success: true,
      data: { assignments, count: assignments.length },
      error: null,
    });
  } catch (error) {
    console.error('[Assignment Routes] Get assignments error:', error.message);
    res.status(500).json({
      success: false,
      data: null,
      error: { code: 'ASSIGNMENT_ERROR', message: 'Failed to get assignments' },
    });
  }
});

/**
 * GET /api/assignments/:id - Get single assignment by ID
 */
router.get('/:id', authenticate, async (req, res) => {
  try {
    const { id } = req.params;
    const all = await UserStore.getAssignments({});
    const assignment = all.find(a => a.id === id);
    if (!assignment) {
      return res.status(404).json({ success: false, data: null, error: { code: 'ASSIGNMENT_NOT_FOUND', message: 'Assignment not found' } });
    }
    // Auth check: owner or admin/manager
    const isOwner = req.user.userId === assignment.assigned_to_user;
    const isAdminOrManager = req.user.role === 'admin' || req.user.role === 'manager';
    if (!isOwner && !isAdminOrManager) {
      return res.status(403).json({ success: false, data: null, error: { code: 'AUTH_FORBIDDEN', message: 'Access denied' } });
    }
    res.json({ success: true, data: assignment, error: null });
  } catch (err) {
    res.status(500).json({ success: false, data: null, error: { code: 'ASSIGNMENT_ERROR', message: err.message } });
  }
});

/**
 * PUT /api/assignments/:id - Update assignment (progress, status)
 */
router.put('/:id', authenticate, async (req, res) => {
  try {
    const { id } = req.params;
    const { status, progress, sessionProgress, progress_data } = req.body;

    const updates = {};
    if (status !== undefined) updates.status = status;
    if (progress !== undefined) updates.progress = progress;
    if (sessionProgress !== undefined) {
      // Merge with existing sessionProgress
      updates.sessionProgress = sessionProgress;
    }
    if (progress_data !== undefined) updates.progress_data = progress_data;

    if (Object.keys(updates).length === 0) {
      return res.status(400).json({
        success: false,
        data: null,
        error: { code: 'ASSIGNMENT_NO_UPDATES', message: 'No valid updates provided' },
      });
    }

    // Check ownership
    const existing = await UserStore.getAssignments({});
    const assignment = existing.find(a => a.id === id);
    if (!assignment) {
      return res.status(404).json({
        success: false,
        data: null,
        error: { code: 'ASSIGNMENT_NOT_FOUND', message: 'Assignment not found' },
      });
    }

    const isOwner = req.user.userId === assignment.assigned_to_user;
    const isManager = req.user.role === 'manager' && req.user.userId === assignment.assigned_by_manager;
    const isAdmin = req.user.role === 'admin';

    if (!isOwner && !isManager && !isAdmin) {
      return res.status(403).json({
        success: false,
        data: null,
        error: { code: 'AUTH_FORBIDDEN', message: 'You cannot update this assignment' },
      });
    }

    // Server-side safety merge: never discard existing session progress
    if (sessionProgress !== undefined) {
      const existingProgress = assignment.sessionProgress || assignment.session_progress || {};
      updates.sessionProgress = { ...existingProgress, ...sessionProgress };
    }

    const updated = await UserStore.updateAssignment(id, updates);

    res.json({ success: true, data: { assignment: updated }, error: null });
  } catch (error) {
    console.error('[Assignment Routes] Update assignment error:', error.message);
    res.status(500).json({
      success: false,
      data: null,
      error: { code: 'ASSIGNMENT_ERROR', message: 'Failed to update assignment' },
    });
  }
});

/**
 * DELETE /api/assignments/:id - Delete a content assignment (admin only)
 */
router.delete('/:id', authenticate, requireRole('admin'), async (req, res) => {
  try {
    const { id } = req.params;

    const all = await UserStore.getAssignments({});
    const assignment = all.find(a => a.id === id);

    if (!assignment) {
      return res.status(404).json({
        success: false,
        data: null,
        error: { code: 'ASSIGNMENT_NOT_FOUND', message: 'Assignment not found' },
      });
    }

    await UserStore.deleteAssignment(id);

    res.json({ success: true, data: { id }, error: null });
  } catch (error) {
    console.error('[Assignment Routes] Delete assignment error:', error.message);
    res.status(500).json({
      success: false,
      data: null,
      error: { code: 'ASSIGNMENT_ERROR', message: 'Failed to delete assignment' },
    });
  }
});

/**
 * POST /api/assignments/request (or /requests) — Manager requests assignment for an employee
 */
async function handleManagerRequest(req, res) {
  try {
    const { employeeId, moduleId, groupId, priority, dueDate } = req.body;
    if (!moduleId) {
      return res.status(400).json({ success: false, error: { message: 'moduleId is required' } });
    }
    if (!employeeId && !groupId) {
      return res.status(400).json({ success: false, error: { message: 'employeeId or groupId is required' } });
    }

    const request = await UserStore.createAssignmentRequest({
      manager_id: req.user.userId,
      employee_id: employeeId || null,
      group_id: groupId || null,
      module_id: moduleId,
      priority: priority || 'medium',
      due_date: dueDate || null,
      status: 'pending',
      requested_at: new Date().toISOString(),
    });

    res.status(201).json({ success: true, data: { request } });
  } catch (error) {
    console.error('[assignments/request]', error.message);
    res.status(500).json({ success: false, error: { message: 'Failed to create request' } });
  }
}

router.post('/request',  authenticate, requireRole('manager'), handleManagerRequest);
router.post('/requests', authenticate, requireRole('manager'), handleManagerRequest);

export default router;