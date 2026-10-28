/**
 * moduleXlsx.js - Excel workbooks for Reports > Modules.
 *
 * Single employee-module workbook: Overview, Days, Questions, Skills.
 * Consolidated workbook: Overview, Employees (one row per employee-module), Questions.
 *
 * Layout rules: compact columns (width <= 40), one fixed row height, no wrapped
 * text, frozen header row, filters, zebra rows, real dates and numbers, and
 * coloured Result cells. The community `xlsx` build cannot write styles, so the
 * generated package is patched afterwards (same technique as xlsxReports.js,
 * kept as a separate copy so the two can evolve independently).
 */
import XLSX from 'xlsx';
import AdmZip from 'adm-zip';
import { DASH, safe, num, excelSerial, reportTimezone } from './reportData.js';
import { fmtSeconds } from './moduleReportData.js';

const DATE_FMT = 'dd mmm yyyy, h:mm AM/PM';
const MAX_CELL = 2000;
const ROW_H = 18;
export const MAX_QUESTION_ROWS = 5000;

const S = (v, k) => { let t = safe(v, DASH); if (t.length > MAX_CELL) t = `${t.slice(0, MAX_CELL - 1)}…`; return { t: 's', v: t, k }; };
const N = (v, z = '0') => { const n = num(v); return n === null ? S(DASH) : { t: 'n', v: n, z }; };
const D = (v, tz) => { const s = excelSerial(v, tz); return s === null ? S(DASH) : { t: 'n', v: s, z: DATE_FMT }; };
const MIN = (sec) => { const n = num(sec); return n === null ? S(DASH) : { t: 'n', v: Math.round((n / 60) * 10) / 10, z: '0.0' }; };
const resultCell = (r) => S(r, r === 'Correct' ? 'good' : r === 'Wrong' ? 'bad' : 'neutral');
const ratingCell = (r) => S(r || DASH, r === 'Expert' ? 'good' : r === 'Intermediate' ? 'info' : r === 'Basic' ? 'warn' : r === 'No Rating' ? 'bad' : undefined);

function sheet(headers, rows, widths) {
  const ws = {};
  const styles = new Map();
  const col = (c) => XLSX.utils.encode_col(c);
  headers.forEach((h, c) => { ws[`${col(c)}1`] = { t: 's', v: h }; });
  rows.forEach((row, r) => row.forEach((cell, c) => {
    const ref = `${col(c)}${r + 2}`;
    if (cell.k) styles.set(ref, cell.k);
    const { k: _k, ...clean } = cell;
    ws[ref] = clean;
  }));
  ws['!ref'] = `A1:${col(headers.length - 1)}${rows.length + 1}`;
  ws['!cols'] = widths.map(w => ({ wch: Math.min(w, 40) }));
  if (rows.length) ws['!autofilter'] = { ref: ws['!ref'] };
  return { ws, styles };
}

function kv(pairs) {
  return sheet(['Item', 'Value'], pairs.map(([k, v]) => [S(k, 'label'), v]), [34, 40]);
}

// ── column sets ─────────────────────────────────────────────────────────────
export const EMPLOYEE_HEADERS = [
  'Employee ID', 'Employee Name', 'Email', 'Phone', 'Job Role', 'Department', 'Manager', 'Manager ID', 'Company', 'Module', 'Status', 'Assigned On', 'Started', 'Completed On',
  'Days Completed', 'Days Total', 'Progress %', 'Time Spent (min)', 'Questions Answered', 'Correct', 'Wrong', 'Not Answered', 'Score %', 'Rating',
];
const employeeCells = (r, tz) => [
  S(r.employeeId), S(r.name), S(r.email), S(r.phone), S(r.jobRole), S(r.department), S(r.managerName), S(r.managerId), S(r.companyName), S(r.moduleTitle), S(r.status),
  D(r.assignedAt, tz), D(r.startedAt, tz), D(r.completedAt, tz),
  N(r.daysCompleted), N(r.daysTotal), N(r.progressPct), MIN(r.timeSpentSec), N(r.questionsAnswered), N(r.correct), N(r.wrong), N(r.skipped), N(r.scorePct, '0.0'), ratingCell(r.rating),
];
const EMPLOYEE_W = [14, 24, 26, 16, 22, 18, 22, 16, 22, 32, 13, 21, 21, 21, 10, 9, 10, 12, 11, 8, 8, 10, 9, 14];

export const DAY_HEADERS = ['Employee ID', 'Employee Name', 'Module', 'Day', 'Day Title', 'Status', 'Started', 'Completed On', 'Time Spent (min)', 'Sections Opened', 'Attempts', 'Questions', 'Correct', 'Wrong', 'Not Answered', 'Score %'];
const dayCells = (r, d, tz) => [
  S(r.employeeId), S(r.name), S(r.moduleTitle), N(d.day), S(d.title), S(d.status), D(d.startedAt, tz), D(d.completedAt, tz), MIN(d.timeSpentSec),
  d.sectionsTracked ? N(d.sections.length) : S(DASH), N(d.attempts), N(d.total), N(d.correct), N(d.wrong), N(d.skipped), N(d.scorePct, '0.0'),
];
const DAY_W = [14, 24, 30, 6, 36, 13, 21, 21, 12, 10, 9, 10, 8, 8, 12, 9];

export const QUESTION_HEADERS = ['Employee ID', 'Employee Name', 'Module', 'Day', 'Section', 'Q No.', 'Question', 'Employee Answer', 'Correct Answer', 'Result', 'Answered At', 'Attempt'];
const questionCells = (r, q, tz) => [
  S(r.employeeId), S(r.name), S(r.moduleTitle), N(q.day), S(q.section), N(q.no), S(q.question), S(q.userAnswer || 'Not answered'), S(q.correctAnswer), resultCell(q.result), D(q.answeredAt, tz), N(q.attempt),
];
const QUESTION_W = [14, 24, 30, 6, 24, 7, 40, 34, 34, 13, 21, 8];

export const SKILL_HEADERS = ['Employee ID', 'Employee Name', 'Module', 'Skill / Section', 'Correct', 'Total', 'Score %'];
const skillCells = (r, s) => [S(r.employeeId), S(r.name), S(r.moduleTitle), S(s.skill), N(s.correct), N(s.total), N(s.pct, '0.0')];

function questionSheet(records, tz) {
  const rows = [];
  let capped = false;
  for (const r of records) {
    for (const q of r.questions || []) {
      if (rows.length >= MAX_QUESTION_ROWS) { capped = true; break; }
      rows.push(questionCells(r, q, tz));
    }
    if (capped) break;
  }
  return { ...sheet(QUESTION_HEADERS, rows, QUESTION_W), capped, count: rows.length };
}

// ── workbook assembly ───────────────────────────────────────────────────────
function sheetName(name, used) {
  let n = String(name).replace(/[\\/?*[\]:]/g, ' ').trim().slice(0, 31) || 'Sheet';
  let i = 2;
  while (used.has(n.toLowerCase())) n = `${n.slice(0, 28)} ${i++}`;
  used.add(n.toLowerCase());
  return n;
}

function write(sheets) {
  const wb = XLSX.utils.book_new();
  const used = new Set();
  for (const s of sheets) XLSX.utils.book_append_sheet(wb, s.ws, sheetName(s.name, used));
  const raw = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
  return patch(Buffer.isBuffer(raw) ? raw : Buffer.from(raw), sheets.map(s => s.styles));
}

export function buildModuleWorkbook({ record: r, tz = reportTimezone(), now = new Date() }) {
  const overview = kv([
    ['Employee ID', S(r.employeeId)], ['Employee name', S(r.name)], ['Email', S(r.email)], ['Phone', S(r.phone)], ['Job role', S(r.jobRole)], ['Department', S(r.department)], ['Manager', S(r.managerName)], ['Manager ID', S(r.managerId)],
    ['Company', S(r.companyName)], ['Module', S(r.moduleTitle)], ['Status', S(r.status)],
    ['Assigned on', D(r.assignedAt, tz)], ['Started', D(r.startedAt, tz)], ['Completed on', D(r.completedAt, tz)], ['Due date', D(r.dueAt, tz)],
    ['Days completed', S(`${r.daysCompleted} of ${r.daysTotal}`)], ['Progress %', N(r.progressPct)], ['Time spent', S(fmtSeconds(r.timeSpentSec))],
    ['Questions in total', N(r.questionsTotal)], ['Answered', N(r.questionsAnswered)], ['Correct', N(r.correct)], ['Wrong', N(r.wrong)], ['Not answered', N(r.skipped)],
    ['Score %', N(r.scorePct, '0.0')], ['Rating', ratingCell(r.rating)], ['Quiz attempts in total', N(r.attemptsTotal)],
    ['Strengths', S((r.strengths || []).join('; '))], ['Needs improvement', S((r.needsImprovement || []).join('; '))],
    ['Detail saved', S(r.hasDetail ? 'Yes' : 'No - completed before answers were saved; only progress is available')],
    ['Report generated on', D(now, tz)],
  ]);
  const days = sheet(DAY_HEADERS, (r.days || []).map(d => dayCells(r, d, tz)), DAY_W);
  const qs = questionSheet([r], tz);
  const skills = sheet(SKILL_HEADERS, (r.skills || []).map(s => skillCells(r, s)), [14, 24, 30, 36, 9, 9, 9]);
  return write([
    { name: 'Overview', ...overview }, { name: 'Days', ...days }, { name: 'Questions', ...qs }, { name: 'Skills', ...skills },
  ]);
}

/** Consolidated: `rows` are light records (the list), `records` the detailed ones (questions). */
export function buildConsolidatedModuleWorkbook({ rows, records = [], summary = {}, truncatedNote = '', tz = reportTimezone(), now = new Date(), filtersText = '' }) {
  const qs = questionSheet(records, tz);
  const pairs = [
    ['Records (employee x module)', N(rows.length)], ['Employees', N(summary.employees)], ['Completed modules', N(summary.completed)], ['In progress', N(summary.inProgress)],
    ['Average score %', N(summary.avgScore, '0.0')], ['Expert', N(summary.ratings?.Expert ?? 0)], ['Intermediate', N(summary.ratings?.Intermediate ?? 0)],
    ['Basic', N(summary.ratings?.Basic ?? 0)], ['No Rating', N(summary.ratings?.['No Rating'] ?? 0)],
    ['Total time spent', S(fmtSeconds(summary.totalTimeSec))], ['Filters applied', S(filtersText || 'None')],
    ['Question rows in this file', N(qs.count)],
  ];
  if (qs.capped || truncatedNote) pairs.push(['Note', S(truncatedNote || `Questions are limited to ${MAX_QUESTION_ROWS} rows per file. Narrow the filters or download single reports for the rest.`)]);
  pairs.push(['Report generated on', D(now, tz)]);
  const list = sheet(EMPLOYEE_HEADERS, rows.map(r => employeeCells(r, tz)), EMPLOYEE_W);
  return write([{ name: 'Overview', ...kv(pairs) }, { name: 'Employees', ...list }, { name: 'Questions', ws: qs.ws, styles: qs.styles }]);
}

// ── package patch ───────────────────────────────────────────────────────────
function patch(buf, styleMaps) {
  const zip = new AdmZip(buf);
  let styles = zip.readAsText('xl/styles.xml');
  styles = styles.replace(/<fonts count="\d+">[\s\S]*?<\/fonts>/,
    '<fonts count="6">'
    + '<font><sz val="11"/><color rgb="FF1E293B"/><name val="Calibri"/><family val="2"/></font>'
    + '<font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/><family val="2"/></font>'
    + '<font><b/><sz val="11"/><color rgb="FF1E293B"/><name val="Calibri"/><family val="2"/></font>'
    + '<font><b/><sz val="11"/><color rgb="FF166534"/><name val="Calibri"/><family val="2"/></font>'
    + '<font><b/><sz val="11"/><color rgb="FF991B1B"/><name val="Calibri"/><family val="2"/></font>'
    + '<font><b/><sz val="11"/><color rgb="FF475569"/><name val="Calibri"/><family val="2"/></font>'
    + '</fonts>');
  const solid = (rgb) => `<fill><patternFill patternType="solid"><fgColor rgb="FF${rgb}"/><bgColor indexed="64"/></patternFill></fill>`;
  styles = styles.replace(/<fills count="\d+">[\s\S]*?<\/fills>/,
    `<fills count="9"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill>${['4338CA', 'F1F5F9', 'DCFCE7', 'FEE2E2', 'E2E8F0', 'DBEAFE', 'FEF3C7'].map(solid).join('')}</fills>`);
  const edge = '<color rgb="FFE2E8F0"/>';
  styles = styles.replace(/<borders count="\d+">[\s\S]*?<\/borders>/,
    '<borders count="2"><border><left/><right/><top/><bottom/><diagonal/></border>'
    + `<border><left style="thin">${edge}</left><right style="thin">${edge}</right><top style="thin">${edge}</top><bottom style="thin">${edge}</bottom><diagonal/></border></borders>`);

  // fills: 2 header, 3 zebra/label, 4 good, 5 bad, 6 neutral, 7 info, 8 warn
  let baseCount = 0;
  const zebraOf = new Map();
  const extra = {};
  styles = styles.replace(/<cellXfs count="(\d+)">([\s\S]*?)<\/cellXfs>/, (_m, _c, inner) => {
    const xfs = inner.match(/<xf [^>]*\/>/g) || [];
    baseCount = xfs.length;
    const align = '<alignment vertical="center"/>';
    const plain = xfs.map(x => x.replace(/fontId="\d+"/, 'fontId="0"').replace(/fillId="\d+"/, 'fillId="0"').replace(/borderId="\d+"/, 'borderId="1"')
      .replace(/\/>$/, ` applyBorder="1" applyAlignment="1">${align}</xf>`));
    const body = plain.slice();
    plain.forEach((x, i) => { zebraOf.set(i, body.length); body.push(x.replace('fillId="0"', 'fillId="3"').replace('<xf ', '<xf applyFill="1" ')); });
    const add = (key, font, fill, al = align) => {
      extra[key] = body.length;
      body.push(`<xf numFmtId="0" fontId="${font}" fillId="${fill}" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1">${al}</xf>`);
    };
    add('header', 1, 2, '<alignment vertical="center" horizontal="left"/>');
    add('label', 2, 3);
    add('good', 3, 4); add('bad', 4, 5); add('neutral', 5, 6); add('info', 2, 7); add('warn', 2, 8);
    return `<cellXfs count="${body.length}">${body.join('')}</cellXfs>`;
  });
  zip.updateFile('xl/styles.xml', Buffer.from(styles, 'utf8'));

  styleMaps.forEach((map, i) => {
    const path = `xl/worksheets/sheet${i + 1}.xml`;
    let xml = zip.readAsText(path);
    if (!xml) return;
    xml = xml.replace(/<row r="(\d+)"([^>]*)>([\s\S]*?)<\/row>/g, (_m, rn, attrs, inner) => {
      const n = Number(rn);
      const cells = inner.replace(/<c r="([A-Z]+)(\d+)"(?: s="(\d+)")?/g, (_x, c, rr, s) => {
        const ref = `${c}${rr}`;
        let style;
        if (n === 1) style = extra.header;
        else if (map.has(ref) && extra[map.get(ref)] !== undefined) style = extra[map.get(ref)];
        else {
          const base = s ? Number(s) : 0;
          style = n % 2 === 1 ? (zebraOf.get(base) ?? base) : base;
        }
        return `<c r="${ref}" s="${style}"`;
      });
      return `<row r="${rn}"${attrs.replace(/ ht="[^"]*"| customHeight="[^"]*"/g, '')} ht="${n === 1 ? 26 : ROW_H}" customHeight="1">${cells}</row>`;
    });
    const views = '<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/><selection pane="bottomLeft" activeCell="A2" sqref="A2"/></sheetView></sheetViews>';
    xml = /<sheetViews>[\s\S]*?<\/sheetViews>/.test(xml) ? xml.replace(/<sheetViews>[\s\S]*?<\/sheetViews>/, views) : xml.replace(/(<dimension[^>]*\/>)/, `$1${views}`);
    zip.updateFile(path, Buffer.from(xml, 'utf8'));
  });
  void baseCount;
  return zip.toBuffer();
}
