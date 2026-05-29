import express from 'express';
import agentMemory from '../agent/AgentMemory.js';
import { authenticate } from '../middleware/auth.js';

const router = express.Router();

/**
 * GET /api/memory/:userId
 * Get full memory for a user
 */
router.get('/:userId', authenticate, (req, res) => {
  try {
    const { userId } = req.params;
    if (req.user.role !== 'admin' && req.user.userId !== userId) {
      return res.status(403).json({ success: false, data: null, error: 'Access denied' });
    }
    const memory = agentMemory.getFullMemory(userId);
    res.json({ success: true, data: memory, error: null });
  } catch (err) {
    console.error('[GET /api/memory/:userId]', err);
    res.status(500).json({ success: false, data: null, error: err.message });
  }
});

/**
 * POST /api/memory/:userId/learn
 * Store a semantic fact
 * Body: { key, value }
 */
router.post('/:userId/learn', authenticate, (req, res) => {
  try {
    const { userId } = req.params;
    if (req.user.role !== 'admin' && req.user.userId !== userId) {
      return res.status(403).json({ success: false, data: null, error: 'Access denied' });
    }
    const { key, value } = req.body;
    if (!key || value === undefined) {
      return res.status(400).json({ success: false, data: null, error: 'key and value are required' });
    }
    agentMemory.learn(userId, key, value);
    res.json({ success: true, data: { learned: true, key, value }, error: null });
  } catch (err) {
    console.error('[POST /api/memory/:userId/learn]', err);
    res.status(500).json({ success: false, data: null, error: err.message });
  }
});

/**
 * POST /api/memory/:userId/remember
 * Record an episodic event
 * Body: { type, content, context, importance }
 */
router.post('/:userId/remember', authenticate, (req, res) => {
  try {
    const { userId } = req.params;
    if (req.user.role !== 'admin' && req.user.userId !== userId) {
      return res.status(403).json({ success: false, data: null, error: 'Access denied' });
    }
    const { type, content, context, importance } = req.body;
    if (!type || !content) {
      return res.status(400).json({ success: false, data: null, error: 'type and content are required' });
    }
    agentMemory.remember(userId, { type, content, context, importance: importance || 5 });
    res.json({ success: true, data: { remembered: true }, error: null });
  } catch (err) {
    console.error('[POST /api/memory/:userId/remember]', err);
    res.status(500).json({ success: false, data: null, error: err.message });
  }
});

/**
 * DELETE /api/memory/:userId
 * Clear memory for a user
 */
router.delete('/:userId', authenticate, (req, res) => {
  try {
    const { userId } = req.params;
    if (req.user.role !== 'admin' && req.user.userId !== userId) {
      return res.status(403).json({ success: false, data: null, error: 'Access denied' });
    }
    agentMemory.clear(userId);
    res.json({ success: true, data: { cleared: true }, error: null });
  } catch (err) {
    console.error('[DELETE /api/memory/:userId]', err);
    res.status(500).json({ success: false, data: null, error: err.message });
  }
});

/**
 * GET /api/memory/:userId/recall?context=xxx
 * Recall relevant memories for a context
 */
router.get('/:userId/recall', authenticate, (req, res) => {
  try {
    const { userId } = req.params;
    if (req.user.role !== 'admin' && req.user.userId !== userId) {
      return res.status(403).json({ success: false, data: null, error: 'Access denied' });
    }
    const context = req.query.context || '';
    const limit = parseInt(req.query.limit, 10) || 10;
    const recalled = agentMemory.recall(userId, context, limit);
    res.json({ success: true, data: recalled, error: null });
  } catch (err) {
    console.error('[GET /api/memory/:userId/recall]', err);
    res.status(500).json({ success: false, data: null, error: err.message });
  }
});

export default router;
