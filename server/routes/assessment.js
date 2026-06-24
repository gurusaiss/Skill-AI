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
import multer from 'multer';
import UserStore from '../services/UserStore.js';
import { Assessments, Submissions, Reports, RoleLibrary, ModuleAssignments, GeneratedContent, AssessmentThresholds } from '../services/DataStore.js';
import LLMQueue from '../services/LLMQueue.js';
import * as db from '../db/store.js';
import { generateQuestionsFromJD } from '../services/AssessmentGenerator.js';

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const DATA_DIR = join(__dirname, '../data');

const router = express.Router();

// ── AI question generation ────────────────────────────────────────────────────

// generateQuestionsFromJD is imported from ../services/AssessmentGenerator.js
// Keeping this stub comment so line references stay stable
async function _unused_generateQuestionsFromJD_stub({ jobRole, jobDescription, jdSkills, questionCount, questionTypes, employeeSeed }) {
  const num = Math.min(Math.max(parseInt(questionCount) || 5, 2), 30);
  const types = Array.isArray(questionTypes) && questionTypes.length > 0 ? questionTypes : ['mcq'];
  const seed = employeeSeed || randomUUID().slice(0, 8);
  const jdText = (jobDescription || '').trim();
  const skillsList = Array.isArray(jdSkills) && jdSkills.length ? jdSkills : [];

  // ── System prompt: domain-agnostic, anti-contamination ──────────────────────
  const system = `You are an expert HR assessment designer who creates role-specific assessments for ALL job functions across ALL industries — HR, Operations, Finance, Sales, Marketing, Customer Success, Procurement, L&D, Project Management, IT, Engineering, Healthcare, Legal, and any other domain.

ABSOLUTE RULES:
1. Read and extract the actual domain, responsibilities, tools, and required knowledge from the JD FIRST.
2. Generate questions ONLY about what the JD explicitly requires — never introduce topics from unrelated domains.
3. Domain must match: HR role → HR questions. Finance role → Finance questions. Operations → Operations questions. Do NOT cross domains.
4. Every question must trace directly to a specific responsibility, skill, process, tool, or competency in the JD.
5. Match seniority level: Executive/Director → strategy, policy, P&L, stakeholder decisions. Manager → team management, planning, escalation, reporting. Specialist/Executive → applied process, tools, day-to-day procedures. Junior/Coordinator → foundational knowledge, process steps.
6. Never generate software coding or engineering architecture questions unless the JD explicitly lists programming as a requirement.
7. Always return valid JSON with exactly a "questions" array.`;

  // ── User prompt: 3-step JD-first pipeline ───────────────────────────────────
  const prompt = `Generate ${num} assessment questions for this employee.

=== EMPLOYEE PROFILE ===
Job Role: ${jobRole || 'Professional'}
${skillsList.length ? `Skills identified from JD: ${skillsList.join(', ')}` : ''}

=== JOB DESCRIPTION ===
${jdText || '(No JD provided — use only the job role to infer responsibilities)'}

=== VARIATION SEED: ${seed} ===

=== STEP-BY-STEP GENERATION PROCESS ===

STEP 1 — EXTRACT THE ROLE PROFILE FROM THE JD:
Identify before generating any question:
• Primary domain/industry (HR / Finance / Operations / Sales / IT / Healthcare / Legal / etc.)
• Seniority level (junior / specialist / senior / manager / director / executive)
• Top 5 day-to-day responsibilities described in the JD
• Required tools, platforms, systems (HRMS, SAP, Salesforce, Excel, Jira, etc.)
• Required processes (recruitment, budgeting, pipeline management, vendor evaluation, etc.)
• Required knowledge areas (labor law, IFRS, Agile, ISO standards, etc.)
• Required soft skills and competencies (stakeholder management, negotiation, team leadership, etc.)
• Key performance indicators or expected outcomes mentioned

STEP 2 — GENERATE QUESTIONS GROUNDED IN THE EXTRACTED PROFILE:
• Use exactly this question type mix (cycle through): ${types.join(', ')}
• Difficulty distribution: 30% easy, 50% medium, 20% hard
• Each question must test something from the profile extracted in Step 1
• Prefer scenario-based questions: "In your role as ${jobRole || 'a professional'}, when [situation], what do you do?"
• For non-technical roles: test processes, decisions, communication, and domain knowledge — NOT coding or engineering
• For managerial roles: include team management, delegation, conflict resolution, resource planning, KPI reporting
• For finance/procurement: include budgeting, approval workflows, vendor management, compliance
• For HR roles: include recruitment processes, employee relations, HR policies, performance management
• For sales/marketing: include pipeline management, client handling, campaign strategy, metrics tracking
• Use the variation seed (${seed}) to select different angles and scenarios even if two employees share the same JD

STEP 3 — VALIDATE EACH QUESTION BEFORE RETURNING:
For every question ask: "Can I point to a specific line or responsibility in the JD that makes this question relevant?"
If the answer is NO — replace the question with one that passes this test.

=== OUTPUT FORMAT ===
{
  "questions": [
    {
      "type": "mcq|fill_blank|subjective",
      "question": "specific, scenario-grounded question relevant to this exact role and JD",
      "difficulty": "easy|medium|hard",
      "options": ["A) ...", "B) ...", "C) ...", "D) ..."],
      "answer": "A (or B/C/D for mcq) | exact phrase for fill_blank | detailed model answer for subjective",
      "explanation": "one sentence — which JD requirement this question tests and why it matters for this role",
      "skillArea": "the specific responsibility, skill, or competency from the JD being tested"
    }
  ]
}`;

  // Try Groq first (faster, higher rate limit)
  try {
    const groqKey = process.env.GROQ_API_KEY;
    if (groqKey?.length > 10) {
      const r = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${groqKey}` },
        body: JSON.stringify({
          model: 'llama-3.3-70b-versatile',
          messages: [{ role: 'system', content: system }, { role: 'user', content: prompt }],
          temperature: 0.8,
          max_tokens: 5000,
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
            generationConfig: { temperature: 0.8, maxOutputTokens: 5000, responseMimeType: 'application/json' },
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

  // Fallback — skill-grounded rule-based questions (never fully generic)
  const role = jobRole || 'Professional';
  const fallbackSkills = skillsList.length > 0 ? skillsList
    : ['core responsibilities', 'stakeholder communication', 'process management', 'performance delivery', 'problem solving'];
  return Array.from({ length: num }, (_, i) => {
    const t = types[i % types.length];
    const difficulty = ['easy', 'medium', 'hard'][i % 3];
    const skill = fallbackSkills[i % fallbackSkills.length];
    return {
      type: t,
      question: t === 'mcq'
        ? `As a ${role}, when facing a challenge related to ${skill}, what is the most effective first step?`
        : t === 'fill_blank'
        ? `A key outcome of strong ${skill} in the ${role} role is ______.`
        : `Describe a specific situation in your ${role} role where ${skill} was critical. What approach did you take and what was the result?`,
      difficulty,
      options: t === 'mcq' ? [
        `A) Assess the situation, identify root cause, and develop a structured plan`,
        `B) Escalate immediately without gathering information`,
        `C) Wait for the situation to resolve on its own`,
        `D) Delegate without providing context or follow-up`,
      ] : undefined,
      answer: t === 'mcq' ? 'A'
        : t === 'fill_blank' ? 'consistent, measurable, and high-quality outcomes'
        : `In my ${role} role, I approach ${skill} challenges by first clarifying objectives and constraints, then systematically identifying root causes, designing solutions aligned with organizational goals, and tracking outcomes against defined KPIs.`,
      explanation: `Tests applied ${skill} competency directly required in the ${role} role.`,
      skillArea: skill,
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
    res.status(500).json({ success: false, error: e.message });
  }
});

// GET /api/assessments/thresholds — return company thresholds
router.get('/thresholds', authenticate, async (req, res) => {
  try {
    const companyId = req.user.companyId || 'default';
    const saved = await AssessmentThresholds.getByCompany(companyId);
    res.json({ success: true, data: { thresholds: saved?.thresholds || DEFAULT_THRESHOLDS } });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
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
    res.status(500).json({ success: false, error: e.message });
  }
});

function getReadinessLevel(score) {
  if (score >= 85) return 'Ready for Advanced Responsibilities';
  if (score >= 70) return 'Ready with Minor Gaps';
  if (score >= 55) return 'Needs Targeted Development';
  return 'Requires Significant Training Before Progression';
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

  // Missing competencies: skill areas with 0% score
  const missingCompetencies = Object.entries(skillAreas)
    .filter(([, v]) => v.correct === 0)
    .map(([k]) => k);

  const performanceClassification = classifyPerformance(score);
  const readinessLevel = getReadinessLevel(score);

  // Recommended learning areas derived from weak/missing areas
  const recommendedLearningAreas = [...new Set([...missingCompetencies, ...weakAreas])];

  return { score, grade, correct, total, breakdown, skillAreas, skillBreakdown, strengths, weakAreas, missingCompetencies, performanceClassification, readinessLevel, recommendedLearningAreas };
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
      targetGroup: _targetGroup,
      groupId,
      questionCount = 10,
      questionTypes = ['mcq'],
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

    // If targetType === 'department', fetch employees matching the department
    if (targetType === 'department' && department) {
      try {
        const allUsersForCompany = await UserStore.getAllUsers({});
        const companyId = req.user.companyId || 'default';
        const deptEmployeeIds = allUsersForCompany
          .filter(u =>
            u.role === 'employee' &&
            (u.companyId || 'default') === companyId &&
            u.department === department
          )
          .map(u => u.userId || u.id);
        userIds = [...new Set([...userIds, ...deptEmployeeIds])];
      } catch (e) { console.warn('[assessment] targetType=department resolution failed:', e.message); }
    }

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

    // Batch-fetch all target users in ONE query instead of N individual queries
    const allUsers = await UserStore.getAllUsers({});
    const userMap = new Map(allUsers.map(u => [u.userId || u.id, u]));
    const validUsers = userIds.map(id => userMap.get(id)).filter(Boolean);

    // Generate per-employee assignments — parallel LLM calls via LLMQueue (concurrency-capped)
    const assignedAt = new Date().toISOString();
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
            const roleMatch = await RoleLibrary.findByName(user.jobRole, user.companyId || 'default');
            if (roleMatch?.jobDescription) { resolvedJD = roleMatch.jobDescription; }
            if (!resolvedSkills.length && (roleMatch?.skills || []).length) { resolvedSkills = roleMatch.skills; }
          } catch {}
        }

        // If difficulty filter is set, try to pull from the role's pre-generated question bank
        let questions = null;
        if (difficulty && user.jobRole) {
          try {
            const roleForBank = await RoleLibrary.findByName(user.jobRole, user.companyId || 'default');
            const bank = (roleForBank?.questionBank || []).filter(q => q.difficulty === difficulty);
            if (bank.length >= questionCount) {
              // Shuffle and pick questionCount questions from the bank
              const shuffled = [...bank].sort(() => Math.random() - 0.5);
              questions = shuffled.slice(0, questionCount);
            }
          } catch {}
        }
        // If no difficulty filter but percentage distribution provided, pick from bank by difficulty pct
        if (!questions && (easyPct != null || mediumPct != null || hardPct != null) && user.jobRole) {
          try {
            const roleForBank = await RoleLibrary.findByName(user.jobRole, user.companyId || 'default');
            const fullBank = roleForBank?.questionBank || [];
            if (fullBank.length >= questionCount) {
              const pctEasy   = easyPct   != null ? Number(easyPct)   : 33;
              const pctMedium = mediumPct != null ? Number(mediumPct) : 33;
              // hardPct is whatever remains to ensure total === questionCount
              const nEasy   = Math.round(questionCount * pctEasy   / 100);
              const nMedium = Math.round(questionCount * pctMedium / 100);
              const nHard   = questionCount - nEasy - nMedium;

              const pickN = (diff, n) => {
                const pool = fullBank.filter(q => q.difficulty === diff);
                return [...pool].sort(() => Math.random() - 0.5).slice(0, n);
              };

              const picked = [
                ...pickN('easy',   nEasy),
                ...pickN('medium', nMedium),
                ...pickN('hard',   Math.max(0, nHard)),
              ];

              if (picked.length >= questionCount) {
                questions = picked.slice(0, questionCount);
              }
            }
          } catch {}
        }
        if (!questions) {
          questions = await generateQuestionsFromJD({
            jobRole: user.jobRole || 'Employee',
            jobDescription: resolvedJD,
            jdSkills: resolvedSkills,
            questionCount,
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
      questionCount,
      questionTypes,
      difficulty: difficulty || null,
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
    res.status(500).json({ success: false, data: null, error: e.message });
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
      .filter(a =>
        a.employeeAssignments?.some(ea => ea.userId === req.user.userId) ||
        a.targetUsers?.includes(req.user.userId)
      )
      .map(a => {
        const myAssignment = a.employeeAssignments?.find(ea => ea.userId === req.user.userId);

        const assessmentDate = a.assessmentDate ? new Date(a.assessmentDate) : null;
        const deadline = a.deadline ? new Date(a.deadline) : null;

        const isVisible = !assessmentDate || now >= assessmentDate;
        const isExpired = deadline ? now > deadline : false;

        const assignmentStatus = myAssignment?.status || 'assigned';
        return {
          id: a.id,
          title: a.title,
          assessmentDate: a.assessmentDate,
          deadline: a.deadline || null,
          duration: a.duration,
          status: isExpired && assignmentStatus !== 'submitted' ? 'expired' : assignmentStatus,
          questions: (isVisible && myAssignment) ? myAssignment.questions : null,
          assignedAt: myAssignment?.assignedAt || a.createdAt,
          submittedAt: myAssignment?.submittedAt || null,
          jobRole: myAssignment?.jobRole || '',
          isVisible,
          isExpired,
          scoring: assignmentStatus === 'submitted' ? myAssignment?.scoring : null,
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
    const companyId = req.user?.companyId || 'default';

    // Filter by company user membership (not by r.companyId, since legacy reports have none)
    const UserStore = (await import('../services/UserStore.js')).default;
    const allUsers = await UserStore.getAllUsers({});
    const companyUserIds = new Set(
      allUsers
        .filter(u => (u.companyId || 'default') === companyId)
        .map(u => u.userId || u.id)
    );

    const filteredReports = companyId === 'default'
      ? reports
      : reports.filter(r => companyUserIds.has(r.userId || r.user_id || r.submittedBy));

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
      companyId: req.user.companyId || 'default',
      userName: req.user.name || assignment.userName,
      jobRole: assignment.jobRole,
      submittedAt: new Date().toISOString(),
      ...scoring,
      questions,
      responses,
      generatedAt: new Date().toISOString(),
      improvementRecommendations: scoring.weakAreas?.length
        ? scoring.weakAreas.map(a => `Focus on strengthening "${a}" through targeted practice and study`)
        : [],
    };

    await Reports.create(report);

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

        // Determine module depth from classification
        const depthMap = {
          'Critical':         { numSessions: 8, difficulty: 'beginner',     priority: 'urgent' },
          'Needs Improvement':{ numSessions: 6, difficulty: 'intermediate', priority: 'high'   },
          'Average':          { numSessions: 5, difficulty: 'intermediate', priority: 'high'   },
          'Good':             { numSessions: 4, difficulty: 'intermediate', priority: 'medium' },
          'Excellent':        { numSessions: 3, difficulty: 'advanced',     priority: 'medium' },
          'Outstanding':      { numSessions: 2, difficulty: 'advanced',     priority: 'low'    },
        };
        const depth = depthMap[classification] || depthMap['Average'];

        // Groq module generation
        let moduleContent = null;
        const groqKey = process.env.GROQ_API_KEY;
        if (groqKey?.length > 10) {
          try {
            const prompt = `Design a personalized remedial training module for an employee based on their assessment results.

=== EMPLOYEE CONTEXT ===
Job Role: ${jobRole}
Classification: ${classification} (Score: ${score}%)
${jdSkillsCtx ? `JD Skills: ${jdSkillsCtx}` : ''}
${jdContext ? `Job Description:\n${jdContext}` : ''}

=== SKILL GAPS (address ALL of these) ===
${skills.map((s, i) => `${i + 1}. ${s}`).join('\n')}

=== MODULE DESIGN RULES ===
1. Generate EXACTLY ${depth.numSessions} sessions — one per day.
2. Each session must directly address a specific skill gap above.
3. Session topics must match the employee's job domain (${jobRole}) — no generic tech content for non-technical roles.
4. Sessions build progressively: Day 1 = foundational, final day = applied practice.
5. Each session MUST have a quiz with 3-5 multiple-choice questions that test that day's topic.
6. Include keyPoints (3-5 bullet points of key takeaways per session).

Return ONLY valid JSON matching exactly this structure:
{
  "title": "string (specific, not generic)",
  "description": "string (2-3 sentences)",
  "objectives": ["string", ...],
  "estimatedDuration": "${depth.numSessions} days",
  "sessions": [
    {
      "title": "string",
      "dayNumber": 1,
      "duration": "45 mins",
      "topics": ["string", ...],
      "keyPoints": ["string", ...],
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

            const r = await LLMQueue.run(() => fetch('https://api.groq.com/openai/v1/chat/completions', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${groqKey}` },
              body: JSON.stringify({
                model: 'llama-3.3-70b-versatile',
                messages: [{ role: 'user', content: prompt }],
                temperature: 0.7,
                max_tokens: 4000,
                response_format: { type: 'json_object' },
              }),
              signal: AbortSignal.timeout(45000),
            }));
            if (r.ok) {
              const d = await r.json();
              const raw = d.choices?.[0]?.message?.content || '{}';
              moduleContent = JSON.parse(raw);
              console.log(`[auto-assign] Groq generated module: "${moduleContent.title}" with ${moduleContent.sessions?.length} sessions`);
            } else {
              const errText = await r.text().catch(() => '');
              console.warn(`[auto-assign] Groq HTTP ${r.status}: ${errText.slice(0, 200)}`);
            }
          } catch (e) {
            if (e.code === 'LLM_QUEUE_FULL') {
              console.warn('[auto-assign] LLM queue full — using rule-based fallback sessions');
            } else {
              console.warn('[auto-assign] Groq failed:', e.message);
            }
          }
        } else {
          console.warn('[auto-assign] GROQ_API_KEY not set — using fallback sessions');
        }

        // Build sessions with day-based unlock dates
        const startDate = new Date();
        const rawSessions = moduleContent?.sessions?.length > 0
          ? moduleContent.sessions
          : skills.slice(0, depth.numSessions).map((s, i) => ({
              title: `Day ${i + 1}: ${s}`,
              dayNumber: i + 1,
              duration: '45 mins',
              topics: [s],
              keyPoints: [`Understanding ${s}`, `Applying ${s} in ${jobRole} context`, `Common pitfalls with ${s}`],
              quiz: [{
                question: `What is the most important aspect of ${s} for a ${jobRole}?`,
                options: ['A) Memorizing theory only', `B) Applying ${s} practically`, 'C) Avoiding it entirely', 'D) Delegating to others'],
                answer: 'B',
                explanation: `Practical application of ${s} is critical for ${jobRole} effectiveness.`,
              }],
            }));

        const sessions = rawSessions.map((s, i) => {
          const dayNumber = s.dayNumber || (i + 1);
          const unlockDate = new Date(startDate);
          unlockDate.setDate(unlockDate.getDate() + (dayNumber - 1));
          return { ...s, dayNumber, sessionIndex: i, unlockDate: unlockDate.toISOString() };
        });

        const estimatedDays = sessions.length;
        const endDate = new Date(startDate);
        endDate.setDate(endDate.getDate() + estimatedDays + 2);

        const moduleTitle = moduleContent?.title || `${classification} Training Plan: ${skills.slice(0, 2).join(' & ')}`;
        console.log(`[auto-assign] Creating module "${moduleTitle}" (${sessions.length} sessions, ${depth.difficulty})`);

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
