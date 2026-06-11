/**
 * recommendations.js — Node.js proxy to Python rec-engine
 *
 * Rules (non-negotiable):
 *  - No new LLM calls
 *  - Recommendations cached 6h per user in LLMCache
 *  - Python service NOT exposed publicly; only this route calls it
 *  - Auth required on all endpoints
 */

import express from 'express';
import { authenticate } from '../middleware/auth.js';
import LLMCache from '../services/LLMCache.js';

const router = express.Router();

const REC_ENGINE_URL = process.env.REC_ENGINE_URL || 'http://localhost:8001';
const REC_CACHE_TTL  = 6 * 60 * 60 * 1000; // 6 hours

// ── Internal helper: call rec-engine with timeout ─────────────────────────────
async function callRecEngine(path, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000); // 8s timeout
  try {
    const res = await fetch(`${REC_ENGINE_URL}${path}`, {
      ...options,
      signal: controller.signal,
      headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
    });
    clearTimeout(timer);
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`rec-engine ${res.status}: ${text.slice(0, 120)}`);
    }
    return await res.json();
  } catch (err) {
    clearTimeout(timer);
    throw err;
  }
}

// ── GET /api/recommendations — top-5 skills for the authenticated user ────────
router.get('/', authenticate, async (req, res) => {
  const userId = req.user.userId;

  // 6h cache per user
  const cacheKey = `rec_${LLMCache.hash(userId)}`;
  const cached   = LLMCache.get(cacheKey);
  if (cached) {
    return res.json({ success: true, data: { ...cached, fromCache: true } });
  }

  try {
    const data = await callRecEngine('/recommend', {
      method : 'POST',
      body   : JSON.stringify({ user_id: userId, top_k: 5 }),
    });

    LLMCache.set(cacheKey, data, REC_CACHE_TTL);
    return res.json({ success: true, data });
  } catch (err) {
    // Graceful degradation — return empty list, don't break dashboard
    console.warn('[recommendations] rec-engine unreachable:', err.message);
    return res.json({
      success: true,
      data: {
        user_id         : userId,
        recommendations : [],
        generated_at    : new Date().toISOString(),
        model_version   : null,
        unavailable     : true,
      },
    });
  }
});

// ── POST /api/recommendations/interaction — log a skill interaction ───────────
router.post('/interaction', authenticate, async (req, res) => {
  const { skillId, engagementScore = 0.5, interactionType = 'view' } = req.body;
  const userId = req.user.userId;

  if (!skillId) return res.status(400).json({ success: false, error: 'skillId required' });

  // Invalidate cache so next request gets fresh recs
  LLMCache.delete?.(`rec_${LLMCache.hash(userId)}`);

  try {
    await callRecEngine('/interaction', {
      method: 'POST',
      body  : JSON.stringify({
        user_id         : userId,
        skill_id        : skillId,
        engagement_score: Math.min(1, Math.max(0, Number(engagementScore))),
        interaction_type: interactionType,
      }),
    });
  } catch (err) {
    console.warn('[recommendations] interaction log failed:', err.message);
    // Non-fatal — don't fail the response
  }

  return res.json({ success: true, data: { logged: true } });
});

// ── POST /api/recommendations/exclude — mark skill as "Not Interested" ────────
router.post('/exclude', authenticate, async (req, res) => {
  const { skillId } = req.body;
  const userId = req.user.userId;

  if (!skillId) return res.status(400).json({ success: false, error: 'skillId required' });

  // Bust cache so excluded skill disappears on next load
  LLMCache.delete?.(`rec_${LLMCache.hash(userId)}`);

  try {
    await callRecEngine('/exclude', {
      method: 'POST',
      body  : JSON.stringify({ user_id: userId, skill_id: skillId }),
    });
  } catch (err) {
    console.warn('[recommendations] exclude failed:', err.message);
  }

  return res.json({ success: true, data: { excluded: true } });
});

// ── GET /api/recommendations/metrics — latest ML evaluation metrics ───────────
router.get('/metrics', authenticate, async (req, res) => {
  const cacheKey = 'rec_metrics_latest';
  const cached   = LLMCache.get(cacheKey);
  if (cached) return res.json({ success: true, data: cached });

  try {
    const data = await callRecEngine('/metrics');
    LLMCache.set(cacheKey, data, 30 * 60 * 1000); // 30-min cache for metrics
    return res.json({ success: true, data });
  } catch (err) {
    return res.json({
      success: true,
      data: {
        precision_at_5: 0,
        recall_at_5   : 0,
        ndcg_at_10    : 0,
        coverage      : 0,
        unavailable   : true,
      },
    });
  }
});

// ── GET /api/recommendations/health — rec-engine health (admin only) ──────────
router.get('/health', authenticate, async (req, res) => {
  if (req.user.role !== 'admin' && req.user.role !== 'superadmin') {
    return res.status(403).json({ success: false, error: 'Admin only' });
  }
  try {
    const data = await callRecEngine('/health');
    return res.json({ success: true, data });
  } catch (err) {
    return res.json({ success: true, data: { status: 'offline', error: err.message } });
  }
});

export default router;
