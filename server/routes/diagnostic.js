import express from 'express';
import SmartAgent from '../agent/SmartAgent.js';
import { authenticate } from '../middleware/auth.js';

const router = express.Router();
const agent = new SmartAgent();

/**
 * POST /api/diagnostic/submit
 * Submit diagnostic quiz answers
 * Requires authentication - uses learningUUID from authenticated user
 */
router.post('/submit', authenticate, async (req, res) => {
  try {
    const { answers, profilingData } = req.body;
    
    // Extract learningUUID from authenticated user
    const userId = req.user.learningUUID;

    if (!answers || !Array.isArray(answers)) {
      return res.status(400).json({
        success: false,
        data: null,
        error: 'answers array is required'
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
