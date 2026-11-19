import { describe, it, expect, vi } from 'vitest';

const users = {
  u1: { userId: 'u1', name: 'Aarav', email: 'aarav@example.com', employeeId: 'E1' },
  u2: { userId: 'u2', name: 'Diya', email: 'diya@example.com', employeeId: 'E2' },
  u3: { userId: 'u3', name: 'Rohan', email: 'rohan@example.com', employeeId: 'E3' },
};

vi.mock('../UserStore.js', () => ({
  default: {
    // The bulk list is missing u2 (stale cache) and u3 has no entry either.
    getAllUsers: vi.fn(async () => [users.u1]),
    getUsersByIds: vi.fn(async (ids) => ids.map(i => users[i]).filter(Boolean)),
    getUserById: vi.fn(async (id) => users[id] || null),
  },
}));
vi.mock('../DataStore.js', () => ({
  Assessments: { getById: vi.fn(async () => null) },
  Companies: { getById: vi.fn(async () => null) },
  Groups: { getAll: vi.fn(async () => []) },
  EmployeeAssignmentsStub: {},
  EmployeeAssessmentAssignments: { getByAssessment: vi.fn(async () => []) },
  Reminders: { getByAssignment: vi.fn(async () => []) },
}));

const { loadAssessmentRows, loadSubmissionRows, loadPendingRows, deduplicateAssessmentRows } = await import('./reportLoader.js');

const assessment = {
  id: 'a1', title: 'SQL Basics', duration: 60, questionCount: 10, deadline: '2999-01-01T00:00:00Z',
  employeeAssignments: [
    { userId: 'u1', status: 'submitted', submittedAt: '2026-10-01T10:00:00Z' },
    { userId: 'u2', status: 'assigned' },
    { userId: 'u3', status: 'in_progress', attemptStartedAt: '2026-10-02T10:00:00Z' },
    { userId: 'u4', status: 'cancelled' },
  ],
};

describe('email resolves from the live user record', () => {
  it('fills the email for users missing from the bulk list and from the snapshot', async () => {
    const { rows } = await loadAssessmentRows({ assessment, assignments: assessment.employeeAssignments.slice(0, 3), reports: [] });
    expect(rows.map(r => r.email)).toEqual(['aarav@example.com', 'diya@example.com', 'rohan@example.com']);
  });
  it('submission rows get the email too', async () => {
    const { rows } = await loadSubmissionRows({ reports: [{ assessmentId: 'a1', userId: 'u2', submittedAt: '2026-10-01T10:00:00Z', score: 80, correct: 8, total: 10 }] });
    expect(rows[0].email).toBe('diya@example.com');
  });
});

describe('pending employees', () => {
  it('lists not-started and in-progress rows with blank score and rating, skipping submitted and cancelled', async () => {
    const rows = await loadPendingRows({ assessments: [assessment], allowedIds: null });
    expect(rows.map(r => [r.userId, r.status])).toEqual([['u2', 'Not started'], ['u3', 'In progress']]);
    for (const r of rows) {
      expect(r.scorePct).toBeNull();
      expect(r.rating).toBe('');
      expect(r.email).toMatch(/@example\.com$/);
    }
  });
  it('is limited to the caller\'s visible employees', async () => {
    const rows = await loadPendingRows({ assessments: [assessment], allowedIds: new Set(['u3']) });
    expect(rows.map(r => r.userId)).toEqual(['u3']);
  });
});

describe('deduplicateAssessmentRows - Latest Status Only acceptance requirement', () => {
  it('collapses historical Not Started -> In Progress -> Completed into exactly ONE Completed row', () => {
    const historicalRows = [
      { userId: 'emp_101', assessmentId: 'assess_sql', status: 'Not started', assignedAt: '2026-11-15T09:00:00Z' },
      { userId: 'emp_101', assessmentId: 'assess_sql', status: 'In progress', startedAt: '2026-11-17T11:00:00Z' },
      { userId: 'emp_101', assessmentId: 'assess_sql', status: 'Completed', completedAt: '2026-11-18T14:30:00Z', scorePct: 92 },
    ];

    const deduplicated = deduplicateAssessmentRows(historicalRows);
    expect(deduplicated).toHaveLength(1);
    expect(deduplicated[0].userId).toBe('emp_101');
    expect(deduplicated[0].assessmentId).toBe('assess_sql');
    expect(deduplicated[0].status).toBe('Completed');
    expect(deduplicated[0].completedAt).toBe('2026-11-18T14:30:00Z');
    expect(deduplicated[0].scorePct).toBe(92);
  });

  it('preserves separate records for genuinely different assessments for the same employee', () => {
    const rows = [
      { userId: 'emp_101', assessmentId: 'assess_sql', status: 'Completed', completedAt: '2026-11-18T14:30:00Z' },
      { userId: 'emp_101', assessmentId: 'assess_python', status: 'In progress', startedAt: '2026-11-18T15:00:00Z' },
    ];

    const deduplicated = deduplicateAssessmentRows(rows);
    expect(deduplicated).toHaveLength(2);
    expect(deduplicated.map(r => r.assessmentId).sort()).toEqual(['assess_python', 'assess_sql']);
  });
});
