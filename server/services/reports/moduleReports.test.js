import { describe, it, expect } from 'vitest';
import XLSX from 'xlsx';
import AdmZip from 'adm-zip';
import pdfParse from 'pdf-parse/lib/pdf-parse.js';
import { buildEngagement, filterRows, sortRows, summarizeRows, fmtSeconds, toJson } from './moduleReportData.js';
import { buildModuleWorkbook, buildConsolidatedModuleWorkbook, EMPLOYEE_HEADERS, QUESTION_HEADERS, DAY_HEADERS, MAX_QUESTION_ROWS } from './moduleXlsx.js';
import { renderModulePdf, renderConsolidatedModulePdf } from './modulePdf.js';
import { buildModuleDocx, buildConsolidatedModuleDocx } from './moduleDocx.js';
import { applyEngagementEvent, mergeProgressData, checkProgressData } from '../moduleEngagement.js';
import { getRecencyScore, isMoreRecent } from './moduleReportLoader.js';
import { FAKE_MODULE, FAKE_USERS, FAKE_MANAGER, fakeCompleted, fakeLegacyInProgress, fakeNoData, fakeMany, fakeResults } from './moduleReportFixtures.js';

const BAD = /undefined|\bnull\b|NaN|Invalid Date/;
const NOW = new Date('2026-10-07T10:30:00.000Z');
const mk = (a, light = false) => buildEngagement({ assignment: a, module: FAKE_MODULE, user: FAKE_USERS[a.assigned_to_user], manager: FAKE_MANAGER, light, now: NOW });

const completed = mk(fakeCompleted());
const legacy = mk(fakeLegacyInProgress());
const nodata = mk(fakeNoData());
const many = mk(fakeMany(50));
const allFull = [completed, legacy, nodata, many];
const allLight = [fakeCompleted(), fakeLegacyInProgress(), fakeNoData(), fakeMany(50)].map(a => mk(a, true));

const sheetRows = (buf, name) => XLSX.utils.sheet_to_json(XLSX.read(buf, { type: 'buffer' }).Sheets[name], { header: 1, raw: true, defval: '' });
const allCellText = (buf) => {
  const wb = XLSX.read(buf, { type: 'buffer' });
  return wb.SheetNames.flatMap(n => XLSX.utils.sheet_to_json(wb.Sheets[n], { header: 1, raw: false, defval: '' }).flat()).join('\n');
};

describe('engagement event merge', () => {
  it('adds time, sections and attempts without losing earlier data', () => {
    let pd = applyEngagementEvent({}, { sessionIndex: 0, startedAt: '2026-10-02T06:00:00Z', addSeconds: 60, opened: true, sectionsViewed: [{ title: 'A', type: 'prose' }] });
    pd = applyEngagementEvent(pd, { sessionIndex: 0, addSeconds: 30, sectionsViewed: [{ title: 'A', type: 'prose' }, { title: 'B' }], attempt: { submittedAt: '2026-10-02T06:10:00Z', results: fakeResults(3, 2) } });
    pd = applyEngagementEvent(pd, { sessionIndex: 0, attempt: { submittedAt: '2026-10-02T06:30:00Z', results: fakeResults(3, 3) } });
    const s = pd.engagement.sessions[0];
    expect(s.timeSpentSeconds).toBe(90);
    expect(s.sectionsViewed).toHaveLength(2);
    expect(s.attempts.map(a => a.attempt)).toEqual([1, 2]);
    expect(s.completedAt).toBe('2026-10-02T06:10:00.000Z');
  });
  it('ignores bad events and caps attempts and time', () => {
    expect(applyEngagementEvent({ a: 1 }, { sessionIndex: -1 })).toEqual({ a: 1 });
    expect(applyEngagementEvent({}, 'x')).toEqual({});
    let pd = {};
    for (let i = 0; i < 9; i++) pd = applyEngagementEvent(pd, { sessionIndex: 1, addSeconds: 999999, attempt: { results: fakeResults(2, 1) } });
    expect(pd.engagement.sessions[1].attempts.length).toBe(5);
    expect(pd.engagement.sessions[1].timeSpentSeconds).toBe(9 * 4 * 3600);
  });
  it('mergeProgressData keeps stored reports and the server-owned engagement', () => {
    const existing = { sessionReports: { 0: { score: 1 } }, engagement: { v: 1, sessions: { 0: { x: 1 } } }, other: 1 };
    const merged = mergeProgressData(existing, { sessionReports: { 1: { score: 2 } }, engagement: { evil: true } });
    expect(Object.keys(merged.sessionReports)).toEqual(['0', '1']);
    expect(merged.engagement.sessions[0].x).toBe(1);
    expect(merged.other).toBe(1);
  });
  it('checkProgressData rejects non-objects and oversize payloads', () => {
    expect(checkProgressData(undefined).ok).toBe(true);
    expect(checkProgressData([]).ok).toBe(false);
    expect(checkProgressData({ blob: 'x'.repeat(2.2 * 1024 * 1024) }).ok).toBe(false);
  });
});

describe('buildEngagement', () => {
  it('completed module: days, attempts, totals, rating, questions', () => {
    expect(completed.status).toBe('Completed');
    expect(completed.daysTotal).toBe(3);
    expect(completed.daysCompleted).toBe(3);
    expect(completed.days[1].attempts).toBe(2);
    // latest attempts: 9/10, 8/10, 10/10
    expect(completed.questionsTotal).toBe(30);
    expect(completed.correct).toBe(27);
    expect(completed.scorePct).toBe(90);
    expect(completed.rating).toBe('Expert');
    expect(completed.timeSpentSec).toBe(900 * 3 + 300);
    expect(completed.questions.length).toBe(40);
    expect(completed.questions.filter(q => q.isLatest).length).toBe(30);
    expect(completed.days[0].sections.map(s => s.title)).toContain('Why escalations happen');
    expect(completed.hasDetail).toBe(true);
    expect(completed.skills.length).toBeGreaterThan(0);
    expect(completed.timeline.length).toBeGreaterThan(3);
    // MCQ letter resolved to option text
    expect(completed.questions[0].correctAnswer).toContain('Apologise');
  });
  it('skipped answers are counted separately', () => {
    const day1 = completed.questions.filter(q => q.day === 2 && q.attempt === 1);
    expect(day1.some(q => q.result === 'Not answered')).toBe(true);
  });
  it('legacy in-progress uses sessionReports and dashes for the rest', () => {
    expect(legacy.status).toBe('In progress');
    expect(legacy.daysCompleted).toBe(1);
    expect(legacy.questionsTotal).toBe(10);
    expect(legacy.scorePct).toBe(70);
    expect(legacy.rating).toBe('Basic');
    expect(legacy.timeSpentSec).toBeNull();
    expect(legacy.days[0].startedAt).toBeNull();
    expect(legacy.questions.length).toBe(10);
  });
  it('no-data completed assignment still produces a safe record', () => {
    expect(nodata.status).toBe('Completed');
    expect(nodata.scorePct).toBeNull();
    expect(nodata.rating).toBe('');
    expect(nodata.hasDetail).toBe(false);
    expect(nodata.questions).toEqual([]);
    expect(JSON.stringify(toJson(nodata))).not.toMatch(/undefined|NaN/);
  });
  it('rating thresholds follow the shared scale', () => {
    const r = (c) => buildEngagement({ assignment: { ...fakeLegacyInProgress(), progress_data: { sessionReports: { 0: { total: 100, correct: c, score: c, completedAt: '2026-10-01T00:00:00Z', results: fakeResults(100, c) } } } }, module: FAKE_MODULE, user: FAKE_USERS.u2, light: true }).rating;
    expect([r(90), r(89), r(80), r(79), r(70), r(69)]).toEqual(['Expert', 'Intermediate', 'Intermediate', 'Basic', 'Basic', 'No Rating']);
  });
});

describe('list helpers', () => {
  it('default filter is completed and others work', () => {
    expect(filterRows(allLight, {}).map(r => r.assignmentId).sort()).toEqual(['assign_done', 'assign_nodata']);
    expect(filterRows(allLight, { status: 'all' }).length).toBe(4);
    expect(filterRows(allLight, { status: 'in_progress' }).length).toBe(2);
    expect(filterRows(allLight, { status: 'all', q: 'diya' }).length).toBe(1);
    expect(filterRows(allLight, { status: 'all', jobRole: 'Analyst' }).length).toBe(1);
    expect(filterRows(allLight, { status: 'all', employeeId: 'emp003' }).length).toBe(1);
    expect(filterRows(allLight, { status: 'all', from: '2026-10-02', to: '2026-10-02' }).map(r => r.assignmentId)).toEqual(['assign_done']);
  });
  it('summary and sort are safe', () => {
    const s = summarizeRows(allLight);
    expect(s.records).toBe(4);
    expect(s.ratings.Expert).toBe(1);
    expect(sortRows(allLight)[0].assignmentId).toBe('assign_done');
    expect(fmtSeconds(null)).toBe('—');
    expect(fmtSeconds(75)).toBe('1 min');
  });
});

describe('Excel exports', () => {
  it('single workbook has the expected sheets and columns', () => {
    const buf = buildModuleWorkbook({ record: completed, now: NOW });
    const wb = XLSX.read(buf, { type: 'buffer' });
    expect(wb.SheetNames).toEqual(['Overview', 'Days', 'Questions', 'Skills']);
    expect(sheetRows(buf, 'Days')[0]).toEqual(DAY_HEADERS);
    expect(sheetRows(buf, 'Days').length).toBe(4);
    const q = sheetRows(buf, 'Questions');
    expect(q[0]).toEqual(QUESTION_HEADERS);
    expect(q.length).toBe(41);
    expect(q[1][0]).toBe('EMP001');
    expect(q.map(r => r[9])).toContain('Wrong');
    expect(allCellText(buf)).not.toMatch(BAD);
  });
  it('widths are compact and the question sheet is capped', () => {
    const buf = buildModuleWorkbook({ record: many, now: NOW });
    const xml = new AdmZip(buf).readAsText('xl/worksheets/sheet3.xml');
    const widths = [...xml.matchAll(/<col [^>]*width="([0-9.]+)"/g)].map(m => Number(m[1]));
    expect(widths.length).toBeGreaterThan(5);
    expect(Math.max(...widths)).toBeLessThanOrEqual(41);
    expect(xml).toContain('customHeight="1"');
    const big = { ...completed, questions: Array.from({ length: MAX_QUESTION_ROWS + 50 }, (_, i) => ({ ...completed.questions[0], no: i + 1 })) };
    const rows = sheetRows(buildModuleWorkbook({ record: big, now: NOW }), 'Questions');
    expect(rows.length).toBe(MAX_QUESTION_ROWS + 1);
  });
  it('legacy / no-data workbooks have no junk strings', () => {
    for (const rec of [legacy, nodata]) {
      const buf = buildModuleWorkbook({ record: rec, now: NOW });
      expect(allCellText(buf)).not.toMatch(BAD);
    }
  });
  it('consolidated workbook lists every employee-module and questions', () => {
    const summary = summarizeRows(allLight);
    const buf = buildConsolidatedModuleWorkbook({ rows: allLight, records: allFull, summary, now: NOW, filtersText: 'status: all' });
    const wb = XLSX.read(buf, { type: 'buffer' });
    expect(wb.SheetNames).toEqual(['Overview', 'Employees', 'Questions']);
    const e = sheetRows(buf, 'Employees');
    expect(e[0]).toEqual(EMPLOYEE_HEADERS);
    expect(e.length).toBe(5);
    expect(sheetRows(buf, 'Questions').length).toBe(1 + 40 + 10 + 0 + 50);
    expect(allCellText(buf)).not.toMatch(BAD);
    const zip = new AdmZip(buf);
    expect(zip.readAsText('xl/styles.xml')).toContain('FFDCFCE7');
    expect(zip.readAsText('xl/worksheets/sheet3.xml')).toContain('ySplit="1"');
  });
});

describe('PDF exports', () => {
  it('single report renders, has content, no junk, no blank pages', async () => {
    for (const rec of allFull) {
      const { buffer, meta } = await renderModulePdf({ record: rec, now: NOW });
      expect(buffer.length).toBeGreaterThan(2000);
      const parsed = await pdfParse(buffer);
      expect(parsed.text).toContain('Module Engagement Report');
      expect(parsed.text).not.toMatch(BAD);
      meta.pageEnd.forEach((end) => expect(end).toBeGreaterThan(meta.top + 10));
    }
  });
  it('full report includes question review and day summary', async () => {
    const { buffer } = await renderModulePdf({ record: completed, now: NOW });
    const t = (await pdfParse(buffer)).text;
    expect(t).toContain('Question review');
    expect(t).toContain('Day-wise summary');
    expect(t).toContain('Expert');
  });
  it('consolidated renders', async () => {
    const { buffer, meta } = await renderConsolidatedModulePdf({ rows: allLight, summary: summarizeRows(allLight), now: NOW });
    const t = (await pdfParse(buffer)).text;
    expect(t).toContain('Module Completion Report');
    expect(t).not.toMatch(BAD);
    meta.pageEnd.forEach((end) => expect(end).toBeGreaterThan(meta.top + 10));
  });
});

describe('Word exports', () => {
  const xmlOf = (buf) => new AdmZip(buf).readAsText('word/document.xml');
  it('single report has no junk and no empty spacer paragraphs', async () => {
    for (const rec of allFull) {
      const buf = await buildModuleDocx({ record: rec, now: NOW });
      expect(buf.length).toBeGreaterThan(3000);
      const xml = xmlOf(buf);
      expect(xml.replace(/<[^>]+>/g, ' ')).not.toMatch(BAD);
      expect(xml).not.toMatch(/<w:p>(?:<w:pPr>(?:(?!<\/w:pPr>).)*<\/w:pPr>)?<\/w:p>/);
    }
  });
  it('consolidated renders', async () => {
    const buf = await buildConsolidatedModuleDocx({ rows: allLight, summary: summarizeRows(allLight), now: NOW });
    expect(xmlOf(buf)).toContain('Module Completion Report');
  });
});

describe('employee details & deduplication', () => {
  it('extracts employeeId and all personal details with fallbacks', () => {
    const userWithAll = {
      userId: 'usr-123',
      employeeId: 'EMP-999',
      name: 'John Doe',
      email: 'john@example.com',
      phone: '+1 555-0199',
      jobRole: 'Software Engineer',
      department: 'Engineering',
      managerId: 'mgr-456',
      companyName: 'Acme Corp',
    };
    const manager = { userId: 'mgr-456', name: 'Jane Boss', email: 'jane@example.com' };
    const comp = { name: 'Acme Corp' };
    const rec = buildEngagement({
      assignment: { id: 'asgn-1', assigned_to_user: 'usr-123', status: 'completed' },
      user: userWithAll,
      manager,
      company: comp,
      light: true,
      now: NOW,
    });
    expect(rec.employeeId).toBe('EMP-999');
    expect(rec.name).toBe('John Doe');
    expect(rec.email).toBe('john@example.com');
    expect(rec.phone).toBe('+1 555-0199');
    expect(rec.jobRole).toBe('Software Engineer');
    expect(rec.department).toBe('Engineering');
    expect(rec.managerName).toBe('Jane Boss');
    expect(rec.managerId).toBe('mgr-456');
    expect(rec.companyName).toBe('Acme Corp');
  });

  it('falls back gracefully when user fields vary', () => {
    const userAlt = {
      id: 'usr-alt',
      employee_id: 'EMP-ALT',
      phone_number: '1234567890',
      job_role: 'Designer',
    };
    const rec = buildEngagement({
      assignment: { id: 'asgn-2', assigned_to_user: 'usr-alt', status: 'in_progress' },
      user: userAlt,
      light: true,
      now: NOW,
    });
    expect(rec.employeeId).toBe('EMP-ALT');
    expect(rec.phone).toBe('1234567890');
    expect(rec.jobRole).toBe('Designer');
  });

  it('isMoreRecent correctly picks the latest active/logout phase over older phases', () => {
    // 1. Assigned phase (initial assignment, no progress)
    const assignedItem = {
      assignment: { id: 'a1', assigned_to_user: 'u1', status: 'assigned', assigned_at: '2026-10-01T08:00:00Z' },
      row: { status: 'Not started', progressPct: 0, assignedAt: '2026-10-01T08:00:00Z' },
    };

    // 2. In progress phase (employee logged in, started, did some work, logged out at 5pm)
    const inProgressItem = {
      assignment: { id: 'a2', assigned_to_user: 'u1', status: 'in_progress', updated_at: '2026-10-02T17:00:00Z', progress: 50 },
      row: { status: 'In progress', progressPct: 50, startedAt: '2026-10-02T09:00:00Z', updated_at: '2026-10-02T17:00:00Z' },
    };

    // 3. Completed phase (employee completed the module on day 3)
    const completedItem = {
      assignment: { id: 'a3', assigned_to_user: 'u1', status: 'completed', completed_at: '2026-10-03T14:00:00Z', progress: 100 },
      row: { status: 'Completed', progressPct: 100, completedAt: '2026-10-03T14:00:00Z' },
    };

    // In progress is more recent than initial assigned
    expect(isMoreRecent(inProgressItem, assignedItem)).toBe(true);
    expect(isMoreRecent(assignedItem, inProgressItem)).toBe(false);

    // Completed is more recent than in progress
    expect(isMoreRecent(completedItem, inProgressItem)).toBe(true);
    expect(isMoreRecent(inProgressItem, completedItem)).toBe(false);
  });
});
