// Feature: skillforge-ai, Property 2: Domain detection always returns a valid domain
// Feature: skillforge-ai, Property 3: Skill tree structural invariant

import { describe, it, expect, beforeAll } from 'vitest';
import fc from 'fast-check';
import SkillDecomposer from './SkillDecomposer.js';

describe('SkillDecomposer Property Tests', () => {
  let decomposer;
  const VALID_DOMAINS = [
    'backend_development',
    'machine_learning',
    'ui_ux_design',
    'digital_marketing',
    'data_science'
  ];
  const VALID_LEVELS = ['beginner', 'intermediate', 'advanced'];

  beforeAll(() => {
    decomposer = new SkillDecomposer();
  });

  describe('Property 2: Domain detection always returns a valid domain', () => {
    it('should return one of the five valid domain IDs for any non-empty string', () => {
      fc.assert(
        fc.property(fc.string(), (goalText) => {
          const domain = decomposer.detectDomain(goalText);
          expect(VALID_DOMAINS).toContain(domain);
        }),
        { numRuns: 100 }
      );
    });

    it('should handle empty strings by returning a valid domain', () => {
      const domain = decomposer.detectDomain('');
      expect(VALID_DOMAINS).toContain(domain);
    });

    it('should handle strings with no recognizable keywords by returning a valid domain', () => {
      fc.assert(
        fc.property(
          fc.string().filter(s => !s.match(/backend|server|api|database|machine|learning|design|ui|ux|marketing|data|science/i)),
          (goalText) => {
            const domain = decomposer.detectDomain(goalText);
            expect(VALID_DOMAINS).toContain(domain);
          }
        ),
        { numRuns: 100 }
      );
    });
  });

  describe('Property 3: Skill tree structural invariant', () => {
    it('should return a skill tree with 3-7 skills for any valid goal string', () => {
      fc.assert(
        fc.property(fc.string({ minLength: 5 }), (goalText) => {
          const skillTree = decomposer.decompose(goalText);
          
          // Assert skill count is between 3 and 7
          expect(skillTree.skills).toBeDefined();
          expect(Array.isArray(skillTree.skills)).toBe(true);
          expect(skillTree.skills.length).toBeGreaterThanOrEqual(3);
          expect(skillTree.skills.length).toBeLessThanOrEqual(7);
        }),
        { numRuns: 100 }
      );
    });

    it('should ensure every skill has non-empty topics array', () => {
      fc.assert(
        fc.property(fc.string({ minLength: 5 }), (goalText) => {
          const skillTree = decomposer.decompose(goalText);
          
          skillTree.skills.forEach(skill => {
            expect(skill.topics).toBeDefined();
            expect(Array.isArray(skill.topics)).toBe(true);
            expect(skill.topics.length).toBeGreaterThan(0);
            
            // Ensure all topics are non-empty strings
            skill.topics.forEach(topic => {
              expect(typeof topic).toBe('string');
              expect(topic.length).toBeGreaterThan(0);
            });
          });
        }),
        { numRuns: 100 }
      );
    });

    it('should ensure every skill has a valid level', () => {
      fc.assert(
        fc.property(fc.string({ minLength: 5 }), (goalText) => {
          const skillTree = decomposer.decompose(goalText);
          
          skillTree.skills.forEach(skill => {
            expect(skill.level).toBeDefined();
            expect(VALID_LEVELS).toContain(skill.level);
          });
        }),
        { numRuns: 100 }
      );
    });

    it('should ensure every skill has days > 0', () => {
      fc.assert(
        fc.property(fc.string({ minLength: 5 }), (goalText) => {
          const skillTree = decomposer.decompose(goalText);
          
          skillTree.skills.forEach(skill => {
            expect(skill.days).toBeDefined();
            expect(typeof skill.days).toBe('number');
            expect(skill.days).toBeGreaterThan(0);
          });
        }),
        { numRuns: 100 }
      );
    });

    it('should ensure skill tree has all required structural properties', () => {
      fc.assert(
        fc.property(fc.string({ minLength: 5 }), (goalText) => {
          const skillTree = decomposer.decompose(goalText);
          
          // Check top-level structure
          expect(skillTree.domain).toBeDefined();
          expect(VALID_DOMAINS).toContain(skillTree.domain);
          expect(skillTree.domainName).toBeDefined();
          expect(typeof skillTree.domainName).toBe('string');
          expect(skillTree.skills).toBeDefined();
          
          // Check each skill has all required fields
          skillTree.skills.forEach(skill => {
            expect(skill.id).toBeDefined();
            expect(typeof skill.id).toBe('string');
            expect(skill.id.length).toBeGreaterThan(0);
            
            expect(skill.name).toBeDefined();
            expect(typeof skill.name).toBe('string');
            expect(skill.name.length).toBeGreaterThan(0);
            
            expect(skill.description).toBeDefined();
            expect(typeof skill.description).toBe('string');
            expect(skill.description.length).toBeGreaterThan(0);
            
            expect(skill.level).toBeDefined();
            expect(VALID_LEVELS).toContain(skill.level);
            
            expect(skill.days).toBeDefined();
            expect(typeof skill.days).toBe('number');
            expect(skill.days).toBeGreaterThan(0);
            
            expect(skill.topics).toBeDefined();
            expect(Array.isArray(skill.topics)).toBe(true);
            expect(skill.topics.length).toBeGreaterThan(0);
          });
        }),
        { numRuns: 100 }
      );
    });
  });
});
