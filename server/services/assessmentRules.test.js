import { describe, it, expect } from 'vitest';
import { gradeFromPercent, percentFromCounts, gradeForReport } from './grading.js';
import { ASSESSMENT_DURATION_MINUTES, normalizeDuration } from './assessmentDefaults.js';
import { resolveWindow, parseWindowInput } from './assessmentSchedule.js';

describe('letter grades: A >= 85, B 70 to < 85, C < 70', () => {
  it.each([
    [100, 'A'], [85, 'A'], [85.0001, 'A'],
    [84.9999, 'B'], [84.99999999, 'B'], [80, 'B'], [70.0001, 'B'], [70, 'B'],
    [69.9999, 'C'], [69, 'C'], [0, 'C'],
  ])('%s -> %s', (pct, grade) => {
    expect(gradeFromPercent(pct)).toBe(grade);
  });

  it('is exact on boundaries computed from counts (no float drift)', () => {
    expect(gradeFromPercent(percentFromCounts(17, 20))).toBe('A'); // exactly 85
    expect(gradeFromPercent(percentFromCounts(14, 20))).toBe('B'); // exactly 70
    expect(gradeFromPercent(percentFromCounts(169, 200))).toBe('B'); // 84.5
    expect(gradeFromPercent(percentFromCounts(139, 200))).toBe('C'); // 69.5, must not round up to 70
    expect(gradeFromPercent(percentFromCounts(0, 0))).toBe('C');
  });

  it('never grades on a rounded score', () => {
    // 84.6 rounds to 85 but is a B; 69.6 rounds to 70 but is a C.
    expect(gradeFromPercent(84.6)).toBe('B');
    expect(gradeFromPercent(69.6)).toBe('C');
  });

  it('regrades old reports that carry a letter from the previous scale', () => {
    expect(gradeForReport({ correct: 87, total: 100, grade: 'B' })).toBe('A');
    expect(gradeForReport({ score: 72, grade: 'C' })).toBe('B');
    expect(gradeForReport({ rawScore: 84.9, score: 85, grade: 'B' })).toBe('B');
    expect(gradeForReport({ grade: 'D' })).toBe('D');
    expect(gradeForReport(null)).toBe('');
  });
});

describe('assessment time limit is 60 minutes', () => {
  it('uses 60 as the default', () => {
    expect(ASSESSMENT_DURATION_MINUTES).toBe(60);
  });
  it('treats the legacy 30-minute default and missing values as 60', () => {
    expect(normalizeDuration(30)).toBe(60);
    expect(normalizeDuration(undefined)).toBe(60);
    expect(normalizeDuration(null)).toBe(60);
    expect(normalizeDuration(0)).toBe(60);
  });
  it('keeps a limit an admin deliberately chose', () => {
    expect(normalizeDuration(45)).toBe(45);
    expect(normalizeDuration(60)).toBe(60);
    expect(normalizeDuration(90)).toBe(90);
  });
});

describe('per-employee assessment window', () => {
  const day = 86400000;
  const future = (d) => new Date(Date.now() + d * day).toISOString();

  it('rejects a missing, past, or inverted end date', () => {
    expect(parseWindowInput({}).error).toMatch(/End date is required/);
    expect(parseWindowInput({ endDate: new Date(Date.now() - day).toISOString() }).error).toMatch(/future/);
    expect(parseWindowInput({ startDate: future(5), endDate: future(2) }).error).toMatch(/after the start/);
    expect(parseWindowInput({ endDate: 'not a date' }).error).toMatch(/not a valid/);
  });

  it('accepts a valid window and defaults the start to now', () => {
    const w = parseWindowInput({ endDate: future(3) });
    expect(w.error).toBeUndefined();
    expect(new Date(w.startAt).getTime()).toBeLessThanOrEqual(Date.now() + 1000);
    expect(new Date(w.dueAt).getTime()).toBeGreaterThan(Date.now());
  });

  it('treats a bare end date as the end of that day', () => {
    const d = new Date(Date.now() + 5 * day).toISOString().slice(0, 10);
    expect(parseWindowInput({ endDate: d }).dueAt).toBe(`${d}T23:59:59.999Z`);
  });

  it('prefers the employee window over the shared dates', () => {
    const assessment = { assessmentDate: '2026-01-01T00:00:00.000Z', deadline: '2026-02-01T00:00:00.000Z' };
    const ea = { startAt: '2026-10-01T00:00:00.000Z', dueAt: '2026-10-20T00:00:00.000Z' };
    const w = resolveWindow(assessment, ea, null);
    expect(w.dueAt).toBe('2026-10-20T00:00:00.000Z');
    expect(w.startAt).toBe('2026-10-01T00:00:00.000Z');
  });

  it('falls back to the version row, then the shared deadline', () => {
    const assessment = { deadline: '2026-02-01T00:00:00.000Z' };
    expect(resolveWindow(assessment, {}, { due_at: '2026-03-01T00:00:00.000Z' }).dueAt).toBe('2026-03-01T00:00:00.000Z');
    expect(resolveWindow(assessment, {}, null).dueAt).toBe('2026-02-01T00:00:00.000Z');
    expect(resolveWindow({}, {}, null)).toEqual({ startAt: null, dueAt: null });
  });

  it('keeps a scheduled shared start date even when the roster start is earlier', () => {
    const assessment = { assessmentDate: '2099-01-01T00:00:00.000Z' };
    const ea = { startAt: '2026-01-01T00:00:00.000Z' };
    expect(resolveWindow(assessment, ea, null).startAt).toBe('2099-01-01T00:00:00.000Z');
  });
});
