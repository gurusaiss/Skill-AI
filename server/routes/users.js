import express from 'express';
import { authenticate, requireRole } from '../middleware/auth.js';
import UserStore from '../services/UserStore.js';

const router = express.Router();

/**
 * GET /api/users
 * Get all users (admin only) - now supports Supabase
 */
router.get('/', authenticate, async (req, res) => {
  try {
    const { role, emailVerified } = req.query;
    const filters = {};
    if (role) filters.role = role;
    if (emailVerified !== undefined) filters.emailVerified = emailVerified === 'true';

    // Managers can only see employees; admins see all
    const isAdmin = req.user.role === 'admin';
    const isManager = req.user.role === 'manager';
    if (!isAdmin && !isManager) {
      return res.status(403).json({ success: false, data: null, error: { code: 'AUTH_FORBIDDEN', message: 'Access denied' } });
    }
    if (isManager && !filters.role) {
      filters.role = 'employee'; // managers can only see employees
    }

    const users = await UserStore.getAllUsers(filters);

    const sanitizedUsers = users.map(user => ({
      userId: user.userId || user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      emailVerified: user.emailVerified,
      createdAt: user.createdAt,
      lastLogin: user.lastLogin,
      managerId: user.managerId || null,
    }));

    res.json({
      success: true,
      data: {
        users: sanitizedUsers,
        count: sanitizedUsers.length
      },
      error: null
    });
  } catch (error) {
    console.error('[User Routes] Get all users error:', error.message);
    res.status(500).json({
      success: false,
      data: null,
      error: { code: 'USER_ERROR', message: 'Failed to get users' },
    });
  }
});

/**
 * GET /api/users/:userId
 * Get user by ID (self or admin)
 */
router.get('/:userId', authenticate, async (req, res) => {
  try {
    const { userId } = req.params;

    if (req.user.userId !== userId && req.user.role !== 'admin') {
      return res.status(403).json({
        success: false,
        data: null,
        error: { code: 'AUTH_FORBIDDEN', message: 'You can only access your own profile' },
      });
    }

    const user = await UserStore.getUserById(userId);

    if (!user) {
      return res.status(404).json({
        success: false,
        data: null,
        error: { code: 'USER_NOT_FOUND', message: 'User not found' },
      });
    }

    const sanitizedUser = {
      userId: user.userId || user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      learningUUID: user.learningUUID,
      emailVerified: user.emailVerified,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
      lastLogin: user.lastLogin,
      managerId: user.managerId || null,
    };

    res.json({ success: true, data: sanitizedUser, error: null });
  } catch (error) {
    console.error('[User Routes] Get user error:', error.message);
    res.status(500).json({
      success: false,
      data: null,
      error: { code: 'USER_ERROR', message: 'Failed to get user' },
    });
  }
});

/**
 * PUT /api/users/:userId
 * Update user profile (self or admin)
 */
router.put('/:userId', authenticate, async (req, res) => {
  try {
    const { userId } = req.params;
    const { name, email } = req.body;

    if (req.user.userId !== userId && req.user.role !== 'admin') {
      return res.status(403).json({
        success: false,
        data: null,
        error: { code: 'AUTH_FORBIDDEN', message: 'You can only update your own profile' },
      });
    }

    const user = await UserStore.getUserById(userId);
    if (!user) {
      return res.status(404).json({
        success: false,
        data: null,
        error: { code: 'USER_NOT_FOUND', message: 'User not found' },
      });
    }

    const updates = {};

    if (name !== undefined) {
      if (!name || name.trim().length === 0) {
        return res.status(400).json({
          success: false,
          data: null,
          error: { code: 'USER_INVALID_NAME', message: 'Name cannot be empty' },
        });
      }
      updates.name = name.trim();
    }

    if (email !== undefined && email !== user.email) {
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(email)) {
        return res.status(400).json({
          success: false,
          data: null,
          error: { code: 'USER_INVALID_EMAIL', message: 'Invalid email format' },
        });
      }
      const existingUser = await UserStore.getUserByEmail(email);
      if (existingUser && existingUser.userId !== userId) {
        return res.status(409).json({
          success: false,
          data: null,
          error: { code: 'USER_EMAIL_EXISTS', message: 'Email already in use' },
        });
      }
      updates.email = email;
      updates.emailVerified = false;
    }

    if (Object.keys(updates).length === 0) {
      return res.status(400).json({
        success: false,
        data: null,
        error: { code: 'USER_NO_UPDATES', message: 'No valid updates provided' },
      });
    }

    const updatedUser = await UserStore.updateUser(userId, updates);

    await UserStore.logAuthEvent('profile_updated', userId, {
      updates: Object.keys(updates),
      updatedBy: req.user.userId,
      ipAddress: req.ip,
    });

    res.json({
      success: true,
      data: {
        userId: updatedUser.userId || updatedUser.id,
        email: updatedUser.email,
        name: updatedUser.name,
        role: updatedUser.role,
        emailVerified: updatedUser.emailVerified,
        updatedAt: updatedUser.updatedAt,
      },
      error: null,
    });
  } catch (error) {
    console.error('[User Routes] Update user error:', error.message);
    res.status(500).json({
      success: false,
      data: null,
      error: { code: 'USER_ERROR', message: 'Failed to update user' },
    });
  }
});

/**
 * DELETE /api/users/:userId
 * Delete user (admin only)
 */
router.delete('/:userId', authenticate, requireRole('admin'), async (req, res) => {
  try {
    const { userId } = req.params;

    if (req.user.userId === userId) {
      return res.status(400).json({
        success: false,
        data: null,
        error: { code: 'USER_CANNOT_DELETE_SELF', message: 'You cannot delete your own account' },
      });
    }

    const user = await UserStore.getUserById(userId);
    if (!user) {
      return res.status(404).json({
        success: false,
        data: null,
        error: { code: 'USER_NOT_FOUND', message: 'User not found' },
      });
    }

    await UserStore.deleteUser(userId);

    await UserStore.logAuthEvent('user_deleted', userId, {
      deletedBy: req.user.userId,
      deletedUser: { email: user.email, role: user.role },
      ipAddress: req.ip,
    });

    res.json({
      success: true,
      data: { message: 'User deleted successfully' },
      error: null,
    });
  } catch (error) {
    console.error('[User Routes] Delete user error:', error.message);
    res.status(500).json({
      success: false,
      data: null,
      error: { code: 'USER_ERROR', message: 'Failed to delete user' },
    });
  }
});

/**
 * PUT /api/users/:userId/role
 * Update user role (admin only)
 */
router.put('/:userId/role', authenticate, requireRole('admin'), async (req, res) => {
  try {
    const { userId } = req.params;
    const { role } = req.body;

    if (!role) {
      return res.status(400).json({
        success: false,
        data: null,
        error: { code: 'USER_INVALID_ROLE', message: 'Role is required' },
      });
    }

    const validRoles = ['admin', 'manager', 'employee'];
    if (!validRoles.includes(role)) {
      return res.status(400).json({
        success: false,
        data: null,
        error: { code: 'USER_INVALID_ROLE', message: `Role must be one of: ${validRoles.join(', ')}` },
      });
    }

    const user = await UserStore.getUserById(userId);
    if (!user) {
      return res.status(404).json({
        success: false,
        data: null,
        error: { code: 'USER_NOT_FOUND', message: 'User not found' },
      });
    }

    const oldRole = user.role;
    const updatedUser = await UserStore.updateUserRole(userId, role);

    await UserStore.logAuthEvent('role_changed', userId, {
      changedBy: req.user.userId,
      oldRole,
      newRole: role,
      targetUser: { email: user.email, userId: user.userId },
      ipAddress: req.ip,
    });

    res.json({
      success: true,
      data: {
        userId: updatedUser.userId || updatedUser.id,
        email: updatedUser.email,
        name: updatedUser.name,
        role: updatedUser.role,
        updatedAt: updatedUser.updatedAt,
      },
      error: null,
    });
  } catch (error) {
    console.error('[User Routes] Update role error:', error.message);
    res.status(500).json({
      success: false,
      data: null,
      error: { code: 'USER_ERROR', message: 'Failed to update user role' },
    });
  }
});

/**
 * GET /api/users/:userId/assignments
 * Get user's assignments (self or admin or assigned manager)
 */
router.get('/:userId/assignments', authenticate, async (req, res) => {
  try {
    const { userId } = req.params;

    const isSelf = req.user.userId === userId;
    const isAdmin = req.user.role === 'admin';

    if (!isSelf && !isAdmin) {
      // Check if requester is manager of this user
      const managers = await UserStore.getEmployeeManagers(userId);
      const isManager = managers.some(m => m.userId === req.user.userId);
      if (!isManager) {
        return res.status(403).json({
          success: false,
          data: null,
          error: { code: 'AUTH_FORBIDDEN', message: 'Access denied' },
        });
      }
    }

    const assignments = await UserStore.getAssignments({ user_id: userId });

    res.json({
      success: true,
      data: { assignments, count: assignments.length },
      error: null,
    });
  } catch (error) {
    console.error('[User Routes] Get assignments error:', error.message);
    res.status(500).json({
      success: false,
      data: null,
      error: { code: 'USER_ERROR', message: 'Failed to get assignments' },
    });
  }
});

export default router;