/**
 * routes/modules.js
 * Module management routes - Supabase integrated
 */

import express from 'express';
import { authenticate } from '../middleware/auth.js';
import * as db from '../db/store.js';

const router = express.Router();

/**
 * GET /api/modules
 * Get all modules (with pagination and filtering) - from Supabase or file fallback
 */
router.get('/', authenticate, async (req, res) => {
  try {
    const { category, difficulty, limit = 50, offset = 0 } = req.query;
    const filters = {};
    if (category) filters.category = category;
    if (difficulty) filters.difficulty = difficulty;

    const modules = await db.getModules(filters);
    const total = modules.length;
    const paginated = modules.slice(parseInt(offset), parseInt(offset) + parseInt(limit));

    res.json({
      success: true,
      data: {
        modules: paginated,
        total,
        count: paginated.length,
        offset: parseInt(offset),
        limit: parseInt(limit),
      },
    });
  } catch (error) {
    console.error('Error fetching modules:', error);
    res.status(500).json({
      success: false,
      error: { message: 'Failed to fetch modules' },
    });
  }
});

/**
 * GET /api/modules/:id
 * Get single module by ID (includes full content)
 */
router.get('/:id', authenticate, async (req, res) => {
  try {
    const { id } = req.params;
    const module = await db.getModuleById(id);

    if (!module) {
      return res.status(404).json({
        success: false,
        error: { message: 'Module not found' },
      });
    }

    res.json({
      success: true,
      data: module,
    });
  } catch (error) {
    console.error('Error fetching module:', error);
    res.status(500).json({
      success: false,
      error: { message: 'Failed to fetch module' },
    });
  }
});

/**
 * POST /api/modules
 * Create new module (admin only) - persists to Supabase
 */
router.post('/', authenticate, async (req, res) => {
  try {
    const user = req.user;
    
    // Check authorization
    if (user.role !== 'admin' && user.role !== 'manager') {
      return res.status(403).json({
        success: false,
        error: { message: 'Only admins and managers can create modules' },
      });
    }

    const { title, description, category, difficulty, estimatedDuration, skills, tasks, resources, completionCriteria, content } = req.body;

    // Validate required fields — only title is strictly required
    if (!title) {
      return res.status(400).json({
        success: false,
        error: { message: 'Module title is required' },
      });
    }

    const newModule = await db.createModule({
      title,
      description: description || `Learn ${title}`,
      category: category || 'General',
      difficulty: difficulty || 'beginner',
      estimatedDuration: estimatedDuration || '7 days',
      skills: skills || [],
      tasks: tasks || [],
      resources: resources || [],
      completionCriteria: completionCriteria || 'Complete all tasks',
      progressTracking: true,
      content: content || {},           // ← Full generated data (roadmap, sessions, quizzes, notes)
    }, user.userId || user.id);

    res.status(201).json({
      success: true,
      data: newModule,
    });
  } catch (error) {
    console.error('Error creating module:', error);
    res.status(500).json({
      success: false,
      error: { message: 'Failed to create module' },
    });
  }
});

/**
 * PUT /api/modules/:id
 * Update module (admin only) - persists to Supabase
 */
router.put('/:id', authenticate, async (req, res) => {
  try {
    const user = req.user;
    const { id } = req.params;

    // Check authorization
    if (user.role !== 'admin' && user.role !== 'manager') {
      return res.status(403).json({
        success: false,
        error: { message: 'Only admins and managers can update modules' },
      });
    }

    const updates = req.body;
    const updatedModule = await db.updateModule(id, updates);

    if (!updatedModule) {
      return res.status(404).json({
        success: false,
        error: { message: 'Module not found' },
      });
    }

    res.json({
      success: true,
      data: updatedModule,
    });
  } catch (error) {
    console.error('Error updating module:', error);
    res.status(500).json({
      success: false,
      error: { message: 'Failed to update module' },
    });
  }
});

/**
 * POST /api/modules/:id/generate-content
 * Use AI to generate full learning content for a module (sessions, roadmap, projects, resources)
 * All authenticated users can trigger this (employees need it when entering a module)
 */
router.post('/:id/generate-content', authenticate, async (req, res) => {
  try {
    const { id } = req.params;
    const module = await db.getModuleById(id);
    if (!module) {
      return res.status(404).json({ success: false, error: { message: 'Module not found' } });
    }

    const title = module.title || 'Learning Module';
    const description = module.description || '';
    const skills = Array.isArray(module.skills) ? module.skills : [];
    const difficulty = module.difficulty || 'intermediate';
    const durationStr = module.estimatedDuration || module.duration || '7 days';
    const daysMatch = durationStr.match(/(\d+)/);
    const numSessions = Math.min(Math.max(parseInt(daysMatch?.[1]) || 7, 3), 14);

    const systemPrompt = `You are an expert corporate learning and development specialist. Generate comprehensive, practical training content that employees can immediately apply in their work. Always return valid JSON.`;

    const userPrompt = `Create a complete learning curriculum for this corporate training module:

Module: "${title}"
Description: ${description}
Skills to develop: ${skills.join(', ') || 'Professional skills'}
Difficulty: ${difficulty}
Number of learning sessions/days: ${numSessions}

Generate a JSON object with exactly these fields:
{
  "sessions": [
    {
      "title": "Day N: <specific topic>",
      "description": "What this session covers and why it matters",
      "objective": "By end of this session, learner will be able to...",
      "topics": ["topic1", "topic2", "topic3"],
      "keyPoints": [
        "Key insight 1 — be specific and actionable",
        "Key insight 2",
        "Key insight 3",
        "Key insight 4",
        "Key insight 5"
      ],
      "definitions": [
        {"term": "Technical term", "definition": "Clear explanation"},
        {"term": "Another term", "definition": "Explanation"}
      ],
      "explanation": "2-3 paragraphs of detailed explanation covering the session content. Include real-world context, why it matters in corporate settings, and practical applications.",
      "notes": "Additional tips, warnings, best practices, and common mistakes to avoid.",
      "duration": "45 min"
    }
  ],
  "roadmap": [
    {"title": "Phase name", "description": "What this phase achieves", "duration": "Days 1-3"},
    {"title": "Phase name", "description": "What this phase achieves", "duration": "Days 4-6"},
    {"title": "Phase name", "description": "What this phase achieves", "duration": "Days 7+"}
  ],
  "projects": [
    {"title": "Hands-on project title", "description": "Detailed project description and deliverables", "difficulty": "${difficulty}"},
    {"title": "Another project", "description": "Description", "difficulty": "advanced"}
  ],
  "resources": [
    {"title": "Resource name", "type": "article/video/book/tool", "description": "Why this resource is valuable"},
    {"title": "Another resource", "type": "tool", "description": "How to use it"}
  ]
}

IMPORTANT:
- Create exactly ${numSessions} sessions
- Each session must cover SPECIFIC topics related to "${title}" — not generic learning advice
- Sessions should build progressively in complexity
- keyPoints must be factual statements about the subject matter
- definitions must be real technical/domain terms from the field
- explanation should read like a knowledgeable mentor explaining the topic`;

    let generated = null;

    // Try Gemini first
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
              contents: [{ parts: [{ text: systemPrompt + '\n\n' + userPrompt }] }],
              generationConfig: { temperature: 0.7, maxOutputTokens: 8000, responseMimeType: 'application/json' },
            }),
            signal: AbortSignal.timeout(60000),
          }
        );
        if (geminiRes.ok) {
          const geminiData = await geminiRes.json();
          const text = geminiData.candidates?.[0]?.content?.parts?.[0]?.text;
          if (text) {
            const parsed = JSON.parse(text);
            if (parsed.sessions && Array.isArray(parsed.sessions) && parsed.sessions.length > 0) {
              generated = parsed;
            }
          }
        }
      }
    } catch (err) {
      console.warn('[modules/generate-content] Gemini failed:', err.message);
    }

    // Fallback to Groq
    if (!generated) {
      try {
        const groqKey = process.env.GROQ_API_KEY;
        if (groqKey && groqKey.length > 10) {
          const groqRes = await fetch('https://api.groq.com/openai/v1/chat/completions', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${groqKey}` },
            body: JSON.stringify({
              model: 'llama-3.3-70b-versatile',
              messages: [{ role: 'system', content: systemPrompt }, { role: 'user', content: userPrompt }],
              temperature: 0.7,
              max_tokens: 6000,
              response_format: { type: 'json_object' },
            }),
            signal: AbortSignal.timeout(60000),
          });
          if (groqRes.ok) {
            const groqData = await groqRes.json();
            const text = groqData.choices?.[0]?.message?.content;
            if (text) {
              const parsed = JSON.parse(text);
              if (parsed.sessions && Array.isArray(parsed.sessions) && parsed.sessions.length > 0) {
                generated = parsed;
              }
            }
          }
        }
      } catch (err) {
        console.warn('[modules/generate-content] Groq failed:', err.message);
      }
    }

    // Structured fallback if AI unavailable
    if (!generated) {
      const sessionTopics = skills.length > 0 ? skills : [title];
      generated = {
        sessions: Array.from({ length: numSessions }, (_, i) => {
          const topicIdx = i % sessionTopics.length;
          const topicName = sessionTopics[topicIdx] || title;
          return {
            title: `Day ${i + 1}: ${topicName} ${i === 0 ? 'Fundamentals' : i < numSessions / 2 ? 'Core Concepts' : 'Advanced Application'}`,
            description: `Deep dive into ${topicName} — covering practical techniques and real-world applications.`,
            objective: `Understand and apply ${topicName} concepts in professional scenarios.`,
            topics: [topicName, `${topicName} best practices`, `${topicName} in practice`],
            keyPoints: [
              `${topicName} is essential for ${title} professionals`,
              `Core ${topicName} principles follow established industry standards`,
              `Practical application of ${topicName} requires both theory and hands-on practice`,
              `Common ${topicName} mistakes can be avoided with proper understanding`,
              `${topicName} integrates with broader ${title} workflows`,
            ],
            definitions: [
              { term: topicName, definition: `A core component of ${title} that enables professionals to ${description || 'achieve business objectives'}.` },
              { term: `${topicName} framework`, definition: `The structured approach to implementing ${topicName} in organizational contexts.` },
            ],
            explanation: `${topicName} is a foundational element of ${title}. Understanding it deeply allows professionals to make better decisions and deliver higher quality outcomes.\n\nIn practice, ${topicName} is applied across various scenarios in corporate environments. Organizations that master ${topicName} see measurable improvements in efficiency, quality, and team performance.\n\nThis session builds your practical understanding through concrete examples and real-world case studies from industry leaders.`,
            notes: `• Focus on understanding the "why" behind each concept, not just the "how"\n• Try to connect these concepts to challenges you face in your current role\n• The quiz that follows will test your understanding of the specific topics covered here`,
            duration: '45 min',
          };
        }),
        roadmap: [
          { title: 'Foundation', description: `Establish core ${title} knowledge and vocabulary`, duration: `Days 1-${Math.ceil(numSessions / 3)}` },
          { title: 'Application', description: `Apply ${title} skills in controlled scenarios`, duration: `Days ${Math.ceil(numSessions / 3) + 1}-${Math.ceil(2 * numSessions / 3)}` },
          { title: 'Mastery', description: `Advanced ${title} techniques and independent practice`, duration: `Days ${Math.ceil(2 * numSessions / 3) + 1}-${numSessions}` },
        ],
        projects: [
          { title: `${title} Implementation Project`, description: `Apply everything you've learned to complete a real-world ${title} project from start to finish.`, difficulty },
          { title: `${title} Case Study Analysis`, description: `Analyze a real company's approach to ${title} and present your findings and recommendations.`, difficulty: 'intermediate' },
        ],
        resources: skills.slice(0, 3).map(skill => ({
          title: `${skill} — Official Documentation`,
          type: 'reference',
          description: `Comprehensive reference for ${skill} concepts and best practices`,
        })),
      };
    }

    // Save generated content to module
    const contentUpdate = {
      sessions: generated.sessions,
      roadmap: generated.roadmap || [],
      projects: generated.projects || [],
      resources: generated.resources || [],
      contentGeneratedAt: new Date().toISOString(),
    };

    await db.updateModule(id, {
      sessions: contentUpdate.sessions,
      content: {
        ...(module.content || {}),
        ...contentUpdate,
      },
    });

    const updatedModule = await db.getModuleById(id);
    res.json({ success: true, data: updatedModule });
  } catch (error) {
    console.error('[modules/generate-content] Error:', error);
    res.status(500).json({ success: false, error: { message: 'Failed to generate content: ' + error.message } });
  }
});

/**
 * DELETE /api/modules/:id
 * Delete module (admin only) - persists to Supabase
 */
router.delete('/:id', authenticate, async (req, res) => {
  try {
    const user = req.user;
    const { id } = req.params;

    // Check authorization
    if (user.role !== 'admin') {
      return res.status(403).json({
        success: false,
        error: { message: 'Only admins can delete modules' },
      });
    }

    const deleted = await db.deleteModule(id);

    if (!deleted) {
      return res.status(404).json({
        success: false,
        error: { message: 'Module not found' },
      });
    }

    res.json({
      success: true,
      message: 'Module deleted',
      data: { id },
    });
  } catch (error) {
    console.error('Error deleting module:', error);
    res.status(500).json({
      success: false,
      error: { message: 'Failed to delete module' },
    });
  }
});

export default router;
