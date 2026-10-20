/**
 * docxReports.js — Assessment report Word documents (individual + consolidated).
 *
 * Same sections and wording as the PDF. Layout rules: no empty spacer
 * paragraphs (spacing properties only), headings and the start of every block
 * use keep-with-next, tables repeat their header row and never split a row
 * across pages, and the footer carries the report title and "Page X of Y".
 */
import {
  Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell, WidthType, BorderStyle, ShadingType,
  AlignmentType, Footer, Header, PageNumber, TableLayoutType, TabStopType, Tab, VerticalAlign,
} from 'docx';
import {
  DASH, safe, fmtDate, fmtPct, fmtDuration, truncate, reportTimezone, STATUS,
  buildSummary, skillAverages, followUpList, ratingLabel,
} from './reportData.js';
import { RATINGS } from '../grading.js';

const COLOR = {
  accent: '4338CA', accentSoft: 'EEF2FF', ink: '1E293B', body: '334155', muted: '64748B', line: 'E2E8F0', zebra: 'F8FAFC', white: 'FFFFFF',
  green: '15803D', greenSoft: 'DCFCE7', red: 'B91C1C', redSoft: 'FEE2E2', grey: '475569', greySoft: 'E2E8F0',
};
const FONT = 'Calibri';
const PAGE_W = 11906;
const PAGE_H = 16838;
const MARGIN = 850;
const CONTENT_W = PAGE_W - 2 * MARGIN; // 10206 twips
const MAX_TEXT = 400;

const NONE = { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' };
const hair = (color = COLOR.line, size = 4) => ({ style: BorderStyle.SINGLE, size, color });

const run = (text, o = {}) => new TextRun({ text: String(text ?? ''), font: FONT, size: o.size ?? 19, bold: o.bold, color: o.color ?? COLOR.body, italics: o.italics, shading: o.shading });
// Rating -> dark text colour and solid bar colour (same four colours as Excel / PDF).
const ratingColor = (label) => RATINGS.find(r => r.label === label)?.text || COLOR.ink;
const ratingBar = (label) => RATINGS.find(r => r.label === label)?.solid || COLOR.accent;

function para(children, o = {}) {
  return new Paragraph({
    children: Array.isArray(children) ? children : [children],
    keepNext: o.keepNext, keepLines: o.keepLines ?? true,
    alignment: o.align,
    spacing: { before: o.before ?? 0, after: o.after ?? 60, line: o.line ?? 252 },
    indent: o.indent, border: o.border, tabStops: o.tabStops,
  });
}

function title1(text, sub) {
  const out = [para(run(text, { size: 40, bold: true, color: COLOR.ink }), { after: 40, keepNext: true })];
  if (sub) out.push(para(run(sub, { size: 21, color: COLOR.muted }), { after: 120, keepNext: true }));
  return out;
}

function section(text) {
  return new Paragraph({
    children: [run(text, { size: 27, bold: true, color: COLOR.accent })],
    keepNext: true, keepLines: true,
    spacing: { before: 260, after: 90 },
    border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: COLOR.line, space: 2 } },
  });
}
const subheading = (text) => para(run(text, { size: 22, bold: true, color: COLOR.ink }), { before: 120, after: 60, keepNext: true });

function cell(children, { width, fill, borders, span, margins, valign } = {}) {
  return new TableCell({
    children: Array.isArray(children) ? children : [children],
    width: { size: width, type: WidthType.DXA },
    columnSpan: span,
    shading: fill ? { type: ShadingType.CLEAR, fill, color: 'auto' } : undefined,
    borders: borders ?? { top: NONE, left: NONE, right: NONE, bottom: hair() },
    margins: margins ?? { top: 45, bottom: 45, left: 80, right: 80 },
    verticalAlign: valign ?? VerticalAlign.TOP,
  });
}

function makeTable(widths, rows, extra = {}) {
  return new Table({
    width: { size: widths.reduce((a, b) => a + b, 0), type: WidthType.DXA },
    columnWidths: widths,
    layout: TableLayoutType.FIXED,
    rows,
    borders: { top: NONE, bottom: NONE, left: NONE, right: NONE, insideHorizontal: NONE, insideVertical: NONE },
    ...extra,
  });
}

const cellPara = (text, o = {}) => para(run(text, { size: o.size ?? 17, bold: o.bold, color: o.color }), { after: 0, line: 240, align: o.align, keepNext: o.keepNext });

/** columns: [{header, w, align}], rows of cell = string | {text,bold,color}. */
function dataTable(columns, rows, { size = 17 } = {}) {
  const widths = columns.map(c => c.w);
  const head = new TableRow({
    tableHeader: true, cantSplit: true,
    children: columns.map(c => cell(cellPara(c.header, { size: 16, bold: true, color: COLOR.white, align: c.align, keepNext: true }), {
      width: c.w, fill: COLOR.accent, span: c.span, borders: { top: NONE, left: NONE, right: NONE, bottom: NONE },
    })),
  });
  const body = rows.map((r, ri) => new TableRow({
    cantSplit: true,
    children: r.map((c, i) => {
      const fill = ri % 2 === 1 ? COLOR.zebra : undefined;
      return cell(cellPara(safe(typeof c === 'object' ? c.text : c), { size, bold: c?.bold, color: c?.color, align: columns[i].align }), { width: columns[i].w, fill });
    }),
  }));
  return makeTable(widths, [head, ...body]);
}

/** Skill/grade tables with a 10-strip bar: expands {bar} into 10 narrow cells. */
function barTable(leadCols, leadRows, stripW, header = '') {
  const columns = [...leadCols, ...Array.from({ length: 10 }, () => ({ header: '', w: stripW }))];
  columns[leadCols.length] = { ...columns[leadCols.length], header };
  const rows = leadRows.map(r => {
    const cells = r.slice(0, -1);
    const last = r[r.length - 1];
    const pct = last && typeof last === 'object' ? last.pct : last;
    for (let s = 0; s < 10; s++) cells.push({ bar: pct, strip: s, color: last && typeof last === 'object' ? last.color : undefined });
    return cells;
  });
  // header: a single spanning cell over the strips
  const widths = columns.map(c => c.w);
  const head = new TableRow({
    tableHeader: true, cantSplit: true,
    children: [
      ...leadCols.map(c => cell(cellPara(c.header, { size: 16, bold: true, color: COLOR.white, align: c.align, keepNext: true }), { width: c.w, fill: COLOR.accent, borders: { top: NONE, left: NONE, right: NONE, bottom: NONE } })),
      cell(cellPara(header, { size: 16, bold: true, color: COLOR.white, keepNext: true }), { width: stripW * 10, span: 10, fill: COLOR.accent, borders: { top: NONE, left: NONE, right: NONE, bottom: NONE } }),
    ],
  });
  return makeTable(widths, [head, ...buildBody(columns, rows)]);
}

function buildBody(columns, rows) {
  return rows.map((r, ri) => new TableRow({
    cantSplit: true,
    children: r.map((c, i) => {
      const fill = ri % 2 === 1 ? COLOR.zebra : undefined;
      if (c && typeof c === 'object' && c.bar !== undefined) {
        const on = Math.round((Math.max(0, Math.min(100, Number(c.bar) || 0)) / 100) * 10);
        return cell(cellPara('', { size: 8 }), {
          width: columns[i].w, fill: c.strip < on ? (c.color || COLOR.accent) : COLOR.greySoft,
          margins: { top: 45, bottom: 45, left: 0, right: 0 },
          borders: { top: NONE, bottom: NONE, left: hair(COLOR.white, 8), right: hair(COLOR.white, 8) },
        });
      }
      return cell(cellPara(safe(typeof c === 'object' ? c.text : c), { bold: c?.bold, color: c?.color, align: columns[i].align }), { width: columns[i].w, fill });
    }),
  }));
}

function kvGrid(pairs, cols = 3) {
  const w = Math.floor(CONTENT_W / cols);
  const widths = Array.from({ length: cols }, () => w);
  const box = { top: hair(), bottom: hair(), left: hair(), right: hair() };
  const rows = [];
  for (let i = 0; i < pairs.length; i += cols) {
    const chunk = pairs.slice(i, i + cols);
    const cells = chunk.map(p => cell([
      para(run(String(p.label).toUpperCase(), { size: 14, color: COLOR.muted }), { after: 10, line: 220, keepNext: true }),
      para(run(safe(p.value), { size: 20, bold: true, color: p.color ?? COLOR.ink }), { after: 0, line: 240 }),
    ], { width: w, fill: COLOR.zebra, borders: box, margins: { top: 60, bottom: 60, left: 110, right: 110 } }));
    while (cells.length < cols) cells.push(cell(para(run(''), { after: 0 }), { width: w, borders: { top: NONE, bottom: NONE, left: NONE, right: NONE } }));
    rows.push(new TableRow({ cantSplit: true, children: cells }));
  }
  return makeTable(widths, rows);
}

function statRow(items, perRow = 4) {
  const w = Math.floor(CONTENT_W / perRow);
  const widths = Array.from({ length: perRow }, () => w);
  const box = { top: hair(COLOR.white, 24), bottom: hair(COLOR.white, 24), left: hair(COLOR.white, 24), right: hair(COLOR.white, 24) };
  const rows = [];
  for (let i = 0; i < items.length; i += perRow) {
    const cells = items.slice(i, i + perRow).map(it => cell([
      para(run(safe(it.value), { size: 32, bold: true, color: COLOR.accent }), { after: 0, line: 300, keepNext: true }),
      para(run(it.label, { size: 16, color: COLOR.muted }), { after: 0, line: 220 }),
    ], { width: w, fill: COLOR.accentSoft, borders: box, margins: { top: 70, bottom: 70, left: 140, right: 100 } }));
    while (cells.length < perRow) cells.push(cell(para(run(''), { after: 0 }), { width: w, borders: { top: NONE, bottom: NONE, left: NONE, right: NONE } }));
    rows.push(new TableRow({ cantSplit: true, children: cells }));
  }
  return makeTable(widths, rows);
}

const listItem = (marker, text, color, last) => new Paragraph({
  children: [run(marker, { bold: true, color }), new TextRun({ children: [new Tab()], font: FONT }), run(text)],
  tabStops: [{ type: TabStopType.LEFT, position: 280 }],
  indent: { left: 280, hanging: 280 },
  spacing: { before: 0, after: last ? 0 : 40, line: 250 },
  keepLines: true,
});

function twoLists(left, right) {
  const w = Math.floor(CONTENT_W / 2);
  const mk = (b) => {
    const items = b.items.length ? b.items : [b.empty];
    return cell([
      para(run(b.title, { size: 22, bold: true, color: b.color }), { after: 50, keepNext: true }),
      ...items.map((t, i) => listItem('•', t, b.color, i === items.length - 1)),
    ], { width: w, fill: COLOR.zebra, borders: { top: hair(), bottom: hair(), right: hair(), left: { style: BorderStyle.SINGLE, size: 24, color: b.color } }, margins: { top: 80, bottom: 80, left: 140, right: 120 } });
  };
  return makeTable([w, w], [new TableRow({ cantSplit: false, children: [mk(left), mk(right)] })]);
}

const clip = (s) => { const t = truncate(s, MAX_TEXT); return t.truncated ? `${t.text} (shortened)` : t.text; };

function questionBlock(q) {
  const col = q.result === 'Correct' ? { c: COLOR.green, bg: COLOR.greenSoft } : q.result === 'Wrong' ? { c: COLOR.red, bg: COLOR.redSoft } : { c: COLOR.grey, bg: COLOR.greySoft };
  const border = { left: { style: BorderStyle.SINGLE, size: 24, color: col.c, space: 6 } };
  const indent = { left: 160 };
  const mine = q.userAnswer ? clip(q.userAnswer) : 'Not answered';
  const why = q.explanation ? clip(q.explanation) : '';
  const out = [
    new Paragraph({
      children: [
        run(`Q${q.no}`, { bold: true, color: COLOR.accent, size: 20 }),
        run(`   ${[q.skill, q.difficulty].filter(Boolean).join('  |  ')}`, { size: 16, color: COLOR.muted }),
        new TextRun({ children: [new Tab()], font: FONT }),
        run(` ${q.result} `, { bold: true, size: 15, color: col.c, shading: { type: ShadingType.CLEAR, fill: col.bg, color: 'auto' } }),
      ],
      tabStops: [{ type: TabStopType.RIGHT, position: CONTENT_W - 160 }],
      border, indent, keepNext: true, keepLines: true, spacing: { before: 100, after: 30, line: 240 },
    }),
    new Paragraph({ children: [run(clip(q.question) || DASH, { bold: true, color: COLOR.ink, size: 19 })], border, indent, keepNext: true, keepLines: true, spacing: { after: 30, line: 250 } }),
    new Paragraph({
      children: [run('Your answer: ', { bold: true, size: 17, color: COLOR.muted }), run(mine, { size: 18, color: q.result === 'Correct' ? COLOR.green : q.result === 'Wrong' ? COLOR.red : COLOR.muted })],
      border, indent, keepNext: false, keepLines: true, spacing: { after: 20, line: 245 },
    }),
    new Paragraph({
      children: [run('Correct answer: ', { bold: true, size: 17, color: COLOR.muted }), run(clip(q.correctAnswer) || DASH, { size: 18 })],
      border, indent, keepNext: false, keepLines: true, spacing: { after: why ? 20 : 100, line: 245 },
    }),
  ];
  if (why) {
    out.push(new Paragraph({
      children: [run('Why: ', { bold: true, size: 16, color: COLOR.muted }), run(why, { size: 17, color: COLOR.muted })],
      border, indent, keepLines: true, spacing: { after: 100, line: 240 },
    }));
  }
  return out;
}

function footer(titleText) {
  return new Footer({
    children: [new Paragraph({
      children: [
        run(titleText, { size: 15, color: COLOR.muted }),
        new TextRun({ children: [new Tab(), 'Page ', PageNumber.CURRENT, ' of ', PageNumber.TOTAL_PAGES], font: FONT, size: 15, color: COLOR.muted }),
      ],
      tabStops: [{ type: TabStopType.RIGHT, position: CONTENT_W }],
      border: { top: { style: BorderStyle.SINGLE, size: 4, color: COLOR.line, space: 4 } },
      spacing: { before: 0, after: 0 },
    })],
  });
}

function firstHeader(company, generatedText) {
  return new Header({
    children: [new Paragraph({
      children: [run(company || 'SkillForge', { bold: true, size: 18, color: COLOR.accent }), new TextRun({ children: [new Tab(), generatedText], font: FONT, size: 16, color: COLOR.muted })],
      tabStops: [{ type: TabStopType.RIGHT, position: CONTENT_W }],
      border: { bottom: { style: BorderStyle.SINGLE, size: 8, color: COLOR.accent, space: 3 } },
      spacing: { before: 0, after: 0 },
    })],
  });
}

function makeDoc({ title, company, generatedText, children }) {
  return new Document({
    creator: 'SkillForge', title,
    styles: { default: { document: { run: { font: FONT, size: 19, color: COLOR.body }, paragraph: { spacing: { after: 60 } } } } },
    sections: [{
      properties: {
        titlePage: true,
        page: { size: { width: PAGE_W, height: PAGE_H }, margin: { top: MARGIN + 150, bottom: MARGIN + 100, left: MARGIN, right: MARGIN, header: 450, footer: 400 } },
      },
      headers: { first: firstHeader(company, generatedText) },
      footers: { default: footer(title), first: footer(title) },
      children,
    }],
  });
}

const endNote = () => para(run('End of report', { size: 15, color: COLOR.muted }), { before: 160, after: 0, align: AlignmentType.CENTER, keepLines: true });

// ── INDIVIDUAL ──────────────────────────────────────────────────────────────
export async function buildIndividualDocx({ row, now = new Date(), tz = reportTimezone() }) {
  const done = row.status === STATUS.COMPLETED;
  const rLabel = ratingLabel(row);
  const children = [
    ...title1('Assessment Report', `${safe(row.name)}  |  ${safe(row.assessmentTitle)}`),
    kvGrid([
      { label: 'Employee ID', value: row.employeeId }, { label: 'Job role', value: row.jobRole }, { label: 'Department', value: row.department },
      { label: 'Manager', value: row.managerName }, { label: 'Assessment type', value: row.assessmentType }, { label: 'Company', value: row.companyName },
    ], 3),
    section('At a glance'),
    kvGrid([
      { label: 'Score', value: done && row.scorePct !== null ? `${fmtPct(row.scorePct, 1)}${row.correct !== null && row.total ? `  (${row.correct} of ${row.total} correct)` : ''}` : DASH },
      { label: 'Rating', value: done ? row.rating : rLabel, color: done ? ratingColor(row.rating) : undefined },
      { label: 'Time taken', value: row.timeTakenMin !== null ? `${fmtDuration(row.timeTakenMin)} of ${row.timeLimitMin} min` : `${DASH} (limit ${row.timeLimitMin} min)` },
      { label: 'Attempt no.', value: row.attemptNo },
      { label: 'Assigned on', value: fmtDate(row.assignedAt, tz) },
      { label: 'Started', value: fmtDate(row.startedAt, tz) },
      { label: 'Completed on', value: fmtDate(row.completedAt, tz) },
    ], 3),
  ];

  if (!done) {
    children.push(para(run(`This employee has not completed the assessment yet (status: ${row.status}). Scores and answers will appear here once it is submitted.`, { color: COLOR.muted }), { before: 120 }));
    children.push(endNote());
    return makeBuffer({ title: `Assessment Report - ${safe(row.name)} - ${safe(row.assessmentTitle)}`, company: row.companyName, now, tz, children });
  }

  if (row.skills.length) {
    children.push(section('Skill scores'));
    children.push(barTable(
      [{ header: 'Skill', w: 3700 }, { header: 'Correct / Total', w: 1500, align: AlignmentType.CENTER }, { header: 'Score', w: 906, align: AlignmentType.RIGHT }],
      row.skills.map(s => [s.skill, `${s.correct ?? DASH} / ${s.total ?? DASH}`, { text: s.pct === null ? DASH : `${s.pct}%`, bold: true }, s.pct ?? 0]),
      410,
    ));
  }

  const improve = [...row.weakAreas, ...row.missingSkills.filter(m => !row.weakAreas.includes(m)).map(m => `${m} (no correct answers)`)];
  const cap = (arr, n = 8) => (arr.length > n ? [...arr.slice(0, n), `and ${arr.length - n} more`] : arr);
  children.push(section('Strengths and next steps'));
  children.push(twoLists(
    { title: 'What went well', items: cap(row.strengths), color: COLOR.green, empty: 'No skill reached the 70% mark yet.' },
    { title: 'What to improve', items: cap(row.weakAreas.length || row.missingSkills.length ? improve : []), color: COLOR.red, empty: 'Nothing flagged. Well done.' },
  ));
  if (row.recommendations.length) {
    children.push(subheading('Recommended next steps'));
    cap(row.recommendations.map(t => truncate(t, MAX_TEXT).text), 8).forEach((t, i) => children.push(listItem(`${i + 1}.`, t, COLOR.accent, false)));
  }

  if (row.questions.length) {
    const cnt = (r) => row.questions.filter(q => q.result === r).length;
    children.push(section('Question review'));
    children.push(para(run(`${row.questions.length} questions: ${cnt('Correct')} correct, ${cnt('Wrong')} wrong, ${cnt('Not answered')} not answered. Long text is shortened to ${MAX_TEXT} characters.`, { size: 17, color: COLOR.muted }), { after: 40, keepNext: true }));
    row.questions.forEach(q => children.push(...questionBlock(q)));
  }
  children.push(endNote());
  return makeBuffer({ title: `Assessment Report - ${safe(row.name)} - ${safe(row.assessmentTitle)}`, company: row.companyName, now, tz, children });
}

// ── CONSOLIDATED ────────────────────────────────────────────────────────────
export async function buildConsolidatedDocx({ rows, summary, now = new Date(), tz = reportTimezone() }) {
  const sum = summary || buildSummary(rows, {}, null, now);
  const multi = sum.multi || null;
  const roleOrAssessment = multi ? { header: 'Assessment', pick: r => r.assessmentTitle } : { header: 'Job role', pick: r => r.jobRole };
  const children = [
    ...title1(safe(sum.title, 'Assessment'), multi ? 'All assessments (submitted and pending)' : 'Assessment results report'),
    kvGrid(multi ? [
      { label: 'Assessments covered', value: multi.assessments }, { label: 'Records', value: rows.length },
      { label: 'Company', value: sum.company }, { label: 'Generated on', value: fmtDate(now, tz, { time: false }) },
    ] : [
      { label: 'Type', value: sum.type }, { label: 'Job role(s)', value: sum.jobRoles.join(', ') }, { label: 'Company', value: sum.company },
      { label: 'Created on', value: fmtDate(sum.createdAt, tz, { time: false }) }, { label: 'Starts', value: fmtDate(sum.startAt, tz) },
      { label: 'Due', value: fmtDate(sum.dueAt, tz) }, { label: 'Time limit', value: `${sum.timeLimitMin} min` },
    ], 4),
    section('Overview'),
    statRow([
      { label: 'Assigned', value: sum.assigned }, { label: 'Completed', value: sum.completed }, { label: 'Not completed', value: sum.notCompleted }, { label: 'Completion', value: fmtPct(sum.completionPct, 1) },
      { label: 'Average score', value: fmtPct(sum.avgScore, 1) }, { label: 'Highest score', value: fmtPct(sum.highScore, 1) }, { label: 'Lowest score', value: fmtPct(sum.lowScore, 1) }, { label: 'Expert + Intermediate', value: fmtPct(sum.topSharePct, 1) },
    ], 4),
  ];

  if (sum.completed > 0) {
    children.push(subheading('Rating distribution'));
    const maxG = Math.max(1, ...sum.ratings.map(x => x.count));
    children.push(barTable(
      [{ header: 'Rating', w: 1500 }, { header: 'Score range', w: 2000 }, { header: 'People', w: 1300, align: AlignmentType.RIGHT }],
      sum.ratings.map(x => [{ text: x.label, bold: true, color: ratingColor(x.label) }, RATINGS.find(m => m.label === x.label)?.range || '', `${x.count} (${fmtPct(x.percent, 0)})`, { pct: (x.count / maxG) * 100, color: ratingBar(x.label) }]),
      540,
    ));
  }

  children.push(section('Results by employee'));
  const sorted = rows.slice().sort((a, b) => safe(a.name, '').localeCompare(safe(b.name, '')));
  if (!sorted.length) children.push(para(run('No employees are assigned to this assessment.', { color: COLOR.muted })));
  else {
    children.push(dataTable(
      [
        { header: 'Employee ID', w: 1250 }, { header: 'Name', w: 2300 }, { header: roleOrAssessment.header, w: 1800 }, { header: 'Assigned', w: 1250 }, { header: 'Completed', w: 1250 },
        { header: 'Score', w: 800, align: AlignmentType.RIGHT }, { header: 'Rating', w: 1556 },
      ],
      sorted.map(r => {
        const res = ratingLabel(r);
        return [r.employeeId, r.name, roleOrAssessment.pick(r), fmtDate(r.assignedAt, tz, { time: false }), fmtDate(r.completedAt, tz, { time: false }),
          r.status === STATUS.COMPLETED ? fmtPct(r.scorePct, 1) : DASH, { text: res, bold: true, color: r.status === STATUS.COMPLETED ? ratingColor(res) : COLOR.muted }];
      }),
    ));
  }

  const skills = skillAverages(rows);
  if (skills.length) {
    children.push(section('Skill performance'));
    children.push(para(run('Average score for each skill across everyone who completed the assessment. Weakest skills are listed first.', { size: 17, color: COLOR.muted }), { after: 60, keepNext: true }));
    const shown = skills.slice(0, 30);
    children.push(barTable(
      [{ header: 'Skill', w: 3500 }, { header: 'People', w: 800, align: AlignmentType.CENTER }, { header: 'Correct / Total', w: 1400, align: AlignmentType.CENTER }, { header: 'Average', w: 806, align: AlignmentType.RIGHT }],
      shown.map(s => [s.skill, String(s.people), `${s.correct} / ${s.total}`, { text: fmtPct(s.pct, 1), bold: true }, s.pct]),
      370,
    ));
    if (skills.length > shown.length) children.push(para(run(`and ${skills.length - shown.length} more skills (see the Excel file).`, { size: 17, color: COLOR.muted }), { before: 60 }));
  }

  children.push(section('Needs follow-up'));
  const follow = followUpList(rows, now);
  if (!follow.length) {
    children.push(para(run('Nobody needs follow-up: everyone has completed the assessment and earned a rating.', { bold: true, color: COLOR.green })));
  } else {
    children.push(para(run('Employees who have not completed the assessment, or finished with No Rating (below 70%). Most urgent first.', { size: 17, color: COLOR.muted }), { after: 60, keepNext: true }));
    children.push(dataTable(
      [{ header: 'Employee ID', w: 1150 }, { header: 'Name', w: 2100 }, { header: roleOrAssessment.header, w: 1700 }, { header: 'Status', w: 1150 }, { header: 'Due', w: 1250 }, { header: 'What to do', w: 2856 }],
      follow.map(f => [f.row.employeeId, f.row.name, roleOrAssessment.pick(f.row), { text: f.status, bold: true, color: f.status === 'No Rating' ? ratingColor('No Rating') : COLOR.ink }, fmtDate(f.row.dueAt, tz, { time: false }), f.reason]),
    ));
  }
  children.push(endNote());
  return makeBuffer({ title: `Assessment Results - ${safe(sum.title, 'Assessment')}`, company: sum.company, now, tz, children });
}

/** Generic table (filtered-reports export), landscape so on-screen columns stay readable. */
export async function buildTableDocx({ title, metaLine, headers, rows }) {
  const n = Math.max(1, headers.length);
  const W = PAGE_H - 2 * MARGIN; // landscape content width
  const w = Math.floor(W / n);
  const columns = headers.map(h => ({ header: safe(h, ''), w }));
  const children = [
    ...title1(safe(title, 'Reports'), metaLine || ''),
    rows.length
      ? dataTable(columns, rows.map(r => headers.map((_, i) => truncate(Array.isArray(r) ? r[i] : '', 300).text || DASH)), { size: 15 })
      : para(run('No records match the selected filters.', { color: COLOR.muted })),
    endNote(),
  ];
  const doc = new Document({
    creator: 'SkillForge', title: safe(title, 'Reports'),
    styles: { default: { document: { run: { font: FONT, size: 17, color: COLOR.body } } } },
    sections: [{
      properties: { page: { size: { width: PAGE_W, height: PAGE_H, orientation: 'landscape' }, margin: { top: MARGIN, bottom: MARGIN + 100, left: MARGIN, right: MARGIN, footer: 400 } } },
      footers: { default: new Footer({ children: [new Paragraph({ children: [run(safe(title, 'Reports'), { size: 15, color: COLOR.muted }), new TextRun({ children: [new Tab(), 'Page ', PageNumber.CURRENT, ' of ', PageNumber.TOTAL_PAGES], font: FONT, size: 15, color: COLOR.muted })], tabStops: [{ type: TabStopType.RIGHT, position: W }] })] }) },
      children,
    }],
  });
  return Packer.toBuffer(doc);
}

function makeBuffer({ title, company, now, tz, children }) {
  return Packer.toBuffer(makeDoc({ title, company, generatedText: `Generated ${fmtDate(now, tz)}`, children }));
}
