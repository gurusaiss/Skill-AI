import express from 'express';
import InterviewAgent from '../agent/InterviewAgent.js';

const router = express.Router();

/**
 * POST /api/interview/generate
 * Generate interview questions based on role and skills
 */
router.post('/generate', async (req, res, next) => {
  try {
    const { role, skills, difficulty = 'medium', count = 5 } = req.body;

    if (!role || !skills) {
      return res.status(400).json({
        success: false,
        data: null,
        error: 'Role and skills are required'
      });
    }

    const questions = await InterviewAgent.generateQuestions({
      role,
      skills,
      difficulty,
      count: Math.min(count, 15) // Cap at 15 questions
    });

    res.json({
      success: true,
      data: questions,
      error: null
    });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /api/interview/evaluate
 * Evaluate a single interview answer
 */
router.post('/evaluate', async (req, res, next) => {
  try {
    const { question, answer, role } = req.body;

    if (!question || !answer || !role) {
      return res.status(400).json({
        success: false,
        data: null,
        error: 'Question, answer, and role are required'
      });
    }

    const evaluation = await InterviewAgent.evaluateAnswer({
      question,
      answer,
      role
    });

    res.json({
      success: true,
      data: evaluation,
      error: null
    });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /api/interview/report
 * Generate overall interview performance report
 */
router.post('/report', async (req, res, next) => {
  try {
    const { questions, role } = req.body;

    if (!questions || !Array.isArray(questions) || !role) {
      return res.status(400).json({
        success: false,
        data: null,
        error: 'Questions array and role are required'
      });
    }

    const report = await InterviewAgent.generateReport(questions, role);

    res.json({
      success: true,
      data: report,
      error: null
    });
  } catch (error) {
    next(error);
  }
});

export default router;
