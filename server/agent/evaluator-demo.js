import Evaluator from './Evaluator.js';

const evaluator = new Evaluator();

console.log('=== EVALUATOR DEMO ===\n');

// Demo 1: Multiple-choice question
console.log('1. Multiple-Choice Question:');
const mcQuestions = [{
  id: 'q1',
  type: 'multiple_choice',
  correct: 'PATCH',
  explanation: 'PATCH is used for partial updates.'
}];

const correctAnswer = [{ questionId: 'q1', answer: 'PATCH' }];
const wrongAnswer = [{ questionId: 'q1', answer: 'PUT' }];

const mcCorrect = evaluator.scoreDiagnostic(mcQuestions, correctAnswer);
const mcWrong = evaluator.scoreDiagnostic(mcQuestions, wrongAnswer);

console.log('  Correct answer:', mcCorrect[0]);
console.log('  Wrong answer:', mcWrong[0]);
console.log();

// Demo 2: Open-ended question
console.log('2. Open-Ended Question:');
const openQuestions = [{
  id: 'q2',
  type: 'open_ended',
  score_keywords: ['stateless', 'session', 'server', 'scalability', 'independent', 'request'],
  explanation: 'REST APIs should be stateless for better scalability.'
}];

const goodAnswer = [{
  questionId: 'q2',
  answer: 'REST APIs are stateless, meaning they do not store session data on the server. Each request is independent and contains all necessary information. This improves scalability because any server can handle any request.'
}];

const partialAnswer = [{
  questionId: 'q2',
  answer: 'REST APIs are stateless and do not use sessions.'
}];

const openGood = evaluator.scoreDiagnostic(openQuestions, goodAnswer);
const openPartial = evaluator.scoreDiagnostic(openQuestions, partialAnswer);

console.log('  Good answer (all keywords):', openGood[0]);
console.log('  Partial answer (some keywords):', openPartial[0]);
console.log();

// Demo 3: Session scoring
console.log('3. Practice Session Scoring:');
const challenge = {
  evaluation_criteria: ['API', 'REST', 'HTTP', 'endpoints', 'status codes', 'authentication'],
  model_solution: 'A complete REST API should include proper HTTP methods (GET, POST, PUT, DELETE), meaningful endpoints, appropriate status codes (200, 201, 404, etc.), and authentication mechanisms like JWT.'
};

const excellentResponse = `I would design a REST API with the following considerations:
1. Use proper HTTP methods for CRUD operations
2. Design meaningful endpoints following REST conventions
3. Implement appropriate status codes for different scenarios
4. Add authentication using JWT tokens
5. Include error handling and validation
6. Document all endpoints clearly`;

const goodResponse = 'The API should use REST principles with proper HTTP methods and endpoints. Authentication is important for security.';

const poorResponse = 'Make an API.';

const excellentResult = evaluator.scoreSession(challenge, excellentResponse);
const goodResult = evaluator.scoreSession(challenge, goodResponse);
const poorResult = evaluator.scoreSession(challenge, poorResponse);

console.log('  Excellent response:');
console.log('    Score:', excellentResult.score, '| Grade:', excellentResult.grade);
console.log('    Strengths:', excellentResult.strengths);
console.log('    Weaknesses:', excellentResult.weaknesses);
console.log();

console.log('  Good response:');
console.log('    Score:', goodResult.score, '| Grade:', goodResult.grade);
console.log('    Strengths:', goodResult.strengths);
console.log('    Weaknesses:', goodResult.weaknesses);
console.log();

console.log('  Poor response:');
console.log('    Score:', poorResult.score, '| Grade:', poorResult.grade);
console.log('    Strengths:', poorResult.strengths);
console.log('    Weaknesses:', poorResult.weaknesses);
console.log();

// Demo 4: Grade mapping
console.log('4. Grade Mapping:');
const scores = [95, 85, 75, 65, 55];
scores.forEach(score => {
  console.log(`  Score ${score} → Grade ${evaluator.calculateGrade(score)}`);
});
