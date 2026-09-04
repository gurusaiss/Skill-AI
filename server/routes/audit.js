import express from 'express';
import UserStore from '../services/UserStore.js';
import { authenticate, requireRole } from '../middleware/auth.js';

const router = express.Router();

/**
 * GET /api/audit/logs
 * Get all audit logs (admin only)
 */
router.get('/logs', authenticate, requireRole('admin'), async (req, res) => {
  try {
    const { eventType, startDate, endDate, limit } = req.query;

    const filters = {};
    if (eventType) filters.eventType = eventType;
    if (startDate) filters.startDate = startDate;
    if (endDate) filters.endDate = endDate;

    let logs = await UserStore.getAuditLogs(filters);

    // Company isolation: an admin must only see their own company's audit
    // trail. Log entries don't carry companyId directly, so resolve each
    // actor's userId to their company and filter — 'default' stays global
    // for single-tenant installs, matching the pattern used elsewhere.
    const actorCompany = req.user.companyId || 'default';
    if (req.user.role !== 'superadmin' && actorCompany !== 'default') {
      const allUsers = await UserStore.getAllUsers({});
      const companyUserIds = new Set(
        allUsers.filter(u => (u.companyId || 'default') === actorCompany).map(u => u.userId || u.id)
      );
      logs = logs.filter(l => !l.userId || companyUserIds.has(l.userId));
    }

    // Apply limit if specified
    if (limit) {
      const limitNum = parseInt(limit);
      if (!isNaN(limitNum) && limitNum > 0) {
        logs = logs.slice(0, limitNum);
      }
    }

    res.json({
      success: true,
      data: {
        logs,
        count: logs.length,
        filters: filters
      },
      error: null
    });
  } catch (error) {
    console.error('[Audit Routes] Get all logs error:', error.message);
    res.status(500).json({
      success: false,
      data: null,
      error: {
        code: 'AUDIT_ERROR',
        message: 'Failed to get audit logs'
      }
    });
  }
});

/**
 * GET /api/audit/logs/:userId
 * Get user-specific audit logs (self or admin)
 */
router.get('/logs/:userId', authenticate, async (req, res) => {
  try {
    const { userId } = req.params;
    const { eventType, startDate, endDate, limit } = req.query;

    // Check if user is accessing their own logs, or is an admin/superadmin
    // in the SAME company as the target user (cross-tenant admins must not
    // be able to pull another company's user's audit trail by id).
    if (req.user.userId !== userId) {
      if (req.user.role !== 'admin' && req.user.role !== 'superadmin') {
        return res.status(403).json({
          success: false,
          data: null,
          error: { code: 'AUTH_FORBIDDEN', message: 'You can only view your own audit logs' },
        });
      }
      if (req.user.role === 'admin') {
        const actorCompany = req.user.companyId || 'default';
        if (actorCompany !== 'default') {
          const target = await UserStore.getUserById(userId);
          const targetCompany = target?.companyId || 'default';
          if (targetCompany !== actorCompany) {
            return res.status(403).json({
              success: false,
              data: null,
              error: { code: 'AUTH_FORBIDDEN', message: 'You can only view audit logs for users in your own company' },
            });
          }
        }
      }
    }

    const filters = { userId };
    if (eventType) filters.eventType = eventType;
    if (startDate) filters.startDate = startDate;
    if (endDate) filters.endDate = endDate;

    let logs = await UserStore.getAuditLogs(filters);

    // Apply limit if specified
    if (limit) {
      const limitNum = parseInt(limit);
      if (!isNaN(limitNum) && limitNum > 0) {
        logs = logs.slice(0, limitNum);
      }
    }

    res.json({
      success: true,
      data: {
        userId,
        logs,
        count: logs.length,
        filters: filters
      },
      error: null
    });
  } catch (error) {
    console.error('[Audit Routes] Get user logs error:', error.message);
    res.status(500).json({
      success: false,
      data: null,
      error: {
        code: 'AUDIT_ERROR',
        message: 'Failed to get user audit logs'
      }
    });
  }
});

/**
 * GET /api/audit/events
 * Get list of available event types (admin only)
 */
router.get('/events', authenticate, requireRole('admin'), async (req, res) => {
  try {
    // Get all logs to extract unique event types
    const allLogs = await UserStore.getAuditLogs({});
    const eventTypes = [...new Set(allLogs.map(log => log.eventType))];

    res.json({
      success: true,
      data: {
        eventTypes: eventTypes.sort(),
        count: eventTypes.length
      },
      error: null
    });
  } catch (error) {
    console.error('[Audit Routes] Get event types error:', error.message);
    res.status(500).json({
      success: false,
      data: null,
      error: {
        code: 'AUDIT_ERROR',
        message: 'Failed to get event types'
      }
    });
  }
});

export default router;
