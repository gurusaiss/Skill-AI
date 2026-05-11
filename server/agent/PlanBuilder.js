import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));

class PlanBuilder {
  constructor() {
    // Load challenges from knowledge bank
    const challengesPath = join(__dirname, '../knowledge/challenges.json');
    this.challenges = JSON.parse(readFileSync(challengesPath, 'utf-8'));
  }

  /**
   * Build initial learning plan from skill tree and diagnostic scores
   * @param {Object} skillTree - Skill tree with skills array
   * @param {Array} diagnosticScores - Array of {skillId, score} per skill
   * @returns {Object} - Learning plan with totalDays and days array
   */
  build(skillTree, diagnosticScores) {
    // Create a map of skillId -> score for easy lookup
    const scoreMap = {};
    for (const ds of diagnosticScores) {
      scoreMap[ds.skillId] = ds.score;
    }

    // Sort skills by diagnostic score (weakest first)
    const sortedSkills = [...skillTree.skills].sort((a, b) => {
      const scoreA = scoreMap[a.id] || 0;
      const scoreB = scoreMap[b.id] || 0;
      return scoreA - scoreB;
    });

    // Build day-by-day plan
    const days = [];
    let currentDay = 1;

    for (const skill of sortedSkills) {
      const diagnosticScore = scoreMap[skill.id] || 0;
      
      // Apply day multipliers based on competency
      let multiplier = 1.0;
      if (diagnosticScore >= 80) {
        multiplier = 0.4;
      } else if (diagnosticScore >= 60) {
        multiplier = 0.7;
      } else if (diagnosticScore < 30) {
        multiplier = 1.3;
      }

      // Calculate adjusted days (minimum 1 day per skill)
      const adjustedDays = Math.max(1, Math.round(skill.days * multiplier));

      // Get challenges for this skill
      const skillChallenges = this.challenges[skill.id] || [];

      // Assign one day per session
      for (let i = 0; i < adjustedDays; i++) {
        // Rotate through topics
        const topicIndex = i % skill.topics.length;
        const topic = skill.topics[topicIndex];

        // Select challenge by rotating through available challenges
        let challengeId = `ch_${skill.id}_generic`;
        if (skillChallenges.length > 0) {
          const challengeIndex = i % skillChallenges.length;
          challengeId = skillChallenges[challengeIndex].id;
        }

        days.push({
          day: currentDay,
          skillId: skill.id,
          topic: topic,
          challengeId: challengeId,
          completed: false,
          isReview: false
        });

        currentDay++;
      }
    }

    return {
      totalDays: days.length,
      days: days
    };
  }

  /**
   * Adapt learning plan based on session performance
   * @param {Object} learningPlan - Current learning plan
   * @param {Array} sessions - Array of completed session objects with {day, skillId, score}
   * @returns {Object} - { updatedPlan, adaptations }
   */
  adapt(learningPlan, sessions) {
    const adaptations = [];
    const updatedDays = [...learningPlan.days];

    // Check if we should adapt (every 3 sessions)
    if (sessions.length % 3 !== 0 || sessions.length === 0) {
      return {
        updatedPlan: {
          totalDays: updatedDays.length,
          days: updatedDays
        },
        adaptations: []
      };
    }

    // Get last 3 sessions
    const recentSessions = sessions.slice(-3);
    const avgScore = recentSessions.reduce((sum, s) => sum + s.score, 0) / recentSessions.length;

    // Get the skill from the most recent session
    const lastSession = recentSessions[recentSessions.length - 1];
    const skillId = lastSession.skillId;

    // Find the skill in the original skill tree to get topics
    // We need to reconstruct this from the plan
    const skillDays = updatedDays.filter(d => d.skillId === skillId);
    const topics = [...new Set(skillDays.map(d => d.topic))];

    if (avgScore < 50) {
      // Add 2 review days for the same skill
      const lastDayNumber = updatedDays[updatedDays.length - 1].day;
      
      // Get challenges for this skill
      const skillChallenges = this.challenges[skillId] || [];

      for (let i = 0; i < 2; i++) {
        const newDayNumber = lastDayNumber + i + 1;
        
        // Rotate through topics
        const topicIndex = (skillDays.length + i) % topics.length;
        const topic = topics[topicIndex];

        // Select challenge
        let challengeId = `ch_${skillId}_generic`;
        if (skillChallenges.length > 0) {
          const challengeIndex = (skillDays.length + i) % skillChallenges.length;
          challengeId = skillChallenges[challengeIndex].id;
        }

        updatedDays.push({
          day: newDayNumber,
          skillId: skillId,
          topic: topic,
          challengeId: challengeId,
          completed: false,
          isReview: true
        });
      }

      adaptations.push({
        afterDay: lastSession.day,
        note: `Average score below 50 (${Math.round(avgScore)}). Added 2 review days for ${skillId}.`,
        daysAdded: 2,
        daysRemoved: 0
      });
    } else if (avgScore > 88) {
      // Remove 1 day from remaining days for this skill (if any exist)
      const remainingSkillDays = updatedDays.filter(d => d.skillId === skillId && !d.completed);
      
      if (remainingSkillDays.length > 0) {
        // Find and remove the last uncompleted day for this skill
        const dayToRemove = remainingSkillDays[remainingSkillDays.length - 1];
        const indexToRemove = updatedDays.findIndex(d => d.day === dayToRemove.day);
        
        if (indexToRemove !== -1) {
          updatedDays.splice(indexToRemove, 1);
          
          // Renumber subsequent days
          for (let i = indexToRemove; i < updatedDays.length; i++) {
            updatedDays[i].day = i + 1;
          }

          adaptations.push({
            afterDay: lastSession.day,
            note: `Average score above 88 (${Math.round(avgScore)}). Removed 1 day from ${skillId}.`,
            daysAdded: 0,
            daysRemoved: 1
          });
        }
      }
    }

    return {
      updatedPlan: {
        totalDays: updatedDays.length,
        days: updatedDays
      },
      adaptations: adaptations
    };
  }
}

export default PlanBuilder;
