// Single source of truth for the RATING scale (replaces letter grades and Pass/Fail).
//   Expert        : score >= 90
//   Intermediate  : score >= 80 and < 90   (80 to 89.99)
//   Basic         : score >= 70 and < 80   (70 to 79.99)
//   No Rating     : score < 70             (69.99 and below)
// The comparison runs on the UNROUNDED percentage, so 89.995 is Intermediate and
// 69.995 is No Rating. EPSILON only absorbs binary floating-point noise (e.g.
// 28.999999999999996 for a true 29); it is far too small to move a real score
// across a boundary.
const EPSILON = 1e-9;

export const RATING_EXPERT_MIN = 90;
export const RATING_INTERMEDIATE_MIN = 80;
export const RATING_BASIC_MIN = 70;

// Ordered best to worst. `color` is a token the UI / reports map to a palette;
// `fill` / `text` are the hex colours (no #) used by the Excel, PDF and DOCX exports.
export const RATINGS = [
  { key: 'Expert', label: 'Expert', color: 'green', min: 90, range: '90 and above', readiness: 'Ready', fill: 'DCFCE7', text: '166534', solid: '16A34A' },
  { key: 'Intermediate', label: 'Intermediate', color: 'blue', min: 80, range: '80 to 89.99', readiness: 'Nearly ready', fill: 'DBEAFE', text: '1E40AF', solid: '2563EB' },
  { key: 'Basic', label: 'Basic', color: 'amber', min: 70, range: '70 to 79.99', readiness: 'Needs development', fill: 'FEF3C7', text: '92400E', solid: 'D97706' },
  { key: 'No Rating', label: 'No Rating', color: 'red', min: 0, range: '69.99 and below', readiness: 'Not yet rated', fill: 'FEE2E2', text: '991B1B', solid: 'DC2626' },
];

export const RATING_LABELS = RATINGS.map((r) => r.label);

export function ratingFromPercent(percent) {
  const p = Number(percent);
  if (!Number.isFinite(p)) return 'No Rating';
  if (p + EPSILON >= RATING_EXPERT_MIN) return 'Expert';
  if (p + EPSILON >= RATING_INTERMEDIATE_MIN) return 'Intermediate';
  if (p + EPSILON >= RATING_BASIC_MIN) return 'Basic';
  return 'No Rating';
}

// Rating for any stored scoring/report object, including ones saved before this
// scale existed (which carry a letter `grade`). Uses exact counts first, then the
// best available percentage. With no score at all it returns 'No Rating'.
export function ratingForReport(r) {
  if (!r) return 'No Rating';
  const correct = Number(r.correct);
  const total = Number(r.total);
  if (r.correct !== null && r.correct !== undefined && r.correct !== '' &&
      Number.isFinite(correct) && Number.isFinite(total) && total > 0) {
    return ratingFromPercent(percentFromCounts(correct, total));
  }
  for (const v of [r.rawScore, r.percentage, r.score]) {
    if (v !== null && v !== undefined && v !== '' && Number.isFinite(Number(v))) {
      return ratingFromPercent(Number(v));
    }
  }
  return 'No Rating';
}

export function ratingMeta(label) {
  return RATINGS.find((r) => r.label === label) || RATINGS[RATINGS.length - 1];
}

// Readiness derived from the rating so the two can never contradict each other.
export function readinessFromRating(label) {
  return ratingMeta(label).readiness;
}

// Count + share of every rating for a list of rating labels.
export function ratingDistribution(labels = []) {
  const counts = Object.fromEntries(RATINGS.map((r) => [r.label, 0]));
  for (const l of labels) if (counts[l] !== undefined) counts[l] += 1;
  const total = labels.length;
  return RATINGS.map((r) => ({
    label: r.label,
    count: counts[r.label],
    percent: total ? (counts[r.label] * 100) / total : 0,
  }));
}

// Exact percentage from counts. Multiplies before dividing so 17/20 is exactly 85,
// not 85.00000000000001 or 84.99999999999999.
export function percentFromCounts(correct, total) {
  if (!total || total <= 0) return 0;
  return (correct * 100) / total;
}
