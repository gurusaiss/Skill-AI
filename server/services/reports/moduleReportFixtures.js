// Fake module assignments for tests and sample-file generation. No I/O.
import { applyEngagementEvent } from '../moduleEngagement.js';

export const FAKE_MODULE = {
  id: 'mod-1',
  title: 'Customer Escalation Handling',
  content: {
    sessions: [
      { title: 'Foundations', blocks: [{ type: 'prose', title: 'Why escalations happen' }, { type: 'checklist', title: 'First response checklist' }] },
      { title: 'Difficult conversations', blocks: [{ type: 'example', title: 'A calm reply' }] },
      { title: 'Closing the loop', blocks: [] },
    ],
  },
};

export function fakeResults(n, correctN, { skipEvery = 0 } = {}) {
  return Array.from({ length: n }, (_, i) => {
    const skipped = skipEvery && i % skipEvery === skipEvery - 1 && i >= correctN;
    const isCorrect = i < correctN;
    return {
      question: `Q${i + 1}: what should the agent do first in situation ${i + 1}? ${i % 4 === 0 ? 'A long scenario sentence. '.repeat(15) : ''}`,
      type: i % 5 === 4 ? 'subjective' : 'mcq',
      options: ['A) Apologise and listen', 'B) Transfer the call', 'C) Close the ticket', 'D) Ignore it'],
      answer: 'A',
      explanation: i % 2 === 0 ? 'Listening first keeps the customer calm and surfaces the real issue.' : '',
      userAnswer: skipped ? '' : (isCorrect ? 'A) Apologise and listen' : 'B) Transfer the call'),
      isCorrect: skipped ? false : isCorrect,
      answeredAt: skipped ? null : '2026-10-02T06:15:00.000Z',
      skill: ['Empathy', 'Process', 'Tone'][i % 3],
    };
  });
}

function event(idx, results, over = {}) {
  return {
    sessionIndex: idx, sessionTitle: FAKE_MODULE.content.sessions[idx]?.title, startedAt: '2026-10-02T06:00:00.000Z', opened: true, addSeconds: 900,
    sectionsViewed: (FAKE_MODULE.content.sessions[idx]?.blocks || []).map(b => ({ title: b.title, type: b.type })),
    attempt: results ? { startedAt: '2026-10-02T06:10:00.000Z', submittedAt: '2026-10-02T06:20:00.000Z', timeSpentSeconds: 600, results } : undefined,
    ...over,
  };
}

const base = (over = {}) => ({
  id: 'assign_x', type: 'module', assignable_type: 'module', assignable_id: 'mod-1', assigned_to_user: 'u1', status: 'completed', progress: 100,
  created_at: '2026-09-28T05:00:00.000Z', updated_at: '2026-10-03T09:00:00.000Z', due_date: '2026-10-20T00:00:00.000Z', title: 'Customer Escalation Handling',
  session_progress: {}, progress_data: {}, ...over,
});

/** Completed with full engagement (3 days, one retry on day 2, one skipped answer). */
export function fakeCompleted() {
  let pd = {};
  pd = applyEngagementEvent(pd, event(0, fakeResults(10, 9)), '2026-10-02T06:20:00.000Z');
  pd = applyEngagementEvent(pd, event(1, fakeResults(10, 5, { skipEvery: 3 })), '2026-10-03T06:20:00.000Z');
  pd = applyEngagementEvent(pd, event(1, fakeResults(10, 8), { opened: false, addSeconds: 300, attempt: { startedAt: '2026-10-03T07:00:00.000Z', submittedAt: '2026-10-03T07:08:00.000Z', timeSpentSeconds: 480, results: fakeResults(10, 8) } }), '2026-10-03T07:08:00.000Z');
  pd = applyEngagementEvent(pd, event(2, fakeResults(10, 10)), '2026-10-04T06:20:00.000Z');
  return base({ id: 'assign_done', session_progress: { 0: 'completed', 1: 'completed', 2: 'completed' }, progress_data: pd });
}

/** In progress, saved before engagement capture: only sessionReports exist. */
export function fakeLegacyInProgress() {
  return base({
    id: 'assign_legacy', assigned_to_user: 'u2', status: 'in_progress', progress: 33,
    session_progress: { 0: 'completed' },
    progress_data: { sessionReports: { 0: { score: 70, correct: 7, total: 10, completedAt: '2026-10-01T10:00:00.000Z', sessionTitle: 'Foundations', results: fakeResults(10, 7) } } },
  });
}

/** Completed long ago: nothing but status and progress. */
export function fakeNoData() {
  return base({ id: 'assign_nodata', assigned_to_user: 'u3', status: 'completed', progress: 100, session_progress: {}, progress_data: null, updated_at: undefined, created_at: undefined });
}

/** One employee with lots of questions in one day (export cap / layout stress). */
export function fakeMany(n = 50) {
  const pd = applyEngagementEvent({}, event(0, fakeResults(n, Math.round(n * 0.6))), '2026-10-02T06:20:00.000Z');
  return base({ id: 'assign_many', assigned_to_user: 'u4', status: 'in_progress', progress: 33, session_progress: { 0: 'completed' }, progress_data: pd });
}

export const FAKE_USERS = {
  u1: { userId: 'u1', employeeId: 'EMP001', name: 'Aarav Mehta', email: 'aarav@example.com', jobRole: 'Support Agent', department: 'Operations', managerId: 'm1' },
  u2: { userId: 'u2', employeeId: 'EMP002', name: 'Diya Nair', email: 'diya@example.com', jobRole: 'Support Agent', department: 'Operations', managerId: 'm1' },
  u3: { userId: 'u3', employeeId: 'EMP003', name: 'Rohan Iyer', email: 'rohan@example.com', jobRole: 'Team Lead', department: 'Quality', managerId: 'm1' },
  u4: { userId: 'u4', employeeId: 'EMP004', name: 'Sneha Kulkarni', email: 'sneha@example.com', jobRole: 'Analyst', department: 'Quality', managerId: 'm1' },
};
export const FAKE_MANAGER = { userId: 'm1', name: 'Priya Desai' };
