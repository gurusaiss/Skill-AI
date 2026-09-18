/**
 * assessment.js — JD + Job Role driven assessments
 * All data persisted to Supabase via DataStore (falls back to JSON files)
 *
 * Flow:
 * 1. Admin/Manager creates assessment → selects employee(s) or group
 * 2. System fetches employee's jobRole + JD from their profile
 * 3. AI generates UNIQUE questions per employee (even same JD → different questions via seed)
 * 4. Assessment assigned per employee
 * 5. Employee sees it on their assessment date
 * 6. Employee submits → report generated
 * 7. Report visible to employee + admin + manager
 */
import express from 'express';
import { authenticate, requireRole, requirePermission } from '../middleware/auth.js';
import { getEffectivePermissions } from '../services/permissions.js';
import { llmLimiter } from '../middleware/rateLimiters.js';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { randomUUID } from 'crypto';
import multer from 'multer';
import UserStore from '../services/UserStore.js';
import { Assessments, Submissions, Reports, RoleLibrary, ModuleAssignments, GeneratedContent, AssessmentThresholds, Groups, QuestionBankVersions, EmployeeAssessmentAssignments } from '../services/DataStore.js';
import * as db from '../db/store.js';
import { generateQuestionsFromJD } from '../services/AssessmentGenerator.js';
import { getApprovedBankCached } from '../services/QuestionBankCache.js';
import GeminiService from '../services/GeminiService.js';
import LLMCache from '../services/LLMCache.js';
import { generateSessionQuiz, ensureAllSessionQuizzes } from '../services/SessionQuizGenerator.js';
import { getVisibleEmployeeIds, canActAsManager } from '../services/ManagerScope.js';
import { QUIZ_MIX, normalizeTypeName } from '../services/QuestionMix.js';
import { startDeepContentJob } from '../services/SessionContentGenerator.js';

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const DATA_DIR = join(__dirname, '../data');

const router = express.Router();

// Platform-wide default when a caller doesn't specify a question count for a
// fresh generation — matches roles.js's own default (50). Never used to cap
// or truncate an APPROVED bank; that path always delivers bank.length,
// unconditionally, elsewhere in this file.
const DEFAULT_GENERATION_QUESTION_COUNT = 50;

// Unbiased Fisher-Yates shuffle — reorders only, never drops/adds items.
// Replaces the biased `sort(() => Math.random() - 0.5)` pattern previously
// used to both reorder AND (bug) resample per-employee question subsets.
function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// Tenant scoping: an admin/manager may only act on assessments within their own
// company ('default' company stays open for single-tenant installs; superadmin is global).
function canAccessAssessment(actor, assessment) {
  if (!actor || !assessment) return false;
  if (actor.role === 'superadmin') return true;
  const actorCompany = actor.companyId || 'default';
  const assessmentCompany = assessment.companyId || 'default';
  if (actorCompany === 'default') return true;
  return actorCompany === assessmentCompany;
}

// Strips internal provenance/generation metadata that must be stored (Issue
// 10) but never shown to the employee taking the assessment.
function stripInternalMetadata(q) {
  const { sourceFile, sourceSection, sourceType, generatedFrom, stakeholderFlag, processDeliveryFlag, createdAt, regenerationVersion, isManual, ...safe } = q || {};
  return safe;
}

// Version-backed assessments (Role Library approve-assessment flow) no longer
// embed question text on employeeAssignments — only a roster entry. Admin/
// manager-facing views (question preview/edit panels, exports) still expect
// `employeeAssignments[i].questions` to be populated, so this hydrates it back
// on read for privileged callers, without ever writing it back to storage.
async function hydrateAssignmentsForAdmin(assessment) {
  if (!assessment?.questionBankVersionId || !Array.isArray(assessment.employeeAssignments)) return assessment;
  const version = await getApprovedBankCached(assessment.questionBankVersionId);
  if (!version?.questions?.length) return assessment;
  const byId = new Map(version.questions.map(q => [q.id, q]));
  const eaaRows = await EmployeeAssessmentAssignments.getByAssessment(assessment.id);
  const orderByUser = new Map(eaaRows.map(r => [r.user_id, r.question_order]));
  return {
    ...assessment,
    employeeAssignments: assessment.employeeAssignments.map(ea => {
      // Mirrors resolveEmployeeQuestions' precedence so an admin previewing an
      // employee's paper sees exactly what that employee gets: a locked
      // (started/submitted) assignment keeps its embedded set; anything else
      // resolves against the current approved bank. Previously this returned
      // early on any embedded array, so admin previews kept showing a stale
      // 10-question set for employees who will actually receive the full bank.
      if (isAssignmentLocked(ea) && Array.isArray(ea.questions)) return ea;
      const order = orderByUser.get(ea.userId) || version.questions.map(q => q.id);
      const resolved = order.map(qid => byId.get(qid)).filter(Boolean);
      return resolved.length > 0 ? { ...ea, questions: resolved } : ea;
    }),
  };
}

/**
 * Single source of truth for "which questions does this employee actually get".
 *
 * The versioned Role Library flow stores the frozen bank + this employee's
 * shuffle order in question_bank_versions / employee_assessment_assignments,
 * and stores NO question text on the roster entry. The legacy ad-hoc flow
 * (POST /api/assessments) embeds `questions` directly on the assignment —
 * historically capped at 10 by that route's `questionCount` default.
 *
 * The bug this fixes: every read site checked the embedded array FIRST, so a
 * stale 10-question embed permanently shadowed a 320-question approved bank,
 * and re-approving the role changed nothing for that employee.
 *
 * The started/submitted guard is NOT defensive politeness — it is required for
 * correctness. normaliseResponses() and scoreSubmission() index answers
 * POSITIONALLY, so swapping the question set under someone who has already
 * started would misalign every stored answer and silently corrupt their score.
 * Only not-yet-started assignments are re-pointed at the full approved bank.
 */
function isAssignmentLocked(assignment) {
  if (!assignment) return false;
  return Boolean(assignment.startedAt) || ['in_progress', 'submitted'].includes(assignment.status);
}

async function resolveEmployeeQuestions(assessment, assignment, userId) {
  if (!assignment) return { questions: null, source: null };

  const embedded = Array.isArray(assignment.questions)
    ? assignment.questions.map(stripInternalMetadata)
    : null;

  // A locked (started/submitted) assignment keeps exactly what it was served.
  if (isAssignmentLocked(assignment)) {
    return embedded ? { questions: embedded, source: 'embedded' } : { questions: null, source: null };
  }

  if (assessment?.questionBankVersionId) {
    try {
      const [eaa, version] = await Promise.all([
        EmployeeAssessmentAssignments.getOne(assessment.id, userId),
        getApprovedBankCached(assessment.questionBankVersionId),
      ]);
      if (version?.questions?.length) {
        const byId = new Map(version.questions.map(q => [q.id, q]));
        const storedOrder = eaa?.question_order?.length ? eaa.question_order : [];

        // THE 10-question bug: the stored order was previously trusted as
        // "the complete set" (order.length === what the employee gets). If a
        // role's approved bank grows (e.g. re-approved with 30 questions
        // after the employee was originally assigned against a 10-question
        // version), the employee's question_order — still just 10 ids —
        // silently capped them at 10 forever, even though Job Library shows
        // the full 30 and the assessment's own questionCount says 30.
        //
        // Fix: keep whatever ordering the employee already has for ids still
        // present in the CURRENT approved version, then append any version
        // questions that order doesn't cover yet. A first-ever resolve (no
        // stored order) still gets the full bank in bank order, same as
        // before. An order that's already complete round-trips unchanged.
        const orderedIds = storedOrder.filter(qid => byId.has(qid));
        const missingIds = version.questions.map(q => q.id).filter(qid => !orderedIds.includes(qid));
        const order = [...orderedIds, ...missingIds];

        if (missingIds.length > 0) {
          console.warn(`[assessment] question_order for assessment=${assessment.id} user=${userId} covered ${orderedIds.length}/${version.questions.length} approved questions — reconciled by appending ${missingIds.length} missing question(s).`);
          // Persist the reconciliation so it's stable across requests instead
          // of being silently recomputed every time — this is the only write
          // on an otherwise read path, fires only when there's something to
          // fix, and (via updateQuestionOrder) never touches status/scoring.
          EmployeeAssessmentAssignments.updateQuestionOrder(assessment.id, userId, order)
            .catch(e2 => console.warn('[assessment] Failed to persist reconciled question_order:', e2.message));
        }

        const resolved = order.map(qid => byId.get(qid)).filter(Boolean).map(stripInternalMetadata);
        if (resolved.length > 0) return { questions: resolved, source: 'version' };
      }
    } catch (e) {
      console.warn(`[assessment] Version resolve failed for ${assessment.id}/${userId}:`, e.message);
    }
  }

  return embedded ? { questions: embedded, source: 'embedded' } : { questions: null, source: null };
}

// ── Normalise answers from frontend into a dense array indexed by question pos ─
// Frontend sends: answers: [{questionIndex:0, answer:'B) ...'}, ...]
// Legacy format:  responses: [{answer:'B'}, ...]   (index-ordered)
// Both are normalised to:  responsesArr[i] = { answer: string }
function normaliseResponses(rawAnswers, rawResponses, questionCount) {
  // Prefer the new `answers` field (sent by Assessment.jsx)
  if (Array.isArray(rawAnswers) && rawAnswers.length > 0) {
    const arr = new Array(questionCount).fill(null).map(() => ({ answer: '' }));
    rawAnswers.forEach(a => {
      if (a && typeof a.questionIndex === 'number' && a.questionIndex >= 0 && a.questionIndex < questionCount) {
        arr[a.questionIndex] = { answer: String(a.answer ?? '') };
      }
    });
    return arr;
  }
  // Fallback to legacy `responses` field
  if (Array.isArray(rawResponses) && rawResponses.length > 0) {
    const arr = new Array(questionCount).fill(null).map(() => ({ answer: '' }));
    rawResponses.forEach((r, i) => {
      if (i < questionCount) arr[i] = { answer: String(r?.answer ?? '') };
    });
    return arr;
  }
  return new Array(questionCount).fill({ answer: '' });
}

// ── Performance classification ─────────────────────────────────────────────────
export const DEFAULT_THRESHOLDS = [
  { min: 95, label: 'Outstanding',                  color: '#10B981' },
  { min: 85, label: 'Excellent',                    color: '#22C55E' },
  { min: 75, label: 'Good',                         color: '#84CC16' },
  { min: 60, label: 'Average',                      color: '#EAB308' },
  { min: 40, label: 'Needs Improvement',            color: '#F97316' },
  { min: 0,  label: 'Critical Improvement Required',color: '#EF4444' },
];

// Accepts optional custom thresholds array (from company/role config)
export function classifyPerformance(score, customThresholds) {
  const thresholds = (Array.isArray(customThresholds) && customThresholds.length > 0)
    ? customThresholds
    : DEFAULT_THRESHOLDS;
  for (const t of thresholds) {
    if (score >= t.min) return { label: t.label, color: t.color, score };
  }
  return { label: 'Critical Improvement Required', color: '#EF4444', score };
}

// GET /api/assessments/generated-content — list all AI-generated content for this company
router.get('/generated-content', authenticate, requireRole('admin', 'manager'), async (req, res) => {
  try {
    const companyId = req.user.companyId || 'default';
    const all = await GeneratedContent.getByCompany(companyId);
    res.json({ success: true, data: all || [] });
  } catch (e) {
    console.error('[assessments GET generated-content]', e.message);
    res.status(500).json({ success: false, error: 'Failed to load content' });
  }
});

// GET /api/assessments/thresholds — return company thresholds
router.get('/thresholds', authenticate, async (req, res) => {
  try {
    const companyId = req.user.companyId || 'default';
    const saved = await AssessmentThresholds.getByCompany(companyId);
    res.json({ success: true, data: { thresholds: saved?.thresholds || DEFAULT_THRESHOLDS } });
  } catch (e) {
    console.error('[assessments GET thresholds]', e.message);
    res.status(500).json({ success: false, error: 'Failed to load thresholds' });
  }
});

// PUT /api/assessments/thresholds — update company thresholds (admin only)
router.put('/thresholds', authenticate, requireRole('admin'), async (req, res) => {
  try {
    const companyId = req.user.companyId || 'default';
    const { thresholds } = req.body;
    if (!Array.isArray(thresholds) || thresholds.length < 2) {
      return res.status(400).json({ success: false, error: 'Provide at least 2 threshold entries' });
    }
    const saved = await AssessmentThresholds.upsert(companyId, thresholds);
    res.json({ success: true, data: saved });
  } catch (e) {
    console.error('[assessments PUT thresholds]', e.message);
    res.status(500).json({ success: false, error: 'Failed to save thresholds' });
  }
});

function getReadinessLevel(score) {
  if (score >= 85) return 'Ready for Advanced Responsibilities';
  if (score >= 70) return 'Ready with Minor Gaps';
  if (score >= 55) return 'Needs Targeted Development';
  return 'Requires Significant Training Before Progression';
}

// ── Answer evaluation helpers ─────────────────────────────────────────────────

// Remove all punctuation and symbols, collapse whitespace.
// "If-Else" → "if else", "AHT!" → "aht", "call centre" → "call centre"
function normalizeAnswer(s) {
  return (s || '')
    .toLowerCase()
    .replace(/[''`]/g, '')           // drop apostrophes (don't → dont)
    .replace(/[-–—_/\\|]/g, ' ')    // hyphens/slashes → space (if-else → if else)
    .replace(/[^\w\s]/g, ' ')        // drop remaining punctuation
    .replace(/\s+/g, ' ')
    .trim();
}

// Common words that carry no meaning for answer comparison
const STOP_WORDS = new Set([
  'the','a','an','is','are','was','were','be','been','being',
  'have','has','had','do','does','did','will','would','could',
  'should','may','might','must','can','of','in','on','at','to',
  'for','with','by','from','up','about','into','through',
  'and','or','but','if','then','that','this','it','its',
  'not','no','so','as','than','when','where','which','who',
  'how','what','we','they','he','she','you','i','my','our',
  'their','your','his','her','also','very','used','use',
]);

// Simple suffix stemming so "handling"/"handled"/"handles" all match "handle"
function stem(w) {
  return w
    .replace(/ing$/, '')
    .replace(/tions?$/, 't')
    .replace(/ments?$/, '')
    .replace(/nesses?$/, '')
    .replace(/iers?$/, 'y')
    .replace(/ies$/, 'y')
    .replace(/ers?$/, '')
    .replace(/es$/, '')
    .replace(/s$/, '');
}

function getKeywords(norm) {
  return norm.split(/\s+/).filter(w => w.length > 1 && !STOP_WORDS.has(w));
}

// Fraction of correct-answer keywords present in the user answer (with stemming)
function keywordOverlap(uaNorm, caNorm) {
  const caKW = getKeywords(caNorm);
  if (caKW.length === 0) return 1;
  const uaSet = new Set(getKeywords(uaNorm));
  const uaStemSet = new Set([...uaSet].map(stem));
  let matched = 0;
  for (const k of caKW) {
    if (uaSet.has(k) || uaStemSet.has(stem(k))) matched++;
  }
  return matched / caKW.length;
}

// Core answer evaluator — shared by fill_blank and subjective
function isAnswerCorrect(userAnswer, correctAnswer, type) {
  const uaNorm = normalizeAnswer(userAnswer);
  const caNorm = normalizeAnswer(correctAnswer);

  // 1. Exact match after full normalization (handles case, hyphens, punctuation)
  if (uaNorm === caNorm) return true;
  if (!uaNorm) return false;

  // 2. The correct answer (normalized) is fully contained in the user answer
  //    e.g. user wrote a longer but correct sentence
  if (caNorm.length > 2 && uaNorm.includes(caNorm)) return true;

  // 3. The user answer is fully contained in the correct answer
  //    e.g. correct = "average handle time", user = "average handling time"
  if (uaNorm.length > 2 && caNorm.includes(uaNorm)) return true;

  const caWords = caNorm.split(/\s+/).filter(Boolean);
  const overlap = keywordOverlap(uaNorm, caNorm);

  if (type === 'fill_blank' || type === 'fill_in_blank') {
    // Short answer (≤3 key words): require high match — "if else" must not accept "loop"
    const caKW = getKeywords(caNorm);
    const threshold = caKW.length <= 2 ? 0.8 : caWords.length <= 5 ? 0.65 : 0.5;
    return overlap >= threshold;
  }

  // Subjective: minimum meaningful length + 30% keyword coverage
  return uaNorm.length >= 5 && (getKeywords(caNorm).length === 0 || overlap >= 0.3);
}

// ── Score a submission ────────────────────────────────────────────────────────
// responses: dense array of { answer: string } indexed by question position
function scoreSubmission(questions, responses, passThreshold = 80, customThresholds) {
  let correct = 0;
  let total = 0;
  const breakdown = [];

  // Extract just the letter from answers like "B) some text" or "B"
  const extractLetter = s => {
    const str = (s || '').trim().toUpperCase();
    // Matches "B)" or "B " or "B." at the start, or just "A"/"B"/"C"/"D" alone
    const m = str.match(/^([A-D])[)\s.]/);
    if (m) return m[1];
    if (/^[A-D]$/.test(str)) return str;
    return '';
  };

  questions.forEach((q, i) => {
    const resp = responses[i] || { answer: '' };
    const userAnswer = resp.answer || '';
    let isCorrect = false;

    if (q.type === 'mcq' || q.type === 'multiple_choice') {
      const userLetter = extractLetter(userAnswer);
      const correctLetter = extractLetter(q.answer || '');
      isCorrect = userLetter !== '' && userLetter === correctLetter;
    } else if (q.type === 'fill_blank' || q.type === 'fill_in_blank') {
      isCorrect = isAnswerCorrect(userAnswer, q.answer || '', 'fill_blank');
    } else {
      isCorrect = isAnswerCorrect(userAnswer, q.answer || '', 'subjective');
    }

    total++;
    if (isCorrect) correct++;

    // Find the full correct option text for MCQ (e.g. "B) To install dependencies...")
    let correctOptionText = q.answer;
    if ((q.type === 'mcq' || q.type === 'multiple_choice') && Array.isArray(q.options)) {
      const correctLetter = extractLetter(q.answer || '');
      const found = q.options.find(opt => extractLetter(opt) === correctLetter);
      if (found) correctOptionText = found;
    }

    breakdown.push({
      questionIndex: i,
      question: q.question,
      type: q.type,
      options: q.options || null,
      userAnswer: userAnswer || null,      // null = no answer (displayed as "(no answer)")
      correctAnswer: q.answer,
      correctOptionText,
      isCorrect,
      skillArea: q.skillArea || 'General',
      explanation: q.explanation || '',
    });
  });

  const score = total > 0 ? Math.round((correct / total) * 100) : 0;
  const grade = score >= 90 ? 'A' : score >= 80 ? 'B' : score >= 70 ? 'C' : score >= 60 ? 'D' : 'F';

  // Skill area breakdown for the report
  const skillAreas = {};
  breakdown.forEach(b => {
    if (!skillAreas[b.skillArea]) skillAreas[b.skillArea] = { correct: 0, total: 0 };
    skillAreas[b.skillArea].total++;
    if (b.isCorrect) skillAreas[b.skillArea].correct++;
  });

  // Skill breakdown list (for bar charts)
  const skillBreakdown = Object.entries(skillAreas).map(([skill, v]) => ({
    skill,
    correct: v.correct,
    total: v.total,
    pct: Math.round((v.correct / v.total) * 100),
  }));

  const strengths = Object.entries(skillAreas).filter(([, v]) => v.correct / v.total >= 0.7).map(([k]) => k);
  const weakAreas = Object.entries(skillAreas).filter(([, v]) => v.correct / v.total < 0.7).map(([k]) => k);

  // Missing competencies: skill areas with 0% score
  const missingCompetencies = Object.entries(skillAreas)
    .filter(([, v]) => v.correct === 0)
    .map(([k]) => k);

  const performanceClassification = classifyPerformance(score, customThresholds);
  const readinessLevel = getReadinessLevel(score);

  // Recommended learning areas derived from weak/missing areas
  const recommendedLearningAreas = [...new Set([...missingCompetencies, ...weakAreas])];

  // passThreshold/passed are persisted onto every report (spread verbatim by
  // the /submit route), so every later consumer — employee report, manager
  // dashboard, exports — can use the SAME pass/fail fact for this submission
  // instead of re-deriving it from a different, possibly stale assumption.
  const passed = score >= passThreshold;

  return { score, grade, correct, total, breakdown, skillAreas, skillBreakdown, strengths, weakAreas, missingCompetencies, performanceClassification, readinessLevel, recommendedLearningAreas, passThreshold, passed };
}

// ─────────────────────────────────────────────────────────────────────────────
// ROUTES
// ─────────────────────────────────────────────────────────────────────────────

/**
 * GET /api/assessments
 * All assessments — admin sees all company assessments, manager sees only assessments for their group employees
 */
router.get('/', authenticate, async (req, res) => {
  try {
    const assessments = await Assessments.getAll() || [];
    const companyId = req.user?.companyId || 'default';

    // Company isolation first
    const companyFiltered = (companyId && companyId !== 'default')
      ? assessments.filter(a => !a.companyId || a.companyId === companyId)
      : assessments;

    const isAdminList = req.user.role === 'admin' || req.user.role === 'superadmin';
    if (!isAdminList && canActAsManager(req.user)) {
      // Manager: only assessments that include at least one of their visible
      // employees (Groups union the durable manager_id path) — was Groups-only
      // and gated on the raw current role, missing manager_id-linked employees
      // and 403-adjacent-behaving for an access-grant manager viewing as employee.
      const myEmpIds = await getVisibleEmployeeIds(req.user);
      const result = myEmpIds.size === 0
        ? []
        : companyFiltered.filter(a =>
            a.createdBy === req.user.userId ||
            a.employeeAssignments?.some(ea => myEmpIds.has(ea.userId)) ||
            a.targetUsers?.some(uid => myEmpIds.has(uid))
          );
      return res.json({ success: true, data: await Promise.all(result.map(hydrateAssignmentsForAdmin)), error: null });
    }

    const result = isAdminList
      ? companyFiltered
      : companyFiltered.filter(a =>
          a.employeeAssignments?.some(ea => ea.userId === req.user.userId) ||
          a.targetUsers?.includes(req.user.userId)
        );

    res.json({ success: true, data: isAdminList ? await Promise.all(result.map(hydrateAssignmentsForAdmin)) : result, error: null });
  } catch (e) {
    console.error('[assessments GET /]', e.message);
    res.status(500).json({ success: false, data: null, error: 'Failed to load assessments' });
  }
});

/**
 * POST /api/assessments
 * Create assessment — admin/manager only
 */
router.post('/', authenticate, requireRole('admin', 'manager'), requirePermission('assessments.create'), async (req, res) => {
  try {
    const {
      title,
      targetUsers = [],
      targetGroup: _targetGroup,
      groupId,
      // No default: absent means "deliver the role's ENTIRE approved bank".
      // This used to default to 10, which silently cut a 320-question approved
      // bank down to 10 for every employee — the single most-reported bug.
      // An explicit value is still honoured as a deliberate admin-chosen cap.
      questionCount,
      questionTypes,
      assessmentDate,
      deadline,
      duration = 30,
      difficulty, // 'easy' | 'medium' | 'hard' | undefined — filter from role question bank if set
      easyPct,    // percentage of easy questions when pulling from bank (default 33)
      mediumPct,  // percentage of medium questions when pulling from bank (default 33)
      hardPct,    // percentage of hard questions when pulling from bank (default 34)
      targetType, // 'all' | 'department' | undefined
      department, // used when targetType === 'department'
    } = req.body;

    // Accept both targetGroup (correct) and groupId (legacy client bug)
    const targetGroup = _targetGroup || groupId || null;

    if (!title) {
      return res.status(400).json({ success: false, data: null, error: 'Title is required' });
    }

    let userIds = [...(Array.isArray(targetUsers) ? targetUsers : [])];

    // If targetType === 'all', fetch ALL employees in the company
    if (targetType === 'all') {
      try {
        const allUsersForCompany = await UserStore.getAllUsers({});
        const companyId = req.user.companyId || 'default';
        const employeeIds = allUsersForCompany
          .filter(u => u.role === 'employee' && (u.companyId || 'default') === companyId)
          .map(u => u.userId || u.id);
        userIds = [...new Set([...userIds, ...employeeIds])];
      } catch (e) { console.warn('[assessment] targetType=all resolution failed:', e.message); }
    }

    // If targetType === 'department', fetch employees matching the department.
    // Case/whitespace-insensitive — the client selector offers exactly the
    // department strings that exist on user records, but matching strictly
    // by === here previously meant a trailing space or casing drift (e.g.
    // "Engineering " vs "engineering") silently assigned zero employees
    // while the API still reported success.
    if (targetType === 'department' && department) {
      try {
        const allUsersForCompany = await UserStore.getAllUsers({});
        const companyId = req.user.companyId || 'default';
        const normDept = department.trim().toLowerCase();
        const deptEmployeeIds = allUsersForCompany
          .filter(u =>
            u.role === 'employee' &&
            (u.companyId || 'default') === companyId &&
            (u.department || '').trim().toLowerCase() === normDept
          )
          .map(u => u.userId || u.id);
        userIds = [...new Set([...userIds, ...deptEmployeeIds])];
      } catch (e) { console.warn('[assessment] targetType=department resolution failed:', e.message); }
    }

    // If group provided, fetch members directly from group.employeeIds
    if (targetGroup) {
      try {
        const { getGroups } = await import('../db/store.js');
        const allGroups = await getGroups();
        const groupObj = allGroups.find(g => g.id === targetGroup);
        if (groupObj) {
          userIds = [...new Set([...userIds, ...(groupObj.employeeIds || [])])];
        }
      } catch (e) { console.warn('[assessment] Group resolution failed:', e.message); }
    }

    userIds = [...new Set(userIds)];

    // A manager may only assess their own team. Enforced here, after every
    // target path (explicit targetUsers, targetType 'all'/'department',
    // targetGroup) has been resolved, so one check covers all of them —
    // previously there was no scoping at all and targetType:'all' let a
    // manager assess every employee in the company.
    if (req.user.role !== 'admin' && req.user.role !== 'superadmin') {
      const visible = await getVisibleEmployeeIds(req.user);
      const explicit = Array.isArray(targetUsers) ? targetUsers : [];
      // An explicitly named user outside the team is an error worth telling
      // the manager about, rather than silently dropping them.
      const rejected = explicit.filter(id => !visible.has(id));
      if (rejected.length > 0) {
        return res.status(403).json({
          success: false,
          data: null,
          error: `You can only assess employees on your own team (${rejected.length} selected user(s) are not).`,
        });
      }
      // The broad selectors legitimately mean "everyone I can reach", so
      // narrow them rather than failing.
      userIds = userIds.filter(id => visible.has(id));
    }

    // Batch-fetch all target users in ONE query instead of N individual queries
    const allUsers = await UserStore.getAllUsers({});
    const userMap = new Map(allUsers.map(u => [u.userId || u.id, u]));
    const validUsers = userIds.map(id => userMap.get(id)).filter(Boolean);

    // Generate per-employee assignments — parallel LLM calls via LLMQueue (concurrency-capped)
    const assignedAt = new Date().toISOString();

    // Bank-derived subset is picked ONCE per job role (not per employee) so
    // every employee sharing a job role gets the identical question set —
    // only the delivery ORDER is randomized per employee. Picking a fresh
    // subset per employee (the old behavior) was the root cause of employees
    // on the same role receiving different questions/counts.
    const bankSubsetByRole = new Map();
    async function getBankSubsetForRole(jobRole, companyId) {
      const key = `${jobRole}::${companyId}`;
      if (bankSubsetByRole.has(key)) return bankSubsetByRole.get(key);
      let result = null;
      try {
        const roleForBank = await RoleLibrary.findByName(jobRole, companyId);
        const fullBank = roleForBank?.questionBank || [];
        if (fullBank.length > 0) {
          const pctEasy   = easyPct   != null ? Number(easyPct)   : 34;
          const pctMedium = mediumPct != null ? Number(mediumPct) : 33;
          // Absent questionCount ⇒ the whole approved bank (see the parameter
          // comment above). Only an explicit value caps it.
          const target    = questionCount != null
            ? Math.min(Number(questionCount) || fullBank.length, fullBank.length)
            : fullBank.length;
          const nEasy   = Math.round(target * pctEasy   / 100);
          const nMedium = Math.round(target * pctMedium / 100);
          const nHard   = target - nEasy - nMedium;
          const pickN = (diff, n) => shuffle(fullBank.filter(q => q.difficulty === diff)).slice(0, n);
          const picked = [...pickN('easy', nEasy), ...pickN('medium', nMedium), ...pickN('hard', Math.max(0, nHard))];
          if (picked.length > 0) {
            if (picked.length < target) {
              const usedIds = new Set(picked.map(q => q.id));
              const extras = shuffle(fullBank.filter(q => !usedIds.has(q.id)));
              result = [...picked, ...extras].slice(0, target);
            } else {
              result = picked.slice(0, target);
            }
          }
        }
      } catch (e) { console.warn('[assessment] Bank lookup failed:', e.message); }
      bankSubsetByRole.set(key, result);
      return result;
    }

    // Memoize per companyId+jobRole so assigning to many users in the same
    // company/role doesn't re-run RoleLibrary's full company scan once per
    // user (findByName → getByCompany does a fresh fetch every call).
    const roleMatchCache = new Map();
    const employeeAssignments = (await Promise.all(
      validUsers.map(async (user) => {
        const userId = user.userId || user.id;
        // JD resolution priority:
        // 1. Employee-specific JD override
        // 2. Role Library JD (matched by job role name)
        // 3. Employee skills alone
        let resolvedJD     = user.jobDescription || '';
        let resolvedSkills = user.jdSkills || [];
        if (!resolvedJD && user.jobRole) {
          try {
            const cacheKey = `${user.companyId || 'default'}|${user.jobRole.toLowerCase()}`;
            let roleMatch;
            if (roleMatchCache.has(cacheKey)) {
              roleMatch = roleMatchCache.get(cacheKey);
            } else {
              roleMatch = await RoleLibrary.findByName(user.jobRole, user.companyId || 'default');
              roleMatchCache.set(cacheKey, roleMatch);
            }
            if (roleMatch?.jobDescription) { resolvedJD = roleMatch.jobDescription; }
            if (!resolvedSkills.length && (roleMatch?.skills || []).length) { resolvedSkills = roleMatch.skills; }
          } catch {}
        }

        // Bank-only priority: if role has any approved questions, use ONLY the
        // shared per-role subset (same content for everyone), reordered per employee.
        let questions = null;
        if (user.jobRole) {
          const sharedSubset = await getBankSubsetForRole(user.jobRole, user.companyId || 'default');
          if (sharedSubset) questions = shuffle(sharedSubset);
        }
        if (!questions) {
          // Reached only when the role has NO approved bank at all, so there
          // is no approved count to honour here — a modest generation default
          // is correct and unrelated to the "deliver the full approved bank"
          // rule that governs the bank path above.
          questions = await generateQuestionsFromJD({
            jobRole: user.jobRole || 'Employee',
            jobDescription: resolvedJD,
            jdSkills: resolvedSkills,
            questionCount: questionCount ?? DEFAULT_GENERATION_QUESTION_COUNT,
            questionTypes,
            employeeSeed: `${userId}-${Date.now()}`,
          });
        }

        return {
          userId,
          userName: user.name,
          userEmail: user.email,
          jobRole: user.jobRole || '',
          questions,
          status: 'assigned',
          assignedAt,
          startedAt: null,
          submittedAt: null,
        };
      })
    )).filter(Boolean);

    const newAssessment = {
      id: randomUUID(),
      title,
      targetGroup: targetGroup || null,
      targetUsers: userIds,
      employeeAssignments,
      // Store the count actually delivered, not the requested one — this field
      // is what the Job Library assignment-history panel displays, so an
      // undefined/stale value there misreports what employees received.
      questionCount: employeeAssignments[0]?.questions?.length ?? questionCount ?? 0,
      questionTypes: questionTypes?.length
        ? questionTypes
        : [...new Set((employeeAssignments[0]?.questions || []).map(q => q.type).filter(Boolean))],
      difficulty: difficulty || null,
      assessmentDate: assessmentDate || null,
      deadline: deadline || null,
      duration,
      assessmentType: req.body.assessmentType || 'Skill Assessment',
      settings: req.body.settings || { questionOrder: 'same', markingScheme: { easy: { correct: 1, wrong: 0 }, medium: { correct: 2, wrong: 0 }, hard: { correct: 3, wrong: 0 } }, passPercentage: 80, reattempts: 0, allowReattemptToBeatScore: false, timing: { type: 'timed', totalMinutes: 30 }, navigation: { forwardOnly: false }, results: { hideFromParticipants: false, revealOnSubmission: false, revealAfterEachQuestion: false, revealCorrectOption: false }, completion: { mandatory: false, markCompleteOnlyIfPassed: false, allowSubmitWithoutAnsweringAll: false } },
      createdBy: req.user.userId,
      companyId: req.user.companyId || null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      isActive: true,
    };

    const saved = await Assessments.create(newAssessment);
    res.status(201).json({ success: true, data: saved || newAssessment, error: null });
  } catch (e) {
    console.error('[POST /api/assessments]', e);
    res.status(500).json({ success: false, data: null, error: 'Failed to create assessment' });
  }
});

/**
 * POST /api/assessments/manual
 * Create assessment with pre-built questions — no LLM generation.
 * Body: { title, targetUsers, questionCount, assessmentDate, duration, deadline, questions }
 *   questions: flat array (same for all users) OR array of arrays (per-user, index-aligned with targetUsers)
 */
router.post('/manual', authenticate, requireRole('admin', 'manager'), async (req, res) => {
  try {
    const {
      title,
      targetUsers = [],
      questionCount,
      assessmentDate,
      deadline,
      duration = 30,
      questions: rawQuestions = [],
    } = req.body;

    if (!title) {
      return res.status(400).json({ success: false, data: null, error: 'Title is required' });
    }

    if (!Array.isArray(rawQuestions) || rawQuestions.length === 0) {
      return res.status(400).json({ success: false, data: null, error: 'questions array is required and must not be empty' });
    }

    const userIds = [...new Set(Array.isArray(targetUsers) ? targetUsers : [])];

    // Same team-scoping rule as POST / — a manager may only assign a manual
    // assessment to their own team.
    if (req.user.role !== 'admin' && req.user.role !== 'superadmin') {
      const visible = await getVisibleEmployeeIds(req.user);
      const rejected = userIds.filter(id => !visible.has(id));
      if (rejected.length > 0) {
        return res.status(403).json({
          success: false,
          data: null,
          error: `You can only assign assessments to employees on your own team (${rejected.length} selected user(s) are not).`,
        });
      }
    }

    // Determine if questions is an array-of-arrays (per-user) or flat (shared)
    const isPerUser = Array.isArray(rawQuestions[0]);

    // Batch-fetch all target users
    const allUsers = await UserStore.getAllUsers({});
    const userMap = new Map(allUsers.map(u => [u.userId || u.id, u]));
    const validUsers = userIds.map(id => userMap.get(id)).filter(Boolean);

    const assignedAt = new Date().toISOString();
    const employeeAssignments = validUsers.map((user, idx) => {
      const userId = user.userId || user.id;
      const questions = isPerUser
        ? (Array.isArray(rawQuestions[idx]) ? rawQuestions[idx] : rawQuestions[0])
        : rawQuestions;

      return {
        userId,
        userName: user.name,
        userEmail: user.email,
        jobRole: user.jobRole || '',
        questions,
        status: 'assigned',
        assignedAt,
        startedAt: null,
        submittedAt: null,
      };
    });

    const resolvedQuestionCount = questionCount || (isPerUser ? (rawQuestions[0]?.length || 0) : rawQuestions.length);

    const newAssessment = {
      id: randomUUID(),
      title,
      targetGroup: null,
      targetUsers: userIds,
      employeeAssignments,
      questionCount: resolvedQuestionCount,
      questionTypes: [...new Set((isPerUser ? rawQuestions[0] : rawQuestions).map(q => q.type).filter(Boolean))],
      difficulty: null,
      assessmentDate: assessmentDate || null,
      deadline: deadline || null,
      duration,
      assessmentType: req.body.assessmentType || 'Skill Assessment',
      settings: req.body.settings || { questionOrder: 'same', markingScheme: { easy: { correct: 1, wrong: 0 }, medium: { correct: 2, wrong: 0 }, hard: { correct: 3, wrong: 0 } }, passPercentage: 80, reattempts: 0, allowReattemptToBeatScore: false, timing: { type: 'timed', totalMinutes: 30 }, navigation: { forwardOnly: false }, results: { hideFromParticipants: false, revealOnSubmission: false, revealAfterEachQuestion: false, revealCorrectOption: false }, completion: { mandatory: false, markCompleteOnlyIfPassed: false, allowSubmitWithoutAnsweringAll: false } },
      createdBy: req.user.userId,
      companyId: req.user.companyId || null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      isActive: true,
      isManual: true,
    };

    const saved = await Assessments.create(newAssessment);
    res.status(201).json({ success: true, data: saved || newAssessment, error: null });
  } catch (e) {
    console.error('[POST /api/assessments/manual]', e);
    res.status(500).json({ success: false, data: null, error: 'Failed to create assessment' });
  }
});

/**
 * POST /api/assessments/parse-questionnaire
 * Parse an uploaded XLSX questionnaire file into questions array
 */
router.post('/parse-questionnaire', authenticate, requireRole('admin', 'manager'), upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ success: false, data: null, error: 'No file uploaded' });
    const { default: XLSX } = await import('xlsx');
    const wb = XLSX.read(req.file.buffer, { type: 'buffer' });
    const ws = wb.Sheets[wb.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(ws, { defval: '' });
    const questions = rows.map(row => {
      const get = (...keys) => keys.map(k => row[k] || row[k.toLowerCase()] || row[k.toUpperCase()] || '').find(Boolean) || '';
      const ans = (get('Correct Answer', 'Answer', 'Correct') || 'A').replace(/[^A-D]/gi, '').toUpperCase() || 'A';
      const diff = get('Difficulty', 'difficulty').toLowerCase();
      return {
        type: 'mcq',
        question: get('Question', 'question') || '',
        options: [
          'A) ' + get('Option A', 'OptionA', 'A'),
          'B) ' + get('Option B', 'OptionB', 'B'),
          'C) ' + get('Option C', 'OptionC', 'C'),
          'D) ' + get('Option D', 'OptionD', 'D'),
        ],
        answer: ans,
        difficulty: ['easy', 'medium', 'hard'].includes(diff) ? diff : 'medium',
        skillArea: get('Category', 'Skill Area', 'SkillArea', 'category') || '',
        explanation: get('Explanation', 'explanation') || '',
      };
    }).filter(q => q.question);
    res.json({ success: true, data: { questions, count: questions.length }, error: null });
  } catch (e) {
    console.error('[POST /api/assessments/parse-questionnaire]', e);
    res.status(500).json({ success: false, data: null, error: 'Failed to parse questionnaire' });
  }
});

// ── Shared helper: build export row from assessment employee assignment + DB report ──
function buildExportRow(ea, report, assessmentTitle, extraMeta = {}) {
  // scoring lives in both ea.scoring (immediate) and the Reports collection
  const sc = report || ea.scoring || {};
  const correct  = sc.correct  ?? null;
  const totalQs  = sc.total    ?? ea.questions?.length ?? 0;
  const scorePct = sc.score    ?? null;   // already 0-100 percentage from scoreSubmission

  const recsList = (report?.improvementRecommendations || sc.recommendedLearningAreas || [])
    .map(r => (typeof r === 'string' ? r : r?.area || String(r)));

  // Duration: calculated from start→submit if available, else assessment duration
  const durationMs = ea.startedAt && ea.submittedAt ? new Date(ea.submittedAt) - new Date(ea.startedAt) : null;
  const durationStr = durationMs ? `${Math.round(durationMs / 60000)} min` : (extraMeta.durationMinutes ? `${extraMeta.durationMinutes} min` : '');

  return {
    employeeName:    ea.userName  || ea.name  || ea.userId || '',
    employeeId:      extraMeta.employeeId || ea.userId || '',
    employeeEmail:   ea.userEmail || report?.userEmail || '',
    jobRole:         ea.jobRole   || report?.jobRole || '',
    group:           extraMeta.groupName  || '',
    manager:         extraMeta.managerName || '',
    assessmentName:  assessmentTitle || '',
    assessmentType:  extraMeta.assessmentType || '',
    assessmentDate:  ea.assignedAt || '',
    deadline:        extraMeta.deadline || '',
    score:           correct != null ? `${correct}/${totalQs}` : 'Pending',
    percentage:      scorePct != null ? `${scorePct}%` : 'Pending',
    grade:           sc.grade || '',
    passFail:        scorePct != null ? (scorePct >= (extraMeta.passThreshold ?? 80) ? 'Pass' : 'Fail') : '',
    classification:  sc.performanceClassification?.label || '',
    status:          ea.status || 'assigned',
    completionDate:  ea.submittedAt || report?.submittedAt || '',
    duration:        durationStr,
    strengths:       (sc.strengths || []).join('; '),
    improvementAreas:(sc.weakAreas || []).join('; '),
    missingCompetencies: (sc.missingCompetencies || []).join('; '),
    recommendations: recsList.join('; '),
    skillBreakdown:  (sc.skillBreakdown || []).map(s => `${s.skill}: ${s.score ?? s.pct ?? 0}%`).join(', '),
    aiSummary:       report?.aiSummary || sc.readinessLevel || '',
    topicScores:     (sc.skillBreakdown || []).map(s => `${s.skill}: ${s.pct ?? s.score ?? 0}%`).join('; '),
  };
}

// ── PDF generation helper (single or multi-employee) ──────────────────────────
async function generatePDFBuffer(rows, title) {
  const PDFDocument = (await import('pdfkit')).default;
  const chunks = [];
  const doc = new PDFDocument({ margin: 50, size: 'A4' });
  doc.on('data', c => chunks.push(c));

  await new Promise(resolve => {
    doc.on('end', resolve);

    // Cover / title
    doc.fontSize(20).font('Helvetica-Bold').fillColor('#111111').text(title || 'Assessment Report', { align: 'center' });
    doc.moveDown(0.4);
    doc.fontSize(10).font('Helvetica').fillColor('#555555').text(`Generated: ${new Date().toLocaleString()}`, { align: 'center' });
    doc.moveDown(1.5);

    rows.forEach((r, i) => {
      if (i > 0) {
        doc.addPage();
      }
      doc.fontSize(14).font('Helvetica-Bold').fillColor('#111111').text(r.employeeName || 'Employee');
      doc.fontSize(9).font('Helvetica').fillColor('#444444');
      if (r.employeeEmail) doc.text(`Email: ${r.employeeEmail}`);
      doc.text(`Employee ID: ${r.employeeId || 'N/A'}  |  Job Role: ${r.jobRole || 'N/A'}`);
      doc.moveDown(0.6);

      doc.fontSize(11).font('Helvetica-Bold').fillColor('#111111').text('Performance Summary');
      doc.fontSize(9).font('Helvetica').fillColor('#222222');
      [
        ['Assessment', r.assessmentName],
        ['Score', r.score],
        ['Percentage', r.percentage],
        ['Grade', r.grade || 'N/A'],
        ['Classification', r.classification || 'N/A'],
        ['Status', r.status],
        ['Completed', r.completionDate || 'N/A'],
      ].forEach(([k, v]) => doc.text(`${k}: ${v}`));

      doc.moveDown(0.6);

      if (r.skillBreakdown) {
        doc.fontSize(11).font('Helvetica-Bold').fillColor('#111111').text('Skill Breakdown');
        doc.fontSize(9).font('Helvetica').fillColor('#333333').text(r.skillBreakdown || 'N/A');
        doc.moveDown(0.4);
      }

      if (r.strengths) {
        doc.fontSize(11).font('Helvetica-Bold').fillColor('#166534').text('Strengths');
        doc.fontSize(9).font('Helvetica').fillColor('#333333').text(r.strengths);
        doc.moveDown(0.4);
      }
      if (r.improvementAreas) {
        doc.fontSize(11).font('Helvetica-Bold').fillColor('#92400e').text('Improvement Areas');
        doc.fontSize(9).font('Helvetica').fillColor('#333333').text(r.improvementAreas);
        doc.moveDown(0.4);
      }
      if (r.missingCompetencies) {
        doc.fontSize(11).font('Helvetica-Bold').fillColor('#991b1b').text('Missing Competencies');
        doc.fontSize(9).font('Helvetica').fillColor('#333333').text(r.missingCompetencies);
        doc.moveDown(0.4);
      }
      if (r.recommendations) {
        doc.fontSize(11).font('Helvetica-Bold').fillColor('#3730a3').text('Recommendations');
        doc.fontSize(9).font('Helvetica').fillColor('#333333').text(r.recommendations);
      }
    });
    doc.end();
  });
  return Buffer.concat(chunks);
}

// ── DOCX generation helper ─────────────────────────────────────────────────────
async function generateDOCXBuffer(rows, title) {
  const docxLib = await import('docx');
  const { Document, Paragraph, TextRun, Table, TableRow, TableCell, Packer, WidthType, HeadingLevel } = docxLib;

  const noBorder = { style: 'none', size: 0, color: 'auto' };
  const cellBorders = { top: noBorder, bottom: noBorder, left: noBorder, right: noBorder };

  const makeCell = (text, bold = false, w = 2000) => new TableCell({
    children: [new Paragraph({ children: [new TextRun({ text: String(text ?? ''), bold, size: 18 })] })],
    width: { size: w, type: WidthType.DXA },
    borders: cellBorders,
  });

  const infoRow = (k, v) => new TableRow({ children: [makeCell(k, true, 2200), makeCell(v, false, 6800)] });

  const docChildren = [
    new Paragraph({ text: title || 'Assessment Report', heading: HeadingLevel.HEADING_1 }),
    new Paragraph({ children: [new TextRun({ text: `Generated: ${new Date().toLocaleString()}`, size: 18, color: '888888' })] }),
    new Paragraph({ text: '' }),
  ];

  rows.forEach((r, i) => {
    if (i > 0) docChildren.push(new Paragraph({ pageBreakBefore: true }));
    docChildren.push(new Paragraph({ text: r.employeeName || 'Employee', heading: HeadingLevel.HEADING_2 }));
    docChildren.push(new Table({ rows: [
      infoRow('Employee Email',  r.employeeEmail  || 'N/A'),
      infoRow('Employee ID',     r.employeeId     || 'N/A'),
      infoRow('Job Role',        r.jobRole        || 'N/A'),
      infoRow('Assessment',      r.assessmentName || 'N/A'),
      infoRow('Score',           r.score),
      infoRow('Percentage',      r.percentage),
      infoRow('Grade',           r.grade          || 'N/A'),
      infoRow('Classification',  r.classification || 'N/A'),
      infoRow('Status',          r.status),
      infoRow('Completed',       r.completionDate || 'N/A'),
    ] }));
    docChildren.push(new Paragraph({ text: '' }));

    [
      ['Skill Breakdown',       r.skillBreakdown],
      ['Strengths',             r.strengths],
      ['Improvement Areas',     r.improvementAreas],
      ['Missing Competencies',  r.missingCompetencies],
      ['Recommendations',       r.recommendations],
    ].forEach(([label, val]) => {
      if (val) {
        docChildren.push(new Paragraph({ children: [new TextRun({ text: `${label}: `, bold: true, size: 20 }), new TextRun({ text: val, size: 20 })] }));
      }
    });
  });

  const docObj = new Document({ sections: [{ children: docChildren }] });
  return Packer.toBuffer(docObj);
}

/**
 * GET /api/assessments/:id/export-reports
 * Export all employee reports — XLSX / PDF / DOCX / ZIP
 * Manager sees only their group employees; admin sees all.
 */
router.get('/:id/export-reports', authenticate, requireRole('admin', 'manager'), requirePermission('reports.export'), async (req, res) => {
  try {
    const { id } = req.params;
    const format  = (req.query.format || 'xlsx').toLowerCase();
    const mode    = (req.query.mode   || 'consolidated').toLowerCase();
    const targetUserId = req.query.userId || null;

    const assessment = await Assessments.getById(id);
    if (!assessment) return res.status(404).json({ success: false, data: null, error: 'Assessment not found' });

    const allReports  = await Reports.getAll();
    let assignments   = assessment.employeeAssignments || [];

    // Non-admins: restrict to their own team. Was gated on
    // `req.user.role === 'manager'` specifically — the router-level
    // requireRole('admin','manager') gate already lets through anyone with
    // manager capability via ANY path (primary role, access grant, or
    // switched view), so an access-grant manager who hadn't happened to
    // switch their active view to "Manager" could fall through this `if`
    // with NO restriction applied at all and export every employee's report,
    // not just their own team's — an over-exposure, not the usual
    // under-exposure bug. Now applies whenever the caller isn't admin, and
    // unions Groups with the durable manager_id path via getVisibleEmployeeIds.
    if (req.user.role !== 'admin' && req.user.role !== 'superadmin') {
      try {
        const memberIds = await getVisibleEmployeeIds(req.user);
        if (memberIds.size > 0) assignments = assignments.filter(ea => memberIds.has(ea.userId));
        else assignments = [];
      } catch {}
    }

    // Filter by specific userId if provided (for per-employee download)
    const filteredAssignments = targetUserId
      ? assignments.filter(ea => ea.userId === targetUserId)
      : assignments;

    // Fetch groups + users for group/manager enrichment
    let allGroups = [], allUsers = [];
    try {
      const { getGroups } = await import('../db/store.js');
      allGroups = await getGroups();
      const usersResult = await UserStore.getAllUsers({ companyId: req.user.companyId });
      allUsers = Array.isArray(usersResult) ? usersResult : (usersResult?.users || []);
    } catch {}

    const rows = filteredAssignments.map(ea => {
      const report = allReports.find(r => r.assessmentId === id && r.userId === ea.userId);
      const group = allGroups.find(g => (g.employeeIds || []).includes(ea.userId));
      const managerUser = group ? allUsers.find(u => u.userId === group.managerId) : null;
      const empUser = allUsers.find(u => u.userId === ea.userId);
      return buildExportRow(ea, report, assessment.title, {
        groupName: group?.name || '',
        managerName: managerUser?.name || '',
        employeeId: empUser?.employeeId || ea.userId,
        assessmentType: assessment.assessmentType || '',
        deadline: assessment.deadline || '',
        durationMinutes: assessment.duration,
        passThreshold: assessment.settings?.passPercentage ?? 80,
      });
    });

    if (rows.length === 0) {
      return res.status(404).json({ success: false, data: null, error: 'No employee assignments found for this assessment' });
    }

    const safeTitle = (assessment.title || 'Assessment').replace(/[^a-zA-Z0-9-_ ]/g, '_');
    const filename  = `${safeTitle}-Reports`;

    // ── XLSX ──────────────────────────────────────────────────────────────────
    if (format === 'xlsx') {
      const { default: XLSX } = await import('xlsx');
      const headers = ['Employee Name','Employee ID','Email','Job Role','Group','Manager','Assessment','Assessment Type','Assessment Date','Deadline','Score','%','Pass/Fail','Grade','Classification','Duration','Status','Completion Date','Skill Breakdown','Topic Scores','Strengths','Improvement Areas','Missing Competencies','Recommendations','AI Summary'];
      const toRow = r => [r.employeeName,r.employeeId,r.employeeEmail,r.jobRole,r.group,r.manager,r.assessmentName,r.assessmentType,r.assessmentDate,r.deadline,r.score,r.percentage,r.passFail,r.grade,r.classification,r.duration,r.status,r.completionDate,r.skillBreakdown,r.topicScores,r.strengths,r.improvementAreas,r.missingCompetencies,r.recommendations,r.aiSummary];

      const wb = XLSX.utils.book_new();
      if (mode === 'individual') {
        rows.forEach((r, i) => {
          const ws = XLSX.utils.aoa_to_sheet([headers, toRow(r)]);
          ws['!cols'] = headers.map((_, ci) => ({ wch: ci < 4 ? 20 : 30 }));
          XLSX.utils.book_append_sheet(wb, ws, (r.employeeName || `Employee${i+1}`).slice(0, 31));
        });
      } else {
        const ws = XLSX.utils.aoa_to_sheet([headers, ...rows.map(toRow)]);
        ws['!cols'] = headers.map((_, ci) => ({ wch: ci < 4 ? 20 : 30 }));
        XLSX.utils.book_append_sheet(wb, ws, 'Reports');
      }

      const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}.xlsx"`);
      return res.send(buf);
    }

    // ── PDF ───────────────────────────────────────────────────────────────────
    if (format === 'pdf') {
      try {
        const buf = await generatePDFBuffer(rows, assessment.title || 'Assessment Report');
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename="${filename}.pdf"`);
        return res.send(buf);
      } catch (e) {
        console.error('[export-reports PDF]', e);
        return res.status(501).json({ success: false, data: null, error: 'PDF export failed: ' + e.message });
      }
    }

    // ── DOCX ──────────────────────────────────────────────────────────────────
    if (format === 'docx') {
      try {
        const buf = await generateDOCXBuffer(rows, assessment.title || 'Assessment Report');
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
        res.setHeader('Content-Disposition', `attachment; filename="${filename}.docx"`);
        return res.send(buf);
      } catch (e) {
        console.error('[export-reports DOCX]', e);
        return res.status(501).json({ success: false, data: null, error: 'DOCX export failed: ' + e.message });
      }
    }

    // ── ZIP (individual PDFs bundled) ─────────────────────────────────────────
    if (format === 'zip') {
      try {
        const AdmZip = (await import('adm-zip')).default;
        const zip = new AdmZip();

        const subFormat = (req.query.subformat || 'pdf').toLowerCase();
        await Promise.all(rows.map(async (r) => {
          try {
            let fileBuffer, ext;
            if (subFormat === 'docx') {
              fileBuffer = await generateDOCXBuffer([r], `${r.employeeName} — ${assessment.title}`);
              ext = 'docx';
            } else {
              fileBuffer = await generatePDFBuffer([r], `${r.employeeName} — ${assessment.title}`);
              ext = 'pdf';
            }
            const safeName = (r.employeeName || `employee-${r.employeeId}`).replace(/[^a-zA-Z0-9-_ ]/g, '_');
            zip.addFile(`${safeName}.${ext}`, fileBuffer);
          } catch {}
        }));

        const zipBuf = zip.toBuffer();
        res.setHeader('Content-Type', 'application/zip');
        res.setHeader('Content-Disposition', `attachment; filename="${filename}.zip"`);
        return res.send(zipBuf);
      } catch (e) {
        console.error('[export-reports ZIP]', e);
        return res.status(500).json({ success: false, data: null, error: 'ZIP export failed: ' + e.message });
      }
    }

    res.status(400).json({ success: false, data: null, error: `Unsupported format: ${format}. Use xlsx, pdf, docx, or zip.` });
  } catch (e) {
    console.error('[GET /api/assessments/:id/export-reports]', e);
    res.status(500).json({ success: false, data: null, error: 'Failed to export reports' });
  }
});

// ── Enterprise single-report data aggregation ──────────────────────────────────
// Pulls together everything for one employee + one assessment into a single
// structured object: employee details, assessment metadata, full question-by-
// question breakdown, performance analysis, linked module info, and audit trail.
async function buildFullReportData({ ea, report, assessment, userId, req }) {
  const [user, allGroups] = await Promise.all([
    UserStore.getUserById(userId).catch(() => null),
    Groups.getAll().catch(() => []),
  ]);

  const myGroup = (allGroups || []).find(g => (g.employeeIds || []).includes(userId));

  const sc = report || ea.scoring || {};
  const durationMs = ea.startedAt && ea.submittedAt ? new Date(ea.submittedAt) - new Date(ea.startedAt) : null;

  // Question-by-question breakdown: prefer the detailed `breakdown` array saved
  // at submission time; fall back to reconstructing from questions+responses.
  let questions = (report?.breakdown || sc.breakdown || []).map((b, i) => ({
    index: i + 1,
    question: b.question || '',
    type: b.type || 'mcq',
    options: b.options || null,
    userAnswer: b.userAnswer ?? '',
    correctAnswer: b.correctOptionText || b.correctAnswer || '',
    isCorrect: !!b.isCorrect,
    marks: b.marks ?? (b.isCorrect ? 1 : 0),
    skillArea: b.skillArea || '',
    explanation: b.explanation || '',
  }));
  if (questions.length === 0 && Array.isArray(ea.questions)) {
    questions = ea.questions.map((q, i) => ({
      index: i + 1,
      question: q.question || '',
      type: q.type || 'mcq',
      options: q.options || null,
      userAnswer: ea.responses?.[i]?.answer ?? '',
      correctAnswer: q.answer ?? '',
      isCorrect: null,
      marks: null,
      skillArea: q.skillArea || '',
      explanation: q.explanation || '',
    }));
  }

  // Linked auto-generated module (if this report triggered one)
  let moduleInfo = null;
  if (report?.id) {
    try {
      const allModAssignments = await ModuleAssignments.getAll();
      const linked = (allModAssignments || []).find(ma => ma.assessmentReportId === report.id);
      if (linked) {
        const mod = await db.getModuleById(linked.moduleId);
        if (mod) {
          const sessions = mod.content?.sessions || mod.sessions || [];
          moduleInfo = {
            title: mod.title || 'Generated Module',
            sessionCount: sessions.length,
            sessions: sessions.map(s => ({ title: s.title, dayNumber: s.dayNumber, type: s.type || 'learning', duration: s.duration || '' })),
            progress: linked.progress ?? 0,
            status: linked.status || 'assigned',
            deadline: linked.dueDate || linked.endDate || null,
            startDate: linked.startDate || null,
          };
        }
      }
    } catch { /* module lookup is best-effort — report generation must not fail because of it */ }
  }

  const additionalRoles = (user?.additionalJobRoles || []).map(r => r.roleName).filter(Boolean);

  return {
    employee: {
      name: ea.userName || user?.name || ea.userId || '',
      employeeId: userId,
      email: ea.userEmail || user?.email || report?.userEmail || '',
      company: user?.companyName || req.user.companyId || 'default',
      group: myGroup?.name || '—',
      manager: myGroup?.managerName || '—',
      jobRole: ea.jobRole || user?.jobRole || report?.jobRole || '',
      additionalJobRoles: additionalRoles,
    },
    assessment: {
      name: assessment.title || '',
      type: assessment.targetGroup ? 'Group' : 'Individual',
      difficulty: assessment.difficulty || 'Mixed',
      assignedDate: ea.assignedAt || null,
      startedDate: ea.startedAt || null,
      completedDate: ea.submittedAt || report?.submittedAt || null,
      durationMinutes: durationMs ? Math.round(durationMs / 60000) : null,
      attemptNumber: ea.attemptNumber || 1,
      finalScore: sc.score ?? null,
      correct: sc.correct ?? null,
      total: sc.total ?? questions.length,
      // Always recompute from the assessment's real configured threshold —
      // never a hardcoded cutoff — so this matches the admin's export and
      // the manager dashboard for the exact same submission. Recomputing
      // here (rather than trusting a stored sc.passed) also keeps this
      // correct for reports submitted before passThreshold started being persisted.
      passFail: sc.score != null ? (sc.score >= (assessment.settings?.passPercentage ?? 80) ? 'Pass' : 'Fail') : 'Pending',
      grade: sc.grade || '',
      status: ea.status || 'assigned',
    },
    questions,
    performance: {
      strengths: sc.strengths || [],
      weaknesses: sc.weakAreas || [],
      missingCompetencies: sc.missingCompetencies || [],
      skillGap: sc.skillBreakdown || [],
      aiSummary: report?.aiSummary || sc.readinessLevel || '',
      recommendations: (report?.improvementRecommendations || sc.recommendedLearningAreas || []).map(r => (typeof r === 'string' ? r : r?.area || String(r))),
      classification: sc.performanceClassification?.label || '',
    },
    module: moduleInfo,
    audit: {
      generatedDate: new Date().toISOString(),
      lastUpdated: report?.updatedAt || report?.generatedAt || assessment.updatedAt || null,
      generatedBy: `${req.user.name || req.user.email || req.user.userId} (${req.user.role})`,
    },
  };
}

function fmtDate(d) { return d ? new Date(d).toLocaleString() : '—'; }

// ── Enterprise PDF report (full multi-section HR record) ──────────────────────
async function generateEnterpriseReportPDF(data) {
  const PDFDocument = (await import('pdfkit')).default;
  const chunks = [];
  const doc = new PDFDocument({ margin: 44, size: 'A4' });
  doc.on('data', c => chunks.push(c));
  const done = new Promise(resolve => doc.on('end', () => resolve(Buffer.concat(chunks))));

  const h1 = (t) => { doc.fontSize(16).font('Helvetica-Bold').fillColor('#1e293b').text(t); doc.moveDown(0.3); };
  const h2 = (t, color = '#4f46e5') => { doc.moveDown(0.5); doc.fontSize(11).font('Helvetica-Bold').fillColor(color).text(t.toUpperCase()); doc.moveDown(0.2); };
  const kv = (k, v) => { doc.fontSize(9).font('Helvetica-Bold').fillColor('#334155').text(`${k}: `, { continued: true }); doc.font('Helvetica').fillColor('#1e293b').text(String(v ?? '—')); };

  doc.fontSize(18).font('Helvetica-Bold').fillColor('#4f46e5').text('Enterprise Assessment Report', { align: 'center' });
  doc.fontSize(9).font('Helvetica').fillColor('#64748b').text(`Generated: ${fmtDate(data.audit.generatedDate)}`, { align: 'center' });
  doc.moveDown(1);

  h2('Employee Details');
  kv('Name', data.employee.name); kv('Employee ID', data.employee.employeeId); kv('Email', data.employee.email);
  kv('Company', data.employee.company); kv('Group', data.employee.group); kv('Manager', data.employee.manager);
  kv('Job Role', data.employee.jobRole);
  if (data.employee.additionalJobRoles.length) kv('Additional Job Roles', data.employee.additionalJobRoles.join(', '));

  h2('Assessment Details');
  kv('Assessment Name', data.assessment.name); kv('Type', data.assessment.type); kv('Difficulty', data.assessment.difficulty);
  kv('Date Assigned', fmtDate(data.assessment.assignedDate)); kv('Date Started', fmtDate(data.assessment.startedDate));
  kv('Date Completed', fmtDate(data.assessment.completedDate));
  kv('Duration', data.assessment.durationMinutes != null ? `${data.assessment.durationMinutes} min` : '—');
  kv('Attempt Number', data.assessment.attemptNumber);
  kv('Final Score', data.assessment.finalScore != null ? `${data.assessment.correct}/${data.assessment.total} (${data.assessment.finalScore}%)` : 'Pending');
  kv('Grade', data.assessment.grade); kv('Pass/Fail', data.assessment.passFail);

  h2('Performance Analysis');
  kv('Classification', data.performance.classification);
  kv('Strengths', data.performance.strengths.join(', ') || '—');
  kv('Weaknesses', data.performance.weaknesses.join(', ') || '—');
  kv('Skill Gaps', data.performance.missingCompetencies.join(', ') || '—');
  if (data.performance.aiSummary) kv('AI Summary', data.performance.aiSummary);
  if (data.performance.recommendations.length) kv('Recommendations', data.performance.recommendations.join('; '));

  if (data.module) {
    h2('Module Information');
    kv('Generated Module', data.module.title); kv('Sessions', data.module.sessionCount);
    kv('Progress', `${data.module.progress}%`); kv('Status', data.module.status); kv('Deadline', fmtDate(data.module.deadline));
  }

  h2('Audit Information');
  kv('Generated Date', fmtDate(data.audit.generatedDate)); kv('Last Updated', fmtDate(data.audit.lastUpdated)); kv('Generated By', data.audit.generatedBy);

  // Question-by-question breakdown — own section, paginated
  if (data.questions.length) {
    doc.addPage();
    h1('Question-by-Question Breakdown');
    data.questions.forEach(q => {
      if (doc.y > doc.page.height - 140) doc.addPage();
      doc.fontSize(10).font('Helvetica-Bold').fillColor('#1e293b').text(`Q${q.index}. [${q.type.toUpperCase()}] ${q.question}`, { width: 500 });
      doc.fontSize(9).font('Helvetica').fillColor('#334155');
      doc.text(`Employee Answer: ${q.userAnswer || '—'}`);
      doc.text(`Correct Answer: ${q.correctAnswer || '—'}`);
      const resultColor = q.isCorrect === true ? '#059669' : q.isCorrect === false ? '#dc2626' : '#64748b';
      doc.fillColor(resultColor).text(`Result: ${q.isCorrect === true ? 'Correct' : q.isCorrect === false ? 'Incorrect' : 'Not graded'}${q.marks != null ? ` (${q.marks} marks)` : ''}`);
      doc.fillColor('#334155');
      doc.moveDown(0.5);
    });
  }

  doc.end();
  return done;
}

// ── Enterprise DOCX report ──────────────────────────────────────────────────────
async function generateEnterpriseReportDOCX(data) {
  const docxLib = await import('docx');
  const { Document, Paragraph, TextRun, Table, TableRow, TableCell, Packer, WidthType, HeadingLevel } = docxLib;

  const field = (k, v) => new Paragraph({ children: [new TextRun({ text: `${k}: `, bold: true }), new TextRun({ text: String(v ?? '—') })] });
  const heading = (t) => new Paragraph({ text: t, heading: HeadingLevel.HEADING2, spacing: { before: 200, after: 100 } });

  const children = [
    new Paragraph({ text: 'Enterprise Assessment Report', heading: HeadingLevel.HEADING1 }),
    new Paragraph({ text: `Generated: ${fmtDate(data.audit.generatedDate)}` }),

    heading('Employee Details'),
    field('Name', data.employee.name), field('Employee ID', data.employee.employeeId), field('Email', data.employee.email),
    field('Company', data.employee.company), field('Group', data.employee.group), field('Manager', data.employee.manager),
    field('Job Role', data.employee.jobRole),
    ...(data.employee.additionalJobRoles.length ? [field('Additional Job Roles', data.employee.additionalJobRoles.join(', '))] : []),

    heading('Assessment Details'),
    field('Assessment Name', data.assessment.name), field('Type', data.assessment.type), field('Difficulty', data.assessment.difficulty),
    field('Date Assigned', fmtDate(data.assessment.assignedDate)), field('Date Started', fmtDate(data.assessment.startedDate)),
    field('Date Completed', fmtDate(data.assessment.completedDate)),
    field('Duration', data.assessment.durationMinutes != null ? `${data.assessment.durationMinutes} min` : '—'),
    field('Attempt Number', data.assessment.attemptNumber),
    field('Final Score', data.assessment.finalScore != null ? `${data.assessment.correct}/${data.assessment.total} (${data.assessment.finalScore}%)` : 'Pending'),
    field('Grade', data.assessment.grade), field('Pass/Fail', data.assessment.passFail),

    heading('Performance Analysis'),
    field('Classification', data.performance.classification),
    field('Strengths', data.performance.strengths.join(', ') || '—'),
    field('Weaknesses', data.performance.weaknesses.join(', ') || '—'),
    field('Skill Gaps', data.performance.missingCompetencies.join(', ') || '—'),
    ...(data.performance.aiSummary ? [field('AI Summary', data.performance.aiSummary)] : []),
    ...(data.performance.recommendations.length ? [field('Recommendations', data.performance.recommendations.join('; '))] : []),

    ...(data.module ? [
      heading('Module Information'),
      field('Generated Module', data.module.title), field('Sessions', data.module.sessionCount),
      field('Progress', `${data.module.progress}%`), field('Status', data.module.status), field('Deadline', fmtDate(data.module.deadline)),
    ] : []),

    heading('Audit Information'),
    field('Generated Date', fmtDate(data.audit.generatedDate)), field('Last Updated', fmtDate(data.audit.lastUpdated)), field('Generated By', data.audit.generatedBy),
  ];

  if (data.questions.length) {
    children.push(heading('Question-by-Question Breakdown'));
    const headerRow = new TableRow({
      children: ['#', 'Type', 'Question', 'Employee Answer', 'Correct Answer', 'Result', 'Marks'].map(h =>
        new TableCell({ shading: { fill: '1E293B' }, children: [new Paragraph({ children: [new TextRun({ text: h, bold: true, color: 'FFFFFF' })] })] })
      ),
    });
    const dataRows = data.questions.map(q => new TableRow({
      children: [
        String(q.index), q.type, q.question, String(q.userAnswer || '—'), String(q.correctAnswer || '—'),
        q.isCorrect === true ? 'Correct' : q.isCorrect === false ? 'Incorrect' : 'Not graded',
        q.marks != null ? String(q.marks) : '—',
      ].map(v => new TableCell({ children: [new Paragraph(v)] })),
    }));
    children.push(new Table({ rows: [headerRow, ...dataRows], width: { size: 100, type: WidthType.PERCENTAGE } }));
  }

  const doc = new Document({ sections: [{ children }] });
  return Packer.toBuffer(doc);
}

// ── Enterprise XLSX report — multi-sheet workbook ───────────────────────────────
async function generateEnterpriseReportXLSX(data) {
  const XLSX = await import('xlsx');
  const wb = XLSX.utils.book_new();

  const summaryRows = [
    ['EMPLOYEE DETAILS'], ['Name', data.employee.name], ['Employee ID', data.employee.employeeId], ['Email', data.employee.email],
    ['Company', data.employee.company], ['Group', data.employee.group], ['Manager', data.employee.manager],
    ['Job Role', data.employee.jobRole], ['Additional Job Roles', data.employee.additionalJobRoles.join(', ')],
    [], ['ASSESSMENT DETAILS'],
    ['Assessment Name', data.assessment.name], ['Type', data.assessment.type], ['Difficulty', data.assessment.difficulty],
    ['Date Assigned', fmtDate(data.assessment.assignedDate)], ['Date Started', fmtDate(data.assessment.startedDate)],
    ['Date Completed', fmtDate(data.assessment.completedDate)],
    ['Duration', data.assessment.durationMinutes != null ? `${data.assessment.durationMinutes} min` : '—'],
    ['Attempt Number', data.assessment.attemptNumber],
    ['Final Score', data.assessment.finalScore != null ? `${data.assessment.correct}/${data.assessment.total} (${data.assessment.finalScore}%)` : 'Pending'],
    ['Grade', data.assessment.grade], ['Pass/Fail', data.assessment.passFail],
    [], ['PERFORMANCE ANALYSIS'],
    ['Classification', data.performance.classification],
    ['Strengths', data.performance.strengths.join(', ')], ['Weaknesses', data.performance.weaknesses.join(', ')],
    ['Skill Gaps', data.performance.missingCompetencies.join(', ')], ['AI Summary', data.performance.aiSummary],
    ['Recommendations', data.performance.recommendations.join('; ')],
    ...(data.module ? [[], ['MODULE INFORMATION'], ['Generated Module', data.module.title], ['Sessions', data.module.sessionCount],
      ['Progress', `${data.module.progress}%`], ['Status', data.module.status], ['Deadline', fmtDate(data.module.deadline)]] : []),
    [], ['AUDIT INFORMATION'],
    ['Generated Date', fmtDate(data.audit.generatedDate)], ['Last Updated', fmtDate(data.audit.lastUpdated)], ['Generated By', data.audit.generatedBy],
  ];
  const summarySheet = XLSX.utils.aoa_to_sheet(summaryRows);
  summarySheet['!cols'] = [{ wch: 25 }, { wch: 50 }];
  XLSX.utils.book_append_sheet(wb, summarySheet, 'Summary');

  if (data.questions.length) {
    const qHeaders = ['#', 'Type', 'Question', 'Employee Answer', 'Correct Answer', 'Result', 'Marks', 'Skill Area'];
    const qRows = data.questions.map(q => [q.index, q.type, q.question, q.userAnswer || '—', q.correctAnswer || '—',
      q.isCorrect === true ? 'Correct' : q.isCorrect === false ? 'Incorrect' : 'Not graded', q.marks ?? '—', q.skillArea || '—']);
    const qSheet = XLSX.utils.aoa_to_sheet([qHeaders, ...qRows]);
    qSheet['!cols'] = qHeaders.map((_, i) => ({ wch: i === 2 ? 50 : 20 }));
    XLSX.utils.book_append_sheet(wb, qSheet, 'Questions');
  }

  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
}

/**
 * GET /api/assessments/:id/reports/:userId/download
 * Download a single employee's report (admin/manager/the employee themselves)
 */
router.get('/:id/reports/:userId/download', authenticate, async (req, res) => {
  try {
    const { id, userId } = req.params;
    const format = (req.query.format || 'pdf').toLowerCase();
    // Permission-gated rather than a hardcoded role list, so an admin can
    // revoke/grant this per-user — but self-download must never be gated,
    // an employee can always fetch their own report regardless of permissions.
    const isPrivileged = getEffectivePermissions(req.user).has('reports.download');
    const isSelf = req.user.userId === userId;

    if (!isPrivileged && !isSelf) {
      return res.status(403).json({ success: false, data: null, error: 'Access denied' });
    }

    const assessment = await Assessments.getById(id);
    if (!assessment) return res.status(404).json({ success: false, data: null, error: 'Assessment not found' });

    // Tenant scoping: privileged users may only download reports within their own company.
    // ('default' company stays open for single-tenant installs, and superadmin is global.)
    if (isPrivileged && !isSelf && req.user.role !== 'superadmin') {
      const actorCompany = req.user.companyId || 'default';
      const assessmentCompany = assessment.companyId || 'default';
      if (actorCompany !== 'default' && actorCompany !== assessmentCompany) {
        return res.status(403).json({ success: false, data: null, error: 'Access denied' });
      }
    }

    const ea = assessment.employeeAssignments?.find(a => a.userId === userId);
    if (!ea) return res.status(404).json({ success: false, data: null, error: 'Employee not assigned to this assessment' });

    if (ea.status !== 'submitted') {
      return res.status(404).json({ success: false, data: null, error: 'Assessment not completed yet' });
    }

    const allReports = await Reports.getAll();
    const report = allReports.find(r => r.assessmentId === id && r.userId === userId);
    const fullData = await buildFullReportData({ ea, report, assessment, userId, req });
    const safeTitle = (fullData.employee.name + '-' + (assessment.title || 'Report')).replace(/[^a-zA-Z0-9-_ ]/g, '_');

    if (format === 'pdf') {
      try {
        const buf = await generateEnterpriseReportPDF(fullData);
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename="${safeTitle}.pdf"`);
        return res.send(buf);
      } catch (e) {
        return res.status(500).json({ success: false, data: null, error: 'PDF generation failed: ' + e.message });
      }
    }

    if (format === 'docx') {
      try {
        const buf = await generateEnterpriseReportDOCX(fullData);
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
        res.setHeader('Content-Disposition', `attachment; filename="${safeTitle}.docx"`);
        return res.send(buf);
      } catch (e) {
        return res.status(500).json({ success: false, data: null, error: 'DOCX generation failed: ' + e.message });
      }
    }

    // XLSX — multi-sheet enterprise workbook
    try {
      const buf = await generateEnterpriseReportXLSX(fullData);
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', `attachment; filename="${safeTitle}.xlsx"`);
      return res.send(buf);
    } catch (e) {
      return res.status(500).json({ success: false, data: null, error: 'XLSX generation failed: ' + e.message });
    }
  } catch (e) {
    console.error('[GET /api/assessments/:id/reports/:userId/download]', e);
    res.status(500).json({ success: false, data: null, error: 'Failed to download report' });
  }
});

/**
 * POST /api/assessments/generate-from-jd
 * Preview: generate questions from a specific employee's JD (no assessment saved)
 */
router.post('/generate-from-jd', authenticate, requireRole('admin', 'manager'), llmLimiter, async (req, res) => {
  try {
    const { userId, jobRole, jobDescription, questionCount = 5, questionTypes = ['mcq'] } = req.body;

    let resolvedRole = jobRole;
    let resolvedJD = jobDescription;

    if (userId) {
      const user = await UserStore.getUserById(userId);
      if (user) {
        resolvedRole = resolvedRole || user.jobRole || 'Employee';
        resolvedJD = resolvedJD || user.jobDescription || '';
      }
    }

    const questions = await generateQuestionsFromJD({
      jobRole: resolvedRole || 'Employee',
      jobDescription: resolvedJD || '',
      questionCount,
      questionTypes,
      employeeSeed: `preview-${Date.now()}`,
    });

    res.json({ success: true, data: questions, error: null });
  } catch (e) {
    console.error('[POST /api/assessments/generate-from-jd]', e);
    res.status(500).json({ success: false, data: null, error: 'Failed to generate questions' });
  }
});

/**
 * GET /api/assessments/my
 * Employee: get their own assessments with their specific questions
 */
router.get('/my', authenticate, async (req, res) => {
  try {
    let assessments = await Assessments.getAll() || [];
    const now = new Date();

    const findMine = (list) => list.filter(a =>
      a.employeeAssignments?.some(ea => ea.userId === req.user.userId) ||
      a.targetUsers?.includes(req.user.userId)
    );
    let mine = findMine(assessments);

    // Self-healing: the only two places an employee ever gets an assessment
    // are creation-time (autoAssignPreAssessment) and an admin manually
    // clicking Approve in the Job Library — there is no scheduled or
    // retroactive job that revisits this later. So an employee whose role
    // was approved AFTER their account existed (bulk-imported before
    // approval, jobRole edited afterward, or the role simply wasn't ready
    // yet when they were created) stays permanently stuck with nothing
    // unless someone happens to notice. Check on every load instead: if
    // this employee's current job role has an approved Job Library bank
    // and they aren't attached to any assessment for that role yet, assign
    // it now.
    try {
      const user = await UserStore.getUserById(req.user.userId);
      if (user?.jobRole) {
        const roleMatch = await RoleLibrary.findByName(user.jobRole, user.companyId || 'default');
        if (roleMatch) {
          const existingForRole = mine.find(a => a.fromRoleId === roleMatch.id);
          if (!existingForRole) {
            // Not on any assessment for this role at all — assign one now.
            const { autoAssignPreAssessment } = await import('../services/AssessmentAutoAssign.js');
            await autoAssignPreAssessment(user);
            assessments = await Assessments.getAll() || [];
            mine = findMine(assessments);
          } else {
            // Already on the roster — check for two independent, historical
            // data gaps and backfill both in one write if either applies.
            const patch = {};
            if (!existingForRole.questionBankVersionId) {
              // Predates the role's approval and was never backfilled with a
              // version link (the exact bug that left an approved role's
              // employees with a listed-but-empty assessment) —
              // resolveEmployeeQuestions can't find real questions without it.
              const approvedVersion = await QuestionBankVersions.getApproved(roleMatch.id);
              if (approvedVersion) patch.questionBankVersionId = approvedVersion.id;
            }
            // Title still reflects whichever employee's raw typed job title
            // first created this shared assessment (e.g. "Process
            // Associate-AMI", a fuzzy match onto the "Process Associate"
            // role) instead of the role's own canonical name — confusing
            // for every OTHER employee who plainly, exactly matches this
            // same role and sees a title that doesn't look like their job.
            const canonicalTitle = `Pre-Assessment: ${roleMatch.roleName}`;
            if (existingForRole.title !== canonicalTitle && /^Pre-Assessment: /.test(existingForRole.title || '')) {
              patch.title = canonicalTitle;
            }
            if (Object.keys(patch).length > 0) {
              patch.updatedAt = new Date().toISOString();
              await Assessments.update(existingForRole.id, patch);
              assessments = await Assessments.getAll() || [];
              mine = findMine(assessments);
            }
          }
        }
      }
    } catch (e) {
      console.warn('[assessments GET mine] self-heal auto-assign failed:', e.message);
    }

    const myAssessments = await Promise.all(mine.map(async (a) => {
      const myAssignment = a.employeeAssignments?.find(ea => ea.userId === req.user.userId);

      const assessmentDate = a.assessmentDate ? new Date(a.assessmentDate) : null;
      const deadline = a.deadline ? new Date(a.deadline) : null;

      const isVisible = !assessmentDate || now >= assessmentDate;
      const isExpired = deadline ? now > deadline : false;

      const assignmentStatus = myAssignment?.status || 'assigned';

      // Resolve questions: assessments approved via the versioned Role Library
      // flow (Issues 1/2/7/8/9) store no question text on employeeAssignments —
      // only a roster entry. The frozen bank + this employee's shuffle order
      // live in employee_assessment_assignments / question_bank_versions and
      // are resolved here, at delivery time, never regenerated.
      // Legacy/ad-hoc assessments (POST /api/assessments) still embed
      // `questions` directly on the assignment — read straight through for
      // backward compatibility.
      let questions = null;
      if (isVisible && myAssignment) {
        ({ questions } = await resolveEmployeeQuestions(a, myAssignment, req.user.userId));
      }

      return {
        id: a.id,
        title: a.title,
        assessmentDate: a.assessmentDate,
        deadline: a.deadline || null,
        duration: a.duration,
        status: isExpired && assignmentStatus !== 'submitted' ? 'expired' : assignmentStatus,
        questions,
        assignedAt: myAssignment?.assignedAt || a.createdAt,
        submittedAt: myAssignment?.submittedAt || null,
        jobRole: myAssignment?.jobRole || '',
        isVisible,
        isExpired,
        scoring: assignmentStatus === 'submitted' ? myAssignment?.scoring : null,
      };
    }));

    res.json({ success: true, data: myAssessments, error: null });
  } catch (e) {
    console.error('[assessments GET mine]', e.message);
    res.status(500).json({ success: false, data: null, error: 'Failed to load assessments' });
  }
});

/**
 * GET /api/assessments/reports/all
 * Admin/Manager: all reports
 * NOTE: must be defined BEFORE /:id to avoid route conflict
 */
router.get('/reports/all', authenticate, requireRole('admin', 'manager'), async (req, res) => {
  try {
    const reports = await Reports.getAll();
    const companyId = req.user?.companyId || 'default';

    const UserStore = (await import('../services/UserStore.js')).default;
    const allUsers = await UserStore.getAllUsers({});
    const companyUserIds = new Set(
      allUsers
        .filter(u => (u.companyId || 'default') === companyId)
        .map(u => u.userId || u.id)
    );

    const isAdminReq = req.user.role === 'admin' || req.user.role === 'superadmin';
    let allowedIds = (companyId === 'default' && isAdminReq) ? null : companyUserIds;

    // Manager: restrict to their own team. This used to consider Groups ONLY,
    // so every employee linked through the durable manager_id path (the Assign
    // Manager dropdown, individual creation, bulk import) was invisible here —
    // the direct cause of "the manager can't see their candidate's details".
    // getVisibleEmployeeIds unions both mechanisms. Also: this used to gate on
    // req.user.role === 'manager' (the current X-Active-Role view), so an
    // access-grant manager viewing as "employee" fell through to the
    // companyId==='default' null-allowedIds branch above and saw EVERY
    // company's reports, unrestricted — gate on capability instead.
    if (!isAdminReq) {
      const myEmpIds = await getVisibleEmployeeIds(req.user);
      allowedIds = companyId === 'default'
        ? myEmpIds
        : new Set([...myEmpIds].filter(id => companyUserIds.has(id)));
    }

    const filteredReports = allowedIds === null
      ? reports
      : reports.filter(r => allowedIds.has(r.userId || r.user_id || r.submittedBy));

    res.json({ success: true, data: filteredReports, error: null });
  } catch (e) {
    console.error('[assessments/:id/report]', e.message);
    res.status(500).json({ success: false, data: null, error: 'Failed to load reports' });
  }
});

/**
 * GET /api/assessments/export-all-reports
 * Download ALL assessment reports for this company/manager as XLSX
 */
router.get('/export-all-reports', authenticate, requirePermission('reports.export'), async (req, res) => {
  try {
    const companyId = req.user?.companyId || 'default';
    const role = req.user.role;
    const allReports = await Reports.getAll();

    let reports;
    const isAdminExport = role === 'admin' || role === 'superadmin';
    // Gate on capability, not the raw current view — an access-grant manager
    // browsing in the employee view still gets their team's export here,
    // matching the identical fix applied to /reports/all above. Also
    // switched from Groups-only to getVisibleEmployeeIds (Groups union the
    // durable manager_id path).
    if (!isAdminExport && canActAsManager(req.user)) {
      const allowedIds = await getVisibleEmployeeIds(req.user);
      reports = allReports.filter(r => allowedIds.has(r.userId || r.user_id || r.submittedBy));
    } else if (!isAdminExport) {
      // Genuine employee (no manager capability): only their own reports
      reports = allReports.filter(r => (r.userId || r.user_id) === req.user.userId);
    } else {
      // admin / superadmin: filter by company
      if (companyId !== 'default') {
        const allUsers = await UserStore.getAllUsers({});
        const companyUserIds = new Set(
          allUsers.filter(u => (u.companyId || 'default') === companyId).map(u => u.userId || u.id)
        );
        reports = allReports.filter(r => companyUserIds.has(r.userId || r.user_id || r.submittedBy));
      } else {
        reports = allReports;
      }
    }

    const format = (req.query.format || 'xlsx').toLowerCase();
    const headers = ['Name','Email','Job Role','Assessment','Date','Score %','Grade','Classification','Status','Strengths','Improvement Areas','Recommendations'];
    const rows = reports.map(r => {
      const sc = r.scoring || {};
      return [
        r.userName || r.name || '',
        r.userEmail || r.email || '',
        r.jobRole || '',
        r.assessmentTitle || r.title || '',
        r.submittedAt ? new Date(r.submittedAt).toLocaleDateString() : '',
        sc.score != null ? `${sc.score}%` : '',
        sc.grade || '',
        sc.performanceClassification?.label || '',
        r.status || 'submitted',
        (sc.strengths || []).join('; '),
        (sc.weakAreas || []).join('; '),
        (r.improvementRecommendations || sc.recommendedLearningAreas || []).join('; '),
      ];
    });

    if (format === 'pdf') {
      // Generate HTML and convert to PDF-like downloadable HTML (print-ready)
      const htmlRows = rows.map(row => `<tr>${row.map(cell => `<td>${String(cell).replace(/</g,'&lt;').replace(/>/g,'&gt;')}</td>`).join('')}</tr>`).join('');
      const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Assessment Reports</title>
<style>
body{font-family:Arial,sans-serif;padding:20px;font-size:11px;}
h1{color:#4f46e5;font-size:18px;margin-bottom:16px;}
table{width:100%;border-collapse:collapse;font-size:10px;}
th{background:#1e293b;color:#fff;padding:8px 6px;text-align:left;font-size:9px;text-transform:uppercase;}
td{padding:7px 6px;border-bottom:1px solid #e2e8f0;vertical-align:top;}
tr:nth-child(even){background:#f8fafc;}
.footer{margin-top:20px;text-align:center;color:#94a3b8;font-size:9px;}
@media print{body{padding:10px;}}
</style></head><body>
<h1>All Assessment Reports</h1>
<p style="color:#64748b;font-size:11px;margin-bottom:12px;">Generated: ${new Date().toLocaleString()} · Total Records: ${rows.length}</p>
<table><thead><tr>${headers.map(h=>`<th>${h}</th>`).join('')}</tr></thead>
<tbody>${htmlRows}</tbody></table>
<div class="footer">SkillForge AI · Assessment Reports · Confidential</div>
</body></html>`;
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.setHeader('Content-Disposition', 'attachment; filename="All-Assessment-Reports.html"');
      res.end(html);
    } else if (format === 'doc') {
      // Generate DOCX-compatible HTML wrapped in Word XML
      const tableRows = rows.map(row =>
        `<w:tr>${row.map(cell => `<w:tc><w:p><w:r><w:t>${String(cell).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')}</w:t></w:r></w:p></w:tc>`).join('')}</w:tr>`
      ).join('');
      const headerRow = `<w:tr>${headers.map(h => `<w:tc><w:p><w:pPr><w:jc w:val="left"/></w:pPr><w:r><w:rPr><w:b/></w:rPr><w:t>${h}</w:t></w:r></w:p></w:tc>`).join('')}</w:tr>`;
      const docx = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<?mso-application progid="Word.Document"?>
<w:wordDocument xmlns:w="http://schemas.microsoft.com/office/word/2003/wordml">
<w:body>
<w:p><w:pPr><w:jc w:val="left"/></w:pPr><w:r><w:rPr><w:b/><w:sz w:val="36"/></w:rPr><w:t>All Assessment Reports</w:t></w:r></w:p>
<w:p><w:r><w:t>Generated: ${new Date().toLocaleString()} | Total: ${rows.length}</w:t></w:r></w:p>
<w:tbl><w:tblPr><w:tblW w:w="9000" w:type="dxa"/><w:tblBorders><w:top w:val="single"/><w:left w:val="single"/><w:bottom w:val="single"/><w:right w:val="single"/><w:insideH w:val="single"/><w:insideV w:val="single"/></w:tblBorders></w:tblPr>
${headerRow}${tableRows}
</w:tbl>
</w:body></w:wordDocument>`;
      res.setHeader('Content-Type', 'application/msword');
      res.setHeader('Content-Disposition', 'attachment; filename="All-Assessment-Reports.doc"');
      res.end(docx);
    } else {
      // Default: XLSX
      const XLSX = await import('xlsx');
      const wb = XLSX.utils.book_new();
      const ws = XLSX.utils.aoa_to_sheet([headers, ...rows]);
      ws['!cols'] = [25,30,20,30,15,10,10,18,12,40,40,40].map(w => ({ wch: w }));
      XLSX.utils.book_append_sheet(wb, ws, 'All Reports');
      const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', 'attachment; filename="All-Assessment-Reports.xlsx"');
      res.end(Buffer.isBuffer(buf) ? buf : Buffer.from(buf));
    }
  } catch (e) {
    console.error('[export-all-reports]', e);
    res.status(500).json({ success: false, error: 'Failed to export reports' });
  }
});

// ── Generic tabular export helpers (real PDF/DOCX/XLSX — no HTML-as-PDF hacks) ─
function escapeCell(v) {
  if (v === null || v === undefined) return '';
  return String(v);
}

async function generateTabularPDFBuffer(headers, rows, title, metaLine) {
  const PDFDocument = (await import('pdfkit')).default;
  const chunks = [];
  const doc = new PDFDocument({ margin: 28, size: 'A4', layout: 'landscape' });
  doc.on('data', (c) => chunks.push(c));
  const done = new Promise((resolve) => doc.on('end', () => resolve(Buffer.concat(chunks))));

  doc.fontSize(16).fillColor('#4f46e5').text(title, { align: 'left' });
  doc.moveDown(0.2);
  doc.fontSize(8.5).fillColor('#64748b').text(metaLine);
  doc.moveDown(0.5);

  const startX = doc.page.margins.left;
  const pageWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;
  const n = headers.length || 1;
  const colWidth = pageWidth / n;
  const rowHeight = 18;
  let y = doc.y;

  const drawRow = (cells, isHeader, rowIdx) => {
    if (y + rowHeight > doc.page.height - doc.page.margins.bottom) {
      doc.addPage();
      y = doc.page.margins.top;
    }
    if (isHeader) {
      doc.rect(startX, y, pageWidth, rowHeight).fill('#1e293b');
    } else if (rowIdx % 2 === 1) {
      doc.rect(startX, y, pageWidth, rowHeight).fill('#f8fafc');
    }
    cells.forEach((cell, i) => {
      doc.fontSize(7.5).fillColor(isHeader ? '#ffffff' : '#1e293b');
      doc.text(escapeCell(cell), startX + i * colWidth + 4, y + 5, { width: colWidth - 8, height: rowHeight - 4, ellipsis: true });
    });
    y += rowHeight;
  };

  drawRow(headers, true, -1);
  rows.forEach((r, idx) => drawRow(r, false, idx));

  doc.end();
  return done;
}

async function generateTabularDOCXBuffer(headers, rows, title, metaLine) {
  const docxLib = await import('docx');
  const { Document, Paragraph, TextRun, Table, TableRow, TableCell, Packer, WidthType, HeadingLevel } = docxLib;

  const headerRow = new TableRow({
    children: headers.map((h) => new TableCell({
      shading: { fill: '1E293B' },
      children: [new Paragraph({ children: [new TextRun({ text: escapeCell(h), bold: true, color: 'FFFFFF' })] })],
    })),
  });
  const dataRows = rows.map((r) => new TableRow({
    children: r.map((c) => new TableCell({ children: [new Paragraph(escapeCell(c))] })),
  }));

  const doc = new Document({
    sections: [{
      properties: { page: { size: { orientation: 'landscape' } } },
      children: [
        new Paragraph({ text: title, heading: HeadingLevel.HEADING1 }),
        new Paragraph({ text: metaLine, spacing: { after: 200 } }),
        new Table({ rows: [headerRow, ...dataRows], width: { size: 100, type: WidthType.PERCENTAGE } }),
      ],
    }],
  });
  return Packer.toBuffer(doc);
}

/**
 * POST /api/assessments/export-filtered-reports
 * Exports EXACTLY the rows/columns the client currently has filtered & sorted —
 * guarantees the downloaded file matches the on-screen table 1:1 (no server-side
 * re-filtering, no drift, no duplicate/missing rows).
 * Body: { format: 'xlsx'|'pdf'|'doc', title, headers: string[], rows: any[][], filterSummary? }
 */
router.post('/export-filtered-reports', authenticate, requirePermission('reports.export'), async (req, res) => {
  try {
    const { format = 'xlsx', title, headers, rows, filterSummary } = req.body || {};
    if (!Array.isArray(headers) || !headers.length) return res.status(400).json({ success: false, error: 'headers array required' });
    if (!Array.isArray(rows)) return res.status(400).json({ success: false, error: 'rows array required' });

    // De-duplicate rows (defensive — guarantees "no duplicate rows" even if caller sends dupes)
    const seen = new Set();
    const uniqueRows = rows.filter((r) => {
      const key = JSON.stringify(r);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    const safeTitle = (title || 'Training Reports').slice(0, 200);
    const metaLine = `Generated: ${new Date().toLocaleString()}  |  Total Records: ${uniqueRows.length}${filterSummary ? `  |  Filters: ${filterSummary}` : ''}`;
    const fmt = String(format).toLowerCase();
    const fileBase = safeTitle.replace(/[^a-zA-Z0-9-_ ]/g, '').trim().replace(/\s+/g, '-') || 'Training-Reports';

    if (fmt === 'pdf') {
      const buf = await generateTabularPDFBuffer(headers, uniqueRows, safeTitle, metaLine);
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename="${fileBase}.pdf"`);
      return res.end(buf);
    }
    if (fmt === 'doc' || fmt === 'docx') {
      const buf = await generateTabularDOCXBuffer(headers, uniqueRows, safeTitle, metaLine);
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
      res.setHeader('Content-Disposition', `attachment; filename="${fileBase}.docx"`);
      return res.end(buf);
    }
    // Default: real XLSX
    const XLSX = await import('xlsx');
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.aoa_to_sheet([headers, ...uniqueRows]);
    ws['!cols'] = headers.map(() => ({ wch: 22 }));
    XLSX.utils.book_append_sheet(wb, ws, 'Reports');
    const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${fileBase}.xlsx"`);
    return res.end(Buffer.isBuffer(buf) ? buf : Buffer.from(buf));
  } catch (e) {
    console.error('[export-filtered-reports]', e);
    res.status(500).json({ success: false, error: 'Failed to export reports' });
  }
});

/**
 * POST /api/assessments/generate (legacy compat — module-session knowledge quiz)
 *
 * This is a lightweight per-session comprehension check, not a proctored
 * assessment — it previously ran through generateQuestionsFromJD, the heavy
 * JD-source-grounded pipeline (chunking, up to 5 sequential LLM attempts per
 * chunk, dedup/anti-generic filtering, template padding) built for real
 * hiring assessments. That pipeline is what made "Take Knowledge Quiz" feel
 * slow: several sequential round-trips before a fresh module session ever
 * showed a question, with a `Date.now()`-based seed that also defeated any
 * caching. A single fast generation + a stable cache key (this session's
 * content never changes) fixes both the latency and the wasted repeat calls
 * across employees taking the same session.
 */
router.post('/generate', authenticate, llmLimiter, requirePermission('assessments.generate'), async (req, res) => {
  try {
    const { moduleTitle, moduleDescription, skills, numQuestions, questionTypes, sessionTitle, sessionTopics, sessionKeyPoints } = req.body;
    const topics = Array.isArray(sessionTopics) && sessionTopics.length > 0 ? sessionTopics : skills;

    // `questionTypes` was previously not destructured at all, so the mix the
    // client sent was silently discarded. Derive the ratio from it when
    // supplied, otherwise use the platform's Knowledge Quiz mix (7/2/1).
    let mix = QUIZ_MIX;
    if (Array.isArray(questionTypes) && questionTypes.length > 0) {
      const tally = questionTypes.reduce((acc, t) => {
        const key = normalizeTypeName(t);
        acc[key] = (acc[key] || 0) + 1;
        return acc;
      }, {});
      const total = questionTypes.length;
      mix = {
        mcq: (tally.mcq || 0) / total,
        subjective: (tally.subjective || 0) / total,
        fill_blank: (tally.fill_blank || 0) / total,
      };
    }

    const questions = await generateSessionQuiz({
      moduleTitle, moduleDescription, sessionTitle,
      // The in-module quiz is deliberately 10 questions (that is the
      // requirement) — this used to fall back to 5.
      topics, keyPoints: sessionKeyPoints, numQuestions: numQuestions || 10, mix,
    });

    // AI unavailable — let the client fall back to its own deterministic
    // template questions rather than blocking the session on a slow retry.
    res.json({ success: true, data: questions || [], error: null });
  } catch (e) {
    console.error('[assessments generate-from-jd variant]', e.message);
    res.status(500).json({ success: false, data: null, error: 'Failed to load questions' });
  }
});

/**
 * GET /api/assessments/:id
 * Get single assessment
 */
router.get('/:id', authenticate, async (req, res) => {
  try {
    const assessment = await Assessments.getById(req.params.id);
    if (!assessment) return res.status(404).json({ success: false, data: null, error: 'Not found' });

    const isPrivileged = ['admin', 'manager', 'superadmin'].includes(req.user.role);
    if (!isPrivileged) {
      const myAssignment = assessment.employeeAssignments?.find(ea => ea.userId === req.user.userId);
      if (!myAssignment) return res.status(403).json({ success: false, data: null, error: 'Access denied' });
      const { questions: resolvedQuestions } = await resolveEmployeeQuestions(assessment, myAssignment, req.user.userId);
      const resolved = resolvedQuestions ? { ...myAssignment, questions: resolvedQuestions } : myAssignment;
      return res.json({ success: true, data: { ...assessment, employeeAssignments: [resolved] }, error: null });
    }

    if (!canAccessAssessment(req.user, assessment)) {
      return res.status(403).json({ success: false, data: null, error: 'Access denied' });
    }

    res.json({ success: true, data: await hydrateAssignmentsForAdmin(assessment), error: null });
  } catch (e) {
    console.error('[assessments/:id] error:', e.message);
    res.status(500).json({ success: false, data: null, error: 'Failed to load assessment' });
  }
});

/**
 * POST /api/assessments/:id/submit
 * Employee submits their assessment → auto-generates report
 */
router.post('/:id/submit', authenticate, async (req, res) => {
  try {
    // Accept both `answers` (new frontend format) and `responses` (legacy)
    const { answers, responses: rawResponses } = req.body;
    const assessment = await Assessments.getById(req.params.id);

    if (!assessment) return res.status(404).json({ success: false, data: null, error: 'Assessment not found' });

    const assignmentIdx = assessment.employeeAssignments?.findIndex(ea => ea.userId === req.user.userId);

    if (assignmentIdx === -1 || assignmentIdx === undefined || assignmentIdx == null) {
      return res.status(403).json({ success: false, data: null, error: 'You are not assigned to this assessment' });
    }

    const assignment = assessment.employeeAssignments[assignmentIdx];
    if (assignment.status === 'submitted') {
      return res.status(400).json({ success: false, data: null, error: 'Assessment already submitted' });
    }

    if (assessment.deadline && new Date() > new Date(assessment.deadline)) {
      return res.status(403).json({ success: false, data: null, error: 'Submission deadline has passed' });
    }

    // Resolve through the SAME helper GET /my and GET /:id use, so the set
    // being scored is always identical to the set that was served.
    const { questions: resolvedForScoring } = await resolveEmployeeQuestions(assessment, assignment, req.user.userId);
    const questions = resolvedForScoring || [];

    // Needed below to stamp the submission onto the versioned assignment row.
    // Fetched whenever the assessment is version-backed (previously only when
    // the embedded array was absent, so a version-backed assessment that also
    // carried a legacy embedded array never recorded its submission here).
    const eaaRow = assessment.questionBankVersionId
      ? await EmployeeAssessmentAssignments.getOne(assessment.id, req.user.userId).catch(() => null)
      : null;

    // Safety net against the exact class of bug being fixed here: if the
    // client answered more questions than we just resolved, the two sides
    // disagree about the question set and scoring positionally would silently
    // drop answers and compute against the wrong denominator. Refuse rather
    // than record a wrong score.
    const highestAnsweredIndex = Array.isArray(answers)
      ? answers.reduce((max, a) => (typeof a?.questionIndex === 'number' && a.questionIndex > max ? a.questionIndex : max), -1)
      : (Array.isArray(rawResponses) ? rawResponses.length - 1 : -1);
    if (highestAnsweredIndex >= questions.length) {
      console.error(`[submit] Question-set mismatch for ${req.params.id}/${req.user.userId}: client answered up to index ${highestAnsweredIndex} but server resolved ${questions.length} questions`);
      return res.status(409).json({
        success: false,
        data: null,
        error: 'This assessment was updated while you were taking it. Please reload and start again — your answers were not scored.',
      });
    }

    // Normalise answers into dense array: responses[i] = { answer: string }
    const responses = normaliseResponses(answers, rawResponses, questions.length);

    console.log(`[submit] Assessment ${req.params.id} — ${questions.length} questions, ${responses.filter(r => r?.answer).length} answered`);

    // Score the submission — pass/fail and classification must use the SAME
    // threshold everywhere a submission's result is shown (admin export,
    // employee report, manager dashboard), so resolve it once here from the
    // real per-assessment setting rather than letting each consumer guess.
    const passThreshold = assessment.settings?.passPercentage ?? 80;
    const companyThresholds = await AssessmentThresholds.getByCompany(req.user.companyId || 'default').catch(() => null);
    const scoring = scoreSubmission(questions, responses, passThreshold, companyThresholds?.thresholds);

    // Re-fetch the assessment immediately before writing to shrink the race
    // window against a concurrent submit for the same employee — this is a
    // shared JSONB array (no per-row locking), so a stale in-memory copy
    // spliced back in can silently clobber a submission that landed in the
    // gap between our initial fetch and now (scoring/question-resolution can
    // take a while). Re-checking status here also stops a double-submit from
    // scoring twice and creating a duplicate report.
    const freshAssessment = await Assessments.getById(req.params.id);
    const freshIdx = freshAssessment?.employeeAssignments?.findIndex(ea => ea.userId === req.user.userId);
    if (freshIdx === -1 || freshIdx === undefined || freshIdx == null) {
      return res.status(403).json({ success: false, data: null, error: 'You are not assigned to this assessment' });
    }
    if (freshAssessment.employeeAssignments[freshIdx].status === 'submitted') {
      return res.status(400).json({ success: false, data: null, error: 'Assessment already submitted' });
    }

    const submittedAt = new Date().toISOString();
    const updatedAssignments = [...freshAssessment.employeeAssignments];
    updatedAssignments[freshIdx] = {
      ...freshAssessment.employeeAssignments[freshIdx],
      status: 'submitted',
      submittedAt,
      responses,      // save normalised responses
      scoring,
    };

    // Generate and persist the full report BEFORE flipping the assessment to
    // "submitted" — if report creation fails, the assignment stays
    // unsubmitted so the employee can retry, instead of being permanently
    // locked out (by the status==='submitted' guard above) with no report.
    const report = {
      id: randomUUID(),
      assessmentId: assessment.id,
      assessmentTitle: assessment.title,
      userId: req.user.userId,
      companyId: req.user.companyId || 'default',
      userName: req.user.name || assignment.userName,
      jobRole: assignment.jobRole,
      submittedAt,
      ...scoring,
      questions,
      responses,
      generatedAt: new Date().toISOString(),
      improvementRecommendations: scoring.weakAreas?.length
        ? scoring.weakAreas.map(a => `Focus on strengthening "${a}" through targeted practice and study`)
        : [],
    };

    await Reports.create(report);

    // Upgrade the template improvementRecommendations to genuinely specific,
    // AI-generated guidance in the background — submission must not wait on
    // an LLM call. The template already saved above is a perfectly usable
    // placeholder if this never completes (LLM down, etc.).
    if (scoring.weakAreas?.length > 0) {
      setImmediate(async () => {
        try {
          const cacheKey = `improvement_recs_${LLMCache.hash(JSON.stringify(scoring.weakAreas) + (assignment.jobRole || ''))}`;
          let recommendations = LLMCache.get(cacheKey);
          if (!recommendations) {
            const prompt = `An employee in the role "${assignment.jobRole || 'this position'}" scored weak on these specific skill areas from an assessment: ${scoring.weakAreas.map(a => `"${a}"`).join(', ')}.
For EACH weak area, write one concrete, specific improvement recommendation (1-2 sentences) — name actual practice methods, resources, or exercises relevant to that skill, not generic advice like "practice more". Return ONLY a JSON object: {"recommendations": ["...", "..."]} with exactly ${scoring.weakAreas.length} items, in the same order as the weak areas listed.`;
            const result = await GeminiService.generateJSONFast(prompt);
            if (Array.isArray(result?.recommendations) && result.recommendations.length === scoring.weakAreas.length) {
              recommendations = result.recommendations;
              LLMCache.set(cacheKey, recommendations, LLMCache.TTL.MODULE);
            }
          }
          if (recommendations) {
            await Reports.update(report.id, { improvementRecommendations: recommendations });
          }
        } catch (e) {
          console.warn('[assessment submit] AI improvement recommendations failed, template stays:', e.message);
        }
      });
    }

    // Persist updated assessment to Supabase
    await Assessments.update(req.params.id, {
      employeeAssignments: updatedAssignments,
      updatedAt: new Date().toISOString(),
    });

    // Version-backed assignments also update their own row — this is the
    // record that keeps a completed assessment tied to the exact bank version
    // the employee was tested on, independent of any later regenerate/approve.
    if (eaaRow) {
      await EmployeeAssessmentAssignments.updateSubmission(eaaRow.id, {
        status: 'submitted',
        submittedAt,
        scoring,
      });
    }

    // ── Auto-generate + auto-assign module (non-blocking) ─────────────────────
    setImmediate(async () => {
      try {
        const targetUserId = req.user.userId;
        console.log(`[auto-assign] Starting for user=${targetUserId} report=${report.id}`);

        const user = await UserStore.getUserById(targetUserId);
        const skills = report.weakAreas?.length > 0
          ? report.weakAreas
          : report.missingCompetencies?.length > 0
            ? report.missingCompetencies
            : ['Core Skills'];
        const jdContext = (user?.jobDescription || '').slice(0, 2000);
        const jdSkillsCtx = (user?.jdSkills || []).join(', ');
        const jobRole = report.jobRole || user?.jobRole || 'Professional';
        const score = report.score || 0;
        const classification = report.performanceClassification?.label || 'Average';

        // ── Adaptive learning-path sizing (enterprise LMS pattern) ──────────
        // Base length from performance classification, then adjusted by the
        // actual number of skill gaps and JD complexity — so two employees with
        // the same score but different gap profiles get different journeys.
        const depthMap = {
          'Critical':         { numSessions: 8, difficulty: 'beginner',     priority: 'urgent', pathType: 'Extended Learning Journey',  dailyMinutes: 60 },
          'Needs Improvement':{ numSessions: 6, difficulty: 'intermediate', priority: 'high',   pathType: 'Structured Learning Plan',   dailyMinutes: 50 },
          'Average':          { numSessions: 5, difficulty: 'intermediate', priority: 'high',   pathType: 'Standard Learning Plan',     dailyMinutes: 45 },
          'Good':             { numSessions: 4, difficulty: 'intermediate', priority: 'medium', pathType: 'Focused Learning Plan',      dailyMinutes: 40 },
          'Excellent':        { numSessions: 3, difficulty: 'advanced',     priority: 'medium', pathType: 'Targeted Skill Boost',       dailyMinutes: 35 },
          'Outstanding':      { numSessions: 2, difficulty: 'advanced',     priority: 'low',    pathType: 'Refresher',                  dailyMinutes: 30 },
        };
        const base = depthMap[classification] || depthMap['Average'];
        // Gap-count adjustment: many distinct gaps need more runway; very few need less.
        const gapCount = skills.length;
        let numSessions = base.numSessions;
        if (gapCount >= 6) numSessions += 2;
        else if (gapCount >= 4) numSessions += 1;
        else if (gapCount <= 1 && numSessions > 3) numSessions -= 1;
        // JD complexity adjustment: long, skill-dense JDs warrant slightly deeper coverage.
        const jdComplexity = (user?.jdSkills?.length || 0) >= 8 || jdContext.length > 1500;
        if (jdComplexity && numSessions < 10) numSessions += 1;
        numSessions = Math.min(Math.max(numSessions, 2), 10);
        const depth = { ...base, numSessions };

        // Module generation — routed through GeminiService (multi-key Gemini + Cerebras/Groq
        // fallback + rate-pacing) with an LLMCache tier, instead of a raw single-key Groq fetch.
        let moduleContent = null;
        {
          try {
            const prompt = `Design a personalized corporate learning journey for an employee based on their assessment results. You are an enterprise L&D instructional designer.

=== PERSONALIZATION PRIORITY (highest first) ===
1. Assessment performance: ${classification}, score ${score}%
2. Specific skill gaps found in the assessment (listed below)
3. Job Description requirements
4. Job Role: ${jobRole}

=== EMPLOYEE CONTEXT ===
Job Role: ${jobRole}
Classification: ${classification} (Score: ${score}%)
Path Type: ${depth.pathType} (${depth.numSessions} days, ~${depth.dailyMinutes} min/day)
${jdSkillsCtx ? `JD Skills: ${jdSkillsCtx}` : ''}
${jdContext ? `Job Description:\n${jdContext}` : ''}

=== SKILL GAPS (address ALL of these) ===
${skills.map((s, i) => `${i + 1}. ${s}`).join('\n')}

=== LEARNING JOURNEY DESIGN RULES ===
1. Generate EXACTLY ${depth.numSessions} sessions — one per day, ~${depth.dailyMinutes} minutes each.
2. Each session must directly address a specific skill gap above. Cover ALL gaps across the journey.
3. Session content must match the employee's job domain (${jobRole}) — no generic tech content for non-technical roles.
4. Progressive structure: Day 1 = foundations of the weakest area; middle days = applied practice per gap; the FINAL session = capstone that integrates all gaps (mark it "type": "capstone") with a realistic workplace case study and a slightly harder final quiz.
5. Each session MUST include:
   - learningObjectives: 2-3 specific "By the end of this session you will be able to..." statements
   - topics, keyPoints (6-8 substantial, specific takeaways — this is the core content, not a summary afterthought)
   - definitions: 3-4 domain-specific terms this employee needs for this exact topic, each with a precise definition
   - explanation: 2-3 paragraphs teaching the material like a subject-matter expert briefing this specific employee — reference their actual JD wording or assessment gap wording where relevant, not generic industry boilerplate
   - visual: ONLY when genuinely natural for this session's content — a flowchart for a real sequential process, or a bar/pie chart for genuinely comparable/proportional data; set type "none" and omit flowSteps/data otherwise. Never force one.
   - quiz: 3-5 scenario-based multiple-choice questions on that day's topic
6. Do NOT include a practical exercise or case study — the platform's quiz already handles applied assessment; keep this response focused on explanation/keyPoints/definitions/visual/quiz.
7. Vary sentence structure and phrasing across sessions and avoid interchangeable filler ("plays a crucial role", "in today's fast-paced environment") — every session should read like it could only apply to THIS employee's actual role and gaps, not be reusable verbatim for a different one.
8. Module-level: objectives (what the journey covers) and expectedOutcomes (observable on-the-job behaviors after completion).

Return ONLY valid JSON matching exactly this structure:
{
  "title": "string (specific, not generic)",
  "description": "string (2-3 sentences)",
  "objectives": ["string", ...],
  "expectedOutcomes": ["observable on-the-job behavior", ...],
  "estimatedDuration": "${depth.numSessions} days",
  "sessions": [
    {
      "title": "string",
      "dayNumber": 1,
      "type": "learning | capstone",
      "duration": "${depth.dailyMinutes} mins",
      "learningObjectives": ["By the end of this session...", ...],
      "topics": ["string", ...],
      "keyPoints": ["string", ...],
      "definitions": [{"term": "string", "definition": "string"}, ...],
      "explanation": "2-3 paragraphs, specific to this employee's role/gap/JD",
      "visual": {
        "type": "flowchart | bar | pie | none",
        "title": "string",
        "flowSteps": ["only when type is flowchart"],
        "data": [{"label": "string", "value": 0}]
      },
      "quiz": [
        {
          "question": "scenario-based question",
          "options": ["A) ...", "B) ...", "C) ...", "D) ..."],
          "answer": "A",
          "explanation": "string"
        }
      ]
    }
  ]
}`;

            const cacheKey = `autoassign_module_${LLMCache.hash(jobRole + skills.join(',') + classification + depth.numSessions + jdContext.slice(0, 100))}`;
            const cached = LLMCache.get(cacheKey);
            if (cached) {
              moduleContent = cached;
            } else {
              const result = await GeminiService.generateJSON(prompt, '', { maxTokens: 8000 });
              if (result?.sessions && Array.isArray(result.sessions) && result.sessions.length > 0) {
                moduleContent = result;
                LLMCache.set(cacheKey, moduleContent, LLMCache.TTL.MODULE);
                console.log(`[auto-assign] Generated module: "${moduleContent.title}" with ${moduleContent.sessions?.length} sessions`);
              }
            }
          } catch (e) {
            console.warn('[auto-assign] Module generation failed:', e.message);
          }
        }

        // Build sessions with day-based unlock dates
        const startDate = new Date();
        const rawSessions = moduleContent?.sessions?.length > 0
          ? moduleContent.sessions
          : Array.from({ length: depth.numSessions }, (_, i) => {
              const isCapstone = i === depth.numSessions - 1;
              // Non-wrapping: `skills[i % skills.length]` repeated the same
              // gap verbatim every few days whenever there were fewer gaps
              // than days, which is why fallback modules read identically
              // day to day. Later days get an explicit progression stage.
              const STAGES = ['Applied', 'Advanced', 'In Practice', 'Review & Integration'];
              const s = i < skills.length
                ? skills[i]
                : `${skills[i % skills.length]} — ${STAGES[Math.min(Math.floor(i / skills.length) - 1, STAGES.length - 1)]}`;
              return {
                title: isCapstone ? `Day ${i + 1}: Capstone — Applying ${skills.slice(0, 3).join(', ')}` : `Day ${i + 1}: ${s}`,
                dayNumber: i + 1,
                type: isCapstone ? 'capstone' : 'learning',
                duration: `${depth.dailyMinutes} mins`,
                learningObjectives: isCapstone
                  ? [`By the end of this session you will be able to integrate ${skills.slice(0, 3).join(', ')} in a realistic ${jobRole} scenario`]
                  : [`By the end of this session you will be able to explain the core principles of ${s}`, `By the end of this session you will be able to apply ${s} in your daily ${jobRole} work`],
                topics: [s],
                keyPoints: [`Understanding ${s}`, `Applying ${s} in ${jobRole} context`, `Common pitfalls with ${s}`, `How ${s} connects to your day-to-day ${jobRole} responsibilities`],
                definitions: [{ term: s, definition: `A skill area identified in your assessment as needing development, specific to the ${jobRole} role.` }],
                explanation: `This session focuses on ${s}, one of the gap areas identified in your recent assessment. Strengthening ${s} directly supports your effectiveness as a ${jobRole}, and the concepts here build toward the capstone session where you'll apply everything together.`,
                visual: { type: 'none' },
                quiz: [{
                  question: `What is the most important aspect of ${s} for a ${jobRole}?`,
                  options: ['A) Memorizing theory only', `B) Applying ${s} practically`, 'C) Avoiding it entirely', 'D) Delegating to others'],
                  answer: 'B',
                  explanation: `Practical application of ${s} is critical for ${jobRole} effectiveness.`,
                }],
              };
            });

        // Same quiz-type normalization as modules.js — neither the LLM output
        // above nor this file's own deterministic fallback quiz stamps a
        // `type` field, and the employee-facing renderer gates strictly on
        // it, leaving the answer area blank for anything unrecognized.
        const KNOWN_QUIZ_TYPES = new Set(['mcq', 'fill_blank', 'subjective']);
        rawSessions.forEach(session => {
          if (!Array.isArray(session.quiz)) return;
          session.quiz.forEach(q => {
            if (!KNOWN_QUIZ_TYPES.has(q.type)) {
              q.type = Array.isArray(q.options) && q.options.length > 0 ? 'mcq' : 'subjective';
            }
          });
        });

        let sessions = rawSessions.map((s, i) => {
          const dayNumber = s.dayNumber || (i + 1);
          const unlockDate = new Date(startDate);
          unlockDate.setDate(unlockDate.getDate() + (dayNumber - 1));
          return { ...s, dayNumber, sessionIndex: i, unlockDate: unlockDate.toISOString() };
        });

        // Generate every remaining day's Knowledge Quiz NOW, in parallel, so
        // it's already sitting in the DB before this employee ever opens any
        // specific day — the main content-generation call above can omit or
        // truncate a session's quiz if the response nears its token budget,
        // and this closes that gap regardless of cause. Without this, the
        // first time a day without an embedded quiz was opened, the employee
        // sat on a live "Generating your knowledge quiz…" LLM call.
        sessions = await ensureAllSessionQuizzes(sessions, { moduleTitle: moduleContent?.title, moduleDescription: moduleContent?.description });

        const estimatedDays = sessions.length;
        const endDate = new Date(startDate);
        endDate.setDate(endDate.getDate() + estimatedDays + 2);

        const moduleTitle = moduleContent?.title || `${classification} Training Plan: ${skills.slice(0, 2).join(' & ')}`;
        console.log(`[auto-assign] Creating module "${moduleTitle}" (${sessions.length} sessions, ${depth.difficulty})`);

        // Derived from this employee's ACTUAL generated sessions (not a
        // separate LLM call) — the Plan/Roadmap tab previously showed
        // nothing for auto-assigned modules because this pipeline never
        // populated a `roadmap` field at all, even though the module-level
        // objectives/expectedOutcomes/pathType below were already being
        // generated per-employee and simply never surfaced anywhere.
        const phaseSplit = Math.max(1, Math.ceil(sessions.length / 3));
        const roadmap = [
          {
            title: 'Foundation',
            description: `Days 1-${Math.min(phaseSplit, sessions.length)}: ${sessions.slice(0, phaseSplit).map(s => s.title).join('; ')}`,
            duration: `Day${phaseSplit > 1 ? 's' : ''} 1-${Math.min(phaseSplit, sessions.length)}`,
          },
          ...(sessions.length > phaseSplit ? [{
            title: 'Application',
            description: `Days ${phaseSplit + 1}-${Math.min(phaseSplit * 2, sessions.length)}: ${sessions.slice(phaseSplit, phaseSplit * 2).map(s => s.title).join('; ')}`,
            duration: `Days ${phaseSplit + 1}-${Math.min(phaseSplit * 2, sessions.length)}`,
          }] : []),
          ...(sessions.length > phaseSplit * 2 ? [{
            title: 'Mastery',
            description: `Days ${phaseSplit * 2 + 1}-${sessions.length}: ${sessions.slice(phaseSplit * 2).map(s => s.title).join('; ')}`,
            duration: `Days ${phaseSplit * 2 + 1}-${sessions.length}`,
          }] : []),
        ];

        // Create module in DB (null createdBy avoids FK issues)
        const newModule = await db.createModule({
          title: moduleTitle,
          description: moduleContent?.description || `Personalized ${depth.difficulty} training for ${jobRole} targeting: ${skills.join(', ')}`,
          category: jobRole || 'Training',
          difficulty: depth.difficulty,
          estimatedDuration: `${estimatedDays} days`,
          skills,
          tasks: sessions.map(s => ({
            title: s.title, duration: s.duration, type: 'session',
            dayNumber: s.dayNumber, topics: s.topics || [],
          })),
          resources: moduleContent?.resources || [],
          completionCriteria: 'Complete all sessions and quizzes',
          progressTracking: true,
          companyId: req.user.companyId || null,
          content: {
            isMandatory: true,
            sessions,
            objectives: moduleContent?.objectives || skills.map(s => `Master ${s} skills`),
            expectedOutcomes: moduleContent?.expectedOutcomes || skills.map(s => `Apply ${s} confidently in day-to-day ${jobRole} work`),
            roadmap,
            pathType: depth.pathType,
            dailyMinutes: depth.dailyMinutes,
            estimatedMinutesTotal: depth.dailyMinutes * sessions.length,
            milestones: [
              { at: 1, label: 'Journey started' },
              ...(sessions.length >= 4 ? [{ at: Math.ceil(sessions.length / 2), label: 'Halfway checkpoint' }] : []),
              { at: sessions.length, label: sessions.length > 1 ? 'Capstone & completion' : 'Completion' },
            ],
            assessmentSource: report.id,
            jobRole,
            assessmentGaps: skills,
            classification,
            score,
            startDate: startDate.toISOString(),
            endDate: endDate.toISOString(),
            contentGeneratedAt: new Date().toISOString(),
          },
        }, null);

        const moduleId = newModule?.id;
        if (!moduleId) {
          console.error('[auto-assign] Module creation returned no ID — possible DB schema issue. Check Supabase modules table.');
          return;
        }
        console.log(`[auto-assign] Module created: id=${moduleId}`);

        // Verify sessions were persisted — re-fetch and patch if content is empty
        try {
          const saved = await db.getModuleById(moduleId);
          const savedSessions = saved?.content?.sessions || saved?.sessions || [];
          if (savedSessions.length === 0 && sessions.length > 0) {
            console.warn(`[auto-assign] Sessions missing from saved module ${moduleId} — patching content`);
            await db.updateModule(moduleId, {
              content: {
                isMandatory: true,
                sessions,
                objectives: moduleContent?.objectives || skills.map(s => `Master ${s} skills`),
                assessmentSource: report.id,
                jobRole,
                assessmentGaps: skills,
                classification,
                score,
                startDate: startDate.toISOString(),
                endDate: endDate.toISOString(),
                contentGeneratedAt: new Date().toISOString(),
              },
            });
            console.log(`[auto-assign] Sessions patched for module ${moduleId}`);
          }
        } catch (verifyErr) {
          console.warn(`[auto-assign] Session verify failed for ${moduleId}:`, verifyErr.message);
        }

        // Deepen each day's content in the background, one day per call, so
        // every day gets its own full token budget instead of 1/Nth of a
        // single shared 8k response. Day-locking means day N is not reachable
        // until day N, so this lands long before anyone can open it.
        startDeepContentJob(moduleId, {
          moduleTitle,
          moduleDescription: moduleContent?.description || '',
          jobRole,
          jdContext,
          gaps: skills,
          difficulty: depth.difficulty,
        });

        // Create assignment — assigned_by MUST be null (not 'system') due to FK constraint
        await UserStore.createAssignment({
          type: 'module',
          assignable_id: moduleId,
          assignable_type: 'module',
          assigned_by: null,
          assigned_to_user: targetUserId,
          assigned_by_manager: null,
          priority: depth.priority,
          due_date: endDate.toISOString(),
          status: 'assigned',
          progress: 0,
          title: moduleTitle,
        });
        console.log(`[auto-assign] Assignment created for user=${targetUserId}`);

        // Create DataStore module_assignment record
        await ModuleAssignments.create({
          id: randomUUID(),
          moduleId,
          userId: targetUserId,
          isMandatory: true,
          assignedAt: startDate.toISOString(),
          assignedBy: null,
          status: 'assigned',
          assessmentReportId: report.id,
          startDate: startDate.toISOString(),
          endDate: endDate.toISOString(),
          dueDate: endDate.toISOString(),
        });

        console.log(`[auto-assign] ✅ Complete — module "${moduleTitle}" assigned to user ${targetUserId}`);
      } catch (e) {
        console.error('[auto-assign] FAILED:', e.message);
        if (e.stack) console.error('[auto-assign] Stack:', e.stack.split('\n').slice(0, 5).join('\n'));
      }
    });

    res.json({ success: true, data: { report, scoring }, error: null });
  } catch (e) {
    console.error('[POST /api/assessments/:id/submit]', e);
    res.status(500).json({ success: false, data: null, error: 'Failed to submit assessment' });
  }
});

/**
 * GET /api/assessments/:id/report
 * Get report for a specific assessment
 */
router.get('/:id/report', authenticate, async (req, res) => {
  try {
    const assessment = await Assessments.getById(req.params.id);
    if (!assessment) return res.status(404).json({ success: false, data: null, error: 'Not found' });

    const isPrivileged = ['admin', 'manager', 'superadmin'].includes(req.user.role);
    if (isPrivileged && !canAccessAssessment(req.user, assessment)) {
      return res.status(403).json({ success: false, data: null, error: 'Access denied' });
    }

    const allReports = await Reports.getAll();
    const filtered = isPrivileged
      ? allReports.filter(r => r.assessmentId === req.params.id)
      : allReports.filter(r => r.assessmentId === req.params.id && r.userId === req.user.userId);

    res.json({ success: true, data: filtered, error: null });
  } catch (e) {
    console.error('[assessments/:id/report] error:', e.message);
    res.status(500).json({ success: false, data: null, error: 'Failed to load report' });
  }
});

/**
 * PUT /api/assessments/:id
 * Update (admin/manager)
 */
router.put('/:id', authenticate, requireRole('admin', 'manager'), async (req, res) => {
  try {
    const existing = await Assessments.getById(req.params.id);
    if (!existing) return res.status(404).json({ success: false, data: null, error: 'Not found' });
    if (!canAccessAssessment(req.user, existing)) {
      return res.status(403).json({ success: false, data: null, error: 'Access denied' });
    }

    const updated = await Assessments.update(req.params.id, {
      ...req.body,
      id: req.params.id,
      updatedAt: new Date().toISOString(),
    });

    res.json({ success: true, data: updated || existing, error: null });
  } catch (e) {
    console.error('[assessments PUT :id] error:', e.message);
    res.status(500).json({ success: false, data: null, error: 'Failed to update assessment' });
  }
});

/**
 * DELETE /api/assessments/:id
 * Delete (admin/manager)
 */
router.delete('/:id', authenticate, requireRole('admin', 'manager'), async (req, res) => {
  try {
    const existing = await Assessments.getById(req.params.id);
    if (!existing) return res.status(404).json({ success: false, data: null, error: 'Not found' });
    if (!canAccessAssessment(req.user, existing)) {
      return res.status(403).json({ success: false, data: null, error: 'Access denied' });
    }
    await Assessments.delete(req.params.id);
    res.json({ success: true, data: { id: req.params.id }, error: null });
  } catch (e) {
    console.error('[assessments DELETE :id] error:', e.message);
    res.status(500).json({ success: false, data: null, error: 'Failed to delete assessment' });
  }
});

export default router;
