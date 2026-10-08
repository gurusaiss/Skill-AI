/**
 * modulePdf.js - PDFs for Reports > Modules (single employee-module + consolidated).
 *
 * Same layout rules as the assessment PDFs: content flows continuously, a new
 * page is only added right before something is drawn on it (no blank pages),
 * headings are never left alone at the bottom of a page, table header rows
 * repeat, and row heights come from the real wrapped text. Helvetica only.
 * A small self-contained layout (copied, not imported) so this file does not
 * depend on the assessment PDF code that is being redesigned separately.
 */
import PDFDocument from 'pdfkit';
import { DASH, safe, fmtDate, fmtPct, truncate, reportTimezone } from './reportData.js';
import { fmtSeconds } from './moduleReportData.js';

const C = {
  accent: '#4338CA', accentSoft: '#EEF2FF', ink: '#1E293B', body: '#334155', muted: '#64748B', line: '#E2E8F0', zebra: '#F8FAFC', white: '#FFFFFF',
  green: '#15803D', greenSoft: '#DCFCE7', red: '#B91C1C', redSoft: '#FEE2E2', grey: '#475569', greySoft: '#E2E8F0', blue: '#1D4ED8', amber: '#B45309',
};
const FONT = 'Helvetica';
const BOLD = 'Helvetica-Bold';
const GAP = 1.5;
const MAX_TEXT = 400;
const RATING_COLOR = { Expert: C.green, Intermediate: C.blue, Basic: C.amber, 'No Rating': C.red };

export function pdfSafe(v) {
  return String(v ?? '').replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/[→➔]/g, '->').replace(/[^\n\x20-\x7E\xA0-\xFF–—•…]/g, '?');
}

class Layout {
  constructor({ title, company, generatedText }) {
    this.title = pdfSafe(title);
    this.doc = new PDFDocument({ size: 'A4', bufferPages: true, margins: { top: 44, bottom: 54, left: 40, right: 40 }, info: { Title: this.title, Producer: 'SkillForge', Creator: 'SkillForge' } });
    this.chunks = [];
    this.doc.on('data', c => this.chunks.push(c));
    this.done = new Promise(res => this.doc.on('end', () => res(Buffer.concat(this.chunks))));
    const m = this.doc.page.margins;
    this.x0 = m.left; this.w = this.doc.page.width - m.left - m.right; this.top = m.top;
    this.limit = this.doc.page.height - m.bottom - 0.5;
    this.y = this.top; this.pageIdx = 0; this.pageEnd = [this.top];
    const d = this.doc;
    d.font(BOLD).fontSize(9).fillColor(C.accent).text(pdfSafe(company || 'SkillForge'), this.x0, this.y, { width: this.w * 0.6, lineBreak: false });
    d.font(FONT).fontSize(8.5).fillColor(C.muted).text(pdfSafe(generatedText), this.x0, this.y + 0.5, { width: this.w, align: 'right', lineBreak: false });
    this.y += 14;
    d.moveTo(this.x0, this.y).lineTo(this.x0 + this.w, this.y).lineWidth(0.8).strokeColor(C.accent).stroke();
    this.y += 10; this.mark(this.y);
  }
  mark(y) { if (y > this.pageEnd[this.pageIdx]) this.pageEnd[this.pageIdx] = y; }
  newPage() { this.doc.addPage(); this.pageIdx += 1; this.pageEnd[this.pageIdx] = this.top; this.y = this.top; }
  ensure(h) { if (this.y + h > this.limit && this.y > this.top + 1) this.newPage(); }
  measure(text, { size = 9.5, bold = false, width = this.w } = {}) {
    this.doc.font(bold ? BOLD : FONT).fontSize(size);
    return this.doc.heightOfString(pdfSafe(text) || ' ', { width, lineGap: GAP });
  }
  text(text, { size = 9.5, bold = false, color = C.body, width = this.w, x = this.x0, align = 'left', after = 4 } = {}) {
    const h = this.measure(text, { size, bold, width });
    this.ensure(h);
    this.doc.font(bold ? BOLD : FONT).fontSize(size).fillColor(color).text(pdfSafe(text) || ' ', x, this.y, { width, align, lineGap: GAP });
    this.y += h + after; this.mark(this.y);
  }
  title1(text, sub) { this.text(text, { size: 20, bold: true, color: C.ink, after: 2 }); if (sub) this.text(sub, { size: 10.5, color: C.muted, after: 6 }); }
  section(title, keepWith = 70, right = '') {
    if (this.y > this.top + 1) this.y += 8;
    this.ensure(26 + keepWith);
    this.doc.font(BOLD).fontSize(13).fillColor(C.accent).text(pdfSafe(title), this.x0, this.y, { width: this.w, lineBreak: false });
    if (right) this.doc.font(FONT).fontSize(8.5).fillColor(C.muted).text(pdfSafe(right), this.x0, this.y + 4, { width: this.w, align: 'right', lineBreak: false });
    this.y += 17;
    this.doc.moveTo(this.x0, this.y).lineTo(this.x0 + this.w, this.y).lineWidth(0.5).strokeColor(C.line).stroke();
    this.y += 6; this.mark(this.y);
  }
  subheading(title, keepWith = 50) {
    this.ensure(18 + keepWith);
    this.doc.font(BOLD).fontSize(10.5).fillColor(C.ink).text(pdfSafe(title), this.x0, this.y, { width: this.w, lineBreak: false, ellipsis: true });
    this.y += 15; this.mark(this.y);
  }
  tag(text, x, y, { color, bg }) {
    const d = this.doc; d.font(BOLD).fontSize(7.5);
    const w = d.widthOfString(pdfSafe(text)) + 12;
    d.roundedRect(x, y, w, 13, 3).fill(bg);
    d.fillColor(color).text(pdfSafe(text), x + 6, y + 3.2, { width: w, lineBreak: false });
    return w;
  }
  kvGrid(pairs, cols = 3) {
    const cw = this.w / cols; const padX = 8, padY = 5; const d = this.doc;
    for (let i = 0; i < pairs.length; i += cols) {
      const chunk = pairs.slice(i, i + cols);
      const h = Math.max(...chunk.map(p => 10 + this.measure(safe(p.value), { size: 10, bold: true, width: cw - 2 * padX }))) + 2 * padY;
      this.ensure(h);
      chunk.forEach((p, j) => {
        const x = this.x0 + j * cw;
        d.rect(x, this.y, cw, h).lineWidth(0.5).fillAndStroke(C.zebra, C.line);
        d.font(FONT).fontSize(7.5).fillColor(C.muted).text(pdfSafe(p.label).toUpperCase(), x + padX, this.y + padY, { width: cw - 2 * padX, lineBreak: false });
        d.font(BOLD).fontSize(10).fillColor(p.color || C.ink).text(pdfSafe(safe(p.value)), x + padX, this.y + padY + 10, { width: cw - 2 * padX, lineGap: GAP });
      });
      this.y += h; this.mark(this.y);
    }
    this.y += 6;
  }
  statRow(items, perRow = 4) {
    const gapX = 8; const cw = (this.w - gapX * (perRow - 1)) / perRow; const h = 42; const d = this.doc;
    for (let i = 0; i < items.length; i += perRow) {
      this.ensure(h);
      items.slice(i, i + perRow).forEach((it, j) => {
        const x = this.x0 + j * (cw + gapX);
        d.roundedRect(x, this.y, cw, h, 4).fillAndStroke(C.accentSoft, C.line);
        d.font(BOLD).fontSize(16).fillColor(it.color || C.accent).text(pdfSafe(safe(it.value)), x + 8, this.y + 6, { width: cw - 16, lineBreak: false });
        d.font(FONT).fontSize(8).fillColor(C.muted).text(pdfSafe(it.label), x + 8, this.y + 27, { width: cw - 16, lineBreak: false });
      });
      this.y += h + 6; this.mark(this.y);
    }
  }
  table(columns, rows, { size = 8.5, emptyText = null } = {}) {
    if (!rows.length) { if (emptyText) this.text(emptyText, { color: C.muted, after: 6 }); return; }
    const padX = 4, padY = 3.5; const d = this.doc;
    const total = columns.reduce((a, c) => a + c.w, 0);
    const widths = columns.map(c => (c.w / total) * this.w);
    const headerH = Math.max(...columns.map((c, i) => this.measure(c.header, { size: 8, bold: true, width: widths[i] - 2 * padX }))) + 2 * padY;
    const txt = (c) => (c && typeof c === 'object' ? c.text : c);
    const rowH = (row) => Math.max(...row.map((c, i) => this.measure(safe(txt(c)), { size, bold: !!c?.bold, width: widths[i] - 2 * padX }))) + 2 * padY;
    const header = () => {
      let x = this.x0;
      d.rect(this.x0, this.y, this.w, headerH).fill(C.accent);
      columns.forEach((c, i) => { d.font(BOLD).fontSize(8).fillColor(C.white).text(pdfSafe(c.header), x + padX, this.y + padY, { width: widths[i] - 2 * padX, align: c.align || 'left', lineGap: GAP }); x += widths[i]; });
      this.y += headerH; this.mark(this.y);
    };
    this.ensure(headerH + rowH(rows[0]));
    header();
    rows.forEach((row, ri) => {
      const rh = rowH(row);
      if (this.y + rh > this.limit) { this.newPage(); header(); }
      if (ri % 2 === 1) d.rect(this.x0, this.y, this.w, rh).fill(C.zebra);
      let x = this.x0;
      row.forEach((c, i) => {
        d.font(c?.bold ? BOLD : FONT).fontSize(size).fillColor(c?.color || C.body).text(pdfSafe(safe(txt(c))), x + padX, this.y + padY, { width: widths[i] - 2 * padX, align: columns[i].align || 'left', lineGap: GAP });
        x += widths[i];
      });
      d.moveTo(this.x0, this.y + rh).lineTo(this.x0 + this.w, this.y + rh).lineWidth(0.4).strokeColor(C.line).stroke();
      this.y += rh; this.mark(this.y);
    });
    this.y += 6;
  }
  footer() {
    const d = this.doc; const range = d.bufferedPageRange();
    for (let i = range.start; i < range.start + range.count; i++) {
      d.switchToPage(i);
      const m = d.page.margins; const prev = m.bottom; m.bottom = 0;
      const y = d.page.height - 38;
      d.moveTo(this.x0, y - 5).lineTo(this.x0 + this.w, y - 5).lineWidth(0.4).strokeColor(C.line).stroke();
      d.font(FONT).fontSize(8).fillColor(C.muted).text(this.title, this.x0, y, { width: this.w * 0.75, lineBreak: false, ellipsis: true });
      d.text(`Page ${i + 1} of ${range.count}`, this.x0, y, { width: this.w, align: 'right', lineBreak: false });
      m.bottom = prev;
    }
  }
  async finish() {
    this.footer(); this.doc.end();
    const buffer = await this.done;
    return { buffer, meta: { pageCount: this.pageEnd.length, pageEnd: this.pageEnd.slice(), top: this.top, limit: this.limit } };
  }
}

const clip = (s) => { const t = truncate(s, MAX_TEXT); return t.truncated ? `${t.text} (shortened)` : t.text; };
const gen = (now, tz) => `Generated ${fmtDate(now, tz)}`;
const ratingColor = (r) => RATING_COLOR[r] || C.ink;

/** One compact question block: tag line, question, answers, optional explanation. Never split across pages. */
function questionBlock(L, q) {
  const d = L.doc; const pad = 8; const inner = L.w - pad - 4;
  const col = q.result === 'Correct' ? { color: C.green, bg: C.greenSoft } : q.result === 'Wrong' ? { color: C.red, bg: C.redSoft } : { color: C.grey, bg: C.greySoft };
  const qText = clip(q.question) || DASH;
  const mine = q.userAnswer ? clip(q.userAnswer) : 'Not answered';
  const right = clip(q.correctAnswer) || DASH;
  const why = q.explanation ? clip(q.explanation) : '';
  const LABEL = 92;
  const hQ = L.measure(qText, { size: 9.5, bold: true, width: inner });
  const hM = L.measure(mine, { size: 9, width: inner - LABEL });
  const hR = L.measure(right, { size: 9, width: inner - LABEL });
  const hW = why ? L.measure(why, { size: 8.5, width: inner - LABEL }) : 0;
  const total = 14 + hQ + 3 + hM + 1.5 + hR + 1.5 + (why ? hW + 1.5 : 0) + 6;
  L.ensure(total);
  const x = L.x0 + pad; let y = L.y;
  d.font(BOLD).fontSize(9).fillColor(C.accent).text(`Day ${q.day}  Q${q.no}`, x, y + 1, { width: 70, lineBreak: false });
  const meta = [q.section, q.attempt > 1 || !q.isLatest ? `Attempt ${q.attempt}` : ''].filter(Boolean).join('  |  ');
  if (meta) d.font(FONT).fontSize(8).fillColor(C.muted).text(pdfSafe(meta), x + 70, y + 1.5, { width: inner - 150, lineBreak: false, ellipsis: true });
  const tw = d.font(BOLD).fontSize(7.5).widthOfString(q.result) + 12;
  L.tag(q.result, L.x0 + L.w - tw, y, col);
  y += 14;
  d.font(BOLD).fontSize(9.5).fillColor(C.ink).text(pdfSafe(qText), x, y, { width: inner, lineGap: GAP }); y += hQ + 3;
  const field = (label, text, h, color, size = 9) => {
    d.font(BOLD).fontSize(size - 0.5).fillColor(C.muted).text(label, x, y, { width: LABEL - 4, lineBreak: false });
    d.font(FONT).fontSize(size).fillColor(color).text(pdfSafe(text), x + LABEL, y, { width: inner - LABEL, lineGap: GAP });
    y += h + 1.5;
  };
  field('Employee answer', mine, hM, q.result === 'Correct' ? C.green : q.result === 'Wrong' ? C.red : C.muted);
  field('Correct answer', right, hR, C.body);
  if (why) field('Explanation', why, hW, C.muted, 8.5);
  d.rect(L.x0, L.y, 2.5, y - L.y).fill(col.color);
  L.y = y + 3;
  d.moveTo(L.x0, L.y).lineTo(L.x0 + L.w, L.y).lineWidth(0.3).strokeColor(C.line).stroke();
  L.y += 3; L.mark(L.y);
}

// ── SINGLE EMPLOYEE-MODULE REPORT ───────────────────────────────────────────
export async function renderModulePdf({ record: r, now = new Date(), tz = reportTimezone() }) {
  const L = new Layout({ title: `Module Engagement Report - ${safe(r.name, 'Employee')} - ${safe(r.moduleTitle, 'Module')}`, company: r.companyName || 'SkillForge', generatedText: gen(now, tz) });
  L.title1('Module Engagement Report', `${safe(r.name)}  |  ${safe(r.moduleTitle)}`);
  L.kvGrid([
    { label: 'Employee ID', value: r.employeeId }, { label: 'Job role', value: r.jobRole }, { label: 'Department', value: r.department },
    { label: 'Manager', value: r.managerName }, { label: 'Module', value: r.moduleTitle }, { label: 'Status', value: r.status },
  ], 3);

  L.section('At a glance', 48);
  L.kvGrid([
    { label: 'Score', value: r.scorePct === null ? DASH : `${fmtPct(r.scorePct, 1)}  (${r.correct} of ${r.questionsTotal} correct)` },
    { label: 'Rating', value: r.rating || DASH, color: ratingColor(r.rating) },
    { label: 'Days completed', value: `${r.daysCompleted} of ${r.daysTotal}  (${r.progressPct}%)` },
    { label: 'Time spent', value: fmtSeconds(r.timeSpentSec) },
    { label: 'Questions', value: r.questionsTotal === null ? DASH : `${r.questionsAnswered} answered, ${r.wrong} wrong, ${r.skipped} not answered` },
    { label: 'Quiz attempts', value: r.attemptsTotal || DASH },
    { label: 'Assigned on', value: fmtDate(r.assignedAt, tz) }, { label: 'Started', value: fmtDate(r.startedAt, tz) }, { label: 'Completed on', value: fmtDate(r.completedAt, tz) },
  ], 3);
  if (!r.hasDetail) L.text('Answers for this module were not saved (it was completed before answer capture was added), so only progress and dates are available.', { color: C.muted, size: 9, after: 6 });

  // day-wise summary
  L.section('Day-wise summary', 50);
  L.table(
    [{ header: 'Day', w: 28, align: 'center' }, { header: 'Title', w: 120 }, { header: 'Status', w: 56 }, { header: 'Completed', w: 70 }, { header: 'Time', w: 44 }, { header: 'Tries', w: 28, align: 'center' }, { header: 'Correct / Total', w: 52, align: 'center' }, { header: 'Score', w: 40, align: 'right' }],
    (r.days || []).map(d => [String(d.day), d.title, d.status, fmtDate(d.completedAt, tz, { time: false }), fmtSeconds(d.timeSpentSec), d.attempts || DASH, d.total ? `${d.correct} / ${d.total}` : DASH, { text: d.scorePct === null ? DASH : fmtPct(d.scorePct, 1), bold: true }]),
    { emptyText: 'No days are recorded for this module.' },
  );

  // section-wise detail
  L.section('Section-wise detail', 50);
  for (const d of r.days || []) {
    L.subheading(`Day ${d.day}: ${d.title}`, 34);
    L.text([`Status: ${d.status}`, `Started: ${fmtDate(d.startedAt, tz)}`, `Completed: ${fmtDate(d.completedAt, tz)}`, `Time: ${fmtSeconds(d.timeSpentSec)}`, `Score: ${d.scorePct === null ? DASH : fmtPct(d.scorePct, 1)}`].join('   |   '), { size: 8.5, color: C.muted, after: 2 });
    const secs = d.sections.map(s => s.title).filter(Boolean);
    L.text(secs.length ? `${d.sectionsTracked ? 'Sections opened' : 'Sections in this day'}: ${secs.join('; ')}` : 'Sections: not recorded', { size: 8.5, after: 5 });
  }

  // question review
  if ((r.questions || []).length) {
    const latest = r.questions.filter(q => q.isLatest);
    const cnt = (x) => latest.filter(q => q.result === x).length;
    L.section('Question review', 40, `${latest.length} questions: ${cnt('Correct')} correct, ${cnt('Wrong')} wrong, ${cnt('Not answered')} not answered`);
    for (const q of r.questions) questionBlock(L, q);
  }

  // skills
  if ((r.skills || []).length) {
    L.section('Skills summary', 60);
    L.table([{ header: 'Skill / section', w: 60 }, { header: 'Correct / Total', w: 20, align: 'center' }, { header: 'Score', w: 14, align: 'right' }],
      r.skills.map(s => [s.skill, `${s.correct} / ${s.total}`, { text: fmtPct(s.pct, 1), bold: true, color: s.pct >= 70 ? C.green : C.red }]));
    L.text(`Strengths: ${(r.strengths || []).join('; ') || 'none yet'}`, { size: 9, color: C.green, bold: true, after: 2 });
    L.text(`Needs improvement: ${(r.needsImprovement || []).join('; ') || 'nothing flagged'}`, { size: 9, color: C.red, bold: true, after: 2 });
    if ((r.missed || []).length) L.text(`Questions to revisit: ${r.missed.map(m => clip(m)).join('  /  ')}`, { size: 8.5, color: C.muted });
  }

  // timeline
  if ((r.timeline || []).length) {
    L.section('Engagement timeline', 50);
    L.table([{ header: 'When', w: 34 }, { header: 'Event', w: 66 }], r.timeline.map(t => [fmtDate(t.at, tz), t.event]), { size: 8.5 });
  }
  return L.finish();
}

// ── CONSOLIDATED REPORT ─────────────────────────────────────────────────────
export async function renderConsolidatedModulePdf({ rows, summary = {}, company = '', filtersText = '', now = new Date(), tz = reportTimezone() }) {
  const L = new Layout({ title: 'Module Completion Report', company: company || 'SkillForge', generatedText: gen(now, tz) });
  L.title1('Module Completion Report', filtersText || 'All matching employees and modules');
  L.section('Overview', 48);
  L.statRow([
    { label: 'Records', value: rows.length }, { label: 'Completed modules', value: summary.completed }, { label: 'Employees', value: summary.employees }, { label: 'Average score', value: fmtPct(summary.avgScore, 1) },
    { label: 'Expert', value: summary.ratings?.Expert ?? 0, color: C.green }, { label: 'Intermediate', value: summary.ratings?.Intermediate ?? 0, color: C.blue },
    { label: 'Basic', value: summary.ratings?.Basic ?? 0, color: C.amber }, { label: 'No Rating', value: summary.ratings?.['No Rating'] ?? 0, color: C.red },
  ], 4);
  L.text(`Total time spent: ${fmtSeconds(summary.totalTimeSec)}`, { size: 9, color: C.muted });
  L.section('Employee modules', 40);
  L.table(
    [{ header: 'Employee ID', w: 54 }, { header: 'Name', w: 96 }, { header: 'Module', w: 104 }, { header: 'Completed', w: 58 }, { header: 'Days', w: 32, align: 'center' }, { header: 'Time', w: 44 }, { header: 'Score', w: 38, align: 'right' }, { header: 'Rating', w: 54 }],
    rows.map(r => [r.employeeId, r.name, r.moduleTitle, fmtDate(r.completedAt, tz, { time: false }), `${r.daysCompleted}/${r.daysTotal}`, fmtSeconds(r.timeSpentSec), r.scorePct === null ? DASH : fmtPct(r.scorePct, 1), { text: r.rating || DASH, bold: true, color: ratingColor(r.rating) }]),
    { size: 8, emptyText: 'No records match the selected filters.' },
  );
  return L.finish();
}

export async function buildModulePdf(args) { return (await renderModulePdf(args)).buffer; }
export async function buildConsolidatedModulePdf(args) { return (await renderConsolidatedModulePdf(args)).buffer; }
