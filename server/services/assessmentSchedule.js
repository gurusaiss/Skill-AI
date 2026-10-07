// ── Per-employee schedule ────────────────────────────────────────────────────
// An assessment has a shared `assessmentDate` (start) and `deadline` (end), but
// an employee added or reassigned later needs their OWN window. That window is
// stored on the roster entry (`startAt`/`dueAt`) and, for version-backed
// assessments, on the employee_assessment_assignments row (start_at/due_at).
// Resolution order matches what every reader must use so GET /my, submit,
// reminders and the admin table never disagree about someone's deadline:
//   due   = roster dueAt  -> eaa.due_at  -> assessment.deadline
//   start = latest of roster startAt, eaa.start_at, assessment.assessmentDate
function resolveWindow(assessment, assignment, eaaRow) {
  const dueAt = assignment?.dueAt || eaaRow?.due_at || assessment?.deadline || null;
  const starts = [assignment?.startAt, eaaRow?.start_at, assessment?.assessmentDate]
    .filter(Boolean)
    .map(v => new Date(v))
    .filter(d => !Number.isNaN(d.getTime()));
  const startAt = starts.length ? new Date(Math.max(...starts.map(d => d.getTime()))).toISOString() : null;
  return { startAt, dueAt };
}

// Accepts full ISO timestamps (what the client sends). A bare YYYY-MM-DD end
// date means "through the end of that day".
function parseWindowInput({ startDate, endDate }) {
  const toDate = (v, endOfDay) => {
    if (!v) return null;
    const s = String(v).trim();
    const d = /^\d{4}-\d{2}-\d{2}$/.test(s) ? new Date(`${s}T${endOfDay ? '23:59:59.999' : '00:00:00.000'}Z`) : new Date(s);
    return Number.isNaN(d.getTime()) ? undefined : d;
  };
  const start = toDate(startDate, false);
  const end = toDate(endDate, true);
  if (start === undefined) return { error: 'Start date is not a valid date' };
  if (end === undefined) return { error: 'End date is not a valid date' };
  if (!end) return { error: 'End date is required' };
  const startAt = start || new Date();
  if (end.getTime() <= Date.now()) return { error: 'End date must be in the future' };
  if (end.getTime() <= startAt.getTime()) return { error: 'End date must be after the start date' };
  return { startAt: startAt.toISOString(), dueAt: end.toISOString() };
}


export { resolveWindow, parseWindowInput };
