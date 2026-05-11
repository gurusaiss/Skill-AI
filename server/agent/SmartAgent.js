// SmartAgent.js — Finals Upgrade
// Gemini 2.0 Flash powers ALL agents — any domain on earth
// Preserved: Agent Debate, Skill Drift, Confidence Calibration
// All LLM calls: try Gemini → rule-based fallback (never breaks)

import { randomUUID } from 'crypto';
import { writeFileSync, readFileSync, existsSync, mkdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import SkillDecomposer from './SkillDecomposer.js';
import QuizGenerator from './QuizGenerator.js';
import Evaluator from './Evaluator.js';
import PlanBuilder from './PlanBuilder.js';
import ChallengeEngine from './ChallengeEngine.js';
import Adaptor from './Adaptor.js';
import ReportGenerator from './ReportGenerator.js';
import GeminiService from '../services/GeminiService.js';
import AgentDebate from './AgentDebate.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, '../data');

if (!existsSync(DATA_DIR)) {
  mkdirSync(DATA_DIR, { recursive: true });
}

class SmartAgent {
  constructor() {
    this.skillDecomposer = new SkillDecomposer();
    this.quizGenerator = new QuizGenerator();
    this.evaluator = new Evaluator();
    this.planBuilder = new PlanBuilder();
    this.challengeEngine = new ChallengeEngine();
    this.adaptor = new Adaptor();
    this.reportGenerator = new ReportGenerator();
  }

  // ── processGoal ───────────────────────────────────────────────────────────
  async processGoal(goalText, existingUserId, profilingData = null) {
    const userId = existingUserId || randomUUID();

    // SkillDecomposer is now async (Gemini-powered)
    const baseSkillTree = await this.skillDecomposer.decompose(goalText);
    const enrichedSkills = baseSkillTree.skills.map((skill, index) => ({
      ...skill,
      sequenceOrder: index + 1,
      mastery: 0,
      status: index === 0 ? 'active' : 'locked',
      sessionsCompleted: 0,
    }));
    const totalEstimatedDays = enrichedSkills.reduce((sum, skill) => sum + skill.days, 0);
    const skillTree = { ...baseSkillTree, skills: enrichedSkills };

    // QuizGenerator is now async (Gemini-powered)
    const diagnosticQuestions = await this.quizGenerator.generate(skillTree);

    const topSkillNames = enrichedSkills.slice(0, 3).map(s => s.name).join(', ');
    const aiPowered = GeminiService.isEnabled();

    const agentDecisions = [
      {
        id: 1,
        timestamp: new Date().toISOString(),
        type: 'goal_analysis',
        icon: '🎯',
        title: 'GoalAgent — Domain Detected',
        detail: `Identified "${skillTree.domainName}" as the learning domain. Learner level: ${skillTree.profile.learnerLevel}, intensity: ${skillTree.profile.intensity}.`,
        reasoning: `${aiPowered ? 'Gemini 2.0 Flash analyzed' : 'Keyword scan of'} goal text. Domain "${skillTree.domain}" matched with highest confidence. Detected tools: ${skillTree.profile.detectedTools.join(', ') || 'none specified'}.`,
      },
      {
        id: 2,
        timestamp: new Date().toISOString(),
        type: 'skill_tree',
        icon: '🌳',
        title: 'DecomposeAgent — Skill Tree Built',
        detail: `Decomposed goal into ${enrichedSkills.length} core skills spanning ${totalEstimatedDays} learning days. Priority: ${topSkillNames}.`,
        reasoning: `${aiPowered ? 'Gemini generated domain-specific skill tree.' : 'Skills ranked by relevance to goal keywords and detected tools.'} Days allocated proportionally — more for foundational skills.`,
      },
      {
        id: 3,
        timestamp: new Date().toISOString(),
        type: 'diagnostic',
        icon: '📋',
        title: 'DiagnosticAgent — Quiz Generated',
        detail: `Created ${diagnosticQuestions.length} targeted questions across ${enrichedSkills.length} skill areas to assess current proficiency.`,
        reasoning: `${aiPowered ? 'Gemini created domain-specific questions — real concepts, not generic.' : 'Questions selected by relevance score to goal keywords.'} Open-ended questions capture reasoning depth.`,
      },
    ];

    // Merge profiling data into learner profile for personalization
    if (profilingData) {
      skillTree.profile.education     = profilingData.education || skillTree.profile.learnerLevel;
      skillTree.profile.experience    = profilingData.experience || skillTree.profile.learnerLevel;
      skillTree.profile.toolExposure  = profilingData.toolExposure || 'unknown';
      skillTree.profile.practicalExp  = profilingData.practicalExp || 'none';
      // Refine learner level from profiling
      if (/advanced|real.world|professional/i.test(profilingData.experience || '')) {
        skillTree.profile.learnerLevel = 'advanced';
      } else if (/moderate|basic/i.test(profilingData.experience || '')) {
        skillTree.profile.learnerLevel = 'intermediate';
      } else if (/beginner|none|new/i.test(profilingData.experience || '')) {
        skillTree.profile.learnerLevel = 'beginner';
      }
    }

    const session = {
      userId,
      goal: {
        goalText,
        domain: skillTree.domain,
        domainLabel: skillTree.domainName,
        domainIcon: this.skillDecomposer.getDomainIcon(skillTree.domain),
        profile: skillTree.profile,
        skills: enrichedSkills,
        totalEstimatedDays,
      },
      skillTree,
      diagnosticQuestions,
      diagnosticScores: {},
      learningPlan: [],
      sessions: [],
      adaptations: [],
      agentDecisions,
      confidenceCalibrations: [],
      agentDebates: [],
      report: null,
      aiPowered,
      createdAt: new Date().toISOString(),
    };

    this.saveSession(session);
    return { userId, skillTree: session.skillTree, diagnosticQuestions };
  }

  // ── submitDiagnostic ──────────────────────────────────────────────────────
  async submitDiagnostic(userId, answers, profilingData = null) {
    const session = this.loadSession(userId);
    const normalizedAnswers = session.diagnosticQuestions.map((question, index) => {
      const rawAnswer = answers[index];
      if (typeof rawAnswer === 'string') return { questionId: question.id, answer: rawAnswer };
      return rawAnswer;
    });

    const evaluationResults = this.evaluator.scoreDiagnostic(session.diagnosticQuestions, normalizedAnswers);
    const diagnosticScores = {};

    for (const skill of session.goal.skills) {
      const skillQuestions = session.diagnosticQuestions.filter(q => q.skillId === skill.id);
      const skillResults = evaluationResults.filter(r =>
        skillQuestions.some(q => q.id === r.questionId)
      );
      const average = skillResults.length === 0
        ? 0
        : Math.round(skillResults.reduce((s, r) => s + r.score, 0) / skillResults.length);
      diagnosticScores[skill.id] = average;
      skill.mastery = average;
      skill.status = average >= 75 ? 'complete' : 'active';
    }

    // Store profiling data in session for personalization
    if (profilingData) {
      session.profilingData = profilingData;
      session.goal.profile.education    = profilingData.education    || session.goal.profile.education;
      session.goal.profile.experience   = profilingData.experience   || session.goal.profile.experience;
      session.goal.profile.toolExposure = profilingData.toolExposure || session.goal.profile.toolExposure;
      session.goal.profile.practicalExp = profilingData.practicalExp || session.goal.profile.practicalExp;
    }

    const firstIncompleteIndex = session.goal.skills.findIndex(s => s.status !== 'complete');
    session.goal.skills = session.goal.skills.map((skill, index) => ({
      ...skill,
      status: firstIncompleteIndex === -1 ? 'complete'
        : index < firstIncompleteIndex ? 'complete'
        : index === firstIncompleteIndex ? 'active'
        : 'locked',
    }));
    session.skillTree.skills = session.goal.skills;

    const diagnosticArray = Object.entries(diagnosticScores).map(([skillId, score]) => ({ skillId, score }));
    const builtPlan = this.planBuilder.build(session.skillTree, diagnosticArray);

    const weakSkills = diagnosticArray.filter(d => d.score < 60);
    const strongSkills = diagnosticArray.filter(d => d.score >= 75);
    const weakNames = weakSkills.map(d => {
      const sk = session.goal.skills.find(s => s.id === d.skillId);
      return sk ? `${sk.name} (${d.score}%)` : d.skillId;
    }).join(', ');

    if (!session.agentDecisions) session.agentDecisions = [];
    session.agentDecisions.push({
      id: session.agentDecisions.length + 1,
      timestamp: new Date().toISOString(),
      type: 'diagnostic_complete',
      icon: '📊',
      title: 'ScoringAgent — Gaps Identified',
      detail: `${weakSkills.length} skill(s) need focused practice, ${strongSkills.length} already proficient. Weakest: ${weakNames || 'all skills strong'}.`,
      reasoning: `Scored each answer via keyword matching and response depth. Skills below 60% assigned extra learning days; above 80% compressed.`,
    });
    session.agentDecisions.push({
      id: session.agentDecisions.length + 1,
      timestamp: new Date().toISOString(),
      type: 'plan_built',
      icon: '📅',
      title: 'CurriculumAgent — Plan Generated',
      detail: `Generated ${builtPlan.days.length}-day personalized plan. Weakest skills scheduled first.`,
      reasoning: `Skills sorted by diagnostic score (weakest → strongest). Day count adjusted by proficiency multiplier.`,
    });

    session.diagnosticScores = diagnosticScores;
    session.learningPlan = builtPlan.days.map((day, index) => {
      const skill = session.goal.skills.find(e => e.id === day.skillId);
      return {
        day: day.day,
        skillId: day.skillId,
        skillName: skill?.name || day.skillId,
        objective: this.buildObjective(day, skill, session.goal.profile),
        sessionType: day.isReview ? 'review' : index % 2 === 0 ? 'concept' : 'practice',
        estimatedMinutes: 30,
        resources: this.buildResources(skill, session.goal.profile),
        completed: false,
        score: null,
        addedByAgent: false,
        challengeId: day.challengeId,
        topic: day.topic,
      };
    });

    this.saveSession(session);
    return { diagnosticScores: session.diagnosticScores, learningPlan: session.learningPlan };
  }

  // ── getChallenge ──────────────────────────────────────────────────────────
  async getChallenge(userId, day) {
    const session = this.loadSession(userId);
    const planDay = session.learningPlan.find(e => e.day === parseInt(day, 10));
    if (!planDay) throw new Error(`Day ${day} not found in learning plan`);

    // ChallengeEngine.getChallengeForDay is now async (Gemini-powered)
    const challenge = await this.challengeEngine.getChallengeForDay(planDay, session);
    return { planDay, challenge };
  }

  // ── submitSession — Agent Debate + Gemini scoring ─────────────────────────
  async submitSession({ userId, day, skillId, challenge, userResponse }) {
    const session = this.loadSession(userId);

    // Evaluator.scoreSession is now async (Gemini-powered)
    const evaluation = await this.evaluator.scoreSession(challenge, userResponse, {
      domain: session.goal.domainLabel,
      skillName: challenge.skillName || skillId,
    });

    const completedAt = new Date().toISOString();
    const skill = session.goal.skills.find(e => e.id === skillId);

    const record = {
      day: Number(day),
      skillId,
      skillName: skill?.name || skillId,
      challenge,
      userResponse,
      score: evaluation.score,
      grade: evaluation.grade,
      strengths: evaluation.strengths,
      weaknesses: evaluation.weaknesses,
      feedback: evaluation.feedback,
      coachNote: evaluation.coachNote || null,
      evaluationSource: evaluation.source || 'rule-based',
      completedAt,
    };

    session.sessions.push(record);

    session.learningPlan = session.learningPlan.map(e =>
      e.day === Number(day) ? { ...e, completed: true, score: evaluation.score } : e
    );

    if (skill) {
      skill.sessionsCompleted += 1;
      skill.mastery = Math.round(
        session.sessions.filter(e => e.skillId === skillId)
          .reduce((s, e) => s + e.score, 0) /
        session.sessions.filter(e => e.skillId === skillId).length
      );
      skill.status = skill.mastery >= 75 ? 'complete' : 'active';
    }

    // Run adaptor (includes Agent Debate)
    const adaptationResult = this.adaptor.apply(session.learningPlan, session.sessions, session.goal.skills);
    session.learningPlan = adaptationResult.learningPlan;

    if (!session.agentDecisions) session.agentDecisions = [];
    if (!session.agentDebates) session.agentDebates = [];

    if (adaptationResult.debate) {
      session.agentDebates.push(adaptationResult.debate);
      const debateDecision = AgentDebate.formatAsDecision(adaptationResult.debate);
      if (debateDecision) session.agentDecisions.push(debateDecision);
    }

    if (adaptationResult.message) {
      session.adaptations.push(adaptationResult.message);
      if (!adaptationResult.debate) {
        session.agentDecisions.push({
          id: session.agentDecisions.length + 1,
          timestamp: new Date().toISOString(),
          type: 'adaptation',
          icon: '⚡',
          title: 'AdaptorAgent — Plan Modified',
          detail: adaptationResult.message,
          reasoning: 'Agent monitors rolling average every 3 sessions. Scores < 50 → adds review days. Scores > 88 → accelerates.',
        });
      }
    }

    session.agentDecisions.push({
      id: session.agentDecisions.length + 1,
      timestamp: completedAt,
      type: 'session_complete',
      icon: '✅',
      title: `EvaluatorAgent — Day ${day} Scored`,
      detail: `Score: ${evaluation.score}% (${evaluation.grade}). ${evaluation.source === 'llm' ? '🤖 AI-evaluated.' : ''} Strengths: ${evaluation.strengths.slice(0, 2).join(', ')}. Gaps: ${evaluation.weaknesses.slice(0, 2).join(', ')}.`,
      reasoning: `Evaluated against ${challenge.evaluation_criteria?.length || 0} criteria. ${evaluation.source === 'llm' ? 'Gemini 2.0 Flash provided nuanced assessment.' : 'Keyword matching + response depth scoring.'}`,
    });

    this._detectSkillDrift(session);
    this.saveSession(session);

    return {
      evaluation,
      adaptations: session.adaptations,
      nextDay: session.learningPlan.find(e => !e.completed)?.day || null,
    };
  }

  // ── Skill drift detection ─────────────────────────────────────────────────
  _detectSkillDrift(session) {
    for (const skill of session.goal.skills) {
      const skillSessions = session.sessions.filter(s => s.skillId === skill.id);
      if (skillSessions.length < 4) continue;

      const early = skillSessions.slice(0, 2).reduce((s, r) => s + r.score, 0) / 2;
      const recent = skillSessions.slice(-2).reduce((s, r) => s + r.score, 0) / 2;
      const drift = early - recent;

      if (drift > 20) {
        const alreadyLogged = session.agentDecisions?.some(
          d => d.title?.includes(`"${skill.name}" Declining`)
        );
        if (!alreadyLogged) {
          session.agentDecisions.push({
            id: (session.agentDecisions?.length || 0) + 1,
            timestamp: new Date().toISOString(),
            type: 'adaptation',
            icon: '📉',
            title: `SkillDriftAgent — "${skill.name}" Declining`,
            detail: `Performance on "${skill.name}" dropped ${Math.round(drift)}pts since initial sessions (${Math.round(early)}% → ${Math.round(recent)}%).`,
            reasoning: `Skill drift detected via temporal score comparison. Early mastery may have been superficial. Recommending spaced repetition session.`,
          });
        }
      }
    }
  }

  // ── getDebates ────────────────────────────────────────────────────────────
  getDebates(userId) {
    const session = this.loadSession(userId);
    return session.agentDebates || [];
  }

  // ── generateReport ────────────────────────────────────────────────────────
  async generateReport(userId) {
    const session = this.loadSession(userId);
    // ReportGenerator.generate is now async (Gemini-powered)
    session.report = await this.reportGenerator.generate(session);
    this.saveSession(session);
    return session.report;
  }

  // ── getDashboard ──────────────────────────────────────────────────────────
  getDashboard(userId) {
    const session = this.loadSession(userId);
    const scores = session.sessions.map(e => e.score);
    const stats = {
      avgScore: scores.length ? Math.round(scores.reduce((s, v) => s + v, 0) / scores.length) : 0,
      bestScore: scores.length ? Math.max(...scores) : 0,
      totalSessions: session.sessions.length,
      completedDays: session.learningPlan.filter(e => e.completed).length,
    };

    return {
      goal: session.goal,
      skillTree: session.skillTree,
      learningPlan: session.learningPlan,
      sessions: session.sessions,
      stats,
      adaptations: session.adaptations,
      diagnosticScores: session.diagnosticScores,
      agentDecisions: session.agentDecisions || [],
      agentDebates: session.agentDebates || [],
      aiPowered: session.aiPowered || false,
    };
  }

  // ── Helpers ───────────────────────────────────────────────────────────────
  loadSession(userId) {
    const sessionPath = join(DATA_DIR, `${userId}.json`);
    if (!existsSync(sessionPath)) throw new Error(`Session not found: ${userId}`);
    return JSON.parse(readFileSync(sessionPath, 'utf-8'));
  }

  saveSession(session) {
    const sessionPath = join(DATA_DIR, `${session.userId}.json`);
    writeFileSync(sessionPath, JSON.stringify(session, null, 2));
  }

  buildObjective(day, skill, profile) {
    const roleContext = profile?.targetRole ? ` for your ${profile.targetRole} goal` : '';
    const skillReason = skill?.reason ? ` ${skill.reason}` : '';
    return `Build confidence in ${day.topic} for ${skill?.name || day.skillId}${roleContext}.${skillReason}`.trim();
  }

  buildResources(skill, profile) {
    const resources = ['https://developer.mozilla.org/', 'https://www.freecodecamp.org/'];
    const toolResources = {
      python: 'https://docs.python.org/3/',
      django: 'https://docs.djangoproject.com/',
      react: 'https://react.dev/',
      node: 'https://nodejs.org/en/docs',
      sql: 'https://www.postgresql.org/docs/',
    };
    for (const tool of profile?.detectedTools || []) {
      if (toolResources[tool]) resources.push(toolResources[tool]);
    }
    if (skill?.topics?.length) resources.push(`Practice focus: ${skill.topics.slice(0, 2).join(', ')}`);
    return [...new Set(resources)].slice(0, 4);
  }
}

export default SmartAgent;
