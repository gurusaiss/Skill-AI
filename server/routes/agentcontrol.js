import express from 'express';
const router = express.Router();

router.get('/stats', (req, res) => {
  res.json({
    totalCalls: 247,
    agentsActive: 9,
    decisionsToday: 34,
    uptime: '99.9%',
    agents: [
      { name: 'GoalAgent',       icon: '🎯', calls: 89,  successRate: 97, avgLatencyMs: 312, color: '#6366F1' },
      { name: 'DecomposeAgent',  icon: '🌳', calls: 89,  successRate: 95, avgLatencyMs: 445, color: '#8B5CF6' },
      { name: 'DiagnosticAgent', icon: '📋', calls: 67,  successRate: 98, avgLatencyMs: 523, color: '#06B6D4' },
      { name: 'ScoringAgent',    icon: '📊', calls: 67,  successRate: 99, avgLatencyMs: 201, color: '#0EA5E9' },
      { name: 'CurriculumAgent', icon: '📅', calls: 89,  successRate: 96, avgLatencyMs: 678, color: '#14B8A6' },
      { name: 'EvaluatorAgent',  icon: '✅', calls: 134, successRate: 94, avgLatencyMs: 412, color: '#10B981' },
      { name: 'AdaptorAgent',    icon: '⚡', calls: 45,  successRate: 92, avgLatencyMs: 234, color: '#F59E0B' },
      { name: 'MarketAgent',     icon: '💼', calls: 89,  successRate: 96, avgLatencyMs: 892, color: '#EC4899' },
      { name: 'SimulationAgent', icon: '🔮', calls: 23,  successRate: 95, avgLatencyMs: 756, color: '#A78BFA' },
    ]
  });
});

export default router;
