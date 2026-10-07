/**
 * xlsxReports.js — Excel workbooks for assessment reports.
 *
 * Built with the `xlsx` library (real cell types: dates are Excel dates,
 * numbers are numbers). The community build of `xlsx` cannot write cell
 * styling or frozen panes, so after writing we patch the generated package
 * (styles.xml + the sheet XML) to add the header style, freeze pane, borders,
 * wrap text and a bold first column on key/value sheets.
 */
import XLSX from 'xlsx';
import AdmZip from 'adm-zip';
import { DASH, safe, num, excelSerial, reportTimezone, STATUS } from './reportData.js';

const DATE_FMT = 'dd mmm yyyy, h:mm AM/PM';
const MAX_CELL = 32000;

// ── cell builders ───────────────────────────────────────────────────────────
const S = (v) => {
  let t = safe(v, DASH);
  if (t.length > MAX_CELL) t = `${t.slice(0, MAX_CELL - 1)}…`;
  return { t: 's', v: t };
};
const N = (v, z = '0') => {
  const n = num(v);
  return n === null ? S(DASH) : { t: 'n', v: n, z };
};
const D = (v, tz) => {
  const serial = excelSerial(v, tz);
  return serial === null ? S(DASH) : { t: 'n', v: serial, z: DATE_FMT };
};
const LIST = (arr) => S(Array.isArray(arr) && arr.length ? arr.join('; ') : DASH);

// ── Results columns (exact order required by the owner) ─────────────────────
export const RESULTS_COLUMNS = [
  { header: 'Employee ID', w: 14, cell: r => S(r.employeeId) },
  { header: 'Employee Name', w: 24, cell: r => S(r.name) },
  { header: 'Email', w: 30, cell: r => S(r.email) },
  { header: 'Phone', w: 16, cell: r => S(r.phone) },
  { header: 'Job Role', w: 24, cell: r => S(r.jobRole) },
  { header: 'Department', w: 20, cell: r => S(r.department) },
  { header: 'Group', w: 18, cell: r => S(r.group) },
  { header: 'Manager Name', w: 22, cell: r => S(r.managerName) },
  { header: 'Manager ID', w: 16, cell: r => S(r.managerId) },
  { header: 'Assessment Title', w: 30, cell: r => S(r.assessmentTitle) },
  { header: 'Assessment Type', w: 18, cell: r => S(r.assessmentType) },
  { header: 'Assigned On', w: 21, cell: (r, tz) => D(r.assignedAt, tz) },
  { header: 'Window Start', w: 21, cell: (r, tz) => D(r.windowStart, tz) },
  { header: 'Due Date', w: 21, cell: (r, tz) => D(r.dueAt, tz) },
  { header: 'Started At', w: 21, cell: (r, tz) => D(r.startedAt, tz) },
  { header: 'Completed On', w: 21, cell: (r, tz) => D(r.completedAt, tz) },
  { header: 'Status', w: 13, cell: r => S(r.status) },
  { header: 'Time Taken (min)', w: 11, cell: r => N(r.timeTakenMin, '0.0') },
  { header: 'Time Limit (min)', w: 11, cell: r => N(r.timeLimitMin, '0') },
  { header: 'Attempt No.', w: 9, cell: r => N(r.attemptNo, '0') },
  { header: 'Correct', w: 9, cell: r => N(r.correct, '0') },
  { header: 'Total Questions', w: 10, cell: r => N(r.total, '0') },
  { header: 'Score %', w: 9, cell: r => N(r.scorePct, '0.0') },
  { header: 'Grade', w: 8, cell: r => S(r.grade) },
  { header: 'Result', w: 9, cell: r => S(r.result) },
  { header: 'Pass Mark %', w: 10, cell: r => N(r.passMark, '0') },
  { header: 'Performance Level', w: 20, cell: r => S(r.performance) },
  { header: 'Readiness Level', w: 20, cell: r => S(r.readiness) },
  { header: 'Skill Scores', w: 44, cell: r => S(r.skillScoresText) },
  { header: 'Strengths', w: 36, cell: r => LIST(r.strengths) },
  { header: 'Needs Improvement', w: 36, cell: r => LIST(r.weakAreas) },
  { header: 'Missing Skills', w: 30, cell: r => LIST(r.missingSkills) },
  { header: 'Recommendations', w: 50, cell: r => LIST(r.recommendations) },
  { header: 'Reminders Sent', w: 10, cell: r => N(r.remindersCount, '0') },
  { header: 'Last Reminder On', w: 21, cell: (r, tz) => D(r.lastReminderAt, tz) },
];

export const SKILLS_HEADERS = ['Employee ID', 'Employee Name', 'Skill', 'Correct', 'Total', 'Score %'];
export const QUESTION_HEADERS = ['Employee ID', 'Employee Name', 'Q No.', 'Question', 'Type', 'Difficulty', 'Skill', 'Employee Answer', 'Correct Answer', 'Result', 'Marks'];

// ── sheet builders ──────────────────────────────────────────────────────────
function sheetFromCells(headers, rows, widths) {
  const ws = {};
  const colName = (c) => XLSX.utils.encode_col(c);
  headers.forEach((h, c) => { ws[`${colName(c)}1`] = { t: 's', v: h }; });
  rows.forEach((row, r) => row.forEach((cell, c) => { ws[`${colName(c)}${r + 2}`] = cell; }));
  const lastRow = rows.length + 1;
  ws['!ref'] = `A1:${colName(headers.length - 1)}${lastRow}`;
  ws['!cols'] = widths.map(w => ({ wch: w }));
  if (rows.length) ws['!autofilter'] = { ref: ws['!ref'] };
  return ws;
}

export function resultsSheet(rows, tz = reportTimezone()) {
  return sheetFromCells(
    RESULTS_COLUMNS.map(c => c.header),
    rows.map(r => RESULTS_COLUMNS.map(c => c.cell(r, tz))),
    RESULTS_COLUMNS.map(c => c.w),
  );
}

export function skillsSheet(rows) {
  const out = [];
  for (const r of rows) {
    for (const s of r.skills || []) out.push([S(r.employeeId), S(r.name), S(s.skill), N(s.correct), N(s.total), N(s.pct, '0')]);
  }
  return sheetFromCells(SKILLS_HEADERS, out, [14, 24, 36, 9, 9, 9]);
}

export function questionSheet(rows) {
  const out = [];
  for (const r of rows) {
    for (const q of r.questions || []) {
      out.push([S(r.employeeId), S(r.name), N(q.no), S(q.question), S(q.type), S(q.difficulty), S(q.skill),
        S(q.userAnswer || 'Not answered'), S(q.correctAnswer), S(q.result), N(q.marks)]);
    }
  }
  return sheetFromCells(QUESTION_HEADERS, out, [14, 24, 7, 60, 16, 11, 24, 40, 40, 13, 7]);
}

function keyValueSheet(pairs, valueWidth = 60) {
  return sheetFromCells(['Item', 'Value'], pairs.map(([k, v]) => [S(k), v]), [32, valueWidth]);
}

function summaryPairs(sum, tz) {
  return [
    ['Assessment title', S(sum.title)],
    ['Assessment type', S(sum.type)],
    ['Job role(s)', S(sum.jobRoles)],
    ['Company', S(sum.company)],
    ['Created on', D(sum.createdAt, tz)],
    ['Starts', D(sum.startAt, tz)],
    ['Due', D(sum.dueAt, tz)],
    ['Time limit (min)', N(sum.timeLimitMin)],
    ['Pass mark %', N(sum.passMark)],
    ['Employees assigned', N(sum.assigned)],
    ['Completed', N(sum.completed)],
    ['In progress', N(sum.inProgress)],
    ['Not started', N(sum.notStarted)],
    ['Overdue', N(sum.overdue)],
    ['Completion %', N(sum.completionPct, '0.0')],
    ['Average score %', N(sum.avgScore, '0.0')],
    ['Highest score %', N(sum.highScore, '0.0')],
    ['Lowest score %', N(sum.lowScore, '0.0')],
    ['Passed', N(sum.passed)],
    ['Failed', N(sum.failed)],
    ['Pass %', N(sum.passPct, '0.0')],
    ['Grade A (85% and above)', N(sum.grades?.A ?? 0)],
    ['Grade B (70% to under 85%)', N(sum.grades?.B ?? 0)],
    ['Grade C (under 70%)', N(sum.grades?.C ?? 0)],
    ['Report generated on', D(sum.generatedAt, tz)],
  ];
}

function individualPairs(r, tz) {
  const pairs = RESULTS_COLUMNS.map(c => [c.header, c.cell(r, tz)]);
  return [...pairs, ['Report generated on', D(new Date(), tz)]];
}

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
  for (const s of sheets) XLSX.utils.book_append_sheet(wb, s.ws, safeSheetName(s.name, used));
  const raw = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
  return patchXlsx(Buffer.isBuffer(raw) ? raw : Buffer.from(raw), sheets.map(s => ({ labelCol: !!s.labelCol })));
}

// ── public builders ─────────────────────────────────────────────────────────
export function buildAssessmentWorkbook({ rows, summary, tz = reportTimezone() }) {
  return writeWorkbook([
    { name: 'Summary', ws: keyValueSheet(summaryPairs(summary, tz), 44), labelCol: true },
    { name: 'Results', ws: resultsSheet(rows, tz) },
    { name: 'Skills', ws: skillsSheet(rows) },
    { name: 'Question Review', ws: questionSheet(rows) },
  ]);
}

/** Every submission across assessments: Summary + Results. */
export function buildAllReportsWorkbook({ rows, summary, tz = reportTimezone() }) {
  const pairs = [
    ['Assessments covered', N(new Set(rows.map(r => r.assessmentId || r.assessmentTitle)).size)],
    ['Records (one per employee per assessment)', N(rows.length)],
    ['Completed', N(summary.completed)],
    ['Not completed', N(summary.notCompleted)],
    ['Average score %', N(summary.avgScore, '0.0')],
    ['Highest score %', N(summary.highScore, '0.0')],
    ['Lowest score %', N(summary.lowScore, '0.0')],
    ['Passed', N(summary.passed)],
    ['Failed', N(summary.failed)],
    ['Pass %', N(summary.passPct, '0.0')],
    ['Grade A (85% and above)', N(summary.grades?.A ?? 0)],
    ['Grade B (70% to under 85%)', N(summary.grades?.B ?? 0)],
    ['Grade C (under 70%)', N(summary.grades?.C ?? 0)],
    ['Report generated on', D(summary.generatedAt, tz)],
  ];
  return writeWorkbook([
    { name: 'Summary', ws: keyValueSheet(pairs, 20), labelCol: true },
    { name: 'Results', ws: resultsSheet(rows, tz) },
  ]);
}

export function buildIndividualWorkbook({ row, tz = reportTimezone() }) {
  return writeWorkbook([
    { name: 'Summary', ws: keyValueSheet(individualPairs(row, tz), 60), labelCol: true },
    { name: 'Skills', ws: skillsSheet([row]) },
    { name: 'Question Review', ws: questionSheet([row]) },
  ]);
}

/** Generic table (used by the filtered-reports export that mirrors an on-screen table). */
export function buildTableWorkbook({ headers, rows, sheetName = 'Reports' }) {
  const cells = rows.map(r => headers.map((_, i) => {
    const v = Array.isArray(r) ? r[i] : undefined;
    if (typeof v === 'number' && Number.isFinite(v)) return { t: 'n', v, z: '0.##' };
    return S(v);
  }));
  const widths = headers.map((h, i) => {
    const longest = Math.max(String(h).length, ...rows.slice(0, 200).map(r => safe(Array.isArray(r) ? r[i] : '', '').length));
    return Math.min(Math.max(12, longest + 2), 48);
  });
  return writeWorkbook([{ name: sheetName, ws: sheetFromCells(headers.map(h => safe(h, '')), cells, widths) }]);
}

// ── package patch: styles, header row, freeze pane ──────────────────────────
function patchXlsx(buf, sheetOpts) {
  const zip = new AdmZip(buf);

  let styles = zip.readAsText('xl/styles.xml');
  styles = styles.replace(/<fonts count="\d+">[\s\S]*?<\/fonts>/,
    '<fonts count="3">'
    + '<font><sz val="11"/><color rgb="FF1E293B"/><name val="Calibri"/><family val="2"/></font>'
    + '<font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/><family val="2"/></font>'
    + '<font><b/><sz val="11"/><color rgb="FF1E293B"/><name val="Calibri"/><family val="2"/></font>'
    + '</fonts>');
  styles = styles.replace(/<fills count="\d+">[\s\S]*?<\/fills>/,
    '<fills count="4"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill>'
    + '<fill><patternFill patternType="solid"><fgColor rgb="FF4338CA"/><bgColor indexed="64"/></patternFill></fill>'
    + '<fill><patternFill patternType="solid"><fgColor rgb="FFF1F5F9"/><bgColor indexed="64"/></patternFill></fill></fills>');
  const edge = '<color rgb="FFE2E8F0"/>';
  styles = styles.replace(/<borders count="\d+">[\s\S]*?<\/borders>/,
    '<borders count="2"><border><left/><right/><top/><bottom/><diagonal/></border>'
    + `<border><left style="thin">${edge}</left><right style="thin">${edge}</right><top style="thin">${edge}</top><bottom style="thin">${edge}</bottom><diagonal/></border></borders>`);

  let baseCount = 0;
  styles = styles.replace(/<cellXfs count="(\d+)">([\s\S]*?)<\/cellXfs>/, (_m, _c, inner) => {
    const xfs = inner.match(/<xf [^>]*\/>/g) || [];
    baseCount = xfs.length;
    const body = xfs.map(x => x
      .replace(/fontId="\d+"/, 'fontId="0"')
      .replace(/fillId="\d+"/, 'fillId="0"')
      .replace(/borderId="\d+"/, 'borderId="1"')
      .replace(/\/>$/, ' applyBorder="1" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf>'));
    body.push('<xf numFmtId="0" fontId="1" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment vertical="center" wrapText="1"/></xf>');
    body.push('<xf numFmtId="0" fontId="2" fillId="3" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf>');
    return `<cellXfs count="${body.length}">${body.join('')}</cellXfs>`;
  });
  const HEADER = baseCount;
  const LABEL = baseCount + 1;
  zip.updateFile('xl/styles.xml', Buffer.from(styles, 'utf8'));

  sheetOpts.forEach((opt, i) => {
    const path = `xl/worksheets/sheet${i + 1}.xml`;
    let xml = zip.readAsText(path);
    if (!xml) return;
    xml = xml.replace(/<row r="1"([^>]*)>([\s\S]*?)<\/row>/, (_m, attrs, inner) => {
      const cells = inner.replace(/<c r="([A-Z]+1)"(?: s="\d+")?/g, (_x, ref) => `<c r="${ref}" s="${HEADER}"`);
      return `<row r="1"${attrs} ht="30" customHeight="1">${cells}</row>`;
    });
    if (opt.labelCol) {
      xml = xml.replace(/<c r="(A(\d+))"(?: s="\d+")?/g, (m, ref, n) => (Number(n) > 1 ? `<c r="${ref}" s="${LABEL}"` : m));
    }
    const views = '<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/><selection pane="bottomLeft" activeCell="A2" sqref="A2"/></sheetView></sheetViews>';
    xml = /<sheetViews>[\s\S]*?<\/sheetViews>/.test(xml)
      ? xml.replace(/<sheetViews>[\s\S]*?<\/sheetViews>/, views)
      : xml.replace(/(<dimension[^>]*\/>)/, `$1${views}`);
    zip.updateFile(path, Buffer.from(xml, 'utf8'));
  });

  return zip.toBuffer();
}

export { STATUS };
