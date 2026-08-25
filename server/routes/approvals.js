/**
 * approvals.js — General approval workflow for all request types
 * Covers: create_assessment, assign_assessment, create_module, assign_module
 *
 * Separate from legacy assignment_requests (module assignments only)
 */
import express from 'express';
import { authenticate, requireRole } from '../middleware/auth.js';
import { randomUUID } from 'crypto';
import UserStore from '../services/UserStore.js';
import { ApprovalRequests } from '../services/DataStore.js';
import * as db from '../db/store.js';

const router = express.Router();

/**
 * POST /api/approvals
 * Manager submits an approval request
 * Body: { actionType, payload, notes }
 */
router.post('/', authenticate, requireRole('manager', 'admin'), async (req, res) => {
  try {
    const { actionType, payload, notes } = req.body;
    const validTypes = ['create_assessment', 'assign_assessment', 'create_module', 'assign_module'];
    if (!actionType || !validTypes.includes(actionType)) {
      return res.status(400).json({
        success: false, data: null,
        error: `actionType must be one of: ${validTypes.join(', ')}`,
      });
    }
    if (!payload) {
      return res.status(400).json({ success: false, data: null, error: 'payload is required' });
    }

    const approval = {
      id: `approval_${randomUUID().slice(0, 10)}`,
      actionType,
      requestedBy: req.user.userId,
      requestedByName: req.user.name,
      companyId: req.user.companyId || 'default',
      status: 'pending',
      payload,
      notes: notes || '',
      requestedAt: new Date().toISOString(),
      decidedAt: null,
      decidedBy: null,
      result: null,
    };

    const saved = await ApprovalRequests.create(approval);

    // Notify admin(s) of this company
    try {
      const allUsers = await UserStore.getAllUsers({});
      const admins = allUsers.filter(u =>
        u.role === 'admin' && (u.companyId || 'default') === (req.user.companyId || 'default')
      );
      for (const admin of admins) {
        await db.createNotification({
          user_id: admin.userId || admin.id,
          title: 'New Approval Request',
          message: `${req.user.name} submitted a ${actionType.replace(/_/g, ' ')} request.`,
          type: 'approval_request',
          action_url: '/admin/approvals',
          read: false,
        });
      }
    } catch (_) {}

    res.status(201).json({ success: true, data: saved, error: null });
  } catch (e) {
    console.error('[approvals POST]', e);
    res.status(500).json({ success: false, data: null, error: e.message });
  }
});

/**
 * GET /api/approvals
 * Admin: list approval requests for their company
 * Manager: list their own requests
 */
router.get('/', authenticate, async (req, res) => {
  try {
    if (req.user.role !== 'admin' && req.user.role !== 'manager') {
      return res.status(403).json({ success: false, data: null, error: 'Access denied' });
    }

    const all = await ApprovalRequests.getAll();
    const companyId = req.user.companyId || 'default';

    let requests;
    if (req.user.role === 'admin') {
      requests = all.filter(a => a.companyId === companyId);
    } else {
      // Manager sees only their own requests
      requests = all.filter(a => a.requestedBy === req.user.userId);
    }

    res.json({ success: true, data: { requests, total: requests.length }, error: null });
  } catch (e) {
    res.status(500).json({ success: false, data: null, error: e.message });
  }
});

/**
 * PUT /api/approvals/:id/approve
 * Admin approves a request — executes the action automatically
 */
router.put('/:id/approve', authenticate, requireRole('admin'), async (req, res) => {
  try {
    const approval = await ApprovalRequests.getById(req.params.id);
    if (!approval) return res.status(404).json({ success: false, data: null, error: 'Request not found' });
    if (approval.companyId !== (req.user.companyId || 'default')) {
      return res.status(403).json({ success: false, data: null, error: 'Not in your company' });
    }
    if (approval.status !== 'pending') {
      return res.status(400).json({ success: false, data: null, error: 'Request already decided' });
    }

    let result = null;

    try {
      // Execute the action based on type
      if (approval.actionType === 'assign_module' || approval.actionType === 'assign_assessment') {
        const { targetId, targetType, employeeIds = [], priority, dueDate } = approval.payload;
        const assignments = [];
        for (const empId of employeeIds) {
          const asgn = await UserStore.createAssignment({
            type: targetType || (approval.actionType === 'assign_module' ? 'module' : 'assessment'),
            assignable_id: targetId,
            assignable_type: targetType || (approval.actionType === 'assign_module' ? 'module' : 'assessment'),
            assigned_to_user: empId,
            assigned_by: req.user.userId,
            assigned_by_manager: approval.requestedBy,
            priority: priority || 'medium',
            due_date: dueDate || null,
            status: 'assigned',
            progress: 0,
          });
          assignments.push(asgn);
          // Notify employee
          try {
            await db.createNotification({
              user_id: empId,
              title: 'New Learning Assignment',
              message: `A new ${approval.actionType === 'assign_module' ? 'module' : 'assessment'} has been assigned to you.`,
              type: 'assignment',
              action_url: '/dashboard',
              read: false,
            });
          } catch (_) {}
        }
        result = { assignments };
      } else if (approval.actionType === 'create_module') {
        const { title, description, category, difficulty, content } = approval.payload;
        const module = await db.createModule({
          title,
          description: description || '',
          category: category || 'General',
          difficulty: difficulty || 'beginner',
          content: content || [],
          companyId: approval.companyId,
          created_by: approval.requestedBy,
        });
        result = { module };
      } else if (approval.actionType === 'create_assessment') {
        // For assessment creation, store the payload for admin to review/edit
        // The actual AI generation happens via /api/assessments
        result = { message: 'Assessment creation approved — use the Assessments page to generate.', payload: approval.payload };
      }
    } catch (actionErr) {
      console.error('[approvals approve] Action execution error:', actionErr.message);
      // Still mark as approved but note the execution error
      result = { error: actionErr.message };
    }

    const updated = await ApprovalRequests.update(req.params.id, {
      status: 'approved',
      decidedAt: new Date().toISOString(),
      decidedBy: req.user.userId,
      result,
    });

    // Notify the requester
    try {
      await db.createNotification({
        user_id: approval.requestedBy,
        title: 'Request Approved',
        message: `Your ${approval.actionType.replace(/_/g, ' ')} request has been approved.`,
        type: 'approval',
        action_url: '/manager/dashboard',
        read: false,
      });
    } catch (_) {}

    res.json({ success: true, data: updated, error: null });
  } catch (e) {
    console.error('[approvals approve]', e);
    res.status(500).json({ success: false, data: null, error: e.message });
  }
});

/**
 * PUT /api/approvals/:id/reject
 * Admin rejects a request
 */
router.put('/:id/reject', authenticate, requireRole('admin'), async (req, res) => {
  try {
    const approval = await ApprovalRequests.getById(req.params.id);
    if (!approval) return res.status(404).json({ success: false, data: null, error: 'Request not found' });
    if (approval.companyId !== (req.user.companyId || 'default')) {
      return res.status(403).json({ success: false, data: null, error: 'Not in your company' });
    }
    if (approval.status !== 'pending') {
      return res.status(400).json({ success: false, data: null, error: 'Request already decided' });
    }

    const { reason } = req.body;
    const updated = await ApprovalRequests.update(req.params.id, {
      status: 'rejected',
      decidedAt: new Date().toISOString(),
      decidedBy: req.user.userId,
      rejectionReason: reason || '',
    });

    // Notify the requester
    try {
      await db.createNotification({
        user_id: approval.requestedBy,
        title: 'Request Rejected',
        message: `Your ${approval.actionType.replace(/_/g, ' ')} request has been rejected${reason ? `: ${reason}` : '.'}`,
        type: 'rejection',
        action_url: '/manager/dashboard',
        read: false,
      });
    } catch (_) {}

    res.json({ success: true, data: updated, error: null });
  } catch (e) {
    res.status(500).json({ success: false, data: null, error: e.message });
  }
});

export default router;
