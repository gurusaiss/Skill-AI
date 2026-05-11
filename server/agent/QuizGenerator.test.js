// Feature: skillforge-ai, Property 5: Quiz question count invariant

import { describe, it, expect, beforeAll } from 'vitest';
import fc from 'fast-check';
import QuizGenerator from './QuizGenerator.js';

describe('QuizGenerator Property Tests', () => {
  let generator;

  beforeAll(() => {
    generator = new QuizGenerator();
  });

  // Custom arbitrary for generating skill trees with 3-7 skills
  const arbitrarySkillTree = () => {
    return fc.record({
      domain: fc.constantFrom(
        'backend_development',
        'machine_learning',
        'ui_ux_design',
        'digital_marketing',
        'data_science'
      ),
      domainName: fc.string({ minLength: 5, maxLength: 30 }),
      skills: fc.uniqueArray(
        fc.record({
          id: fc.string({ minLength: 3, maxLength: 20 }).map(s => s.replace(/\s/g, '_')),
          name: fc.string({ minLength: 5, maxLength: 40 }),
          description: fc.string({ minLength: 10, maxLength: 100 }),
          level: fc.constantFrom('beginner', 'intermediate', 'advanced'),
          days: fc.integer({ min: 1, max: 14 }),
          topics: fc.array(fc.string({ minLength: 3, maxLength: 30 }), { minLength: 1, maxLength: 5 })
        }),
        { minLength: 3, maxLength: 7, selector: (skill) => skill.id }
      )
    });
  };

  describe('Property 5: Quiz question count invariant', () => {
    it('should return exactly 2 × N questions for any skill tree with N skills (3 ≤ N ≤ 7)', () => {
      fc.assert(
        fc.property(arbitrarySkillTree(), (skillTree) => {
          const questions = generator.generate(skillTree);
          const expectedQuestionCount = skillTree.skills.length * 2;
          
          // Assert exactly 2 × N questions
          expect(questions).toBeDefined();
          expect(Array.isArray(questions)).toBe(true);
          expect(questions.length).toBe(expectedQuestionCount);
        }),
        { numRuns: 100 }
      );
    });

    it('should ensure no skill has zero questions', () => {
      fc.assert(
        fc.property(arbitrarySkillTree(), (skillTree) => {
          const questions = generator.generate(skillTree);
          
          // Count questions per skill
          const questionCountBySkill = {};
          skillTree.skills.forEach(skill => {
            questionCountBySkill[skill.id] = 0;
          });
          
          questions.forEach(question => {
            if (Object.prototype.hasOwnProperty.call(questionCountBySkill, question.skillId)) {
              questionCountBySkill[question.skillId]++;
            }
          });
          
          // Assert every skill has at least one question (should be exactly 2)
          Object.values(questionCountBySkill).forEach(count => {
            expect(count).toBeGreaterThan(0);
          });
        }),
        { numRuns: 100 }
      );
    });

    it('should ensure each skill has exactly 2 questions', () => {
      fc.assert(
        fc.property(arbitrarySkillTree(), (skillTree) => {
          const questions = generator.generate(skillTree);
          
          // Count questions per skill
          const questionCountBySkill = {};
          skillTree.skills.forEach(skill => {
            questionCountBySkill[skill.id] = 0;
          });
          
          questions.forEach(question => {
            if (Object.prototype.hasOwnProperty.call(questionCountBySkill, question.skillId)) {
              questionCountBySkill[question.skillId]++;
            }
          });
          
          // Assert every skill has exactly 2 questions
          Object.entries(questionCountBySkill).forEach(([skillId, count]) => {
            expect(count).toBe(2);
          });
        }),
        { numRuns: 100 }
      );
    });

    it('should ensure all questions have required fields', () => {
      fc.assert(
        fc.property(arbitrarySkillTree(), (skillTree) => {
          const questions = generator.generate(skillTree);
          
          questions.forEach(question => {
            // Check required fields exist
            expect(question.id).toBeDefined();
            expect(typeof question.id).toBe('string');
            expect(question.id.length).toBeGreaterThan(0);
            
            expect(question.skillId).toBeDefined();
            expect(typeof question.skillId).toBe('string');
            
            expect(question.skillName).toBeDefined();
            expect(typeof question.skillName).toBe('string');
            
            expect(question.question).toBeDefined();
            expect(typeof question.question).toBe('string');
            expect(question.question.length).toBeGreaterThan(0);
            
            expect(question.type).toBeDefined();
            expect(['multiple_choice', 'open_ended']).toContain(question.type);
            
            expect(question.options).toBeDefined();
            expect(Array.isArray(question.options)).toBe(true);
            
            expect(question.correct).toBeDefined();
            
            expect(question.key_concepts).toBeDefined();
            expect(Array.isArray(question.key_concepts)).toBe(true);
            
            expect(question.score_keywords).toBeDefined();
            expect(Array.isArray(question.score_keywords)).toBe(true);
          });
        }),
        { numRuns: 100 }
      );
    });

    it('should handle edge case of exactly 3 skills', () => {
      const skillTree = {
        domain: 'backend_development',
        domainName: 'Backend Development',
        skills: [
          { id: 'skill1', name: 'Skill 1', level: 'beginner', days: 3, topics: ['topic1'] },
          { id: 'skill2', name: 'Skill 2', level: 'intermediate', days: 4, topics: ['topic2'] },
          { id: 'skill3', name: 'Skill 3', level: 'advanced', days: 5, topics: ['topic3'] }
        ]
      };
      
      const questions = generator.generate(skillTree);
      expect(questions.length).toBe(6); // 3 skills × 2 questions
    });

    it('should handle edge case of exactly 7 skills', () => {
      const skillTree = {
        domain: 'backend_development',
        domainName: 'Backend Development',
        skills: [
          { id: 'skill1', name: 'Skill 1', level: 'beginner', days: 3, topics: ['topic1'] },
          { id: 'skill2', name: 'Skill 2', level: 'intermediate', days: 4, topics: ['topic2'] },
          { id: 'skill3', name: 'Skill 3', level: 'advanced', days: 5, topics: ['topic3'] },
          { id: 'skill4', name: 'Skill 4', level: 'beginner', days: 3, topics: ['topic4'] },
          { id: 'skill5', name: 'Skill 5', level: 'intermediate', days: 4, topics: ['topic5'] },
          { id: 'skill6', name: 'Skill 6', level: 'advanced', days: 5, topics: ['topic6'] },
          { id: 'skill7', name: 'Skill 7', level: 'beginner', days: 3, topics: ['topic7'] }
        ]
      };
      
      const questions = generator.generate(skillTree);
      expect(questions.length).toBe(14); // 7 skills × 2 questions
    });
  });
});
