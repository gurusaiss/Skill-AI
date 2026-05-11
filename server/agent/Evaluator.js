import GeminiService from '../services/GeminiService.js';

class Evaluator {
  // ── Gemini-powered evaluation ────────────────────────────────────────────
  async evaluateWithLLM(challenge, userResponse, context = {}) {
    const domain = context.domain || '';
    const skillName = challenge.skillName || context.skillName || '';
    const criteria = (challenge.evaluation_criteria || []).join(', ');
    const wordCount = userResponse.trim().split(/\s+/).length;

    if (wordCount < 5) return null; // Too short to bother LLM

    const prompt = `You are evaluating a learner's response for a ${domain} challenge.

Challenge: "${challenge.title}"
Topic: ${challenge.description?.slice(0, 300)}
Evaluation criteria: ${criteria}
Model solution hint: ${challenge.model_solution?.slice(0, 200) || 'N/A'}

Learner's response (${wordCount} words):
"""
${userResponse.slice(0, 1500)}
"""

Evaluate honestly and return ONLY valid JSON:
{
  "score": 72,
  "grade": "B",
  "strengths": ["strength1", "strength2"],
  "weaknesses": ["weakness1", "weakness2"],
  "feedback": "One concise sentence summarizing overall performance.",
  "coachNote": "One actionable tip for improvement.",
  "criteriaHit": ["criterion1"],
  "criteriaMissed": ["criterion2"]
}

Scoring guide:
- 90-100: Exceptional — covered all criteria with clear reasoning and examples
- 75-89: Good — covered most criteria, some depth
- 60-74: Adequate — covered basics, lacks depth or examples
- 45-59: Developing — partial coverage, significant gaps
- Below 45: Needs work — minimal relevant content
Be honest — don't inflate scores for effort alone.`;

    try {
      const result = await GeminiService.generateJSON(prompt,
        `You are a fair, constructive evaluator. Score honestly based on the criteria. Return only valid JSON.`);

      if (result && typeof result.score === 'number') {
        console.log(`[Evaluator] Gemini scored response: ${result.score}% (${result.grade})`);
        return {
          score: Math.min(100, Math.max(0, Math.round(result.score))),
          grade: result.grade || this.calculateGrade(result.score),
          strengths: result.strengths || ['Attempted the challenge'],
          weaknesses: result.weaknesses || ['Review the model solution'],
          feedback: result.feedback || `Scored ${result.score}% on ${skillName}.`,
          coachNote: result.coachNote || '',
          modelSolution: challenge.model_solution || 'No model solution available.',
          source: 'llm'
        };
      }
    } catch (err) {
      console.error('[Evaluator] Gemini error:', err.message);
    }
    return null;
  }

  /**
   * Score diagnostic quiz answers
   */
  scoreDiagnostic(questions, answers) {
    const results = [];

    for (const question of questions) {
      const userAnswer = answers.find(a => a.questionId === question.id);

      if (!userAnswer) {
        results.push({ questionId: question.id, score: 0, feedback: 'No answer provided.' });
        continue;
      }

      let score = 0;
      let feedback = '';

      if (question.type === 'multiple_choice') {
        if (userAnswer.answer === question.correct) {
          score = 100;
          feedback = `Correct! ${question.explanation}`;
        } else {
          score = 0;
          feedback = `Incorrect. The correct answer is "${question.correct}". ${question.explanation}`;
        }
      } else if (question.type === 'open_ended') {
        const keywords = question.score_keywords || [];
        const answerText = userAnswer.answer || '';
        const answerLower = answerText.toLowerCase();
        const matchedKeywords = keywords.filter((keyword) => answerLower.includes(keyword.toLowerCase()));
        const wordCount = answerText.trim() ? answerText.trim().split(/\s+/).length : 0;
        const baseScore = keywords.length ? (matchedKeywords.length / keywords.length) * 70 : 35;
        const lengthBonus = wordCount > 50 ? 20 : wordCount > 25 ? 10 : wordCount > 10 ? 5 : 0;
        score = Math.min(baseScore + lengthBonus, 95);

        if (score >= 70) {
          feedback = `Good answer. You covered ${matchedKeywords.slice(0, 4).join(', ')}. ${question.explanation}`;
        } else if (score >= 40) {
          feedback = `Decent start. Strengthen your answer with ${keywords.filter((keyword) => !matchedKeywords.includes(keyword)).slice(0, 3).join(', ')}. ${question.explanation}`;
        } else {
          feedback = `Add more detail and include concepts like ${keywords.slice(0, 3).join(', ')}. ${question.explanation}`;
        }
      }

      results.push({ questionId: question.id, score: Math.round(score), feedback });
    }

    return results;
  }

  /**
   * Score a practice session response
   * Tries Gemini first, falls back to keyword matching
   */
  async scoreSession(challenge, userResponse, context = {}) {
    // Try Gemini AI scoring
    if (GeminiService.isEnabled()) {
      const llmScore = await this.evaluateWithLLM(challenge, userResponse, context);
      if (llmScore) return llmScore;
    }

    // Rule-based fallback
    return this._scoreSessionRuleBased(challenge, userResponse);
  }

  _scoreSessionRuleBased(challenge, userResponse) {
    const criteria = challenge.evaluation_criteria || [];
    const responseText = userResponse || '';
    const responseLower = responseText.toLowerCase();
    const wordCount = responseText.trim() ? responseText.trim().split(/\s+/).length : 0;

    const matchedCriteria = criteria.filter((criterion) => responseLower.includes(criterion.toLowerCase()));
    const missedCriteria = criteria.filter((criterion) => !matchedCriteria.includes(criterion));
    const reasoningPatterns = ['because', 'since', 'therefore'];
    const codePatterns = ['def ', 'function', 'return', 'const ', 'let '];
    const explanationPatterns = ['this means', 'for example', 'for instance'];

    let score = matchedCriteria.length * 25;
    if (wordCount >= 15) score += 10;
    if (wordCount >= 40) score += 15;
    if (reasoningPatterns.some((pattern) => responseLower.includes(pattern))) score += 10;
    if (codePatterns.some((pattern) => responseLower.includes(pattern))) score += 8;
    if (explanationPatterns.some((pattern) => responseLower.includes(pattern))) score += 8;
    score = Math.min(score, 98);

    const grade = this.calculateGrade(score);

    const strengths = [];
    if (matchedCriteria.length > 0) strengths.push(`Addressed key concepts: ${matchedCriteria.slice(0, 3).join(', ')}`);
    if (wordCount >= 40) strengths.push('Good level of detail');
    if (reasoningPatterns.some((pattern) => responseLower.includes(pattern))) strengths.push('Included reasoning for decisions');
    if (strengths.length === 0) strengths.push('Attempted the challenge');

    const weaknesses = [];
    if (missedCriteria.length > 0) weaknesses.push(`Could improve by covering: ${missedCriteria.slice(0, 3).join(', ')}`);
    if (wordCount < 15) weaknesses.push('Response is too short to demonstrate mastery');
    else if (wordCount < 40) weaknesses.push('Response could be more detailed');
    if (matchedCriteria.length < Math.max(1, Math.ceil(criteria.length / 2))) weaknesses.push('Missing several key concepts');
    if (weaknesses.length === 0) weaknesses.push('Consider exploring edge cases or alternative approaches');

    return {
      score: Math.round(score),
      grade,
      strengths,
      weaknesses,
      feedback: `You hit ${matchedCriteria.length} of ${criteria.length || matchedCriteria.length} target criteria and wrote ${wordCount} words.`,
      modelSolution: challenge.model_solution || 'No model solution available for this challenge.',
      source: 'rule-based'
    };
  }

  calculateGrade(score) {
    if (score >= 90) return 'A';
    if (score >= 75) return 'B';
    if (score >= 60) return 'C';
    if (score >= 45) return 'D';
    return 'F';
  }
}

export default Evaluator;
