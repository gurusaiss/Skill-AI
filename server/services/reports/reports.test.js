import { describe, it, expect } from 'vitest';
import XLSX from 'xlsx';
import AdmZip from 'adm-zip';
import pdfParse from 'pdf-parse/lib/pdf-parse.js';
import {
  safe, fmtDate, fmtDuration, fmtPct, excelSerial, truncate, buildResultRow, computeStatus, STATUS, timeTakenSeconds, pickReport,
} from './reportData.js';
import { RESULTS_COLUMNS, QUESTION_COLUMNS, buildAssessmentWorkbook, buildIndividualWorkbook, buildAllReportsWorkbook, buildTableWorkbook } from './xlsxReports.js';
import { renderConsolidatedPdf, renderIndividualPdf, buildTablePdf, pdfSafe } from './pdfReports.js';
import { buildConsolidatedDocx, buildIndividualDocx, buildTableDocx } from './docxReports.js';
import { fakeRows, fakeAssessment, fakeBreakdown } from './testFixtures.js';

const EXPECTED_COLUMNS = ['Employee ID', 'Name', 'Job Role', 'Department', 'Manager', 'Status', 'Assigned', 'Due', 'Completed', 'Time (min)', 'Correct', 'Total', 'Score %', 'Rating'];
const MAX_WIDTHS = { 'Employee ID': 12, Name: 22, 'Job Role': 22, Department: 16, Manager: 20, Status: 13, Assigned: 16, Due: 16, Completed: 16, 'Time (min)': 10, Correct: 10, Total: 10, 'Score %': 10, Rating: 14 };
const sheetXml = (buf, n) => new AdmZip(buf).readAsText(`xl/worksheets/sheet${n}.xml`);

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
  it('ratings use the Expert / Intermediate / Basic / No Rating scale on the exact score', () => {
    expect(fx.rows[0].rating).toBe('Expert'); // 24/25 = 96
    expect(fx.rows[1].rating).toBe('Intermediate'); // 22/25 = 88
    expect(fx.rows[2].rating).toBe('Basic'); // 18/25 = 72
    expect(fx.rows[3].rating).toBe('No Rating'); // 12/25 = 48
    expect(fx.rows[4].rating).toBe('Expert'); // 25/25
    expect(fx.rows[5].rating).toBe('No Rating'); // 9/25 = 36
    expect(fx.rows[6].rating).toBe(''); // not completed
    expect(fx.rows[0].readiness).toBe('Ready');
    expect(fx.rows[2].readiness).toBe('Needs development');
    for (const r of fx.rows) { expect(r).not.toHaveProperty('grade'); expect(r).not.toHaveProperty('passed'); expect(r).not.toHaveProperty('result'); }
  });
  it('summary has a rating distribution and no pass / fail / grade fields', () => {
    expect(fx.summary.ratings.map(x => x.label)).toEqual(['Expert', 'Intermediate', 'Basic', 'No Rating']);
    expect(fx.summary.ratings.map(x => x.count)).toEqual([2, 1, 1, 2]);
    expect(fx.summary.topSharePct).toBe(50);
    for (const k of ['passed', 'failed', 'passPct', 'passMark', 'grades']) expect(fx.summary).not.toHaveProperty(k);
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
    expect(row.rating).toBe('Intermediate'); // 22 of 25 = 88
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
  const zip = new AdmZip(buf);
  const resultsXml = sheetXml(buf, 2);

  it('has Overview, Results, Details, Skills, Question Review in that order', () => {
    expect(XLSX.read(buf, { type: 'buffer' }).SheetNames).toEqual(['Overview', 'Results', 'Details', 'Skills', 'Question Review']);
  });

  it('Results has exactly the essential narrow columns, within the width limits', () => {
    const rows = sheetRows(buf, 'Results');
    expect(rows[0]).toEqual(EXPECTED_COLUMNS);
    expect(RESULTS_COLUMNS.map(c => c.header)).toEqual(EXPECTED_COLUMNS);
    expect(rows).toHaveLength(13); // header + one row per assigned employee
    RESULTS_COLUMNS.forEach(c => expect(c.w).toBeLessThanOrEqual(MAX_WIDTHS[c.header]));
    const widths = [...resultsXml.matchAll(/<col [^>]*width="([\d.]+)"/g)].map(m => Number(m[1]));
    expect(widths).toEqual(RESULTS_COLUMNS.map(c => c.w));
    expect(widths.reduce((x, y) => x + y, 0)).toBeLessThan(215); // fits a 1440 px screen
  });

  it('Results: frozen header + 2 columns, autofilter, one row height, print setup', () => {
    expect(resultsXml).toMatch(/<pane xSplit="2" ySplit="1" topLeftCell="C2" activePane="bottomRight" state="frozen"\/>/);
    expect(resultsXml).toContain('<autoFilter ref="A1:N13"');
    expect(resultsXml).toContain('orientation="landscape"');
    expect(resultsXml).toContain('fitToWidth="1"');
    expect(resultsXml).toContain('fitToPage="1"');
    expect(zip.readAsText('xl/workbook.xml')).toContain('_xlnm.Print_Titles" localSheetId="1">\'Results\'!$1:$1');
    const heights = new Set([...resultsXml.matchAll(/<row r="(\d+)"[^>]* ht="([\d.]+)"/g)].filter(m => Number(m[1]) > 1).map(m => m[2]));
    expect([...heights]).toEqual(['19']);
  });

  it('nothing wraps on any sheet and merged cells exist only on Overview', () => {
    expect(zip.readAsText('xl/styles.xml')).not.toContain('wrapText');
    ['Overview', 'Results', 'Details', 'Skills', 'Question Review'].forEach((n, i) => {
      const merges = (sheetXml(buf, i + 1).match(/<mergeCell /g) || []).length;
      if (n === 'Overview') expect(merges).toBeGreaterThan(3); else expect(merges).toBe(0);
    });
  });

  it('Rating and Status cells are colour filled; palette is the agreed one', () => {
    const styles = zip.readAsText('xl/styles.xml');
    for (const rgb of ['FF4338CA', 'FFF8FAFC', 'FFDCFCE7', 'FFDBEAFE', 'FFFEF3C7', 'FFFEE2E2', 'FF166534', 'FF1E40AF', 'FF92400E', 'FF991B1B']) expect(styles).toContain(rgb);
    expect(styles).toContain('Calibri');
    const fills = styles.match(/<fills[\s\S]*?<\/fills>/)[0].match(/<fill>[\s\S]*?<\/fill>/g);
    const styleOf = (ref) => Number(new RegExp(`<c r="${ref}" s="(\\d+)"`).exec(resultsXml)[1]);
    const fillFor = (ref) => { const id = styleOf(ref); const x = (styles.match(/<cellXfs[\s\S]*?<\/cellXfs>/)[0].match(/<xf [^>]*?(?:\/>|>[\s\S]*?<\/xf>)/g))[id]; return fills[Number(/fillId="(\d+)"/.exec(x)[1])]; };
    expect(fillFor('N2')).toContain('FFDCFCE7'); // Expert
    expect(fillFor('N3')).toContain('FFDBEAFE'); // Intermediate
    expect(fillFor('N4')).toContain('FFFEF3C7'); // Basic
    expect(fillFor('N5')).toContain('FFFEE2E2'); // No Rating
    expect(fillFor('F2')).toContain('FFDCFCE7'); // Completed
    expect(fillFor('F8')).toContain('FFDBEAFE'); // In progress
  });

  it('completed row carries real typed values in every column', () => {
    const rows = sheetRows(buf, 'Results');
    const h = rows[0];
    const done = rows[1];
    const col = (n) => done[h.indexOf(n)];
    expect(col('Employee ID')).toBe('EMP1001');
    expect(col('Manager')).toBe('Neha Verma');
    expect(typeof col('Assigned')).toBe('number');
    expect(typeof col('Due')).toBe('number');
    expect(typeof col('Completed')).toBe('number');
    expect(col('Status')).toBe('Completed');
    expect(col('Time (min)')).toBe(28);
    expect(col('Correct')).toBe(24);
    expect(col('Total')).toBe(25);
    expect(col('Score %')).toBe(96);
    expect(col('Rating')).toBe('Expert');
    done.forEach(v => expect(v).not.toBe(''));
  });

  it('not-completed rows are present with dashes, never blanks or junk', () => {
    const rows = sheetRows(buf, 'Results');
    const h = rows[0];
    const notStarted = rows.find(r => r[h.indexOf('Status')] === 'Not started');
    const overdue = rows.find(r => r[h.indexOf('Status')] === 'Overdue');
    expect(notStarted[h.indexOf('Completed')]).toBe('—');
    expect(notStarted[h.indexOf('Score %')]).toBe('—');
    expect(typeof notStarted[h.indexOf('Assigned')]).toBe('number');
    expect(typeof notStarted[h.indexOf('Due')]).toBe('number');
    expect(overdue[h.indexOf('Rating')]).toBe('—');
    rows.flat().forEach(v => expect(v).not.toBe(''));
  });

  it('no sheet contains undefined / null / NaN / Invalid Date, or any grade / pass / fail label', () => {
    const wb = XLSX.read(buf, { type: 'buffer' });
    for (const name of wb.SheetNames) {
      for (const row of XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, raw: true, defval: '' })) {
        for (const v of row) {
          if (typeof v !== 'string') continue;
          expect(v).not.toMatch(BAD);
          expect(v).not.toMatch(/^(Grade|Pass|Fail|Passed|Failed|Pass %|Pass Mark.*|Performance Level|Readiness Level)$/);
        }
      }
    }
  });

  it('Overview: KPIs, rating distribution and assessment facts', () => {
    const o = sheetRows(buf, 'Overview');
    const flat = o.flat();
    expect(o[0][0]).toBe('Customer Support Skills Assessment');
    for (const l of ['Assigned', 'Completed', 'In progress', 'Not started', 'Overdue', 'Completion %', 'Average score %', 'Highest score %', 'Lowest score %', 'Assessment type', 'Job role(s)', 'Time limit (min)', 'Created on']) expect(flat).toContain(l);
    const dist = ['Expert', 'Intermediate', 'Basic', 'No Rating'].map(l => o.find(r => r[0] === l));
    expect(dist.map(r => r[1])).toEqual([2, 1, 1, 2]);
    expect(dist.map(r => r[2])).toEqual([33.3, 16.7, 16.7, 33.3]);
    expect(flat).not.toContain('Pass mark %');
  });

  it('Details keeps the long fields on a no-wrap sheet', () => {
    const d = sheetRows(buf, 'Details');
    for (const h of ['Email', 'Phone', 'Group', 'Manager ID', 'Assessment Type', 'Window Start', 'Started At', 'Attempt No.', 'Reminders Sent', 'Last Reminder', 'Skill Scores', 'Strengths', 'Needs Improvement', 'Missing Skills', 'Recommendations']) expect(d[0]).toContain(h);
    expect(d[1][d[0].indexOf('Skill Scores')]).toContain('Communication 100%');
    const widths = [...sheetXml(buf, 3).matchAll(/<col [^>]*width="([\d.]+)"/g)].map(m => Number(m[1]));
    ['Skill Scores', 'Strengths', 'Needs Improvement', 'Missing Skills', 'Recommendations'].forEach(h => expect(widths[d[0].indexOf(h)]).toBeLessThanOrEqual(45));
  });

  it('Skills is an employees x skills matrix with an Average column and an All employees row', () => {
    const k = sheetRows(buf, 'Skills');
    expect(k[0].slice(0, 2)).toEqual(['Employee ID', 'Name']);
    expect(k[0]).toContain('Communication');
    expect(k[0][k[0].length - 1]).toBe('Average %');
    expect(k.length).toBe(1 + 6 + 1);
    expect(k[k.length - 1][0]).toBe('All employees');
    const xml = sheetXml(buf, 4);
    expect(xml).toContain('<autoFilter');
    expect(xml).toMatch(/state="frozen"/);
    expect(zip.readAsText('xl/styles.xml')).toContain('textRotation="90"');
  });

  it('Question Review has the agreed columns, widths and filters', () => {
    const q = sheetRows(buf, 'Question Review');
    expect(q[0]).toEqual(['Employee ID', 'Name', 'Q No.', 'Skill', 'Difficulty', 'Type', 'Question', 'Employee Answer', 'Correct Answer', 'Result', 'Marks']);
    expect(q.length).toBe(1 + 6 * 25);
    expect(new Set(q.slice(1).map(r => r[9]))).toEqual(new Set(['Correct', 'Wrong', 'Not answered']));
    const w = Object.fromEntries(QUESTION_COLUMNS.map(c => [c.header, c.w]));
    expect(w.Question).toBe(60);
    expect(w['Employee Answer']).toBe(35);
    expect(w['Correct Answer']).toBe(35);
    const xml = sheetXml(buf, 5);
    expect(xml).toContain('<autoFilter');
    expect(xml).toContain('state="frozen"');
  });

  it('individual workbook: Overview, Skills, Question Review', () => {
    const ind = buildIndividualWorkbook({ row: fx.rows[0] });
    expect(XLSX.read(ind, { type: 'buffer' }).SheetNames).toEqual(['Overview', 'Skills', 'Question Review']);
    const o = sheetRows(ind, 'Overview');
    expect(o.find(r => r[0] === 'Employee ID')[1]).toBe('EMP1001');
    expect(o.find(r => r[0] === 'Rating')[1]).toBe('Expert');
    expect(o.find(r => r[0] === 'Completed on')[1]).toEqual(expect.any(Number));
    expect(sheetRows(ind, 'Skills')[0]).toEqual(['Skill', 'Correct', 'Total', 'Score %', 'Rating']);
    const notDone = buildIndividualWorkbook({ row: fx.rows[8] });
    expect(sheetRows(notDone, 'Overview').flat().join('|')).not.toMatch(BAD);
  });

  it('all-reports workbook (Overview, Results with assessment, Details) and table workbook are valid', () => {
    const all = buildAllReportsWorkbook({ rows: fx.rows.slice(0, 6), summary: { ...fx.summary, multi: {} } });
    expect(XLSX.read(all, { type: 'buffer' }).SheetNames).toEqual(['Overview', 'Results', 'Details']);
    expect(sheetRows(all, 'Results')[0]).toContain('Assessment');
    const t = buildTableWorkbook({ headers: ['A', 'B'], rows: [['x', 1], [undefined, null]] });
    const rows = sheetRows(t, 'Reports');
    expect(rows[1]).toEqual(['x', 1]);
    expect(rows[2]).toEqual(['—', '—']);
  });
});

async function pageTexts(buffer) {
  // The bundled pdf.js (v1.10, from pdf-parse) intermittently throws "bad XRef entry" on the FIRST
  // parse of a small valid PDF and succeeds on the same bytes a moment later (reproduced with
  // byte-identical files), so a parse failure is retried before the test is allowed to fail.
  let lastError;
  for (let attempt = 0; attempt < 4; attempt++) {
    const pages = [];
    try {
      const res = await pdfParse(Buffer.from(buffer), { pagerender: async (p) => { const t = await p.getTextContent(); const s = t.items.map(i => i.str).join(' '); pages.push(s); return s; } });
      return { pages, count: res.numpages };
    } catch (e) { lastError = e; }
  }
  throw lastError;
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
    expect(pages[0]).toContain('Rating');
    expect(pages[0]).not.toMatch(/Grade|Pass mark|Performance level/);
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
    for (const s of ['Overview', 'Rating distribution', 'Results by employee', 'Skill performance', 'Needs follow-up']) expect(all).toContain(s);
    expect(all).not.toMatch(BAD);
    expect(all).not.toMatch(/Pass rate|Pass mark|Grade [ABC]|Failed|Passed/);
    for (const l of ['Expert', 'Intermediate', 'Basic', 'No Rating']) expect(all).toContain(l);
    expect(all).toContain('EMP1012');
  });

  it('consolidated report copes with 300 employees and an empty roster', async () => {
    const many = Array.from({ length: 300 }, (_, i) => ({ ...fx.rows[i % 12], employeeId: `E${i}` }));
    const big = await renderConsolidatedPdf({ rows: many, summary: { ...fx.summary, assigned: 300 }, now: fx.now });
    expect(big.meta.pageCount).toBeGreaterThan(5);
    big.meta.pageEnd.slice(0, -1).forEach(y => expect(big.meta.limit - y).toBeLessThanOrEqual(50));
    big.meta.pageEnd.forEach(y => expect(y).toBeGreaterThan(big.meta.top + 40));
    const empty = await renderConsolidatedPdf({ rows: [], summary: { ...fx.summary, assigned: 0, completed: 0, notCompleted: 0, ratings: [], ratingCounts: {}, jobRoles: [] }, now: fx.now });
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
    for (const s of ['Overview', 'Rating distribution', 'Results by employee', 'Skill performance', 'Needs follow-up']) expect(xml).toContain(s);
    expect(xml).not.toMatch(/Pass rate|Pass mark|Grade [ABC]|Failed|Passed/);
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
