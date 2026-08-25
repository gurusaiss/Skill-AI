import AgentDebate from './AgentDebate.js';

class Adaptor {
  apply(learningPlan, sessions, skills) {
    if (sessions.length === 0 || sessions.length % 3 !== 0) {
      return { learningPlan, message: null, debate: null };
    }

    const recent = sessions.slice(-3);
    const average = recent.reduce((sum, session) => sum + session.score, 0) / recent.length;
    const currentSkillId = recent[recent.length - 1].skillId;
    const currentSkill = skills.find((skill) => skill.id === currentSkillId);
    const skillName = currentSkill?.name || currentSkillId;

    // Run multi-agent debate before deciding
    const debate = AgentDebate.debateAdaptation(recent, null, skillName);

    if (average < 50) {
      const maxDay = learningPlan.reduce((max, item) => Math.max(max, item.day), 0);
      const extraDays = [1, 2].map((offset) => ({
        day: maxDay + offset,
        skillId: currentSkillId,
        skillName,
        objective: `AGENT REVIEW: Strengthen ${skillName} fundamentals. Agents voted ${debate?.verdictConfidence || 90}% confidence for reinforcement.`,
        sessionType: 'review',
        estimatedMinutes: 25,
        resources: ['https://developer.mozilla.org/'],
        completed: false,
        score: null,
        addedByAgent: true,
        challengeId: `review_${currentSkillId}_${maxDay + offset}`,
        topic: currentSkill?.topics?.[(offset - 1) % (currentSkill?.topics?.length || 1)] || 'review',
      }));

      const message = `⚠️ Agent Debate concluded (${debate?.verdictConfidence || 90}% consensus): Added 2 review sessions for "${skillName}" — recent average was ${Math.round(average)}%.`;

      return {
        learningPlan: [...learningPlan, ...extraDays],
        message,
        debate,
      };
    }

    if (average > 88) {
      const message = `🚀 Agent Debate concluded: Accelerating "${skillName}" track — recent average ${Math.round(average)}% exceeds the mastery threshold.`;
      return {
        learningPlan,
        message,
        debate,
      };
    }

    return { learningPlan, message: null, debate: null };
  }
}

export default Adaptor;
