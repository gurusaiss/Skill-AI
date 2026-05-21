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

    // Check if user is accessing their own logs or is admin
    if (req.user.userId !== userId && req.user.role !== 'admin') {
      return res.status(403).json({
        success: false,
        data: null,
        error: {
          code: 'AUTH_FORBIDDEN',
          message: 'You can only view your own audit logs'
        }
      });
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
