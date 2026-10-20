// Client mirror of server/services/grading.js and assessmentDefaults.js.
// Keep the two in sync: the server rates new submissions, this file makes
// older stored reports and every rating chip follow the same scale.

export const ASSESSMENT_DURATION_MINUTES = 60;

// Multiple-choice questions can have more than one correct option. The server
// stores the correct set as "A,C" (or flags `multiple`); mirror of
// server/services/answerMatching.js, kept small because only detection and the
// separator are needed here.
export const MULTI_ANSWER_SEPARATOR = ' || ';
export function isMultiAnswerQuestion(q) {
  if (!q) return false;
  if (q.multiple === true || q.multiSelect === true) return true;
  const a = Array.isArray(q.answer) ? q.answer.join(',') : String(q.answer ?? '');
  return (a.toUpperCase().match(/\b[A-D]\b/g) || []).length > 1 && /^\s*[A-Da-d](\s*(,|;|&|\/|\band\b)\s*[A-Da-d])+\s*$/i.test(a);
}

// Assessments saved with the old 30-minute default are shown and timed as 60.
export function normalizeDuration(minutes) {
  const n = Number(minutes);
  if (!Number.isFinite(n) || n <= 0 || n === 30) return ASSESSMENT_DURATION_MINUTES;
  return n;
}

// Expert: 90 and above. Intermediate: 80 to 89.99. Basic: 70 to 79.99.
// No Rating: 69.99 and below. Pass the UNROUNDED percentage; 1e-9 only absorbs
// floating-point noise.
const EPSILON = 1e-9;

export const RATING_LABELS = ['Expert', 'Intermediate', 'Basic', 'No Rating'];

export function ratingFromPercent(percent) {
  const p = Number(percent);
  if (!Number.isFinite(p)) return 'No Rating';
  if (p + EPSILON >= 90) return 'Expert';
  if (p + EPSILON >= 80) return 'Intermediate';
  if (p + EPSILON >= 70) return 'Basic';
  return 'No Rating';
}

// Rating for any stored report/scoring object, including old ones that carry a
// letter grade or pass flag. Uses exact counts first, then the best percentage.
export function ratingForReport(r) {
  if (!r) return 'No Rating';
  const correct = Number(r.correct);
  const total = Number(r.total);
  if (r.correct !== null && r.correct !== undefined && r.correct !== '' &&
      Number.isFinite(correct) && Number.isFinite(total) && total > 0) {
    return ratingFromPercent((correct * 100) / total);
  }
  for (const v of [r.rawScore, r.percentage, r.score]) {
    if (v !== null && v !== undefined && v !== '' && Number.isFinite(Number(v))) {
      return ratingFromPercent(Number(v));
    }
  }
  return 'No Rating';
}

// Tailwind classes for the dark slate UI. chip = pill, bar = solid fill, text = plain text colour.
export const RATING_STYLES = {
  Expert: {
    chip: 'bg-emerald-500/15 text-emerald-300 border border-emerald-500/40',
    bar: 'bg-emerald-500', text: 'text-emerald-300', ring: 'text-emerald-400', hex: '#10B981',
    range: '90 and above', readiness: 'Ready',
  },
  Intermediate: {
    chip: 'bg-sky-500/15 text-sky-300 border border-sky-500/40',
    bar: 'bg-sky-500', text: 'text-sky-300', ring: 'text-sky-400', hex: '#0EA5E9',
    range: '80 to 89.99', readiness: 'Nearly ready',
  },
  Basic: {
    chip: 'bg-amber-500/15 text-amber-300 border border-amber-500/40',
    bar: 'bg-amber-500', text: 'text-amber-300', ring: 'text-amber-400', hex: '#F59E0B',
    range: '70 to 79.99', readiness: 'Needs development',
  },
  'No Rating': {
    chip: 'bg-rose-500/15 text-rose-300 border border-rose-500/40',
    bar: 'bg-rose-500', text: 'text-rose-300', ring: 'text-rose-400', hex: '#F43F5E',
    range: '69.99 and below', readiness: 'Not yet rated',
  },
};

export function ratingStyle(label) {
  return RATING_STYLES[label] || RATING_STYLES['No Rating'];
}

// Readiness derived from the rating so the two never contradict each other.
export function readinessFromRating(label) {
  return ratingStyle(label).readiness;
}

// [{label, count, percent}] for a list of rating labels, in scale order.
export function ratingDistribution(labels = []) {
  const counts = Object.fromEntries(RATING_LABELS.map((l) => [l, 0]));
  for (const l of labels) if (counts[l] !== undefined) counts[l] += 1;
  const total = labels.length;
  return RATING_LABELS.map((label) => ({
    label,
    count: counts[label],
    percent: total ? (counts[label] * 100) / total : 0,
  }));
}
