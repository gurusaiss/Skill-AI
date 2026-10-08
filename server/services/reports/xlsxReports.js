/**
 * xlsxReports.js — Excel workbooks for assessment reports.
 *
 * Layout rules (owner: "compact, easy to read, no big cells"):
 *   - Overview: the ONLY sheet with merged cells (title band, KPIs, rating
 *     distribution, assessment facts).
 *   - Results: narrow, essential columns; one row height, no wrapping.
 *   - Details: one row per employee with the long/rare fields.
 *   - Skills: a matrix (employees x skills) coloured by rating band.
 *   - Question Review: one row per question, one fixed row height.
 * Text is never wrapped anywhere; long text is read in the formula bar.
 *
 * Built with the `xlsx` library (real number / date cells); styles, freeze
 * panes and print setup are patched in by ./xlsxStyle.js.
 */
import XLSX from 'xlsx';
import { DASH, safe, num, excelSerial, reportTimezone, STATUS } from './reportData.js';
import { ratingFromPercent, RATINGS } from '../grading.js';
import {
  PALETTE, RATING_COLOURS, STATUS_COLOURS, RESULT_COLOURS, style, patchPackage, colLetter,
} from './xlsxStyle.js';

const MAX_CELL = 32000;
const HEADER_H = 24;
const ROW_H = 19;

const FMT = {
  int: '0',
  one: '0.0',
  pct: '0.0"%"',
  date: 'dd mmm yyyy',
  dateShort: 'dd mmm yy hh:mm',
  dateFull: 'dd mmm yyyy, h:mm AM/PM',
};

// ── cell builders (pure values; styling is attached separately) ─────────────
const S = (v) => {
  let t = safe(v, DASH);
  if (t.length > MAX_CELL) t = `${t.slice(0, MAX_CELL - 1)}…`;
  return { t: 's', v: t };
};
const N = (v) => {
  const n = num(v);
  return n === null ? S(DASH) : { t: 'n', v: n };
};
const D = (v, tz) => {
  const serial = excelSerial(v, tz);
  return serial === null ? S(DASH) : { t: 'n', v: serial };
};
const LIST = (arr) => S(Array.isArray(arr) && arr.length ? arr.join('; ') : DASH);

// ── styles ──────────────────────────────────────────────────────────────────
const zebraFill = (zebra) => (zebra ? PALETTE.zebra : null);
const HEADER_STYLE = style({ b: true, color: PALETTE.white, fill: PALETTE.indigo, h: 'center' });
const HEADER_LEFT = style({ b: true, color: PALETTE.white, fill: PALETTE.indigo, h: 'left' });

function bodyStyle(kind, zebra, fmt) {
  const fill = zebraFill(zebra);
  switch (kind) {
    case 'num': return style({ fill, h: 'right', numFmt: fmt || FMT.int });
    case 'date': return style({ fill, h: 'center', numFmt: fmt || FMT.date });
    case 'center': return style({ fill, h: 'center' });
    default: return style({ fill, h: 'left' });
  }
}

function bandStyle(colour, { fmt = null, h = 'center', b = true } = {}) {
  return style({ b, color: colour.text, fill: colour.fill, h, numFmt: fmt });
}

const ratingStyle = (label) => (RATING_COLOURS[label] ? bandStyle(RATING_COLOURS[label]) : null);
const pctBandStyle = (pct) => bandStyle(RATING_COLOURS[ratingFromPercent(pct)], { fmt: FMT.int, h: 'center', b: false });

// ── tiny sheet model ────────────────────────────────────────────────────────
function newSheet(name) {
  return { name, ws: {}, styles: new Map(), merges: [], heights: [], cols: [], maxR: 0, maxC: 0, freeze: { cols: 0, rows: 0 }, filter: null, opts: {} };
}

function put(sh, r, c, cell, st) {
  const ref = `${colLetter(c)}${r + 1}`;
  sh.ws[ref] = cell;
  if (st) sh.styles.set(ref, st);
  if (r > sh.maxR) sh.maxR = r;
  if (c > sh.maxC) sh.maxC = c;
}

function merge(sh, r, c1, c2, cell, st) {
  put(sh, r, c1, cell, st);
  for (let c = c1 + 1; c <= c2; c++) put(sh, r, c, { t: 's', v: '' }, st);
  sh.merges.push({ s: { r, c: c1 }, e: { r, c: c2 } });
}

function finishSheet(sh) {
  const ws = sh.ws;
  ws['!ref'] = `A1:${colLetter(sh.maxC)}${sh.maxR + 1}`;
  ws['!cols'] = sh.cols.map(w => ({ width: w }));
  ws['!rows'] = Array.from({ length: sh.maxR + 1 }, (_, i) => ({ hpt: sh.heights[i] || ROW_H }));
  if (sh.merges.length) ws['!merges'] = sh.merges;
  if (sh.filter) ws['!autofilter'] = { ref: sh.filter };
  return sh;
}

/** A data table: header row + one fixed-height row per record. */
function tableSheet(name, columns, records, { tz, headerHeight = HEADER_H, freezeCols = 2, rowStyle } = {}) {
  const sh = newSheet(name);
  sh.cols = columns.map(c => c.w);
  sh.heights[0] = headerHeight;
  columns.forEach((c, i) => put(sh, 0, i, S(c.header), c.rotate ? style({ b: true, color: PALETTE.white, fill: PALETTE.indigo, h: 'center', v: 'bottom', rotate: 90 }) : (!c.kind || c.kind === 'text' ? HEADER_LEFT : HEADER_STYLE)));
  records.forEach((rec, ri) => {
    const zebra = ri % 2 === 1;
    columns.forEach((c, ci) => {
      const cell = c.cell(rec, tz);
      let st = (c.style && c.style(rec, cell, zebra)) || null;
      if (!st) st = bodyStyle(c.kind || 'text', zebra, c.fmt);
      put(sh, ri + 1, ci, cell, st);
    });
    sh.heights[ri + 1] = ROW_H;
    if (rowStyle) rowStyle(rec, ri, sh);
  });
  if (!records.length) sh.maxR = 0;
  sh.maxC = columns.length - 1;
  sh.freeze = { cols: Math.min(freezeCols, columns.length), rows: 1 };
  if (records.length) sh.filter = `A1:${colLetter(columns.length - 1)}${records.length + 1}`;
  sh.opts = { landscape: true, fitWidth: true, printTitleRows: [1, 1] };
  return finishSheet(sh);
}

// ── Results sheet ───────────────────────────────────────────────────────────
const statusStyle = (r, cell, zebra) => {
  const c = STATUS_COLOURS[r.status];
  return c ? bandStyle(c, { b: false }) : bodyStyle('center', zebra);
};
const ratingCellStyle = (r, cell, zebra) => (r.rating && ratingStyle(r.rating)) || bodyStyle('center', zebra);

export const RESULTS_COLUMNS = [
  { header: 'Employee ID', w: 12, cell: r => S(r.employeeId) },
  { header: 'Name', w: 22, cell: r => S(r.name) },
  { header: 'Job Role', w: 22, cell: r => S(r.jobRole) },
  { header: 'Department', w: 16, cell: r => S(r.department) },
  { header: 'Manager', w: 20, cell: r => S(r.managerName) },
  { header: 'Status', w: 13, cell: r => S(r.status), kind: 'center', style: statusStyle },
  { header: 'Assigned', w: 16, kind: 'date', cell: (r, tz) => D(r.assignedAt, tz) },
  { header: 'Due', w: 16, kind: 'date', cell: (r, tz) => D(r.dueAt, tz) },
  { header: 'Completed', w: 16, kind: 'date', fmt: FMT.dateShort, cell: (r, tz) => D(r.completedAt, tz) },
  { header: 'Time (min)', w: 10, kind: 'num', fmt: FMT.one, cell: r => N(r.timeTakenMin) },
  { header: 'Correct', w: 9, kind: 'num', cell: r => N(r.correct) },
  { header: 'Total', w: 8, kind: 'num', cell: r => N(r.total) },
  { header: 'Score %', w: 10, kind: 'num', fmt: FMT.one, cell: r => N(r.scorePct) },
  { header: 'Rating', w: 14, kind: 'center', cell: r => S(r.rating || DASH), style: ratingCellStyle },
];

// All-reports workbook mixes assessments: add the title, move Department and
// Manager to the Details sheet so a row still fits on screen.
const MULTI_RESULTS_COLUMNS = (() => {
  const cols = RESULTS_COLUMNS.filter(c => !['Department', 'Manager'].includes(c.header));
  cols.splice(2, 0, { header: 'Assessment', w: 26, cell: r => S(r.assessmentTitle) });
  return cols;
})();

export function resultsSheet(rows, tz = reportTimezone(), multi = false) {
  return tableSheet('Results', multi ? MULTI_RESULTS_COLUMNS : RESULTS_COLUMNS, rows, { tz });
}

// ── Details sheet ───────────────────────────────────────────────────────────
const dt = (get) => (r, tz) => D(get(r), tz);
const DETAILS_COLUMNS = (multi) => [
  { header: 'Employee ID', w: 12, cell: r => S(r.employeeId) },
  { header: 'Name', w: 22, cell: r => S(r.name) },
  ...(multi ? [{ header: 'Assessment', w: 28, cell: r => S(r.assessmentTitle) }] : []),
  { header: 'Email', w: 30, cell: r => S(r.email) },
  { header: 'Phone', w: 16, cell: r => S(r.phone) },
  ...(multi ? [
    { header: 'Department', w: 16, cell: r => S(r.department) },
    { header: 'Manager', w: 20, cell: r => S(r.managerName) },
  ] : []),
  { header: 'Group', w: 18, cell: r => S(r.group) },
  { header: 'Manager ID', w: 12, cell: r => S(r.managerId) },
  { header: 'Company', w: 22, cell: r => S(r.companyName) },
  { header: 'Assessment Type', w: 18, cell: r => S(r.assessmentType) },
  { header: 'Assigned On', w: 22, kind: 'date', fmt: FMT.dateFull, cell: dt(r => r.assignedAt) },
  { header: 'Window Start', w: 22, kind: 'date', fmt: FMT.dateFull, cell: dt(r => r.windowStart) },
  { header: 'Due Date', w: 22, kind: 'date', fmt: FMT.dateFull, cell: dt(r => r.dueAt) },
  { header: 'Started At', w: 22, kind: 'date', fmt: FMT.dateFull, cell: dt(r => r.startedAt) },
  { header: 'Completed On', w: 22, kind: 'date', fmt: FMT.dateFull, cell: dt(r => r.completedAt) },
  { header: 'Time Limit (min)', w: 11, kind: 'num', cell: r => N(r.timeLimitMin) },
  { header: 'Attempt No.', w: 10, kind: 'num', cell: r => N(r.attemptNo) },
  { header: 'Reminders Sent', w: 11, kind: 'num', cell: r => N(r.remindersCount) },
  { header: 'Last Reminder', w: 22, kind: 'date', fmt: FMT.dateFull, cell: dt(r => r.lastReminderAt) },
  { header: 'Skill Scores', w: 45, cell: r => S(r.skillScoresText) },
  { header: 'Strengths', w: 40, cell: r => LIST(r.strengths) },
  { header: 'Needs Improvement', w: 40, cell: r => LIST(r.weakAreas) },
  { header: 'Missing Skills', w: 40, cell: r => LIST(r.missingSkills) },
  { header: 'Recommendations', w: 40, cell: r => LIST(r.recommendations) },
];

export function detailsSheet(rows, tz = reportTimezone(), multi = false) {
  return tableSheet('Details', DETAILS_COLUMNS(multi), rows, { tz });
}

// ── Skills matrix ───────────────────────────────────────────────────────────
export function skillsMatrixSheet(rows) {
  const people = rows.filter(r => (r.skills || []).length);
  const skillNames = [];
  for (const r of people) for (const s of r.skills) if (!skillNames.includes(s.skill)) skillNames.push(s.skill);

  const mean = (vals) => {
    const v = vals.filter(x => x !== null && x !== undefined);
    return v.length ? Math.round((v.reduce((a, b) => a + b, 0) / v.length) * 10) / 10 : null;
  };
  const personPct = (r, skill) => {
    const s = r.skills.find(x => x.skill === skill);
    return s ? num(s.pct) : null;
  };
  const pctCell = (v) => (v === null ? S(DASH) : { t: 'n', v });
  const pctStyle = (v, zebra) => (v === null ? bodyStyle('center', zebra) : pctBandStyle(v));

  const sh = newSheet('Skills');
  const longest = Math.max(8, ...skillNames.map(s => s.length), 7);
  const headerH = Math.min(150, Math.max(60, Math.round(longest * 5.6 + 16)));
  sh.cols = [12, 22, ...skillNames.map(() => 11), 11];
  sh.heights[0] = headerH;
  const rotated = style({ b: true, color: PALETTE.white, fill: PALETTE.indigo, h: 'center', v: 'bottom', rotate: 90 });
  put(sh, 0, 0, S('Employee ID'), style({ b: true, color: PALETTE.white, fill: PALETTE.indigo, h: 'left', v: 'bottom' }));
  put(sh, 0, 1, S('Name'), style({ b: true, color: PALETTE.white, fill: PALETTE.indigo, h: 'left', v: 'bottom' }));
  skillNames.forEach((s, i) => put(sh, 0, 2 + i, S(s), rotated));
  const avgCol = 2 + skillNames.length;
  put(sh, 0, avgCol, S('Average %'), rotated);

  people.forEach((r, ri) => {
    const zebra = ri % 2 === 1;
    const rowNo = ri + 1;
    put(sh, rowNo, 0, S(r.employeeId), bodyStyle('text', zebra));
    put(sh, rowNo, 1, S(r.name), bodyStyle('text', zebra));
    const vals = skillNames.map(s => personPct(r, s));
    vals.forEach((v, i) => put(sh, rowNo, 2 + i, pctCell(v), pctStyle(v, zebra)));
    const avg = mean(vals);
    put(sh, rowNo, avgCol, pctCell(avg), avg === null ? bodyStyle('center', zebra) : bandStyle(RATING_COLOURS[ratingFromPercent(avg)], { fmt: FMT.one, b: true }));
    sh.heights[rowNo] = ROW_H;
  });

  if (!people.length) {
    put(sh, 1, 0, S('No skill scores yet'), bodyStyle('text', false));
    sh.maxC = avgCol;
    sh.freeze = { cols: 2, rows: 1 };
    sh.opts = { landscape: true, fitWidth: true, printTitleRows: [1, 1] };
    return finishSheet(sh);
  }

  // "All employees" row: the same average the PDF/Word skill table uses (sum correct / sum total).
  const lastRow = people.length + 1;
  const total = style({ b: true, fill: PALETTE.band, h: 'left' });
  put(sh, lastRow, 0, S('All employees'), total);
  put(sh, lastRow, 1, S(`${people.length} completed`), total);
  const colAvgs = skillNames.map((s) => {
    let c = 0, t = 0;
    for (const r of people) { const x = r.skills.find(k => k.skill === s); if (x && x.correct !== null && x.total) { c += x.correct; t += x.total; } }
    return t ? Math.round((c * 1000) / t) / 10 : null;
  });
  colAvgs.forEach((v, i) => put(sh, lastRow, 2 + i, pctCell(v), v === null ? total : bandStyle(RATING_COLOURS[ratingFromPercent(v)], { fmt: FMT.int })));
  const overall = mean(colAvgs);
  put(sh, lastRow, avgCol, pctCell(overall), overall === null ? total : bandStyle(RATING_COLOURS[ratingFromPercent(overall)], { fmt: FMT.one }));
  sh.heights[lastRow] = ROW_H + 2;

  sh.maxC = avgCol;
  if (people.length) sh.filter = `A1:${colLetter(avgCol)}${people.length + 1}`;
  sh.freeze = { cols: 2, rows: 1 };
  sh.opts = { landscape: true, fitWidth: true, printTitleRows: [1, 1] };
  return finishSheet(sh);
}

// ── Question review ─────────────────────────────────────────────────────────
const resultStyle = (q, cell, zebra) => (RESULT_COLOURS[q.result] ? bandStyle(RESULT_COLOURS[q.result], { b: false }) : bodyStyle('center', zebra));

export const QUESTION_COLUMNS = [
  { header: 'Employee ID', w: 12, cell: q => S(q.employeeId) },
  { header: 'Name', w: 22, cell: q => S(q.employeeName) },
  { header: 'Q No.', w: 7, kind: 'num', cell: q => N(q.no) },
  { header: 'Skill', w: 22, cell: q => S(q.skill) },
  { header: 'Difficulty', w: 11, kind: 'center', cell: q => S(q.difficulty) },
  { header: 'Type', w: 16, cell: q => S(q.type) },
  { header: 'Question', w: 60, cell: q => S(q.question) },
  { header: 'Employee Answer', w: 35, cell: q => S(q.userAnswer || 'Not answered') },
  { header: 'Correct Answer', w: 35, cell: q => S(q.correctAnswer) },
  { header: 'Result', w: 14, kind: 'center', cell: q => S(q.result), style: resultStyle },
  { header: 'Marks', w: 8, kind: 'num', cell: q => N(q.marks) },
];

export function questionSheet(rows) {
  const flat = [];
  for (const r of rows) for (const q of r.questions || []) flat.push({ ...q, employeeId: r.employeeId, employeeName: r.name });
  return tableSheet('Question Review', QUESTION_COLUMNS, flat, {});
}

// ── Overview sheet ──────────────────────────────────────────────────────────
const OV = {
  title: style({ b: true, sz: 16, color: PALETTE.white, fill: PALETTE.indigo, border: false, indent: 1 }),
  subtitle: style({ i: true, color: PALETTE.muted, border: false, indent: 1 }),
  section: style({ b: true, color: PALETTE.indigo, fill: PALETTE.band, border: false, indent: 1 }),
  label: style({ b: true, fill: PALETTE.zebra, h: 'left' }),
  value: style({ b: true, h: 'right', numFmt: FMT.int }),
  valueOne: style({ b: true, h: 'right', numFmt: FMT.one }),
  valuePct: style({ b: true, h: 'right', numFmt: FMT.pct }),
  valueText: style({ h: 'left' }),
  valueDate: style({ h: 'left', numFmt: FMT.dateFull }),
  count: style({ h: 'right', numFmt: FMT.int }),
  share: style({ h: 'right', numFmt: FMT.pct }),
  range: style({ h: 'left', color: PALETTE.muted }),
};

/** value spec: ['int'|'one'|'pct'|'text'|'date', rawValue] */
function ovValue(spec, tz) {
  const [kind, v] = spec;
  if (kind === 'text') return [S(v), OV.valueText];
  if (kind === 'date') return [D(v, tz), OV.valueDate];
  return [N(v), kind === 'one' ? OV.valueOne : kind === 'pct' ? OV.valuePct : OV.value];
}

function overviewSheet({ title, subtitle, kpis = [], distribution = null, sections = [], widths = [22, 18, 22, 18], tz }) {
  const sh = newSheet('Overview');
  sh.cols = widths;
  const last = widths.length - 1;
  let r = 0;
  merge(sh, r, 0, last, S(title), OV.title); sh.heights[r++] = 34;
  merge(sh, r, 0, last, S(subtitle || ' '), OV.subtitle); sh.heights[r++] = 20;
  sh.heights[r++] = 8;

  if (kpis.length) {
    merge(sh, r, 0, last, S('Key numbers'), OV.section); sh.heights[r++] = 22;
    // two label/value pairs per row
    for (let i = 0; i < kpis.length; i += 2) {
      [kpis[i], kpis[i + 1]].forEach((k, j) => {
        const c = j * 2;
        if (!k) return;
        const [cell, st] = ovValue(k.value, tz);
        put(sh, r, c, S(k.label), OV.label);
        put(sh, r, c + 1, cell, st);
      });
      sh.heights[r++] = ROW_H + 2;
    }
    sh.heights[r++] = 8;
  }

  if (distribution) {
    merge(sh, r, 0, last, S('Rating distribution'), OV.section); sh.heights[r++] = 22;
    ['Rating', 'Employees', 'Share', 'Score range'].forEach((h, c) => put(sh, r, c, S(h), c === 0 || c === 3 ? HEADER_LEFT : HEADER_STYLE));
    sh.heights[r++] = HEADER_H;
    for (const d of distribution) {
      const meta = RATINGS.find(x => x.label === d.label);
      put(sh, r, 0, S(d.label), bandStyle(RATING_COLOURS[d.label], { h: 'left' }));
      put(sh, r, 1, N(d.count), OV.count);
      put(sh, r, 2, N(Math.round(d.percent * 10) / 10), OV.share);
      put(sh, r, 3, S(meta ? meta.range : ''), OV.range);
      sh.heights[r++] = ROW_H + 1;
    }
    sh.heights[r++] = 8;
  }

  for (const sec of sections) {
    merge(sh, r, 0, last, S(sec.heading), OV.section); sh.heights[r++] = 22;
    for (const row of sec.rows) {
      put(sh, r, 0, S(row.label), OV.label);
      const [cell, st] = ovValue(row.value, tz);
      const useStyle = row.style || st;
      if (row.value[0] === 'text' || row.value[0] === 'date') merge(sh, r, 1, last, cell, useStyle);
      else put(sh, r, 1, cell, useStyle);
      sh.heights[r++] = ROW_H;
    }
    sh.heights[r++] = 8;
  }
  sh.maxR = Math.max(sh.maxR, r - 1);
  sh.opts = { gridlines: false, fitWidth: true };
  return finishSheet(sh);
}

const kpi = (label, kind, value) => ({ label, value: [kind, value] });

function assessmentKpis(sum) {
  return [
    kpi('Assigned', 'int', sum.assigned), kpi('Average score %', 'one', sum.avgScore),
    kpi('Completed', 'int', sum.completed), kpi('Highest score %', 'one', sum.highScore),
    kpi('In progress', 'int', sum.inProgress), kpi('Lowest score %', 'one', sum.lowScore),
    kpi('Not started', 'int', sum.notStarted), kpi('Completion %', 'one', sum.completionPct),
    kpi('Overdue', 'int', sum.overdue), kpi('Expert + Intermediate %', 'one', sum.topSharePct),
  ];
}

function assessmentOverview(sum, tz) {
  const generated = new Date(sum.generatedAt || Date.now());
  const subtitle = `${safe(sum.company, 'Company not set')}   |   Generated ${new Intl.DateTimeFormat('en-GB', { timeZone: tz, dateStyle: 'medium', timeStyle: 'short' }).format(generated)}`;
  const facts = [
    { label: 'Assessment type', value: ['text', sum.type] },
    { label: 'Job role(s)', value: ['text', sum.jobRoles] },
    { label: 'Starts', value: ['date', sum.startAt] },
    { label: 'Due', value: ['date', sum.dueAt] },
    { label: 'Time limit (min)', value: ['int', sum.timeLimitMin] },
    { label: 'Created on', value: ['date', sum.createdAt] },
  ];
  if (sum.cancelled) facts.push({ label: 'Cancelled', value: ['int', sum.cancelled] });
  return overviewSheet({
    title: safe(sum.title, 'Assessment results'), subtitle, kpis: assessmentKpis(sum), distribution: sum.ratings,
    sections: [{ heading: 'Assessment', rows: facts }], tz,
  });
}

// ── workbook assembly ───────────────────────────────────────────────────────
function safeSheetName(name, used) {
  let n = String(name || 'Sheet').replace(/[\\/?*[\]:]/g, ' ').trim().slice(0, 31) || 'Sheet';
  let i = 2;
  while (used.has(n.toLowerCase())) n = `${n.slice(0, 28)} ${i++}`;
  used.add(n.toLowerCase());
  return n;
}

function writeWorkbook(sheets) {
  const wb = XLSX.utils.book_new();
  const used = new Set();
  const names = sheets.map(s => safeSheetName(s.name, used));
  sheets.forEach((s, i) => XLSX.utils.book_append_sheet(wb, s.ws, names[i]));
  const raw = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
  const meta = sheets.map((s, i) => ({
    name: names[i], styles: s.styles, freeze: s.freeze, gridlines: s.opts.gridlines, landscape: !!s.opts.landscape, fitWidth: !!s.opts.fitWidth, printTitleRows: s.opts.printTitleRows || null,
  }));
  return patchPackage(Buffer.isBuffer(raw) ? raw : Buffer.from(raw), meta);
}

// ── public builders ─────────────────────────────────────────────────────────
export function buildAssessmentWorkbook({ rows, summary, tz = reportTimezone() }) {
  return writeWorkbook([
    assessmentOverview(summary, tz),
    resultsSheet(rows, tz),
    detailsSheet(rows, tz),
    skillsMatrixSheet(rows),
    questionSheet(rows),
  ]);
}

/** Every submission across assessments: Overview + Results + Details. */
export function buildAllReportsWorkbook({ rows, summary, tz = reportTimezone() }) {
  const generated = new Date(summary.generatedAt || Date.now());
  const kpis = [
    kpi('Assessments covered', 'int', new Set(rows.map(r => r.assessmentId || r.assessmentTitle)).size), kpi('Average score %', 'one', summary.avgScore),
    kpi('Records', 'int', rows.length), kpi('Highest score %', 'one', summary.highScore),
    kpi('Completed', 'int', summary.completed), kpi('Lowest score %', 'one', summary.lowScore),
    kpi('Not completed', 'int', summary.notCompleted), kpi('Expert + Intermediate %', 'one', summary.topSharePct),
  ];
  const overview = overviewSheet({
    title: 'All assessment reports',
    subtitle: `One record per employee per assessment   |   Generated ${new Intl.DateTimeFormat('en-GB', { timeZone: tz, dateStyle: 'medium', timeStyle: 'short' }).format(generated)}`,
    kpis, distribution: summary.ratings, tz,
  });
  return writeWorkbook([overview, resultsSheet(rows, tz, true), detailsSheet(rows, tz, true)]);
}

// Individual workbook: Overview (employee + result + rating), Skills, Question Review.
function individualOverview(r, tz) {
  const done = r.status === STATUS.COMPLETED;
  const list = (label, arr) => ({ label, items: Array.isArray(arr) && arr.length ? arr : [DASH] });
  const result = [
    { label: 'Rating', value: ['text', done ? r.rating : 'Not rated yet'], style: done && RATING_COLOURS[r.rating] ? bandStyle(RATING_COLOURS[r.rating], { h: 'left' }) : null },
    { label: 'Score %', value: ['one', r.scorePct] },
    { label: 'Correct', value: ['int', r.correct] },
    { label: 'Total questions', value: ['int', r.total] },
    { label: 'Status', value: ['text', r.status], style: STATUS_COLOURS[r.status] ? bandStyle(STATUS_COLOURS[r.status], { h: 'left', b: false }) : null },
    { label: 'Time taken (min)', value: ['one', r.timeTakenMin] },
    { label: 'Time limit (min)', value: ['int', r.timeLimitMin] },
    { label: 'Attempt no.', value: ['int', r.attemptNo] },
  ];
  const person = [
    { label: 'Employee ID', value: ['text', r.employeeId] },
    { label: 'Name', value: ['text', r.name] },
    { label: 'Email', value: ['text', r.email] },
    { label: 'Phone', value: ['text', r.phone] },
    { label: 'Job role', value: ['text', r.jobRole] },
    { label: 'Department', value: ['text', r.department] },
    { label: 'Group', value: ['text', r.group] },
    { label: 'Manager', value: ['text', r.managerName] },
    { label: 'Manager ID', value: ['text', r.managerId] },
  ];
  const assessment = [
    { label: 'Assessment', value: ['text', r.assessmentTitle] },
    { label: 'Type', value: ['text', r.assessmentType] },
    { label: 'Assigned on', value: ['date', r.assignedAt] },
    { label: 'Window start', value: ['date', r.windowStart] },
    { label: 'Due', value: ['date', r.dueAt] },
    { label: 'Started at', value: ['date', r.startedAt] },
    { label: 'Completed on', value: ['date', r.completedAt] },
    { label: 'Reminders sent', value: ['int', r.remindersCount] },
    { label: 'Last reminder', value: ['date', r.lastReminderAt] },
  ];
  const sections = [
    { heading: 'Result', rows: result },
    { heading: 'Employee', rows: person },
    { heading: 'Assessment', rows: assessment },
  ];
  // Strengths / needs improvement / missing / recommendations: one item per row.
  const lists = [list('Strengths', r.strengths), list('Needs improvement', r.weakAreas), list('Missing skills', r.missingSkills), list('Recommendations', r.recommendations)];
  const flat = [];
  for (const l of lists) l.items.forEach((it, i) => flat.push({ label: i === 0 ? l.label : '', value: ['text', it] }));
  sections.push({ heading: 'Skills and recommendations', rows: flat });
  const generated = new Intl.DateTimeFormat('en-GB', { timeZone: tz, dateStyle: 'medium', timeStyle: 'short' }).format(new Date());
  return overviewSheet({
    title: safe(r.name, 'Employee report'),
    subtitle: `${safe(r.assessmentTitle, 'Assessment')}   |   ${safe(r.companyName, 'Company not set')}   |   Generated ${generated}`,
    sections, widths: [22, 18, 22, 30], tz,
  });
}

function individualSkillsSheet(r) {
  const cols = [
    { header: 'Skill', w: 30, cell: s => S(s.skill) },
    { header: 'Correct', w: 10, kind: 'num', cell: s => N(s.correct) },
    { header: 'Total', w: 10, kind: 'num', cell: s => N(s.total) },
    { header: 'Score %', w: 11, kind: 'num', fmt: FMT.int, cell: s => N(s.pct), style: (s) => (s.pct === null || s.pct === undefined ? null : pctBandStyle(s.pct)) },
    { header: 'Rating', w: 14, kind: 'center', cell: s => S(s.pct === null || s.pct === undefined ? DASH : ratingFromPercent(s.pct)), style: (s) => (s.pct === null || s.pct === undefined ? null : ratingStyle(ratingFromPercent(s.pct))) },
  ];
  return tableSheet('Skills', cols, r.skills || [], { freezeCols: 1 });
}

export function buildIndividualWorkbook({ row, tz = reportTimezone() }) {
  return writeWorkbook([individualOverview(row, tz), individualSkillsSheet(row), questionSheet([row])]);
}

/** Generic table (used by the filtered-reports export that mirrors an on-screen table). */
export function buildTableWorkbook({ headers, rows, sheetName = 'Reports' }) {
  const colsMeta = headers.map((h, i) => {
    const longest = Math.max(String(h).length, ...rows.slice(0, 200).map(r => safe(Array.isArray(r) ? r[i] : '', '').length));
    return Math.min(Math.max(12, longest + 2), 48);
  });
  const columns = headers.map((h, i) => ({
    header: safe(h, ''),
    w: colsMeta[i],
    kind: rows.some(r => typeof (Array.isArray(r) ? r[i] : undefined) === 'number') ? 'num' : 'text',
    fmt: '0.##',
    cell: (r) => {
      const v = Array.isArray(r) ? r[i] : undefined;
      return typeof v === 'number' && Number.isFinite(v) ? { t: 'n', v } : S(v);
    },
  }));
  return writeWorkbook([tableSheet(sheetName, columns, rows, { freezeCols: 0 })]);
}

export { STATUS };
