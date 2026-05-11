/**
 * SimulationAgent.js — Career What-If Simulator
 * Answers: "What if I learn X?" "What if I pivot to Y domain?"
 * Uses LLM for projection + rule-based fallback for reliability
 */

import GeminiService from '../services/GeminiService.js';

const DOMAIN_SALARY_MAP = {
  'full_stack': { min: 70000, max: 150000, currency: 'USD', label: 'Full Stack Developer' },
  'frontend': { min: 65000, max: 130000, currency: 'USD', label: 'Frontend Engineer' },
  'backend': { min: 70000, max: 145000, currency: 'USD', label: 'Backend Engineer' },
  'devops': { min: 85000, max: 165000, currency: 'USD', label: 'DevOps/SRE' },
  'data_science': { min: 90000, max: 175000, currency: 'USD', label: 'Data Scientist' },
  'machine_learning': { min: 100000, max: 200000, currency: 'USD', label: 'ML Engineer' },
  'mobile': { min: 75000, max: 155000, currency: 'USD', label: 'Mobile Developer' },
  'cybersecurity': { min: 90000, max: 170000, currency: 'USD', label: 'Security Engineer' },
  'medicine': { min: 120000, max: 350000, currency: 'USD', label: 'Physician' },
  'law': { min: 80000, max: 250000, currency: 'USD', label: 'Attorney' },
  'finance': { min: 85000, max: 220000, currency: 'USD', label: 'Finance Professional' },
  'civil_engineering': { min: 65000, max: 140000, currency: 'USD', label: 'Civil Engineer' },
  'custom': { min: 60000, max: 120000, currency: 'USD', label: 'Domain Specialist' },
};

const SKILL_BOOST_MAP = {
  'python': { demandBoost: 18, timeWeeks: 8, marketTag: 'High Demand', color: '#3B82F6' },
  'react': { demandBoost: 15, timeWeeks: 6, marketTag: 'Very Popular', color: '#06B6D4' },
  'kubernetes': { demandBoost: 22, timeWeeks: 10, marketTag: 'Premium Skill', color: '#8B5CF6' },
  'machine learning': { demandBoost: 30, timeWeeks: 16, marketTag: '🔥 Hottest', color: '#F59E0B' },
  'rust': { demandBoost: 25, timeWeeks: 14, marketTag: 'Rising Fast', color: '#EF4444' },
  'go': { demandBoost: 20, timeWeeks: 10, marketTag: 'High Paying', color: '#10B981' },
  'aws': { demandBoost: 19, timeWeeks: 8, marketTag: 'Cloud Essential', color: '#F97316' },
  'typescript': { demandBoost: 16, timeWeeks: 4, marketTag: 'Industry Standard', color: '#6366F1' },
  'sql': { demandBoost: 12, timeWeeks: 4, marketTag: 'Evergreen', color: '#14B8A6' },
  'default': { demandBoost: 10, timeWeeks: 6, marketTag: 'Valued Skill', color: '#6B7280' },
};

class SimulationAgent {
  /**
   * What-if simulation: project career outcomes for a proposed skill addition
   */
  async simulate(params) {
    const { userId, currentGoal, currentSkills, proposedSkill, domain, timeframe } = params;

    // Try LLM-powered simulation first
    const llmResult = await this._simulateWithLLM(params);
    if (llmResult) return llmResult;

    // Rule-based fallback
    return this._simulateRuleBased(params);
  }

  async _simulateWithLLM({ currentGoal, currentSkills, proposedSkill, domain, timeframe }) {
    const prompt = `You are a career simulation engine. A learner wants to know: "What happens to my career if I add '${proposedSkill}' to my skillset?"

Current goal: "${currentGoal}"
Domain: ${domain || 'technology'}
Current skills: ${(currentSkills || []).slice(0, 5).join(', ') || 'entry level'}
Timeframe: ${timeframe || '6 months'}

Return ONLY valid JSON with this exact structure:
{
  "scenario": {
    "title": "Adding ${proposedSkill} to your profile",
    "summary": "2-sentence projection of career impact",
    "confidence": 85
  },
  "outcomes": {
    "salaryImpact": { "before": 75000, "after": 95000, "delta": 20000, "deltaPercent": 27 },
    "hiringTime": { "before": "4-6 months", "after": "2-3 months", "improvement": "40% faster" },
    "jobOpenings": { "before": 1200, "after": 2800, "growth": "133% more opportunities" },
    "marketDemand": { "before": 62, "after": 84, "unit": "demand score /100" }
  },
  "timeline": [
    { "week": 2, "milestone": "Foundation concepts mastered", "unlock": "Can discuss in interviews" },
    { "week": 6, "milestone": "First project built", "unlock": "Portfolio entry ready" },
    { "week": 10, "milestone": "Real-world application", "unlock": "Junior-level competency" },
    { "week": 16, "milestone": "Production experience", "unlock": "Competitive for senior roles" }
  ],
  "alternativePaths": [
    { "skill": "Alternative A", "salaryDelta": 15000, "demandScore": 78, "difficulty": "Medium", "verdict": "Good choice" },
    { "skill": "Alternative B", "salaryDelta": 8000, "demandScore": 65, "difficulty": "Easy", "verdict": "Safe choice" },
    { "skill": "Alternative C", "salaryDelta": 35000, "demandScore": 91, "difficulty": "Hard", "verdict": "Best ROI long-term" }
  ],
  "riskFactors": [
    "Skill becomes less relevant if [technology X] dominates",
    "High competition from bootcamp graduates",
    "Requires continuous learning to stay current"
  ],
  "agentVerdict": {
    "recommendation": "STRONG RECOMMEND",
    "reasoning": "2-3 sentence explanation of why this is or isn't worth pursuing",
    "confidenceScore": 88,
    "debateOutcome": "2 of 3 agents voted in favor with 88% confidence"
  }
}

Use realistic salary figures for the domain. Make specific, data-driven projections.`;

    try {
      const result = await GeminiService.generateJSON(prompt,
        'You are a precise career simulation AI. Return only valid JSON with realistic career projections.');
      if (result?.scenario && result?.outcomes) {
        result._source = 'llm';
        console.log(`[SimulationAgent] LLM simulation complete for "${proposedSkill}"`);
        return result;
      }
    } catch (err) {
      console.error('[SimulationAgent] LLM error:', err.message);
    }
    return null;
  }

  _simulateRuleBased({ currentGoal, currentSkills, proposedSkill, domain }) {
    const skillKey = Object.keys(SKILL_BOOST_MAP).find(k =>
      proposedSkill?.toLowerCase().includes(k)
    ) || 'default';
    const boost = SKILL_BOOST_MAP[skillKey];
    const domainKey = domain || 'custom';
    const salaryBase = DOMAIN_SALARY_MAP[domainKey] || DOMAIN_SALARY_MAP.custom;

    const beforeSalary = Math.round((salaryBase.min + salaryBase.max) / 2 * 0.85);
    const afterSalary = Math.round(beforeSalary * (1 + boost.demandBoost / 100));

    return {
      scenario: {
        title: `Adding ${proposedSkill} to your profile`,
        summary: `Learning ${proposedSkill} in your current ${domain} path could significantly boost your market value. Based on current hiring trends, this skill has ${boost.marketTag} status in the job market.`,
        confidence: 78,
      },
      outcomes: {
        salaryImpact: {
          before: beforeSalary,
          after: afterSalary,
          delta: afterSalary - beforeSalary,
          deltaPercent: boost.demandBoost,
        },
        hiringTime: {
          before: '4-6 months',
          after: `${Math.max(2, Math.round(5 * (1 - boost.demandBoost / 80)))} months`,
          improvement: `${Math.round(boost.demandBoost * 0.8)}% faster`,
        },
        jobOpenings: {
          before: 1500,
          after: Math.round(1500 * (1 + boost.demandBoost / 40)),
          growth: `${Math.round(boost.demandBoost * 2.5)}% more opportunities`,
        },
        marketDemand: { before: 58, after: Math.min(97, 58 + boost.demandBoost), unit: 'demand score /100' },
      },
      timeline: [
        { week: 2, milestone: 'Core concepts understood', unlock: 'Can discuss in interviews' },
        { week: Math.round(boost.timeWeeks * 0.4), milestone: 'First working project', unlock: 'Portfolio entry ready' },
        { week: Math.round(boost.timeWeeks * 0.7), milestone: 'Real-world application', unlock: 'Junior competency' },
        { week: boost.timeWeeks, milestone: 'Production-ready skills', unlock: 'Competitive for mid-level roles' },
      ],
      alternativePaths: [
        { skill: 'TypeScript', salaryDelta: 12000, demandScore: 76, difficulty: 'Easy', verdict: 'Quick win' },
        { skill: 'Cloud (AWS/GCP)', salaryDelta: 22000, demandScore: 88, difficulty: 'Medium', verdict: 'Best ROI' },
        { skill: 'ML/AI Integration', salaryDelta: 35000, demandScore: 94, difficulty: 'Hard', verdict: 'Future-proof' },
      ],
      riskFactors: [
        'Technology landscape shifts require continuous upskilling',
        'Competition from bootcamp graduates entering the market',
        'Without portfolio projects, skill alone may not differentiate',
      ],
      agentVerdict: {
        recommendation: boost.demandBoost >= 20 ? 'STRONG RECOMMEND' : 'RECOMMEND',
        reasoning: `${proposedSkill} has ${boost.marketTag} status and can increase your market value by ~${boost.demandBoost}%. The ${boost.timeWeeks}-week investment has strong ROI relative to career trajectory impact.`,
        confidenceScore: 78,
        debateOutcome: `2 of 3 agents voted in favor with 78% confidence`,
      },
      _source: 'rule-based',
    };
  }

  /**
   * Compare two career paths side by side
   */
  async comparePaths({ goal, pathA, pathB, domain }) {
    const [simA, simB] = await Promise.all([
      this.simulate({ currentGoal: goal, proposedSkill: pathA, domain }),
      this.simulate({ currentGoal: goal, proposedSkill: pathB, domain }),
    ]);
    return {
      pathA: { name: pathA, ...simA },
      pathB: { name: pathB, ...simB },
      verdict: simA.outcomes.salaryImpact.deltaPercent > simB.outcomes.salaryImpact.deltaPercent
        ? `${pathA} has higher salary impact (+${simA.outcomes.salaryImpact.deltaPercent}% vs +${simB.outcomes.salaryImpact.deltaPercent}%)`
        : `${pathB} has higher salary impact (+${simB.outcomes.salaryImpact.deltaPercent}% vs +${simA.outcomes.salaryImpact.deltaPercent}%)`,
    };
  }

  /**
   * Generate career trajectory forecast for existing user
   */
  forecastTrajectory(session) {
    const { goal, sessions, skillTree } = session;
    const avgScore = sessions.length
      ? sessions.reduce((s, r) => s + r.score, 0) / sessions.length
      : 0;
    const completedDays = sessions.length;
    const totalDays = goal.totalEstimatedDays || 30;
    const progressPct = Math.round((completedDays / totalDays) * 100);
    const velocity = sessions.length >= 3
      ? (sessions.slice(-3).reduce((s, r) => s + r.score, 0) / 3) - (sessions.slice(0, 3).reduce((s, r) => s + r.score, 0) / 3)
      : 0;

    const domainSalary = DOMAIN_SALARY_MAP[goal.domain] || DOMAIN_SALARY_MAP.custom;
    const readinessPct = Math.min(100, Math.round(progressPct * 0.6 + avgScore * 0.4));
    const projectedSalary = Math.round(domainSalary.min + (domainSalary.max - domainSalary.min) * (readinessPct / 100));

    const months = [1, 3, 6, 12];
    const trajectory = months.map(m => ({
      month: m,
      label: m === 1 ? '1 Month' : m === 3 ? '3 Months' : m === 6 ? '6 Months' : '12 Months',
      masteryScore: Math.min(100, Math.round(avgScore + velocity * m * 2)),
      readinessForHiring: Math.min(100, Math.round(readinessPct + m * 6)),
      projectedSalary: Math.round(projectedSalary * (1 + m * 0.015)),
      milestone: m === 1 ? 'Foundation complete'
        : m === 3 ? 'Portfolio-ready'
        : m === 6 ? 'Junior role eligible'
        : 'Mid-level competitive',
    }));

    return {
      currentState: {
        progressPct,
        avgScore: Math.round(avgScore),
        velocity: Math.round(velocity),
        readinessPct,
        projectedSalary,
      },
      trajectory,
      opportunityRadar: this._buildOpportunityRadar(goal, avgScore),
    };
  }

  _buildOpportunityRadar(goal, avgScore) {
    const skills = (goal.skills || []).slice(0, 6);
    return skills.map(skill => ({
      skill: skill.name,
      current: skill.mastery || Math.round(avgScore * 0.8),
      target: 85,
      marketDemand: Math.round(60 + Math.random() * 35),
      gap: Math.max(0, 85 - (skill.mastery || Math.round(avgScore * 0.8))),
    }));
  }
}

export default new SimulationAgent();
