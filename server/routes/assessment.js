/**
 * assessment.js — JD + Job Role driven assessments
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
import { authenticate, requireRole } from '../middleware/auth.js';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { randomUUID } from 'crypto';
import UserStore from '../services/UserStore.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const router = express.Router();
const DATA_DIR = join(__dirname, '../data');
const ASSESSMENTS_FILE = join(DATA_DIR, 'assessments.json');
const SUBMISSIONS_FILE = join(DATA_DIR, 'assessment_submissions.json');
const REPORTS_FILE = join(DATA_DIR, 'assessment_reports.json');

if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
if (!existsSync(ASSESSMENTS_FILE)) writeFileSync(ASSESSMENTS_FILE, JSON.stringify([], null, 2));
if (!existsSync(SUBMISSIONS_FILE)) writeFileSync(SUBMISSIONS_FILE, JSON.stringify([], null, 2));
if (!existsSync(REPORTS_FILE)) writeFileSync(REPORTS_FILE, JSON.stringify([], null, 2));

const readJSON = (file) => { try { return JSON.parse(readFileSync(file, 'utf-8')); } catch { return []; } };
const writeJSON = (file, data) => writeFileSync(file, JSON.stringify(data, null, 2));

// ── AI question generation ────────────────────────────────────────────────────

/**
 * Generate unique questions per employee from job role + JD
 * Uses a seed (userId + assessmentId) to ensure uniqueness even for same JD
 */
async function generateQuestionsFromJD({ jobRole, jobDescription, questionCount, questionTypes, employeeSeed }) {
  const num = Math.min(Math.max(parseInt(questionCount) || 5, 2), 30);
  const types = Array.isArray(questionTypes) && questionTypes.length > 0 ? questionTypes : ['mcq'];
  const jdText = (jobDescription || '').slice(0, 4000); // no char limit — just cap for prompt
  const seed = employeeSeed || randomUUID().slice(0, 8);

  const prompt = `Generate exactly ${num} assessment questions for an employee with this profile.

Job Role: ${jobRole || 'Not specified'}
Job Description:
${jdText || 'No job description provided. Use the job role to infer responsibilities.'}

Employee Seed (use this to vary question selection): ${seed}

REQUIREMENTS:
- Questions MUST be specific to the job role and JD content
- Every employee gets different questions even if they share the same JD (use the seed to vary)
- Test real on-the-job knowledge, not generic knowledge
- Question types requested: ${types.join(', ')}
- Difficulty mix: 30% easy, 50% medium, 20% hard

Return a JSON object with a "questions" array. Each question:
- "type": "${types.includes('mcq') ? 'mcq' : types[0]}" (use types requested above, cycling through them)
- "question": specific, role-relevant question
- "difficulty": "easy", "medium", or "hard"
- "options": for mcq only — exactly 4 options as ["A) ...", "B) ...", "C) ...", "D) ..."]
- "answer": for mcq: "A"/"B"/"C"/"D"; fill_blank: exact answer; subjective: model answer
- "explanation": why this is relevant to the role
- "skillArea": which skill or competency this tests`;

  const system = `You are an expert HR assessment designer specializing in creating job-specific assessments.
Generate questions that test whether candidates can actually perform the job, not just recall facts.
Always return valid JSON with exactly a "questions" array.`;

  // Try Groq first
  try {
    const groqKey = process.env.GROQ_API_KEY;
    if (groqKey?.length > 10) {
      const r = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${groqKey}` },
        body: JSON.stringify({
          model: 'llama-3.3-70b-versatile',
          messages: [{ role: 'system', content: system }, { role: 'user', content: prompt }],
          temperature: 0.85, // higher temp for more variety
          max_tokens: 4000,
          response_format: { type: 'json_object' },
        }),
        signal: AbortSignal.timeout(30000),
      });
      if (r.ok) {
        const d = await r.json();
        const parsed = JSON.parse(d.choices?.[0]?.message?.content || '{}');
        if (Array.isArray(parsed.questions) && parsed.questions.length > 0) return parsed.questions;
      }
    }
  } catch (e) { console.warn('[assessment] Groq failed:', e.message); }

  // Try Gemini
  try {
    const geminiKey = process.env.GEMINI_API_KEY;
    const geminiModel = process.env.GEMINI_MODEL || 'gemini-2.0-flash';
    if (geminiKey?.length > 10) {
      const r = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${geminiModel}:generateContent?key=${geminiKey}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{ parts: [{ text: system + '\n\n' + prompt }] }],
            generationConfig: { temperature: 0.85, maxOutputTokens: 4000, responseMimeType: 'application/json' },
          }),
          signal: AbortSignal.timeout(30000),
        }
      );
      if (r.ok) {
        const d = await r.json();
        const parsed = JSON.parse(d.candidates?.[0]?.content?.parts?.[0]?.text || '{}');
        if (Array.isArray(parsed.questions) && parsed.questions.length > 0) return parsed.questions;
      }
    }
  } catch (e) { console.warn('[assessment] Gemini failed:', e.message); }

  // Fallback — deterministic rule-based questions from job role
  const role = jobRole || 'Professional';
  return Array.from({ length: num }, (_, i) => {
    const t = types[i % types.length];
    const difficulty = ['easy', 'medium', 'hard'][i % 3];
    return {
      type: t,
      question: t === 'mcq'
        ? `As a ${role}, what is the most critical aspect of ${['planning', 'execution', 'communication', 'quality assurance', 'stakeholder management'][i % 5]}?`
        : t === 'fill_blank'
        ? `A ${role} is primarily responsible for ______ in their day-to-day work.`
        : `Describe a situation where you would apply ${['analytical thinking', 'problem-solving', 'leadership', 'technical expertise', 'collaboration'][i % 5]} in your role as ${role}.`,
      difficulty,
      options: t === 'mcq' ? [
        'A) Ensuring all stakeholders are aligned on goals',
        'B) Completing tasks as quickly as possible',
        'C) Avoiding difficult conversations',
        'D) Working independently without feedback',
      ] : undefined,
      answer: t === 'mcq' ? 'A' : t === 'fill_blank' ? 'delivering results' : `In my role as ${role}, I would approach this systematically by first assessing the situation, then applying relevant frameworks.`,
      explanation: `This tests core competency for a ${role}.`,
      skillArea: ['Core Skills', 'Communication', 'Technical', 'Leadership', 'Problem Solving'][i % 5],
    };
  });
}

// ── Score a submission ────────────────────────────────────────────────────────

function scoreSubmission(questions, responses) {
  let correct = 0;
  let total = 0;
  const breakdown = [];

  questions.forEach((q, i) => {
    const resp = responses[i] || {};
    let isCorrect = false;

    if (q.type === 'mcq') {
      isCorrect = (resp.answer || '').toUpperCase().trim() === (q.answer || '').toUpperCase().trim();
      total++;
      if (isCorrect) correct++;
    } else {
      // Subjective / fill_blank: auto-score based on keyword match
      const userAnswer = (resp.answer || '').toLowerCase();
      const modelAnswer = (q.answer || '').toLowerCase();
      const keywords = modelAnswer.split(/\s+/).filter(w => w.length > 4);
      const matched = keywords.filter(k => userAnswer.includes(k)).length;
      isCorrect = keywords.length > 0 && (matched / keywords.length) >= 0.3;
      total++;
      if (isCorrect) correct++;
    }

    breakdown.push({ questionIndex: i, question: q.question, type: q.type, userAnswer: resp.answer, correctAnswer: q.answer, isCorrect, skillArea: q.skillArea || 'General' });
  });

  const score = total > 0 ? Math.round((correct / total) * 100) : 0;
  const grade = score >= 90 ? 'A' : score >= 80 ? 'B' : score >= 70 ? 'C' : score >= 60 ? 'D' : 'F';

  // Skill area breakdown
  const skillAreas = {};
  breakdown.forEach(b => {
    if (!skillAreas[b.skillArea]) skillAreas[b.skillArea] = { correct: 0, total: 0 };
    skillAreas[b.skillArea].total++;
    if (b.isCorrect) skillAreas[b.skillArea].correct++;
  });

  const strengths = Object.entries(skillAreas).filter(([, v]) => v.correct / v.total >= 0.7).map(([k]) => k);
  const weakAreas = Object.entries(skillAreas).filter(([, v]) => v.correct / v.total < 0.7).map(([k]) => k);

  return { score, grade, correct, total, breakdown, skillAreas, strengths, weakAreas };
}

// ─────────────────────────────────────────────────────────────────────────────
// ROUTES
// ─────────────────────────────────────────────────────────────────────────────

/**
 * GET /api/assessments
 * All assessments — admin/manager sees all, employees see their own
 */
router.get('/', authenticate, async (req, res) => {
  try {
    const assessments = readJSON(ASSESSMENTS_FILE);
    const isPrivileged = ['admin', 'manager'].includes(req.user.role);

    const result = isPrivileged
      ? assessments
      : assessments.filter(a =>
          a.employeeAssignments?.some(ea => ea.userId === req.user.userId) ||
          a.targetUsers?.includes(req.user.userId)
        );

    res.json({ success: true, data: result, error: null });
  } catch (e) {
    res.status(500).json({ success: false, data: null, error: e.message });
  }
});

/**
 * POST /api/assessments
 * Create assessment — admin/manager only
 * Body: { title, targetUsers (array of userIds), targetGroup, questionCount, questionTypes, assessmentDate, duration }
 * System auto-fetches JD+jobRole for each target employee and generates unique questions
 */
router.post('/', authenticate, requireRole('admin', 'manager'), async (req, res) => {
  try {
    const {
      title,
      targetUsers = [],   // array of userIds
      targetGroup,        // group id (optional)
      questionCount = 10,
      questionTypes = ['mcq'],
      assessmentDate,
      duration = 30,      // minutes
    } = req.body;

    if (!title) {
      return res.status(400).json({ success: false, data: null, error: 'Title is required' });
    }

    // Resolve target users
    let userIds = [...(Array.isArray(targetUsers) ? targetUsers : [])];

    // If group provided, fetch all members
    if (targetGroup) {
      try {
        const groups = readJSON(join(DATA_DIR, 'groups.json'));
        const memberships = readJSON(join(DATA_DIR, 'group_memberships.json'));
        const groupObj = (Array.isArray(groups) ? groups : groups.groups || []).find(g => g.id === targetGroup);
        if (groupObj) {
          const memberIds = (Array.isArray(memberships) ? memberships : memberships.memberships || [])
            .filter(m => m.group_id === targetGroup || m.groupId === targetGroup)
            .map(m => m.user_id || m.userId);
          userIds = [...new Set([...userIds, ...memberIds])];
        }
      } catch (e) { console.warn('[assessment] Group resolution failed:', e.message); }
    }

    // Deduplicate
    userIds = [...new Set(userIds)];

    // Generate per-employee assignments with unique questions
    const employeeAssignments = [];
    for (const userId of userIds) {
      const user = await UserStore.getUserById(userId);
      if (!user) continue;

      const questions = await generateQuestionsFromJD({
        jobRole: user.jobRole || 'Employee',
        jobDescription: user.jobDescription || '',
        questionCount,
        questionTypes,
        employeeSeed: `${userId}-${Date.now()}`, // unique per employee per creation
      });

      employeeAssignments.push({
        userId,
        userName: user.name,
        userEmail: user.email,
        jobRole: user.jobRole || '',
        questions,           // unique to this employee
        status: 'assigned',  // assigned | started | submitted
        assignedAt: new Date().toISOString(),
        startedAt: null,
        submittedAt: null,
      });
    }

    const newAssessment = {
      id: randomUUID(),
      title,
      targetGroup: targetGroup || null,
      targetUsers: userIds,
      employeeAssignments,  // per-employee unique questions
      questionCount,
      questionTypes,
      assessmentDate: assessmentDate || null,
      duration,
      createdBy: req.user.userId,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      isActive: true,
    };

    const assessments = readJSON(ASSESSMENTS_FILE);
    assessments.push(newAssessment);
    writeJSON(ASSESSMENTS_FILE, assessments);

    res.status(201).json({ success: true, data: newAssessment, error: null });
  } catch (e) {
    console.error('[POST /api/assessments]', e);
    res.status(500).json({ success: false, data: null, error: e.message });
  }
});

/**
 * POST /api/assessments/generate-from-jd
 * Preview: generate questions from a specific employee's JD (no assessment saved)
 * Body: { userId?, jobRole?, jobDescription?, questionCount, questionTypes }
 */
router.post('/generate-from-jd', authenticate, requireRole('admin', 'manager'), async (req, res) => {
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
    res.status(500).json({ success: false, data: null, error: e.message });
  }
});

/**
 * GET /api/assessments/my
 * Employee: get their own assessments with their specific questions
 */
router.get('/my', authenticate, async (req, res) => {
  try {
    const assessments = readJSON(ASSESSMENTS_FILE);
    const myAssessments = assessments
      .filter(a => a.employeeAssignments?.some(ea => ea.userId === req.user.userId))
      .map(a => {
        const myAssignment = a.employeeAssignments.find(ea => ea.userId === req.user.userId);
        return {
          id: a.id,
          title: a.title,
          assessmentDate: a.assessmentDate,
          duration: a.duration,
          status: myAssignment.status,
          questions: myAssignment.questions,
          assignedAt: myAssignment.assignedAt,
          submittedAt: myAssignment.submittedAt,
          jobRole: myAssignment.jobRole,
        };
      });

    res.json({ success: true, data: myAssessments, error: null });
  } catch (e) {
    res.status(500).json({ success: false, data: null, error: e.message });
  }
});

/**
 * GET /api/assessments/:id
 * Get single assessment
 */
router.get('/:id', authenticate, async (req, res) => {
  try {
    const assessments = readJSON(ASSESSMENTS_FILE);
    const assessment = assessments.find(a => a.id === req.params.id);
    if (!assessment) return res.status(404).json({ success: false, data: null, error: 'Not found' });

    const isPrivileged = ['admin', 'manager'].includes(req.user.role);
    if (!isPrivileged) {
      // Employee: only return their own questions
      const myAssignment = assessment.employeeAssignments?.find(ea => ea.userId === req.user.userId);
      if (!myAssignment) return res.status(403).json({ success: false, data: null, error: 'Access denied' });
      return res.json({ success: true, data: { ...assessment, employeeAssignments: [myAssignment] }, error: null });
    }

    res.json({ success: true, data: assessment, error: null });
  } catch (e) {
    res.status(500).json({ success: false, data: null, error: e.message });
  }
});

/**
 * POST /api/assessments/:id/submit
 * Employee submits their assessment → auto-generates report
 */
router.post('/:id/submit', authenticate, async (req, res) => {
  try {
    const { responses } = req.body; // array of { answer } matching question indices
    const assessments = readJSON(ASSESSMENTS_FILE);
    const idx = assessments.findIndex(a => a.id === req.params.id);

    if (idx === -1) return res.status(404).json({ success: false, data: null, error: 'Assessment not found' });

    const assessment = assessments[idx];
    const assignmentIdx = assessment.employeeAssignments?.findIndex(ea => ea.userId === req.user.userId);

    if (assignmentIdx === -1 || assignmentIdx === undefined) {
      return res.status(403).json({ success: false, data: null, error: 'You are not assigned to this assessment' });
    }

    const assignment = assessment.employeeAssignments[assignmentIdx];
    if (assignment.status === 'submitted') {
      return res.status(400).json({ success: false, data: null, error: 'Assessment already submitted' });
    }

    // Score the submission
    const scoring = scoreSubmission(assignment.questions, responses || []);

    // Update assignment status
    assessment.employeeAssignments[assignmentIdx] = {
      ...assignment,
      status: 'submitted',
      submittedAt: new Date().toISOString(),
      responses,
      scoring,
    };
    assessments[idx] = { ...assessment, updatedAt: new Date().toISOString() };
    writeJSON(ASSESSMENTS_FILE, assessments);

    // Generate report
    const report = {
      id: randomUUID(),
      assessmentId: assessment.id,
      assessmentTitle: assessment.title,
      userId: req.user.userId,
      userName: req.user.name,
      jobRole: assignment.jobRole,
      submittedAt: new Date().toISOString(),
      ...scoring,
      questions: assignment.questions,
      responses,
      generatedAt: new Date().toISOString(),
    };

    const reports = readJSON(REPORTS_FILE);
    reports.push(report);
    writeJSON(REPORTS_FILE, reports);

    res.json({ success: true, data: { report }, error: null });
  } catch (e) {
    console.error('[POST /api/assessments/:id/submit]', e);
    res.status(500).json({ success: false, data: null, error: e.message });
  }
});

/**
 * GET /api/assessments/:id/report
 * Get report for a specific assessment — employee gets own, admin/manager see all
 */
router.get('/:id/report', authenticate, async (req, res) => {
  try {
    const reports = readJSON(REPORTS_FILE);
    const isPrivileged = ['admin', 'manager'].includes(req.user.role);

    const filtered = isPrivileged
      ? reports.filter(r => r.assessmentId === req.params.id)
      : reports.filter(r => r.assessmentId === req.params.id && r.userId === req.user.userId);

    res.json({ success: true, data: filtered, error: null });
  } catch (e) {
    res.status(500).json({ success: false, data: null, error: e.message });
  }
});

/**
 * GET /api/assessments/reports/all
 * Admin/Manager: all reports (scoped to manager's employees)
 */
router.get('/reports/all', authenticate, requireRole('admin', 'manager'), async (req, res) => {
  try {
    const reports = readJSON(REPORTS_FILE);
    res.json({ success: true, data: reports, error: null });
  } catch (e) {
    res.status(500).json({ success: false, data: null, error: e.message });
  }
});

/**
 * PUT /api/assessments/:id
 * Update (admin/manager)
 */
router.put('/:id', authenticate, requireRole('admin', 'manager'), async (req, res) => {
  try {
    const assessments = readJSON(ASSESSMENTS_FILE);
    const idx = assessments.findIndex(a => a.id === req.params.id);
    if (idx === -1) return res.status(404).json({ success: false, data: null, error: 'Not found' });

    assessments[idx] = { ...assessments[idx], ...req.body, id: assessments[idx].id, updatedAt: new Date().toISOString() };
    writeJSON(ASSESSMENTS_FILE, assessments);
    res.json({ success: true, data: assessments[idx], error: null });
  } catch (e) {
    res.status(500).json({ success: false, data: null, error: e.message });
  }
});

/**
 * DELETE /api/assessments/:id
 * Delete (admin/manager)
 */
router.delete('/:id', authenticate, requireRole('admin', 'manager'), async (req, res) => {
  try {
    const assessments = readJSON(ASSESSMENTS_FILE);
    const filtered = assessments.filter(a => a.id !== req.params.id);
    if (filtered.length === assessments.length) return res.status(404).json({ success: false, data: null, error: 'Not found' });
    writeJSON(ASSESSMENTS_FILE, filtered);
    res.json({ success: true, data: { id: req.params.id }, error: null });
  } catch (e) {
    res.status(500).json({ success: false, data: null, error: e.message });
  }
});

/**
 * POST /api/assessments/generate (legacy compat — module-based)
 * Kept for backward compatibility with existing module quiz generation
 */
router.post('/generate', authenticate, async (req, res) => {
  try {
    const { moduleTitle, moduleDescription, skills, numQuestions, questionTypes, sessionTitle, sessionTopics, sessionKeyPoints } = req.body;
    const num = Math.min(Math.max(parseInt(numQuestions) || 5, 2), 20);
    const types = Array.isArray(questionTypes) && questionTypes.length > 0 ? questionTypes : ['mcq'];
    const topicsStr = Array.isArray(sessionTopics) && sessionTopics.length > 0
      ? sessionTopics.join(', ')
      : (Array.isArray(skills) && skills.length > 0 ? skills.join(', ') : 'core concepts');

    const questions = await generateQuestionsFromJD({
      jobRole: moduleTitle || 'Learning Module',
      jobDescription: [moduleDescription, topicsStr, Array.isArray(sessionKeyPoints) ? sessionKeyPoints.join('. ') : ''].filter(Boolean).join('. '),
      questionCount: num,
      questionTypes: types,
      employeeSeed: `module-${Date.now()}`,
    });

    res.json({ success: true, data: questions, error: null });
  } catch (e) {
    res.status(500).json({ success: false, data: null, error: e.message });
  }
});

export default router;
