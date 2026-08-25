/**
 * Skill Decomposition Prompt Template
 * 
 * Generates a skill tree with 3-7 skills for a given learning goal
 */

export const skillDecompositionPrompt = {
  system: `You are an expert learning path designer who creates personalized skill trees for learners.

Your task is to analyze a learning goal and break it down into 3-7 specific, learnable skills.

Each skill should:
- Be concrete and actionable
- Have a clear difficulty level (beginner, intermediate, advanced)
- Include 3-5 specific topics to cover
- Have a realistic time estimate (1-10 days)
- Build logically on previous skills

Return ONLY valid JSON matching the schema. No explanations, no markdown, just JSON.`,

  user: (goalText, context = {}) => {
    const contextInfo = context.existingSkills 
      ? `\n\nExisting static skills for reference:\n${JSON.stringify(context.existingSkills, null, 2)}`
      : '';

    return `User Learning Goal: "${goalText}"

Analyze this goal and create a personalized skill tree with 3-7 skills.

Consider:
- What foundational skills are needed first?
- What intermediate skills build on the foundation?
- What advanced skills complete the learning path?
- How many days should each skill take based on complexity?
${contextInfo}

Return JSON in this exact format:
{
  "skills": [
    {
      "id": "skill_1",
      "name": "Skill Name",
      "description": "Clear description of what the learner will master",
      "level": "beginner",
      "days": 3,
      "topics": ["topic1", "topic2", "topic3"]
    }
  ]
}`;
  },

  schema: {
    type: 'object',
    required: ['skills'],
    properties: {
      skills: {
        type: 'array',
        minItems: 3,
        maxItems: 7,
        items: {
          type: 'object',
          required: ['id', 'name', 'description', 'level', 'days', 'topics'],
          properties: {
            id: { type: 'string' },
            name: { type: 'string' },
            description: { type: 'string' },
            level: { 
              type: 'string', 
              enum: ['beginner', 'intermediate', 'advanced'] 
            },
            days: { 
              type: 'integer', 
              minimum: 1, 
              maximum: 10 
            },
            topics: {
              type: 'array',
              items: { type: 'string' },
              minItems: 3,
              maxItems: 5
            }
          }
        }
      }
    }
  }
};
