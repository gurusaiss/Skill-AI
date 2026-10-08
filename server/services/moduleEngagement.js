/**
 * moduleEngagement.js - server-owned record of everything an employee does
 * inside a learning module, stored in assignment.progress_data.engagement.
 *
 * Shape (compact, backward compatible - old assignments simply have no
 * `engagement` key and the reports show dashes for the missing parts):
 *
 *   engagement = {
 *     v: 1,
 *     sessions: {
 *       "<dayIndex>": {
 *         title, startedAt, lastActiveAt, completedAt, timeSpentSeconds, opens,
 *         sectionsViewed: [{ title, type }],
 *         attempts: [{
 *           attempt, startedAt, submittedAt, timeSpentSeconds, correct, total, scorePct,
 *           questions: [{ no, question, type, section, skill, options, userAnswer,
 *                         correctAnswer, isCorrect, skipped, explanation, answeredAt }]
 *         }]
 *       }
 *     }
 *   }
 *
 * The client never sends the whole structure. It sends one small
 * `engagementEvent`, and applyEngagementEvent() folds it into what is already
 * stored, so nothing previously saved can be lost or overwritten by a stale
 * browser copy.
 */

export const ENGAGEMENT_VERSION = 1;
export const MAX_ATTEMPTS_PER_SESSION = 5;
export const MAX_QUESTIONS_PER_ATTEMPT = 50;
export const MAX_SECTIONS = 40;
export const MAX_SESSIONS = 120;
export const MAX_SECONDS_PER_EVENT = 4 * 3600; // one visit never counts more than 4 h
export const MAX_PROGRESS_DATA_BYTES = 2 * 1024 * 1024;

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

function str(v, max) {
  if (v === null || v === undefined) return '';
  const s = String(v).replace(/\s+/g, ' ').trim();
  if (!s || ['undefined', 'null', 'nan'].includes(s.toLowerCase())) return '';
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

function iso(v) {
  if (!v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

function seconds(v, max = MAX_SECONDS_PER_EVENT) {
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.min(Math.round(n), max);
}

const earlier = (a, b) => (!a ? b : !b ? a : (new Date(a) <= new Date(b) ? a : b));
const later = (a, b) => (!a ? b : !b ? a : (new Date(a) >= new Date(b) ? a : b));

/** Resolve an MCQ letter ("B") to the option text, otherwise return the stored answer. */
export function correctAnswerText(q) {
  const ans = str(q?.answer ?? q?.correctAnswer, 600);
  const opts = Array.isArray(q?.options) ? q.options : [];
  const m = ans.match(/^([a-d])\)?$/i);
  if (m && opts.length) {
    const hit = opts.find(o => String(o).trim().toLowerCase().startsWith(m[1].toLowerCase()));
    if (hit) return str(hit, 300);
  }
  return ans;
}

export function sanitizeQuestion(q, i, answeredFallback) {
  if (!isObj(q)) return null;
  const userAnswer = str(q.userAnswer, 600);
  return {
    no: i + 1,
    question: str(q.question ?? q.text, 600),
    type: str(q.type, 20) || (Array.isArray(q.options) && q.options.length ? 'mcq' : ''),
    section: str(q.section ?? q.topic, 120),
    skill: str(q.skill ?? q.skillArea, 120),
    options: (Array.isArray(q.options) ? q.options : []).slice(0, 8).map(o => str(o, 240)).filter(Boolean),
    userAnswer,
    correctAnswer: correctAnswerText(q),
    isCorrect: !!q.isCorrect,
    skipped: userAnswer === '',
    explanation: str(q.explanation, 500),
    answeredAt: userAnswer === '' ? null : (iso(q.answeredAt) || answeredFallback || null),
  };
}

export function sanitizeAttempt(a, now) {
  if (!isObj(a) || !Array.isArray(a.results)) return null;
  const submittedAt = iso(a.submittedAt) || now;
  const questions = a.results.slice(0, MAX_QUESTIONS_PER_ATTEMPT)
    .map((q, i) => sanitizeQuestion(q, i, submittedAt)).filter(q => q && q.question);
  if (!questions.length) return null;
  const correct = questions.filter(q => q.isCorrect).length;
  return {
    attempt: 0, // assigned when stored
    startedAt: iso(a.startedAt),
    submittedAt,
    timeSpentSeconds: seconds(a.timeSpentSeconds),
    correct,
    total: questions.length,
    scorePct: Math.round((correct * 1000) / questions.length) / 10,
    questions,
  };
}

/** Whole-body validation for progress_data coming from a client. */
export function checkProgressData(pd) {
  if (pd === undefined) return { ok: true };
  if (!isObj(pd)) return { ok: false, message: 'progress_data must be an object' };
  let size = 0;
  try { size = Buffer.byteLength(JSON.stringify(pd)); } catch { return { ok: false, message: 'progress_data is not valid JSON' }; }
  if (size > MAX_PROGRESS_DATA_BYTES) return { ok: false, message: 'progress_data is too large' };
  return { ok: true };
}

/**
 * Merge a client-sent progress_data into the stored one without ever dropping
 * stored data: per-day reports are merged by day index (incoming wins for the
 * same day), and `engagement` is server-owned (a client copy is ignored).
 */
export function mergeProgressData(existing, incoming) {
  const base = isObj(existing) ? existing : {};
  if (!isObj(incoming)) return base;
  const merged = { ...base, ...incoming };
  merged.sessionReports = { ...(isObj(base.sessionReports) ? base.sessionReports : {}), ...(isObj(incoming.sessionReports) ? incoming.sessionReports : {}) };
  if (base.engagement !== undefined) merged.engagement = base.engagement; else delete merged.engagement;
  return merged;
}

/** Fold one client event into progress_data.engagement. Returns a NEW progress_data object. */
export function applyEngagementEvent(progressData, event, now = new Date().toISOString()) {
  const pd = isObj(progressData) ? { ...progressData } : {};
  if (!isObj(event)) return pd;
  const idx = Number(event.sessionIndex);
  if (!Number.isInteger(idx) || idx < 0 || idx >= MAX_SESSIONS) return pd;

  const eng = isObj(pd.engagement) ? pd.engagement : { v: ENGAGEMENT_VERSION, sessions: {} };
  const sessions = { ...(isObj(eng.sessions) ? eng.sessions : {}) };
  const prev = isObj(sessions[idx]) ? sessions[idx] : {};
  const cur = {
    title: str(event.sessionTitle, 160) || prev.title || '',
    startedAt: earlier(prev.startedAt, iso(event.startedAt)) || prev.startedAt || null,
    lastActiveAt: later(prev.lastActiveAt, iso(event.lastActiveAt) || now) || now,
    completedAt: prev.completedAt || null,
    timeSpentSeconds: seconds(prev.timeSpentSeconds, 1e7),
    opens: Number(prev.opens) || 0,
    sectionsViewed: Array.isArray(prev.sectionsViewed) ? prev.sectionsViewed.slice() : [],
    attempts: Array.isArray(prev.attempts) ? prev.attempts.slice() : [],
  };

  cur.timeSpentSeconds += seconds(event.addSeconds);
  if (event.opened) cur.opens += 1;

  if (Array.isArray(event.sectionsViewed)) {
    const seen = new Set(cur.sectionsViewed.map(s => `${s.type}|${s.title}`));
    for (const s of event.sectionsViewed) {
      const sec = { title: str(isObj(s) ? s.title : s, 140), type: str(isObj(s) ? s.type : '', 30) };
      if (!sec.title || seen.has(`${sec.type}|${sec.title}`) || cur.sectionsViewed.length >= MAX_SECTIONS) continue;
      seen.add(`${sec.type}|${sec.title}`);
      cur.sectionsViewed.push(sec);
    }
  }

  const attempt = sanitizeAttempt(event.attempt, now);
  if (attempt) {
    attempt.attempt = (Number(cur.attempts[cur.attempts.length - 1]?.attempt) || cur.attempts.length) + 1;
    cur.attempts.push(attempt);
    if (cur.attempts.length > MAX_ATTEMPTS_PER_SESSION) {
      // Keep the first attempt and the most recent ones; older middle attempts are dropped first.
      cur.attempts = [cur.attempts[0], ...cur.attempts.slice(-(MAX_ATTEMPTS_PER_SESSION - 1))];
    }
    cur.completedAt = cur.completedAt || attempt.submittedAt;
    cur.lastActiveAt = later(cur.lastActiveAt, attempt.submittedAt);
    cur.startedAt = earlier(cur.startedAt, attempt.startedAt) || cur.startedAt;
  }

  sessions[idx] = cur;
  pd.engagement = { v: ENGAGEMENT_VERSION, sessions };
  return pd;
}
