// Feature: skillforge-ai, Property 7: Diagnostic scores are bounded
// Feature: skillforge-ai, Property 8: Multiple-choice scoring is binary
// Feature: skillforge-ai, Property 9: Open-ended scoring is proportional and capped
// Feature: skillforge-ai, Property 10: Evaluator always produces feedback
// Feature: skillforge-ai, Property 13: Session evaluation output is complete and bounded

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import Evaluator from './Evaluator.js';

describe('Evaluator - Property-Based Tests', () => {
  const evaluator = new Evaluator();

  describe('Property 7: Diagnostic scores are bounded', () => {
    it('should return scores in [0, 100] for arbitrary answer sets', () => {
      fc.assert(
        fc.property(
          // Generate arbitrary questions (mix of MC and open-ended)
          fc.array(
            fc.record({
              id: fc.string({ minLength: 1, maxLength: 20 }),
              type: fc.constantFrom('multiple_choice', 'open_ended'),
              correct: fc.string({ minLength: 1, maxLength: 50 }),
              score_keywords: fc.array(fc.string({ minLength: 1, maxLength: 20 }), { minLength: 0, maxLength: 10 }),
              explanation: fc.string({ maxLength: 100 })
            }),
            { minLength: 1, maxLength: 20 }
          ),
          // Generate arbitrary answers
          (questions) => {
            const answers = questions.map(q => ({
              questionId: q.id,
              answer: fc.sample(fc.string({ maxLength: 200 }), 1)[0]
            }));

            const results = evaluator.scoreDiagnostic(questions, answers);

            // Assert all scores are bounded [0, 100]
            for (const result of results) {
              expect(result.score).toBeGreaterThanOrEqual(0);
              expect(result.score).toBeLessThanOrEqual(100);
            }
          }
        ),
        { numRuns: 100 }
      );
    });
  });

  describe('Property 8: Multiple-choice scoring is binary', () => {
    it('should return 100 for correct answers and 0 for incorrect answers', () => {
      fc.assert(
        fc.property(
          // Generate arbitrary MC questions
          fc.record({
            id: fc.string({ minLength: 1, maxLength: 20 }),
            type: fc.constant('multiple_choice'),
            correct: fc.string({ minLength: 1, maxLength: 50 }),
            explanation: fc.string({ maxLength: 100 })
          }),
          fc.string({ minLength: 1, maxLength: 50 }), // arbitrary answer
          (question, userAnswer) => {
            const questions = [question];
            const answers = [{ questionId: question.id, answer: userAnswer }];

            const results = evaluator.scoreDiagnostic(questions, answers);

            // Assert binary scoring: 100 if correct, 0 if incorrect
            if (userAnswer === question.correct) {
              expect(results[0].score).toBe(100);
            } else {
              expect(results[0].score).toBe(0);
            }
          }
        ),
        { numRuns: 100 }
      );
    });
  });

  describe('Property 9: Open-ended scoring is proportional and capped', () => {
    it('should score proportionally to matched keywords and cap at 95', () => {
      fc.assert(
        fc.property(
          // Generate arbitrary keyword lists
          fc.array(fc.string({ minLength: 3, maxLength: 15 }), { minLength: 1, maxLength: 10 }),
          fc.string({ minLength: 0, maxLength: 500 }), // arbitrary response
          (keywords, response) => {
            const question = {
              id: 'test-q',
              type: 'open_ended',
              score_keywords: keywords,
              explanation: 'Test explanation'
            };

            const questions = [question];
            const answers = [{ questionId: question.id, answer: response }];

            const results = evaluator.scoreDiagnostic(questions, answers);
            const score = results[0].score;

            // Assert score is capped at 95
            expect(score).toBeLessThanOrEqual(95);

            // Assert score is proportional to matched keywords
            const responseLower = response.toLowerCase();
            let matchedCount = 0;
            for (const keyword of keywords) {
              if (responseLower.includes(keyword.toLowerCase())) {
                matchedCount++;
              }
            }

            const expectedScore = Math.min((matchedCount / keywords.length) * 100, 95);
            expect(score).toBe(Math.round(expectedScore));
          }
        ),
        { numRuns: 100 }
      );
    });
  });

  describe('Property 10: Evaluator always produces feedback', () => {
    it('should return non-empty feedback for arbitrary answers', () => {
      fc.assert(
        fc.property(
          // Generate arbitrary questions
          fc.array(
            fc.record({
              id: fc.string({ minLength: 1, maxLength: 20 }),
              type: fc.constantFrom('multiple_choice', 'open_ended'),
              correct: fc.string({ minLength: 1, maxLength: 50 }),
              score_keywords: fc.array(fc.string({ minLength: 1, maxLength: 20 }), { minLength: 0, maxLength: 10 }),
              explanation: fc.string({ maxLength: 100 })
            }),
            { minLength: 1, maxLength: 10 }
          ),
          fc.string({ maxLength: 500 }), // arbitrary answer
          (questions, answerText) => {
            const answers = questions.map(q => ({
              questionId: q.id,
              answer: answerText
            }));

            const results = evaluator.scoreDiagnostic(questions, answers);

            // Assert all results have non-empty feedback
            for (const result of results) {
              expect(result.feedback).toBeTruthy();
              expect(typeof result.feedback).toBe('string');
              expect(result.feedback.length).toBeGreaterThan(0);
            }
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should return non-empty feedback even for empty answers', () => {
      fc.assert(
        fc.property(
          fc.record({
            id: fc.string({ minLength: 1, maxLength: 20 }),
            type: fc.constantFrom('multiple_choice', 'open_ended'),
            correct: fc.string({ minLength: 1, maxLength: 50 }),
            score_keywords: fc.array(fc.string({ minLength: 1, maxLength: 20 }), { minLength: 0, maxLength: 10 }),
            explanation: fc.string({ maxLength: 100 })
          }),
          (question) => {
            const questions = [question];
            const answers = [{ questionId: question.id, answer: '' }];

            const results = evaluator.scoreDiagnostic(questions, answers);

            // Assert feedback is non-empty even for empty answer
            expect(results[0].feedback).toBeTruthy();
            expect(typeof results[0].feedback).toBe('string');
            expect(results[0].feedback.length).toBeGreaterThan(0);
          }
        ),
        { numRuns: 100 }
      );
    });
  });

  describe('Property 13: Session evaluation output is complete and bounded', () => {
    it('should return complete evaluation with bounded score for arbitrary challenge responses', () => {
      fc.assert(
        fc.property(
          // Generate arbitrary challenges
          fc.record({
            id: fc.string({ minLength: 1, maxLength: 20 }),
            evaluation_criteria: fc.array(fc.string({ minLength: 1, maxLength: 30 }), { minLength: 0, maxLength: 10 }),
            model_solution: fc.string({ minLength: 1, maxLength: 500 })
          }),
          fc.string({ maxLength: 1000 }), // arbitrary response (including empty)
          (challenge, userResponse) => {
            const result = evaluator.scoreSession(challenge, userResponse);

            // Assert score is in [0, 100]
            expect(result.score).toBeGreaterThanOrEqual(0);
            expect(result.score).toBeLessThanOrEqual(100);

            // Assert grade is one of A, B, C, D, F
            expect(['A', 'B', 'C', 'D', 'F']).toContain(result.grade);

            // Assert non-empty strengths array
            expect(Array.isArray(result.strengths)).toBe(true);
            expect(result.strengths.length).toBeGreaterThan(0);

            // Assert non-empty weaknesses array
            expect(Array.isArray(result.weaknesses)).toBe(true);
            expect(result.weaknesses.length).toBeGreaterThan(0);

            // Assert non-empty modelSolution string
            expect(typeof result.modelSolution).toBe('string');
            expect(result.modelSolution.length).toBeGreaterThan(0);
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should handle empty responses correctly', () => {
      fc.assert(
        fc.property(
          fc.record({
            id: fc.string({ minLength: 1, maxLength: 20 }),
            evaluation_criteria: fc.array(fc.string({ minLength: 1, maxLength: 30 }), { minLength: 0, maxLength: 10 }),
            model_solution: fc.string({ minLength: 1, maxLength: 500 })
          }),
          (challenge) => {
            const result = evaluator.scoreSession(challenge, '');

            // Assert all required fields are present and valid
            expect(result.score).toBeGreaterThanOrEqual(0);
            expect(result.score).toBeLessThanOrEqual(100);
            expect(['A', 'B', 'C', 'D', 'F']).toContain(result.grade);
            expect(result.strengths.length).toBeGreaterThan(0);
            expect(result.weaknesses.length).toBeGreaterThan(0);
            expect(result.modelSolution.length).toBeGreaterThan(0);
          }
        ),
        { numRuns: 100 }
      );
    });
  });
});
