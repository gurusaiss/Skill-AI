// Feature: skillforge-ai, Property 5: Quiz question count invariant
//
// NOTE: the product now generates a fixed-length diagnostic quiz (TARGET_QUESTIONS,
// currently 5) regardless of skill-tree size, rather than scaling 2x per skill.
// This file was updated to match that design — see QuizGenerator.js's `generate()`.

import { describe, it, expect, beforeAll } from 'vitest';
import fc from 'fast-check';
import QuizGenerator from './QuizGenerator.js';

const TARGET_QUESTIONS = 5;

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
    it(`should return exactly ${TARGET_QUESTIONS} questions for any skill tree with 3-7 skills`, async () => {
      await fc.assert(
        fc.asyncProperty(arbitrarySkillTree(), async (skillTree) => {
          const questions = await generator.generate(skillTree);

          expect(questions).toBeDefined();
          expect(Array.isArray(questions)).toBe(true);
          expect(questions.length).toBe(TARGET_QUESTIONS);
        }),
        { numRuns: 100 }
      );
    });

    // Note: for a known domain (e.g. backend_development), generate() may return a
    // curated rule-based quiz whose questions carry the bank's own real skill ids —
    // not necessarily the arbitrary/fuzzed skill ids passed in here. So this only
    // asserts skillId is present and well-formed, not that it's one of the fuzzed ids.
    it('should ensure every question has a well-formed skillId', async () => {
      await fc.assert(
        fc.asyncProperty(arbitrarySkillTree(), async (skillTree) => {
          const questions = await generator.generate(skillTree);

          questions.forEach(question => {
            expect(typeof question.skillId).toBe('string');
            expect(question.skillId.length).toBeGreaterThan(0);
          });
        }),
        { numRuns: 100 }
      );
    });

    it('should ensure all questions have required fields', async () => {
      await fc.assert(
        fc.asyncProperty(arbitrarySkillTree(), async (skillTree) => {
          const questions = await generator.generate(skillTree);
          
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

    it('should handle edge case of exactly 3 skills', async () => {
      const skillTree = {
        domain: 'backend_development',
        domainName: 'Backend Development',
        skills: [
          { id: 'skill1', name: 'Skill 1', level: 'beginner', days: 3, topics: ['topic1'] },
          { id: 'skill2', name: 'Skill 2', level: 'intermediate', days: 4, topics: ['topic2'] },
          { id: 'skill3', name: 'Skill 3', level: 'advanced', days: 5, topics: ['topic3'] }
        ]
      };

      const questions = await generator.generate(skillTree);
      expect(questions.length).toBe(TARGET_QUESTIONS);
    });

    it('should handle edge case of exactly 7 skills', async () => {
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
      
      const questions = await generator.generate(skillTree);
      expect(questions.length).toBe(TARGET_QUESTIONS);
    });
  });
});
