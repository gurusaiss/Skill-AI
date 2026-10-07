import { describe, it, expect } from 'vitest';
import XLSX from 'xlsx';
import AdmZip from 'adm-zip';
import pdfParse from 'pdf-parse/lib/pdf-parse.js';
import {
  safe, fmtDate, fmtDuration, fmtPct, excelSerial, truncate, buildResultRow, computeStatus, STATUS, timeTakenSeconds, pickReport,
} from './reportData.js';
import { RESULTS_COLUMNS, buildAssessmentWorkbook, buildIndividualWorkbook, buildAllReportsWorkbook, buildTableWorkbook } from './xlsxReports.js';
import { renderConsolidatedPdf, renderIndividualPdf, buildTablePdf, pdfSafe } from './pdfReports.js';
import { buildConsolidatedDocx, buildIndividualDocx, buildTableDocx } from './docxReports.js';
import { fakeRows, fakeAssessment, fakeBreakdown } from './testFixtures.js';

const EXPECTED_COLUMNS = [
  'Employee ID', 'Employee Name', 'Email', 'Phone', 'Job Role', 'Department', 'Group', 'Manager Name', 'Manager ID', 'Assessment Title',
  'Assessment Type', 'Assigned On', 'Window Start', 'Due Date', 'Started At', 'Completed On', 'Status', 'Time Taken (min)', 'Time Limit (min)',
  'Attempt No.', 'Correct', 'Total Questions', 'Score %', 'Grade', 'Result', 'Pass Mark %', 'Performance Level', 'Readiness Level', 'Skill Scores',
  'Strengths', 'Needs Improvement', 'Missing Skills', 'Recommendations', 'Reminders Sent', 'Last Reminder On',
];

const BAD = /undefined|\bnull\b|NaN|Invalid Date/;
const fx = fakeRows();

function sheetRows(buf, name) {
  const wb = XLSX.read(buf, { type: 'buffer' });
  return XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, raw: true, defval: '' });
}

describe('safe formatters never print junk', () => {
  it('safe()', () => {
    for (const v of [undefined, null, '', '  ', 'undefined', 'null', 'NaN', 'Invalid Date', NaN, Infinity, {}, [], [null, undefined]]) {
      expect(safe(v)).toBe('—');
    }
    expect(safe(0)).toBe('0');
    expect(safe(['a', null, 'b'])).toBe('a; b');
  });
  it('dates, durations, percents', () => {
    expect(fmtDate(undefined)).toBe('—');
    expect(fmtDate('not a date')).toBe('—');
    expect(fmtDate('2026-10-07T10:15:00.000Z', 'Asia/Kolkata')).toBe('07 Oct 2026, 3:45 PM');
    expect(fmtDate('2026-10-07T10:15:00.000Z', 'Asia/Kolkata', { time: false })).toBe('07 Oct 2026');
    expect(fmtDate('2026-10-07T10:15:00.000Z', 'Not/AZone')).toMatch(/07 Oct 2026, 10:15 AM/);
    expect(excelSerial('garbage')).toBeNull();
    expect(typeof excelSerial('2026-10-07T10:15:00.000Z')).toBe('number');
    expect(fmtDuration(NaN)).toBe('—');
    expect(fmtDuration(42)).toBe('42 min');
    expect(fmtDuration(65)).toBe('1 h 05 min');
    expect(fmtPct(undefined)).toBe('—');
    expect(fmtPct(82.46, 1)).toBe('82.5%');
    expect(truncate('x'.repeat(500), 400).truncated).toBe(true);
    expect(truncate(undefined, 10).text).toBe('');
  });
  it('time taken is capped at the limit and null when unknown', () => {
    expect(timeTakenSeconds('2026-10-07T10:00:00Z', '2026-10-07T10:30:00Z', 60)).toBe(1800);
    expect(timeTakenSeconds('2026-10-07T08:00:00Z', '2026-10-07T10:30:00Z', 60)).toBe(3600);
    expect(timeTakenSeconds(null, '2026-10-07T10:30:00Z', 60)).toBeNull();
    expect(timeTakenSeconds('2026-10-07T11:00:00Z', '2026-10-07T10:30:00Z', 60)).toBeNull();
  });
});

describe('result rows', () => {
  it('covers every status', () => {
    const statuses = fx.rows.map(r => r.status);
    expect(statuses.filter(s => s === STATUS.COMPLETED)).toHaveLength(6);
    expect(statuses.filter(s => s === STATUS.IN_PROGRESS)).toHaveLength(2);
    expect(statuses.filter(s => s === STATUS.NOT_STARTED)).toHaveLength(2);
    expect(statuses.filter(s => s === STATUS.OVERDUE)).toHaveLength(2);
    expect(computeStatus({ status: 'cancelled' }, null)).toBe(STATUS.CANCELLED);
  });
  it('grades use the A/B/C scale on the exact score', () => {
    expect(fx.rows[0].grade).toBe('A'); // 24/25 = 96
    expect(fx.rows[2].grade).toBe('B'); // 18/25 = 72
    expect(fx.rows[5].grade).toBe('C'); // 9/25 = 36
    expect(fx.rows[5].result).toBe('Fail');
  });
  it('old records without snapshots fall back to live data and flag an unknown start', () => {
    const row = buildResultRow({
      assessment: fakeAssessment(),
      ea: { userId: 'u9', userName: 'Old Timer', status: 'submitted', submittedAt: '2026-10-01T10:00:00Z', assignedAt: '2026-09-25T04:00:00Z', attemptStartUnknown: true, scoring: null },
      report: { submittedAt: '2026-10-01T10:00:00Z', correct: 22, total: 25, score: 88, breakdown: fakeBreakdown(25, 22) },
      user: { employeeId: 'EMP77', department: 'Ops', phone: '123', managerId: 'm1' },
      manager: { name: 'Boss Person' },
    });
    expect(row.employeeId).toBe('EMP77');
    expect(row.managerName).toBe('Boss Person');
    expect(row.startedAt).toBeNull();
    expect(row.timeTakenMin).toBeNull();
    expect(row.grade).toBe('A');
    expect(row.completedAt).toBe('2026-10-01T10:00:00Z');
    expect(row.questions).toHaveLength(25);
    expect(JSON.stringify(row)).not.toMatch(/"undefined"|NaN/);
  });
  it('a reassigned (new attempt) employee does not inherit the old attempt', () => {
    const rows = buildResultRow({
      assessment: fakeAssessment(),
      ea: { userId: 'u1', userName: 'Re Assigned', status: 'assigned', attempts: [{ status: 'submitted' }], employeeId: 'STALE' },
      report: { correct: 20, total: 25, score: 80, submittedAt: '2026-09-01T00:00:00Z' },
      user: { employeeId: 'FRESH' },
    });
    expect(rows.status).not.toBe(STATUS.COMPLETED);
    expect(rows.scorePct).toBeNull();
    expect(rows.employeeId).toBe('FRESH');
    expect(rows.attemptNo).toBe(2);
  });
  it('picks the report for the current attempt', () => {
    const list = [{ id: 'old', submittedAt: '2026-09-01T00:00:00Z' }, { id: 'new', submittedAt: '2026-10-01T00:00:00Z' }];
    expect(pickReport(list, { status: 'submitted', submittedAt: '2026-10-01T00:00:00Z' }).id).toBe('new');
    expect(pickReport(list, { status: 'assigned' })).toBeNull();
  });
});

describe('Excel workbooks', () => {
  const buf = buildAssessmentWorkbook({ rows: fx.rows, summary: fx.summary });

  it('has the four sheets and the exact Results columns in order', () => {
    const wb = XLSX.read(buf, { type: 'buffer' });
    expect(wb.SheetNames).toEqual(['Summary', 'Results', 'Skills', 'Question Review']);
    const rows = sheetRows(buf, 'Results');
    expect(rows[0]).toEqual(EXPECTED_COLUMNS);
    expect(RESULTS_COLUMNS.map(c => c.header)).toEqual(EXPECTED_COLUMNS);
    expect(rows).toHaveLength(13); // header + one row per assigned employee
  });

  it('completed row carries real typed values in every column', () => {
    const rows = sheetRows(buf, 'Results');
    const h = rows[0];
    const done = rows[1];
    const col = (n) => done[h.indexOf(n)];
    expect(col('Employee ID')).toBe('EMP1001');
    expect(typeof col('Assigned On')).toBe('number');
    expect(typeof col('Started At')).toBe('number');
    expect(typeof col('Completed On')).toBe('number');
    expect(col('Completed On')).toBeGreaterThan(col('Started At'));
    expect(col('Status')).toBe('Completed');
    expect(col('Time Taken (min)')).toBe(28);
    expect(col('Correct')).toBe(24);
    expect(col('Total Questions')).toBe(25);
    expect(col('Score %')).toBe(96);
    expect(col('Grade')).toBe('A');
    expect(col('Result')).toBe('Pass');
    expect(col('Manager Name')).toBe('Neha Verma');
    expect(col('Skill Scores')).toContain('Communication 100%');
    done.forEach(v => expect(v).not.toBe(''));
  });

  it('not-completed rows are present with dashes, never blanks or junk', () => {
    const rows = sheetRows(buf, 'Results');
    const h = rows[0];
    const notStarted = rows.find(r => r[h.indexOf('Status')] === 'Not started');
    const overdue = rows.find(r => r[h.indexOf('Status')] === 'Overdue');
    expect(notStarted[h.indexOf('Completed On')]).toBe('—');
    expect(notStarted[h.indexOf('Score %')]).toBe('—');
    expect(typeof notStarted[h.indexOf('Assigned On')]).toBe('number');
    expect(typeof notStarted[h.indexOf('Due Date')]).toBe('number');
    expect(overdue[h.indexOf('Result')]).toBe('—');
    rows.flat().forEach(v => expect(v).not.toBe(''));
  });

  it('no sheet contains undefined / null / NaN / Invalid Date', () => {
    const wb = XLSX.read(buf, { type: 'buffer' });
    for (const name of wb.SheetNames) {
      for (const row of XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, raw: true, defval: '' })) {
        for (const v of row) if (typeof v === 'string') expect(v).not.toMatch(BAD);
      }
    }
  });

  it('header is styled, frozen and filterable; dates carry a date format', () => {
    const zip = new AdmZip(buf);
    const sheet = zip.readAsText('xl/worksheets/sheet2.xml');
    expect(sheet).toContain('state="frozen"');
    expect(sheet).toContain('<autoFilter');
    const styles = zip.readAsText('xl/styles.xml');
    expect(styles).toContain('FF4338CA');
    expect(styles).toContain('dd mmm yyyy, h:mm AM/PM');
  });

  it('Skills and Question Review are long tables', () => {
    const skills = sheetRows(buf, 'Skills');
    expect(skills[0]).toEqual(['Employee ID', 'Employee Name', 'Skill', 'Correct', 'Total', 'Score %']);
    expect(skills.length).toBe(1 + 6 * 5);
    const q = sheetRows(buf, 'Question Review');
    expect(q[0]).toEqual(['Employee ID', 'Employee Name', 'Q No.', 'Question', 'Type', 'Difficulty', 'Skill', 'Employee Answer', 'Correct Answer', 'Result', 'Marks']);
    expect(q.length).toBe(1 + 6 * 25);
    expect(new Set(q.slice(1).map(r => r[9]))).toEqual(new Set(['Correct', 'Wrong', 'Not answered']));
  });

  it('individual workbook: Summary, Skills, Question Review', () => {
    const ind = buildIndividualWorkbook({ row: fx.rows[0] });
    expect(XLSX.read(ind, { type: 'buffer' }).SheetNames).toEqual(['Summary', 'Skills', 'Question Review']);
    const summary = sheetRows(ind, 'Summary');
    expect(summary.find(r => r[0] === 'Employee ID')[1]).toBe('EMP1001');
    expect(summary.find(r => r[0] === 'Completed On')[1]).toEqual(expect.any(Number));
  });

  it('all-reports workbook and table workbook are valid', () => {
    const all = buildAllReportsWorkbook({ rows: fx.rows.slice(0, 6), summary: { ...fx.summary, multi: {} } });
    expect(XLSX.read(all, { type: 'buffer' }).SheetNames).toEqual(['Summary', 'Results']);
    const t = buildTableWorkbook({ headers: ['A', 'B'], rows: [['x', 1], [undefined, null]] });
    const rows = sheetRows(t, 'Reports');
    expect(rows[1]).toEqual(['x', 1]);
    expect(rows[2]).toEqual(['—', '—']);
  });
});

async function pageTexts(buffer) {
  const pages = [];
  const res = await pdfParse(buffer, { pagerender: async (p) => { const t = await p.getTextContent(); const s = t.items.map(i => i.str).join(' '); pages.push(s); return s; } });
  return { pages, count: res.numpages };
}

describe('PDF reports', () => {
  it('pdfSafe replaces unsupported glyphs', () => {
    expect(pdfSafe('Café — हिंदी')).toBe('Café — ?????');
  });

  it('individual report: no blank page, last page has content, no junk text', async () => {
    const { buffer, meta } = await renderIndividualPdf({ row: fx.rows[3], now: fx.now });
    expect(buffer.slice(0, 5).toString()).toBe('%PDF-');
    expect(meta.pageCount).toBeGreaterThan(1);
    meta.pageEnd.forEach(y => expect(y).toBeGreaterThan(meta.top + 40));
    meta.pageEnd.slice(0, -1).forEach(y => expect(meta.limit - y).toBeLessThanOrEqual(50));
    const { pages, count } = await pageTexts(buffer);
    expect(count).toBe(meta.pageCount);
    pages.forEach(p => expect(p.length).toBeGreaterThan(150));
    pages.forEach(p => expect(p).not.toMatch(BAD));
    expect(pages[0]).toContain('At a glance');
    expect(pages[pages.length - 1]).toMatch(/Page \d+ of \d+/);
    expect(pages.join(' ')).toContain(`Page ${count} of ${count}`);
  });

  it('pages are filled: every page except the last ends close to the bottom margin', async () => {
    const row = { ...fx.rows[0], questions: fakeBreakdown(60, 40).map((b, i) => ({ no: i + 1, question: b.question, type: 'Multiple choice', difficulty: 'Easy', skill: b.skillArea, userAnswer: 'B) x', correctAnswer: 'B) x', result: i % 4 ? 'Correct' : 'Wrong', marks: 1, explanation: b.explanation })) };
    const { meta } = await renderIndividualPdf({ row, now: fx.now });
    expect(meta.pageCount).toBeGreaterThan(4);
    meta.pageEnd.slice(0, -1).forEach(y => expect(meta.limit - y).toBeLessThanOrEqual(50));
  });

  it('individual report for someone who has not completed is a single short page without blank pages', async () => {
    const { buffer, meta } = await renderIndividualPdf({ row: fx.rows[8], now: fx.now });
    expect(meta.pageCount).toBe(1);
    const { pages } = await pageTexts(buffer);
    expect(pages[0]).toContain('not completed');
    expect(pages[0]).not.toMatch(BAD);
  });

  it('consolidated report has the five sections and no blank page', async () => {
    const { buffer, meta } = await renderConsolidatedPdf({ rows: fx.rows, summary: fx.summary, now: fx.now });
    meta.pageEnd.forEach(y => expect(y).toBeGreaterThan(meta.top + 40));
    meta.pageEnd.slice(0, -1).forEach(y => expect(meta.limit - y).toBeLessThanOrEqual(50));
    const { pages } = await pageTexts(buffer);
    const all = pages.join(' ');
    for (const s of ['Overview', 'Results by employee', 'Skill performance', 'Needs follow-up']) expect(all).toContain(s);
    expect(all).not.toMatch(BAD);
    expect(all).toContain('EMP1012');
  });

  it('consolidated report copes with 300 employees and an empty roster', async () => {
    const many = Array.from({ length: 300 }, (_, i) => ({ ...fx.rows[i % 12], employeeId: `E${i}` }));
    const big = await renderConsolidatedPdf({ rows: many, summary: { ...fx.summary, assigned: 300 }, now: fx.now });
    expect(big.meta.pageCount).toBeGreaterThan(5);
    big.meta.pageEnd.slice(0, -1).forEach(y => expect(big.meta.limit - y).toBeLessThanOrEqual(50));
    big.meta.pageEnd.forEach(y => expect(y).toBeGreaterThan(big.meta.top + 40));
    const empty = await renderConsolidatedPdf({ rows: [], summary: { ...fx.summary, assigned: 0, completed: 0, notCompleted: 0, grades: { A: 0, B: 0, C: 0 }, jobRoles: [] }, now: fx.now });
    expect(empty.meta.pageCount).toBe(1);
  });

  it('generic table PDF works with wide tables', async () => {
    const headers = Array.from({ length: 14 }, (_, i) => `Col ${i + 1}`);
    const buf = await buildTablePdf({ title: 'Training Reports', metaLine: 'x', headers, rows: [headers.map((_, i) => `v${i}`), headers.map(() => undefined)] });
    expect(buf.length).toBeGreaterThan(1000);
  });
});

describe('Word reports', () => {
  const xmlOf = (buf) => new AdmZip(buf).readAsText('word/document.xml');
  const bodyParagraphs = (xml) => (xml.replace(/<w:tbl>[\s\S]*?<\/w:tbl>/g, '').match(/<w:p[ >][\s\S]*?<\/w:p>/g) || []);

  it('individual report: valid, no empty spacer paragraphs, no junk', async () => {
    const buf = await buildIndividualDocx({ row: fx.rows[0], now: fx.now });
    expect(buf.length).toBeGreaterThan(5000);
    const xml = xmlOf(buf);
    expect(xml).not.toMatch(BAD);
    expect(bodyParagraphs(xml).filter(p => !/<w:t[ >]/.test(p))).toHaveLength(0);
    expect(xml).toContain('w:keepNext');
    expect(xml).toContain('w:cantSplit');
    expect(xml).toContain('w:tblHeader');
    const footer = new AdmZip(buf).readAsText('word/footer1.xml');
    expect(footer).toContain('PAGE');
    expect(footer).toContain('NUMPAGES');
  });

  it('consolidated report: valid and complete', async () => {
    const buf = await buildConsolidatedDocx({ rows: fx.rows, summary: fx.summary, now: fx.now });
    const xml = xmlOf(buf);
    for (const s of ['Overview', 'Results by employee', 'Skill performance', 'Needs follow-up']) expect(xml).toContain(s);
    expect(xml).not.toMatch(BAD);
    expect(bodyParagraphs(xml).filter(p => !/<w:t[ >]/.test(p))).toHaveLength(0);
    expect(xml).not.toContain('w:br w:type="page"');
    expect(xml).not.toContain('pageBreakBefore');
  });

  it('not-completed individual and generic table documents build', async () => {
    expect((await buildIndividualDocx({ row: fx.rows[8], now: fx.now })).length).toBeGreaterThan(3000);
    expect((await buildTableDocx({ title: 'T', metaLine: 'm', headers: ['A', 'B'], rows: [['1', undefined]] })).length).toBeGreaterThan(3000);
  });
});
