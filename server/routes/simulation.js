import express from 'express';
import SimulationAgent from '../agent/SimulationAgent.js';
import SmartAgent from '../agent/SmartAgent.js';
import { authenticate } from '../middleware/auth.js';
import UserStore from '../services/UserStore.js';

const router = express.Router();
const smartAgent = new SmartAgent();

/**
 * POST /api/simulation/whatif
 * What-if scenario analysis
 */
router.post('/whatif', authenticate, async (req, res) => {
  try {
    const { proposedSkill, timeframe } = req.body;
    if (!proposedSkill) {
      return res.status(400).json({ success: false, data: null, error: 'proposedSkill required' });
    }

    const user = await UserStore.getUserById(req.user.userId);
    let session;
    try { session = smartAgent.loadSession(user.learningUUID); } catch { session = null; }

    const result = await SimulationAgent.simulate({
      userId: user.learningUUID,
      currentGoal: session?.goal?.goalText || 'Career growth',
      currentSkills: session?.goal?.skills?.map(s => s.name) || [],
      proposedSkill,
      domain: session?.goal?.domain || 'custom',
      timeframe: timeframe || '6 months',
    });

    res.json({ success: true, data: result, error: null });
  } catch (err) {
    console.error('[POST /api/simulation/whatif]', err);
    res.status(500).json({ success: false, data: null, error: err.message });
  }
});

/**
 * POST /api/simulation/compare
 * Compare two career paths
 */
router.post('/compare', authenticate, async (req, res) => {
  try {
    const { pathA, pathB } = req.body;
    if (!pathA || !pathB) {
      return res.status(400).json({ success: false, data: null, error: 'pathA and pathB required' });
    }

    const user = await UserStore.getUserById(req.user.userId);
    let session;
    try { session = smartAgent.loadSession(user.learningUUID); } catch { session = null; }

    const result = await SimulationAgent.comparePaths({
      goal: session?.goal?.goalText || 'Career growth',
      pathA,
      pathB,
      domain: session?.goal?.domain || 'custom',
    });

    res.json({ success: true, data: result, error: null });
  } catch (err) {
    res.status(500).json({ success: false, data: null, error: err.message });
  }
});

/**
 * GET /api/simulation/forecast/:userId
 * Career trajectory forecast for existing user
 */
router.get('/forecast/:userId', authenticate, async (req, res) => {
  try {
    const { userId } = req.params;

    if (req.user.role !== 'admin' && req.user.userId !== userId) {
      return res.status(403).json({ success: false, data: null, error: 'Access denied' });
    }

    const user = await UserStore.getUserById(req.user.userId);
    const session = smartAgent.loadSession(user.learningUUID);
    const forecast = SimulationAgent.forecastTrajectory(session);
    res.json({ success: true, data: forecast, error: null });
  } catch (err) {
    const status = err.message.includes('not found') ? 404 : 500;
    res.status(status).json({ success: false, data: null, error: err.message });
  }
});

export default router;
