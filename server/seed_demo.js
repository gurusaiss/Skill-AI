import SmartAgent from './agent/SmartAgent.js';

const agent = new SmartAgent();
const userId = 'demo_skillforge_2024';
const goalText = 'I want to become a backend Python developer';
const scores = [42, 48, 55, 61, 38, 45, 52, 60, 44, 58, 65, 50, 63, 72];

const initial = await agent.processGoal(goalText, userId);
const answers = initial.diagnosticQuestions.map((question) =>
  question.type === 'multiple_choice' ? question.correct : question.sample_good_answer || 'I am learning this topic with examples and practice.'
);

await agent.submitDiagnostic(userId, answers);

const seededSession = agent.loadSession(userId);
if (seededSession.learningPlan.length < scores.length) {
  const baseSkill = seededSession.goal.skills[0];
  const lastDay = seededSession.learningPlan[seededSession.learningPlan.length - 1]?.day || 0;
  for (let offset = 1; seededSession.learningPlan.length < scores.length; offset++) {
    seededSession.learningPlan.push({
      day: lastDay + offset,
      skillId: baseSkill.id,
      skillName: baseSkill.name,
      objective: `Extended demo review for ${baseSkill.name}.`,
      sessionType: 'review',
      estimatedMinutes: 25,
      resources: ['https://developer.mozilla.org/'],
      completed: false,
      score: null,
      addedByAgent: true,
      challengeId: `demo_review_${lastDay + offset}`,
      topic: baseSkill.topics[(offset - 1) % baseSkill.topics.length]
    });
  }
  agent.saveSession(seededSession);
}

for (let index = 0; index < scores.length; index++) {
  const day = index + 1;
  const challengeData = await agent.getChallenge(userId, day);
  await agent.submitSession({
    userId,
    day,
    skillId: challengeData.planDay.skillId,
    challenge: challengeData.challenge,
    userResponse: `This is my day ${day} practice response because I want to improve. For example, I would explain the idea, return a simple implementation, and describe why the approach works.`
  });

  const session = agent.loadSession(userId);
  session.sessions[index].score = scores[index];
  session.sessions[index].grade = agent.evaluator.calculateGrade(scores[index]);
  session.sessions[index].feedback = `Adjusted demo score to ${scores[index]} for showcase consistency.`;
  const planDayIndex = session.learningPlan.findIndex((entry) => entry.day === day);
  if (planDayIndex !== -1) {
    session.learningPlan[planDayIndex].score = scores[index];
    session.learningPlan[planDayIndex].completed = true;
  }
  session.adaptations = [
    'Agent update: added 2 extra review days after weak authentication performance.',
    'Agent update: you are advancing faster in API design and can move quicker.'
  ];
  agent.saveSession(session);
}

await agent.generateReport(userId);
console.log(`Seeded demo user: ${userId}`);
