import express from 'express';
import { authenticate, requireRole } from '../middleware/auth.js';
import { PlatformSettings } from '../services/DataStore.js';

const router = express.Router();

const ALLOWED_SECTIONS = ['general', 'security', 'notifications'];

// Defaults mirror what the Settings UI previously hardcoded as
// defaultValue/defaultChecked props — same values, now actually persisted.
const DEFAULTS = {
  general: {
    platformName: 'SkillForge AI',
    tagline: 'Autonomous AI Learning Platform · 9-Agent System',
    supportEmail: 'support@skillforge.ai',
    defaultUserRole: 'employee',
    maintenanceMode: false,
  },
  security: {
    require2FAForAdmins: true,
    enforceStrongPasswords: true,
    singleSessionPerUser: false,
    autoLogoutOnInactivity: true,
    ipWhitelist: false,
    sessionTimeoutMinutes: 60,
    maxLoginAttempts: 5,
  },
  notifications: {
    newUserRegistered: true,
    moduleCreated: true,
    assignmentCompleted: true,
    quizScoreBelow60: true,
    managerRequestPending: false,
    weeklyDigest: false,
  },
};

/**
 * GET /api/settings
 * Admin: read this company's General/Security/Notifications settings
 * (merged with defaults for any field never saved yet).
 */
router.get('/', authenticate, requireRole('admin'), async (req, res) => {
  try {
    const companyId = req.user.companyId || 'default';
    const saved = await PlatformSettings.getByCompany(companyId);
    const merged = {};
    for (const section of ALLOWED_SECTIONS) {
      merged[section] = { ...DEFAULTS[section], ...(saved[section] || {}) };
    }
    res.json({ success: true, data: merged, error: null });
  } catch (e) {
    console.error('[GET /api/settings]', e.message);
    res.status(500).json({ success: false, data: null, error: 'Failed to load settings' });
  }
});

/**
 * PUT /api/settings/:section
 * Admin: update one section (general | security | notifications).
 * Body is shallow-merged into the existing section — omitted fields keep
 * their prior value.
 */
router.put('/:section', authenticate, requireRole('admin'), async (req, res) => {
  try {
    const { section } = req.params;
    if (!ALLOWED_SECTIONS.includes(section)) {
      return res.status(400).json({ success: false, data: null, error: `section must be one of: ${ALLOWED_SECTIONS.join(', ')}` });
    }
    const companyId = req.user.companyId || 'default';
    const values = req.body || {};
    const merged = await PlatformSettings.updateSection(companyId, section, values);
    res.json({ success: true, data: { ...DEFAULTS[section], ...merged[section] }, error: null });
  } catch (e) {
    console.error('[PUT /api/settings/:section]', e.message);
    res.status(500).json({ success: false, data: null, error: 'Failed to save settings' });
  }
});

export default router;
