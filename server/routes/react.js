import express from 'express';
import reactChain from '../agent/ReactChain.js';

const router = express.Router();

/**
 * POST /api/react/run
 * Run a ReAct chain for a given goal and learner context
 */
router.post('/run', async (req, res) => {
  try {
    const { goal, sessions = [], skills = [], planDay = 1 } = req.body;

    if (!goal || typeof goal !== 'string' || goal.trim().length < 3) {
      return res.status(400).json({
        success: false,
        data: null,
        error: 'A valid goal string is required.',
      });
    }

    const result = await reactChain.run(goal.trim(), { sessions, skills, planDay });

    return res.json({ success: true, data: result });
  } catch (err) {
    console.error('[react/run]', err.message);
    return res.status(500).json({
      success: false,
      data: null,
      error: err.message || 'ReAct chain failed',
    });
  }
});

/**
 * GET /api/react/demo
 * Returns a pre-built demo ReAct chain — no auth required
 */
router.get('/demo', async (_req, res) => {
  try {
    const demoGoal = 'Become a Full Stack Developer';
    const demoContext = {
      sessions: [
        { score: 62, topic: 'React Hooks' },
        { score: 55, topic: 'Node.js APIs' },
        { score: 78, topic: 'JavaScript Fundamentals' },
        { score: 48, topic: 'SQL Databases' },
        { score: 71, topic: 'CSS Flexbox' },
      ],
      skills: [
        { name: 'React Hooks', mastery: 62 },
        { name: 'Node.js', mastery: 55 },
        { name: 'SQL', mastery: 48 },
        { name: 'JavaScript', mastery: 78 },
        { name: 'TypeScript', mastery: 40 },
      ],
      planDay: 7,
    };

    const result = await reactChain.run(demoGoal, demoContext);
    return res.json({ success: true, data: result });
  } catch (err) {
    console.error('[react/demo]', err.message);
    return res.status(500).json({
      success: false,
      data: null,
      error: err.message || 'Demo chain failed',
    });
  }
});

export default router;
