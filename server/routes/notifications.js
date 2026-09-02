/**
 * routes/notifications.js
 * User notification CRUD
 */

import express from 'express';
import { authenticate, requireRole } from '../middleware/auth.js';
import * as db from '../db/store.js';

const router = express.Router();

/**
 * GET /api/notifications
 * Get all notifications for the authenticated user
 */
router.get('/', authenticate, async (req, res) => {
  try {
    const userId = req.user.userId || req.user.id;
    const notifications = await db.getNotifications(userId);
    const unreadCount = notifications.filter(n => !n.read).length;
    res.json({ success: true, data: { notifications, unreadCount }, error: null });
  } catch (error) {
    console.error('[GET /api/notifications] error:', error.message);
    res.status(500).json({ success: false, data: null, error: { message: 'Failed to load notifications' } });
  }
});

/**
 * PUT /api/notifications/read-all
 * Mark all notifications as read for the authenticated user
 * Defined BEFORE /:id/read so Express does not match "read-all" as an :id segment
 */
router.put('/read-all', authenticate, async (req, res) => {
  try {
    const userId = req.user.userId || req.user.id;
    await db.markAllNotificationsRead(userId);
    res.json({ success: true, data: { message: 'All notifications marked as read' }, error: null });
  } catch (error) {
    console.error('[PUT /api/notifications/read-all] error:', error.message);
    res.status(500).json({ success: false, data: null, error: { message: 'Failed to update notifications' } });
  }
});

/**
 * PUT /api/notifications/:id/read
 * Mark a single notification as read
 */
router.put('/:id/read', authenticate, async (req, res) => {
  try {
    const userId = req.user.userId || req.user.id;
    const notif = await db.markNotificationRead(req.params.id, userId);
    res.json({ success: true, data: { notification: notif }, error: null });
  } catch (error) {
    const notFound = error.message === 'Notification not found';
    console.error('[PUT /api/notifications/:id/read] error:', error.message);
    res.status(notFound ? 404 : 500).json({ success: false, data: null, error: { message: notFound ? 'Notification not found' : 'Failed to update notification' } });
  }
});

/**
 * POST /api/notifications
 * Create a notification (admin only — cross-user notification creation)
 */
router.post('/', authenticate, requireRole('admin'), async (req, res) => {
  try {
    const { userId, title, message, type = 'info', actionUrl } = req.body;
    if (!userId || !title || !message) {
      return res.status(400).json({ success: false, data: null, error: { message: 'userId, title, and message are required' } });
    }
    const notif = await db.createNotification({
      user_id: userId,
      title,
      message,
      type,
      action_url: actionUrl || null,
      read: false,
    });
    res.status(201).json({ success: true, data: { notification: notif }, error: null });
  } catch (error) {
    console.error('[POST /api/notifications] error:', error.message);
    res.status(500).json({ success: false, data: null, error: { message: 'Failed to create notification' } });
  }
});

export default router;
