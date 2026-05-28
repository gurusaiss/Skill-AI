import express from 'express';
import { authenticate, requireRole } from '../middleware/auth.js';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { randomUUID } from 'crypto';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const router = express.Router();
const ASSESSMENTS_FILE = join(__dirname, '../data/assessments.json');

// Initialize assessments file if it doesn't exist
if (!existsSync(ASSESSMENTS_FILE)) {
  writeFileSync(ASSESSMENTS_FILE, JSON.stringify([], null, 2));
}

// Helper function to read assessments
const readAssessments = () => {
  try {
    return JSON.parse(readFileSync(ASSESSMENTS_FILE, 'utf-8'));
  } catch (error) {
    console.error('Error reading assessments file:', error);
    return [];
  }
};

// Helper function to write assessments
const writeAssessments = (assessments) => {
  try {
    writeFileSync(ASSESSMENTS_FILE, JSON.stringify(assessments, null, 2));
  } catch (error) {
    console.error('Error writing assessments file:', error);
    throw error;
  }
};

/**
 * GET /api/assessments
 * Get all assessments (admin/manager only)
 */
router.get('/', authenticate, requireRole('admin', 'manager'), async (req, res) => {
  try {
    const assessments = readAssessments();
    res.json({
      success: true,
      data: assessments,
      error: null
    });
  } catch (error) {
    console.error('[GET /api/assessments]', error);
    res.status(500).json({
      success: false,
      data: null,
      error: error.message
    });
  }
});

/**
 * POST /api/assessments
 * Create a new assessment (admin/manager only)
 */
router.post('/', authenticate, requireRole('admin', 'manager'), async (req, res) => {
  try {
    const { title, description, questions, schedule, targetUsers, moduleId } = req.body;

    // Validate required fields (description is optional)
    if (!title || !questions || !Array.isArray(questions) || questions.length === 0) {
      return res.status(400).json({
        success: false,
        data: null,
        error: 'Title and at least one question are required'
      });
    }

    const assessments = readAssessments();

    const newAssessment = {
      id: randomUUID(),
      title,
      description: description || '',
      moduleId: moduleId || null,          // link to module
      questions,
      schedule: schedule || { type: 'manual' },
      targetUsers: targetUsers || ['all'],
      createdBy: req.user.userId,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      isActive: true
    };

    assessments.push(newAssessment);
    writeAssessments(assessments);

    res.json({
      success: true,
      data: newAssessment,
      error: null
    });
  } catch (error) {
    console.error('[POST /api/assessments]', error);
    res.status(500).json({
      success: false,
      data: null,
      error: error.message
    });
  }
});

/**
 * PUT /api/assessments/:id
 * Update an assessment (admin/manager only)
 */
router.put('/:id', authenticate, requireRole('admin', 'manager'), async (req, res) => {
  try {
    const { id } = req.params;
    const updates = req.body;

    const assessments = readAssessments();
    const assessmentIndex = assessments.findIndex(a => a.id === id);

    if (assessmentIndex === -1) {
      return res.status(404).json({
        success: false,
        data: null,
        error: 'Assessment not found'
      });
    }

    // Update the assessment
    assessments[assessmentIndex] = {
      ...assessments[assessmentIndex],
      ...updates,
      updatedAt: new Date().toISOString()
    };

    writeAssessments(assessments);

    res.json({
      success: true,
      data: assessments[assessmentIndex],
      error: null
    });
  } catch (error) {
    console.error('[PUT /api/assessments/:id]', error);
    res.status(500).json({
      success: false,
      data: null,
      error: error.message
    });
  }
});

/**
 * DELETE /api/assessments/:id
 * Delete an assessment (admin/manager only)
 */
router.delete('/:id', authenticate, requireRole('admin', 'manager'), async (req, res) => {
  try {
    const { id } = req.params;

    const assessments = readAssessments();
    const filteredAssessments = assessments.filter(a => a.id !== id);

    if (filteredAssessments.length === assessments.length) {
      return res.status(404).json({
        success: false,
        data: null,
        error: 'Assessment not found'
      });
    }

    writeAssessments(filteredAssessments);

    res.json({
      success: true,
      data: { id },
      error: null
    });
  } catch (error) {
    console.error('[DELETE /api/assessments/:id]', error);
    res.status(500).json({
      success: false,
      data: null,
      error: error.message
    });
  }
});

/**
 * GET /api/assessments/user/:userId
 * Get assessments available for a specific user
 */
router.get('/user/:userId', authenticate, async (req, res) => {
  try {
    const { userId } = req.params;

    // Authorization check: users can only access their own assessments, admins can access any
    if (req.user.role !== 'admin' && req.user.userId !== userId) {
      return res.status(403).json({
        success: false,
        data: null,
        error: 'Access denied: You can only access your own assessments'
      });
    }

    const assessments = readAssessments();
    const userAssessments = assessments.filter(assessment => {
      return assessment.isActive && (
        assessment.targetUsers.includes('all') ||
        assessment.targetUsers.includes(userId) ||
        assessment.targetUsers.includes(req.user.userId)
      );
    });

    res.json({
      success: true,
      data: userAssessments,
      error: null
    });
  } catch (error) {
    console.error('[GET /api/assessments/user/:userId]', error);
    res.status(500).json({
      success: false,
      data: null,
      error: error.message
    });
  }
});

/**
 * POST /api/assessments/:id/submit
 * Submit assessment responses
 */
router.post('/:id/submit', authenticate, async (req, res) => {
  try {
    const { id } = req.params;
    const { responses, userId } = req.body;

    // Authorization check: users can only submit their own assessments
    if (req.user.userId !== userId) {
      return res.status(403).json({
        success: false,
        data: null,
        error: 'Access denied: You can only submit your own assessments'
      });
    }

    const assessments = readAssessments();
    const assessment = assessments.find(a => a.id === id);

    if (!assessment) {
      return res.status(404).json({
        success: false,
        data: null,
        error: 'Assessment not found'
      });
    }

    // Here you would typically save the responses to a database
    // For now, we'll just return success
    const submission = {
      assessmentId: id,
      userId,
      responses,
      submittedAt: new Date().toISOString()
    };

    res.json({
      success: true,
      data: submission,
      error: null
    });
  } catch (error) {
    console.error('[POST /api/assessments/:id/submit]', error);
    res.status(500).json({
      success: false,
      data: null,
      error: error.message
    });
  }
});

/**
 * POST /api/assessments/generate
 * AI-generate assessment questions from module content (all authenticated users)
 */
router.post('/generate', authenticate, async (req, res) => {
  try {
    const { moduleTitle, moduleDescription, skills, numQuestions, questionTypes, sessionTitle, sessionTopics, sessionKeyPoints } = req.body;

    const num = Math.min(Math.max(parseInt(numQuestions) || 5, 2), 20);
    const types = Array.isArray(questionTypes) && questionTypes.length > 0 ? questionTypes : ['mcq'];

    const topicsStr = Array.isArray(sessionTopics) && sessionTopics.length > 0
      ? sessionTopics.join(', ')
      : (Array.isArray(skills) && skills.length > 0 ? skills.join(', ') : 'core concepts');
    const keyPointsStr = Array.isArray(sessionKeyPoints) && sessionKeyPoints.length > 0
      ? sessionKeyPoints.map((p, i) => `${i+1}. ${typeof p === 'string' ? p : (p.point || p.title || '')}`) .join('\n')
      : '';

    const context = [
      `Module: ${moduleTitle || 'Learning Module'}`,
      sessionTitle ? `Session: ${sessionTitle}` : '',
      `Topics: ${topicsStr}`,
      moduleDescription ? `Description: ${moduleDescription}` : '',
      keyPointsStr ? `Key Points:\n${keyPointsStr}` : '',
    ].filter(Boolean).join('\n');

    const prompt = `Generate exactly ${num} assessment questions SPECIFICALLY about these topics: ${topicsStr}.

${context}

CRITICAL: Every single question MUST test knowledge of the specific topics listed above. No generic learning strategy questions.

Question types: ${types.join(', ')}

Return a JSON object with a "questions" array. Each question:
- "type": "mcq", "subjective", or "fill_blank"
- "question": specific question about ${topicsStr}
- "difficulty": "easy", "medium", or "hard"
- "options": mcq only — array of 4 strings ["A) ...", "B) ...", "C) ...", "D) ..."]
- "answer": mcq: letter "A"/"B"/"C"/"D"; fill_blank: exact word/phrase; subjective: model answer
- "explanation": why this answer is correct

Difficulty mix: 30% easy, 50% medium, 20% hard.`;

    const system = `You are an expert corporate training assessment designer. Create high-quality questions that test real understanding and application, not just memorization. Always return valid JSON with exactly a "questions" array.`;

    let questions = null;

    // Try Groq first (free, fast)
    try {
      const groqKey = process.env.GROQ_API_KEY;
      if (groqKey && groqKey.length > 10) {
        const groqRes = await fetch('https://api.groq.com/openai/v1/chat/completions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${groqKey}` },
          body: JSON.stringify({
            model: 'llama-3.3-70b-versatile',
            messages: [{ role: 'system', content: system }, { role: 'user', content: prompt }],
            temperature: 0.7,
            max_tokens: 3000,
            response_format: { type: 'json_object' },
          }),
          signal: AbortSignal.timeout(30000),
        });
        if (groqRes.ok) {
          const groqData = await groqRes.json();
          const text = groqData.choices?.[0]?.message?.content;
          if (text) {
            const parsed = JSON.parse(text);
            if (parsed.questions && Array.isArray(parsed.questions)) {
              questions = parsed.questions;
            }
          }
        }
      }
    } catch (llmErr) {
      console.warn('[assessments/generate] Groq failed:', llmErr.message);
    }

    // Fallback to Gemini
    if (!questions) {
      try {
        const geminiKey = process.env.GEMINI_API_KEY;
        const geminiModel = process.env.GEMINI_MODEL || 'gemini-2.0-flash';
        if (geminiKey && geminiKey.length > 10) {
          const geminiRes = await fetch(
            `https://generativelanguage.googleapis.com/v1beta/models/${geminiModel}:generateContent?key=${geminiKey}`,
            {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                contents: [{ parts: [{ text: system + '\n\n' + prompt }] }],
                generationConfig: { temperature: 0.7, maxOutputTokens: 3000, responseMimeType: 'application/json' },
              }),
              signal: AbortSignal.timeout(30000),
            }
          );
          if (geminiRes.ok) {
            const geminiData = await geminiRes.json();
            const text = geminiData.candidates?.[0]?.content?.parts?.[0]?.text;
            if (text) {
              const parsed = JSON.parse(text);
              if (parsed.questions && Array.isArray(parsed.questions)) {
                questions = parsed.questions;
              }
            }
          }
        }
      } catch (llmErr) {
        console.warn('[assessments/generate] Gemini failed:', llmErr.message);
      }
    }

    // Rule-based fallback if both AI providers failed
    if (!questions || questions.length === 0) {
      const typeList = types;
      questions = Array.from({ length: num }, (_, i) => {
        const t = typeList[i % typeList.length];
        return {
          type: t,
          question: t === 'mcq'
            ? `Which of the following best describes a key concept in ${moduleTitle}?`
            : t === 'fill_blank'
            ? `The primary goal of ${moduleTitle} is to develop ______ skills.`
            : `Explain how the skills learned in ${moduleTitle} can be applied in a real-world scenario.`,
          difficulty: ['easy', 'medium', 'hard'][i % 3],
          options: t === 'mcq' ? ['A) Understanding core concepts', 'B) Memorizing definitions only', 'C) Skipping prerequisites', 'D) Avoiding practice'] : undefined,
          answer: t === 'mcq' ? 'A' : t === 'fill_blank' ? 'professional' : 'Apply the concepts systematically using learned frameworks.',
          explanation: 'This question tests practical understanding of the module objectives.',
        };
      });
    }

    res.json({ success: true, data: questions, error: null });
  } catch (error) {
    console.error('[POST /api/assessments/generate]', error);
    res.status(500).json({ success: false, data: null, error: error.message });
  }
});

export default router;