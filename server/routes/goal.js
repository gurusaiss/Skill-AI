import express from 'express';
import SmartAgent from '../agent/SmartAgent.js';

const router = express.Router();
const agent = new SmartAgent();

/**
 * POST /api/goal
 * Submit learning goal and get skill tree + diagnostic questions
 */
router.post('/', async (req, res) => {
  try {
    const { goalText, profilingData } = req.body;

    // Validate goal text
    if (!goalText || goalText.length < 5 || goalText.length > 500) {
      return res.status(400).json({
        success: false,
        data: null,
        error: 'Goal text must be between 5 and 500 characters'
      });
    }

    // Process goal — pass profiling data if provided
    const result = await agent.processGoal(goalText, null, profilingData || null);
    
    res.json({
      success: true,
      data: result,
      error: null
    });
  } catch (error) {
    console.error('[POST /api/goal]', error);
    res.status(500).json({
      success: false,
      data: null,
      error: error.message
    });
  }
});

/**
 * GET /api/goal/:userId
 * Get full session data
 */
router.get('/:userId', async (req, res) => {
  try {
    const { userId } = req.params;
    
    const session = agent.loadSession(userId);
    
    res.json({
      success: true,
      data: session,
      error: null
    });
  } catch (error) {
    console.error('[GET /api/goal/:userId]', error);
    
    if (error.message.includes('not found')) {
      return res.status(404).json({
        success: false,
        data: null,
        error: error.message
      });
    }
    
    res.status(500).json({
      success: false,
      data: null,
      error: error.message
    });
  }
});

export default router;
