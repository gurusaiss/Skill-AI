import { describe, it, expect, vi, beforeAll } from 'vitest';

const mockBank = {
  id: 'qbv-1',
  questions: [
    { id: 'q1', question: 'Q1?', type: 'mcq', options: ['A) 1', 'B) 2'], answer: 'A', locked: true },
    { id: 'q2', question: 'Q2?', type: 'mcq', options: ['A) 1', 'B) 2'], answer: 'B', locked: true },
    { id: 'q3', question: 'Q3?', type: 'mcq', options: ['A) 1', 'B) 2'], answer: 'A', locked: true },
  ],
};

vi.mock('../services/DataStore.js', async (orig) => {
  const actual = await orig();
  return {
    ...actual,
    QuestionBankVersions: {
      ...actual.QuestionBankVersions,
      getById: vi.fn(async (id) => (id === 'qbv-1' ? mockBank : null)),
    },
    EmployeeAssessmentAssignments: {
      ...actual.EmployeeAssessmentAssignments,
      getOne: vi.fn(async () => ({ assessment_id: 'a1', user_id: 'u1', question_order: ['q2', 'q1'] })),
      updateQuestionOrder: vi.fn(async () => {}),
    },
  };
});

let resolveEmployeeQuestions;
beforeAll(async () => {
  ({ resolveEmployeeQuestions } = await import('./assessment.js'));
});

describe('resolveEmployeeQuestions', () => {
  it('resolves version-backed questions even when assignment status is in_progress', async () => {
    const assessment = { id: 'a1', questionBankVersionId: 'qbv-1' };
    const assignment = { userId: 'u1', status: 'in_progress', attemptStartedAt: '2026-11-25T10:00:00Z' };

    const result = await resolveEmployeeQuestions(assessment, assignment, 'u1');

    expect(result.source).toBe('version');
    expect(result.questions.map(q => q.id)).toEqual(['q2', 'q1']);
  });

  it('resolves version-backed questions when assignment status is submitted', async () => {
    const assessment = { id: 'a1', questionBankVersionId: 'qbv-1' };
    const assignment = { userId: 'u1', status: 'submitted', startedAt: '2026-11-25T10:00:00Z' };

    const result = await resolveEmployeeQuestions(assessment, assignment, 'u1');

    expect(result.source).toBe('version');
    expect(result.questions.map(q => q.id)).toEqual(['q2', 'q1']);
  });

  it('reconciles missing locked questions when assignment has not started yet', async () => {
    const assessment = { id: 'a1', questionBankVersionId: 'qbv-1' };
    const assignment = { userId: 'u1', status: 'assigned' };

    const result = await resolveEmployeeQuestions(assessment, assignment, 'u1');

    expect(result.source).toBe('version');
    expect(result.questions.map(q => q.id)).toEqual(['q2', 'q1', 'q3']);
  });

  it('keeps embedded questions when legacy assignment is in_progress', async () => {
    const assessment = { id: 'a2', questionBankVersionId: 'qbv-1' };
    const assignment = {
      userId: 'u1',
      status: 'in_progress',
      questions: [{ id: 'legacy-1', question: 'Legacy?', type: 'mcq', options: ['A) Yes', 'B) No'], answer: 'A' }],
    };

    const result = await resolveEmployeeQuestions(assessment, assignment, 'u1');

    expect(result.source).toBe('embedded');
    expect(result.questions.map(q => q.id)).toEqual(['legacy-1']);
  });
});
