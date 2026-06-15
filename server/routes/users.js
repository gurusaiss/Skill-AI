import express from 'express';
import multer from 'multer';
import path from 'path';
import { fileURLToPath } from 'url';
import { existsSync, mkdirSync } from 'fs';
import { authenticate, requireRole } from '../middleware/auth.js';
import UserStore from '../services/UserStore.js';
import AuthService from '../services/AuthService.js';
import { v4 as uuidv4 } from 'uuid';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const UPLOADS_DIR = path.join(__dirname, '../data/uploads/jd');
if (!existsSync(UPLOADS_DIR)) mkdirSync(UPLOADS_DIR, { recursive: true });

const router = express.Router();

// ── Multer setup for JD file uploads ─────────────────────────────────────────
const jdStorage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UPLOADS_DIR),
  filename: (_req, file, cb) => {
    const unique = `${Date.now()}-${uuidv4().slice(0, 8)}${path.extname(file.originalname)}`;
    cb(null, unique);
  },
});
const jdUpload = multer({
  storage: jdStorage,
  limits: { fileSize: 50 * 1024 * 1024 }, // 50MB
  fileFilter: (_req, file, cb) => {
    const allowed = ['.pdf', '.doc', '.docx', '.txt', '.rtf', '.odt', '.png', '.jpg', '.jpeg'];
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, allowed.includes(ext));
  },
});

// ── Sanitize user for response (include all profile fields) ───────────────────
function sanitizeUser(user) {
  return {
    userId: user.userId || user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    emailVerified: user.emailVerified,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
    lastLogin: user.lastLogin,
    managerId: user.managerId || null,
    learningUUID: user.learningUUID || null,
    // Extended profile
    jobRole: user.jobRole || '',
    department: user.department || '',
    jobDescription: user.jobDescription || '',
    jobDescriptionFile: user.jobDescriptionFile || null,
    onboardingComplete: user.onboardingComplete || false,
    companyName: user.companyName || '',
  };
}

/**
 * GET /api/users
 * Get all users (admin/manager)
 */
router.get('/', authenticate, async (req, res) => {
  try {
    const isAdmin = req.user.role === 'admin';
    const isManager = req.user.role === 'manager';
    if (!isAdmin && !isManager) {
      return res.status(403).json({ success: false, data: null, error: { code: 'AUTH_FORBIDDEN', message: 'Access denied' } });
    }

    const { role, emailVerified } = req.query;
    const filters = {};
    if (role) filters.role = role;
    if (emailVerified !== undefined) filters.emailVerified = emailVerified === 'true';
    if (isManager && !filters.role) filters.role = 'employee';

    const allUsers = await UserStore.getAllUsers(filters);
    // Company isolation: admin only sees their own company's users
    const users = (isAdmin && req.user.companyId && req.user.companyId !== 'default')
      ? allUsers.filter(u => (u.companyId || 'default') === req.user.companyId)
      : allUsers;
    const sanitizedUsers = users.map(sanitizeUser);

    res.json({ success: true, data: { users: sanitizedUsers, count: sanitizedUsers.length }, error: null });
  } catch (error) {
    console.error('[User Routes] Get all users error:', error.message);
    res.status(500).json({ success: false, data: null, error: { code: 'USER_ERROR', message: 'Failed to get users' } });
  }
});

/**
 * POST /api/users
 * Admin/Manager creates a new user directly (bypasses email signup)
 */
router.post('/', authenticate, requireRole('admin', 'manager'), async (req, res) => {
  try {
    const { email, name, role, jobRole, department, jobDescription, companyName, password } = req.body;

    if (!email || !name) {
      return res.status(400).json({ success: false, data: null, error: { code: 'USER_INVALID_INPUT', message: 'Email and name are required' } });
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return res.status(400).json({ success: false, data: null, error: { code: 'USER_INVALID_EMAIL', message: 'Invalid email format' } });
    }

    // Prevent duplicate
    const existing = await UserStore.getUserByEmail(email);
    if (existing) {
      return res.status(409).json({ success: false, data: null, error: { code: 'USER_EMAIL_EXISTS', message: 'Email already registered' } });
    }

    // Managers can only create employees
    const assignedRole = (req.user.role === 'manager') ? 'employee' : (role || 'employee');
    const tempPassword = password || `SkillForge@${Math.random().toString(36).slice(2, 8)}`;
    const passwordHash = await AuthService.hashPassword(tempPassword);

    const user = await UserStore.createUser({
      email,
      passwordHash,
      name: name.trim(),
      role: assignedRole,
      emailVerified: true,
      onboardingComplete: true,
      jobRole: jobRole || '',
      department: department || '',
      jobDescription: jobDescription || '',
      companyName: companyName || '',
      companyId: req.user.companyId || 'default',
    });

    await UserStore.logAuthEvent('user_created_by_admin', user.userId, {
      createdBy: req.user.userId,
      createdByRole: req.user.role,
      ipAddress: req.ip,
    });

    res.status(201).json({
      success: true,
      data: {
        ...sanitizeUser(user),
        tempPassword: !password ? tempPassword : undefined, // only return if auto-generated
      },
      error: null,
    });
  } catch (error) {
    console.error('[User Routes] Create user error:', error.message);
    res.status(500).json({ success: false, data: null, error: { code: 'USER_ERROR', message: 'Failed to create user' } });
  }
});

/**
 * GET /api/users/:userId
 * Get user by ID (self, admin, or manager of this user)
 */
router.get('/:userId', authenticate, async (req, res) => {
  try {
    const { userId } = req.params;
    const isSelf = req.user.userId === userId;
    const isAdmin = req.user.role === 'admin';
    const isManager = req.user.role === 'manager';

    if (!isSelf && !isAdmin && !isManager) {
      return res.status(403).json({ success: false, data: null, error: { code: 'AUTH_FORBIDDEN', message: 'Access denied' } });
    }

    const user = await UserStore.getUserById(userId);
    if (!user) {
      return res.status(404).json({ success: false, data: null, error: { code: 'USER_NOT_FOUND', message: 'User not found' } });
    }

    res.json({ success: true, data: sanitizeUser(user), error: null });
  } catch (error) {
    console.error('[User Routes] Get user error:', error.message);
    res.status(500).json({ success: false, data: null, error: { code: 'USER_ERROR', message: 'Failed to get user' } });
  }
});

/**
 * PUT /api/users/:userId
 * Update user profile — self can update own info; admin/manager can update all fields
 */
router.put('/:userId', authenticate, async (req, res) => {
  try {
    const { userId } = req.params;
    const isSelf = req.user.userId === userId;
    const isAdmin = req.user.role === 'admin';
    const isManager = req.user.role === 'manager';

    if (!isSelf && !isAdmin && !isManager) {
      return res.status(403).json({ success: false, data: null, error: { code: 'AUTH_FORBIDDEN', message: 'Cannot update this user' } });
    }

    const user = await UserStore.getUserById(userId);
    if (!user) {
      return res.status(404).json({ success: false, data: null, error: { code: 'USER_NOT_FOUND', message: 'User not found' } });
    }

    const { name, email, role, status, jobRole, department, jobDescription, companyName, onboardingComplete } = req.body;
    const updates = {};

    // Name — anyone can update own name; admin/manager can update any
    if (name !== undefined) {
      if (!name.trim()) return res.status(400).json({ success: false, data: null, error: { code: 'USER_INVALID_NAME', message: 'Name cannot be empty' } });
      updates.name = name.trim();
    }

    // Email — self or admin only
    if (email !== undefined && email !== user.email) {
      if (!isSelf && !isAdmin) return res.status(403).json({ success: false, data: null, error: { code: 'AUTH_FORBIDDEN', message: 'Only admin can change email' } });
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(email)) return res.status(400).json({ success: false, data: null, error: { code: 'USER_INVALID_EMAIL', message: 'Invalid email format' } });
      const existingUser = await UserStore.getUserByEmail(email);
      if (existingUser && existingUser.userId !== userId) {
        return res.status(409).json({ success: false, data: null, error: { code: 'USER_EMAIL_EXISTS', message: 'Email already in use' } });
      }
      updates.email = email;
    }

    // Role — admin only
    if (role !== undefined && isAdmin) {
      const validRoles = ['admin', 'manager', 'employee'];
      if (validRoles.includes(role)) updates.role = role;
    }

    // Status — admin or manager only
    if (status !== undefined && (isAdmin || isManager)) {
      const validStatuses = ['active', 'inactive', 'blocked'];
      if (validStatuses.includes(status)) updates.status = status;
    }

    // Extended profile — admin or manager can set; self can set own
    if (jobRole !== undefined) updates.jobRole = jobRole;
    if (department !== undefined) updates.department = department;
    if (jobDescription !== undefined) updates.jobDescription = jobDescription; // no char limit
    if (companyName !== undefined) updates.companyName = companyName;
    if (onboardingComplete !== undefined && (isAdmin || isManager || isSelf)) {
      updates.onboardingComplete = !!onboardingComplete;
    }

    updates.updatedAt = new Date().toISOString();

    if (Object.keys(updates).length === 1 && updates.updatedAt) {
      return res.status(400).json({ success: false, data: null, error: { code: 'USER_NO_UPDATES', message: 'No valid updates provided' } });
    }

    const updatedUser = await UserStore.updateUser(userId, updates);
    await UserStore.logAuthEvent('profile_updated', userId, { updates: Object.keys(updates), updatedBy: req.user.userId, ipAddress: req.ip });

    res.json({ success: true, data: sanitizeUser(updatedUser), error: null });
  } catch (error) {
    console.error('[User Routes] Update user error:', error.message);
    res.status(500).json({ success: false, data: null, error: { code: 'USER_ERROR', message: 'Failed to update user' } });
  }
});

/**
 * POST /api/users/:userId/jd-upload
 * Upload JD file (PDF, DOCX, TXT, etc.) — admin/manager or self
 * Replaces any previous JD file for this user
 */
router.post('/:userId/jd-upload', authenticate, jdUpload.single('jd'), async (req, res) => {
  try {
    const { userId } = req.params;
    const isSelf = req.user.userId === userId;
    const isAdmin = req.user.role === 'admin';
    const isManager = req.user.role === 'manager';

    if (!isSelf && !isAdmin && !isManager) {
      return res.status(403).json({ success: false, data: null, error: { code: 'AUTH_FORBIDDEN', message: 'Access denied' } });
    }

    const user = await UserStore.getUserById(userId);
    if (!user) {
      return res.status(404).json({ success: false, data: null, error: { code: 'USER_NOT_FOUND', message: 'User not found' } });
    }

    if (!req.file) {
      return res.status(400).json({ success: false, data: null, error: { code: 'NO_FILE', message: 'No file uploaded' } });
    }

    const fileInfo = {
      name: req.file.originalname,
      storageName: req.file.filename,
      path: req.file.path,
      type: req.file.mimetype,
      size: req.file.size,
      uploadedAt: new Date().toISOString(),
    };

    const updatedUser = await UserStore.updateUser(userId, {
      jobDescriptionFile: fileInfo,
      updatedAt: new Date().toISOString(),
    });

    await UserStore.logAuthEvent('jd_uploaded', userId, { uploadedBy: req.user.userId, fileName: req.file.originalname, ipAddress: req.ip });

    res.json({ success: true, data: { jobDescriptionFile: fileInfo, user: sanitizeUser(updatedUser) }, error: null });
  } catch (error) {
    console.error('[User Routes] JD upload error:', error.message);
    res.status(500).json({ success: false, data: null, error: { code: 'UPLOAD_ERROR', message: 'File upload failed' } });
  }
});

/**
 * GET /api/users/:userId/jd
 * Get the JD text + file info for a user (self, admin, or manager)
 */
router.get('/:userId/jd', authenticate, async (req, res) => {
  try {
    const { userId } = req.params;
    const isSelf = req.user.userId === userId;
    const isAdmin = req.user.role === 'admin';
    const isManager = req.user.role === 'manager';

    if (!isSelf && !isAdmin && !isManager) {
      return res.status(403).json({ success: false, data: null, error: { code: 'AUTH_FORBIDDEN', message: 'Access denied' } });
    }

    const user = await UserStore.getUserById(userId);
    if (!user) {
      return res.status(404).json({ success: false, data: null, error: { code: 'USER_NOT_FOUND', message: 'User not found' } });
    }

    res.json({
      success: true,
      data: {
        jobRole: user.jobRole || '',
        jobDescription: user.jobDescription || '',
        jobDescriptionFile: user.jobDescriptionFile || null,
        hasJD: !!(user.jobDescription || user.jobDescriptionFile),
      },
      error: null,
    });
  } catch (error) {
    console.error('[User Routes] Get JD error:', error.message);
    res.status(500).json({ success: false, data: null, error: { code: 'USER_ERROR', message: 'Failed to get JD' } });
  }
});

/**
 * POST /api/users/:userId/onboarding
 * Complete onboarding step 2 for employee self-signup
 * Accepts: name, jobRole, department, companyName
 */
router.post('/:userId/onboarding', authenticate, async (req, res) => {
  try {
    const { userId } = req.params;
    if (req.user.userId !== userId) {
      return res.status(403).json({ success: false, data: null, error: { code: 'AUTH_FORBIDDEN', message: 'Can only complete own onboarding' } });
    }

    const user = await UserStore.getUserById(userId);
    if (!user) {
      return res.status(404).json({ success: false, data: null, error: { code: 'USER_NOT_FOUND', message: 'User not found' } });
    }

    if (user.onboardingComplete) {
      return res.json({ success: true, data: sanitizeUser(user), error: null }); // idempotent
    }

    const { name, jobRole, department, companyName } = req.body;
    if (!name || !jobRole) {
      return res.status(400).json({ success: false, data: null, error: { code: 'ONBOARDING_INVALID', message: 'Name and job role are required' } });
    }

    const updatedUser = await UserStore.updateUser(userId, {
      name: name.trim(),
      jobRole: jobRole.trim(),
      department: (department || '').trim(),
      companyName: (companyName || '').trim(),
      onboardingComplete: true,
      updatedAt: new Date().toISOString(),
    });

    res.json({ success: true, data: sanitizeUser(updatedUser), error: null });
  } catch (error) {
    console.error('[User Routes] Onboarding error:', error.message);
    res.status(500).json({ success: false, data: null, error: { code: 'ONBOARDING_ERROR', message: 'Failed to complete onboarding' } });
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
      return res.status(400).json({ success: false, data: null, error: { code: 'USER_CANNOT_DELETE_SELF', message: 'You cannot delete your own account' } });
    }

    const user = await UserStore.getUserById(userId);
    if (!user) {
      return res.status(404).json({ success: false, data: null, error: { code: 'USER_NOT_FOUND', message: 'User not found' } });
    }
    // Company isolation: admin can only delete users in their own company
    if (req.user.role === 'admin' && req.user.companyId !== 'default' && (user.companyId || 'default') !== req.user.companyId) {
      return res.status(403).json({ success: false, data: null, error: { code: 'AUTH_FORBIDDEN', message: 'Cannot delete users from other companies' } });
    }

    await UserStore.deleteUser(userId);
    await UserStore.logAuthEvent('user_deleted', userId, { deletedBy: req.user.userId, deletedUser: { email: user.email, role: user.role }, ipAddress: req.ip });

    res.json({ success: true, data: { message: 'User deleted successfully' }, error: null });
  } catch (error) {
    console.error('[User Routes] Delete user error:', error.message);
    res.status(500).json({ success: false, data: null, error: { code: 'USER_ERROR', message: 'Failed to delete user' } });
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
    const validRoles = ['admin', 'manager', 'employee'];

    if (!role || !validRoles.includes(role)) {
      return res.status(400).json({ success: false, data: null, error: { code: 'USER_INVALID_ROLE', message: `Role must be one of: ${validRoles.join(', ')}` } });
    }

    const user = await UserStore.getUserById(userId);
    if (!user) {
      return res.status(404).json({ success: false, data: null, error: { code: 'USER_NOT_FOUND', message: 'User not found' } });
    }

    const oldRole = user.role;
    const updatedUser = await UserStore.updateUserRole(userId, role);
    await UserStore.logAuthEvent('role_changed', userId, { changedBy: req.user.userId, oldRole, newRole: role, ipAddress: req.ip });

    res.json({ success: true, data: sanitizeUser(updatedUser), error: null });
  } catch (error) {
    console.error('[User Routes] Update role error:', error.message);
    res.status(500).json({ success: false, data: null, error: { code: 'USER_ERROR', message: 'Failed to update role' } });
  }
});

/**
 * GET /api/users/:userId/assignments
 * Get user's assignments
 */
router.get('/:userId/assignments', authenticate, async (req, res) => {
  try {
    const { userId } = req.params;
    const isSelf = req.user.userId === userId;
    const isAdmin = req.user.role === 'admin';
    const isManager = req.user.role === 'manager';

    if (!isSelf && !isAdmin && !isManager) {
      const managers = await UserStore.getEmployeeManagers(userId);
      const isThisManager = managers.some(m => m.userId === req.user.userId);
      if (!isThisManager) return res.status(403).json({ success: false, data: null, error: { code: 'AUTH_FORBIDDEN', message: 'Access denied' } });
    }

    const assignments = await UserStore.getAssignments({ user_id: userId });
    res.json({ success: true, data: { assignments, count: assignments.length }, error: null });
  } catch (error) {
    console.error('[User Routes] Get assignments error:', error.message);
    res.status(500).json({ success: false, data: null, error: { code: 'USER_ERROR', message: 'Failed to get assignments' } });
  }
});

/**
 * GET /api/users/:userId/jd-file
 * Download the uploaded JD file for a user
 */
router.get('/:userId/jd-file', authenticate, async (req, res) => {
  try {
    const { userId } = req.params;
    const isSelf = req.user.userId === userId;
    const isAdmin = req.user.role === 'admin';
    const isManager = req.user.role === 'manager';
    if (!isSelf && !isAdmin && !isManager) {
      return res.status(403).json({ success: false, error: 'Access denied' });
    }

    const user = await UserStore.getUserById(userId);
    if (!user?.jobDescriptionFile) {
      return res.status(404).json({ success: false, error: 'No JD file uploaded' });
    }

    const filePath = user.jobDescriptionFile.path || user.jobDescriptionFile.storagePath;
    if (!filePath) return res.status(404).json({ success: false, error: 'File path not found' });

    if (!existsSync(filePath)) {
      return res.status(404).json({ success: false, error: 'File not found on disk' });
    }

    res.download(filePath, user.jobDescriptionFile.name || 'jd-file', (err) => {
      if (err && !res.headersSent) {
        res.status(500).json({ success: false, error: 'Download failed' });
      }
    });
  } catch (error) {
    console.error('[User Routes] JD file download error:', error.message);
    if (!res.headersSent) res.status(500).json({ success: false, error: 'Download failed' });
  }
});

export default router;
