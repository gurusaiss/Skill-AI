import express from 'express';
import SimulationAgent from '../agent/SimulationAgent.js';
import SmartAgent from '../agent/SmartAgent.js';

const router = express.Router();
const smartAgent = new SmartAgent();

/**
 * POST /api/simulation/whatif
 * What-if scenario analysis
 */
router.post('/whatif', async (req, res) => {
  try {
    const { userId, proposedSkill, timeframe } = req.body;
    if (!userId || !proposedSkill) {
      return res.status(400).json({ success: false, data: null, error: 'userId and proposedSkill required' });
    }
    let session;
    try { session = smartAgent.loadSession(userId); } catch { session = null; }

    const result = await SimulationAgent.simulate({
      userId,
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
router.post('/compare', async (req, res) => {
  try {
    const { userId, pathA, pathB } = req.body;
    if (!pathA || !pathB) {
      return res.status(400).json({ success: false, data: null, error: 'pathA and pathB required' });
    }
    let session;
    try { session = smartAgent.loadSession(userId); } catch { session = null; }

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
router.get('/forecast/:userId', async (req, res) => {
  try {
    const session = smartAgent.loadSession(req.params.userId);
    const forecast = SimulationAgent.forecastTrajectory(session);
    res.json({ success: true, data: forecast, error: null });
  } catch (err) {
    const status = err.message.includes('not found') ? 404 : 500;
    res.status(status).json({ success: false, data: null, error: err.message });
  }
});

export default router;
