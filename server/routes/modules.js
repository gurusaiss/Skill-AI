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

    // Validate required fields
    if (!title || !description || !category) {
      return res.status(400).json({
        success: false,
        error: { message: 'Missing required fields' },
      });
    }

    const newModule = await db.createModule({
      title,
      description,
      category,
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
