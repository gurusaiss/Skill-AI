import { describe, it, expect, beforeEach } from 'vitest';
import PlanBuilder from './PlanBuilder.js';

describe('PlanBuilder', () => {
  let planBuilder;

  beforeEach(() => {
    planBuilder = new PlanBuilder();
  });

  describe('build', () => {
    it('should create a learning plan with correct structure', () => {
      const skillTree = {
        domain: 'backend_development',
        skills: [
          {
            id: 'rest_apis',
            name: 'REST API Design',
            level: 'intermediate',
            days: 3,
            topics: ['HTTP methods', 'REST principles', 'status codes']
          },
          {
            id: 'databases',
            name: 'Database Design',
            level: 'intermediate',
            days: 3,
            topics: ['SQL basics', 'normalization', 'indexing']
          }
        ]
      };

      const diagnosticScores = [
        { skillId: 'rest_apis', score: 40 },
        { skillId: 'databases', score: 70 }
      ];

      const plan = planBuilder.build(skillTree, diagnosticScores);

      expect(plan).toHaveProperty('totalDays');
      expect(plan).toHaveProperty('days');
      expect(Array.isArray(plan.days)).toBe(true);
      expect(plan.totalDays).toBe(plan.days.length);
    });

    it('should order skills from weakest to strongest', () => {
      const skillTree = {
        domain: 'backend_development',
        skills: [
          {
            id: 'rest_apis',
            name: 'REST API Design',
            level: 'intermediate',
            days: 2,
            topics: ['HTTP methods', 'REST principles']
          },
          {
            id: 'databases',
            name: 'Database Design',
            level: 'intermediate',
            days: 2,
            topics: ['SQL basics', 'normalization']
          },
          {
            id: 'nodejs',
            name: 'Node.js',
            level: 'beginner',
            days: 2,
            topics: ['event loop', 'modules']
          }
        ]
      };

      const diagnosticScores = [
        { skillId: 'rest_apis', score: 70 },
        { skillId: 'databases', score: 30 },
        { skillId: 'nodejs', score: 50 }
      ];

      const plan = planBuilder.build(skillTree, diagnosticScores);

      // First days should be for databases (lowest score: 30)
      const firstSkillDays = plan.days.filter(d => d.skillId === 'databases');
      const firstDayNumber = Math.min(...firstSkillDays.map(d => d.day));
      
      // Last days should be for rest_apis (highest score: 70)
      const lastSkillDays = plan.days.filter(d => d.skillId === 'rest_apis');
      const lastDayNumber = Math.max(...lastSkillDays.map(d => d.day));

      expect(firstDayNumber).toBeLessThan(lastDayNumber);
    });

    it('should apply day multipliers based on diagnostic scores', () => {
      const skillTree = {
        domain: 'backend_development',
        skills: [
          {
            id: 'skill_high',
            name: 'High Score Skill',
            level: 'intermediate',
            days: 5,
            topics: ['topic1', 'topic2']
          },
          {
            id: 'skill_low',
            name: 'Low Score Skill',
            level: 'beginner',
            days: 5,
            topics: ['topic1', 'topic2']
          }
        ]
      };

      const diagnosticScores = [
        { skillId: 'skill_high', score: 85 }, // Should get 0.4 multiplier
        { skillId: 'skill_low', score: 25 }   // Should get 1.3 multiplier
      ];

      const plan = planBuilder.build(skillTree, diagnosticScores);

      const highScoreDays = plan.days.filter(d => d.skillId === 'skill_high').length;
      const lowScoreDays = plan.days.filter(d => d.skillId === 'skill_low').length;

      // High score: 5 * 0.4 = 2 days
      expect(highScoreDays).toBe(2);
      
      // Low score: 5 * 1.3 = 6.5 -> 7 days
      expect(lowScoreDays).toBe(7);
    });

    it('should ensure unique sequential day numbers', () => {
      const skillTree = {
        domain: 'backend_development',
        skills: [
          {
            id: 'rest_apis',
            name: 'REST API Design',
            level: 'intermediate',
            days: 2,
            topics: ['HTTP methods', 'REST principles']
          },
          {
            id: 'databases',
            name: 'Database Design',
            level: 'intermediate',
            days: 2,
            topics: ['SQL basics', 'normalization']
          }
        ]
      };

      const diagnosticScores = [
        { skillId: 'rest_apis', score: 50 },
        { skillId: 'databases', score: 60 }
      ];

      const plan = planBuilder.build(skillTree, diagnosticScores);

      const dayNumbers = plan.days.map(d => d.day);
      const uniqueDays = new Set(dayNumbers);

      // All day numbers should be unique
      expect(uniqueDays.size).toBe(dayNumbers.length);

      // Day numbers should be sequential starting from 1
      expect(Math.min(...dayNumbers)).toBe(1);
      expect(Math.max(...dayNumbers)).toBe(plan.totalDays);
    });

    it('should assign required fields to each day', () => {
      const skillTree = {
        domain: 'backend_development',
        skills: [
          {
            id: 'rest_apis',
            name: 'REST API Design',
            level: 'intermediate',
            days: 2,
            topics: ['HTTP methods', 'REST principles']
          }
        ]
      };

      const diagnosticScores = [
        { skillId: 'rest_apis', score: 50 }
      ];

      const plan = planBuilder.build(skillTree, diagnosticScores);

      for (const day of plan.days) {
        expect(day).toHaveProperty('day');
        expect(day).toHaveProperty('skillId');
        expect(day).toHaveProperty('topic');
        expect(day).toHaveProperty('challengeId');
        expect(day).toHaveProperty('completed');
        expect(day).toHaveProperty('isReview');
        expect(day.completed).toBe(false);
        expect(day.isReview).toBe(false);
      }
    });
  });

  describe('adapt', () => {
    it('should not adapt if sessions count is not a multiple of 3', () => {
      const learningPlan = {
        totalDays: 5,
        days: [
          { day: 1, skillId: 'rest_apis', topic: 'HTTP', challengeId: 'ch1', completed: true, isReview: false },
          { day: 2, skillId: 'rest_apis', topic: 'REST', challengeId: 'ch2', completed: true, isReview: false },
          { day: 3, skillId: 'databases', topic: 'SQL', challengeId: 'ch3', completed: false, isReview: false }
        ]
      };

      const sessions = [
        { day: 1, skillId: 'rest_apis', score: 45 },
        { day: 2, skillId: 'rest_apis', score: 48 }
      ];

      const result = planBuilder.adapt(learningPlan, sessions);

      expect(result.adaptations).toHaveLength(0);
      expect(result.updatedPlan.days).toHaveLength(learningPlan.days.length);
    });

    it('should add 2 review days when average score < 50', () => {
      const learningPlan = {
        totalDays: 5,
        days: [
          { day: 1, skillId: 'rest_apis', topic: 'HTTP', challengeId: 'ch1', completed: true, isReview: false },
          { day: 2, skillId: 'rest_apis', topic: 'REST', challengeId: 'ch2', completed: true, isReview: false },
          { day: 3, skillId: 'rest_apis', topic: 'Status', challengeId: 'ch3', completed: true, isReview: false },
          { day: 4, skillId: 'databases', topic: 'SQL', challengeId: 'ch4', completed: false, isReview: false }
        ]
      };

      const sessions = [
        { day: 1, skillId: 'rest_apis', score: 45 },
        { day: 2, skillId: 'rest_apis', score: 42 },
        { day: 3, skillId: 'rest_apis', score: 48 }
      ];

      const result = planBuilder.adapt(learningPlan, sessions);

      expect(result.adaptations).toHaveLength(1);
      expect(result.adaptations[0].daysAdded).toBe(2);
      expect(result.adaptations[0].daysRemoved).toBe(0);
      expect(result.updatedPlan.days).toHaveLength(learningPlan.days.length + 2);

      // Check that the new days are review days
      const newDays = result.updatedPlan.days.slice(-2);
      expect(newDays[0].isReview).toBe(true);
      expect(newDays[1].isReview).toBe(true);
      expect(newDays[0].skillId).toBe('rest_apis');
      expect(newDays[1].skillId).toBe('rest_apis');
    });

    it('should remove 1 day when average score > 88', () => {
      const learningPlan = {
        totalDays: 6,
        days: [
          { day: 1, skillId: 'rest_apis', topic: 'HTTP', challengeId: 'ch1', completed: true, isReview: false },
          { day: 2, skillId: 'rest_apis', topic: 'REST', challengeId: 'ch2', completed: true, isReview: false },
          { day: 3, skillId: 'rest_apis', topic: 'Status', challengeId: 'ch3', completed: true, isReview: false },
          { day: 4, skillId: 'rest_apis', topic: 'Auth', challengeId: 'ch4', completed: false, isReview: false },
          { day: 5, skillId: 'databases', topic: 'SQL', challengeId: 'ch5', completed: false, isReview: false }
        ]
      };

      const sessions = [
        { day: 1, skillId: 'rest_apis', score: 90 },
        { day: 2, skillId: 'rest_apis', score: 92 },
        { day: 3, skillId: 'rest_apis', score: 89 }
      ];

      const result = planBuilder.adapt(learningPlan, sessions);

      expect(result.adaptations).toHaveLength(1);
      expect(result.adaptations[0].daysAdded).toBe(0);
      expect(result.adaptations[0].daysRemoved).toBe(1);
      expect(result.updatedPlan.days).toHaveLength(learningPlan.days.length - 1);
    });

    it('should not remove days if no remaining days exist for the skill', () => {
      const learningPlan = {
        totalDays: 4,
        days: [
          { day: 1, skillId: 'rest_apis', topic: 'HTTP', challengeId: 'ch1', completed: true, isReview: false },
          { day: 2, skillId: 'rest_apis', topic: 'REST', challengeId: 'ch2', completed: true, isReview: false },
          { day: 3, skillId: 'rest_apis', topic: 'Status', challengeId: 'ch3', completed: true, isReview: false },
          { day: 4, skillId: 'databases', topic: 'SQL', challengeId: 'ch4', completed: false, isReview: false }
        ]
      };

      const sessions = [
        { day: 1, skillId: 'rest_apis', score: 90 },
        { day: 2, skillId: 'rest_apis', score: 92 },
        { day: 3, skillId: 'rest_apis', score: 89 }
      ];

      const result = planBuilder.adapt(learningPlan, sessions);

      // Should not remove any days since all rest_apis days are completed
      expect(result.adaptations).toHaveLength(0);
      expect(result.updatedPlan.days).toHaveLength(learningPlan.days.length);
    });

    it('should maintain sequential day numbers after adaptation', () => {
      const learningPlan = {
        totalDays: 5,
        days: [
          { day: 1, skillId: 'rest_apis', topic: 'HTTP', challengeId: 'ch1', completed: true, isReview: false },
          { day: 2, skillId: 'rest_apis', topic: 'REST', challengeId: 'ch2', completed: true, isReview: false },
          { day: 3, skillId: 'rest_apis', topic: 'Status', challengeId: 'ch3', completed: true, isReview: false },
          { day: 4, skillId: 'databases', topic: 'SQL', challengeId: 'ch4', completed: false, isReview: false }
        ]
      };

      const sessions = [
        { day: 1, skillId: 'rest_apis', score: 45 },
        { day: 2, skillId: 'rest_apis', score: 42 },
        { day: 3, skillId: 'rest_apis', score: 48 }
      ];

      const result = planBuilder.adapt(learningPlan, sessions);

      const dayNumbers = result.updatedPlan.days.map(d => d.day);
      
      // Check sequential numbering
      for (let i = 0; i < dayNumbers.length; i++) {
        expect(dayNumbers[i]).toBe(i + 1);
      }
    });
  });
});
