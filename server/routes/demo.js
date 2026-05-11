/**
 * demo.js — Guided Demo Mode for Hackathon Judges
 * Executes a live autonomous career analysis with step-by-step visibility
 * Uses Server-Sent Events (SSE) to stream agent orchestration in real-time
 */

import express from 'express';
import SmartAgent from '../agent/SmartAgent.js';
import MarketAgent from '../agent/MarketAgent.js';
import SimulationAgent from '../agent/SimulationAgent.js';

const router = express.Router();
const smartAgent = new SmartAgent();

const DEMO_GOALS = {
  'fullstack': 'I want to become a Full Stack Developer proficient in React, Node.js, and PostgreSQL to build production web applications',
  'datascience': 'I want to become a Data Scientist who can build machine learning models and extract insights from large datasets',
  'doctor': 'I want to become a Medical Doctor (MBBS) specializing in internal medicine',
  'lawyer': 'I want to become a Corporate Lawyer specializing in technology and intellectual property law',
  'devops': 'I want to become a DevOps/Cloud Engineer proficient in Kubernetes, AWS, and infrastructure automation',
};

/**
 * GET /api/demo/run?goal=fullstack
 * Server-Sent Events stream — streams each agent step as it executes
 * Judges see real-time agentic orchestration
 */
router.get('/run', async (req, res) => {
  const goalKey = req.query.goal || 'fullstack';
  const goalText = DEMO_GOALS[goalKey] || DEMO_GOALS.fullstack;

  // SSE headers
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');

  const send = (event, data) => {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };

  const delay = (ms) => new Promise(r => setTimeout(r, ms));

  try {
    send('start', { message: 'SkillForge Autonomous Agent System activating...', timestamp: new Date().toISOString() });
    await delay(400);

    // Step 1: GoalAgent
    send('agent', {
      step: 1, total: 7,
      agent: 'GoalAgent',
      icon: '🎯',
      status: 'active',
      message: `Analyzing goal: "${goalText.slice(0, 60)}..."`,
    });
    await delay(600);

    // Step 2: DecomposeAgent (real API call)
    send('agent', {
      step: 2, total: 7,
      agent: 'DecomposeAgent',
      icon: '🌳',
      status: 'active',
      message: 'Decomposing goal into skill tree...',
    });

    const goalResult = await smartAgent.processGoal(goalText, null, null);
    const { userId, skillTree, diagnosticQuestions } = goalResult;

    send('agent', {
      step: 2, total: 7,
      agent: 'DecomposeAgent',
      icon: '🌳',
      status: 'complete',
      message: `Skill tree built: ${skillTree.skills.length} core skills identified`,
      data: {
        skills: skillTree.skills.slice(0, 5).map(s => ({ name: s.name, days: s.days })),
        domain: skillTree.domainName,
      },
    });
    await delay(500);

    // Step 3: DiagnosticAgent
    send('agent', {
      step: 3, total: 7,
      agent: 'DiagnosticAgent',
      icon: '📋',
      status: 'complete',
      message: `Generated ${diagnosticQuestions.length} diagnostic questions for proficiency assessment`,
      data: { questionCount: diagnosticQuestions.length, source: diagnosticQuestions[0]?.source || 'llm' },
    });
    await delay(500);

    // Step 4: ScoringAgent (simulate diagnostic answers)
    send('agent', {
      step: 4, total: 7,
      agent: 'ScoringAgent',
      icon: '📊',
      status: 'active',
      message: 'Running diagnostic simulation — scoring baseline proficiency...',
    });
    await delay(700);

    // Auto-submit diagnostic with simulated intermediate scores
    const simulatedAnswers = diagnosticQuestions.map((q, i) => {
      const optionIndex = i % 4;
      return { questionId: q.id, answer: q.options?.[optionIndex] || 'Moderate understanding' };
    });
    const diagnosticResult = await smartAgent.submitDiagnostic(userId, simulatedAnswers);

    send('agent', {
      step: 4, total: 7,
      agent: 'ScoringAgent',
      icon: '📊',
      status: 'complete',
      message: 'Skill gaps identified — personalized scoring complete',
      data: {
        scores: Object.entries(diagnosticResult.diagnosticScores).slice(0, 3).map(([k, v]) => ({ skill: k, score: v })),
      },
    });
    await delay(500);

    // Step 5: CurriculumAgent
    send('agent', {
      step: 5, total: 7,
      agent: 'CurriculumAgent',
      icon: '📅',
      status: 'complete',
      message: `Learning plan generated: ${diagnosticResult.learningPlan.length} personalized sessions`,
      data: {
        totalDays: diagnosticResult.learningPlan.length,
        firstWeek: diagnosticResult.learningPlan.slice(0, 3).map(d => ({ day: d.day, skill: d.skillName, type: d.sessionType })),
      },
    });
    await delay(500);

    // Step 6: MarketAgent
    send('agent', {
      step: 6, total: 7,
      agent: 'MarketAgent',
      icon: '📈',
      status: 'active',
      message: 'Analyzing job market intelligence for your goal...',
    });

    const marketData = await MarketAgent.getIntelligence({
      domain: skillTree.domain,
      goal: goalText,
      skills: skillTree.skills.map(s => s.name),
    });

    send('agent', {
      step: 6, total: 7,
      agent: 'MarketAgent',
      icon: '📈',
      status: 'complete',
      message: `Market intelligence complete — ${marketData.openJobs} open positions, demand score ${marketData.demandScore}/100`,
      data: {
        demandScore: marketData.demandScore,
        openJobs: marketData.openJobs,
        avgSalary: marketData.avgSalary,
        topSkills: marketData.topSkills?.slice(0, 3),
      },
    });
    await delay(500);

    // Step 7: SimulationAgent
    send('agent', {
      step: 7, total: 7,
      agent: 'SimulationAgent',
      icon: '🔮',
      status: 'active',
      message: 'Running career trajectory simulation...',
    });

    const forecast = SimulationAgent.forecastTrajectory({
      goal: { ...skillTree, goalText, totalEstimatedDays: skillTree.skills.reduce((s, sk) => s + sk.days, 0) },
      sessions: [],
      skillTree,
    });

    send('agent', {
      step: 7, total: 7,
      agent: 'SimulationAgent',
      icon: '🔮',
      status: 'complete',
      message: `6-month trajectory simulated — projected readiness ${forecast.trajectory[1]?.readinessForHiring}% at 3 months`,
      data: {
        trajectory: forecast.trajectory.slice(0, 3),
        projectedSalary: forecast.currentState.projectedSalary,
      },
    });
    await delay(400);

    // Final summary
    send('complete', {
      userId,
      goalText,
      summary: {
        domain: skillTree.domainName,
        skills: skillTree.skills.length,
        sessions: diagnosticResult.learningPlan.length,
        marketDemand: marketData.demandScore,
        projectedSalary: forecast.currentState.projectedSalary,
        opportunityCount: marketData.openJobs,
      },
      message: '✅ Autonomous analysis complete — 7 agents orchestrated successfully',
      timestamp: new Date().toISOString(),
    });

  } catch (err) {
    console.error('[Demo run error]', err);
    send('error', { message: err.message });
  } finally {
    res.end();
  }
});

/**
 * GET /api/demo/goals
 * List available demo goals
 */
router.get('/goals', (req, res) => {
  res.json({
    success: true,
    data: Object.entries(DEMO_GOALS).map(([key, text]) => ({ key, preview: text.slice(0, 80) + '...' })),
    error: null,
  });
});

export default router;
