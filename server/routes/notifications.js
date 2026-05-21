/**
 * routes/notifications.js
 * User notification CRUD
 */

import express from 'express';
import { authenticate } from '../middleware/auth.js';
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
    res.status(500).json({ success: false, data: null, error: { message: error.message } });
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
    const status = error.message === 'Notification not found' ? 404 : 500;
    res.status(status).json({ success: false, data: null, error: { message: error.message } });
  }
});

/**
 * PUT /api/notifications/read-all
 * Mark all notifications as read for the authenticated user
 */
router.put('/read-all', authenticate, async (req, res) => {
  try {
    const userId = req.user.userId || req.user.id;
    await db.markAllNotificationsRead(userId);
    res.json({ success: true, data: { message: 'All notifications marked as read' }, error: null });
  } catch (error) {
    res.status(500).json({ success: false, data: null, error: { message: error.message } });
  }
});

/**
 * POST /api/notifications
 * Create a notification (admin/system use)
 */
router.post('/', authenticate, async (req, res) => {
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
    res.status(500).json({ success: false, data: null, error: { message: error.message } });
  }
});

export default router;
