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

const { loadAssessmentRows, loadSubmissionRows, loadPendingRows } = await import('./reportLoader.js');

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
