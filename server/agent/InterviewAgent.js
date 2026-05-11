// InterviewAgent.js — AI-Powered Interview Simulator
// Generates role-based interview questions and evaluates responses in real-time

import GeminiService from '../services/GeminiService.js';

class InterviewAgent {
  constructor() {
    this.gemini = GeminiService;
  }

  /**
   * Generate interview questions based on role and skill level
   * @param {Object} params - { role, skills, difficulty, count }
   * @returns {Array} Interview questions
   */
  async generateQuestions({ role, skills, difficulty = 'medium', count = 5 }) {
    const skillList = Array.isArray(skills) ? skills.join(', ') : skills;
    
    const prompt = `You are an expert technical interviewer for a ${role} position.

Generate ${count} interview questions that assess the candidate's knowledge in: ${skillList}

Difficulty level: ${difficulty}

Requirements:
1. Mix of technical and behavioral questions
2. Questions should be realistic and commonly asked
3. Include follow-up prompts for deeper assessment
4. Range from foundational to advanced concepts

Return JSON format:
{
  "questions": [
    {
      "id": 1,
      "type": "technical|behavioral|coding|system-design",
      "question": "Main question text",
      "followUp": "Follow-up question if answer is good",
      "difficulty": "easy|medium|hard",
      "skill": "Specific skill being tested",
      "expectedPoints": ["Key point 1", "Key point 2", "Key point 3"],
      "timeLimit": 120
    }
  ]
}`;

    try {
      if (!this.gemini.isEnabled()) {
        return this._getFallbackQuestions(role, skills, count);
      }

      const response = await this.gemini.generateContent(prompt);
      const parsed = this._parseJSON(response);
      
      if (parsed && parsed.questions && Array.isArray(parsed.questions)) {
        return parsed.questions.map((q, i) => ({
          ...q,
          id: i + 1,
          askedAt: null,
          answeredAt: null,
          answer: null,
          score: null,
          feedback: null
        }));
      }

      return this._getFallbackQuestions(role, skills, count);
    } catch (error) {
      console.error('[InterviewAgent] Question generation failed:', error.message);
      return this._getFallbackQuestions(role, skills, count);
    }
  }

  /**
   * Evaluate candidate's answer to an interview question
   * @param {Object} params - { question, answer, role }
   * @returns {Object} Evaluation result
   */
  async evaluateAnswer({ question, answer, role }) {
    const prompt = `You are evaluating a candidate's interview response for a ${role} position.

Question: ${question.question}
Expected Key Points: ${question.expectedPoints?.join(', ') || 'N/A'}
Candidate's Answer: ${answer}

Evaluate the response and provide:
1. Score (0-100)
2. Strengths (what they did well)
3. Weaknesses (what they missed)
4. Specific feedback for improvement
5. Whether to ask follow-up question

Return JSON format:
{
  "score": 85,
  "grade": "A|B|C|D|F",
  "strengths": ["Point 1", "Point 2"],
  "weaknesses": ["Gap 1", "Gap 2"],
  "feedback": "Detailed constructive feedback",
  "askFollowUp": true,
  "followUpReason": "Why follow-up is needed",
  "overallImpression": "Brief summary"
}`;

    try {
      if (!this.gemini.isEnabled()) {
        return this._getFallbackEvaluation(question, answer);
      }

      const response = await this.gemini.generateContent(prompt);
      const parsed = this._parseJSON(response);
      
      if (parsed && typeof parsed.score === 'number') {
        return {
          score: Math.min(100, Math.max(0, parsed.score)),
          grade: parsed.grade || this._scoreToGrade(parsed.score),
          strengths: parsed.strengths || ['Response provided'],
          weaknesses: parsed.weaknesses || [],
          feedback: parsed.feedback || 'Good effort. Keep practicing.',
          askFollowUp: parsed.askFollowUp || false,
          followUpReason: parsed.followUpReason || '',
          overallImpression: parsed.overallImpression || 'Satisfactory response',
          evaluatedAt: new Date().toISOString(),
          source: 'gemini'
        };
      }

      return this._getFallbackEvaluation(question, answer);
    } catch (error) {
      console.error('[InterviewAgent] Evaluation failed:', error.message);
      return this._getFallbackEvaluation(question, answer);
    }
  }

  /**
   * Generate overall interview performance report
   * @param {Array} questions - All questions with answers and scores
   * @param {String} role - Target role
   * @returns {Object} Performance report
   */
  async generateReport(questions, role) {
    const answeredQuestions = questions.filter(q => q.answer && q.score !== null);
    
    if (answeredQuestions.length === 0) {
      return {
        overallScore: 0,
        grade: 'F',
        readiness: 'Not Ready',
        summary: 'No questions answered',
        recommendations: ['Complete the interview to get feedback']
      };
    }

    const avgScore = Math.round(
      answeredQuestions.reduce((sum, q) => sum + q.score, 0) / answeredQuestions.length
    );

    const prompt = `You are an interview performance analyst for a ${role} position.

Interview Results:
${answeredQuestions.map((q, i) => `
Q${i + 1}: ${q.question}
Score: ${q.score}/100
Strengths: ${q.feedback?.strengths?.join(', ') || 'N/A'}
Weaknesses: ${q.feedback?.weaknesses?.join(', ') || 'N/A'}
`).join('\n')}

Average Score: ${avgScore}/100

Provide a comprehensive interview performance report:

Return JSON format:
{
  "overallScore": ${avgScore},
  "grade": "A|B|C|D|F",
  "readiness": "Ready|Almost Ready|Needs Practice|Not Ready",
  "summary": "2-3 sentence overall assessment",
  "strengths": ["Overall strength 1", "Overall strength 2"],
  "areasToImprove": ["Area 1", "Area 2", "Area 3"],
  "recommendations": ["Specific action 1", "Specific action 2"],
  "nextSteps": ["Step 1", "Step 2"],
  "estimatedReadiness": "X weeks of practice needed"
}`;

    try {
      if (!this.gemini.isEnabled()) {
        return this._getFallbackReport(avgScore, answeredQuestions);
      }

      const response = await this.gemini.generateContent(prompt);
      const parsed = this._parseJSON(response);
      
      if (parsed && parsed.overallScore !== undefined) {
        return {
          ...parsed,
          totalQuestions: questions.length,
          answeredQuestions: answeredQuestions.length,
          completionRate: Math.round((answeredQuestions.length / questions.length) * 100),
          generatedAt: new Date().toISOString()
        };
      }

      return this._getFallbackReport(avgScore, answeredQuestions);
    } catch (error) {
      console.error('[InterviewAgent] Report generation failed:', error.message);
      return this._getFallbackReport(avgScore, answeredQuestions);
    }
  }

  // ── Helper Methods ────────────────────────────────────────────────────────

  _parseJSON(text) {
    try {
      // Try direct parse
      return JSON.parse(text);
    } catch {
      // Try extracting from markdown code block
      const match = text.match(/```(?:json)?\s*(\{[\s\S]*\})\s*```/);
      if (match) {
        try {
          return JSON.parse(match[1]);
        } catch {
          return null;
        }
      }
      // Try finding first JSON object
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        try {
          return JSON.parse(jsonMatch[0]);
        } catch {
          return null;
        }
      }
      return null;
    }
  }

  _scoreToGrade(score) {
    if (score >= 90) return 'A';
    if (score >= 80) return 'B';
    if (score >= 70) return 'C';
    if (score >= 60) return 'D';
    return 'F';
  }

  _getFallbackQuestions(role, skills, count) {
    const templates = [
      {
        type: 'technical',
        question: `Explain your experience with ${skills}`,
        followUp: 'Can you describe a specific project where you used this?',
        difficulty: 'medium',
        skill: skills,
        expectedPoints: ['Practical experience', 'Specific examples', 'Problem-solving'],
        timeLimit: 120
      },
      {
        type: 'behavioral',
        question: 'Tell me about a challenging project you worked on',
        followUp: 'What would you do differently next time?',
        difficulty: 'medium',
        skill: 'Problem Solving',
        expectedPoints: ['Challenge description', 'Your approach', 'Outcome'],
        timeLimit: 180
      },
      {
        type: 'technical',
        question: `What are the key concepts in ${skills}?`,
        followUp: 'How would you explain this to a beginner?',
        difficulty: 'easy',
        skill: skills,
        expectedPoints: ['Core concepts', 'Clear explanation', 'Examples'],
        timeLimit: 120
      },
      {
        type: 'system-design',
        question: `How would you design a system using ${skills}?`,
        followUp: 'What would be your scalability considerations?',
        difficulty: 'hard',
        skill: skills,
        expectedPoints: ['Architecture', 'Scalability', 'Trade-offs'],
        timeLimit: 300
      },
      {
        type: 'behavioral',
        question: 'How do you stay updated with new technologies?',
        followUp: 'What have you learned recently?',
        difficulty: 'easy',
        skill: 'Learning Agility',
        expectedPoints: ['Learning methods', 'Recent learning', 'Application'],
        timeLimit: 120
      }
    ];

    return templates.slice(0, count).map((q, i) => ({
      ...q,
      id: i + 1,
      askedAt: null,
      answeredAt: null,
      answer: null,
      score: null,
      feedback: null
    }));
  }

  _getFallbackEvaluation(question, answer) {
    const wordCount = answer.trim().split(/\s+/).length;
    const hasKeywords = question.expectedPoints?.some(point => 
      answer.toLowerCase().includes(point.toLowerCase())
    ) || false;

    let score = 50; // Base score
    if (wordCount > 50) score += 10;
    if (wordCount > 100) score += 10;
    if (hasKeywords) score += 20;
    if (answer.length > 200) score += 10;

    score = Math.min(100, score);

    return {
      score,
      grade: this._scoreToGrade(score),
      strengths: wordCount > 50 ? ['Detailed response', 'Good length'] : ['Response provided'],
      weaknesses: wordCount < 50 ? ['Could be more detailed'] : [],
      feedback: 'Your response shows understanding. Consider adding more specific examples.',
      askFollowUp: score >= 70,
      followUpReason: score >= 70 ? 'Good answer, let\'s go deeper' : '',
      overallImpression: score >= 70 ? 'Solid response' : 'Needs more detail',
      evaluatedAt: new Date().toISOString(),
      source: 'rule-based'
    };
  }

  _getFallbackReport(avgScore, questions) {
    const grade = this._scoreToGrade(avgScore);
    let readiness = 'Not Ready';
    if (avgScore >= 80) readiness = 'Ready';
    else if (avgScore >= 70) readiness = 'Almost Ready';
    else if (avgScore >= 60) readiness = 'Needs Practice';

    return {
      overallScore: avgScore,
      grade,
      readiness,
      summary: `You scored ${avgScore}/100 across ${questions.length} questions. ${readiness} for interviews.`,
      strengths: avgScore >= 70 ? ['Good communication', 'Technical knowledge'] : ['Participated in interview'],
      areasToImprove: avgScore < 70 ? ['Technical depth', 'Specific examples', 'Clarity'] : ['Advanced concepts'],
      recommendations: [
        'Practice more technical questions',
        'Prepare specific project examples',
        'Study system design patterns'
      ],
      nextSteps: [
        'Review weak areas',
        'Practice with peers',
        'Build portfolio projects'
      ],
      estimatedReadiness: avgScore >= 80 ? 'Ready now' : avgScore >= 70 ? '2-3 weeks' : '1-2 months',
      totalQuestions: questions.length,
      answeredQuestions: questions.length,
      completionRate: 100,
      generatedAt: new Date().toISOString()
    };
  }
}

export default new InterviewAgent();
