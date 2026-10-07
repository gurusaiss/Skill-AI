import { describe, it, expect } from 'vitest';
import { toListAssessment, toListAssignment, toListReport, slimScoring } from './assessmentListView.js';

const bigScoring = {
  score: 72, rawScore: 72.4, grade: 'B', correct: 36, total: 50, passThreshold: 80, passed: false,
  weakAreas: ['SQL'], strengths: ['x'], breakdown: [{ questionIndex: 0 }], skillBreakdown: [1], skillAreas: { a: 1 },
};

describe('assessmentListView', () => {
  it('slimScoring keeps scalar score fields + weakAreas and drops per-question data', () => {
    const s = slimScoring(bigScoring);
    expect(s).toEqual({ score: 72, rawScore: 72.4, grade: 'B', correct: 36, total: 50, passThreshold: 80, passed: false, weakAreas: ['SQL'] });
    expect(slimScoring(null)).toBeNull();
  });

  it('toListAssignment drops questions/responses and slims scoring + attempts', () => {
    const ea = { userId: 'u1', status: 'submitted', startAt: 's', dueAt: 'd', questions: [{ id: 1 }], responses: [{ answer: 'a' }], scoring: bigScoring,
      attempts: [{ attemptNumber: 1, responses: [1], scoring: bigScoring, submittedAt: 't' }] };
    const out = toListAssignment(ea);
    expect(out.questions).toBeUndefined();
    expect(out.responses).toBeUndefined();
    expect(out.scoring.breakdown).toBeUndefined();
    expect(out.attempts[0].responses).toBeUndefined();
    expect(out.attempts[0].scoring.breakdown).toBeUndefined();
    expect(out).toMatchObject({ userId: 'u1', status: 'submitted', startAt: 's', dueAt: 'd' });
  });

  it('toListAssessment keeps top-level fields, flags _light, replaces top-level questions with questionCount', () => {
    const a = { id: 'a1', title: 'T', questions: [1, 2, 3], employeeAssignments: [{ userId: 'u', questions: [1] }], targetUsers: ['u'], settings: { passPercentage: 70 } };
    const out = toListAssessment(a);
    expect(out).toMatchObject({ id: 'a1', title: 'T', questionCount: 3, _light: true, targetUsers: ['u'], settings: { passPercentage: 70 } });
    expect(out.questions).toBeUndefined();
    expect(out.employeeAssignments[0].questions).toBeUndefined();
    // does not mutate the (shared, cached) source
    expect(a.employeeAssignments[0].questions).toEqual([1]);
    expect(a.questions).toHaveLength(3);
  });

  it('toListAssessment keeps an existing questionCount', () => {
    expect(toListAssessment({ id: 'x', questionCount: 300, questions: [1] }).questionCount).toBe(300);
  });

  it('toListReport drops the three per-question arrays only', () => {
    const r = { id: 'r', score: 80, questions: [1], responses: [2], breakdown: [3], weakAreas: ['a'], skillAreas: { a: 1 } };
    const out = toListReport(r);
    expect(out).toMatchObject({ id: 'r', score: 80, weakAreas: ['a'], skillAreas: { a: 1 }, _light: true });
    expect(out.questions).toBeUndefined();
    expect(out.responses).toBeUndefined();
    expect(out.breakdown).toBeUndefined();
  });
});
