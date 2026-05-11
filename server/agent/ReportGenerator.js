import GeminiService from '../services/GeminiService.js';

class ReportGenerator {
  // ── Gemini-powered narrative generation ──────────────────────────────────
  async generateNarrativeWithLLM(session) {
    const { goal, sessions, adaptations } = session;
    const avgScore = sessions.length
      ? Math.round(sessions.reduce((sum, s) => sum + s.score, 0) / sessions.length)
      : 0;
    const bestScore = sessions.length ? Math.max(...sessions.map(s => s.score)) : 0;
    const completedSkills = (goal.skills || []).filter(s => s.mastery >= 65).map(s => s.name);
    const trend = sessions.length >= 3
      ? sessions.slice(-3).reduce((s, r) => s + r.score, 0) / 3 - sessions.slice(0, 3).reduce((s, r) => s + r.score, 0) / 3
      : 0;

    const sessionSummary = sessions.slice(-5).map(s =>
      `Day ${s.day} (${s.skillName}): ${s.score}% — ${s.strengths?.[0] || 'practiced'}`
    ).join('\n');

    const prompt = `You are an expert learning coach writing a progress report for a learner.

Goal: "${goal.goalText}"
Domain: ${goal.domainLabel || goal.domain}
Total sessions completed: ${sessions.length}
Average score: ${avgScore}%
Best score: ${bestScore}%
Score trend: ${trend > 5 ? 'improving' : trend < -5 ? 'declining' : 'stable'}
Skills demonstrated (≥65%): ${completedSkills.join(', ') || 'none yet'}
Adaptations made: ${adaptations?.length || 0}

Recent sessions:
${sessionSummary || 'No sessions yet.'}

Write a coaching report. Return ONLY valid JSON:
{
  "narrative": "2-3 sentence personalized progress summary. Be specific about what they achieved and where they stand. Mention the domain, scores, and progress arc.",
  "coachSummary": "1-2 sentence actionable next step. Specific, encouraging, and practical.",
  "demonstratedSkills": ["skill1", "skill2"],
  "capabilityStatement": "One sentence describing what this learner is now capable of doing in ${goal.domainLabel || goal.domain}.",
  "nextMilestone": "What they should focus on next to reach the next level."
}

Be genuine, specific, and encouraging without being generic. Reference actual scores and skills.`;

    try {
      const result = await GeminiService.generateJSON(prompt,
        'You are an expert learning coach. Write personalized, specific coaching reports. Return only valid JSON.');

      if (result?.narrative) {
        console.log(`[ReportGenerator] Gemini generated narrative for "${goal.goalText}"`);
        return result;
      }
    } catch (err) {
      console.error('[ReportGenerator] Gemini error:', err.message);
    }
    return null;
  }

  async generate(session, providedLlmReport = null) {
    const avgScore = session.sessions.length
      ? Math.round(session.sessions.reduce((sum, item) => sum + item.score, 0) / session.sessions.length)
      : 0;
    const bestScore = session.sessions.length
      ? Math.max(...session.sessions.map((item) => item.score))
      : 0;
    const completedSkills = session.goal.skills.filter((skill) => skill.mastery >= 65);

    // Try Gemini narrative if not provided
    let llmReport = providedLlmReport;
    if (!llmReport && GeminiService.isEnabled() && session.sessions.length > 0) {
      llmReport = await this.generateNarrativeWithLLM(session);
    }

    return {
      generatedAt: new Date().toISOString(),
      goalText: session.goal.goalText,
      summary: {
        avgScore,
        bestScore,
        totalSessions: session.sessions.length,
        completedDays: session.learningPlan.filter((item) => item.completed).length
      },
      skills: session.goal.skills.map((skill) => ({
        id: skill.id,
        name: skill.name,
        mastery: skill.mastery,
        status: skill.mastery >= 65 ? 'demonstrated' : skill.status
      })),
      demonstratedSkills: llmReport?.demonstratedSkills?.length
        ? llmReport.demonstratedSkills
        : completedSkills.map((skill) => skill.name),
      narrative: llmReport?.narrative
        || `SkillForge tracked ${session.sessions.length} practice sessions and found steady growth toward ${session.goal.domainLabel}. The learner performed best when responses were detailed, reasoned, and directly tied to the evaluation criteria.`,
      coachSummary: llmReport?.coachSummary
        || 'Continue focusing on weak areas and build consistency through repeated practice.',
      capabilityStatement: llmReport?.capabilityStatement || null,
      nextMilestone: llmReport?.nextMilestone || null,
      sessions: session.sessions,
      adaptations: session.adaptations,
      agentDecisions: session.agentDecisions || [],
      diagnosticScores: session.diagnosticScores || {},
      totalDays: session.goal.totalEstimatedDays || 0,
      domain: session.goal.domainLabel || '',
      domainIcon: session.goal.domainIcon || '🚀',
      profile: session.goal.profile || {},
      aiPowered: !!llmReport
    };
  }
}

export default ReportGenerator;
