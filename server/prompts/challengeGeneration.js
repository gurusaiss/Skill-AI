/**
 * Challenge Generation Prompt Template
 * 
 * Generates a practice challenge for a specific day and skill
 */

export const challengeGenerationPrompt = {
  system: `You are an expert learning experience designer who creates practical, hands-on challenges for learners.

Your task is to generate one personalized learning challenge that:
- Is practical and applicable to real-world scenarios
- Matches the skill level and topic
- Includes 3-5 helpful hints
- Has 5-7 clear evaluation criteria
- Provides a model solution as a reference

Return ONLY valid JSON matching the schema. No explanations, no markdown, just JSON.`,

  user: (planDay, context = {}) => {
    const { goalText, profile, skillName, skillDescription, recentWeaknesses = [] } = context;
    const roleContext = profile?.targetRole ? ` for someone learning to become a ${profile.targetRole}` : '';
    const weaknessContext = recentWeaknesses.length > 0 
      ? `\n\nRecent areas to strengthen: ${recentWeaknesses.join(', ')}`
      : '';

    return `Create a practice challenge for:

Skill: ${skillName || planDay.skillName}
${skillDescription ? `Description: ${skillDescription}` : ''}
Topic: ${planDay.topic}
Day: ${planDay.day}
Session Type: ${planDay.sessionType || 'practice'}
${goalText ? `\nLearner's Goal: "${goalText}"` : ''}${roleContext}${weaknessContext}

The challenge should:
- Focus specifically on "${planDay.topic}"
- Be practical and hands-on
- Take approximately 30 minutes to complete
- Include concrete examples or scenarios
- Help the learner apply what they've learned

Return JSON in this exact format:
{
  "id": "ch_${planDay.skillId}_day${planDay.day}",
  "day_range": [${planDay.day}, ${planDay.day}],
  "type": "practical",
  "title": "Challenge Title",
  "description": "Detailed description of what the learner needs to do. Include specific requirements and context.",
  "hints": [
    "Hint 1: Start by...",
    "Hint 2: Consider...",
    "Hint 3: Remember to..."
  ],
  "evaluation_criteria": [
    "${planDay.topic}",
    "clear explanation",
    "practical example",
    "correct reasoning",
    "completeness"
  ],
  "model_solution": "A comprehensive example solution that demonstrates best practices and covers all evaluation criteria."
}`;
  },

  schema: {
    type: 'object',
    required: ['id', 'title', 'description', 'hints', 'evaluation_criteria', 'model_solution'],
    properties: {
      id: { type: 'string' },
      day_range: { 
        type: 'array', 
        items: { type: 'integer' } 
      },
      type: { 
        type: 'string',
        enum: ['coding', 'conceptual', 'scenario', 'design', 'practical', 'implementation', 'query']
      },
      title: { type: 'string' },
      description: { type: 'string' },
      hints: { 
        type: 'array', 
        items: { type: 'string' },
        minItems: 3,
        maxItems: 5
      },
      evaluation_criteria: { 
        type: 'array', 
        items: { type: 'string' },
        minItems: 5,
        maxItems: 10
      },
      model_solution: { type: 'string' }
    }
  }
};
