/**
 * moduleReportData.js - pure builders for the Reports > Modules section.
 *
 * Turns one module assignment (plus the module, the employee and manager) into
 * a fully-resolved engagement record: day-wise, section-wise, every question
 * answered, skills, strengths and a timeline. No I/O, so it is unit-testable
 * with fake data.
 *
 * Data sources, newest first:
 *   progress_data.engagement   full record (time, sections, every attempt)
 *   progress_data.sessionReports  older per-day report (latest attempt only)
 *   session_progress / progress / status   completion flags only
 * Anything missing stays null and is shown as a dash, never undefined/NaN.
 */
import { safe, num, toDate, DASH } from './reportData.js';
import { ratingFromPercent, percentFromCounts } from '../grading.js';
import { sanitizeQuestion } from '../moduleEngagement.js';

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const first = (...vals) => { for (const v of vals) if (v !== null && v !== undefined && v !== '') return v; return null; };
const minDate = (list) => list.map(toDate).filter(Boolean).sort((a, b) => a - b)[0] || null;
const maxDate = (list) => list.map(toDate).filter(Boolean).sort((a, b) => b - a)[0] || null;
const round1 = (n) => Math.round(n * 10) / 10;

export const MODULE_STATUS = { COMPLETED: 'Completed', IN_PROGRESS: 'In progress', NOT_STARTED: 'Not started', CANCELLED: 'Cancelled' };
export const STATUS_KEYS = { completed: MODULE_STATUS.COMPLETED, in_progress: MODULE_STATUS.IN_PROGRESS, not_started: MODULE_STATUS.NOT_STARTED, cancelled: MODULE_STATUS.CANCELLED };

export function ratingOrBlank(correct, total) {
  return total > 0 ? ratingFromPercent(percentFromCounts(correct, total)) : '';
}

function resultOf(q) {
  if (q.skipped) return 'Not answered';
  return q.isCorrect ? 'Correct' : 'Wrong';
}

function normalizeAttempts(engSession, report) {
  const list = Array.isArray(engSession?.attempts) ? engSession.attempts : [];
  if (list.length) {
    return list.map((a, i) => ({
      attempt: num(a.attempt) ?? i + 1,
      startedAt: a.startedAt || null,
      submittedAt: a.submittedAt || null,
      timeSpentSeconds: num(a.timeSpentSeconds),
      questions: (Array.isArray(a.questions) ? a.questions : []).map((q, n) => ({ ...q, no: q.no ?? n + 1 })),
    }));
  }
  // Older assignments: only the latest attempt's report was saved.
  if (isObj(report) && Array.isArray(report.results) && report.results.length) {
    const submittedAt = report.completedAt || null;
    return [{
      attempt: 1, startedAt: null, submittedAt, timeSpentSeconds: null,
      questions: report.results.map((q, i) => sanitizeQuestion(q, i, submittedAt)).filter(Boolean),
    }];
  }
  return [];
}

/**
 * One employee x one module assignment -> the full engagement record.
 * `light: true` skips the per-question arrays (used for list rows).
 */
export function buildEngagement({ assignment: a = {}, module: mod = null, user = null, manager = null, company = null, light = false, now = new Date() } = {}) {
  const pd = isObj(a.progress_data) ? a.progress_data : (isObj(a.progressData) ? a.progressData : {});
  const reports = isObj(pd.sessionReports) ? pd.sessionReports : {};
  const engSessions = isObj(pd.engagement?.sessions) ? pd.engagement.sessions : {};
  const sp = isObj(a.session_progress) ? a.session_progress : (isObj(a.sessionProgress) ? a.sessionProgress : {});
  const modSessions = Array.isArray(mod?.content?.sessions) ? mod.content.sessions : (Array.isArray(mod?.sessions) ? mod.sessions : []);

  const idxSet = new Set();
  for (let i = 0; i < modSessions.length; i++) idxSet.add(i);
  for (const k of [...Object.keys(sp), ...Object.keys(reports), ...Object.keys(engSessions)]) {
    const n = Number(k);
    if (Number.isInteger(n) && n >= 0) idxSet.add(n);
  }
  const indices = [...idxSet].sort((x, y) => x - y);

  const days = indices.map((i) => {
    const ms = modSessions[i] || {};
    const eng = isObj(engSessions[i]) ? engSessions[i] : null;
    const report = isObj(reports[i]) ? reports[i] : null;
    const attempts = normalizeAttempts(eng, report);
    const latest = attempts[attempts.length - 1] || null;
    const done = sp[i] === 'completed' || !!eng?.completedAt || !!report;

    let correct = null, wrong = null, skipped = null, total = null;
    if (latest && latest.questions.length) {
      total = latest.questions.length;
      correct = latest.questions.filter(q => q.isCorrect).length;
      skipped = latest.questions.filter(q => q.skipped).length;
      wrong = total - correct - skipped;
    } else if (report && num(report.total)) {
      total = num(report.total); correct = num(report.correct) ?? 0; wrong = Math.max(0, total - correct); skipped = 0;
    }
    const scorePct = total ? round1((correct * 100) / total) : num(report?.score);

    const sectionsSaved = Array.isArray(eng?.sectionsViewed) ? eng.sectionsViewed : [];
    const sectionsAvailable = (Array.isArray(ms.blocks) ? ms.blocks : []).map(b => ({ title: safe(b.title || b.heading || b.type, ''), type: safe(b.type, '') })).filter(s => s.title);
    const sections = sectionsSaved.length ? sectionsSaved.map(s => ({ title: safe(s.title, ''), type: safe(s.type, '') })) : sectionsAvailable;

    const tracked = eng !== null;
    return {
      index: i,
      day: i + 1,
      title: safe(first(eng?.title, report?.sessionTitle, ms.title, ms.topic), `Day ${i + 1}`),
      status: done ? MODULE_STATUS.COMPLETED : (tracked && (eng.opens || eng.startedAt) ? MODULE_STATUS.IN_PROGRESS : MODULE_STATUS.NOT_STARTED),
      startedAt: first(eng?.startedAt, latest?.startedAt),
      completedAt: first(eng?.completedAt, report?.completedAt, attempts[0]?.submittedAt),
      timeSpentSec: tracked ? num(eng.timeSpentSeconds) : null,
      attempts: attempts.length || (report ? 1 : 0),
      sections,
      sectionsTracked: sectionsSaved.length > 0,
      total, correct, wrong, skipped,
      answered: total === null ? null : total - (skipped || 0),
      scorePct,
      rating: total ? ratingOrBlank(correct, total) : '',
      detailSaved: attempts.length > 0,
      attemptsDetail: attempts,
    };
  });

  const daysTotal = modSessions.length || days.length;
  const daysCompleted = days.filter(d => d.status === MODULE_STATUS.COMPLETED).length;
  const tracked = days.filter(d => d.timeSpentSec !== null);
  const timeSpentSec = tracked.length ? tracked.reduce((s, d) => s + (d.timeSpentSec || 0), 0) : null;

  const scored = days.filter(d => d.total);
  const total = scored.length ? scored.reduce((s, d) => s + d.total, 0) : null;
  const correct = scored.length ? scored.reduce((s, d) => s + d.correct, 0) : null;
  const skipped = scored.length ? scored.reduce((s, d) => s + (d.skipped || 0), 0) : null;
  const wrong = scored.length ? total - correct - skipped : null;
  const scorePct = total ? round1(percentFromCounts(correct, total)) : null;

  const rawStatus = String(a.status || '').toLowerCase();
  let status = MODULE_STATUS.NOT_STARTED;
  if (rawStatus === 'cancelled') status = MODULE_STATUS.CANCELLED;
  else if (rawStatus === 'completed' || (modSessions.length > 0 && daysCompleted >= daysTotal)) status = MODULE_STATUS.COMPLETED;
  else if (rawStatus === 'in_progress' || daysCompleted > 0 || (num(a.progress) || 0) > 0 || days.some(d => d.status === MODULE_STATUS.IN_PROGRESS)) status = MODULE_STATUS.IN_PROGRESS;

  const startedAt = first(minDate(days.map(d => d.startedAt)), a.started_at, a.startedAt);
  const lastDone = maxDate(days.map(d => d.completedAt));
  const completedAt = status === MODULE_STATUS.COMPLETED ? first(a.completed_at, a.completedAt, lastDone, a.updated_at, a.updatedAt) : null;
  const progressPct = Math.min(100, Math.max(0, num(a.progress) ?? (daysTotal ? Math.round((daysCompleted * 100) / daysTotal) : 0)));

  const u = user || {};
  const out = {
    assignmentId: a.id || '',
    userId: a.assigned_to_user || a.assignedToUser || u.userId || '',
    employeeId: safe(first(u.employeeId, u.employee_id), ''),
    name: safe(first(u.name, a.employeeName, a.assigned_to_user), ''),
    email: safe(u.email, ''),
    jobRole: safe(first(u.jobRole, u.job_role), ''),
    department: safe(u.department, ''),
    managerName: safe(first(manager?.name, manager?.email), ''),
    managerId: safe(first(u.managerId, manager?.userId), ''),
    companyName: safe(first(company?.name, u.companyName), ''),
    moduleId: a.assignable_id || a.assignableId || mod?.id || '',
    moduleTitle: safe(first(mod?.title, a.module_name, a.title), 'Module'),
    status,
    assignedAt: first(a.created_at, a.createdAt, a.assigned_at),
    dueAt: first(a.due_date, a.dueDate),
    startedAt,
    completedAt,
    daysTotal,
    daysCompleted,
    progressPct,
    timeSpentSec,
    questionsTotal: total,
    questionsAnswered: total === null ? null : total - (skipped || 0),
    correct, wrong, skipped,
    scorePct,
    rating: scorePct === null ? '' : ratingOrBlank(correct, total),
    hasDetail: days.some(d => d.detailSaved),
    attemptsTotal: days.reduce((s, d) => s + d.attempts, 0),
    generatedAt: now,
  };
  if (light) return out;

  // ── full detail ──────────────────────────────────────────────────────────
  const questions = [];
  for (const d of days) {
    const lastAttempt = d.attemptsDetail[d.attemptsDetail.length - 1];
    for (const att of d.attemptsDetail) {
      att.questions.forEach((q, n) => {
        questions.push({
          day: d.day, dayTitle: d.title,
          section: safe(first(q.section, q.skill), 'Day quiz'),
          skill: safe(q.skill, ''),
          no: q.no ?? n + 1,
          type: safe(q.type, ''),
          question: safe(q.question, ''),
          options: Array.isArray(q.options) ? q.options : [],
          userAnswer: q.skipped ? '' : safe(q.userAnswer, ''),
          correctAnswer: safe(q.correctAnswer, ''),
          result: resultOf(q),
          explanation: safe(q.explanation, ''),
          attempt: att.attempt,
          answeredAt: q.answeredAt || null,
          isLatest: att === lastAttempt,
        });
      });
    }
  }

  const latestQs = questions.filter(q => q.isLatest);
  const skillMap = new Map();
  for (const q of latestQs) {
    const key = q.skill || q.section || 'General';
    const m = skillMap.get(key) || { skill: key, correct: 0, total: 0 };
    m.total += 1; if (q.result === 'Correct') m.correct += 1;
    skillMap.set(key, m);
  }
  const skills = [...skillMap.values()].map(s => ({ ...s, pct: round1(percentFromCounts(s.correct, s.total)) })).sort((x, y) => y.pct - x.pct);
  const strengths = skills.filter(s => s.pct >= 70).map(s => s.skill).slice(0, 6);
  const needsImprovement = skills.filter(s => s.pct < 70).map(s => s.skill).slice(0, 6);
  const missed = latestQs.filter(q => q.result !== 'Correct').slice(0, 8).map(q => `Day ${q.day}: ${q.question}`);

  const timeline = [];
  const push = (at, event) => { const d = toDate(at); if (d) timeline.push({ at: d, event }); };
  push(out.assignedAt, 'Module assigned');
  for (const d of days) {
    push(d.startedAt, `Day ${d.day} opened: ${d.title}`);
    for (const att of d.attemptsDetail) {
      const c = att.questions.filter(q => q.isCorrect).length;
      push(att.submittedAt, `Day ${d.day} quiz attempt ${att.attempt} submitted: ${c} of ${att.questions.length} correct`);
    }
    if (!d.attemptsDetail.length) push(d.completedAt, `Day ${d.day} completed: ${d.title}`);
  }
  push(out.completedAt, 'Module completed');
  timeline.sort((x, y) => x.at - y.at);

  return {
    ...out,
    days: days.map(({ attemptsDetail, ...d }) => d),
    questions,
    skills, strengths, needsImprovement, missed,
    timeline: timeline.map(t => ({ at: t.at.toISOString(), event: t.event })),
  };
}

// ── list helpers ────────────────────────────────────────────────────────────
export function filterRows(rows, f = {}) {
  const status = String(f.status || 'completed').toLowerCase();
  const lc = (s) => String(s || '').toLowerCase();
  const q = lc(f.q || f.search).trim();
  const from = toDate(f.from); const to = toDate(f.to);
  const toEnd = to ? new Date(to.getTime() + (String(f.to).length <= 10 ? 86399999 : 0)) : null;
  return rows.filter((r) => {
    if (status !== 'all' && STATUS_KEYS[status] && r.status !== STATUS_KEYS[status]) return false;
    const emp = lc(f.employeeId || f.userId);
    if (emp && ![lc(r.userId), lc(r.employeeId)].includes(emp)) return false;
    if (f.moduleId && r.moduleId !== f.moduleId) return false;
    if (f.jobRole && lc(r.jobRole) !== lc(f.jobRole)) return false;
    if (f.department && lc(r.department) !== lc(f.department)) return false;
    if (f.manager && !lc(r.managerName).includes(lc(f.manager)) && lc(r.managerId) !== lc(f.manager)) return false;
    if (from || toEnd) {
      const c = toDate(r.completedAt);
      if (!c) return false;
      if (from && c < from) return false;
      if (toEnd && c > toEnd) return false;
    }
    if (q && ![r.name, r.employeeId, r.email, r.moduleTitle, r.jobRole].some(v => lc(v).includes(q))) return false;
    return true;
  });
}

export function sortRows(rows) {
  return rows.slice().sort((a, b) => (toDate(b.completedAt)?.getTime() ?? toDate(b.startedAt)?.getTime() ?? 0) - (toDate(a.completedAt)?.getTime() ?? toDate(a.startedAt)?.getTime() ?? 0)
    || safe(a.name, '').localeCompare(safe(b.name, '')));
}

export function summarizeRows(rows) {
  const done = rows.filter(r => r.status === MODULE_STATUS.COMPLETED);
  const scored = rows.filter(r => r.scorePct !== null);
  const dist = { Expert: 0, Intermediate: 0, Basic: 0, 'No Rating': 0 };
  for (const r of scored) if (dist[r.rating] !== undefined) dist[r.rating] += 1;
  const timed = rows.filter(r => r.timeSpentSec !== null);
  return {
    records: rows.length,
    completed: done.length,
    inProgress: rows.filter(r => r.status === MODULE_STATUS.IN_PROGRESS).length,
    employees: new Set(rows.map(r => r.userId)).size,
    avgScore: scored.length ? round1(scored.reduce((s, r) => s + r.scorePct, 0) / scored.length) : null,
    ratings: dist,
    totalTimeSec: timed.length ? timed.reduce((s, r) => s + r.timeSpentSec, 0) : null,
    questions: rows.reduce((s, r) => s + (r.questionsTotal || 0), 0),
  };
}

export function fmtSeconds(sec) {
  const n = num(sec);
  if (n === null || n < 0) return DASH;
  if (n < 60) return `${Math.round(n)} sec`;
  const m = Math.round(n / 60);
  if (m < 60) return `${m} min`;
  return `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')} min`;
}

/** JSON-safe copy of a record (dates as ISO strings). */
export function toJson(rec) {
  return JSON.parse(JSON.stringify(rec, (_k, v) => (v instanceof Date ? (Number.isNaN(v.getTime()) ? null : v.toISOString()) : v)));
}
