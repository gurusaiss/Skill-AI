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

// ── Score a submission ────────────────────────────────────────────────────────
// responses: dense array of { answer: string } indexed by question position
function scoreSubmission(questions, responses) {
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
      const ua = userAnswer.toLowerCase().trim();
      const ca = (q.answer || '').toLowerCase().trim();
      // Exact match first
      if (ua === ca) {
        isCorrect = true;
      } else {
        // Keyword overlap
        const keywords = ca.split(/\s+/).filter(w => w.length > 3);
        const matched = keywords.filter(k => ua.includes(k)).length;
        isCorrect = keywords.length > 0 && (matched / keywords.length) >= 0.5;
      }
    } else {
      // Subjective — keyword overlap scoring
      const ua = userAnswer.toLowerCase();
      const ca = (q.answer || '').toLowerCase();
      const keywords = ca.split(/\s+/).filter(w => w.length > 4);
      const matched = keywords.filter(k => ua.includes(k)).length;
      isCorrect = ua.trim().length > 10 && (keywords.length === 0 || (matched / keywords.length) >= 0.3);
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
      userAnswer: userAnswer || null,      // null = no answer (displayed as "(no answer)")
      correctAnswer: q.answer,
      correctOptionText,
      isCorrect,
      skillArea: q.skillArea || 'General',
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

  return { score, grade, correct, total, breakdown, skillAreas, skillBreakdown, strengths, weakAreas };
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

    // Company isolation: admin/manager only see their company's assessments
    const companyId = req.user?.companyId;
    const companyFiltered = (companyId && companyId !== 'default')
      ? assessments.filter(a => !a.companyId || a.companyId === companyId)
      : assessments;
    const result = isPrivileged
      ? companyFiltered
      : companyFiltered.filter(a =>
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
      companyId: req.user.companyId || null,
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
    const companyId = req.user?.companyId;
    const filteredReports = (companyId && companyId !== 'default')
      ? reports.filter(r => !r.companyId || r.companyId === companyId)
      : reports;
    res.json({ success: true, data: filteredReports, error: null });
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

    const questions = assignment.questions || [];

    // Normalise answers into dense array: responses[i] = { answer: string }
    const responses = normaliseResponses(answers, rawResponses, questions.length);

    console.log(`[submit] Assessment ${req.params.id} — ${questions.length} questions, ${responses.filter(r => r?.answer).length} answered`);

    // Score the submission
    const scoring = scoreSubmission(questions, responses);

    // Update the specific employee's assignment inside the assessment
    const updatedAssignments = [...assessment.employeeAssignments];
    updatedAssignments[assignmentIdx] = {
      ...assignment,
      status: 'submitted',
      submittedAt: new Date().toISOString(),
      responses,      // save normalised responses
      scoring,
    };

    // Persist updated assessment to Supabase
    await Assessments.update(req.params.id, {
      employeeAssignments: updatedAssignments,
      updatedAt: new Date().toISOString(),
    });

    // Generate and persist full report
    const report = {
      id: randomUUID(),
      assessmentId: assessment.id,
      assessmentTitle: assessment.title,
      userId: req.user.userId,
      userName: req.user.name || assignment.userName,
      jobRole: assignment.jobRole,
      submittedAt: new Date().toISOString(),
      ...scoring,
      questions,
      responses,
      generatedAt: new Date().toISOString(),
    };

    await Reports.create(report);

    res.json({ success: true, data: { report, scoring }, error: null });
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
