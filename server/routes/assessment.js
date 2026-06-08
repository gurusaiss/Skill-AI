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
import { authenticate, requireRole } from '../middleware/auth.js';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { randomUUID } from 'crypto';
import UserStore from '../services/UserStore.js';
import { Assessments, Submissions, Reports } from '../services/DataStore.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const DATA_DIR = join(__dirname, '../data');

const router = express.Router();

// ── AI question generation ────────────────────────────────────────────────────

/**
 * Generate unique questions per employee from job role + JD
 * Uses a seed (userId + assessmentId) to ensure uniqueness even for same JD
 */
async function generateQuestionsFromJD({ jobRole, jobDescription, jobDescriptionFile, questionCount, questionTypes, employeeSeed }) {
  const num = Math.min(Math.max(parseInt(questionCount) || 5, 2), 30);
  const types = Array.isArray(questionTypes) && questionTypes.length > 0 ? questionTypes : ['mcq'];
  const seed = employeeSeed || randomUUID().slice(0, 8);

  // Try to get richer JD text from uploaded file
  let jdContent = (jobDescription || '').slice(0, 4000);
  if (jobDescriptionFile?.path && jdContent.length < 200) {
    try {
      const { parseJDFile } = await import('../utils/parseJDFile.js');
      const fileText = await parseJDFile(
        jobDescriptionFile.path,
        jobDescriptionFile.name || ''
      );
      if (fileText && fileText.length > 50) {
        jdContent = fileText.slice(0, 4000);
        console.log(`[Assessment] Using JD file content (${fileText.length} chars) for question generation`);
      }
    } catch (e) {
      console.warn('[Assessment] JD file parse failed, using text fallback:', e.message);
    }
  }
  const jdText = jdContent;

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
          temperature: 0.85,
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
      const extractLetter = s => (s || '').trim().toUpperCase().replace(/^([A-D])[)\s.].*$/, '$1').charAt(0);
      isCorrect = extractLetter(resp.answer) === extractLetter(q.answer);
      total++;
      if (isCorrect) correct++;
    } else {
      const userAnswer = (resp.answer || '').toLowerCase();
      const modelAnswer = (q.answer || '').toLowerCase();
      const keywords = modelAnswer.split(/\s+/).filter(w => w.length > 4);
      const matched = keywords.filter(k => userAnswer.includes(k)).length;
      isCorrect = keywords.length > 0 && (matched / keywords.length) >= 0.3;
      total++;
      if (isCorrect) correct++;
    }

    const correctOptionText = q.type === 'mcq' && q.options
      ? (q.options.find(opt => opt.toUpperCase().startsWith(q.answer?.toUpperCase())) || q.answer)
      : q.answer;
    breakdown.push({ questionIndex: i, question: q.question, type: q.type, userAnswer: resp.answer, correctAnswer: q.answer, correctOptionText, isCorrect, skillArea: q.skillArea || 'General' });
  });

  const score = total > 0 ? Math.round((correct / total) * 100) : 0;
  const grade = score >= 90 ? 'A' : score >= 80 ? 'B' : score >= 70 ? 'C' : score >= 60 ? 'D' : 'F';

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
    const assessments = await Assessments.getAll() || [];
    const isPrivileged = ['admin', 'manager', 'superadmin'].includes(req.user.role);

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
 */
router.post('/', authenticate, requireRole('admin', 'manager'), async (req, res) => {
  try {
    const {
      title,
      targetUsers = [],
      targetGroup,
      questionCount = 10,
      questionTypes = ['mcq'],
      assessmentDate,
      deadline,
      duration = 30,
    } = req.body;

    if (!title) {
      return res.status(400).json({ success: false, data: null, error: 'Title is required' });
    }

    let userIds = [...(Array.isArray(targetUsers) ? targetUsers : [])];

    // If group provided, fetch all members from Supabase groups
    if (targetGroup) {
      try {
        const { default: db } = await import('../db/store.js');
        const groups = await db.getGroups?.() || [];
        const memberships = await db.getGroupMemberships?.() || [];
        const groupObj = (Array.isArray(groups) ? groups : groups.groups || []).find(g => g.id === targetGroup);
        if (groupObj) {
          const memberIds = (Array.isArray(memberships) ? memberships : memberships.memberships || [])
            .filter(m => m.group_id === targetGroup || m.groupId === targetGroup)
            .map(m => m.user_id || m.userId);
          userIds = [...new Set([...userIds, ...memberIds])];
        }
      } catch (e) { console.warn('[assessment] Group resolution failed:', e.message); }
    }

    userIds = [...new Set(userIds)];

    // Generate per-employee assignments with unique questions
    const employeeAssignments = [];
    for (const userId of userIds) {
      const user = await UserStore.getUserById(userId);
      if (!user) continue;

      const questions = await generateQuestionsFromJD({
        jobRole: user.jobRole || 'Employee',
        jobDescription: user.jobDescription || '',
        jobDescriptionFile: user.jobDescriptionFile || null,
        questionCount,
        questionTypes,
        employeeSeed: `${userId}-${Date.now()}`,
      });

      employeeAssignments.push({
        userId,
        userName: user.name,
        userEmail: user.email,
        jobRole: user.jobRole || '',
        questions,
        status: 'assigned',
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
      employeeAssignments,
      questionCount,
      questionTypes,
      assessmentDate: assessmentDate || null,
      deadline: deadline || null,
      duration,
      createdBy: req.user.userId,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      isActive: true,
    };

    const saved = await Assessments.create(newAssessment);
    res.status(201).json({ success: true, data: saved || newAssessment, error: null });
  } catch (e) {
    console.error('[POST /api/assessments]', e);
    res.status(500).json({ success: false, data: null, error: e.message });
  }
});

/**
 * POST /api/assessments/generate-from-jd
 * Preview: generate questions from a specific employee's JD (no assessment saved)
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
    const assessments = await Assessments.getAll() || [];
    const now = new Date();

    const myAssessments = assessments
      .filter(a => a.employeeAssignments?.some(ea => ea.userId === req.user.userId))
      .map(a => {
        const myAssignment = a.employeeAssignments.find(ea => ea.userId === req.user.userId);

        const assessmentDate = a.assessmentDate ? new Date(a.assessmentDate) : null;
        const deadline = a.deadline ? new Date(a.deadline) : null;

        const isVisible = !assessmentDate || now >= assessmentDate;
        const isExpired = deadline ? now > deadline : false;

        return {
          id: a.id,
          title: a.title,
          assessmentDate: a.assessmentDate,
          deadline: a.deadline || null,
          duration: a.duration,
          status: isExpired && myAssignment.status !== 'submitted' ? 'expired' : myAssignment.status,
          questions: isVisible ? myAssignment.questions : null,
          assignedAt: myAssignment.assignedAt,
          submittedAt: myAssignment.submittedAt,
          jobRole: myAssignment.jobRole,
          isVisible,
          isExpired,
          scoring: myAssignment.status === 'submitted' ? myAssignment.scoring : null,
        };
      });

    res.json({ success: true, data: myAssessments, error: null });
  } catch (e) {
    res.status(500).json({ success: false, data: null, error: e.message });
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
    res.json({ success: true, data: reports, error: null });
  } catch (e) {
    res.status(500).json({ success: false, data: null, error: e.message });
  }
});

/**
 * POST /api/assessments/generate (legacy compat — module-based)
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
    const { responses } = req.body;
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

    // Score the submission
    const scoring = scoreSubmission(assignment.questions, responses || []);

    // Update the specific employee's assignment inside the assessment
    const updatedAssignments = [...assessment.employeeAssignments];
    updatedAssignments[assignmentIdx] = {
      ...assignment,
      status: 'submitted',
      submittedAt: new Date().toISOString(),
      responses,
      scoring,
    };

    // Persist updated assessment to Supabase
    await Assessments.update(req.params.id, {
      employeeAssignments: updatedAssignments,
      updatedAt: new Date().toISOString(),
    });

    // Generate and persist report
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

    await Reports.create(report);

    res.json({ success: true, data: { report }, error: null });
  } catch (e) {
    console.error('[POST /api/assessments/:id/submit]', e);
    res.status(500).json({ success: false, data: null, error: e.message });
  }
});

/**
 * GET /api/assessments/:id/report
 * Get report for a specific assessment
 */
router.get('/:id/report', authenticate, async (req, res) => {
  try {
    const allReports = await Reports.getAll();
    const isPrivileged = ['admin', 'manager', 'superadmin'].includes(req.user.role);

    const filtered = isPrivileged
      ? allReports.filter(r => r.assessmentId === req.params.id)
      : allReports.filter(r => r.assessmentId === req.params.id && r.userId === req.user.userId);

    res.json({ success: true, data: filtered, error: null });
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
    const existing = await Assessments.getById(req.params.id);
    if (!existing) return res.status(404).json({ success: false, data: null, error: 'Not found' });

    const updated = await Assessments.update(req.params.id, {
      ...req.body,
      id: req.params.id,
      updatedAt: new Date().toISOString(),
    });

    res.json({ success: true, data: updated || existing, error: null });
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
    const existing = await Assessments.getById(req.params.id);
    if (!existing) return res.status(404).json({ success: false, data: null, error: 'Not found' });
    await Assessments.delete(req.params.id);
    res.json({ success: true, data: { id: req.params.id }, error: null });
  } catch (e) {
    res.status(500).json({ success: false, data: null, error: e.message });
  }
});

export default router;
