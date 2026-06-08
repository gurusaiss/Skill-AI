/**
 * routes/modules.js
 * Module management routes - fully Supabase integrated
 * pending_modules + module_assignments → DataStore (Supabase / JSON fallback)
 * approved modules → db/store.js (Supabase)
 */

import express from 'express';
import { authenticate } from '../middleware/auth.js';
import * as db from '../db/store.js';
import UserStore from '../services/UserStore.js';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { randomUUID } from 'crypto';
import { PendingModules, ModuleAssignments } from '../services/DataStore.js';

const __moduleDir = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__moduleDir, '../data');

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

    const allModules = await db.getModules(filters);
    // Company isolation: filter modules by companyId
    const companyId = req.user?.companyId;
    const modules = (companyId && companyId !== 'default')
      ? allModules.filter(m => !m.companyId || m.companyId === companyId)
      : allModules;
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
    res.status(500).json({ success: false, error: { message: 'Failed to fetch modules' } });
  }
});

/**
 * GET /api/modules/pending
 * Admin/Manager: get all pending auto-generated modules awaiting approval
 * NOTE: must be before /:id
 */
router.get('/pending', authenticate, async (req, res) => {
  try {
    if (!['admin', 'manager'].includes(req.user.role)) {
      return res.status(403).json({ success: false, error: { message: 'Admin/Manager only' } });
    }
    const all = await PendingModules.getAll();
    const companyId = req.user?.companyId;
    const pendings = all.filter(p =>
      p.status === 'pending_approval' &&
      (!companyId || companyId === 'default' || !p.companyId || p.companyId === companyId)
    );
    res.json({ success: true, data: pendings, error: null });
  } catch (e) {
    res.status(500).json({ success: false, error: { message: 'Failed to fetch pending modules' } });
  }
});

/**
 * GET /api/modules/my-assignments
 * Employee: get all modules assigned to them (mandatory + optional)
 * NOTE: must be before /:id
 */
router.get('/my-assignments', authenticate, async (req, res) => {
  try {
    const all = await ModuleAssignments.getAll();
    const assignments = all.filter(a => a.userId === req.user.userId);
    const enriched = await Promise.all(assignments.map(async a => {
      const mod = await db.getModuleById(a.moduleId).catch(() => null);
      return { ...a, module: mod };
    }));
    res.json({ success: true, data: enriched, error: null });
  } catch (e) {
    res.status(500).json({ success: false, error: { message: 'Failed to fetch assignments' } });
  }
});

/**
 * GET /api/modules/assignments/all
 * Admin/Manager: all module assignments with progress
 * NOTE: must be before /:id
 */
router.get('/assignments/all', authenticate, async (req, res) => {
  try {
    if (!['admin', 'manager'].includes(req.user.role)) {
      return res.status(403).json({ success: false, error: { message: 'Admin/Manager only' } });
    }
    const assignments = await ModuleAssignments.getAll();
    const companyId = req.user?.companyId || 'default';

    if (companyId === 'default') {
      return res.json({ success: true, data: assignments, error: null });
    }

    // Filter by company user membership
    const UserStore = (await import('../services/UserStore.js')).default;
    const allUsers = await UserStore.getAllUsers({});
    const companyUserIds = new Set(
      allUsers
        .filter(u => (u.companyId || 'default') === companyId)
        .map(u => u.userId || u.id)
    );
    const filtered = assignments.filter(a => companyUserIds.has(a.userId || a.assigned_to_user));
    res.json({ success: true, data: filtered, error: null });
  } catch (e) {
    res.status(500).json({ success: false, error: { message: 'Failed to fetch' } });
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
      return res.status(404).json({ success: false, error: { message: 'Module not found' } });
    }

    res.json({ success: true, data: module });
  } catch (error) {
    console.error('Error fetching module:', error);
    res.status(500).json({ success: false, error: { message: 'Failed to fetch module' } });
  }
});

/**
 * POST /api/modules
 * Create new module (admin/manager) - persists to Supabase
 */
router.post('/', authenticate, async (req, res) => {
  try {
    const user = req.user;

    if (user.role !== 'admin' && user.role !== 'manager') {
      return res.status(403).json({ success: false, error: { message: 'Only admins and managers can create modules' } });
    }

    const { title, description, category, difficulty, estimatedDuration, skills, tasks, resources, completionCriteria, content } = req.body;

    if (!title) {
      return res.status(400).json({ success: false, error: { message: 'Module title is required' } });
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
      content: content || {},
      companyId: req.user.companyId || null,
    }, user.userId || user.id);

    res.status(201).json({ success: true, data: newModule });
  } catch (error) {
    console.error('Error creating module:', error);
    res.status(500).json({ success: false, error: { message: 'Failed to create module' } });
  }
});

/**
 * PUT /api/modules/:id
 * Update module (admin/manager) - persists to Supabase
 */
router.put('/:id', authenticate, async (req, res) => {
  try {
    const user = req.user;
    const { id } = req.params;

    if (user.role !== 'admin' && user.role !== 'manager') {
      return res.status(403).json({ success: false, error: { message: 'Only admins and managers can update modules' } });
    }

    const updatedModule = await db.updateModule(id, req.body);

    if (!updatedModule) {
      return res.status(404).json({ success: false, error: { message: 'Module not found' } });
    }

    res.json({ success: true, data: updatedModule });
  } catch (error) {
    console.error('Error updating module:', error);
    res.status(500).json({ success: false, error: { message: 'Failed to update module' } });
  }
});

/**
 * POST /api/modules/:id/generate-content
 * Use AI to generate full learning content for a module
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

    // Save generated content to module via Supabase
    await db.updateModule(id, {
      sessions: generated.sessions,
      content: {
        ...(module.content || {}),
        sessions: generated.sessions,
        roadmap: generated.roadmap || [],
        projects: generated.projects || [],
        resources: generated.resources || [],
        contentGeneratedAt: new Date().toISOString(),
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

    if (user.role !== 'admin') {
      return res.status(403).json({ success: false, error: { message: 'Only admins can delete modules' } });
    }

    const deleted = await db.deleteModule(id);

    if (!deleted) {
      return res.status(404).json({ success: false, error: { message: 'Module not found' } });
    }

    res.json({ success: true, message: 'Module deleted', data: { id } });
  } catch (error) {
    console.error('Error deleting module:', error);
    res.status(500).json({ success: false, error: { message: 'Failed to delete module' } });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// AUTO-GENERATED MODULES FROM ASSESSMENT REPORT
// ─────────────────────────────────────────────────────────────────────────────

/**
 * POST /api/modules/auto-generate
 * Auto-generate a module from an assessment report — stored as PENDING (needs approval)
 */
router.post('/auto-generate', authenticate, async (req, res) => {
  try {
    if (!['admin', 'manager'].includes(req.user.role)) {
      return res.status(403).json({ success: false, error: { message: 'Admin/Manager only' } });
    }

    const { assessmentReportId, userId, jobRole, weakAreas = [], assessmentTitle } = req.body;
    if (!userId) return res.status(400).json({ success: false, error: { message: 'userId required' } });

    const user = await UserStore.getUserById(userId);
    const skills = Array.isArray(weakAreas) && weakAreas.length > 0 ? weakAreas : ['Core Skills'];

    let jdContext = user?.jobDescription || '';
    if (!jdContext && user?.jobDescriptionFile?.path) {
      try {
        const { parseJDFile } = await import('../utils/parseJDFile.js');
        jdContext = (await parseJDFile(user.jobDescriptionFile.path, user.jobDescriptionFile.name || '')).slice(0, 2000);
      } catch {}
    }

    let moduleContent = null;
    try {
      const groqKey = process.env.GROQ_API_KEY;
      if (groqKey?.length > 10) {
        const prompt = `Create a focused training module for an employee who needs improvement in these areas:
Role: ${jobRole || 'Employee'}
Weak areas from assessment: ${skills.join(', ')}
Assessment: ${assessmentTitle || 'Role Assessment'}
${jdContext ? `Job Description context:\n${jdContext.slice(0, 800)}` : ''}

Create a comprehensive training module with 3-5 sessions. Each session should have:
- Clear title and learning objectives
- Key topics to cover
- A short quiz (3 MCQ questions) to verify understanding

Return JSON:
{
  "title": "string",
  "description": "string",
  "objectives": ["string"],
  "estimatedDuration": "X days",
  "sessions": [
    {
      "title": "string",
      "duration": "30 mins",
      "topics": ["string"],
      "keyPoints": ["string"],
      "quiz": [
        {
          "question": "string",
          "options": ["A) ...", "B) ...", "C) ...", "D) ..."],
          "answer": "A",
          "explanation": "string"
        }
      ]
    }
  ]
}`;
        const r = await fetch('https://api.groq.com/openai/v1/chat/completions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${groqKey}` },
          body: JSON.stringify({ model: 'llama-3.3-70b-versatile', messages: [{ role: 'user', content: prompt }], temperature: 0.7, max_tokens: 3000, response_format: { type: 'json_object' } }),
          signal: AbortSignal.timeout(30000),
        });
        if (r.ok) {
          const d = await r.json();
          moduleContent = JSON.parse(d.choices?.[0]?.message?.content || '{}');
        }
      }
    } catch (e) { console.warn('[auto-generate] AI failed:', e.message); }

    const pending = {
      id: randomUUID(),
      type: 'auto_generated',
      isMandatory: true,
      status: 'pending_approval',
      targetUserId: userId,
      targetUserName: user?.name || '',
      jobRole: jobRole || '',
      assessmentReportId: assessmentReportId || null,
      assessmentTitle: assessmentTitle || '',
      weakAreas: skills,
      module: {
        title: moduleContent?.title || `Remedial Training: ${skills[0]}`,
        description: moduleContent?.description || `Targeted training for ${jobRole} covering ${skills.join(', ')}`,
        category: jobRole || 'Training',
        difficulty: 'intermediate',
        estimatedDuration: moduleContent?.estimatedDuration || '5 days',
        skills,
        objectives: moduleContent?.objectives || [`Improve ${skills.join(', ')} skills`],
        sessions: moduleContent?.sessions || skills.map(s => ({ title: s, topics: [s], duration: '30 mins' })),
        isMandatory: true,
      },
      createdAt: new Date().toISOString(),
      createdBy: req.user.userId,
    };

    // Persist to Supabase via DataStore
    const saved = await PendingModules.create(pending);
    res.status(201).json({ success: true, data: saved || pending, error: null });
  } catch (e) {
    console.error('[POST /modules/auto-generate]', e);
    res.status(500).json({ success: false, error: { message: 'Failed to auto-generate module' } });
  }
});

/**
 * POST /api/modules/pending/:id/approve
 * Approve a pending module → creates the real module + assigns to employee
 */
router.post('/pending/:id/approve', authenticate, async (req, res) => {
  try {
    if (!['admin', 'manager'].includes(req.user.role)) {
      return res.status(403).json({ success: false, error: { message: 'Admin/Manager only' } });
    }

    const pending = await PendingModules.getById(req.params.id);
    if (!pending) return res.status(404).json({ success: false, error: { message: 'Pending module not found' } });

    // Create the real module in Supabase
    const newModule = await db.createModule({
      title: pending.module.title,
      description: pending.module.description,
      category: pending.module.category,
      difficulty: pending.module.difficulty,
      estimatedDuration: pending.module.estimatedDuration,
      skills: pending.module.skills,
      tasks: pending.module.sessions?.map(s => ({ title: s.title, duration: s.duration, type: 'session' })) || [],
      resources: [],
      completionCriteria: 'Complete all sessions',
      progressTracking: true,
      content: {
        isMandatory: true,
        sessions: pending.module.sessions,
        objectives: pending.module.objectives,
        assessmentSource: pending.assessmentReportId,
      },
    }, req.user.userId);

    const moduleId = newModule.id || newModule;

    // Write module assignment to Supabase via DataStore
    const moduleAssignment = {
      id: randomUUID(),
      moduleId,
      userId: pending.targetUserId,
      isMandatory: true,
      assignedAt: new Date().toISOString(),
      assignedBy: req.user.userId,
      status: 'assigned',
    };
    await ModuleAssignments.create(moduleAssignment);

    // Also write to main assignments system (visible on Employee dashboard)
    try {
      const moduleTitle = pending.module.title || `Training: ${pending.weakAreas?.[0] || pending.jobRole || 'Skills'}`;
      await UserStore.createAssignment({
        type: 'module',
        assignable_id: moduleId,
        assignable_type: 'module',
        assigned_by: req.user.userId,
        assigned_to_user: pending.targetUserId,
        priority: 'high',
        status: 'assigned',
        progress: 0,
        isMandatory: true,
        title: moduleTitle,
        name: moduleTitle,
        module_name: moduleTitle,
        description: pending.module.description || '',
        moduleRef: {
          id: moduleId,
          title: moduleTitle,
          skills: pending.module.skills || [],
          estimatedDuration: pending.module.estimatedDuration || '5 days',
        },
      });
    } catch (e) {
      console.warn('[modules/approve] Could not write to main assignments:', e.message);
    }

    // Mark pending as approved in Supabase
    await PendingModules.update(req.params.id, {
      status: 'approved',
      approvedAt: new Date().toISOString(),
      approvedBy: req.user.userId,
      moduleId,
    });

    res.json({ success: true, data: { module: newModule, assignment: moduleAssignment }, error: null });
  } catch (e) {
    console.error('[POST /modules/pending/:id/approve]', e);
    res.status(500).json({ success: false, error: { message: 'Failed to approve module' } });
  }
});

/**
 * POST /api/modules/pending/:id/reject
 * Reject a pending module
 */
router.post('/pending/:id/reject', authenticate, async (req, res) => {
  try {
    if (!['admin', 'manager'].includes(req.user.role)) {
      return res.status(403).json({ success: false, error: { message: 'Admin/Manager only' } });
    }
    const pending = await PendingModules.getById(req.params.id);
    if (!pending) return res.status(404).json({ success: false, error: { message: 'Not found' } });

    const updated = await PendingModules.update(req.params.id, {
      status: 'rejected',
      rejectedAt: new Date().toISOString(),
      rejectedBy: req.user.userId,
      reason: req.body.reason || '',
    });
    res.json({ success: true, data: updated || pending, error: null });
  } catch (e) {
    res.status(500).json({ success: false, error: { message: 'Failed to reject' } });
  }
});

/**
 * POST /api/modules/assign
 * Manually assign modules to users or groups
 */
router.post('/assign', authenticate, async (req, res) => {
  try {
    if (!['admin', 'manager'].includes(req.user.role)) {
      return res.status(403).json({ success: false, error: { message: 'Admin/Manager only' } });
    }

    const { moduleIds = [], targetUserIds = [], targetGroupId, isMandatory = false } = req.body;
    if (!moduleIds.length) return res.status(400).json({ success: false, error: { message: 'At least one module required' } });

    let allUserIds = [...targetUserIds];

    // Resolve group members via Supabase (or file fallback)
    if (targetGroupId) {
      try {
        const memberships = await db.getGroupMemberships(targetGroupId);
        const memberIds = memberships.map(m => m.user_id || m.userId).filter(Boolean);
        allUserIds = [...new Set([...allUserIds, ...memberIds])];
      } catch { /* skip */ }
    }

    const existingAssignments = await ModuleAssignments.getAll();
    const created = [];

    for (const userId of allUserIds) {
      for (const moduleId of moduleIds) {
        // Skip duplicates
        const exists = existingAssignments.some(a => a.moduleId === moduleId && a.userId === userId);
        if (exists) continue;

        const assignment = {
          id: randomUUID(),
          moduleId,
          userId,
          isMandatory: !!isMandatory,
          assignedAt: new Date().toISOString(),
          assignedBy: req.user.userId,
          status: 'assigned',
        };
        await ModuleAssignments.create(assignment);
        created.push(assignment);
      }
    }

    res.json({ success: true, data: { assigned: created.length, assignments: created }, error: null });
  } catch (e) {
    console.error('[POST /modules/assign]', e);
    res.status(500).json({ success: false, error: { message: 'Assignment failed' } });
  }
});

export default router;
