/**
 * Response Evaluation Prompt Template
 * 
 * Evaluates open-ended responses using semantic understanding
 */

export const responseEvaluationPrompt = {
  system: `You are an expert educational evaluator who provides constructive, specific feedback on learner responses.

Your task is to evaluate an open-ended response and provide:
- A score from 0-100 based on understanding and completeness
- At least 2 specific strengths demonstrated in the response
- At least 2 specific areas for improvement
- Actionable feedback for how to improve

Be fair but encouraging. Focus on what the learner demonstrated and what they can do to strengthen their understanding.

Return ONLY valid JSON matching the schema. No explanations, no markdown, just JSON.`,

  user: (question, userAnswer, keyConcepts, context = {}) => {
    const { skillName, topic } = context;

    return `Question: "${question}"

Expected Key Concepts: ${keyConcepts.join(', ')}
${skillName ? `\nSkill: ${skillName}` : ''}
${topic ? `Topic: ${topic}` : ''}

Learner's Answer:
"${userAnswer}"

Evaluate this response and provide:
1. Score (0-100): How well does the answer demonstrate understanding?
   - 90-100: Excellent, comprehensive understanding with examples
   - 75-89: Good understanding, covers most key concepts
   - 60-74: Adequate understanding, covers some key concepts
   - 40-59: Partial understanding, missing important concepts
   - 0-39: Limited understanding, needs significant improvement

2. Strengths: At least 2 specific things the learner did well
   - What concepts did they explain correctly?
   - What examples or reasoning were strong?
   - What demonstrates their understanding?

3. Weaknesses: At least 2 specific areas to improve
   - What key concepts are missing or unclear?
   - What could be explained better?
   - What examples or details would strengthen the answer?

4. Feedback: Specific, actionable suggestions for improvement

Return JSON in this exact format:
{
  "score": 85,
  "feedback": "Your answer demonstrates good understanding of [specific concept]. To strengthen it further, consider [specific suggestion].",
  "strengths": [
    "Correctly explained [specific concept] with a clear example",
    "Demonstrated understanding of [specific aspect]"
  ],
  "weaknesses": [
    "Could improve by explaining the relationship between [concept A] and [concept B]",
    "Missing discussion of [specific key concept]"
  ]
}`;
  },

  schema: {
    type: 'object',
    required: ['score', 'feedback', 'strengths', 'weaknesses'],
    properties: {
      score: { 
        type: 'integer', 
        minimum: 0, 
        maximum: 100 
      },
      feedback: { type: 'string' },
      strengths: { 
        type: 'array', 
        items: { type: 'string' },
        minItems: 2
      },
      weaknesses: { 
        type: 'array', 
        items: { type: 'string' },
        minItems: 2
      }
    }
  }
};
