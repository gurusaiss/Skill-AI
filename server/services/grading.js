// Single source of truth for letter grades.
//   A: score >= 85
//   B: score >= 70 and < 85
//   C: score < 70
// The comparison runs on the UNROUNDED percentage. Rounding first would turn
// 84.6 into 85 (an A) and 69.6 into 70 (a B), which is exactly what the rule
// forbids. EPSILON only absorbs binary floating-point noise (e.g. 28.999999999999996
// for a true 29), it is far too small to move a real score across a boundary.
const EPSILON = 1e-9;

export const GRADE_A_MIN = 85;
export const GRADE_B_MIN = 70;

export function gradeFromPercent(percent) {
  const p = Number(percent);
  if (!Number.isFinite(p)) return 'C';
  if (p + EPSILON >= GRADE_A_MIN) return 'A';
  if (p + EPSILON >= GRADE_B_MIN) return 'B';
  return 'C';
}

// Grade for any stored scoring/report object, including ones saved before this
// scale existed (which carry an old 90/80/70/60 letter). Recomputes from the
// exact counts when present, else from the best available percentage, and only
// falls back to the stored letter when there is no score at all.
export function gradeForReport(r) {
  if (!r) return '';
  const correct = Number(r.correct);
  const total = Number(r.total);
  if (Number.isFinite(correct) && Number.isFinite(total) && total > 0) {
    return gradeFromPercent(percentFromCounts(correct, total));
  }
  for (const v of [r.rawScore, r.percentage, r.score]) {
    if (v !== null && v !== undefined && v !== '' && Number.isFinite(Number(v))) {
      return gradeFromPercent(Number(v));
    }
  }
  return r.grade || '';
}

// Exact percentage from counts. Multiplies before dividing so 17/20 is exactly 85,
// not 85.00000000000001 or 84.99999999999999.
export function percentFromCounts(correct, total) {
  if (!total || total <= 0) return 0;
  return (correct * 100) / total;
}
