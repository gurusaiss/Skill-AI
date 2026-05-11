import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import Evaluator from './Evaluator.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

describe('Evaluator Integration Tests', () => {
  const evaluator = new Evaluator();

  it('should work with real questions from knowledge bank', () => {
    // Load actual questions
    const questionsPath = join(__dirname, '../knowledge/questions.json');
    const questionsBank = JSON.parse(readFileSync(questionsPath, 'utf-8'));

    // Get a real multiple-choice question
    const mcQuestion = questionsBank.rest_apis.intermediate[0];
    
    const questions = [{
      id: mcQuestion.id,
      type: mcQuestion.type,
      correct: mcQuestion.correct,
      explanation: mcQuestion.explanation,
      score_keywords: mcQuestion.score_keywords
    }];

    // Test correct answer
    const correctAnswers = [{ questionId: mcQuestion.id, answer: mcQuestion.correct }];
    const results = evaluator.scoreDiagnostic(questions, correctAnswers);

    expect(results[0].score).toBe(100);
    expect(results[0].feedback).toContain('Correct');
  });

  it('should work with real open-ended questions from knowledge bank', () => {
    const questionsPath = join(__dirname, '../knowledge/questions.json');
    const questionsBank = JSON.parse(readFileSync(questionsPath, 'utf-8'));

    // Get a real open-ended question
    const openQuestion = questionsBank.rest_apis.intermediate[1];
    
    const questions = [{
      id: openQuestion.id,
      type: openQuestion.type,
      correct: openQuestion.correct,
      explanation: openQuestion.explanation,
      score_keywords: openQuestion.score_keywords
    }];

    // Test with sample good answer
    const answers = [{ 
      questionId: openQuestion.id, 
      answer: openQuestion.sample_good_answer 
    }];
    
    const results = evaluator.scoreDiagnostic(questions, answers);

    // Should get reasonable score (capped at 95) for good answer
    expect(results[0].score).toBeGreaterThan(50);
    expect(results[0].score).toBeLessThanOrEqual(95);
  });

  it('should work with real challenges from knowledge bank', () => {
    const challengesPath = join(__dirname, '../knowledge/challenges.json');
    const challengesBank = JSON.parse(readFileSync(challengesPath, 'utf-8'));

    // Get a real challenge
    const challenge = challengesBank.rest_apis[0];

    // Test with a response that includes some criteria
    const response = `I would design a RESTful API with proper HTTP methods like GET, POST, PUT, DELETE. 
    The API would use RESTful resource naming conventions with plural nouns like /posts and /comments.
    I would implement proper status codes for each operation - 200 for success, 201 for creation, 404 for not found.
    Authentication would be handled using JWT tokens in the Authorization header.
    For pagination, I would use query parameters like ?page=1&limit=10.
    Error handling would return consistent JSON responses with error codes and messages.`;

    const result = evaluator.scoreSession(challenge, response);

    // Should get a good score since response covers many criteria
    expect(result.score).toBeGreaterThan(60);
    expect(result.score).toBeLessThanOrEqual(98);
    expect(result.grade).toBeTruthy();
    expect(result.strengths.length).toBeGreaterThan(0);
    expect(result.weaknesses.length).toBeGreaterThan(0);
    expect(result.modelSolution).toBe(challenge.model_solution);
  });

  it('should handle empty or minimal responses gracefully', () => {
    const challenge = {
      evaluation_criteria: ['test', 'example', 'criteria'],
      model_solution: 'Model solution'
    };

    const emptyResult = evaluator.scoreSession(challenge, '');
    const minimalResult = evaluator.scoreSession(challenge, 'test');

    // Empty response should get low score
    expect(emptyResult.score).toBeLessThan(20);
    expect(emptyResult.grade).toBe('F');
    
    // Minimal response should get some credit
    expect(minimalResult.score).toBeGreaterThan(0);
    expect(minimalResult.strengths.length).toBeGreaterThan(0);
    expect(minimalResult.weaknesses.length).toBeGreaterThan(0);
  });

  it('should give word count bonus for detailed responses', () => {
    const challenge = {
      evaluation_criteria: ['test'],
      model_solution: 'Model solution'
    };

    const shortResponse = 'test';
    const longResponse = 'test ' + 'word '.repeat(150); // 150+ words

    const shortResult = evaluator.scoreSession(challenge, shortResponse);
    const longResult = evaluator.scoreSession(challenge, longResponse);

    // Long response should score higher due to word count bonus
    expect(longResult.score).toBeGreaterThan(shortResult.score);
  });
});
