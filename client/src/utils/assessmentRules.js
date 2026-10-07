// Client mirror of server/services/grading.js and assessmentDefaults.js.
// Keep the two in sync: the server grades new submissions, this file makes
// older stored reports and every grade badge follow the same scale.

export const ASSESSMENT_DURATION_MINUTES = 60;

// Assessments saved with the old 30-minute default are shown and timed as 60.
export function normalizeDuration(minutes) {
  const n = Number(minutes);
  if (!Number.isFinite(n) || n <= 0 || n === 30) return ASSESSMENT_DURATION_MINUTES;
  return n;
}

// A: 85 and above, B: 70 up to (not including) 85, C: below 70.
// Pass the UNROUNDED percentage. 1e-9 only absorbs floating-point noise.
const EPSILON = 1e-9;
export function gradeFromPercent(percent) {
  const p = Number(percent);
  if (!Number.isFinite(p)) return 'C';
  if (p + EPSILON >= 85) return 'A';
  if (p + EPSILON >= 70) return 'B';
  return 'C';
}

// Grade for any stored report/scoring object, including old ones that carry a
// letter from the previous scale. Uses exact counts first, then the best
// percentage available, and only falls back to a stored letter with no score.
export function gradeForReport(r) {
  if (!r) return '';
  const correct = Number(r.correct);
  const total = Number(r.total);
  if (Number.isFinite(correct) && Number.isFinite(total) && total > 0) {
    return gradeFromPercent((correct * 100) / total);
  }
  for (const v of [r.rawScore, r.percentage, r.score]) {
    if (v !== null && v !== undefined && v !== '' && Number.isFinite(Number(v))) {
      return gradeFromPercent(Number(v));
    }
  }
  return r.grade || '';
}
