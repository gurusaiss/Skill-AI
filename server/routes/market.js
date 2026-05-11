import express from 'express';
import MarketAgent from '../agent/MarketAgent.js';
import SmartAgent from '../agent/SmartAgent.js';

const router = express.Router();
const smartAgent = new SmartAgent();

/**
 * GET /api/market/intelligence/:userId
 * Get personalized market intelligence for a user's goal
 */
router.get('/intelligence/:userId', async (req, res) => {
  try {
    const session = smartAgent.loadSession(req.params.userId);
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
router.post('/intelligence', async (req, res) => {
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
router.get('/trends/:domain', (req, res) => {
  try {
    const trends = MarketAgent.getSkillTrends(req.params.domain);
    res.json({ success: true, data: trends, error: null });
  } catch (err) {
    res.status(500).json({ success: false, data: null, error: err.message });
  }
});

export default router;
