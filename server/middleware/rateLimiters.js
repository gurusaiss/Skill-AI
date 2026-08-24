/**
 * rateLimiters.js — shared Express rate limiters.
 *
 * llmLimiter exists to protect genuinely expensive LLM-generation endpoints
 * (goal decomposition, assessment generation) from being hammered. It was
 * previously applied with `app.use('/api/goal', llmLimiter)` and
 * `app.use('/api/assessments', llmLimiter)` in index.js — a blanket
 * per-ROUTER mount that caught every route under those paths, including
 * high-frequency, zero-LLM-cost routes employees hit constantly:
 *   - GET  /api/goal/:userId        (loaded on every dashboard visit)
 *   - GET  /api/assessments/my      (an employee's assigned assessments)
 *   - GET  /api/assessments/:id     (opening an assessment to take it)
 *   - POST /api/assessments/:id/submit (submitting answers)
 *   - POST /api/assessments/parse-questionnaire (Excel parsing, no LLM at all)
 *
 * At real concurrency this is a genuine outage risk, not a theoretical one:
 * the limiter keys by IP, and this product's target customers are 200-5,000-
 * employee companies whose staff typically share ONE outbound IP behind a
 * corporate NAT/proxy. Ten requests per minute from an entire office taking
 * assessments simultaneously is exhausted almost instantly, at which point
 * unrelated employees doing completely free operations start getting
 * `429 LLM rate limit` errors on requests that never touched an LLM.
 *
 * Fix: this limiter is now applied directly to only the specific route
 * definitions that actually call an LLM (see goal.js's POST '/' and
 * assessment.js's POST '/generate' and '/generate-from-jd'), not mounted
 * per-router.
 */
import rateLimit from 'express-rate-limit';

export const llmLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (_req, res) => res.status(429).json({ success: false, error: 'LLM rate limit — max 10 generations per minute.' }),
});
