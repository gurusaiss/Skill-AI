// Demo Fallback Data Store
// Provides realistic sample data when Supabase is not configured

import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import crypto from 'crypto';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DATA_DIR = path.join(__dirname, '..', 'data');

// Ensure data directory exists
try { await fs.mkdir(DATA_DIR, { recursive: true }); } catch {}

const SAMPLE_SKILLS = [
  { id: 'skill_1', name: 'HTML5 & Semantic Markup', mastery: 0, status: 'active', topics: ['HTML5', 'Semantic Elements', 'Accessibility', 'SEO'] },
  { id: 'skill_2', name: 'CSS3 & Responsive Design', mastery: 0, status: 'locked', topics: ['Flexbox', 'Grid', 'Media Queries', 'CSS Variables'] },
  { id: 'skill_3', name: 'JavaScript Fundamentals', mastery: 0, status: 'locked', topics: ['ES6+', 'DOM Manipulation', 'Async/Await', 'Closures'] },
  { id: 'skill_4', name: 'React & Component Architecture', mastery: 0, status: 'locked', topics: ['Hooks', 'State Management', 'Props', 'Performance'] },
  { id: 'skill_5', name: 'Node.js & Express', mastery: 0, status: 'locked', topics: ['REST APIs', 'Middleware', 'Routing', 'Error Handling'] },
  { id: 'skill_6', name: 'PostgreSQL & SQL', mastery: 0, status: 'locked', topics: ['Query Optimization', 'Schema Design', 'ORM', 'Transactions'] },
  { id: 'skill_7', name: 'DevOps & Deployment', mastery: 0, status: 'locked', topics: ['Docker', 'CI/CD', 'AWS', 'Monitoring'] },
];

export async function generateDemoData(userId, goalText, domain) {
  const learningPlan = [];
  const sessions = [];
  let day = 1;

  // Create learning plan: concept → practice → review cycle for each skill
  for (let i = 0; i < Math.min(SAMPLE_SKILLS.length, 4); i++) {
    const skill = SAMPLE_SKILLS[i];

    // Concept session
    learningPlan.push({
      day: day++,
      skillId: skill.id,
      skillName: skill.name,
      topic: skill.topics[0],
      sessionType: 'concept',
      objective: `Learn foundational concepts of ${skill.topics[0]}`,
      estimatedMinutes: 25,
      resources: [`https://developer.mozilla.org/en-US/docs/Learn/${skill.topics[0].toLowerCase()}`],
      completed: false,
      score: null,
      addedByAgent: false,
      challengeId: `challenge_${day - 1}`,
    });

    // Practice session
    learningPlan.push({
      day: day++,
      skillId: skill.id,
      skillName: skill.name,
      topic: skill.topics[1] || skill.topics[0],
      sessionType: 'practice',
      objective: `Apply ${skill.topics[1] || skill.topics[0]} in practical exercises`,
      estimatedMinutes: 35,
      resources: [],
      completed: false,
      score: null,
      addedByAgent: false,
      challengeId: `challenge_${day - 1}`,
    });

    // Review every 2 skills
    if ((i + 1) % 2 === 0) {
      learningPlan.push({
        day: day++,
        skillId: skill.id,
        skillName: skill.name,
        topic: `Review: ${skill.topics[0]} & ${skill.topics[1]}`,
        sessionType: 'review',
        objective: `Consolidate understanding of ${skill.name}`,
        estimatedMinutes: 20,
        resources: [],
        completed: false,
        score: null,
        addedByAgent: true,
        challengeId: `challenge_${day - 1}`,
      });
    }
  }

  // Agent decisions
  const agentDecisions = [
    {
      id: 1, timestamp: new Date(Date.now() - 86400000).toISOString(),
      type: 'goal_analysis', icon: '🎯',
      title: 'GoalAgent — Domain Detected',
      detail: `Identified "${domain}" as the learning domain.`,
      reasoning: `NLP analysis of goal text matched domain with 94% confidence.`,
    },
    {
      id: 2, timestamp: new Date(Date.now() - 86000000).toISOString(),
      type: 'skill_tree', icon: '🌳',
      title: 'DecomposeAgent — Skill Tree Built',
      detail: `Decomposed into ${SAMPLE_SKILLS.length} core skills spanning ${day - 1} learning days.`,
      reasoning: `Skills ranked by foundational importance and prerequisite dependencies.`,
    },
    {
      id: 3, timestamp: new Date(Date.now() - 85600000).toISOString(),
      type: 'diagnostic', icon: '📋',
      title: 'DiagnosticAgent — Quiz Generated',
      detail: `Created 5 diagnostic questions across ${SAMPLE_SKILLS.slice(0, 4).length} skill areas.`,
      reasoning: `Questions generated using domain-specific knowledge graph for maximum coverage.`,
    },
  ];

  const adaptations = [
    'Added extra review session for skill consolidation after Day 4',
    'Compressed schedule — learner showing strong aptitude in CSS3',
  ];

  // Generate some completed sessions for progress
  const mockScores = [72, 85, 65, 90, 78, 88];
  for (let i = 0; i < Math.min(6, learningPlan.length); i++) {
    const planDay = learningPlan[i];
    sessions.push({
      id: crypto.randomUUID(),
      userId,
      learningUUID: userId,
      day: planDay.day,
      skillName: planDay.skillName,
      skillId: planDay.skillId,
      topic: planDay.topic,
      sessionType: planDay.sessionType,
      score: mockScores[i] || 70,
      grade: mockScores[i] >= 90 ? 'A' : mockScores[i] >= 75 ? 'B' : mockScores[i] >= 60 ? 'C' : 'D',
      strengths: [`Strong understanding of core concepts`, `Good practical application`],
      weaknesses: [`Needs more practice on edge cases`],
      feedback: `Good progress. Focus on applying concepts in real projects.`,
      coachNote: `Learner shows consistent improvement.`,
      evaluationSource: 'llm',
      completed: true,
      completedAt: new Date(Date.now() - (6 - i) * 86400000).toISOString(),
      challenge: { description: planDay.topic },
      userResponse: 'Sample response for demo',
      next_day: i < learningPlan.length - 1 ? learningPlan[i + 1].day : null,
    });

    learningPlan[i].completed = true;
    learningPlan[i].score = mockScores[i] || 70;
  }

  // Update skill mastery based on scores
  const updatedSkills = SAMPLE_SKILLS.map((skill, idx) => {
    const skillSessions = sessions.filter(s => s.skillId === skill.id);
    const avg = skillSessions.length > 0
      ? Math.round(skillSessions.reduce((sum, s) => sum + s.score, 0) / skillSessions.length)
      : 0;
    return {
      ...skill,
      mastery: avg,
      status: idx < 2 ? 'complete' : avg >= 75 ? 'complete' : avg > 0 ? 'active' : 'locked',
      sessionsCompleted: skillSessions.length,
    };
  });

  // Diagnostic scores
  const diagnosticScores = {};
  updatedSkills.forEach(s => {
    diagnosticScores[s.id] = s.mastery;
  });

  return {
    goal: {
      goalText,
      domain,
      domainLabel: domain.charAt(0).toUpperCase() + domain.slice(1),
      domainIcon: getDomainIcon(domain),
      skills: updatedSkills,
      totalEstimatedDays: day - 1,
    },
    learningPlan,
    sessions,
    stats: {
      avgScore: Math.round(sessions.reduce((s, x) => s + x.score, 0) / (sessions.length || 1)),
      bestScore: sessions.length ? Math.max(...sessions.map(s => s.score)) : 0,
      totalSessions: sessions.length,
    },
    adaptations,
    diagnosticScores,
    agentDecisions,
    aiPowered: false,
  };
}

function getDomainIcon(domain) {
  const icons = {
    'web development': '🌐', 'frontend': '⚛️', 'backend': '🔧',
    'data science': '🤖', 'machine learning': '🧠', 'python': '🐍',
    'software engineering': '💻', 'mobile development': '📱',
    'fullstack': '🌐', 'devops': '☸️',
  };
  return icons[domain?.toLowerCase()] || '🎯';
}

export default { generateDemoData };