import express from 'express';
import { authenticate, requireRole } from '../middleware/auth.js';
import { PERMISSION_CATALOG } from '../services/permissions.js';

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

export default router;
