/**
 * Quiz Generation Prompt Template
 * 
 * Generates 2 diagnostic questions for a specific skill
 */

export const quizGenerationPrompt = {
  system: `You are an expert educational assessment designer who creates diagnostic questions to evaluate learner competency.

Your task is to generate exactly 2 diagnostic questions for a specific skill:
- 1 multiple-choice question with 4 options
- 1 open-ended question

Questions should:
- Be clear and unambiguous
- Test practical understanding, not just memorization
- Be appropriate for the skill's difficulty level
- Include key concepts that a good answer should cover

Return ONLY valid JSON matching the schema. No explanations, no markdown, just JSON.`,

  user: (skill, context = {}) => {
    const { goalText, profile } = context;
    const roleContext = profile?.targetRole ? ` for someone learning to become a ${profile.targetRole}` : '';

    return `Skill to assess: "${skill.name}"
Description: ${skill.description}
Level: ${skill.level}
Topics: ${skill.topics.join(', ')}
${goalText ? `\nLearner's Goal: "${goalText}"` : ''}${roleContext}

Generate exactly 2 diagnostic questions:

1. Multiple-choice question:
   - 4 answer options
   - Exactly 1 correct answer
   - Tests core understanding of the skill

2. Open-ended question:
   - Requires a written explanation or example
   - Tests practical application
   - Include 5-10 key concepts/keywords that should appear in a good answer

Return JSON in this exact format:
{
  "questions": [
    {
      "id": "q_${skill.id}_1",
      "question": "Question text here?",
      "type": "multiple_choice",
      "options": ["Option A", "Option B", "Option C", "Option D"],
      "correct": "Option A",
      "explanation": "Why this answer is correct",
      "key_concepts": ["concept1", "concept2"],
      "score_keywords": ["keyword1", "keyword2"],
      "sample_good_answer": "Example of a good answer"
    },
    {
      "id": "q_${skill.id}_2",
      "question": "Open-ended question text?",
      "type": "open_ended",
      "options": [],
      "correct": "",
      "explanation": "What makes a good answer",
      "key_concepts": ["concept1", "concept2", "concept3", "concept4", "concept5"],
      "score_keywords": ["keyword1", "keyword2", "keyword3", "keyword4", "keyword5"],
      "sample_good_answer": "Example of a comprehensive answer"
    }
  ]
}`;
  },

  schema: {
    type: 'object',
    required: ['questions'],
    properties: {
      questions: {
        type: 'array',
        minItems: 2,
        maxItems: 2,
        items: {
          type: 'object',
          required: ['id', 'question', 'type', 'options', 'correct', 'explanation', 'key_concepts', 'score_keywords', 'sample_good_answer'],
          properties: {
            id: { type: 'string' },
            question: { type: 'string' },
            type: { 
              type: 'string', 
              enum: ['multiple_choice', 'open_ended'] 
            },
            options: { 
              type: 'array', 
              items: { type: 'string' } 
            },
            correct: { type: 'string' },
            explanation: { type: 'string' },
            key_concepts: { 
              type: 'array', 
              items: { type: 'string' },
              minItems: 2
            },
            score_keywords: { 
              type: 'array', 
              items: { type: 'string' },
              minItems: 2
            },
            sample_good_answer: { type: 'string' }
          }
        }
      }
    }
  }
};
