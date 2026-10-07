// Fake data for report unit tests and sample-file generation. No I/O.
import { buildResultRow, buildSummary } from './reportData.js';

const NOW = new Date('2026-10-07T10:30:00.000Z');
const SKILLS = ['Communication', 'Problem Solving', 'Data Handling', 'Process Knowledge', 'Customer Focus'];

export function fakeBreakdown(n, correctN) {
  return Array.from({ length: n }, (_, i) => {
    const isCorrect = i < correctN;
    const unanswered = !isCorrect && i % 7 === 3;
    return {
      questionIndex: i,
      question: `Question ${i + 1}: which option best describes the right approach for scenario ${i + 1}? ${i % 5 === 0 ? 'This one is deliberately long. '.repeat(18) : ''}`,
      type: i % 6 === 5 ? 'subjective' : i % 6 === 4 ? 'fill_blank' : 'mcq',
      options: ['A) First', 'B) Second', 'C) Third', 'D) Fourth'],
      userAnswer: unanswered ? null : (isCorrect ? 'B) Second option' : 'C) Third option'),
      correctAnswer: 'B',
      correctOptionText: 'B) Second option',
      isCorrect,
      skillArea: SKILLS[i % SKILLS.length],
      explanation: i % 3 === 0 ? 'Option B is correct because it follows the documented process end to end.' : '',
    };
  });
}

function fakeScoring(total, correct, passThreshold = 70) {
  const breakdown = fakeBreakdown(total, correct);
  const skillMap = {};
  breakdown.forEach(b => { const m = skillMap[b.skillArea] || (skillMap[b.skillArea] = { correct: 0, total: 0 }); m.total++; if (b.isCorrect) m.correct++; });
  const skillBreakdown = Object.entries(skillMap).map(([skill, v]) => ({ skill, correct: v.correct, total: v.total, pct: Math.round((v.correct / v.total) * 100) }));
  const rawScore = (correct * 100) / total;
  return {
    score: Math.round(rawScore), rawScore, correct, total, breakdown, skillBreakdown,
    strengths: skillBreakdown.filter(s => s.pct >= 70).map(s => s.skill),
    weakAreas: skillBreakdown.filter(s => s.pct < 70).map(s => s.skill),
    missingCompetencies: skillBreakdown.filter(s => s.correct === 0).map(s => s.skill),
    performanceClassification: { label: rawScore >= 85 ? 'Excellent' : rawScore >= 60 ? 'Average' : 'Needs Improvement' },
    readinessLevel: rawScore >= 70 ? 'Ready' : 'Not yet ready',
    passThreshold, passed: rawScore >= passThreshold,
  };
}

const NAMES = ['Aarav Mehta', 'Diya Nair', 'Rohan Iyer', 'Sneha Kulkarni', 'Vikram Singh', 'Ananya Rao', 'Kabir Shah', 'Meera Pillai', 'Imran Qureshi', 'Priya Desai', 'Tarun Gupta', 'Lakshmi Reddy'];

export function fakeAssessment(over = {}) {
  return {
    id: 'asm-1', title: 'Customer Support Skills Assessment', assessmentType: 'Skill Assessment', duration: 60, questionCount: 25,
    createdAt: '2026-09-20T05:00:00.000Z', assessmentDate: '2026-09-25T04:00:00.000Z', deadline: '2026-10-15T17:00:00.000Z',
    settings: { passPercentage: 70 }, ...over,
  };
}

/** 12 employees: pass, fail, in progress, not started, overdue. */
export function fakeRows() {
  const assessment = fakeAssessment();
  const plan = [
    ['done', 24], ['done', 22], ['done', 18], ['done', 12], ['done', 25], ['done', 9],
    ['progress'], ['progress'], ['notstarted'], ['notstarted'], ['overdue'], ['overdue'],
  ];
  const rows = plan.map((p, i) => {
    const userId = `user-${i + 1}`;
    const base = {
      userId, userName: NAMES[i], userEmail: `${NAMES[i].toLowerCase().replace(/ /g, '.')}@example.com`,
      jobRole: i % 2 ? 'Support Executive' : 'Senior Support Specialist', status: 'assigned', assignedAt: '2026-09-25T04:30:00.000Z',
      startAt: '2026-09-25T04:30:00.000Z', dueAt: '2026-10-15T17:00:00.000Z',
    };
    const user = { userId, employeeId: `EMP${String(1001 + i)}`, phone: `+91 98${String(10000000 + i * 1111)}`, department: i % 2 ? 'Support' : 'Operations', managerId: 'mgr-1', companyName: 'Acme Learning Pvt Ltd' };
    const manager = { userId: 'mgr-1', name: 'Neha Verma' };
    let ea = base, report = null;
    if (p[0] === 'done') {
      const sc = fakeScoring(25, p[1]);
      const submittedAt = new Date(Date.UTC(2026, 9, 1 + i % 5, 6 + i, 15)).toISOString();
      const attemptStartedAt = new Date(new Date(submittedAt).getTime() - (28 + i * 3) * 60000).toISOString();
      ea = { ...base, status: 'submitted', submittedAt, attemptStartedAt, scoring: sc };
      report = { id: `rep-${i}`, assessmentId: 'asm-1', userId, submittedAt, ...sc, questions: sc.breakdown.map((b, k) => ({ difficulty: ['easy', 'medium', 'hard'][k % 3] })), improvementRecommendations: sc.weakAreas.map(a => `Revise the basics of ${a} using the team playbook`), employeeId: user.employeeId, department: user.department, managerName: 'Neha Verma', managerId: 'mgr-1', companyName: 'Acme Learning Pvt Ltd', attemptNumber: 1 };
    } else if (p[0] === 'progress') {
      ea = { ...base, attemptStartedAt: '2026-10-06T05:00:00.000Z' };
    } else if (p[0] === 'overdue') {
      ea = { ...base, dueAt: '2026-10-02T17:00:00.000Z' };
    }
    const reminders = i % 3 === 0 ? [{ sent_at: '2026-10-03T08:00:00.000Z', delivery_status: 'sent' }] : [];
    return buildResultRow({ assessment, ea, report, user, manager, company: { name: 'Acme Learning Pvt Ltd' }, reminders, now: NOW });
  });
  return { assessment, rows, summary: buildSummary(rows, assessment, { name: 'Acme Learning Pvt Ltd' }, NOW), now: NOW };
}
