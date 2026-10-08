import { describe, it, expect } from 'vitest';
import { ratingFromPercent, percentFromCounts, ratingForReport, RATINGS, readinessFromRating, ratingDistribution } from './grading.js';
import { ASSESSMENT_DURATION_MINUTES, normalizeDuration } from './assessmentDefaults.js';
import { resolveWindow, parseWindowInput } from './assessmentSchedule.js';

describe('rating scale: Expert >= 90, Intermediate 80-89.99, Basic 70-79.99, No Rating <= 69.99', () => {
  it.each([
    [100, 'Expert'], [90, 'Expert'], [90.0001, 'Expert'],
    [89.99, 'Intermediate'], [89.995, 'Intermediate'], [89.99999999, 'Intermediate'], [80, 'Intermediate'], [80.5, 'Intermediate'],
    [79.99, 'Basic'], [79.995, 'Basic'], [70, 'Basic'], [75, 'Basic'],
    [69.99, 'No Rating'], [69.995, 'No Rating'], [50, 'No Rating'], [0, 'No Rating'],
  ])('%s -> %s', (pct, rating) => {
    expect(ratingFromPercent(pct)).toBe(rating);
  });

  it('handles non-numeric input', () => {
    expect(ratingFromPercent(NaN)).toBe('No Rating');
    expect(ratingFromPercent(undefined)).toBe('No Rating');
  });

  it('is exact on boundaries computed from counts (no float drift)', () => {
    expect(ratingFromPercent(percentFromCounts(18, 20))).toBe('Expert'); // exactly 90
    expect(ratingFromPercent(percentFromCounts(17, 20))).toBe('Intermediate'); // exactly 85
    expect(ratingFromPercent(percentFromCounts(16, 20))).toBe('Intermediate'); // exactly 80
    expect(ratingFromPercent(percentFromCounts(15, 20))).toBe('Basic'); // exactly 75
    expect(ratingFromPercent(percentFromCounts(14, 20))).toBe('Basic'); // exactly 70
    expect(ratingFromPercent(percentFromCounts(13, 20))).toBe('No Rating'); // 65
    expect(ratingFromPercent(percentFromCounts(179, 200))).toBe('Intermediate'); // 89.5
    expect(ratingFromPercent(percentFromCounts(139, 200))).toBe('No Rating'); // 69.5
    expect(ratingFromPercent(percentFromCounts(0, 0))).toBe('No Rating');
  });

  it('never rates on a rounded score', () => {
    expect(ratingFromPercent(89.6)).toBe('Intermediate'); // rounds to 90
    expect(ratingFromPercent(79.6)).toBe('Basic'); // rounds to 80
    expect(ratingFromPercent(69.6)).toBe('No Rating'); // rounds to 70
  });

  it('rates old reports that carry a letter grade or pass flag', () => {
    expect(ratingForReport({ correct: 91, total: 100, grade: 'C' })).toBe('Expert');
    expect(ratingForReport({ correct: 0, total: 10, grade: 'A' })).toBe('No Rating');
    expect(ratingForReport({ score: 82, grade: 'C', passed: false })).toBe('Intermediate');
    expect(ratingForReport({ rawScore: 79.9, score: 80, grade: 'B' })).toBe('Basic');
    expect(ratingForReport({ grade: 'A' })).toBe('No Rating');
    expect(ratingForReport(null)).toBe('No Rating');
  });

  it('exposes ordered ratings with colours and a derived readiness', () => {
    expect(RATINGS.map((r) => r.label)).toEqual(['Expert', 'Intermediate', 'Basic', 'No Rating']);
    expect(RATINGS.map((r) => r.color)).toEqual(['green', 'blue', 'amber', 'red']);
    expect(readinessFromRating('Expert')).toBe('Ready');
    expect(readinessFromRating('No Rating')).toBe('Not yet rated');
    const d = ratingDistribution(['Expert', 'Expert', 'Basic', 'No Rating']);
    expect(d.map((x) => x.count)).toEqual([2, 0, 1, 1]);
    expect(d[0].percent).toBe(50);
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
