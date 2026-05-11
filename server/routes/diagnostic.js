import express from 'express';
import SmartAgent from '../agent/SmartAgent.js';

const router = express.Router();
const agent = new SmartAgent();

/**
 * POST /api/diagnostic/submit
 * Submit diagnostic quiz answers
 */
router.post('/submit', async (req, res) => {
  try {
    const { userId, answers, profilingData } = req.body;

    if (!userId || !answers || !Array.isArray(answers)) {
      return res.status(400).json({
        success: false,
        data: null,
        error: 'userId and answers array are required'
      });
    }

    const result = await agent.submitDiagnostic(userId, answers, profilingData || null);
    
    res.json({
      success: true,
      data: result,
      error: null
    });
  } catch (error) {
    console.error('[POST /api/diagnostic/submit]', error);
    res.status(500).json({
      success: false,
      data: null,
      error: error.message
    });
  }
});

export default router;
