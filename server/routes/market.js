import express from 'express';
import MarketAgent from '../agent/MarketAgent.js';
import SmartAgent from '../agent/SmartAgent.js';
import { authenticate } from '../middleware/auth.js';
import UserStore from '../services/UserStore.js';

const router = express.Router();
const smartAgent = new SmartAgent();

/**
 * GET /api/market/intelligence/:userId
 * Get personalized market intelligence for a user's goal
 */
router.get('/intelligence/:userId', authenticate, async (req, res) => {
  try {
    const { userId } = req.params;

    if (req.user.role !== 'admin' && req.user.userId !== userId) {
      return res.status(403).json({ success: false, data: null, error: 'Access denied' });
    }

    const user = await UserStore.getUserById(req.user.userId);
    const session = smartAgent.loadSession(user.learningUUID);
    if (!session?.goal) {
      return res.status(404).json({ success: false, data: null, error: 'No learning goal found. Complete goal setup first.' });
    }
    const data = await MarketAgent.getIntelligence({
      domain: session.goal.domain,
      goal: session.goal.goalText,
      skills: session.goal.skills?.map(s => s.name) || [],
    });
    res.json({ success: true, data, error: null });
  } catch (err) {
    const status = err.message.includes('not found') ? 404 : 500;
    res.status(status).json({ success: false, data: null, error: err.message });
  }
});

/**
 * POST /api/market/intelligence
 * Get market intelligence for any domain/goal (no userId required)
 */
router.post('/intelligence', authenticate, async (req, res) => {
  try {
    const { domain, goal, skills } = req.body;
    if (!goal && !domain) {
      return res.status(400).json({ success: false, data: null, error: 'domain or goal required' });
    }
    const data = await MarketAgent.getIntelligence({ domain: domain || 'custom', goal, skills: skills || [] });
    res.json({ success: true, data, error: null });
  } catch (err) {
    res.status(500).json({ success: false, data: null, error: err.message });
  }
});

/**
 * GET /api/market/trends/:domain
 * Get skill trends for a domain
 */
router.get('/trends/:domain', authenticate, (req, res) => {
  try {
    const trends = MarketAgent.getSkillTrends(req.params.domain);
    res.json({ success: true, data: trends, error: null });
  } catch (err) {
    res.status(500).json({ success: false, data: null, error: err.message });
  }
});

export default router;
