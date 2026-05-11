import { describe, it, expect } from 'vitest';
import Evaluator from './Evaluator.js';

describe('Evaluator', () => {
  const evaluator = new Evaluator();

  describe('scoreDiagnostic', () => {
    it('should score multiple-choice questions with exact match (100 or 0)', () => {
      const questions = [
        {
          id: 'q1',
          type: 'multiple_choice',
          correct: 'PATCH',
          explanation: 'PATCH is for partial updates'
        }
      ];

      const correctAnswers = [{ questionId: 'q1', answer: 'PATCH' }];
      const incorrectAnswers = [{ questionId: 'q1', answer: 'PUT' }];

      const correctResults = evaluator.scoreDiagnostic(questions, correctAnswers);
      const incorrectResults = evaluator.scoreDiagnostic(questions, incorrectAnswers);

      expect(correctResults[0].score).toBe(100);
      expect(incorrectResults[0].score).toBe(0);
    });

    it('should score open-ended questions proportionally and cap at 95', () => {
      const questions = [
        {
          id: 'q2',
          type: 'open_ended',
          score_keywords: ['stateless', 'session', 'server', 'scalability'],
          explanation: 'REST APIs should be stateless'
        }
      ];

      // Match all keywords
      const allKeywordsAnswer = [{ 
        questionId: 'q2', 
        answer: 'REST APIs are stateless, meaning no session data is stored on the server, which improves scalability' 
      }];

      // Match half keywords
      const halfKeywordsAnswer = [{ 
        questionId: 'q2', 
        answer: 'REST APIs are stateless and do not store session data' 
      }];

      const allResults = evaluator.scoreDiagnostic(questions, allKeywordsAnswer);
      const halfResults = evaluator.scoreDiagnostic(questions, halfKeywordsAnswer);

      // All keywords give 70 base plus a 5-point short-answer bonus here
      expect(allResults[0].score).toBe(75);
      
      // Two keyword hits with no length bonus on this shorter answer
      expect(halfResults[0].score).toBe(35);
    });

    it('should generate feedback for each answer', () => {
      const questions = [
        {
          id: 'q1',
          type: 'multiple_choice',
          correct: 'A',
          explanation: 'Test explanation'
        }
      ];

      const answers = [{ questionId: 'q1', answer: 'A' }];
      const results = evaluator.scoreDiagnostic(questions, answers);

      expect(results[0].feedback).toBeTruthy();
      expect(results[0].feedback.length).toBeGreaterThan(0);
    });
  });

  describe('scoreSession', () => {
    it('should return score in range [0, 100]', () => {
      const challenge = {
        evaluation_criteria: ['API', 'REST', 'HTTP'],
        model_solution: 'Sample solution'
      };

      const response = 'This is about API design using REST and HTTP methods';
      const result = evaluator.scoreSession(challenge, response);

      expect(result.score).toBeGreaterThanOrEqual(0);
      expect(result.score).toBeLessThanOrEqual(100);
    });

    it('should cap score at 98', () => {
      const challenge = {
        evaluation_criteria: ['test', 'example'],
        model_solution: 'Sample solution'
      };

      // Very long response with all keywords
      const response = 'test example ' + 'word '.repeat(200);
      const result = evaluator.scoreSession(challenge, response);

      expect(result.score).toBeLessThanOrEqual(98);
    });

    it('should return valid grade (A-F)', () => {
      const challenge = {
        evaluation_criteria: ['test'],
        model_solution: 'Sample solution'
      };

      const response = 'test response';
      const result = evaluator.scoreSession(challenge, response);

      expect(['A', 'B', 'C', 'D', 'F']).toContain(result.grade);
    });

    it('should return non-empty strengths array', () => {
      const challenge = {
        evaluation_criteria: ['test'],
        model_solution: 'Sample solution'
      };

      const response = 'test response';
      const result = evaluator.scoreSession(challenge, response);

      expect(Array.isArray(result.strengths)).toBe(true);
      expect(result.strengths.length).toBeGreaterThan(0);
    });

    it('should return non-empty weaknesses array', () => {
      const challenge = {
        evaluation_criteria: ['test'],
        model_solution: 'Sample solution'
      };

      const response = 'test response';
      const result = evaluator.scoreSession(challenge, response);

      expect(Array.isArray(result.weaknesses)).toBe(true);
      expect(result.weaknesses.length).toBeGreaterThan(0);
    });

    it('should return modelSolution', () => {
      const challenge = {
        evaluation_criteria: ['test'],
        model_solution: 'This is the model solution'
      };

      const response = 'test response';
      const result = evaluator.scoreSession(challenge, response);

      expect(result.modelSolution).toBe('This is the model solution');
    });
  });

  describe('calculateGrade', () => {
    it('should map scores to correct grades', () => {
      expect(evaluator.calculateGrade(95)).toBe('A');
      expect(evaluator.calculateGrade(90)).toBe('A');
      expect(evaluator.calculateGrade(85)).toBe('B');
      expect(evaluator.calculateGrade(80)).toBe('B');
      expect(evaluator.calculateGrade(75)).toBe('B');
      expect(evaluator.calculateGrade(70)).toBe('C');
      expect(evaluator.calculateGrade(65)).toBe('C');
      expect(evaluator.calculateGrade(60)).toBe('C');
      expect(evaluator.calculateGrade(55)).toBe('D');
      expect(evaluator.calculateGrade(0)).toBe('F');
    });
  });
});
