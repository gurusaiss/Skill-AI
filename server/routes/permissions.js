import express from 'express';
import { authenticate, requireRole } from '../middleware/auth.js';
import {
  PERMISSION_CATALOG,
  ALL_PERMISSION_KEYS,
  ROLE_DEFAULT_PERMISSIONS,
  EDITABLE_ROLE_DEFAULT_KEYS,
  saveRoleDefaultPermissions,
} from '../services/permissions.js';

const router = express.Router();

/**
 * GET /api/permissions/catalog
 * Full permission catalog (keys, labels, descriptions, categories) for the
 * admin Permissions page to render. Admin-only — only admins manage
 * per-user feature permissions.
 */
router.get('/catalog', authenticate, requireRole('admin'), (req, res) => {
  res.json({ success: true, data: { catalog: PERMISSION_CATALOG }, error: null });
});

/**
 * GET /api/permissions/role-defaults
 * The current default permission set for each of the 3 editable role
 * buckets (Admin / Manager / Employee) — the platform-wide baseline every
 * user of that role starts with before any per-user grant/revoke override.
 */
router.get('/role-defaults', authenticate, requireRole('admin'), (req, res) => {
  const data = {};
  for (const role of EDITABLE_ROLE_DEFAULT_KEYS) {
    data[role] = ROLE_DEFAULT_PERMISSIONS[role] || [];
  }
  res.json({ success: true, data, error: null });
});

/**
 * PUT /api/permissions/role-defaults/:role
 * Replaces the default permission set for one of the 3 editable role
 * buckets. Body: { granted: string[] } — the full authoritative list, not a
 * diff. Persisted so it survives a restart, and takes effect immediately
 * for every user of that role who doesn't have a conflicting per-user
 * override.
 */
router.put('/role-defaults/:role', authenticate, requireRole('admin'), async (req, res) => {
  const { role } = req.params;
  const { granted } = req.body || {};
  if (!EDITABLE_ROLE_DEFAULT_KEYS.includes(role)) {
    return res.status(400).json({ success: false, data: null, error: `"${role}" is not an editable role default. Editable roles: ${EDITABLE_ROLE_DEFAULT_KEYS.join(', ')}` });
  }
  if (!Array.isArray(granted)) {
    return res.status(400).json({ success: false, data: null, error: '"granted" must be an array of permission keys' });
  }
  const invalid = granted.filter(k => !ALL_PERMISSION_KEYS.includes(k));
  if (invalid.length > 0) {
    return res.status(400).json({ success: false, data: null, error: `Unknown permission key(s): ${invalid.join(', ')}` });
  }
  try {
    const saved = await saveRoleDefaultPermissions(role, granted);
    res.json({ success: true, data: { role, granted: saved }, error: null });
  } catch (e) {
    res.status(500).json({ success: false, data: null, error: e.message || 'Failed to save role defaults' });
  }
});

export default router;
