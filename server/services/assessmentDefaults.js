// Every assessment gets a 60-minute time limit.
export const ASSESSMENT_DURATION_MINUTES = 60;

// Assessments created before the 60-minute rule were stored with the old
// 30-minute default. Treat that legacy value (and a missing one) as 60 when
// reading, so existing assessments follow the new limit without a data migration.
// Any other value was chosen deliberately by an admin and is kept.
const LEGACY_DEFAULT_MINUTES = 30;

export function normalizeDuration(minutes) {
  const n = Number(minutes);
  if (!Number.isFinite(n) || n <= 0 || n === LEGACY_DEFAULT_MINUTES) return ASSESSMENT_DURATION_MINUTES;
  return n;
}
