/**
 * moduleDocx.js - Word documents for Reports > Modules.
 *
 * Same sections and wording as the module PDF. Rules: no empty spacer
 * paragraphs (spacing properties only), headings and the first lines of a
 * block keep-with-next, table header rows repeat, rows never split across
 * pages, footer carries the title and "Page X of Y".
 */
import {
  Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell, WidthType, BorderStyle, ShadingType,
  AlignmentType, Footer, Header, PageNumber, TableLayoutType, TabStopType, Tab, VerticalAlign,
} from 'docx';
import { DASH, safe, fmtDate, fmtPct, truncate, reportTimezone } from './reportData.js';
import { fmtSeconds } from './moduleReportData.js';

const COLOR = {
  accent: '4338CA', accentSoft: 'EEF2FF', ink: '1E293B', body: '334155', muted: '64748B', line: 'E2E8F0', zebra: 'F8FAFC', white: 'FFFFFF',
  green: '15803D', greenSoft: 'DCFCE7', red: 'B91C1C', redSoft: 'FEE2E2', grey: '475569', greySoft: 'E2E8F0', blue: '1D4ED8', amber: 'B45309',
};
const RATING_COLOR = { Expert: COLOR.green, Intermediate: COLOR.blue, Basic: COLOR.amber, 'No Rating': COLOR.red };
const FONT = 'Calibri';
const PAGE_W = 11906, PAGE_H = 16838, MARGIN = 850;
const CONTENT_W = PAGE_W - 2 * MARGIN;
const MAX_TEXT = 400;
const NONE = { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' };
const hair = (color = COLOR.line, size = 4) => ({ style: BorderStyle.SINGLE, size, color });

const run = (text, o = {}) => new TextRun({ text: String(text ?? ''), font: FONT, size: o.size ?? 19, bold: o.bold, color: o.color ?? COLOR.body, shading: o.shading });
const para = (children, o = {}) => new Paragraph({
  children: Array.isArray(children) ? children : [children],
  keepNext: o.keepNext, keepLines: o.keepLines ?? true, alignment: o.align,
  spacing: { before: o.before ?? 0, after: o.after ?? 60, line: o.line ?? 252 }, indent: o.indent, border: o.border,
});
const title1 = (text, sub) => [
  para(run(text, { size: 40, bold: true, color: COLOR.ink }), { after: 40, keepNext: true }),
  ...(sub ? [para(run(sub, { size: 21, color: COLOR.muted }), { after: 120, keepNext: true })] : []),
];
const section = (text) => new Paragraph({
  children: [run(text, { size: 27, bold: true, color: COLOR.accent })], keepNext: true, keepLines: true,
  spacing: { before: 260, after: 90 }, border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: COLOR.line, space: 2 } },
});
const subheading = (text) => para(run(text, { size: 22, bold: true, color: COLOR.ink }), { before: 120, after: 40, keepNext: true });
const clip = (s) => { const t = truncate(s, MAX_TEXT); return t.truncated ? `${t.text} (shortened)` : t.text; };

function cell(children, { width, fill, borders, margins } = {}) {
  return new TableCell({
    children: Array.isArray(children) ? children : [children],
    width: { size: width, type: WidthType.DXA },
    shading: fill ? { type: ShadingType.CLEAR, fill, color: 'auto' } : undefined,
    borders: borders ?? { top: NONE, left: NONE, right: NONE, bottom: hair() },
    margins: margins ?? { top: 45, bottom: 45, left: 80, right: 80 },
    verticalAlign: VerticalAlign.TOP,
  });
}
const makeTable = (widths, rows) => new Table({
  width: { size: widths.reduce((a, b) => a + b, 0), type: WidthType.DXA }, columnWidths: widths, layout: TableLayoutType.FIXED, rows,
  borders: { top: NONE, bottom: NONE, left: NONE, right: NONE, insideHorizontal: NONE, insideVertical: NONE },
});
const cellPara = (text, o = {}) => para(run(text, { size: o.size ?? 17, bold: o.bold, color: o.color }), { after: 0, line: 240, align: o.align, keepNext: o.keepNext });

function dataTable(columns, rows) {
  const head = new TableRow({
    tableHeader: true, cantSplit: true,
    children: columns.map(c => cell(cellPara(c.header, { size: 16, bold: true, color: COLOR.white, align: c.align, keepNext: true }), { width: c.w, fill: COLOR.accent, borders: { top: NONE, left: NONE, right: NONE, bottom: NONE } })),
  });
  const body = rows.map((r, ri) => new TableRow({
    cantSplit: true,
    children: r.map((c, i) => cell(cellPara(safe(typeof c === 'object' ? c.text : c), { bold: c?.bold, color: c?.color, align: columns[i].align }), { width: columns[i].w, fill: ri % 2 === 1 ? COLOR.zebra : undefined })),
  }));
  return makeTable(columns.map(c => c.w), [head, ...body]);
}

function kvGrid(pairs, cols = 3) {
  const w = Math.floor(CONTENT_W / cols);
  const box = { top: hair(), bottom: hair(), left: hair(), right: hair() };
  const rows = [];
  for (let i = 0; i < pairs.length; i += cols) {
    const cells = pairs.slice(i, i + cols).map(p => cell([
      para(run(String(p.label).toUpperCase(), { size: 14, color: COLOR.muted }), { after: 10, line: 220, keepNext: true }),
      para(run(safe(p.value), { size: 20, bold: true, color: p.color ?? COLOR.ink }), { after: 0, line: 240 }),
    ], { width: w, fill: COLOR.zebra, borders: box, margins: { top: 60, bottom: 60, left: 110, right: 110 } }));
    while (cells.length < cols) cells.push(cell(para(run(''), { after: 0 }), { width: w, borders: { top: NONE, bottom: NONE, left: NONE, right: NONE } }));
    rows.push(new TableRow({ cantSplit: true, children: cells }));
  }
  return makeTable(Array.from({ length: cols }, () => w), rows);
}

function statRow(items, perRow = 4) {
  const w = Math.floor(CONTENT_W / perRow);
  const box = { top: hair(COLOR.white, 24), bottom: hair(COLOR.white, 24), left: hair(COLOR.white, 24), right: hair(COLOR.white, 24) };
  const rows = [];
  for (let i = 0; i < items.length; i += perRow) {
    const cells = items.slice(i, i + perRow).map(it => cell([
      para(run(safe(it.value), { size: 32, bold: true, color: it.color ?? COLOR.accent }), { after: 0, line: 300, keepNext: true }),
      para(run(it.label, { size: 16, color: COLOR.muted }), { after: 0, line: 220 }),
    ], { width: w, fill: COLOR.accentSoft, borders: box, margins: { top: 70, bottom: 70, left: 140, right: 100 } }));
    while (cells.length < perRow) cells.push(cell(para(run(''), { after: 0 }), { width: w, borders: { top: NONE, bottom: NONE, left: NONE, right: NONE } }));
    rows.push(new TableRow({ cantSplit: true, children: cells }));
  }
  return makeTable(Array.from({ length: perRow }, () => w), rows);
}

function questionBlock(q) {
  const col = q.result === 'Correct' ? { c: COLOR.green, bg: COLOR.greenSoft } : q.result === 'Wrong' ? { c: COLOR.red, bg: COLOR.redSoft } : { c: COLOR.grey, bg: COLOR.greySoft };
  const border = { left: { style: BorderStyle.SINGLE, size: 24, color: col.c, space: 6 } };
  const indent = { left: 160 };
  const mine = q.userAnswer ? clip(q.userAnswer) : 'Not answered';
  const why = q.explanation ? clip(q.explanation) : '';
  const meta = [q.section, q.attempt > 1 || !q.isLatest ? `Attempt ${q.attempt}` : ''].filter(Boolean).join('  |  ');
  const out = [
    new Paragraph({
      children: [run(`Day ${q.day}  Q${q.no}`, { bold: true, color: COLOR.accent, size: 20 }), run(`   ${meta}`, { size: 16, color: COLOR.muted }),
        new TextRun({ children: [new Tab()], font: FONT }),
        run(` ${q.result} `, { bold: true, size: 15, color: col.c, shading: { type: ShadingType.CLEAR, fill: col.bg, color: 'auto' } })],
      tabStops: [{ type: TabStopType.RIGHT, position: CONTENT_W - 160 }], border, indent, keepNext: true, keepLines: true, spacing: { before: 100, after: 30, line: 240 },
    }),
    new Paragraph({ children: [run(clip(q.question) || DASH, { bold: true, color: COLOR.ink })], border, indent, keepNext: true, keepLines: true, spacing: { after: 30, line: 250 } }),
    new Paragraph({ children: [run('Employee answer: ', { bold: true, size: 17, color: COLOR.muted }), run(mine, { size: 18, color: q.result === 'Correct' ? COLOR.green : q.result === 'Wrong' ? COLOR.red : COLOR.muted })], border, indent, keepNext: true, keepLines: true, spacing: { after: 20, line: 245 } }),
    new Paragraph({ children: [run('Correct answer: ', { bold: true, size: 17, color: COLOR.muted }), run(clip(q.correctAnswer) || DASH, { size: 18 })], border, indent, keepNext: !!why, keepLines: true, spacing: { after: why ? 20 : 100, line: 245 } }),
  ];
  if (why) out.push(new Paragraph({ children: [run('Explanation: ', { bold: true, size: 16, color: COLOR.muted }), run(why, { size: 17, color: COLOR.muted })], border, indent, keepLines: true, spacing: { after: 100, line: 240 } }));
  return out;
}

const footer = (t) => new Footer({
  children: [new Paragraph({
    children: [run(t, { size: 15, color: COLOR.muted }), new TextRun({ children: [new Tab(), 'Page ', PageNumber.CURRENT, ' of ', PageNumber.TOTAL_PAGES], font: FONT, size: 15, color: COLOR.muted })],
    tabStops: [{ type: TabStopType.RIGHT, position: CONTENT_W }], border: { top: { style: BorderStyle.SINGLE, size: 4, color: COLOR.line, space: 4 } }, spacing: { before: 0, after: 0 },
  })],
});
const firstHeader = (company, text) => new Header({
  children: [new Paragraph({
    children: [run(company || 'SkillForge', { bold: true, size: 18, color: COLOR.accent }), new TextRun({ children: [new Tab(), text], font: FONT, size: 16, color: COLOR.muted })],
    tabStops: [{ type: TabStopType.RIGHT, position: CONTENT_W }], border: { bottom: { style: BorderStyle.SINGLE, size: 8, color: COLOR.accent, space: 3 } }, spacing: { before: 0, after: 0 },
  })],
});
const endNote = () => para(run('End of report', { size: 15, color: COLOR.muted }), { before: 160, after: 0, align: AlignmentType.CENTER });

function pack({ title, company, now, tz, children }) {
  return Packer.toBuffer(new Document({
    creator: 'SkillForge', title,
    styles: { default: { document: { run: { font: FONT, size: 19, color: COLOR.body }, paragraph: { spacing: { after: 60 } } } } },
    sections: [{
      properties: { titlePage: true, page: { size: { width: PAGE_W, height: PAGE_H }, margin: { top: MARGIN + 150, bottom: MARGIN + 100, left: MARGIN, right: MARGIN, header: 450, footer: 400 } } },
      headers: { first: firstHeader(company, `Generated ${fmtDate(now, tz)}`) },
      footers: { default: footer(title), first: footer(title) },
      children,
    }],
  }));
}

export async function buildModuleDocx({ record: r, now = new Date(), tz = reportTimezone() }) {
  const latest = (r.questions || []).filter(q => q.isLatest);
  const cnt = (x) => latest.filter(q => q.result === x).length;
  const children = [
    ...title1('Module Engagement Report', `${safe(r.name)}  |  ${safe(r.moduleTitle)}`),
    kvGrid([
      { label: 'Employee ID', value: r.employeeId }, { label: 'Employee name', value: r.name }, { label: 'Email', value: r.email },
      { label: 'Phone', value: r.phone }, { label: 'Job role', value: r.jobRole }, { label: 'Department', value: r.department },
      { label: 'Manager', value: r.managerName }, { label: 'Manager ID', value: r.managerId }, { label: 'Company', value: r.companyName },
      { label: 'Module', value: r.moduleTitle }, { label: 'Status', value: r.status },
    ], 3),
    section('At a glance'),
    kvGrid([
      { label: 'Score', value: r.scorePct === null ? DASH : `${fmtPct(r.scorePct, 1)}  (${r.correct} of ${r.questionsTotal} correct)` },
      { label: 'Rating', value: r.rating || DASH, color: RATING_COLOR[r.rating] },
      { label: 'Days completed', value: `${r.daysCompleted} of ${r.daysTotal}  (${r.progressPct}%)` },
      { label: 'Time spent', value: fmtSeconds(r.timeSpentSec) },
      { label: 'Questions', value: r.questionsTotal === null ? DASH : `${r.questionsAnswered} answered, ${r.wrong} wrong, ${r.skipped} not answered` },
      { label: 'Quiz attempts', value: r.attemptsTotal || DASH },
      { label: 'Assigned on', value: fmtDate(r.assignedAt, tz) }, { label: 'Started', value: fmtDate(r.startedAt, tz) }, { label: 'Completed on', value: fmtDate(r.completedAt, tz) },
    ], 3),
  ];
  if (!r.hasDetail) children.push(para(run('Answers for this module were not saved (it was completed before answer capture was added), so only progress and dates are available.', { size: 18, color: COLOR.muted }), { before: 80 }));

  children.push(section('Day-wise summary'));
  if (!(r.days || []).length) children.push(para(run('No days are recorded for this module.', { color: COLOR.muted })));
  else children.push(dataTable(
    [{ header: 'Day', w: 560, align: AlignmentType.CENTER }, { header: 'Title', w: 2700 }, { header: 'Status', w: 1150 }, { header: 'Completed', w: 1350 }, { header: 'Time', w: 900 }, { header: 'Tries', w: 600, align: AlignmentType.CENTER }, { header: 'Correct / Total', w: 1100, align: AlignmentType.CENTER }, { header: 'Score', w: 846, align: AlignmentType.RIGHT }],
    r.days.map(d => [String(d.day), d.title, d.status, fmtDate(d.completedAt, tz, { time: false }), fmtSeconds(d.timeSpentSec), d.attempts || DASH, d.total ? `${d.correct} / ${d.total}` : DASH, { text: d.scorePct === null ? DASH : fmtPct(d.scorePct, 1), bold: true }]),
  ));

  children.push(section('Section-wise detail'));
  for (const d of r.days || []) {
    children.push(subheading(`Day ${d.day}: ${d.title}`));
    children.push(para(run([`Status: ${d.status}`, `Started: ${fmtDate(d.startedAt, tz)}`, `Completed: ${fmtDate(d.completedAt, tz)}`, `Time: ${fmtSeconds(d.timeSpentSec)}`, `Score: ${d.scorePct === null ? DASH : fmtPct(d.scorePct, 1)}`].join('   |   '), { size: 17, color: COLOR.muted }), { after: 20, keepNext: true }));
    const secs = d.sections.map(s => s.title).filter(Boolean);
    children.push(para(run(secs.length ? `${d.sectionsTracked ? 'Sections opened' : 'Sections in this day'}: ${secs.join('; ')}` : 'Sections: not recorded', { size: 17 }), { after: 80 }));
  }

  if ((r.questions || []).length) {
    children.push(section('Question review'));
    children.push(para(run(`${latest.length} questions: ${cnt('Correct')} correct, ${cnt('Wrong')} wrong, ${cnt('Not answered')} not answered. Long text is shortened to ${MAX_TEXT} characters.`, { size: 17, color: COLOR.muted }), { after: 40, keepNext: true }));
    r.questions.forEach(q => children.push(...questionBlock(q)));
  }

  if ((r.skills || []).length) {
    children.push(section('Skills summary'));
    children.push(dataTable([{ header: 'Skill / section', w: 6200 }, { header: 'Correct / Total', w: 2200, align: AlignmentType.CENTER }, { header: 'Score', w: 1806, align: AlignmentType.RIGHT }],
      r.skills.map(s => [s.skill, `${s.correct} / ${s.total}`, { text: fmtPct(s.pct, 1), bold: true, color: s.pct >= 70 ? COLOR.green : COLOR.red }])));
    children.push(para(run(`Strengths: ${(r.strengths || []).join('; ') || 'none yet'}`, { bold: true, color: COLOR.green, size: 18 }), { before: 80, after: 20 }));
    children.push(para(run(`Needs improvement: ${(r.needsImprovement || []).join('; ') || 'nothing flagged'}`, { bold: true, color: COLOR.red, size: 18 }), { after: 20 }));
    if ((r.missed || []).length) children.push(para(run(`Questions to revisit: ${r.missed.map(clip).join('  /  ')}`, { size: 17, color: COLOR.muted }), { after: 20 }));
  }

  if ((r.timeline || []).length) {
    children.push(section('Engagement timeline'));
    children.push(dataTable([{ header: 'When', w: 3000 }, { header: 'Event', w: 7206 }], r.timeline.map(t => [fmtDate(t.at, tz), t.event])));
  }
  children.push(endNote());
  return pack({ title: `Module Engagement Report - ${safe(r.name)} - ${safe(r.moduleTitle)}`, company: r.companyName, now, tz, children });
}

export async function buildConsolidatedModuleDocx({ rows, summary = {}, company = '', filtersText = '', now = new Date(), tz = reportTimezone() }) {
  const children = [
    ...title1('Module Completion Report', filtersText || 'All matching employees and modules'),
    section('Overview'),
    statRow([
      { label: 'Records', value: rows.length }, { label: 'Completed modules', value: summary.completed }, { label: 'Employees', value: summary.employees }, { label: 'Average score', value: fmtPct(summary.avgScore, 1) },
      { label: 'Expert', value: summary.ratings?.Expert ?? 0, color: COLOR.green }, { label: 'Intermediate', value: summary.ratings?.Intermediate ?? 0, color: COLOR.blue },
      { label: 'Basic', value: summary.ratings?.Basic ?? 0, color: COLOR.amber }, { label: 'No Rating', value: summary.ratings?.['No Rating'] ?? 0, color: COLOR.red },
    ], 4),
    para(run(`Total time spent: ${fmtSeconds(summary.totalTimeSec)}`, { size: 18, color: COLOR.muted }), { before: 80 }),
    section('Employee modules'),
  ];
  if (!rows.length) children.push(para(run('No records match the selected filters.', { color: COLOR.muted })));
  else children.push(dataTable(
    [
      { header: 'Employee ID', w: 850 },
      { header: 'Name', w: 1200 },
      { header: 'Email', w: 1350 },
      { header: 'Role', w: 950 },
      { header: 'Department', w: 900 },
      { header: 'Module', w: 1200 },
      { header: 'Status', w: 800 },
      { header: 'Completed', w: 800 },
      { header: 'Days', w: 480, align: AlignmentType.CENTER },
      { header: 'Time', w: 580 },
      { header: 'Score', w: 480, align: AlignmentType.RIGHT },
      { header: 'Rating', w: 616 },
    ],
    rows.map(r => [
      r.employeeId,
      r.name,
      r.email,
      r.jobRole,
      r.department,
      r.moduleTitle,
      r.status,
      fmtDate(r.completedAt, tz, { time: false }),
      `${r.daysCompleted}/${r.daysTotal}`,
      fmtSeconds(r.timeSpentSec),
      r.scorePct === null ? DASH : fmtPct(r.scorePct, 1),
      { text: r.rating || DASH, bold: true, color: RATING_COLOR[r.rating] },
    ]),
  ));
  children.push(endNote());
  return pack({ title: 'Module Completion Report', company, now, tz, children });
}
