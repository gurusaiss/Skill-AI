import LLMClient from '../llm/LLMClient.js';

class OpenAIContentEngine {
  constructor() {
    this.llmClient = new LLMClient({
      apiKey: process.env.OPENAI_API_KEY,
      model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
      provider: 'openai'
    });
  }

  isEnabled() {
    return this.llmClient.isEnabled();
  }

  async generateGoalEnhancement(payload) {
    const systemPrompt = `You are a learning plan personalization expert. Analyze the user's goal and enhance the skill tree.
Keep existing static skills unless the user goal clearly needs one or two extra missing skills.
Return ONLY valid JSON matching the schema. Do not include any explanatory text.`;

    const userPrompt = `Goal: ${payload.goalText}
Domain: ${payload.domainName}
Profile: ${JSON.stringify(payload.profile)}
Static Skills: ${JSON.stringify(payload.staticSkills)}

Enhance this learning plan by:
1. Identifying the target role (e.g., "Frontend Developer", "Data Analyst")
2. Determining learner level (beginner/intermediate/advanced)
3. Setting intensity (accelerated/steady/deep)
4. Detecting tools/technologies mentioned
5. Extracting focus keywords
6. Adding 0-2 custom skills ONLY if critical skills are missing
7. Recommending skill order
8. Setting learning preferences

Return JSON with: targetRole, learnerLevel, intensity, detectedTools, focusKeywords, customSkills (array), recommendedOrder (array of skill IDs), learningPreferences (objectiveTone, resourceTypes)`;

    const result = await this.llmClient.callStructured(userPrompt, null, {
      systemPrompt,
      temperature: 0.3,
      maxTokens: 2000
    });

    if (!result.success) {
      console.error('[OpenAIContentEngine.generateGoalEnhancement]', result.error);
      return null;
    }

    return result.data;
  }

  async generateQuestions(payload) {
    const systemPrompt = `You are a diagnostic question generator for adaptive learning.
Generate exactly 2 practical diagnostic questions for the given skill.
Questions should be tailored to the user's goal and skill level.
Return ONLY valid JSON. Do not include any explanatory text.`;

    const userPrompt = `Goal: ${payload.goalText}
Profile: ${JSON.stringify(payload.profile)}
Skill: ${JSON.stringify(payload.skill)}
Static Questions (for reference): ${JSON.stringify(payload.staticQuestions)}

Generate 2 diagnostic questions with:
- id: unique identifier
- question: the question text
- type: "multiple_choice" or "open_ended"
- options: array of 4 options (for multiple_choice)
- correct: correct answer
- explanation: why this answer is correct
- key_concepts: array of key concepts tested
- score_keywords: keywords for scoring open-ended answers
- sample_good_answer: example of a good answer

Return JSON: { "questions": [ {...}, {...} ] }`;

    const result = await this.llmClient.callStructured(userPrompt, null, {
      systemPrompt,
      temperature: 0.4,
      maxTokens: 2000
    });

    if (!result.success) {
      console.error('[OpenAIContentEngine.generateQuestions]', result.error);
      return null;
    }

    return result.data;
  }

  async generateChallenge(payload) {
    const systemPrompt = `You are a learning challenge generator for adaptive education.
Generate one personalized learning challenge for the given day and skill.
Make it practical, engaging, and appropriate for the learner's level.
Return ONLY valid JSON. Do not include any explanatory text.`;

    const userPrompt = `Goal: ${payload.goalText}
Profile: ${JSON.stringify(payload.profile)}
Day: ${JSON.stringify(payload.planDay)}
Recent Weaknesses: ${JSON.stringify(payload.recentWeaknesses)}

Generate a challenge with:
- id: unique identifier
- day_range: [start_day, end_day] when this challenge is appropriate
- type: "coding", "conceptual", "scenario", "design", "practical", "implementation", or "query"
- title: engaging title
- description: detailed description of the challenge
- hints: array of 2-3 helpful hints
- evaluation_criteria: array of criteria for evaluation
- model_solution: example solution or approach

Return JSON with these fields.`;

    const result = await this.llmClient.callStructured(userPrompt, null, {
      systemPrompt,
      temperature: 0.5,
      maxTokens: 2000
    });

    if (!result.success) {
      console.error('[OpenAIContentEngine.generateChallenge]', result.error);
      return null;
    }

    return result.data;
  }

  async generateReport(payload) {
    const systemPrompt = `You are a learning progress report generator.
Write a concise, encouraging report based ONLY on the provided user data.
Be specific about demonstrated skills and provide actionable coaching advice.
Return ONLY valid JSON. Do not include any explanatory text.`;

    const userPrompt = `Goal: ${payload.goalText}
Domain: ${payload.domainLabel}
Profile: ${JSON.stringify(payload.profile)}
Sessions Completed: ${payload.sessions.length}
Session Details: ${JSON.stringify(payload.sessions)}
Skills: ${JSON.stringify(payload.skills)}
Adaptations: ${JSON.stringify(payload.adaptations)}

Generate a report with:
- narrative: 2-3 paragraph narrative about the learner's progress, strengths, and areas for improvement
- demonstratedSkills: array of specific skills the learner has demonstrated
- coachSummary: 1-2 paragraph coaching summary with actionable next steps

Return JSON: { "narrative": "...", "demonstratedSkills": [...], "coachSummary": "..." }`;

    const result = await this.llmClient.callStructured(userPrompt, null, {
      systemPrompt,
      temperature: 0.6,
      maxTokens: 1500
    });

    if (!result.success) {
      console.error('[OpenAIContentEngine.generateReport]', result.error);
      return null;
    }

    return result.data;
  }
}

export default OpenAIContentEngine;
