import express from 'express';
import SmartAgent from '../agent/SmartAgent.js';

const router = express.Router();
const agent = new SmartAgent();

/**
 * POST /api/report/generate
 * Generate report for user
 */
router.post('/generate', async (req, res) => {
  try {
    const { userId } = req.body;

    if (!userId) {
      return res.status(400).json({
        success: false,
        data: null,
        error: 'userId is required'
      });
    }

    const report = await agent.generateReport(userId);

    res.json({
      success: true,
      data: report,
      error: null
    });
  } catch (error) {
    console.error('[POST /api/report/generate]', error);
    res.status(500).json({
      success: false,
      data: null,
      error: error.message
    });
  }
});

/**
 * GET /api/report/:userId
 * Get report for user
 */
router.get('/:userId', async (req, res) => {
  try {
    const { userId } = req.params;
    
    const session = agent.loadSession(userId);
    
    if (!session.report) {
      return res.status(404).json({
        success: false,
        data: null,
        error: 'Report not yet generated'
      });
    }
    
    res.json({
      success: true,
      data: session.report,
      error: null
    });
  } catch (error) {
    console.error('[GET /api/report/:userId]', error);
    
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
