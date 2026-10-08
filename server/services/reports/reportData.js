/**
 * reportData.js — pure data assembly + safe formatting for assessment report
 * downloads (Excel / PDF / Word). No I/O in here: everything takes plain
 * objects so it can be unit-tested with fake data.
 *
 * Rule: nothing that reaches a downloaded file may ever read "undefined",
 * "null", "NaN" or "Invalid Date" — missing values become an em dash.
 */
import { ratingForReport, ratingFromPercent, ratingDistribution, readinessFromRating, RATINGS } from '../grading.js';
import { normalizeDuration } from '../assessmentDefaults.js';
import { resolveWindow } from '../assessmentSchedule.js';

export const DASH = '—';

export function reportTimezone() {
  return process.env.REPORT_TIMEZONE || 'Asia/Kolkata';
}

// ── safe formatting ─────────────────────────────────────────────────────────
const BAD_STRINGS = new Set(['undefined', 'null', 'nan', 'invalid date', '[object object]']);

/** Any value -> a display string, never "undefined"/"null"/"NaN". */
export function safe(v, fallback = DASH) {
  if (v === null || v === undefined) return fallback;
  if (typeof v === 'number') return Number.isFinite(v) ? String(v) : fallback;
  if (typeof v === 'boolean') return v ? 'Yes' : 'No';
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? fallback : v.toISOString();
  if (Array.isArray(v)) {
    const parts = v.map(x => safe(x, '')).filter(Boolean);
    return parts.length ? parts.join('; ') : fallback;
  }
  if (typeof v === 'object') return fallback;
  const s = String(v).replace(/\s+/g, ' ').trim();
  if (!s || BAD_STRINGS.has(s.toLowerCase())) return fallback;
  return s;
}

/** Number or null (never NaN). */
export function num(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

export function toDate(v) {
  if (v === null || v === undefined || v === '') return null;
  const d = v instanceof Date ? v : new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

function tzOrUtc(tz) {
  try { new Intl.DateTimeFormat('en-US', { timeZone: tz }); return tz; } catch { return 'UTC'; }
}

function zonedParts(d, tz) {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: tzOrUtc(tz), year: 'numeric', month: 'short', day: '2-digit',
    hour: 'numeric', minute: '2-digit', hourCycle: 'h23',
  });
  const out = {};
  for (const p of fmt.formatToParts(d)) out[p.type] = p.value;
  return out;
}

/** "07 Oct 2026, 3:45 PM" in the report timezone (or "07 Oct 2026" with time:false). */
export function fmtDate(v, tz = reportTimezone(), { time = true } = {}) {
  const d = toDate(v);
  if (!d) return DASH;
  const p = zonedParts(d, tz);
  const date = `${p.day} ${p.month} ${p.year}`;
  if (!time) return date;
  const h24 = Number(p.hour) % 24;
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  return `${date}, ${h12}:${p.minute} ${h24 >= 12 ? 'PM' : 'AM'}`;
}

/** Excel serial number of the wall-clock time in the report timezone, or null. */
export function excelSerial(v, tz = reportTimezone()) {
  const d = toDate(v);
  if (!d) return null;
  const p = zonedParts(d, tz);
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const ms = Date.UTC(Number(p.year), MONTHS.indexOf(p.month), Number(p.day), Number(p.hour) % 24, Number(p.minute), d.getUTCSeconds());
  return ms / 86400000 + 25569;
}

/** minutes -> "42 min" / "1 h 05 min". */
export function fmtDuration(min) {
  const n = num(min);
  if (n === null || n < 0) return DASH;
  if (n >= 60) {
    const h = Math.floor(n / 60);
    const m = Math.round(n - h * 60);
    return m ? `${h} h ${String(m).padStart(2, '0')} min` : `${h} h`;
  }
  return `${Math.round(n * 10) / 10} min`;
}

export function fmtPct(v, digits = 0) {
  const n = num(v);
  if (n === null) return DASH;
  const f = 10 ** digits;
  return `${Math.round(n * f) / f}%`;
}

export function truncate(s, max) {
  const t = safe(s, '');
  if (t.length <= max) return { text: t, truncated: false };
  return { text: `${t.slice(0, max - 1).trimEnd()}…`, truncated: true };
}

// ── status ──────────────────────────────────────────────────────────────────
export const STATUS = {
  COMPLETED: 'Completed',
  IN_PROGRESS: 'In progress',
  NOT_STARTED: 'Not started',
  OVERDUE: 'Overdue',
  CANCELLED: 'Cancelled',
};

export function computeStatus(ea, dueAt, now = new Date()) {
  if (ea?.status === 'cancelled') return STATUS.CANCELLED;
  if (ea?.status === 'submitted') return STATUS.COMPLETED;
  const due = toDate(dueAt);
  if (due && due.getTime() < now.getTime()) return STATUS.OVERDUE;
  const started = ea?.attemptStartedAt || ea?.startedAt || ea?.status === 'in_progress';
  return started ? STATUS.IN_PROGRESS : STATUS.NOT_STARTED;
}

export function timeTakenSeconds(startedAt, submittedAt, limitMinutes) {
  const s = toDate(startedAt);
  const e = toDate(submittedAt);
  if (!s || !e) return null;
  const diff = Math.round((e.getTime() - s.getTime()) / 1000);
  if (diff < 0) return null;
  const cap = num(limitMinutes) ? limitMinutes * 60 : null;
  return cap ? Math.min(diff, cap) : diff;
}

// ── result row ──────────────────────────────────────────────────────────────
const first = (...vals) => {
  for (const v of vals) if (v !== null && v !== undefined && v !== '') return v;
  return null;
};

const asList = (v) => (Array.isArray(v) ? v : []).map(x => (typeof x === 'string' ? x : x?.area || x?.skill || '')).map(s => safe(s, '')).filter(Boolean);

const TYPE_LABEL = { mcq: 'Multiple choice', multiple_choice: 'Multiple choice', fill_blank: 'Fill in the blank', fill_in_blank: 'Fill in the blank', subjective: 'Written answer' };
const cap1 = (s) => { const t = safe(s, ''); return t ? t[0].toUpperCase() + t.slice(1) : ''; };

/**
 * One employee x one assessment -> a flat, fully-resolved row. Snapshot values
 * saved at submit time win; older records fall back to the live user lookup.
 */
export function buildResultRow({ assessment = {}, ea = {}, report = null, eaaRow = null, user = null, manager = null, group = null, company = null, reminders = [], now = new Date() }) {
  const completed = ea.status === 'submitted';
  const sc = completed ? (report || ea.scoring || null) : null;
  const snap = completed ? (report || {}) : {};
  const win = resolveWindow(assessment, ea, eaaRow);
  const limitMin = normalizeDuration(assessment.duration);

  const correct = num(sc?.correct);
  const total = num(first(sc?.total, completed ? assessment.questionCount : null, completed ? null : assessment.questionCount));
  let scorePct = num(first(sc?.rawScore, (correct !== null && total) ? (correct * 100) / total : null, sc?.score));
  if (scorePct !== null) scorePct = Math.round(scorePct * 10) / 10;

  const skills = (Array.isArray(sc?.skillBreakdown) ? sc.skillBreakdown : []).map(s => {
    const c = num(s.correct), t = num(s.total);
    const pct = num(first(s.pct, s.score, (c !== null && t) ? Math.round((c / t) * 100) : null));
    return { skill: safe(s.skill, 'General'), correct: c, total: t, pct };
  });

  // A start we could not record (flagged at submit) is shown as unknown, never invented.
  const startUnknown = completed && Boolean(snap.attemptStartUnknown ?? ea.attemptStartUnknown);
  const startedAt = startUnknown ? null : first(ea.attemptStartedAt, snap.attemptStartedAt, ea.startedAt);
  const completedAt = completed ? first(ea.submittedAt, report?.submittedAt) : null;
  let takenSec = completed ? num(first(snap.timeTakenSeconds, ea.timeTakenSeconds)) : null;
  if (completed && takenSec === null && !startUnknown) takenSec = timeTakenSeconds(startedAt, completedAt, limitMin);

  const attemptNo = num(first(snap.attemptNumber, ea.attemptNumber)) ?? ((Array.isArray(ea.attempts) ? ea.attempts.length : 0) + 1);

  const sentReminders = (Array.isArray(reminders) ? reminders : []).filter(r => !r.delivery_status || r.delivery_status === 'sent');
  const lastReminder = sentReminders.map(r => toDate(r.sent_at)).filter(Boolean).sort((a, b) => b - a)[0] || null;

  const questions = completed ? buildQuestionRows(sc, report) : [];
  const status = computeStatus(ea, win.dueAt, now);

  // Completed: the values frozen at submit time win. Not completed: there is no
  // snapshot of this attempt, so the live record is the truth (roster copy last).
  const pick = (field, live) => (completed ? first(snap[field], ea[field], live) : first(live, ea[field]));
  const managerName = completed ? first(snap.managerName, ea.managerName, manager?.name, group?.managerName) : first(manager?.name, group?.managerName, ea.managerName);
  const managerId = pick('managerId', first(user?.managerId, group?.managerId));

  return {
    userId: ea.userId || user?.userId || '',
    employeeId: safe(pick('employeeId', user?.employeeId), ''),
    name: safe(first(ea.userName, snap.userName, user?.name, ea.userId), ''),
    email: safe(first(ea.userEmail, snap.userEmail, user?.email), ''),
    phone: safe(pick('phone', user?.phone), ''),
    jobRole: safe(first(ea.jobRole, snap.jobRole, user?.jobRole), ''),
    department: safe(pick('department', user?.department), ''),
    group: safe(group?.name, ''),
    managerName: safe(managerName, ''),
    managerId: safe(managerId, ''),
    companyName: safe(completed ? first(snap.companyName, ea.companyName, company?.name, user?.companyName) : first(company?.name, user?.companyName, ea.companyName), ''),
    assessmentId: assessment.id || '',
    assessmentTitle: safe(first(assessment.title, report?.assessmentTitle), ''),
    assessmentType: safe(first(snap.assessmentType, assessment.assessmentType), ''),
    assignedAt: first(ea.assignedAt, snap.assignedAt, eaaRow?.assigned_at, assessment.createdAt),
    windowStart: first(win.startAt, ea.startAt, snap.startAt),
    dueAt: first(win.dueAt, ea.dueAt, snap.dueAt),
    startedAt,
    completedAt,
    status,
    timeTakenMin: takenSec === null ? null : Math.round((takenSec / 60) * 10) / 10,
    timeLimitMin: limitMin,
    attemptNo,
    correct,
    total,
    scorePct,
    // Rating replaces the letter grade and Pass/Fail. Old stored reports are
    // rated here from their counts/percentage. Readiness is derived from the
    // rating so the two can never contradict each other.
    rating: completed && sc ? ratingForReport(sc) : '',
    readiness: completed && sc ? readinessFromRating(ratingForReport(sc)) : '',
    skills,
    skillScoresText: skills.map(s => `${s.skill} ${s.pct === null ? DASH : `${s.pct}%`}`).join('; '),
    strengths: asList(sc?.strengths),
    weakAreas: asList(sc?.weakAreas),
    missingSkills: asList(sc?.missingCompetencies),
    recommendations: asList(report?.improvementRecommendations || sc?.recommendedLearningAreas),
    remindersCount: sentReminders.length,
    lastReminderAt: lastReminder,
    questions,
  };
}

export function buildQuestionRows(sc, report) {
  const breakdown = Array.isArray(sc?.breakdown) ? sc.breakdown : [];
  const qs = Array.isArray(report?.questions) ? report.questions : [];
  return breakdown.map((b, i) => {
    const answered = safe(b.userAnswer, '') !== '';
    const result = !answered ? 'Not answered' : (b.isCorrect ? 'Correct' : 'Wrong');
    return {
      no: i + 1,
      question: safe(b.question, ''),
      type: TYPE_LABEL[String(b.type || '').toLowerCase()] || cap1(b.type) || 'Written answer',
      difficulty: cap1(first(qs[i]?.difficulty, b.difficulty)),
      skill: safe(b.skillArea, ''),
      userAnswer: answered ? safe(b.userAnswer, '') : '',
      correctAnswer: safe(first(b.correctOptionText, b.correctAnswer), ''),
      result,
      marks: b.isCorrect ? 1 : 0,
      explanation: safe(b.explanation, ''),
    };
  });
}

// ── aggregates ──────────────────────────────────────────────────────────────
export function buildSummary(rows, assessment = {}, company = null, now = new Date()) {
  const active = rows.filter(r => r.status !== STATUS.CANCELLED);
  const done = active.filter(r => r.status === STATUS.COMPLETED);
  const scores = done.map(r => r.scorePct).filter(s => s !== null);
  const count = (s) => active.filter(r => r.status === s).length;
  const ratings = ratingDistribution(done.filter(r => r.rating).map(r => r.rating));
  const ratingCounts = Object.fromEntries(ratings.map(x => [x.label, x.count]));
  const topN = (ratingCounts.Expert || 0) + (ratingCounts.Intermediate || 0);
  const win = rows[0] ? { start: rows[0].windowStart, due: rows[0].dueAt } : { start: assessment.assessmentDate, due: assessment.deadline };
  const dues = rows.map(r => toDate(r.dueAt)).filter(Boolean).sort((a, b) => a - b);
  const starts = rows.map(r => toDate(r.windowStart)).filter(Boolean).sort((a, b) => a - b);
  return {
    title: safe(assessment.title, ''),
    type: safe(assessment.assessmentType, ''),
    jobRoles: [...new Set(rows.map(r => r.jobRole).filter(Boolean))],
    company: safe(first(company?.name, rows.find(r => r.companyName)?.companyName), ''),
    createdAt: assessment.createdAt || null,
    startAt: starts[0] || win.start || null,
    dueAt: dues.length ? dues[dues.length - 1] : (win.due || null),
    timeLimitMin: normalizeDuration(assessment.duration),
    assigned: active.length,
    completed: done.length,
    inProgress: count(STATUS.IN_PROGRESS),
    notStarted: count(STATUS.NOT_STARTED),
    overdue: count(STATUS.OVERDUE),
    cancelled: rows.length - active.length,
    notCompleted: active.length - done.length,
    completionPct: active.length ? Math.round((done.length / active.length) * 1000) / 10 : null,
    avgScore: scores.length ? Math.round((scores.reduce((a, b) => a + b, 0) / scores.length) * 10) / 10 : null,
    highScore: scores.length ? Math.max(...scores) : null,
    lowScore: scores.length ? Math.min(...scores) : null,
    ratings,
    ratingCounts,
    topSharePct: done.length ? Math.round((topN / done.length) * 1000) / 10 : null,
    generatedAt: now,
  };
}

/** Average score per skill across all completed employees (sum correct / sum total). */
export function skillAverages(rows) {
  const map = new Map();
  for (const r of rows) {
    if (r.status !== STATUS.COMPLETED) continue;
    for (const s of r.skills) {
      if (s.correct === null || !s.total) continue;
      const m = map.get(s.skill) || { skill: s.skill, correct: 0, total: 0, people: 0 };
      m.correct += s.correct; m.total += s.total; m.people += 1;
      map.set(s.skill, m);
    }
  }
  return [...map.values()]
    .map(m => ({ ...m, pct: Math.round((m.correct * 1000) / m.total) / 10 }))
    .sort((a, b) => a.pct - b.pct);
}

/** Employees a manager should act on: not completed, or rated No Rating. Most urgent first. */
export function followUpList(rows, now = new Date()) {
  const rank = { [STATUS.OVERDUE]: 0, 'No Rating': 1, [STATUS.IN_PROGRESS]: 2, [STATUS.NOT_STARTED]: 3 };
  const out = [];
  for (const r of rows) {
    if (r.status === STATUS.CANCELLED) continue;
    let kind = null;
    let reason = '';
    const due = toDate(r.dueAt);
    if (r.status === STATUS.COMPLETED) {
      if (r.rating === 'No Rating') { kind = 'No Rating'; reason = `Scored ${fmtPct(r.scorePct, 1)}, below 70%`; }
    } else if (r.status === STATUS.OVERDUE) {
      const days = due ? Math.max(1, Math.round((now - due) / 86400000)) : null;
      kind = STATUS.OVERDUE; reason = days ? `Overdue by ${days} day${days === 1 ? '' : 's'}` : 'Past the due date';
    } else {
      kind = r.status;
      const days = due ? Math.ceil((due - now) / 86400000) : null;
      reason = days === null ? 'No due date set' : (days <= 0 ? 'Due today' : `Due in ${days} day${days === 1 ? '' : 's'}`);
      if (r.status === STATUS.IN_PROGRESS) reason = `Started, not submitted. ${reason}`;
    }
    if (kind) out.push({ row: r, kind, status: kind === 'No Rating' ? 'No Rating' : r.status, reason, rank: rank[kind] ?? 9 });
  }
  return out.sort((a, b) => a.rank - b.rank || (toDate(a.row.dueAt)?.getTime() ?? Infinity) - (toDate(b.row.dueAt)?.getTime() ?? Infinity));
}

/** Rating when completed, otherwise the status (used by the PDF/Word results tables). */
export function ratingLabel(r) {
  return r.status === STATUS.COMPLETED && r.rating ? r.rating : r.status;
}

/** Picks the report that belongs to the CURRENT attempt (latest submission). */
export function pickReport(reportsForUser, ea) {
  if (!ea || ea.status !== 'submitted') return null;
  const list = (reportsForUser || []).slice().sort((a, b) => (toDate(b.submittedAt)?.getTime() || 0) - (toDate(a.submittedAt)?.getTime() || 0));
  if (!list.length) return null;
  const sub = toDate(ea.submittedAt)?.getTime();
  return (sub && list.find(r => toDate(r.submittedAt)?.getTime() === sub)) || list[0];
}

export function safeFilename(s, fallback = 'Report') {
  const t = String(s ?? '').replace(/[^a-zA-Z0-9-_ ]/g, '_').trim();
  return t || fallback;
}

export { ratingFromPercent, RATINGS };
