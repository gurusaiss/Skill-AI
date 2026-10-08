/**
 * assessmentListView.js - light "list" projections of assessments and reports.
 *
 * Why: GET /api/assessments used to return, for EVERY assessment, every
 * employee's full question set (300 questions x N employees x M assessments)
 * plus every submitted employee's responses and per-question breakdown, and
 * GET /api/assessments/reports/all returned every report with its full
 * `questions`/`responses`/`breakdown`. Those payloads reached hundreds of MB.
 * List pages only need ids, titles, counts, statuses, dates and scores; heavy
 * data is fetched by the detail endpoints when a row/modal is opened.
 *
 * Pure functions, no I/O.
 */

// Scalar score fields list/detail tables read from `ea.scoring`.
// `weakAreas` is kept because "Auto-assign modules" reads it per employee.
const SCORING_KEYS = ['score', 'rawScore', 'rating', 'grade', 'correct', 'total', 'passThreshold', 'passed', 'weakAreas'];

export function slimScoring(scoring) {
  if (!scoring || typeof scoring !== 'object') return scoring;
  const out = {};
  for (const k of SCORING_KEYS) if (scoring[k] !== undefined) out[k] = scoring[k];
  return out;
}

function slimAttempt(at) {
  if (!at || typeof at !== 'object') return at;
  const { questions: _q, responses: _r, scoring, ...rest } = at;
  return scoring ? { ...rest, scoring: slimScoring(scoring) } : rest;
}

/** Roster entry without question text / answers / per-question breakdown. */
export function toListAssignment(ea) {
  if (!ea || typeof ea !== 'object') return ea;
  const { questions: _q, responses: _r, scoring, attempts, ...rest } = ea;
  const out = { ...rest };
  if (scoring !== undefined) out.scoring = slimScoring(scoring);
  if (Array.isArray(attempts)) out.attempts = attempts.map(slimAttempt);
  return out;
}

/**
 * Assessment row for list pages. Keeps every top-level field except a legacy
 * top-level `questions` array (replaced by `questionCount`). `_light: true`
 * tells clients the roster is slim and detail must be fetched on open.
 */
export function toListAssessment(assessment) {
  if (!assessment || typeof assessment !== 'object') return assessment;
  const { questions, ...rest } = assessment;
  const out = { ...rest, _light: true };
  if (out.questionCount == null && Array.isArray(questions)) out.questionCount = questions.length;
  if (Array.isArray(out.employeeAssignments)) out.employeeAssignments = out.employeeAssignments.map(toListAssignment);
  return out;
}

/** Report row for list pages: drops the three per-question arrays. */
export function toListReport(report) {
  if (!report || typeof report !== 'object') return report;
  const { questions, responses, breakdown, ...rest } = report;
  return { ...rest, _light: true };
}
